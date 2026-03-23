/**
 * ServalSheets - Alpha Vantage Connector
 *
 * Stock time series, technical indicators, forex, crypto, and economic data.
 *
 * Auth: API key (free tier: 25 req/day, premium: 75-1200 req/min)
 * Docs: https://www.alphavantage.co/documentation/
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

const BASE_URL = 'https://www.alphavantage.co/query';

export class AlphaVantageConnector implements SpreadsheetConnector {
  readonly id = 'alpha_vantage';
  readonly name = 'Alpha Vantage';
  readonly description =
    'Stock time series, technical indicators (SMA, EMA, RSI, MACD), forex, crypto, and economic indicators';
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
        'Alpha Vantage requires an API key. Get one free at https://www.alphavantage.co/support/#api-key',
        'ALPHA_VANTAGE_API_KEY'
      );
    }
    this.apiKey = credentials.apiKey;
    this.configured = true;
    logger.info('Alpha Vantage connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(
        `${BASE_URL}?function=TIME_SERIES_INTRADAY&symbol=IBM&interval=5min&apikey=${this.apiKey}`
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
        id: 'TIME_SERIES_DAILY',
        name: 'Daily Time Series',
        description: 'Daily OHLCV data for a stock',
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
            name: 'outputsize',
            type: 'string',
            required: false,
            description: 'compact (100 pts) or full (20+ yrs)',
            example: 'compact',
          },
        ],
      },
      {
        id: 'TIME_SERIES_WEEKLY',
        name: 'Weekly Time Series',
        description: 'Weekly OHLCV data for a stock',
        category: 'stocks',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'MSFT',
          },
        ],
      },
      {
        id: 'GLOBAL_QUOTE',
        name: 'Global Quote',
        description: 'Latest price and volume data',
        category: 'stocks',
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
        id: 'SMA',
        name: 'Simple Moving Average',
        description: 'SMA technical indicator',
        category: 'technical',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker',
            example: 'AAPL',
          },
          {
            name: 'interval',
            type: 'string',
            required: true,
            description: 'Time interval',
            example: 'daily',
          },
          {
            name: 'time_period',
            type: 'number',
            required: true,
            description: 'Number of periods',
            example: '50',
          },
          {
            name: 'series_type',
            type: 'string',
            required: true,
            description: 'Price type',
            example: 'close',
          },
        ],
      },
      {
        id: 'RSI',
        name: 'Relative Strength Index',
        description: 'RSI technical indicator',
        category: 'technical',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker',
            example: 'AAPL',
          },
          {
            name: 'interval',
            type: 'string',
            required: true,
            description: 'Time interval',
            example: 'daily',
          },
          {
            name: 'time_period',
            type: 'number',
            required: true,
            description: 'Number of periods',
            example: '14',
          },
          {
            name: 'series_type',
            type: 'string',
            required: true,
            description: 'Price type',
            example: 'close',
          },
        ],
      },
      {
        id: 'CURRENCY_EXCHANGE_RATE',
        name: 'Currency Exchange Rate',
        description: 'Real-time currency exchange rate',
        category: 'forex',
        params: [
          {
            name: 'from_currency',
            type: 'string',
            required: true,
            description: 'From currency',
            example: 'USD',
          },
          {
            name: 'to_currency',
            type: 'string',
            required: true,
            description: 'To currency',
            example: 'EUR',
          },
        ],
      },
      {
        id: 'REAL_GDP',
        name: 'Real GDP',
        description: 'US Real GDP (annual & quarterly)',
        category: 'economic',
        params: [
          {
            name: 'interval',
            type: 'string',
            required: false,
            description: 'annual or quarterly',
            example: 'quarterly',
          },
        ],
      },
      {
        id: 'CPI',
        name: 'Consumer Price Index',
        description: 'US CPI (monthly & semiannual)',
        category: 'economic',
        params: [
          {
            name: 'interval',
            type: 'string',
            required: false,
            description: 'monthly or semiannual',
            example: 'monthly',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      TIME_SERIES_DAILY: {
        endpoint: 'TIME_SERIES_DAILY',
        columns: [
          { name: 'date', type: 'date', description: 'Trading date' },
          { name: 'open', type: 'number', description: 'Open price' },
          { name: 'high', type: 'number', description: 'High price' },
          { name: 'low', type: 'number', description: 'Low price' },
          { name: 'close', type: 'number', description: 'Close price' },
          { name: 'volume', type: 'number', description: 'Volume' },
        ],
      },
      GLOBAL_QUOTE: {
        endpoint: 'GLOBAL_QUOTE',
        columns: [
          { name: 'symbol', type: 'string', description: 'Symbol' },
          { name: 'price', type: 'number', description: 'Current price' },
          { name: 'change', type: 'number', description: 'Change' },
          { name: 'change_percent', type: 'string', description: 'Change %' },
          { name: 'volume', type: 'number', description: 'Volume' },
          { name: 'latest_day', type: 'date', description: 'Latest trading day' },
        ],
      },
    };
    return schemas[endpoint] ?? { endpoint, columns: [] };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();
    const url = new URL(BASE_URL);
    url.searchParams.set('function', endpoint);
    url.searchParams.set('apikey', this.apiKey!);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new ServiceError(
        `Alpha Vantage API error: HTTP ${resp.status}`,
        'INTERNAL_ERROR',
        'alpha-vantage',
        true
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;

    // Check for API error messages
    if (data['Error Message']) {
      throw new ServiceError(
        `Alpha Vantage: ${data['Error Message']}`,
        'INTERNAL_ERROR',
        'alpha-vantage',
        false
      );
    }
    if (data['Note']) {
      throw new ServiceError(
        `Alpha Vantage rate limit: ${data['Note']}`,
        'QUOTA_EXCEEDED',
        'alpha-vantage',
        true
      );
    }

    return this.formatResult(endpoint, data);
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 25,
      resetAt: new Date(this.lastResetTime + 86_400_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 5,
      requestsPerDay: 25,
    };
  }

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 86_400_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private formatResult(endpoint: string, data: Record<string, unknown>): DataResult {
    // Time series endpoints have a "Time Series (Daily)" key pattern
    const tsKey = Object.keys(data).find(
      (k) => k.startsWith('Time Series') || k.startsWith('Technical Analysis')
    );
    if (tsKey) {
      const tsData = data[tsKey] as Record<string, Record<string, string>>;
      const dates = Object.keys(tsData).sort();
      if (dates.length === 0) {
        return { headers: ['date'], rows: [], metadata: this.meta(endpoint, 0) };
      }
      const firstEntry = tsData[dates[0]!]!;
      const fieldKeys = Object.keys(firstEntry);
      const cleanHeaders = ['date', ...fieldKeys.map((k) => k.replace(/^\d+\.\s*/, ''))];
      const rows = dates.map((date) => {
        const entry = tsData[date]!;
        return [
          date,
          ...fieldKeys.map((fk) => {
            const v = entry[fk];
            return v !== undefined ? Number(v) : null;
          }),
        ];
      });
      return { headers: cleanHeaders, rows, metadata: this.meta(endpoint, rows.length) };
    }

    // Global Quote
    if (data['Global Quote']) {
      const q = data['Global Quote'] as Record<string, string>;
      return {
        headers: ['symbol', 'price', 'change', 'change_percent', 'volume', 'latest_day'],
        rows: [
          [
            q['01. symbol'] ?? null,
            Number(q['05. price']) || null,
            Number(q['09. change']) || null,
            q['10. change percent'] ?? null,
            Number(q['06. volume']) || null,
            q['07. latest trading day'] ?? null,
          ],
        ],
        metadata: this.meta(endpoint, 1),
      };
    }

    // Currency Exchange Rate
    if (data['Realtime Currency Exchange Rate']) {
      const rate = data['Realtime Currency Exchange Rate'] as Record<string, string>;
      return {
        headers: ['from', 'to', 'rate', 'last_refreshed'],
        rows: [
          [
            rate['1. From_Currency Code'] ?? null,
            rate['3. To_Currency Code'] ?? null,
            Number(rate['5. Exchange Rate']) || null,
            rate['6. Last Refreshed'] ?? null,
          ],
        ],
        metadata: this.meta(endpoint, 1),
      };
    }

    // Economic indicators (array of {date, value})
    if (data['data'] && Array.isArray(data['data'])) {
      const items = data['data'] as { date: string; value: string }[];
      const rows = items.map((item) => [item.date, item.value === '.' ? null : Number(item.value)]);
      return { headers: ['date', 'value'], rows, metadata: this.meta(endpoint, rows.length) };
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
      source: 'alpha_vantage',
      endpoint,
      fetchedAt: new Date().toISOString(),
      rowCount,
      cached: false,
      quotaUsed: 1,
    };
  }
}
