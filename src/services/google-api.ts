/**
 * GoogleApiClient
 *
 * @purpose Primary interface to Google Sheets and Drive APIs with connection pooling and circuit breaker
 * @category Core
 * @usage Use this service for all Google API operations (sheets, drive); handles auth, retries, and rate limiting
 * @dependencies OAuth2Client, googleapis, TokenStore, CircuitBreaker, TokenManager
 * @stateful Yes - maintains OAuth client, circuit breaker state, token store, HTTP/2 connection pools
 * @singleton Yes - one instance per process to share connection pools and circuit breaker state
 *
 * @example
 * const client = new GoogleApiClient({ credentials, tokenStore });
 * await client.initialize();
 * const sheets = await client.getSheetsClient();
 * const response = await sheets.spreadsheets.get({ spreadsheetId });
 */

import {
  google,
  sheets_v4,
  drive_v3,
  bigquery_v2,
  docs_v1,
  slides_v1,
  drivelabels_v2,
  driveactivity_v2,
  workspaceevents_v1,
} from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { executeWithRetry, type RetryOptions } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import { EncryptedFileTokenStore, type TokenStore, type StoredTokens } from './token-store.js';
import { HybridTokenStore } from './keychain-store.js';
import {
  CircuitBreaker,
  QuotaCircuitBreaker,
  FallbackStrategies,
  type ICircuitBreaker,
} from '../utils/circuit-breaker.js';
import { getCircuitBreakerConfig, getEnv } from '../config/env.js';
import { circuitBreakerRegistry } from './circuit-breaker-registry.js';
import PQueue from 'p-queue';
import { getRequestContext } from '../utils/request-context.js';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { ServiceError } from '../core/errors.js';
import { TokenManager } from './token-manager.js';
import { logHTTP2Capabilities, validateHTTP2Config } from '../utils/http2-detector.js';

import {
  FULL_ACCESS_SCOPES,
  getConfiguredScopes,
  getRecommendedScopes,
} from '../config/oauth-scopes.js';
import { registerCleanup } from '../utils/resource-cleanup.js';
import { PerSpreadsheetThrottle } from './per-spreadsheet-throttle.js';

// Lazy-loaded metrics module — avoids dynamic import overhead on every API call
let _metricsModule: typeof import('../observability/metrics.js') | null = null;
async function getMetrics(): Promise<typeof import('../observability/metrics.js') | null> {
  if (_metricsModule) return _metricsModule;
  try {
    _metricsModule = await import('../observability/metrics.js');
    return _metricsModule;
  } catch {
    return null;
  }
}

// ============================================================================
// SHARED DRIVE RATE LIMITER (token bucket algorithm)
// ============================================================================

/**
 * Rate limiter for Shared Drive write operations.
 * Shared Drives have stricter write quotas than personal drives.
 * Uses a token bucket algorithm for smooth rate limiting.
 */
class SharedDriveRateLimiter {
  private tokens: number;
  private lastRefillTime: number = Date.now();
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second

  constructor(requestsPerSecond: number = 3) {
    this.capacity = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.tokens = this.capacity;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTime) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefillTime = now;
  }

  /**
   * Wait until a token is available, then consume it.
   * Returns the wait time in milliseconds.
   */
  async waitForToken(): Promise<number> {
    const startTime = Date.now();

    while (true) {
      this.refillTokens();

      if (this.tokens >= 1) {
        this.tokens--;
        return Date.now() - startTime;
      }

      // Sleep for a short time (10ms) to avoid busy-waiting
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// Module-level singleton — shared across all GoogleApiClient instances so that
// concurrent calls from different client instances for the same spreadsheet
// still respect the per-spreadsheet RPS cap (src/config/env.ts:PER_SPREADSHEET_RPS).
const perSpreadsheetThrottle = new PerSpreadsheetThrottle();

export interface GoogleApiClientOptions {
  credentials?: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  };
  accessToken?: string;
  refreshToken?: string;
  oauthTokens?: StoredTokens;
  serviceAccountKeyPath?: string;
  scopes?: string[];
  /** @deprecated Use scopes array directly. Retained for backward compatibility. */
  elevatedAccess?: boolean;
  /** Retry/backoff options for API calls */
  retryOptions?: RetryOptions;
  /** Per-request timeout for Google API calls (ms) */
  timeoutMs?: number;
  /** Encrypted token store path */
  tokenStorePath?: string;
  /** Encryption key (hex) for token store */
  tokenStoreKey?: string;
  /** Use OS keychain for token storage (falls back to file if unavailable) */
  useKeychain?: boolean;
  /** Custom token store implementation */
  tokenStore?: TokenStore;
}

export type GoogleAuthType = 'service_account' | 'oauth' | 'access_token' | 'application_default';

/**
 * @deprecated Use getRecommendedScopes() from config/oauth-scopes.ts instead
 */
export const DEFAULT_SCOPES = Array.from(getRecommendedScopes());

/**
 * @deprecated Use FULL_ACCESS_SCOPES from config/oauth-scopes.ts instead
 */
export const ELEVATED_SCOPES = Array.from(FULL_ACCESS_SCOPES);

/**
 * @deprecated Use getRecommendedScopes() from config/oauth-scopes.ts instead
 */
export const READONLY_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

/**
 * @deprecated Use getRecommendedScopes() from config/oauth-scopes.ts instead
 */
export const BIGQUERY_SCOPES = [
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/cloud-platform',
];

/**
 * @deprecated Use getRecommendedScopes() from config/oauth-scopes.ts instead
 */
export const APPSSCRIPT_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.processes',
];

/**
 * @deprecated Use FULL_ACCESS_SCOPES from config/oauth-scopes.ts instead
 */
export const FULL_SCOPES = Array.from(FULL_ACCESS_SCOPES);

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveGoogleApiAgentTimeoutMs(envSource: NodeJS.ProcessEnv = process.env): number {
  return (
    parsePositiveInteger(envSource['GOOGLE_API_TIMEOUT_MS']) ??
    parsePositiveInteger(envSource['GOOGLE_API_REQUEST_TIMEOUT_MS']) ??
    60000
  );
}

/**
 * Create HTTP agents with connection pooling
 * Optimizes performance by reusing TCP connections
 */
function createHttpAgents(): { http: HttpAgent; https: HttpsAgent } {
  const maxSockets = parseInt(process.env['GOOGLE_API_MAX_SOCKETS'] ?? '50');
  const keepAliveTimeout = parseInt(process.env['GOOGLE_API_KEEPALIVE_TIMEOUT'] ?? '30000');

  const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: keepAliveTimeout,
    maxSockets,
    maxFreeSockets: Math.floor(maxSockets / 2),
    timeout: resolveGoogleApiAgentTimeoutMs(),
    scheduling: 'lifo' as const, // Use most recent connection first
  };

  return {
    http: new HttpAgent(agentOptions),
    https: new HttpsAgent(agentOptions),
  };
}

/**
 * Google API client wrapper
 */
