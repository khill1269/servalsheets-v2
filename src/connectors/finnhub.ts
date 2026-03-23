/**
 * ServalSheets - Finnhub Connector
 *
 * Provides real-time and historical market data from Finnhub.io.
 * Endpoints: stock/quote, stock/candle, forex/rates, crypto/candle, company/profile2,
 *           stock/metric, stock/recommendation, calendar/earnings
 *
 * Auth: API key (free tier: 60 req/min, 30 symbols)
 * Docs: https://finnhub.io/docs/api
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

const BASE_URL = 'https://finnhub.io/api/v1';

export class FinnhubConnector implements SpreadsheetConnector {
  readonly id = 'finnhub';
  readonly name = 'Finnhub';
  readonly description =
    'Real-time stock quotes, forex rates, crypto prices, company fundamentals, and earnings calendars';
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
        'Finnhub requires an API key. Get one free at https://finnhub.io/register',
        'FINNHUB_API_KEY'
      );
    }
    this.apiKey = credentials.apiKey;
    this.configured = true;
    logger.info('Finnhub connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/stock/symbol?exchange=US&token=${this.apiKey}`);
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
        id: 'stock/quote',
        name: 'Stock Quote',
        description: 'Real-time stock price quote',
        category: 'stocks',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Stock ticker symbol',
            example: 'AAPL',
          },
        ],
      },
      {
        id: 'stock/candle',
        name: 'Stock Candles',
        description: 'Historical OHLCV candle data',
        category: 'stocks',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'resolution',
            type: 'string',
            required: true,
            description: 'Candle resolution (1, 5, 15, 30, 60, D, W, M)',
            example: 'D',
          },
          {
            name: 'from',
            type: 'number',
            required: true,
            description: 'UNIX timestamp start',
            example: '1672531200',
          },
          {
            name: 'to',
            type: 'number',
            required: true,
            description: 'UNIX timestamp end',
            example: '1704067200',
          },
        ],
      },
      {
        id: 'forex/rates',
        name: 'Forex Exchange Rates',
        description: 'Real-time forex exchange rates',
        category: 'forex',
        params: [
          {
            name: 'base',
            type: 'string',
            required: false,
            description: 'Base currency',
            example: 'USD',
          },
        ],
      },
      {
        id: 'company/profile2',
        name: 'Company Profile',
        description: 'Company information and fundamentals',
        category: 'fundamentals',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
        ],
      },
      {
        id: 'stock/metric',
        name: 'Financial Metrics',
        description: 'Key financial metrics and ratios',
        category: 'fundamentals',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'metric',
            type: 'string',
            required: true,
            description: 'Metric type',
            example: 'all',
          },
        ],
      },
      {
        id: 'stock/recommendation',
        name: 'Analyst Recommendations',
        description: 'Latest analyst recommendation trends',
        category: 'analysis',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
        ],
      },
      {
        id: 'calendar/earnings',
        name: 'Earnings Calendar',
        description: 'Upcoming and past earnings dates',
        category: 'calendar',
        params: [
          {
            name: 'from',
            type: 'string',
            required: false,
            description: 'From date (YYYY-MM-DD)',
            example: '2026-01-01',
          },
          {
            name: 'to',
            type: 'string',
            required: false,
            description: 'To date (YYYY-MM-DD)',
            example: '2026-03-31',
          },
          {
            name: 'symbol',
            type: 'string',
            required: false,
            description: 'Filter by symbol',
            example: 'AAPL',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'stock/quote': {
        endpoint: 'stock/quote',
        columns: [
          { name: 'c', type: 'number', description: 'Current price' },
          { name: 'd', type: 'number', description: 'Change' },
          { name: 'dp', type: 'number', description: 'Percent change' },
          { name: 'h', type: 'number', description: 'High price of the day' },
          { name: 'l', type: 'number', description: 'Low price of the day' },
          { name: 'o', type: 'number', description: 'Open price of the day' },
          { name: 'pc', type: 'number', description: 'Previous close price' },
          { name: 't', type: 'number', description: 'Timestamp' },
        ],
      },
      'stock/candle': {
        endpoint: 'stock/candle',
        columns: [
          { name: 'date', type: 'date', description: 'Date' },
          { name: 'open', type: 'number', description: 'Open price' },
          { name: 'high', type: 'number', description: 'High price' },
          { name: 'low', type: 'number', description: 'Low price' },
          { name: 'close', type: 'number', description: 'Close price' },
          { name: 'volume', type: 'number', description: 'Volume' },
        ],
      },
      'company/profile2': {
        endpoint: 'company/profile2',
        columns: [
          { name: 'name', type: 'string', description: 'Company name' },
          { name: 'ticker', type: 'string', description: 'Ticker' },
          { name: 'country', type: 'string', description: 'Country' },
          { name: 'exchange', type: 'string', description: 'Exchange' },
          { name: 'ipo', type: 'date', description: 'IPO date' },
          { name: 'marketCapitalization', type: 'number', description: 'Market cap (millions)' },
          { name: 'finnhubIndustry', type: 'string', description: 'Industry' },
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
        `Finnhub API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'finnhub',
        true
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;
    return this.formatResult(endpoint, data, params);
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 60,
      resetAt: new Date(this.lastResetTime + 60_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 60,
      requestsPerDay: 500,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private buildUrl(endpoint: string, params: QueryParams): string {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('token', this.apiKey!);
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

  private formatResult(
    endpoint: string,
    data: Record<string, unknown>,
    _params: QueryParams
  ): DataResult {
    // Candle data comes as parallel arrays
    if (endpoint === 'stock/candle' && data['s'] === 'ok') {
      const timestamps = data['t'] as number[];
      const opens = data['o'] as number[];
      const highs = data['h'] as number[];
      const lows = data['l'] as number[];
      const closes = data['c'] as number[];
      const volumes = data['v'] as number[];
      const rows = timestamps.map((t, i) => [
        new Date(t * 1000).toISOString().split('T')[0]!,
        opens[i] ?? null,
        highs[i] ?? null,
        lows[i] ?? null,
        closes[i] ?? null,
        volumes[i] ?? null,
      ]);
      return {
        headers: ['date', 'open', 'high', 'low', 'close', 'volume'],
        rows,
        metadata: {
          source: 'finnhub',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    // Quote data is a flat object
    if (endpoint === 'stock/quote') {
      const row = [
        (data['c'] as number) ?? null,
        (data['d'] as number) ?? null,
        (data['dp'] as number) ?? null,
        (data['h'] as number) ?? null,
        (data['l'] as number) ?? null,
        (data['o'] as number) ?? null,
        (data['pc'] as number) ?? null,
        (data['t'] as number) ?? null,
      ];
      return {
        headers: [
          'current',
          'change',
          'percent_change',
          'high',
          'low',
          'open',
          'prev_close',
          'timestamp',
        ],
        rows: [row],
        metadata: {
          source: 'finnhub',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: 1,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    // Recommendation array
    if (endpoint === 'stock/recommendation' && Array.isArray(data)) {
      const rows = (data as Record<string, unknown>[]).map((r) => [
        (r['period'] as string) ?? null,
        (r['strongBuy'] as number) ?? null,
        (r['buy'] as number) ?? null,
        (r['hold'] as number) ?? null,
        (r['sell'] as number) ?? null,
        (r['strongSell'] as number) ?? null,
      ]);
      return {
        headers: ['period', 'strong_buy', 'buy', 'hold', 'sell', 'strong_sell'],
        rows,
        metadata: {
          source: 'finnhub',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    // Generic: single object → one row
    return this.objectToResult(endpoint, data);
  }

  private objectToResult(endpoint: string, data: Record<string, unknown>): DataResult {
    const headers = Object.keys(data).filter(
      (k) => typeof data[k] !== 'object' || data[k] === null
    );
    const row = headers.map((h) => {
      const val = data[h];
      if (val === null || val === undefined) return null;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')
        return val;
      return String(val);
    });
    return {
      headers,
      rows: [row],
      metadata: {
        source: 'finnhub',
        endpoint,
        fetchedAt: new Date().toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }
}
