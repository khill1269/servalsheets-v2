/**
 * ServalSheets - Generic REST Connector
 *
 * Connect to any REST API that returns JSON data. Supports configurable
 * URL patterns, authentication, pagination, and response mapping.
 *
 * Auth: API key (header or query param) or Bearer token
 * Use case: Connect to any public/private REST API without writing a custom connector
 */

import { logger } from '../utils/logger.js';
import { ConfigError, NotFoundError, ServiceError } from '../core/errors.js';
import { validateWebhookUrl } from '../services/webhook-url-validation.js';
import type {
  SpreadsheetConnector,
  ConnectorCredentials,
  HealthStatus,
  QuotaStatus,
  RateLimitInfo,
  DataEndpoint,
  DataSchema,
  QueryParams,
  DataResult,
} from './types.js';

// ============================================================================
// Configuration Types
// ============================================================================

interface RestEndpointConfig {
  /** Endpoint identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Category for grouping */
  category: string;
  /** HTTP method */
  method: 'GET' | 'POST';
  /** URL path (supports {param} path parameters) */
  path: string;
  /** Parameter definitions */
  params: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date';
    required: boolean;
    description: string;
    in: 'path' | 'query' | 'body';
    example?: string;
  }[];
  /** JSON path to extract results array (e.g., 'data.results') */
  resultsPath?: string;
  /** Pagination config */
  pagination?: {
    type: 'offset' | 'cursor' | 'page';
    pageParam: string;
    limitParam: string;
    cursorPath?: string;
    defaultLimit: number;
  };
}

interface RestConnectorConfig {
  /** Unique connector ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Base URL for all API calls */
  baseUrl: string;
  /** Authentication configuration */
  auth: {
    type: 'api_key_header' | 'api_key_query' | 'bearer' | 'none';
    headerName?: string;
    queryParam?: string;
    prefix?: string;
  };
  /** Default headers for all requests */
  defaultHeaders?: Record<string, string>;
  /** Rate limit configuration */
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  /** Endpoint definitions */
  endpoints: RestEndpointConfig[];
}

// ============================================================================
// Connector Implementation
// ============================================================================

export class GenericRestConnector implements SpreadsheetConnector {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authType: 'api_key' | 'oauth2' | 'none';

  private config: RestConnectorConfig;
  private authToken: string | null = null;
  private configured = false;
  private requestCount = 0;
  private lastResetTime = Date.now();