export class GoogleApiClient {
  private auth: OAuth2Client | null = null;
  private _sheets: sheets_v4.Sheets | null = null;
  private _drive: drive_v3.Drive | null = null;
  private _driveLabels: drivelabels_v2.Drivelabels | null = null;
  private _bigquery: bigquery_v2.Bigquery | null = null;
  private _docs: docs_v1.Docs | null = null;
  private _slides: slides_v1.Slides | null = null;
  private _driveActivity: driveactivity_v2.Driveactivity | null = null;
  private _workspaceEvents: workspaceevents_v1.Workspaceevents | null = null;
  private options: GoogleApiClientOptions;
  private _scopes: string[];
  private retryOptions?: RetryOptions;
  private timeoutMs?: number;
  private tokenStore?: TokenStore;
  private sheetsCircuit: QuotaCircuitBreaker;
  private driveCircuit: CircuitBreaker;
  private bigqueryCircuit: CircuitBreaker;
  private docsCircuit: CircuitBreaker;
  private slidesCircuit: CircuitBreaker;
  private tokenRefreshQueue: PQueue;
  private tokenListener?: (tokens: import('google-auth-library').Credentials) => void;
  private httpAgents: { http: HttpAgent; https: HttpsAgent };
  private _authType: GoogleAuthType;
  private tokenManager?: TokenManager;
  // Existence pre-check cache: spreadsheetId → expiry timestamp (Fix B).
  // Survives reinitializeApis() calls; invalidated explicitly on 404.
  private readonly spreadsheetExistenceCache = new Map<string, number>();
  private static readonly EXISTENCE_TTL_MS = 5 * 60 * 1000;
  private poolMonitorInterval?: NodeJS.Timeout;
  // Token validation cache to avoid excessive API calls
  private lastValidationResult?: { valid: boolean; error?: string };
  private lastValidationTime?: number;
  private static readonly VALIDATION_CACHE_TTL_MS = 60 * 1000; // 1 minute (reduced from 5min to detect token invalidation faster)

  // HTTP/2 Connection Health Management
  private consecutiveErrors = 0;
  private static readonly CONNECTION_ERROR_THRESHOLD = 5;
  private lastSuccessfulCall = Date.now();
  private connectionResetInProgress = false;
  private keepaliveInterval?: NodeJS.Timeout;

  // Shared Drive rate limiter
  private sharedDriveRateLimiter: SharedDriveRateLimiter;
  private sharedDriveMembershipCache = new Map<string, { value: boolean; timestamp: number }>();
  private static readonly DRIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly DRIVE_CACHE_MAX = 1000; // LRU eviction threshold

  constructor(options: GoogleApiClientOptions = {}) {
    this.options = options;
    this._authType = options.serviceAccountKeyPath
      ? 'service_account'
      : options.credentials
        ? 'oauth'
        : options.accessToken
          ? 'access_token'
          : 'application_default';
    // Determine scopes based on options (explicit scopes > legacy elevated flag > configured defaults)
    this._scopes =
      options.scopes ??
      (options.elevatedAccess ? Array.from(ELEVATED_SCOPES) : Array.from(getConfiguredScopes()));
    this.retryOptions = options.retryOptions;
    this.timeoutMs = options.timeoutMs;
    this.tokenStore = options.tokenStore;
    // Token store will be initialized in initialize() if using keychain
    if (
      !this.tokenStore &&
      !options.useKeychain &&
      options.tokenStorePath &&
      options.tokenStoreKey
    ) {
      this.tokenStore = new EncryptedFileTokenStore(options.tokenStorePath, options.tokenStoreKey);
    }

    // Initialize per-API circuit breakers (separate so a Sheets outage doesn't block Drive/BigQuery)
    const circuitConfig = getCircuitBreakerConfig();
    this.sheetsCircuit = new QuotaCircuitBreaker({ ...circuitConfig, name: 'google-sheets-api' });
    this.driveCircuit = new CircuitBreaker({ ...circuitConfig, name: 'google-drive-api' });
    this.bigqueryCircuit = new CircuitBreaker({ ...circuitConfig, name: 'google-bigquery-api' });
    this.docsCircuit = new CircuitBreaker({ ...circuitConfig, name: 'google-docs-api' });
    this.slidesCircuit = new CircuitBreaker({ ...circuitConfig, name: 'google-slides-api' });

    // 16-A6: Register readOnlyMode fallback strategies on circuit breakers
    // When Sheets/Drive circuit is open, gracefully degrade to read-only responses
    // This prevents cascading failures during API outages by serving cached data
    this.sheetsCircuit.registerFallback(
      FallbackStrategies.readOnlyMode(
        { success: false, error: 'Google Sheets API temporarily unavailable - read-only mode' },
        30 // priority
      )
    );
    this.driveCircuit.registerFallback(
      FallbackStrategies.readOnlyMode(
        { success: false, error: 'Google Drive API temporarily unavailable - read-only mode' },
        30
      )
    );
    // Register circuit breakers for monitoring
    circuitBreakerRegistry.register(
      'google-sheets-api',
      this.sheetsCircuit,
      'Sheets API circuit breaker'
    );
    circuitBreakerRegistry.register(
      'google-drive-api',
      this.driveCircuit,
      'Drive API circuit breaker'
    );
    circuitBreakerRegistry.register(
      'google-bigquery-api',
      this.bigqueryCircuit,
      'BigQuery API circuit breaker'
    );
    circuitBreakerRegistry.register(
      'google-docs-api',
      this.docsCircuit,
      'Docs API circuit breaker'
    );
    circuitBreakerRegistry.register(
      'google-slides-api',
      this.slidesCircuit,
      'Slides API circuit breaker'
    );

    // Initialize token refresh queue (prevents concurrent refreshes)
    this.tokenRefreshQueue = new PQueue({ concurrency: 1 });

    // Initialize HTTP agents with connection pooling
    this.httpAgents = createHttpAgents();

    // Initialize Shared Drive rate limiter (configurable via SHARED_DRIVE_WRITE_RATE env var)
    const sharedDriveWriteRate = parseInt(process.env['SHARED_DRIVE_WRITE_RATE'] ?? '3', 10);
    this.sharedDriveRateLimiter = new SharedDriveRateLimiter(sharedDriveWriteRate);

    // Set up connection pool monitoring if enabled
    this.setupConnectionPoolMonitoring();
  }

