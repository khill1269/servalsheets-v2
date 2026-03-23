/**
 * ServalSheets - FRED Connector
 *
 * Federal Reserve Economic Data (FRED) from the St. Louis Fed.
 * Provides macroeconomic time series: GDP, CPI, unemployment, interest rates, etc.
 *
 * Auth: API key (free, 120 req/min)
 * Docs: https://fred.stlouisfed.org/docs/api/fred/
 */

import { logger } from '../utils/logger.js';
import { ConfigError, ServiceError } from '../core/errors.js';
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

const BASE_URL = 'https://api.stlouisfed.org/fred';

export class FredConnector implements SpreadsheetConnector {
  readonly id = 'fred';
  readonly name = 'FRED (Federal Reserve)';
  readonly description =
    'Federal Reserve Economic Data: GDP, CPI, unemployment, interest rates, monetary aggregates, and 800K+ economic time series';
  readonly authType = 'api_key' as const;

  private apiKey: string | null = null;
  private configured = false;
  private requestCount = 0;
  private lastResetTime = Date.now();

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    if (!credentials.apiKey) {
      throw new ConfigError(
        'FRED requires an API key. Get one free at https://fred.stlouisfed.org/docs/api/api_key.html',
        'FRED_API_KEY'
      );
    }
    this.apiKey = credentials.apiKey;
    this.configured = true;
    logger.info('FRED connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(
        `${BASE_URL}/series?series_id=GDP&api_key=${this.apiKey}&file_type=json`
      );
      return {
        healthy: resp.ok,
        latencyMs: Date.now() - start,
        message: resp.ok ? 'OK' : `HTTP ${resp.status}`,
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
    this.apiKey = null;
    this.configured = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return [
      {
        id: 'series/observations',
        name: 'Series Observations',
        description: 'Get time series data points for a FRED series',
        category: 'time_series',
        params: [
          {
            name: 'series_id',
            type: 'string',
            required: true,
            description: 'FRED series ID',
            example: 'GDP',
          },
          {
            name: 'observation_start',
            type: 'string',
            required: false,
            description: 'Start date (YYYY-MM-DD)',
            example: '2020-01-01',
          },
          {
            name: 'observation_end',
            type: 'string',
            required: false,
            description: 'End date (YYYY-MM-DD)',
            example: '2026-01-01',
          },
          {
            name: 'frequency',
            type: 'string',
            required: false,
            description: 'Frequency: d, w, bw, m, q, sa, a',
            example: 'q',
          },
          {
            name: 'units',
            type: 'string',
            required: false,
            description: 'Units: lin, chg, ch1, pch, pc1, pca, cch, cca, log',
            example: 'pch',
          },
        ],
      },
      {
        id: 'series/search',
        name: 'Series Search',
        description: 'Search for FRED series by keywords',
        category: 'discovery',
        params: [
          {
            name: 'search_text',
            type: 'string',
            required: true,
            description: 'Search query',
            example: 'consumer price index',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Max results (default: 20)',
            example: '20',
          },
        ],
      },
      {
        id: 'series',
        name: 'Series Info',
        description: 'Get metadata for a FRED series',
        category: 'metadata',
        params: [
          {
            name: 'series_id',
            type: 'string',
            required: true,
            description: 'FRED series ID',
            example: 'UNRATE',
          },
        ],
      },
      {
        id: 'category/series',
        name: 'Category Series',
        description: 'Get all series in a FRED category',
        category: 'discovery',
        params: [
          {
            name: 'category_id',
            type: 'number',
            required: true,
            description: 'FRED category ID',
            example: '32991',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Max results',
            example: '50',
          },
        ],
      },
      {
        id: 'releases',
        name: 'Economic Releases',
        description: 'Get upcoming economic data releases',
        category: 'calendar',
        params: [
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Max results',
            example: '20',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'series/observations': {
        endpoint: 'series/observations',
        columns: [
          { name: 'date', type: 'date', description: 'Observation date' },
          { name: 'value', type: 'number', description: 'Observation value' },
        ],
      },
      'series/search': {
        endpoint: 'series/search',
        columns: [
          { name: 'id', type: 'string', description: 'Series ID' },
          { name: 'title', type: 'string', description: 'Series title' },
          { name: 'frequency', type: 'string', description: 'Frequency' },
          { name: 'units', type: 'string', description: 'Units' },
          { name: 'observation_start', type: 'date', description: 'First observation' },
          { name: 'observation_end', type: 'date', description: 'Last observation' },
          { name: 'popularity', type: 'number', description: 'Popularity score' },
        ],
      },
      series: {
        endpoint: 'series',
        columns: [
          { name: 'id', type: 'string', description: 'Series ID' },
          { name: 'title', type: 'string', description: 'Series title' },
          { name: 'frequency', type: 'string', description: 'Frequency' },
          { name: 'units', type: 'string', description: 'Units' },
          { name: 'seasonal_adjustment', type: 'string', description: 'Seasonal adjustment' },
          { name: 'last_updated', type: 'date', description: 'Last updated' },
        ],
      },
    };
    return schemas[endpoint] ?? { endpoint, columns: [] };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();
    const url = this.buildUrl(endpoint, params);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new ServiceError(
        `FRED API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'fred',
        true
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;
    return this.formatResult(endpoint, data);
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 120,
      resetAt: new Date(this.lastResetTime + 60_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 120,
      requestsPerDay: 5000,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildUrl(endpoint: string, params: QueryParams): string {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('api_key', this.apiKey!);
    url.searchParams.set('file_type', 'json');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 60_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private formatResult(endpoint: string, data: Record<string, unknown>): DataResult {
    if (endpoint === 'series/observations') {
      const observations = (data['observations'] as Record<string, string>[]) ?? [];
      const rows = observations.map((o) => [
        o['date'] ?? null,
        o['value'] === '.' ? null : Number(o['value']),
      ]);
      return {
        headers: ['date', 'value'],
        rows,
        metadata: {
          source: 'fred',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    if (endpoint === 'series/search') {
      const series = (data['seriess'] as Record<string, unknown>[]) ?? [];
      const rows = series.map((s) => [
        (s['id'] as string) ?? null,
        (s['title'] as string) ?? null,
        (s['frequency'] as string) ?? null,
        (s['units'] as string) ?? null,
        (s['observation_start'] as string) ?? null,
        (s['observation_end'] as string) ?? null,
        (s['popularity'] as number) ?? null,
      ]);
      return {
        headers: [
          'id',
          'title',
          'frequency',
          'units',
          'observation_start',
          'observation_end',
          'popularity',
        ],
        rows,
        metadata: {
          source: 'fred',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    if (endpoint === 'series') {
      const series = (data['seriess'] as Record<string, unknown>[]) ?? [];
      const rows = series.map((s) => [
        (s['id'] as string) ?? null,
        (s['title'] as string) ?? null,
        (s['frequency'] as string) ?? null,
        (s['units'] as string) ?? null,
        (s['seasonal_adjustment'] as string) ?? null,
        (s['last_updated'] as string) ?? null,
      ]);
      return {
        headers: ['id', 'title', 'frequency', 'units', 'seasonal_adjustment', 'last_updated'],
        rows,
        metadata: {
          source: 'fred',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    // Generic fallback
    return {
      headers: ['data'],
      rows: [[JSON.stringify(data)]],
      metadata: {
        source: 'fred',
        endpoint,
        fetchedAt: new Date().toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }
}
