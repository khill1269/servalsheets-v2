/**
 * ServalSheets - OAuth Provider
 *
 * MCP-level OAuth for Claude Connectors Directory
 * Handles OAuth 2.1 flow for authenticating Claude to our server
 * MCP Protocol: 2025-11-25
 *
 * SECURITY: PKCE (Proof Key for Code Exchange) is REQUIRED for all authorization flows.
 * Only S256 code challenge method is supported.
 * This follows OAuth 2.1 security best practices.
 */

import express, { Request, Response, NextFunction } from 'express';
import { ConfigError, ServiceError } from './core/errors.js';
import jwt from 'jsonwebtoken';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { SessionStore, createSessionStore } from './storage/session-store.js';
import { getSessionStoreConfig, getApiSpecificCircuitBreakerConfig, env } from './config/env.js';
import { logger } from './utils/logger.js';
import { CircuitBreaker } from './utils/circuit-breaker.js';
import { circuitBreakerRegistry } from './services/circuit-breaker-registry.js';
import { VERSION, SERVER_ICONS } from './version.js';
import { getRecommendedScopes, formatScopesForAuth } from './config/oauth-scopes.js';
import { registerCleanup } from './utils/resource-cleanup.js';

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

/**
 * PKCE (Proof Key for Code Exchange) is REQUIRED for all authorization flows.
 * This is enforced at runtime - all requests must include code_challenge.
 * OAuth 2.1 security best practice.
 */
export const PKCE_REQUIRED = true;

/**
 * Only S256 code challenge method is supported.
 * Plain method is insecure and explicitly rejected.
 */
export const CODE_CHALLENGE_METHOD = 'S256';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface OAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
  jwtSecretPrevious?: string; // Previous JWT secret for rotation (optional)
  stateSecret: string; // HMAC secret for state tokens
  allowedRedirectUris: string[]; // Allowlist of redirect URIs
  accessTokenTtl?: number; // seconds
  refreshTokenTtl?: number; // seconds
  googleClientId?: string;
  googleClientSecret?: string;
  sessionStore?: SessionStore; // Optional session store (defaults to in-memory)
  resourceIndicator?: string | undefined; // RFC 8707 audience claim (optional, defaults to clientId)
}

interface TokenPayload {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  scope: string;
  // SECURITY: Google tokens are NEVER included in JWT payload.
  // They are stored server-side in the session store (see google_tokens:{userId}).
}

interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string; // Now required (PKCE enforced)
  codeChallengeMethod: string; // Now required (PKCE enforced)
  googleAccessToken: string | undefined;
  googleRefreshToken: string | undefined;
  expiresAt: number;
}

interface RefreshTokenData {
  userId: string;
  clientId: string;
  scope: string;
  googleRefreshToken?: string;
  expiresAt: number;
}

interface StateData {
  originalState: string | undefined;
  redirectUri: string;
  scope: string | undefined;
  codeChallenge: string | undefined;
  codeChallengeMethod: string | undefined;
  // clientId is carried through Google OAuth state so the callback knows which
  // MCP client initiated the request (required for confused deputy prevention).
  clientId: string;
}

interface DcrClientData {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  scope: string;
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
  created_at: string;
}

interface ConsentRecord {
  clientName: string;
  grantedAt: number;
  redirectUris: string[];
}

/**
 * Supported OAuth scopes
 */
const SUPPORTED_SCOPES = ['sheets:read', 'sheets:write', 'sheets:admin'] as const;
type SupportedScope = (typeof SUPPORTED_SCOPES)[number];

/**
 * OAuth 2.1 Provider for MCP authentication
 */
export class OAuthProvider {
  private config: Required<Omit<OAuthConfig, 'sessionStore' | 'jwtSecretPrevious' | 'resourceIndicator'>> & {
    resourceIndicator?: string;
    sessionStore?: SessionStore;
    jwtSecretPrevious?: string;
  };
  private sessionStore: SessionStore;
  private cleanupInterval: NodeJS.Timeout;
  private jwtSecrets: string[]; // Active JWT secrets (primary + previous)
  private oauthCircuit: CircuitBreaker;

