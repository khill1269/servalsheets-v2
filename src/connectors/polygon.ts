/**
 * ServalSheets - Polygon.io Connector
 *
 * Real-time and historical market data: stocks, options, forex, crypto.
 * High-quality aggregated bars, trades, quotes, and reference data.
 *
 * Auth: API key (free tier: 5 req/min, unlimited historical)
 * Docs: https://polygon.io/docs
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

const BASE_URL = 'https://api.polygon.io';

export class PolygonConnector implements SpreadsheetConnector {
  readonly id = 'polygon';
  readonly name = 'Polygon.io';
  readonly description =
    'Real-time and historical market data: stocks, options, forex, crypto aggregates, trades, and reference data';
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
        'Polygon.io requires an API key. Get one at https://polygon.io/dashboard/signup',
        'POLYGON_API_KEY'
      );
    }
    this.apiKey = credentials.apiKey;
    this.configured = true;
    logger.info('Polygon connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/v3/reference/tickers?limit=1&apiKey=${this.apiKey}`);
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
        id: 'aggs/ticker',
        name: 'Aggregate Bars',
        description: 'Historical OHLCV bars for a ticker (1min to 1year)',
        category: 'market_data',
        params: [
          {
            name: 'ticker',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'multiplier',
            type: 'number',
            required: true,
            description: 'Size of timespan multiplier',
            example: '1',
          },
          {
            name: 'timespan',
            type: 'string',
            required: true,
            description: 'day, week, month, quarter, year, minute, hour',
            example: 'day',
          },
          {
            name: 'from',
            type: 'string',
            required: true,
            description: 'Start date (YYYY-MM-DD)',
            example: '2025-01-01',
          },
          {
            name: 'to',
            type: 'string',
            required: true,
            description: 'End date (YYYY-MM-DD)',
            example: '2026-01-01',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Max results (default: 5000)',
            example: '5000',
          },
        ],
      },
      {
        id: 'snapshot/ticker',
        name: 'Ticker Snapshot',
        description: 'Current day snapshot with latest trade, quote, and daily bar',
        category: 'market_data',
        params: [
          {
            name: 'ticker',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
        ],
      },
      {
        id: 'reference/tickers',
        name: 'Ticker Search',
        description: 'Search and list tickers with reference data',
        category: 'reference',
        params: [
          {
            name: 'search',
            type: 'string',
            required: false,
            description: 'Search query',
            example: 'Apple',
          },
          {
            name: 'type',
            type: 'string',
            required: false,
            description: 'Asset type: CS, ETF, FUND, etc.',
            example: 'CS',
          },
          {
            name: 'market',
            type: 'string',
            required: false,
            description: 'Market: stocks, crypto, fx, otc',
            example: 'stocks',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Max results',
            example: '20',
          },
        ],
      },
      {
        id: 'reference/ticker-details',
        name: 'Ticker Details',
        description: 'Detailed company information',
        category: 'reference',
        params: [
          {
            name: 'ticker',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
        ],
      },
      {
        id: 'open-close',
        name: 'Daily Open/Close',
        description: 'Open, close, high, low, and volume for a specific date',
        category: 'market_data',
        params: [
          {
            name: 'ticker',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'date',
            type: 'string',
            required: true,
            description: 'Date (YYYY-MM-DD)',
            example: '2026-01-15',
          },
        ],
      },
      {
        id: 'grouped/daily',
        name: 'Grouped Daily',
        description: 'Daily bars for all tickers on a given date',
        category: 'market_data',
        params: [
          {
            name: 'date',
            type: 'string',
            required: true,
            description: 'Date (YYYY-MM-DD)',
            example: '2026-01-15',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'aggs/ticker': {
        endpoint: 'aggs/ticker',
        columns: [
          { name: 'date', type: 'date', description: 'Bar date' },
          { name: 'open', type: 'number', description: 'Open price' },
          { name: 'high', type: 'number', description: 'High price' },
          { name: 'low', type: 'number', description: 'Low price' },
          { name: 'close', type: 'number', description: 'Close price' },
          { name: 'volume', type: 'number', description: 'Volume' },
          { name: 'vwap', type: 'number', description: 'Volume-weighted average price' },
          { name: 'transactions', type: 'number', description: 'Number of transactions' },
        ],
      },
      'snapshot/ticker': {
        endpoint: 'snapshot/ticker',
        columns: [
          { name: 'ticker', type: 'string', description: 'Ticker' },
          { name: 'todaysChange', type: 'number', description: "Today's change" },
          { name: 'todaysChangePerc', type: 'number', description: "Today's change %" },
          { name: 'close', type: 'number', description: 'Close price' },
          { name: 'volume', type: 'number', description: 'Volume' },
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
        `Polygon API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'polygon',
        true
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;

    if (data['status'] === 'ERROR') {
      throw new ServiceError(
        `Polygon: ${data['error'] ?? 'Unknown error'}`,
        'INTERNAL_ERROR',
        'polygon',
        false
      );
    }

    return this.formatResult(endpoint, data, params);
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 5,
      resetAt: new Date(this.lastResetTime + 60_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 5,
      requestsPerDay: 1000,
    };
  }

  private buildUrl(endpoint: string, params: QueryParams): string {
    const ticker = params['ticker'] as string | undefined;

    // Route-based endpoints
    if (endpoint === 'aggs/ticker' && ticker) {
      const mult = params['multiplier'] ?? 1;
      const span = params['timespan'] ?? 'day';
      const from = params['from'] ?? '';
      const to = params['to'] ?? '';
      const url = new URL(
        `${BASE_URL}/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}`
      );
      url.searchParams.set('apiKey', this.apiKey!);
      if (params['limit']) url.searchParams.set('limit', String(params['limit']));
      return url.toString();
    }

    if (endpoint === 'snapshot/ticker' && ticker) {
      const url = new URL(`${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`);
      url.searchParams.set('apiKey', this.apiKey!);
      return url.toString();
    }

    if (endpoint === 'reference/tickers') {
      const url = new URL(`${BASE_URL}/v3/reference/tickers`);
      url.searchParams.set('apiKey', this.apiKey!);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
      return url.toString();
    }

    if (endpoint === 'reference/ticker-details' && ticker) {
      const url = new URL(`${BASE_URL}/v3/reference/tickers/${ticker}`);
      url.searchParams.set('apiKey', this.apiKey!);
      return url.toString();
    }

    if (endpoint === 'open-close' && ticker) {
      const date = params['date'] ?? '';
      const url = new URL(`${BASE_URL}/v1/open-close/${ticker}/${date}`);
      url.searchParams.set('apiKey', this.apiKey!);
      return url.toString();
    }

    if (endpoint === 'grouped/daily') {
      const date = params['date'] ?? '';
      const url = new URL(`${BASE_URL}/v2/aggs/grouped/locale/us/market/stocks/${date}`);
      url.searchParams.set('apiKey', this.apiKey!);
      return url.toString();
    }

    // Fallback
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('apiKey', this.apiKey!);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
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

  private formatResult(
    endpoint: string,
    data: Record<string, unknown>,
    _params: QueryParams
  ): DataResult {
    // Aggregate bars
    if (endpoint === 'aggs/ticker' && data['results'] && Array.isArray(data['results'])) {
      const results = data['results'] as Record<string, unknown>[];
      const rows: (string | number | null)[][] = results.map((r) => [
        r['t'] ? new Date(r['t'] as number).toISOString().split('T')[0]! : null,
        (r['o'] as number | null | undefined) ?? null,
        (r['h'] as number | null | undefined) ?? null,
        (r['l'] as number | null | undefined) ?? null,
        (r['c'] as number | null | undefined) ?? null,
        (r['v'] as number | null | undefined) ?? null,
        (r['vw'] as number | null | undefined) ?? null,
        (r['n'] as number | null | undefined) ?? null,
      ]);
      return {
        headers: ['date', 'open', 'high', 'low', 'close', 'volume', 'vwap', 'transactions'],
        rows,
        metadata: this.meta(endpoint, rows.length),
      };
    }

    // Snapshot
    if (endpoint === 'snapshot/ticker' && data['ticker']) {
      const t = data['ticker'] as Record<string, unknown>;
      const day = t['day'] as Record<string, unknown> | undefined;
      return {
        headers: ['ticker', 'todaysChange', 'todaysChangePerc', 'close', 'volume'],
        rows: [
          [
            (t['ticker'] as string | undefined) ?? null,
            (t['todaysChange'] as number | undefined) ?? null,
            (t['todaysChangePerc'] as number | undefined) ?? null,
            (day?.['c'] as number | undefined) ?? null,
            (day?.['v'] as number | undefined) ?? null,
          ],
        ],
        metadata: this.meta(endpoint, 1),
      };
    }

    // Reference tickers
    if (endpoint === 'reference/tickers' && data['results'] && Array.isArray(data['results'])) {
      const results = data['results'] as Record<string, unknown>[];
      const rows = results.map((r) => [
        (r['ticker'] as string) ?? null,
        (r['name'] as string) ?? null,
        (r['market'] as string) ?? null,
        (r['type'] as string) ?? null,
        (r['active'] as boolean) ?? null,
        (r['locale'] as string) ?? null,
      ]);
      return {
        headers: ['ticker', 'name', 'market', 'type', 'active', 'locale'],
        rows,
        metadata: this.meta(endpoint, rows.length),
      };
    }

    // Ticker details
    if (endpoint === 'reference/ticker-details' && data['results']) {
      const r = data['results'] as Record<string, unknown>;
      return {
        headers: [
          'ticker',
          'name',
          'market',
          'type',
          'description',
          'homepage_url',
          'total_employees',
          'list_date',
        ],
        rows: [
          [
            (r['ticker'] as string) ?? null,
            (r['name'] as string) ?? null,
            (r['market'] as string) ?? null,
            (r['type'] as string) ?? null,
            (r['description'] as string)?.slice(0, 200) ?? null,
            (r['homepage_url'] as string) ?? null,
            (r['total_employees'] as number) ?? null,
            (r['list_date'] as string) ?? null,
          ],
        ],
        metadata: this.meta(endpoint, 1),
      };
    }

    // Open/Close
    if (endpoint === 'open-close') {
      return {
        headers: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'],
        rows: [
          [
            (data['symbol'] as string) ?? null,
            (data['from'] as string) ?? null,
            (data['open'] as number) ?? null,
            (data['high'] as number) ?? null,
            (data['low'] as number) ?? null,
            (data['close'] as number) ?? null,
            (data['volume'] as number) ?? null,
          ],
        ],
        metadata: this.meta(endpoint, 1),
      };
    }

    // Grouped daily
    if (endpoint === 'grouped/daily' && data['results'] && Array.isArray(data['results'])) {
      const results = data['results'] as Record<string, unknown>[];
      const rows = results.map((r) => [
        (r['T'] as string) ?? null,
        (r['o'] as number) ?? null,
        (r['h'] as number) ?? null,
        (r['l'] as number) ?? null,
        (r['c'] as number) ?? null,
        (r['v'] as number) ?? null,
      ]);
      return {
        headers: ['ticker', 'open', 'high', 'low', 'close', 'volume'],
        rows,
        metadata: this.meta(endpoint, rows.length),
      };
    }

    // Fallback
    return {
      headers: ['data'],
      rows: [[JSON.stringify(data)]],
      metadata: this.meta(endpoint, 1),
    };
  }

  private meta(endpoint: string, rowCount: number): DataResult['metadata'] {
    return {
      source: 'polygon',
      endpoint,
      fetchedAt: new Date().toISOString(),
      rowCount,
      cached: false,
      quotaUsed: 1,
    };
  }
}