  /**
   * Initialize authentication
   */
  async initialize(): Promise<void> {
    // Initialize token store (async for keychain support)
    if (
      !this.tokenStore &&
      this.options.useKeychain &&
      this.options.tokenStorePath &&
      this.options.tokenStoreKey
    ) {
      this.tokenStore = await HybridTokenStore.create(
        this.options.tokenStorePath,
        this.options.tokenStoreKey
      );
      const storageType = (this.tokenStore as HybridTokenStore).getStorageType?.();
      logger.info(`Token storage initialized: ${storageType || 'hybrid'}`);
    }

    const scopes = this._scopes;

    if (this.options.serviceAccountKeyPath) {
      // Service account authentication
      const auth = new google.auth.GoogleAuth({
        keyFile: this.options.serviceAccountKeyPath,
        scopes,
      });
      this.auth = (await auth.getClient()) as OAuth2Client;
    } else if (this.options.credentials) {
      // OAuth2 authentication
      const { clientId, clientSecret, redirectUri } = this.options.credentials;
      this.auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    } else if (this.options.accessToken) {
      // Direct token
      this.auth = new google.auth.OAuth2();
    } else {
      // Application default credentials
      const auth = new google.auth.GoogleAuth({ scopes });
      this.auth = (await auth.getClient()) as OAuth2Client;
    }

    this.attachTokenListener();
    await this.loadStoredTokens();
    this.initializeTokenManager();

    // Log HTTP/2 capabilities at initialization
    logHTTP2Capabilities();

    // Enable HTTP/2 for improved performance (5-15% latency reduction)
    // gaxios automatically negotiates HTTP/2 via ALPN if server supports it
    const enableHTTP2 = getEnv().GOOGLE_API_HTTP2_ENABLED; // Enabled by default

    // Validate HTTP/2 configuration
    const validation = validateHTTP2Config(enableHTTP2);
    if (validation.warnings.length > 0) {
      logger.warn('HTTP/2 configuration warnings', {
        warnings: validation.warnings,
      });
    }

    // Initialize API clients with HTTP/2 enabled
    const sheetsApi = google.sheets({
      version: 'v4',
      auth: this.auth,
      // Enable HTTP/2 for automatic protocol negotiation via ALPN
      http2: enableHTTP2,
    });
    const driveApi = google.drive({
      version: 'v3',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const bigqueryApi = google.bigquery({
      version: 'v2',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const docsApi = google.docs({
      version: 'v1',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const slidesApi = google.slides({
      version: 'v1',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const driveLabelsApi = google.drivelabels({
      version: 'v2',
      auth: this.auth,
      http2: enableHTTP2,
    });

    // Drive Activity API for WHO/WHEN change attribution
    this._driveActivity = wrapGoogleApi(google.driveactivity({ version: 'v2', auth: this.auth }), {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.driveCircuit,
      client: this,
    });

    // Workspace Events API for push notification subscriptions
    this._workspaceEvents = wrapGoogleApi(
      google.workspaceevents({ version: 'v1', auth: this.auth }),
      {
        ...(this.retryOptions ?? {}),
        timeoutMs: this.timeoutMs,
        circuit: this.driveCircuit,
        client: this,
      }
    );

    logger.info('Google API clients initialized', {
      http2Enabled: enableHTTP2,
      expectedLatencyReduction: enableHTTP2 ? '5-15%' : 'N/A',
    });

    // Configure transport options for auth client
    if (this.auth && 'transporter' in this.auth) {
      const transporter = (this.auth as unknown as Record<string, unknown>)['transporter'] as
        | Record<string, unknown>
        | undefined;
      if (transporter && transporter['defaults']) {
        const defaults = transporter['defaults'] as Record<string, unknown>;
        defaults['agent'] = this.httpAgents.https;
        defaults['httpAgent'] = this.httpAgents.http;
        // google-auth-library v10.5.0 sets 'User-Agent: google-api-nodejs-client/10.5.0' (no gzip suffix).
        // Google docs require '(gzip)' in User-Agent for compressed responses.
        // Setting a custom UA here causes the auth interceptor to append the library token:
        //   result → 'ServalSheets/2.0.0 (gzip) google-api-nodejs-client/10.5.0'
        // https://developers.google.com/sheets/api/guides/performance#gzip
        const existingHeaders = (defaults['headers'] as Record<string, string> | undefined) ?? {};
        defaults['headers'] = { ...existingHeaders, 'User-Agent': 'ServalSheets/2.0.0 (gzip)' };
      }
    }

    // Capture raw (pre-wrap) sheetsApi so the existence checker never re-enters the proxy.
    const rawSheetsForExistenceInit = sheetsApi;
    const existenceCheckerInit = async (spreadsheetId: string): Promise<void> => {
      const expiry = this.spreadsheetExistenceCache.get(spreadsheetId);
      if (expiry !== undefined && Date.now() < expiry) return;
      await rawSheetsForExistenceInit.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId' });
      this.spreadsheetExistenceCache.set(
        spreadsheetId,
        Date.now() + GoogleApiClient.EXISTENCE_TTL_MS
      );
    };

    this._sheets = wrapGoogleApi(sheetsApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.sheetsCircuit,
      client: this,
      existenceChecker: existenceCheckerInit,
    });
    this._drive = wrapGoogleApi(driveApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.driveCircuit,
      client: this,
    });
    this._bigquery = wrapGoogleApi(bigqueryApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.bigqueryCircuit,
      client: this,
    });
    this._docs = wrapGoogleApi(docsApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.docsCircuit,
      client: this,
    });
    this._slides = wrapGoogleApi(slidesApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.slidesCircuit,
      client: this,
    });
    this._driveLabels = wrapGoogleApi(driveLabelsApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.driveCircuit,
      client: this,
    });

    // Optional: Validate schemas with Discovery API if enabled
    await this.validateSchemasWithDiscovery();

    // Start connection health keepalive
    this.startKeepalive();
  }

  /**
   * Reset HTTP agents and API clients after credential changes
   * Prevents ERR_HTTP2_GOAWAY_SESSION by creating fresh connections
   *
   * This is called automatically when:
   * - OAuth tokens are refreshed (via 'tokens' event listener)
   * - Credentials are manually updated (via setCredentials())
   *
   * @internal
   */
  private async resetHttpAgents(): Promise<void> {
    if (!this.auth) {
      logger.warn('Cannot reset HTTP agents: auth client not initialized');
      return;
    }

    logger.info('Resetting HTTP agents due to credential change');

    // Record metric
    const metrics = await getMetrics();
    metrics?.recordHttp2ConnectionReset('token_refresh');

    // Destroy old agents (closes stale HTTP/2 connections)
    this.httpAgents.http.destroy();
    this.httpAgents.https.destroy();

    // Create fresh agents
    this.httpAgents = createHttpAgents();

    // Recreate API clients with new agents
    const enableHTTP2 = getEnv().GOOGLE_API_HTTP2_ENABLED;

    const sheetsApi = google.sheets({
      version: 'v4',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const driveApi = google.drive({
      version: 'v3',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const bigqueryApi = google.bigquery({
      version: 'v2',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const docsApi = google.docs({
      version: 'v1',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const slidesApi = google.slides({
      version: 'v1',
      auth: this.auth,
      http2: enableHTTP2,
    });
    const driveLabelsApi = google.drivelabels({
      version: 'v2',
      auth: this.auth,
      http2: enableHTTP2,
    });

    // Reconfigure transporter with new agents
    if (this.auth && 'transporter' in this.auth) {
      const transporter = (this.auth as unknown as Record<string, unknown>)['transporter'] as
        | Record<string, unknown>
        | undefined;
      if (transporter && transporter['defaults']) {
        const defaults = transporter['defaults'] as Record<string, unknown>;
        defaults['agent'] = this.httpAgents.https;
        defaults['httpAgent'] = this.httpAgents.http;
        const existingHeaders = (defaults['headers'] as Record<string, string> | undefined) ?? {};
        defaults['headers'] = { ...existingHeaders, 'User-Agent': 'ServalSheets/2.0.0 (gzip)' };
      }
    }

    // Wrap with retry/circuit breaker (maintain existing error handling)
    // Rebuild existence checker against the new raw sheetsApi after reinit.
    const rawSheetsForExistenceReinit = sheetsApi;
    const existenceCheckerReinit = async (spreadsheetId: string): Promise<void> => {
      const expiry = this.spreadsheetExistenceCache.get(spreadsheetId);
      if (expiry !== undefined && Date.now() < expiry) return;
      await rawSheetsForExistenceReinit.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId',
      });
      this.spreadsheetExistenceCache.set(
        spreadsheetId,
        Date.now() + GoogleApiClient.EXISTENCE_TTL_MS
      );
    };

    this._sheets = wrapGoogleApi(sheetsApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.sheetsCircuit,
      client: this,
      existenceChecker: existenceCheckerReinit,
    });
    this._drive = wrapGoogleApi(driveApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.driveCircuit,
      client: this,
    });
    this._bigquery = wrapGoogleApi(bigqueryApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.bigqueryCircuit,
      client: this,
    });
    this._docs = wrapGoogleApi(docsApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.docsCircuit,
      client: this,
    });
    this._slides = wrapGoogleApi(slidesApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.slidesCircuit,
      client: this,
    });
    this._driveLabels = wrapGoogleApi(driveLabelsApi, {
      ...(this.retryOptions ?? {}),
      timeoutMs: this.timeoutMs,
      circuit: this.driveCircuit,
      client: this,
    });

    logger.info('HTTP agents reset complete', {
      http2Enabled: enableHTTP2,
    });
  }

  /**
   * Reset HTTP/2 connections after consecutive API failures.
   * This forces new connection negotiation with Google servers.
   *
   * @internal Called automatically when consecutive errors exceed threshold
   */
  private async resetConnectionsAfterErrors(): Promise<void> {
    if (this.connectionResetInProgress) {
      logger.debug('Connection reset already in progress, skipping');
      return;
    }

    this.connectionResetInProgress = true;
    logger.warn('Resetting HTTP/2 connections due to consecutive errors', {
      consecutiveErrors: this.consecutiveErrors,
      lastSuccess: new Date(this.lastSuccessfulCall).toISOString(),
    });

    try {
      // Record metric with different reason than token refresh
      (await getMetrics())?.recordHttp2ConnectionReset('consecutive_errors');

      // Reuse the existing agent reset logic
      await this.resetHttpAgents();

      this.consecutiveErrors = 0;
      this.lastSuccessfulCall = Date.now();
      logger.info('HTTP/2 connections reset successfully after errors');
    } catch (error) {
      logger.error('Failed to reset connections after errors', { error });
    } finally {
      this.connectionResetInProgress = false;
    }
  }

  /**
   * Force reset HTTP/2 connections on GOAWAY or similar connection errors.
   * Called by the retry wrapper before retrying a failed request.
   */
  public async resetOnConnectionError(): Promise<void> {
    if (this.connectionResetInProgress) {
      return; // Already resetting
    }

    this.connectionResetInProgress = true;
    try {
      logger.warn('Resetting HTTP/2 connections due to GOAWAY error during retry');
      (await getMetrics())?.recordHttp2ConnectionReset('goaway_retry');
      await this.resetHttpAgents();
      this.consecutiveErrors = 0;
      logger.info('HTTP/2 connections reset successfully for retry');
    } catch (error) {
      logger.error('Failed to reset connections for retry', { error });
    } finally {
      this.connectionResetInProgress = false;
    }
  }

  /**
   * Track API call success/failure for connection health monitoring.
   * Call this after each API operation completes.
   *
   * @param success - Whether the API call succeeded
   */
  public recordCallResult(success: boolean): void {
    if (success) {
      this.consecutiveErrors = 0;
      this.lastSuccessfulCall = Date.now();
    } else {
      this.consecutiveErrors++;
      const threshold = parseInt(
        process.env['GOOGLE_API_CONNECTION_RESET_THRESHOLD'] ??
          String(GoogleApiClient.CONNECTION_ERROR_THRESHOLD)
      );

      if (this.consecutiveErrors >= threshold) {
        logger.warn('Consecutive error threshold reached, triggering connection reset', {
          consecutiveErrors: this.consecutiveErrors,
          threshold,
        });
        // Trigger async connection reset (don't await to not block)
        this.resetConnectionsAfterErrors().catch((err) =>
          logger.error('Connection reset failed', { error: err })
        );
      }
    }

    // Update connection health metrics (non-blocking)
    getMetrics()
      .then((m) => m?.updateConnectionHealth(this.consecutiveErrors, this.lastSuccessfulCall))
      .catch(() => {
        // Metrics are optional, don't fail on import errors
      });
  }

  /**
   * Reactively refresh OAuth token on auth errors (called by retry onRetry callback)
   */
  public async refreshTokenOnAuthError(): Promise<void> {
    if (this.tokenManager) {
      await this.tokenManager.refreshTokenOnAuthError();
    }
  }

  /**
   * Check if connections need proactive refresh due to idle time.
   * Call this periodically or before important operations.
   */
  public async ensureHealthyConnection(): Promise<void> {
    const idleTime = Date.now() - this.lastSuccessfulCall;
    const maxIdleMs = parseInt(process.env['GOOGLE_API_MAX_IDLE_MS'] ?? '300000'); // 5 min default

    if (idleTime > maxIdleMs) {
      logger.info('Connection idle too long, proactively refreshing', {
        idleTimeMs: idleTime,
        maxIdleMs,
      });

      (await getMetrics())?.recordHttp2ConnectionReset('idle_timeout');

      await this.resetHttpAgents();
      this.lastSuccessfulCall = Date.now();
    }
  }

  /**
   * Start periodic keepalive checks to maintain healthy connections.
   * Called automatically during initialization if enabled.
   *
   * @internal
   */
  private startKeepalive(): void {
    const intervalMs = parseInt(process.env['GOOGLE_API_KEEPALIVE_INTERVAL_MS'] ?? '60000'); // 1 min default

    if (intervalMs <= 0) {
      logger.debug('Keepalive disabled (interval <= 0)');
      return;
    }

    // Clear any existing interval
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }

    this.keepaliveInterval = setInterval(async () => {
      try {
        await this.ensureHealthyConnection();
      } catch (error) {
        logger.warn('Keepalive check failed', { error });
      }
    }, intervalMs);

    // Don't prevent process exit
    this.keepaliveInterval.unref();

    // Register cleanup to prevent memory leak
    registerCleanup(
      'GoogleApiClient',
      () => {
        if (this.keepaliveInterval) {
          clearInterval(this.keepaliveInterval);
        }
      },
      'keepalive-interval'
    );

    logger.debug('Keepalive started', { intervalMs });
  }

  /**
   * Validate API schemas using Discovery API (optional)
   * Only runs if DISCOVERY_API_ENABLED environment variable is true
   */
  private async validateSchemasWithDiscovery(): Promise<void> {
    if (!getEnv().DISCOVERY_API_ENABLED) {
      return;
    }

    try {
      // Dynamically import to avoid circular dependencies
      const { getSchemaValidator } = await import('./schema-validator.js');
      const validator = getSchemaValidator();

      logger.debug('Validating API schemas with Discovery API');

      // Validate Sheets API schema
      try {
        const sheetsValidation = await validator.validateAgainstCurrent('sheets');

        if (!sheetsValidation.valid || sheetsValidation.comparison?.hasChanges) {
          logger.warn('Sheets API schema validation detected issues', {
            issues: sheetsValidation.issues.map((issue) => ({
              severity: issue.severity,
              type: issue.type,
              message: issue.message,
            })),
            hasChanges: sheetsValidation.comparison?.hasChanges,
          });

          // Log critical issues
          const criticalIssues = sheetsValidation.issues.filter(
            (issue) => issue.severity === 'critical' || issue.severity === 'high'
          );
          if (criticalIssues.length > 0) {
            logger.error('Critical Sheets API schema issues detected', {
              count: criticalIssues.length,
              issues: criticalIssues.map((issue) => issue.message),
              recommendation: sheetsValidation.recommendation,
            });
          }
        } else {
          logger.debug('Sheets API schema validation passed');
        }
      } catch (error: unknown) {
        const err = error as { message?: string };
        logger.warn('Failed to validate Sheets API schema', { error: err.message });
      }

      // Validate Drive API schema
      try {
        const driveValidation = await validator.validateAgainstCurrent('drive');

        if (!driveValidation.valid || driveValidation.comparison?.hasChanges) {
          logger.warn('Drive API schema validation detected issues', {
            issues: driveValidation.issues.map((issue) => ({
              severity: issue.severity,
              type: issue.type,
              message: issue.message,
            })),
            hasChanges: driveValidation.comparison?.hasChanges,
          });

          // Log critical issues
          const criticalIssues = driveValidation.issues.filter(
            (issue) => issue.severity === 'critical' || issue.severity === 'high'
          );
          if (criticalIssues.length > 0) {
            logger.error('Critical Drive API schema issues detected', {
              count: criticalIssues.length,
              issues: criticalIssues.map((issue) => issue.message),
              recommendation: driveValidation.recommendation,
            });
          }
        } else {
          logger.debug('Drive API schema validation passed');
        }
      } catch (error: unknown) {
        const err = error as { message?: string };
        logger.warn('Failed to validate Drive API schema', { error: err.message });
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.debug('Discovery API validation skipped', { reason: err.message });
    }
  }

  private async loadStoredTokens(): Promise<void> {
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      return;
    }

    let storedTokens: StoredTokens | null = null;
    if (this.tokenStore) {
      try {
        storedTokens = await this.tokenStore.load();
      } catch (error) {
        logger.warn('Failed to load token store', { error });
      }
    }

    const explicitTokens: StoredTokens = this.sanitizeTokens({
      ...(this.options.oauthTokens ?? {}),
      access_token: this.options.accessToken ?? this.options.oauthTokens?.access_token,
      refresh_token: this.options.refreshToken ?? this.options.oauthTokens?.refresh_token,
    });

    if (explicitTokens.access_token || explicitTokens.refresh_token) {
      this.auth.setCredentials(explicitTokens);
      if (this.tokenStore) {
        const merged = this.mergeTokens(storedTokens, explicitTokens);
        await this.safeSaveTokens(merged);
      }
      return;
    }

    if (storedTokens) {
      this.auth.setCredentials(storedTokens);
      // Restore scopes from stored tokens so incremental scope checks use granted scopes
      if (storedTokens.scope) {
        this._scopes = storedTokens.scope.split(' ');
      }
    }
  }

  private attachTokenListener(): void {
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2) || !this.tokenStore) {
      return;
    }

    // Remove existing listener if any
    if (this.tokenListener) {
      this.auth.off('tokens', this.tokenListener);
    }

    // Create and store the listener
    this.tokenListener = async (tokens: import('google-auth-library').Credentials) => {
      // Wrap in queue to prevent concurrent token refreshes
      await this.tokenRefreshQueue.add(async () => {
        const current = this.sanitizeTokens({
          ...(this.auth?.credentials ?? {}),
        } as Record<string, unknown>);
        const incoming = this.sanitizeTokens(tokens as Record<string, unknown>);
        const merged = this.mergeTokens(current, incoming);

        logger.debug('Token refresh triggered', {
          hasAccessToken: Boolean(merged.access_token),
          hasRefreshToken: Boolean(merged.refresh_token),
        });

        await this.safeSaveTokens(merged);

        // Invalidate validation cache when tokens are auto-refreshed
        this.lastValidationResult = undefined;
        this.lastValidationTime = undefined;

        // Reset HTTP agents to prevent GOAWAY errors
        const { env } = await import('../config/env.js');
        if (env.ENABLE_AUTO_CONNECTION_RESET) {
          await this.resetHttpAgents();
        }
      });
    };

    this.auth.on('tokens', this.tokenListener);
  }