  constructor(config: OAuthConfig) {
    this.config = {
      accessTokenTtl: 3600, // 1 hour
      refreshTokenTtl: 2592000, // 30 days
      googleClientId: '',
      googleClientSecret: '',
      ...config,
    };

    // ✅ SECURITY: Enforce max OAuth token TTL (default 30 minutes)
    const maxTokenTtl = env.OAUTH_MAX_TOKEN_TTL;
    if (this.config.accessTokenTtl > maxTokenTtl) {
      logger.warn('OAuth access token TTL exceeds max allowed, capping to max', {
        requested: this.config.accessTokenTtl,
        maxAllowed: maxTokenTtl,
        capped: maxTokenTtl,
      });
      this.config.accessTokenTtl = maxTokenTtl;
    }

    // Initialize JWT secrets array (primary + previous for rotation)
    this.jwtSecrets = [config.jwtSecret];
    if (config.jwtSecretPrevious) {
      this.jwtSecrets.push(config.jwtSecretPrevious);
      logger.info('JWT secret rotation enabled', {
        activeSecrets: this.jwtSecrets.length,
      });
    }

    // Initialize circuit breaker for OAuth token exchanges
    const oauthConfig = getApiSpecificCircuitBreakerConfig('oauth');
    this.oauthCircuit = new CircuitBreaker({
      failureThreshold: oauthConfig.failureThreshold,
      successThreshold: oauthConfig.successThreshold,
      timeout: oauthConfig.timeout,
      name: 'google-oauth',
    });

    // Register circuit breaker for monitoring
    circuitBreakerRegistry.register(
      'google-oauth',
      this.oauthCircuit,
      'OAuth token exchange circuit breaker'
    );

    // ✅ SECURITY: Validate production requirements
    const isProduction = process.env['NODE_ENV'] === 'production';
    if (isProduction && !config.sessionStore && !process.env['REDIS_URL']) {
      throw new ConfigError(
        'Redis session store required in production (REDIS_URL not set). ' +
          'In-memory session store does not support multiple instances or persist across restarts.',
        'REDIS_URL'
      );
    }

    // Initialize session store based on environment configuration
    if (config.sessionStore) {
      // Use provided session store (for testing or custom implementations)
      this.sessionStore = config.sessionStore;
    } else {
      // Use environment-configured session store
      try {
        const storeConfig = getSessionStoreConfig();
        this.sessionStore = createSessionStore(storeConfig.redisUrl);
      } catch (error) {
        // If config validation fails, fall back to in-memory (development only)
        // Production validation in lifecycle.ts will catch this earlier
        if (isProduction) {
          throw new ServiceError(
            `Failed to initialize session store in production: ${error}`,
            'INTERNAL_ERROR',
            'oauth-provider',
            false
          );
        }
        logger.warn('[OAuthProvider] Session store config error, using in-memory', { error });
        this.sessionStore = createSessionStore();
      }
    }

    if (isProduction && !config.sessionStore) {
      logger.info('Production mode: Using Redis session store', {
        redisConfigured: !!process.env['REDIS_URL'],
      });
    } else if (!isProduction) {
      logger.warn(
        '⚠️  Development mode: Using in-memory session store (not suitable for production)'
      );
    }

    // Start cleanup task for expired entries
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000); // Every minute