  constructor(config: RestConnectorConfig) {
    this.config = config;
    this.id = `rest_${config.id}`;
    this.name = config.name;
    this.description = config.description;
    this.authType = config.auth.type === 'none' ? 'none' : 'api_key';
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    await validateWebhookUrl(this.config.baseUrl);

    if (this.config.auth.type !== 'none') {
      if (!credentials.apiKey && !credentials.custom?.['token']) {
        throw new ConfigError(
          `REST connector '${this.config.name}' requires authentication. ` +
            `Provide apiKey or custom.token in credentials.`,
          'REST_CONNECTOR_API_KEY'
        );
      }
      this.authToken = credentials.apiKey ?? credentials.custom?.['token'] ?? null;
    }
    this.configured = true;
    logger.info(
      `REST connector configured: ${this.id} (${this.config.endpoints.length} endpoints)`
    );
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Try the first endpoint with minimal params as a health check
      const firstEndpoint = this.config.endpoints[0];
      if (!firstEndpoint) {
        return {
          healthy: true,
          latencyMs: Date.now() - start,
          message: 'No endpoints configured',
          lastChecked: new Date().toISOString(),
        };
      }

      const url = new URL(`${this.config.baseUrl}${firstEndpoint.path}`);
      const headers = this.buildHeaders();
      const resp = await fetch(url.toString(), { headers, method: 'HEAD' }).catch(() =>
        fetch(url.toString(), { headers, method: 'GET' })
      );

      return {
        healthy: resp.ok || resp.status === 405, // HEAD not allowed is still healthy
        latencyMs: Date.now() - start,
        message: resp.ok || resp.status === 405 ? 'OK' : `HTTP ${resp.status}`,
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Connection failed',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async dispose(): Promise<void> {
    this.authToken = null;
    this.configured = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return this.config.endpoints.map((ep) => ({
      id: ep.id,
      name: ep.name,
      description: ep.description,
      category: ep.category,
      params: ep.params.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description,
        example: p.example,
      })),
    }));
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    // REST APIs don't have predefined schemas — inferred from results
    return { endpoint, columns: [] };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();

    const epConfig = this.config.endpoints.find((ep) => ep.id === endpoint);
    if (!epConfig) {
      throw new NotFoundError('endpoint', `${endpoint} in REST connector '${this.config.name}'`);
    }

    const url = this.buildUrl(epConfig, params);
    const headers = this.buildHeaders();
    const fetchOptions: RequestInit = {
      method: epConfig.method,
      headers,
    };

    // Build request body for POST endpoints
    if (epConfig.method === 'POST') {
      const bodyParams: Record<string, unknown> = {};
      for (const paramDef of epConfig.params) {
        if (paramDef.in === 'body' && params[paramDef.name] !== undefined) {
          bodyParams[paramDef.name] = params[paramDef.name];
        }
      }
      if (Object.keys(bodyParams).length > 0) {
        fetchOptions.body = JSON.stringify(bodyParams);
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const resp = await fetch(url, fetchOptions);
    if (!resp.ok) {
      throw new ServiceError(
        `REST API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'rest-generic',
        true
      );
    }

    const data = (await resp.json()) as unknown;
    return this.formatResult(endpoint, epConfig, data);
  }

  getQuotaUsage(): QuotaStatus {
    const limit = this.config.rateLimit?.requestsPerMinute ?? 60;
    return {
      used: this.requestCount,
      limit,
      resetAt: new Date(this.lastResetTime + 60_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: this.config.rateLimit?.requestsPerMinute ?? 60,
      requestsPerDay: this.config.rateLimit?.requestsPerDay ?? 10000,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildUrl(epConfig: RestEndpointConfig, params: QueryParams): string {
    // Substitute path params
    let path = epConfig.path;
    for (const paramDef of epConfig.params) {
      if (paramDef.in === 'path' && params[paramDef.name] !== undefined) {
        path = path.replace(`{${paramDef.name}}`, String(params[paramDef.name]));
      }
    }

    const url = new URL(`${this.config.baseUrl}${path}`);

    // Add query params
    for (const paramDef of epConfig.params) {
      if (paramDef.in === 'query' && params[paramDef.name] !== undefined) {
        url.searchParams.set(paramDef.name, String(params[paramDef.name]));
      }
    }

    // Add auth as query param if configured
    if (this.config.auth.type === 'api_key_query' && this.authToken) {
      const paramName = this.config.auth.queryParam ?? 'api_key';
      url.searchParams.set(paramName, this.authToken);
    }

    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.config.defaultHeaders,
    };

    if (this.config.auth.type === 'api_key_header' && this.authToken) {
      const headerName = this.config.auth.headerName ?? 'X-API-Key';
      headers[headerName] = this.authToken;
    } else if (this.config.auth.type === 'bearer' && this.authToken) {
      const prefix = this.config.auth.prefix ?? 'Bearer';
      headers['Authorization'] = `${prefix} ${this.authToken}`;
    }

    return headers;
  }

  private formatResult(endpoint: string, epConfig: RestEndpointConfig, data: unknown): DataResult {
    // Extract results array using configured path
    let results: unknown = data;
    if (epConfig.resultsPath) {
      const pathParts = epConfig.resultsPath.split('.');
      for (const part of pathParts) {
        if (results && typeof results === 'object') {
          results = (results as Record<string, unknown>)[part];
        }
      }
    }

    // Handle array of objects
    if (Array.isArray(results) && results.length > 0) {
      const objects = results as Record<string, unknown>[];
      const first = objects[0]!;
      const headers = Object.keys(first).filter(
        (k) => typeof first[k] !== 'object' || first[k] === null
      );
      const rows = objects.map((obj) =>
        headers.map((h) => {
          const v = obj[h];
          if (v === null || v === undefined) return null;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
          return String(v);
        })
      );
      return { headers, rows, metadata: this.meta(endpoint, rows.length) };
    }

    // Handle single object
    if (typeof results === 'object' && results !== null && !Array.isArray(results)) {
      const obj = results as Record<string, unknown>;
      const headers = Object.keys(obj).filter((k) => typeof obj[k] !== 'object' || obj[k] === null);
      const row = headers.map((h) => {
        const v = obj[h];
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
        return String(v);
      });
      return { headers, rows: [row], metadata: this.meta(endpoint, 1) };
    }

    // Fallback
    return {
      headers: ['data'],
      rows: [[JSON.stringify(data)]],
      metadata: this.meta(endpoint, 1),
    };
  }

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 60_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private meta(endpoint: string, rowCount: number): DataResult['metadata'] {
    return {
      source: this.id,
      endpoint,
      fetchedAt: new Date().toISOString(),
      rowCount,
      cached: false,
      quotaUsed: 1,
    };
  }
}