  private sanitizeTokens(tokens: Record<string, unknown>): StoredTokens {
    const sanitized: StoredTokens = {};
    const allowedKeys: Array<keyof StoredTokens> = [
      'access_token',
      'refresh_token',
      'expiry_date',
      'token_type',
      'scope',
      'id_token',
    ];
    for (const key of allowedKeys) {
      const value = tokens[key as string];
      if (value !== null && value !== undefined) {
        sanitized[key] = value as never;
      }
    }
    return sanitized;
  }

  private mergeTokens(base: StoredTokens | null, updates: StoredTokens): StoredTokens {
    // For scope: prefer incoming scope, then current in-memory scopes (set by setScopes()),
    // then fall back to base scope. This ensures re-auth with broader scopes takes effect
    // even when Google's token response omits the scope field.
    const mergedScope =
      updates.scope ?? (this._scopes.length > 0 ? this._scopes.join(' ') : base?.scope);
    return {
      ...(base ?? {}),
      ...updates,
      access_token: updates.access_token ?? base?.access_token,
      refresh_token: updates.refresh_token ?? base?.refresh_token,
      expiry_date: updates.expiry_date ?? base?.expiry_date,
      token_type: updates.token_type ?? base?.token_type,
      scope: mergedScope,
      id_token: updates.id_token ?? base?.id_token,
    };
  }