    // Register cleanup to prevent memory leak
    registerCleanup(
      'OAuthProvider',
      () => {
        clearInterval(this.cleanupInterval);
      },
      'oauth-cleanup-interval'
    );
  }

  /**
   * Clean up expired entries (delegated to session store)
   */
  private async cleanupExpired(): Promise<void> {
    await this.sessionStore.cleanup();
  }

  /**
   * Destroy the provider and clean up resources
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Validate redirect URI against allowlist
   * HIGH-002 FIX: Use URL parsing instead of string matching to prevent open redirect
   *
   * Security: Validates origin and pathname separately to prevent:
   * - Fragment injection (e.g., http://localhost:3000/callback#evil.com)
   * - Query parameter injection (e.g., http://localhost:3000/callback?redirect=evil.com)
   * - Path traversal attacks
   */
  private validateRedirectUri(uri: string): boolean {
    try {
      const url = new URL(uri);

      return this.config.allowedRedirectUris.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed);

          // Must match origin (protocol + host + port) AND pathname exactly
          // Query parameters are allowed to vary (OAuth state, etc.)
          // Fragments are allowed but origin/pathname must still match
          return url.origin === allowedUrl.origin && url.pathname === allowedUrl.pathname;
        } catch {
          // If allowed URI is invalid, skip it
          return false;
        }
      });
    } catch {
      // If provided URI is invalid URL, reject it
      return false;
    }
  }

  /**
   * Validate and normalize requested scopes
   * Returns normalized scope string or null if invalid
   */
  private validateScope(requestedScope: string | undefined): {
    valid: boolean;
    scope?: string;
    error?: string;
  } {
    // Default to sheets:read if no scope provided
    if (!requestedScope) {
      return { valid: true, scope: 'sheets:read' };
    }

    // Parse requested scopes (space-separated)
    const scopes = requestedScope.split(' ').filter((s) => s.length > 0);

    // Validate each scope
    for (const scope of scopes) {
      if (!SUPPORTED_SCOPES.includes(scope as SupportedScope)) {
        return {
          valid: false,
          error: `Invalid scope '${scope}'. Supported scopes: ${SUPPORTED_SCOPES.join(', ')}`,
        };
      }
    }

    // If multiple scopes requested, use the highest one (most permissive)
    // Admin > Write > Read
    if (scopes.includes('sheets:admin')) {
      return { valid: true, scope: 'sheets:admin' };
    }
    if (scopes.includes('sheets:write')) {
      return { valid: true, scope: 'sheets:write' };
    }
    if (scopes.includes('sheets:read')) {
      return { valid: true, scope: 'sheets:read' };
    }

    // Shouldn't reach here, but fallback to read
    return { valid: true, scope: 'sheets:read' };
  }

  // ============================================================================
  // CONFUSED DEPUTY PROTECTION (MCP Security Best Practices)
  // ============================================================================

  /**
   * Look up a dynamically registered client from the session store.
   * Returns null if the client is not found (unknown / expired registration).
   */
  private async lookupDcrClient(clientId: string): Promise<DcrClientData | null> {
    const data = await this.sessionStore.get(`dcr:${clientId}`);
    return data ? (data as DcrClientData) : null;
  }

  /**
   * Session store key for per-client consent records.
   * Confused deputy mitigation: every DCR client must have an explicit consent
   * record before it can initiate the authorization flow. This prevents an
   * attacker who registers a malicious client from exploiting an existing
   * consent cookie at the third-party authorization server.
   */
  private consentKey(clientId: string): string {
    return `mcp_consent:${clientId}`;
  }

  private async hasDcrConsent(clientId: string): Promise<boolean> {
    const record = await this.sessionStore.get(this.consentKey(clientId));
    return record !== null && record !== undefined;
  }

  /**
   * Grant consent for a DCR client. Called automatically at registration time.
   * TTL matches the client registration lifetime (1 year).
   */
  private async grantDcrConsent(
    clientId: string,
    clientName: string,
    redirectUris: string[]
  ): Promise<void> {
    const record: ConsentRecord = {
      clientName,
      grantedAt: Date.now(),
      redirectUris,
    };
    await this.sessionStore.set(this.consentKey(clientId), record, 365 * 24 * 60 * 60);
    logger.info('DCR client consent granted', { clientId, clientName });
  }

  /**
   * Revoke consent for a DCR client. Can be called by an admin to block a client.
   */
  async revokeDcrConsent(clientId: string): Promise<void> {
    await this.sessionStore.delete(this.consentKey(clientId));
    logger.info('DCR client consent revoked', { clientId });
  }

  /**
   * Create Express router for OAuth endpoints
   */
  createRouter(): express.Router {
    const router = express.Router();
    const isTestEnv = process.env['NODE_ENV'] === 'test';

    // Rate limiter for OAuth endpoints
    const oauthLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 10, // 10 requests per minute per IP
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('OAuth rate limit exceeded', {
          ip: req.ip,
          path: req.path,
        });
        res.status(429).json({
          error: 'too_many_requests',
          error_description: 'Too many OAuth requests. Try again in 1 minute.',
        });
      },
    });

    // Apply rate limiting to OAuth endpoints (skip in tests)
    if (!isTestEnv) {
      router.use('/oauth', oauthLimiter);
    }

    // OAuth 2.0 Authorization Server Metadata (RFC 8414)
    router.get('/.well-known/oauth-authorization-server', (_req, res) => {
      res.json({
        issuer: this.config.issuer,
        authorization_endpoint: `${this.config.issuer}/oauth/authorize`,
        token_endpoint: `${this.config.issuer}/oauth/token`,
        revocation_endpoint: `${this.config.issuer}/oauth/revoke`,
        introspection_endpoint: `${this.config.issuer}/oauth/introspect`,
        registration_endpoint: `${this.config.issuer}/oauth/register`, // RFC 7591 DCR
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        scopes_supported: ['sheets:read', 'sheets:write', 'sheets:admin'],
      });
    });

    // MCP Server Metadata
    router.get('/.well-known/mcp.json', (_req, res) => {
      res.json({
        name: 'servalsheets',
        version: VERSION,
        description: 'Production-grade Google Sheets MCP server',
        icons: SERVER_ICONS,
        oauth: {
          authorization_endpoint: `${this.config.issuer}/oauth/authorize`,
          token_endpoint: `${this.config.issuer}/oauth/token`,
          scopes: {
            'sheets:read': 'Read spreadsheet data',
            'sheets:write': 'Read and write spreadsheet data',
            'sheets:admin': 'Full access including sharing and permissions',
          },
        },
      });
    });

    // Authorization endpoint
    router.get('/oauth/authorize', async (req, res) => {
      const {
        client_id,
        redirect_uri,
        response_type,
        scope,
        state,
        code_challenge,
        code_challenge_method,
      } = req.query as Record<string, string | undefined>;

      // Validate request
      if (response_type !== 'code') {
        res.status(400).json({ error: 'unsupported_response_type' });
        return;
      }

      if (!redirect_uri) {
        res
          .status(400)
          .json({ error: 'invalid_request', error_description: 'redirect_uri required' });
        return;
      }

      // Validate client identity.
      // Static client (configured via clientId): uses the global redirect URI allowlist.
      // DCR clients (dcr_* prefix): must be registered, must have consent, and redirect_uri
      //   must match their registration (confused deputy protection — per MCP Security Best
      //   Practices, all DCR clients require explicit per-client consent before the proxy
      //   forwards them to the third-party authorization server).
      let resolvedClientId = client_id ?? '';
      if (client_id === this.config.clientId) {
        // Static pre-configured client — validate against global allowlist
        if (!this.validateRedirectUri(redirect_uri)) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'redirect_uri not in allowlist',
          });
          return;
        }
      } else {
        // Attempt DCR client lookup
        const dcrClient = client_id ? await this.lookupDcrClient(client_id) : null;
        if (!dcrClient) {
          res.status(400).json({ error: 'invalid_client' });
          return;
        }

        // Validate redirect_uri against the client's registered URIs (exact match required)
        if (!dcrClient.redirect_uris.includes(redirect_uri)) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'redirect_uri not registered for this client',
          });
          return;
        }

        // ✅ CONFUSED DEPUTY PROTECTION: check per-client consent before forwarding to Google.
        // Without this check, an attacker who registers a DCR client with a malicious
        // redirect_uri could exploit an existing Google consent cookie and redirect the
        // authorization code to their server. Consent is granted at DCR registration time.
        const hasConsent = await this.hasDcrConsent(client_id!);
        if (!hasConsent) {
          res.status(403).json({
            error: 'consent_required',
            error_description:
              `Client "${dcrClient.client_name}" (${client_id}) does not have authorization consent. ` +
              'This client must be re-registered or an admin must POST to /oauth/consent/approve.',
          });
          return;
        }

        resolvedClientId = client_id!;
      }

      // ✅ SECURITY: Validate requested scope
      const scopeValidation = this.validateScope(scope);
      if (!scopeValidation.valid) {
        res.status(400).json({
          error: 'invalid_scope',
          error_description: scopeValidation.error,
        });
        return;
      }
      const validatedScope = scopeValidation.scope!;

      // ✅ SECURITY: Require PKCE (OAuth 2.1 best practice)
      if (!code_challenge || !code_challenge_method) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'code_challenge and code_challenge_method are required (PKCE)',
        });
        return;
      }

      // Validate code_challenge_method (only S256 is supported)
      if (code_challenge_method !== 'S256') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Only code_challenge_method=S256 is supported',
        });
        return;
      }

      // Validate code_challenge format (base64url, 43-128 characters)
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(code_challenge)) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'code_challenge must be a 43-128 character base64url string',
        });
        return;
      }

      // For Claude Connectors, redirect to Google OAuth first
      if (this.config.googleClientId) {
        const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        googleAuthUrl.searchParams.set('client_id', this.config.googleClientId);
        googleAuthUrl.searchParams.set(
          'redirect_uri',
          `${this.config.issuer}/oauth/google-callback`
        );
        googleAuthUrl.searchParams.set('response_type', 'code');
        // Use centralized scope configuration (includes ALL features: Sheets, Drive, BigQuery, Apps Script)
        const googleScopes = formatScopesForAuth(getRecommendedScopes());
        googleAuthUrl.searchParams.set('scope', googleScopes);
        googleAuthUrl.searchParams.set('access_type', 'offline');
        googleAuthUrl.searchParams.set('prompt', 'consent');
        googleAuthUrl.searchParams.set('include_granted_scopes', 'true'); // Google incremental authorization

        // Store state for callback — includes clientId so the Google callback
        // knows which MCP client to issue the authorization code for.
        const stateData: StateData = {
          originalState: state,
          redirectUri: redirect_uri,
          scope: validatedScope,
          codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method,
          clientId: resolvedClientId,
        };
        const stateBase64 = Buffer.from(JSON.stringify(stateData)).toString('base64');
        const stateSignature = createHmac('sha256', this.config.stateSecret)
          .update(stateBase64)
          .digest('hex');
        googleAuthUrl.searchParams.set('state', `${stateBase64}.${stateSignature}`);

        res.redirect(googleAuthUrl.toString());
        return;
      }

      // Generate authorization code (no Google OAuth configured — direct flow)
      const code = randomBytes(32).toString('hex');
      await this.sessionStore.set(
        `authcode:${code}`,
        {
          code,
          clientId: resolvedClientId,
          redirectUri: redirect_uri,
          scope: validatedScope,
          codeChallenge: code_challenge,
          codeChallengeMethod: code_challenge_method,
          googleAccessToken: undefined,
          expiresAt: Date.now() + 600000,
        } as AuthorizationCode,
        600 // 10 minutes
      );

      // Redirect back with code
      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set('code', code);
      if (state) callbackUrl.searchParams.set('state', state);

      res.redirect(callbackUrl.toString());
    });

    // Google OAuth callback
    router.get('/oauth/google-callback', async (req, res) => {
      const { code, state, error } = req.query as Record<string, string | undefined>;

      if (error) {
        res.status(400).json({ error: 'google_auth_failed', details: error });
        return;
      }

      if (!state || !code) {
        res
          .status(400)
          .json({ error: 'invalid_request', error_description: 'Missing code or state' });
        return;
      }

      try {
        // ✅ SECURITY: Verify HMAC-signed state token (defense-in-depth)
        const dotIndex = state.lastIndexOf('.');
        if (dotIndex === -1) {
          res
            .status(400)
            .json({ error: 'invalid_request', error_description: 'Invalid state format' });
          return;
        }
        const stateBase64 = state.substring(0, dotIndex);
        const stateSignature = state.substring(dotIndex + 1);
        const expectedSignature = createHmac('sha256', this.config.stateSecret)
          .update(stateBase64)
          .digest('hex');
        if (
          stateSignature.length !== expectedSignature.length ||
          !timingSafeEqual(Buffer.from(stateSignature), Buffer.from(expectedSignature))
        ) {
          logger.warn('OAuth state signature mismatch — possible CSRF attempt');
          res
            .status(400)
            .json({ error: 'invalid_request', error_description: 'Invalid state signature' });
          return;
        }
        const stateData = JSON.parse(Buffer.from(stateBase64, 'base64').toString()) as StateData;

        // Validate the redirect URI is in our allowlist
        if (!this.validateRedirectUri(stateData.redirectUri)) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'Invalid redirect URI in state',
          });
          return;
        }

        // Exchange code for Google tokens (with circuit breaker protection)
        const googleTokens = await this.oauthCircuit.execute(async () => {
          const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code: code,
              client_id: this.config.googleClientId,
              client_secret: this.config.googleClientSecret,
              redirect_uri: `${this.config.issuer}/oauth/google-callback`,
              grant_type: 'authorization_code',
            }),
          });

          return (await tokenResponse.json()) as {
            access_token: string;
            refresh_token?: string;
          };
        });

        // Generate our authorization code — uses the clientId carried through state
        // so DCR clients get a code bound to their identity, not the static clientId.
        const authCode = randomBytes(32).toString('hex');
        await this.sessionStore.set(
          `authcode:${authCode}`,
          {
            code: authCode,
            clientId: stateData.clientId ?? this.config.clientId,
            redirectUri: stateData.redirectUri,
            scope: stateData.scope ?? 'sheets:write',
            codeChallenge: stateData.codeChallenge,
            codeChallengeMethod: stateData.codeChallengeMethod,
            googleAccessToken: googleTokens.access_token,
            googleRefreshToken: googleTokens.refresh_token,
            expiresAt: Date.now() + 600000,
          } as AuthorizationCode,
          600 // 10 minutes
        );

        // Redirect back to Claude
        const callbackUrl = new URL(stateData.redirectUri);
        callbackUrl.searchParams.set('code', authCode);
        if (stateData.originalState) {
          callbackUrl.searchParams.set('state', stateData.originalState);
        }

        res.redirect(callbackUrl.toString());
      } catch (err) {
        logger.error('OAuth token exchange failed', {
          component: 'oauth-provider',
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        res.status(500).json({
          error: 'token_exchange_failed',
          details: 'Authentication failed. Please try logging in again.',
        });
      }
    });

    // Token endpoint
    router.post('/oauth/token', express.urlencoded({ extended: false }), async (req, res) => {
      const {
        grant_type,
        code,
        redirect_uri,
        client_id,
        client_secret,
        refresh_token,
        code_verifier,
      } = req.body as Record<string, string | undefined>;

      // Validate client
      if (client_id !== this.config.clientId || client_secret !== this.config.clientSecret) {
        res.status(401).json({ error: 'invalid_client' });
        return;
      }

      if (grant_type === 'authorization_code') {
        await this.handleAuthorizationCode(code ?? '', redirect_uri ?? '', code_verifier, res);
        return;
      }

      if (grant_type === 'refresh_token') {
        await this.handleRefreshToken(refresh_token ?? '', res);
        return;
      }

      res.status(400).json({ error: 'unsupported_grant_type' });
    });

    // Token revocation
    router.post('/oauth/revoke', express.urlencoded({ extended: false }), async (req, res) => {
      const { token } = req.body as { token?: string };

      // Remove refresh token if it exists
      if (token) {
        await this.sessionStore.delete(`refresh:${token}`);
      }

      res.status(200).end();
    });

    // Token introspection
    router.post('/oauth/introspect', express.urlencoded({ extended: false }), (req, res) => {
      const { token } = req.body as { token?: string };

      if (!token) {
        res.json({ active: false });
        return;
      }

      // Try all active secrets (supports rotation)
      for (const secret of this.jwtSecrets) {
        try {
          // ✅ SECURITY FIX: Verify aud and iss in introspection too
          // RFC 8707: Accept both resourceIndicator and clientId as valid audiences
          const audience = this.config.resourceIndicator ?? this.config.clientId;
          const payload = jwt.verify(token, secret, {
            algorithms: ['HS256'],
            audience,
            issuer: this.config.issuer,
            clockTolerance: 30,
          }) as unknown as TokenPayload;

          res.json({
            active: true,
            sub: payload.sub,
            aud: payload.aud,
            iss: payload.iss,
            exp: payload.exp,
            iat: payload.iat,
            scope: payload.scope,
          });
          return; // Success, return early
        } catch {
          // Try next secret
          continue;
        }
      }

      // All secrets failed
      res.json({ active: false });
    });

    // Dynamic Client Registration (RFC 7591)
    // Allows clients to register themselves dynamically
    router.post('/oauth/register', express.json(), async (req, res) => {
      try {
        const {
          redirect_uris,
          client_name,
          grant_types,
          response_types,
          scope,
          token_endpoint_auth_method,
        } = req.body as {
          redirect_uris?: string[];
          client_name?: string;
          grant_types?: string[];
          response_types?: string[];
          scope?: string;
          token_endpoint_auth_method?: string;
        };

        // Validate required fields
        if (!redirect_uris || redirect_uris.length === 0) {
          res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: 'redirect_uris is required',
          });
          return;
        }

        // Validate redirect URIs
        for (const uri of redirect_uris) {
          try {
            const parsedUri = new URL(uri);
            // Only allow https in production (except localhost for dev)
            if (
              process.env['NODE_ENV'] === 'production' &&
              parsedUri.protocol !== 'https:' &&
              !parsedUri.hostname.match(/^(localhost|127\.0\.0\.1)$/)
            ) {
              res.status(400).json({
                error: 'invalid_redirect_uri',
                error_description: 'redirect_uris must use https in production',
              });
              return;
            }
          } catch {
            res.status(400).json({
              error: 'invalid_redirect_uri',
              error_description: `Invalid URI: ${uri}`,
            });
            return;
          }
        }

        // Validate grant types (only authorization_code supported)
        const requestedGrantTypes = grant_types || ['authorization_code'];
        if (!requestedGrantTypes.includes('authorization_code')) {
          res.status(400).json({
            error: 'invalid_client_metadata',
            error_description: 'Only authorization_code grant type is supported',
          });
          return;
        }

        // Validate scopes
        const requestedScopes = scope?.split(' ') || ['sheets:read'];
        for (const s of requestedScopes) {
          if (!SUPPORTED_SCOPES.includes(s as SupportedScope)) {
            res.status(400).json({
              error: 'invalid_client_metadata',
              error_description: `Unsupported scope: ${s}`,
            });
            return;
          }
        }

        // Generate client credentials
        const clientId = `dcr_${randomUUID().replace(/-/g, '')}`;
        const clientSecret = randomBytes(32).toString('base64url');
        const clientIdIssuedAt = Math.floor(Date.now() / 1000);

        // Store client registration (expires in 1 year)
        const clientData = {
          client_id: clientId,
          client_secret: clientSecret,
          client_name: client_name || `Dynamic Client ${clientId.substring(0, 8)}`,
          redirect_uris,
          grant_types: requestedGrantTypes,
          response_types: response_types || ['code'],
          scope: requestedScopes.join(' '),
          token_endpoint_auth_method: token_endpoint_auth_method || 'client_secret_basic',
          client_id_issued_at: clientIdIssuedAt,
          created_at: new Date().toISOString(),
        };

        // Store in session store with 1 year TTL
        await this.sessionStore.set(
          `dcr:${clientId}`,
          clientData,
          365 * 24 * 60 * 60 * 1000 // 1 year
        );

        // ✅ CONFUSED DEPUTY PROTECTION: grant per-client consent at registration time.
        // The act of POSTing to /oauth/register is the consent signal — it requires an
        // authorized HTTP request to our server. Pre-approving at registration prevents
        // the confused deputy attack without requiring a separate consent UI flow.
        await this.grantDcrConsent(clientId, clientData.client_name, redirect_uris);

        logger.info('Dynamic client registered', {
          clientId,
          clientName: clientData.client_name,
          redirectUris: redirect_uris,
        });

        // Return client credentials (RFC 7591 response)
        res.status(201).json({
          client_id: clientId,
          client_secret: clientSecret,
          client_name: clientData.client_name,
          redirect_uris,
          grant_types: requestedGrantTypes,
          response_types: clientData.response_types,
          scope: clientData.scope,
          token_endpoint_auth_method: clientData.token_endpoint_auth_method,
          client_id_issued_at: clientIdIssuedAt,
        });
      } catch (error) {
        logger.error('DCR registration failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
          error: 'server_error',
          error_description: 'Registration failed',
        });
      }
    });

    // ================================================================
    // Admin consent endpoints — require admin authentication.
    // SECURITY: These endpoints grant/revoke client authorization;
    // unauthenticated access would allow consent manipulation attacks.
    // ================================================================
    const requireAdminAuth = (req: Request, res: Response, next: () => void): void => {
      // Admin auth via Bearer token matching the JWT secret (admin API key)
      // or via a dedicated ADMIN_API_KEY environment variable
      const adminKey = process.env['ADMIN_API_KEY'] || process.env['JWT_SECRET'];
      const authHeader = req.headers['authorization'];
      if (!authHeader || !adminKey) {
        res.status(401).json({
          error: 'unauthorized',
          error_description: 'Admin authentication required. Set ADMIN_API_KEY and pass as Bearer token.',
        });
        return;
      }
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (token !== adminKey) {
        res.status(403).json({
          error: 'forbidden',
          error_description: 'Invalid admin credentials',
        });
        return;
      }
      next();
    };

    // Admin endpoint: revoke consent for a DCR client.
    // After revocation the client cannot initiate new authorization flows until
    // re-registered (which re-grants consent) or consent is re-approved here.
    // POST /oauth/consent/revoke  { client_id: string }
    router.post('/oauth/consent/revoke', requireAdminAuth, express.json(), async (req, res) => {
      const { client_id: revokeClientId } = req.body as { client_id?: string };
      if (!revokeClientId) {
        res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
        return;
      }
      await this.revokeDcrConsent(revokeClientId);
      logger.warn('DCR client consent revoked via admin endpoint', { clientId: revokeClientId });
      res.status(200).json({ revoked: true, client_id: revokeClientId });
    });

    // Admin endpoint: re-approve consent for a previously revoked DCR client.
    // POST /oauth/consent/approve  { client_id: string }
    router.post('/oauth/consent/approve', requireAdminAuth, express.json(), async (req, res) => {
      const { client_id: approveClientId } = req.body as { client_id?: string };
      if (!approveClientId) {
        res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
        return;
      }
      const dcrClient = await this.lookupDcrClient(approveClientId);
      if (!dcrClient) {
        res.status(404).json({ error: 'not_found', error_description: 'Client not registered' });
        return;
      }
      await this.grantDcrConsent(approveClientId, dcrClient.client_name, dcrClient.redirect_uris);
      logger.info('DCR client consent approved via admin endpoint', {
        clientId: approveClientId,
        clientName: dcrClient.client_name,
      });
      res.status(200).json({ approved: true, client_id: approveClientId });
    });

    return router;
  }

  /**
   * Handle authorization code exchange
   */
  private async handleAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string | undefined,
    res: Response
  ): Promise<void> {
    const authCodeData = await this.sessionStore.get(`authcode:${code}`);

    if (!authCodeData) {
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code',
      });
      return;
    }

    const authCode = authCodeData as AuthorizationCode;

    if (authCode.redirectUri !== redirectUri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' });
      return;
    }

    // ✅ SECURITY: Verify PKCE (now always required)
    if (!codeVerifier) {
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'code_verifier is required (PKCE)',
      });
      return;
    }

    // authCode.codeChallenge is guaranteed to exist (enforced at auth endpoint)
    const expectedChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    if (expectedChallenge !== authCode.codeChallenge) {
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code_verifier (PKCE verification failed)',
      });
      return;
    }

    // Generate tokens
    const userId = randomUUID();

    // SECURITY: Store Google tokens in session store, NOT in JWT payload.
    // JWTs are signed but not encrypted — base64-decode would expose Google credentials.
    if (authCode.googleAccessToken || authCode.googleRefreshToken) {
      await this.sessionStore.set(
        `google_tokens:${userId}`,
        {
          googleAccessToken: authCode.googleAccessToken,
          googleRefreshToken: authCode.googleRefreshToken,
        },
        this.config.refreshTokenTtl // Same TTL as refresh token
      );
    }

    const accessToken = jwt.sign(
      {
        sub: userId,
        aud: this.config.resourceIndicator || this.config.clientId, // RFC 8707: use resource indicator if configured
        iss: this.config.issuer,
        scope: authCode.scope,
      } as Partial<TokenPayload>,
      this.jwtSecrets[0]!, // Use primary secret for signing
      {
        expiresIn: this.config.accessTokenTtl,
        header: { alg: 'HS256', kid: '0' }, // Key ID to identify which secret was used
      }
    );

    const refreshTokenValue = randomBytes(32).toString('hex');
    await this.sessionStore.set(
      `refresh:${refreshTokenValue}`,
      {
        userId,
        clientId: authCode.clientId,
        scope: authCode.scope,
        googleRefreshToken: authCode.googleRefreshToken,
        expiresAt: Date.now() + this.config.refreshTokenTtl * 1000,
      } as RefreshTokenData,
      this.config.refreshTokenTtl
    );

    // Clean up authorization code (one-time use)
    await this.sessionStore.delete(`authcode:${code}`);

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtl,
      refresh_token: refreshTokenValue,
      scope: authCode.scope,
    });
  }

  /**
   * Handle refresh token exchange
   */
  private async handleRefreshToken(refreshToken: string, res: Response): Promise<void> {
    const tokenDataRaw = await this.sessionStore.get(`refresh:${refreshToken}`);

    if (!tokenDataRaw) {
      res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
      return;
    }

    const tokenData = tokenDataRaw as RefreshTokenData;

    // Generate new access token (Google tokens stored in session store, not JWT)
    const accessToken = jwt.sign(
      {
        sub: tokenData.userId,
        aud: this.config.resourceIndicator || tokenData.clientId, // RFC 8707: use resource indicator if configured
        iss: this.config.issuer,
        scope: tokenData.scope,
      } as Partial<TokenPayload>,
      this.jwtSecrets[0]!, // Use primary secret for signing
      {
        expiresIn: this.config.accessTokenTtl,
        header: { alg: 'HS256', kid: '0' }, // Key ID to identify which secret was used
      }
    );

    // Rotate refresh token (best practice) - preserve Google refresh token
    const newRefreshToken = randomBytes(32).toString('hex');
    await this.sessionStore.delete(`refresh:${refreshToken}`);
    await this.sessionStore.set(
      `refresh:${newRefreshToken}`,
      {
        ...tokenData,
        googleRefreshToken: tokenData.googleRefreshToken,
        expiresAt: Date.now() + this.config.refreshTokenTtl * 1000,
      } as RefreshTokenData,
      this.config.refreshTokenTtl
    );

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtl,
      refresh_token: newRefreshToken,
      scope: tokenData.scope,
    });
  }

  /**
   * Middleware to validate access tokens
   */
  private getWwwAuthenticateHeader(error: string, errorDescription: string): string {
    const escapeHeaderValue = (value: string): string =>
      value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return [
      'Bearer',
      `realm="${escapeHeaderValue(this.config.issuer)}"`,
      `error="${escapeHeaderValue(error)}"`,
      `error_description="${escapeHeaderValue(errorDescription)}"`,
    ].join(', ');
  }

  private sendUnauthorized(
    res: Response,
    options: {
      error: 'unauthorized' | 'invalid_token';
      headerError: 'invalid_request' | 'invalid_token';
      errorDescription: string;
    }
  ): void {
    res
      .set(
        'WWW-Authenticate',
        this.getWwwAuthenticateHeader(options.headerError, options.errorDescription)
      )
      .status(401)
      .json({
        error: options.error,
        error_description: options.errorDescription,
      });
  }

  validateToken() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const authHeader = req.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        this.sendUnauthorized(res, {
          error: 'unauthorized',
          headerError: 'invalid_request',
          errorDescription: 'Missing or invalid authorization header',
        });
        return;
      }

      const token = authHeader.slice(7);

      // Try all active secrets (supports rotation)
      let lastError: Error | null = null;

      for (const secret of this.jwtSecrets) {
        try {
          // ✅ SECURITY FIX: Verify aud and iss claims
          // RFC 8707: Accept both resourceIndicator and clientId as valid audiences
          const audience = this.config.resourceIndicator ?? this.config.clientId;
          const payload = jwt.verify(token, secret, {
            algorithms: ['HS256'],
            audience,
            issuer: this.config.issuer,
            clockTolerance: 30, // 30 second clock skew tolerance
          }) as unknown as TokenPayload;

          (req as Request & { auth: TokenPayload }).auth = payload;
          next();
          return; // Success, return early
        } catch (err) {
          lastError = err as Error;
          // Try next secret
          continue;
        }
      }

      // All secrets failed, return error from last attempt
      if (lastError instanceof jwt.TokenExpiredError) {
        this.sendUnauthorized(res, {
          error: 'invalid_token',
          headerError: 'invalid_token',
          errorDescription: 'Token expired',
        });
        return;
      }
      if (lastError instanceof jwt.JsonWebTokenError) {
        this.sendUnauthorized(res, {
          error: 'invalid_token',
          headerError: 'invalid_token',
          errorDescription: lastError.message,
        });
        return;
      }
      this.sendUnauthorized(res, {
        error: 'invalid_token',
        headerError: 'invalid_token',
        errorDescription: 'Invalid token',
      });
    };
  }

  /**
   * Extract Google access token from session store (keyed by userId from JWT)
   */
  async getGoogleToken(req: Request): Promise<string | undefined> {
    const userId = (req as Request & { auth?: TokenPayload }).auth?.sub;
    if (!userId) return undefined;

    const tokens = (await this.sessionStore.get(`google_tokens:${userId}`)) as
      | { googleAccessToken?: string; googleRefreshToken?: string }
      | undefined;
    return tokens?.googleAccessToken;
  }

  /**
   * Extract Google refresh token from session store (keyed by userId from JWT)
   */
  async getGoogleRefreshToken(req: Request): Promise<string | undefined> {
    const userId = (req as Request & { auth?: TokenPayload }).auth?.sub;
    if (!userId) return undefined;

    const tokens = (await this.sessionStore.get(`google_tokens:${userId}`)) as
      | { googleAccessToken?: string; googleRefreshToken?: string }
      | undefined;
    return tokens?.googleRefreshToken;
  }
}