  private async safeSaveTokens(tokens: StoredTokens): Promise<void> {
    if (!this.tokenStore) {
      logger.warn(
        'Token store not available - tokens will not persist across restarts. Set ENCRYPTION_KEY to enable token persistence.'
      );
      return;
    }
    try {
      await this.tokenStore.save(tokens);
    } catch (error) {
      logger.warn('Failed to save tokens', { error });
    }
  }

  /**
   * Initialize proactive token refresh manager
   */
  private initializeTokenManager(): void {
    // Only enable for OAuth2 clients with refresh tokens
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      return;
    }

    const credentials = this.auth.credentials;
    if (!credentials.refresh_token) {
      logger.debug('No refresh token available, skipping token manager initialization');
      return;
    }

    logger.info('Initializing proactive token manager');

    this.tokenManager = new TokenManager({
      oauthClient: this.auth,
      refreshThreshold: 0.8, // Refresh at 80% of token lifetime
      checkIntervalMs: 60000, // Check every 1 minute (reduced from 5min for faster recovery)
      onTokenRefreshed: async (tokens) => {
        logger.info('Token proactively refreshed by TokenManager');
        // Explicitly save tokens to prevent race with 'tokens' event listener
        const current = this.sanitizeTokens({
          ...(this.auth?.credentials ?? {}),
        } as Record<string, unknown>);
        const incoming = this.sanitizeTokens(tokens as Record<string, unknown>);
        const merged = this.mergeTokens(current, incoming);
        await this.safeSaveTokens(merged);
      },
      onRefreshError: (error) => {
        logger.error('Token refresh failed in TokenManager', {
          error: error.message,
        });
      },
    });

    this.tokenManager.start();
  }

  /**
   * Get Sheets API client
   */
  get sheets(): sheets_v4.Sheets {
    if (!this._sheets) {
      throw new ServiceError(
        'Google API client not initialized',
        'SERVICE_NOT_INITIALIZED',
        'GoogleAPI',
        false,
        { method: 'sheets', hint: 'Call initialize() first' }
      );
    }
    return this._sheets;
  }

  /**
   * Get Drive API client
   */
  get drive(): drive_v3.Drive {
    if (!this._drive) {
      throw new ServiceError(
        'Google API client not initialized',
        'SERVICE_NOT_INITIALIZED',
        'GoogleAPI',
        false,
        { method: 'drive', hint: 'Call initialize() first' }
      );
    }
    return this._drive;
  }

  /**
   * Get Drive Labels API client (optional, returns null if not initialized)
   */
  get driveLabels(): drivelabels_v2.Drivelabels | null {
    return this._driveLabels;
  }

  /**
   * Get BigQuery API client
   * Returns null if BigQuery is not configured (optional API)
   */
  get bigquery(): bigquery_v2.Bigquery | null {
    return this._bigquery;
  }

  /**
   * Get Docs API client (optional, returns null if not initialized)
   */
  get docs(): docs_v1.Docs | null {
    return this._docs;
  }

  /**
   * Get Slides API client (optional, returns null if not initialized)
   */
  get slides(): slides_v1.Slides | null {
    return this._slides;
  }

  /**
   * Get Drive Activity API client (optional, returns null if not initialized)
   */
  get driveActivity(): driveactivity_v2.Driveactivity | null {
    return this._driveActivity;
  }

  /**
   * Get Workspace Events API client (optional, returns null if not initialized)
   */
  get workspaceEvents(): workspaceevents_v1.Workspaceevents | null {
    return this._workspaceEvents;
  }

  /**
   * Get OAuth2 client for token management
   */
  get oauth2(): OAuth2Client {
    if (!this.auth) {
      throw new ServiceError(
        'Google API client not initialized',
        'SERVICE_NOT_INITIALIZED',
        'GoogleAPI',
        false,
        { method: 'oauth2', hint: 'Call initialize() first' }
      );
    }
    return this.auth;
  }

  /**
   * Get current scopes
   */
  get scopes(): string[] {
    return [...this._scopes];
  }

  /**
   * Update the active scopes (called after OAuth login with granted scopes)
   */
  setScopes(scopes: string[]): void {
    this._scopes = [...scopes];
  }

  /**
   * Get authentication type
   */
  get authType(): GoogleAuthType {
    return this._authType;
  }

  /**
   * Get token status for OAuth-based auth
   */
  getTokenStatus(): {
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    expiryDate?: number;
    scope?: string;
  } {
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      return {
        hasAccessToken: false,
        hasRefreshToken: false,
      };
    }

    const { access_token, refresh_token, expiry_date, scope } = this.auth.credentials;
    return {
      hasAccessToken: Boolean(access_token),
      hasRefreshToken: Boolean(refresh_token),
      expiryDate: typeof expiry_date === 'number' ? expiry_date : undefined,
      scope,
    };
  }

  /**
   * Validate that OAuth tokens are valid by making a lightweight API call
   * Returns both validity status and any error message
   */
  async validateToken(): Promise<{
    valid: boolean;
    error?: string;
  }> {
    // Only validate OAuth tokens (not service account or ADC)
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      return { valid: false, error: 'No OAuth client configured' };
    }

    const status = this.getTokenStatus();
    if (!status.hasAccessToken && !status.hasRefreshToken) {
      return { valid: false, error: 'No tokens present' };
    }

    // Fast path: Check expiry date first (no API call needed!)
    const now = Date.now();
    if (status.expiryDate && status.expiryDate > now) {
      logger.debug('Token valid based on expiry date', {
        expiresIn: Math.round((status.expiryDate - now) / 1000),
      });
      return { valid: true };
    }

    // Return cached validation result if still fresh (5 minute TTL)
    if (
      this.lastValidationResult &&
      this.lastValidationTime &&
      now - this.lastValidationTime < GoogleApiClient.VALIDATION_CACHE_TTL_MS
    ) {
      logger.debug('Using cached token validation result', {
        age: Math.round((now - this.lastValidationTime) / 1000),
        valid: this.lastValidationResult.valid,
      });
      return this.lastValidationResult;
    }

    try {
      // Make lightweight API call to validate token (only if expiry unknown)
      // Use tokeninfo instead of userinfo.get() - works without openid scope
      const oauth2 = google.oauth2({ version: 'v2', auth: this.auth });
      await oauth2.tokeninfo({ access_token: this.auth.credentials.access_token ?? undefined });

      // Cache the successful result
      this.lastValidationResult = { valid: true };
      this.lastValidationTime = now;

      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug('Token validation failed', { error: errorMessage });

      const result = {
        valid: false,
        error: errorMessage,
      };

      // Cache the failed result
      this.lastValidationResult = result;
      this.lastValidationTime = now;

      return result;
    }
  }

  /**
   * Check if elevated access is available
   */
  get hasElevatedAccess(): boolean {
    return this._scopes.includes('https://www.googleapis.com/auth/drive');
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitBreakerState(): 'closed' | 'open' | 'half_open' {
    return this.sheetsCircuit.getStats().state;
  }

  /**
   * Generate OAuth2 authorization URL
   */
  getAuthUrl(additionalScopes?: string[]): string {
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      throw new ServiceError('OAuth2 client not configured', 'AUTH_ERROR', 'GoogleAPI', false, {
        method: 'getAuthUrl',
        hint: 'Provide OAuth client credentials',
      });
    }
    const scopes = additionalScopes
      ? [...new Set([...this._scopes, ...additionalScopes])]
      : this._scopes;

    return this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent', // Force consent to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getToken(code: string): Promise<{ accessToken: string; refreshToken?: string }> {
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      throw new ServiceError('OAuth2 client not configured', 'AUTH_ERROR', 'GoogleAPI', false, {
        method: 'getToken',
        hint: 'Provide OAuth client credentials',
      });
    }
    const { tokens } = await this.auth.getToken(code);
    this.auth.setCredentials(tokens);
    await this.safeSaveTokens(this.sanitizeTokens(tokens as Record<string, unknown>));
    const result: { accessToken: string; refreshToken?: string } = {
      accessToken: tokens.access_token ?? '',
    };
    if (tokens.refresh_token) {
      result.refreshToken = tokens.refresh_token;
    }
    return result;
  }

  /**
   * Update credentials
   * IMPORTANT: Preserves existing refresh_token if not provided to enable auto-refresh
   */
  setCredentials(accessToken: string, refreshToken?: string): void {
    if (!this.auth || !(this.auth instanceof google.auth.OAuth2)) {
      throw new ServiceError('OAuth2 client not configured', 'AUTH_ERROR', 'GoogleAPI', false, {
        method: 'setCredentials',
        hint: 'Provide OAuth client credentials',
      });
    }

    // CRITICAL FIX: Preserve existing refresh_token if not provided
    // This enables google-auth-library to auto-refresh expired access tokens
    const existingCredentials = this.auth.credentials;
    const effectiveRefreshToken = refreshToken ?? existingCredentials.refresh_token;

    const tokens: StoredTokens = this.sanitizeTokens({
      access_token: accessToken,
      refresh_token: effectiveRefreshToken,
    });
    this.auth.setCredentials(tokens);
    // Queue token save via the token refresh queue to ensure serialized persistence
    // without blocking the synchronous setCredentials call.
    // Previously used fire-and-forget `void` which could lose tokens between calls.
    this.tokenRefreshQueue
      .add(async () => {
        await this.safeSaveTokens(tokens);
      })
      .catch((error) => {
        logger.warn('Failed to queue token save in setCredentials', { error });
      });

    // Invalidate validation cache when credentials change
    this.lastValidationResult = undefined;
    this.lastValidationTime = undefined;

    // Reset HTTP agents to prevent GOAWAY errors (fire-and-forget)
    void (async () => {
      const { env } = await import('../config/env.js');
      if (env.ENABLE_AUTO_CONNECTION_RESET) {
        await this.resetHttpAgents();
      }
    })();

    logger.debug('Credentials updated and HTTP agents reset', {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(effectiveRefreshToken),
      preservedExistingRefresh: !refreshToken && Boolean(existingCredentials.refresh_token),
    });
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.auth !== null && this._sheets !== null;
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitStats(): unknown {
    return {
      sheets: this.sheetsCircuit.getStats(),
      drive: this.driveCircuit.getStats(),
      bigquery: this.bigqueryCircuit.getStats(),
    };
  }

  /**
   * Set up HTTP/2 connection pool monitoring
   * Logs connection pool statistics at regular intervals
   * Controlled by ENABLE_HTTP2_POOL_MONITORING environment variable
   */
  private setupConnectionPoolMonitoring(): void {
    const enableMonitoring = process.env['ENABLE_HTTP2_POOL_MONITORING'] === 'true';

    if (!enableMonitoring) {
      return;
    }

    // Monitor every 5 minutes by default
    const intervalMs = parseInt(process.env['HTTP2_POOL_MONITOR_INTERVAL_MS'] || '300000', 10);

    this.poolMonitorInterval = setInterval(() => {
      this.logConnectionPoolStats();
    }, intervalMs);

    // Register cleanup to prevent memory leak
    registerCleanup(
      'GoogleApiClient',
      () => {
        if (this.poolMonitorInterval) {
          clearInterval(this.poolMonitorInterval);
        }
      },
      'pool-monitor-interval'
    );

    logger.info('HTTP/2 connection pool monitoring enabled', {
      intervalMs,
      intervalMin: Math.round(intervalMs / 60000),
    });
  }

  /**
   * Log HTTP/2 connection pool statistics
   * Provides visibility into connection reuse and pool utilization
   */
  private logConnectionPoolStats(): void {
    const httpsAgent = this.httpAgents.https;

    // Count active and free sockets
    const activeSockets =
      Object.keys((httpsAgent.sockets as Record<string, unknown>) || {}).length || 0;
    const freeSockets =
      Object.keys((httpsAgent.freeSockets as Record<string, unknown>) || {}).length || 0;
    const pendingRequests =
      Object.keys((httpsAgent.requests as Record<string, unknown>) || {}).length || 0;

    // Get max sockets from environment
    const maxSockets = parseInt(process.env['GOOGLE_API_MAX_SOCKETS'] || '50', 10);

    // Calculate utilization percentage
    const utilizationPercent = ((activeSockets / maxSockets) * 100).toFixed(1);

    const stats = {
      active_sockets: activeSockets,
      free_sockets: freeSockets,
      pending_requests: pendingRequests,
      max_sockets: maxSockets,
      utilization_percent: parseFloat(utilizationPercent),
      total_available: activeSockets + freeSockets,
    };

    logger.info('HTTP/2 connection pool statistics', stats);

    // Warn if pool is at or near capacity
    if (activeSockets >= maxSockets) {
      logger.warn('HTTP/2 connection pool at max capacity', {
        ...stats,
        recommendation: 'Consider increasing GOOGLE_API_MAX_SOCKETS environment variable',
      });
    } else if (activeSockets >= maxSockets * 0.8) {
      logger.warn('HTTP/2 connection pool utilization high (>80%)', {
        ...stats,
        recommendation: 'Monitor for performance degradation; consider increasing pool size',
      });
    }
  }

  /**
   * Get current HTTP/2 connection pool statistics
   * Returns current state without logging
   */
  getConnectionPoolStats(): {
    activeSockets: number;
    freeSockets: number;
    pendingRequests: number;
    maxSockets: number;
    utilizationPercent: number;
  } {
    const httpsAgent = this.httpAgents.https;

    const activeSockets =
      Object.keys((httpsAgent.sockets as Record<string, unknown>) || {}).length || 0;
    const freeSockets =
      Object.keys((httpsAgent.freeSockets as Record<string, unknown>) || {}).length || 0;
    const pendingRequests =
      Object.keys((httpsAgent.requests as Record<string, unknown>) || {}).length || 0;
    const maxSockets = parseInt(process.env['GOOGLE_API_MAX_SOCKETS'] || '50', 10);

    return {
      activeSockets,
      freeSockets,
      pendingRequests,
      maxSockets,
      utilizationPercent: parseFloat(((activeSockets / maxSockets) * 100).toFixed(1)),
    };
  }

  /**
   * Log scope usage for audit trail
   * Particularly important for elevated scope operations
   */
  logScopeUsage(operation: string, resourceId?: string): void {
    if (this.hasElevatedAccess) {
      logger.info('Elevated scope operation', {
        operation,
        resourceId,
        scopes: this._scopes,
        category: 'audit',
      });
    }
  }

  /**
   * Revoke access tokens
   */
  async revokeAccess(): Promise<void> {
    if (!this.auth) {
      throw new ServiceError(
        'Google API client not initialized',
        'SERVICE_NOT_INITIALIZED',
        'GoogleAPI',
        false,
        { method: 'revokeAccess', hint: 'Call initialize() first' }
      );
    }
    const credentials = this.auth.credentials;
    const tokenToRevoke = credentials.refresh_token ?? credentials.access_token;
    if (tokenToRevoke) {
      await this.auth.revokeToken(tokenToRevoke);
      this.auth.setCredentials({});
    }
  }

  /**
   * Clear stored tokens and in-memory credentials
   */
  async clearStoredTokens(): Promise<void> {
    if (this.tokenStore) {
      try {
        await this.tokenStore.clear();
      } catch (error) {
        logger.warn('Failed to clear token store', { error });
      }
    }

    if (this.auth && this.auth instanceof google.auth.OAuth2) {
      this.auth.setCredentials({});
    }
  }

  /**
   * Wait for Shared Drive write token before issuing write operations.
   */
  async waitForSharedDriveWriteToken(): Promise<number> {
    return this.sharedDriveRateLimiter.waitForToken();
  }

  /**
   * Get cached shared drive membership with TTL expiration check
   */
  private getSharedDriveMembership(driveId: string): boolean | undefined {
    const entry = this.sharedDriveMembershipCache.get(driveId);
    if (!entry) return undefined;
    // Check if TTL has expired
    if (Date.now() - entry.timestamp > GoogleApiClient.DRIVE_CACHE_TTL_MS) {
      this.sharedDriveMembershipCache.delete(driveId);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Set cached shared drive membership with LRU eviction at max size
   */
  private setSharedDriveMembership(driveId: string, value: boolean): void {
    // Evict oldest entry if at max capacity
    if (this.sharedDriveMembershipCache.size >= GoogleApiClient.DRIVE_CACHE_MAX) {
      const oldestKey = this.sharedDriveMembershipCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.sharedDriveMembershipCache.delete(oldestKey);
      }
    }
    this.sharedDriveMembershipCache.set(driveId, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Resolve whether a Drive file belongs to a shared drive using documented
   * Drive API metadata rather than file ID heuristics.
   */
  async isSharedDriveFile(fileId: string | undefined): Promise<boolean> {
    if (!fileId || !this._drive) {
      return false;
    }

    const cached = this.getSharedDriveMembership(fileId);
    if (typeof cached === 'boolean') {
      return cached;
    }

    try {
      const response = await this._drive.files.get({
        fileId,
        fields: 'driveId',
        supportsAllDrives: true,
      });
      const isSharedDrive = Boolean(response.data.driveId);
      this.setSharedDriveMembership(fileId, isSharedDrive);
      return isSharedDrive;
    } catch (error) {
      logger.debug('Failed to resolve shared-drive membership for Drive file', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Cleanup resources and remove event listeners
   * Prevents memory leaks from accumulating listeners
   */
  destroy(): void {
    // Stop connection pool monitoring
    if (this.poolMonitorInterval) {
      clearInterval(this.poolMonitorInterval);
      this.poolMonitorInterval = undefined;
    }

    // Stop keepalive interval
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = undefined;
    }

    this.sharedDriveMembershipCache.clear();

    // Stop token manager
    if (this.tokenManager) {
      this.tokenManager.stop();
      this.tokenManager = undefined;
    }

    // Remove token listener to prevent memory leak
    if (this.auth && this.tokenListener && this.auth instanceof google.auth.OAuth2) {
      this.auth.off('tokens', this.tokenListener);
      this.tokenListener = undefined;
    }

    // Destroy HTTP agents to close persistent connections
    this.httpAgents.http.destroy();
    this.httpAgents.https.destroy();

    // Clear auth and API clients
    this.auth = null;
    this._sheets = null;
    this._drive = null;

    logger.info('Google API client destroyed');
  }
}

/**
 * Create and initialize a Google API client
 */
export async function createGoogleApiClient(
  options: GoogleApiClientOptions = {}
): Promise<GoogleApiClient> {
  const client = new GoogleApiClient(options);
  await client.initialize();
  return client;
}

function wrapGoogleApi<T extends object>(
  api: T,
  options?: RetryOptions & {
    circuit?: ICircuitBreaker;
    client?: GoogleApiClient;
    /** Called before write operations to fast-fail on unknown spreadsheetIds (Fix B). */
    existenceChecker?: (spreadsheetId: string) => Promise<void>;
  }
): T {
  const cache = new WeakMap<object, unknown>();
  const circuit = options?.circuit;
  const client = options?.client;

  const wrapObject = (obj: object): unknown => {
    if (cache.has(obj)) {
      return cache.get(obj);
    }

    const proxy = new Proxy(obj, {
      get(target, prop, receiver) {
        // Get property descriptor to check invariants
        const descriptor = Object.getOwnPropertyDescriptor(target, prop);

        // CRITICAL: For non-configurable, non-writable data properties,
        // we MUST return the exact target value (proxy invariant requirement).
        // We cannot wrap these - JavaScript enforces this strictly.
        if (
          descriptor &&
          !descriptor.configurable &&
          !descriptor.writable &&
          'value' in descriptor
        ) {
          // Return exact value - do NOT wrap, even for objects
          return descriptor.value;
        }

        const value = Reflect.get(target, prop, receiver);

        if (typeof value === 'function') {
          return async (...args: unknown[]) => {
            try {
              // Auto-inject default field masks for read operations (Fix 1)
              // Reduces response payload by 30-70% on unmasked calls
              const methodName = String(prop);
              let params: Record<string, unknown> | null = null;
              if (args.length > 0 && args[0] && typeof args[0] === 'object') {
                params = args[0] as Record<string, unknown>;
                if (params['spreadsheetId'] && !params['fields']) {
                  if (methodName === 'get' && params['range']) {
                    // values.get — only need range + values
                    params['fields'] = 'range,values,majorDimension';
                  } else if (methodName === 'get' && params['ranges']) {
                    // values.batchGet — only need ranges + values
                    params['fields'] = 'spreadsheetId,valueRanges(range,values,majorDimension)';
                  }
                }
              }

              // Apply Shared Drive write rate limiting (non-blocking for reads)
              if (client && params) {
                const isWriteOp =
                  methodName === 'batchUpdate' ||
                  methodName === 'update' ||
                  methodName === 'create' ||
                  methodName === 'delete';
                const sharedDriveFileId =
                  typeof params['spreadsheetId'] === 'string' ? params['spreadsheetId'] : undefined;

                // Fast-fail on unknown spreadsheetId before consuming quota (Fix B).
                // Uses raw (pre-wrap) sheets API; cached 5 min to avoid redundant probes.
                if (isWriteOp && sharedDriveFileId && options?.existenceChecker) {
                  await options.existenceChecker(sharedDriveFileId);
                }

                if (isWriteOp && (await client.isSharedDriveFile(sharedDriveFileId))) {
                  const waitMs = await client.waitForSharedDriveWriteToken();
                  if (waitMs > 0) {
                    logger.debug('Shared Drive write rate limit applied', {
                      spreadsheetId: sharedDriveFileId,
                      waitedMs: waitMs,
                    });
                  }
                }

                // Per-spreadsheet request throttle — enforces PER_SPREADSHEET_RPS
                // to follow Google's guidance of limiting concurrent requests per
                // spreadsheet and avoid 503 quota-exceeded responses.
                if (sharedDriveFileId) {
                  await perSpreadsheetThrottle.throttle(sharedDriveFileId);
                }
              }

              const retryOptions = {
                ...options,
                // Reset HTTP/2 connections on GOAWAY errors before retrying
                onRetry: client
                  ? async (error: unknown) => {
                      const msg =
                        error instanceof Error ? error.message.toLowerCase() : String(error);
                      const code = (error as { code?: string })?.code ?? '';
                      const status = (error as { response?: { status?: number } })?.response
                        ?.status;
                      if (
                        code === 'ERR_HTTP2_GOAWAY_SESSION' ||
                        msg.includes('goaway') ||
                        msg.includes('new streams cannot be created')
                      ) {
                        await client.resetOnConnectionError();
                      }
                      // Reactively refresh token on 401 auth errors
                      if (status === 401) {
                        await client.refreshTokenOnAuthError();
                      }
                    }
                  : undefined,
              };
              const operation = (): Promise<unknown> =>
                executeWithRetry((signal) => {
                  const callArgs = injectSignal(args, signal);
                  return (value as (...params: unknown[]) => Promise<unknown>).apply(
                    target,
                    callArgs
                  );
                }, retryOptions);

              // Wrap with circuit breaker if available
              const result = circuit ? await circuit.execute(operation) : await operation();

              // Track successful API call (connection health + per-request counter)
              client?.recordCallResult(true);
              const ctx = getRequestContext();
              if (ctx) {
                ctx.apiCallsMade++;
              }

              return result;
            } catch (error) {
              // Track failed API call (connection health + per-request counter)
              client?.recordCallResult(false);
              const ctx = getRequestContext();
              if (ctx) {
                ctx.apiCallsMade++;
              }
              throw error;
            }
          };
        }

        // For configurable properties that are objects, we can wrap them
        if (value && typeof value === 'object') {
          return wrapObject(value as object);
        }

        return value;
      },
    });

    cache.set(obj, proxy);
    return proxy;
  };

  return wrapObject(api) as T;
}

function injectSignal(args: unknown[], signal: AbortSignal): unknown[] {
  // Get request context for trace propagation
  const ctx = getRequestContext();
  const requestId = ctx?.requestId;

  // Build base headers with request ID and W3C Trace Context
  const headers: Record<string, string> = {};
  if (requestId) {
    headers['x-request-id'] = requestId;
  }

  // Add W3C Trace Context (traceparent header)
  // Format: version-traceId-parentId-flags
  if (ctx?.traceId && ctx?.spanId) {
    headers['traceparent'] = `00-${ctx.traceId}-${ctx.spanId}-01`;
  }

  // Build base options with signal and headers
  const baseOptions: Record<string, unknown> = { signal };
  if (Object.keys(headers).length > 0) {
    baseOptions['headers'] = headers;
  }

  if (args.length === 0) {
    return [baseOptions];
  }

  const last = args[args.length - 1];
  if (typeof last === 'function') {
    return args;
  }

  if (last && typeof last === 'object' && !Array.isArray(last)) {
    const updated: Record<string, unknown> = {
      ...(last as Record<string, unknown>),
      signal,
    };

    // Merge headers if they exist
    if (Object.keys(headers).length > 0) {
      updated['headers'] = {
        ...((updated['headers'] as Record<string, unknown>) ?? {}),
        ...headers,
      };
    }

    return [...args.slice(0, -1), updated];
  }

  return [...args, baseOptions];
}
