/**
 * ServalSheets - Financial Modeling Prep (FMP) Connector
 *
 * Comprehensive financial data: income statements, balance sheets, cash flows,
 * financial ratios, DCF models, stock screeners, and market indices.
 *
 * Auth: API key (free tier: 250 req/day)
 * Docs: https://financialmodelingprep.com/developer/docs/
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

const BASE_URL = 'https://financialmodelingprep.com/api/v3';

export class FmpConnector implements SpreadsheetConnector {
  readonly id = 'fmp';
  readonly name = 'Financial Modeling Prep';
  readonly description =
    'Financial statements, ratios, DCF valuations, stock screeners, and market indices';
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
        'FMP requires an API key. Get one at https://financialmodelingprep.com/developer',
        'FMP_API_KEY'
      );
    }
    this.apiKey = credentials.apiKey;
    this.configured = true;
    logger.info('FMP connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/stock/list?apikey=${this.apiKey}`);
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
        id: 'income-statement',
        name: 'Income Statement',
        description: 'Annual or quarterly income statements',
        category: 'financials',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'period',
            type: 'string',
            required: false,
            description: 'annual or quarter',
            example: 'annual',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Number of periods',
            example: '5',
          },
        ],
      },
      {
        id: 'balance-sheet-statement',
        name: 'Balance Sheet',
        description: 'Annual or quarterly balance sheets',
        category: 'financials',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'period',
            type: 'string',
            required: false,
            description: 'annual or quarter',
            example: 'annual',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Number of periods',
            example: '5',
          },
        ],
      },
      {
        id: 'cash-flow-statement',
        name: 'Cash Flow Statement',
        description: 'Annual or quarterly cash flow statements',
        category: 'financials',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'period',
            type: 'string',
            required: false,
            description: 'annual or quarter',
            example: 'annual',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Number of periods',
            example: '5',
          },
        ],
      },
      {
        id: 'ratios',
        name: 'Financial Ratios',
        description: 'Key financial ratios (P/E, ROE, debt/equity, etc.)',
        category: 'analysis',
        params: [
          {
            name: 'symbol',
            type: 'string',
            required: true,
            description: 'Ticker symbol',
            example: 'AAPL',
          },
          {
            name: 'period',
            type: 'string',
            required: false,
            description: 'annual or quarter',
            example: 'annual',
          },
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Number of periods',
            example: '5',
          },
        ],
      },
      {
        id: 'discounted-cash-flow',
        name: 'DCF Valuation',
        description: 'Discounted Cash Flow intrinsic value',
        category: 'valuation',
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
        id: 'quote',
        name: 'Stock Quote',
        description: 'Real-time stock quote with fundamentals',
        category: 'market_data',
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
        id: 'stock-screener',
        name: 'Stock Screener',
        description: 'Screen stocks by market cap, sector, price, beta, and more',
        category: 'screening',
        params: [
          {
            name: 'marketCapMoreThan',
            type: 'number',
            required: false,
            description: 'Min market cap',
            example: '1000000000',
          },
          {
            name: 'marketCapLowerThan',
            type: 'number',
            required: false,
            description: 'Max market cap',
          },
          {
            name: 'sector',
            type: 'string',
            required: false,
            description: 'Sector filter',
            example: 'Technology',
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
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'income-statement': {
        endpoint: 'income-statement',
        columns: [
          { name: 'date', type: 'date', description: 'Period date' },
          { name: 'revenue', type: 'number', description: 'Total revenue' },
          { name: 'costOfRevenue', type: 'number', description: 'Cost of revenue' },
          { name: 'grossProfit', type: 'number', description: 'Gross profit' },
          { name: 'operatingIncome', type: 'number', description: 'Operating income' },
          { name: 'netIncome', type: 'number', description: 'Net income' },
          { name: 'eps', type: 'number', description: 'Earnings per share' },
          { name: 'epsdiluted', type: 'number', description: 'Diluted EPS' },
        ],
      },
      quote: {
        endpoint: 'quote',
        columns: [
          { name: 'symbol', type: 'string', description: 'Ticker' },
          { name: 'name', type: 'string', description: 'Company name' },
          { name: 'price', type: 'number', description: 'Current price' },
          { name: 'changesPercentage', type: 'number', description: 'Day change %' },
          { name: 'marketCap', type: 'number', description: 'Market cap' },
          { name: 'pe', type: 'number', description: 'P/E ratio' },
          { name: 'volume', type: 'number', description: 'Volume' },
        ],
      },
    };
    return schemas[endpoint] ?? { endpoint, columns: [] };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();

    // FMP uses path-based symbols for some endpoints
    const symbol = params['symbol'] as string | undefined;
    let url: string;

    if (
      symbol &&
      [
        'income-statement',
        'balance-sheet-statement',
        'cash-flow-statement',
        'ratios',
        'discounted-cash-flow',
        'quote',
      ].includes(endpoint)
    ) {
      const queryParams = { ...params };
      delete queryParams['symbol'];
      url = this.buildUrl(`${endpoint}/${symbol}`, queryParams);
    } else {
      url = this.buildUrl(endpoint, params);
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new ServiceError(
        `FMP API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'fmp',
        true
      );
    }
    const data = (await resp.json()) as unknown;
    return this.formatResult(endpoint, data);
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 250,
      resetAt: new Date(this.lastResetTime + 86_400_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 30,
      requestsPerDay: 250,
    };
  }

  private buildUrl(endpoint: string, params: QueryParams): string {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('apikey', this.apiKey!);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 86_400_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private formatResult(endpoint: string, data: unknown): DataResult {
    if (!Array.isArray(data)) {
      // Single object response (e.g., DCF)
      const obj = data as Record<string, unknown>;
      const headers = Object.keys(obj).filter((k) => typeof obj[k] !== 'object' || obj[k] === null);
      const row = headers.map((h) => {
        const v = obj[h];
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
        return String(v);
      });
      return {
        headers,
        rows: [row],
        metadata: {
          source: 'fmp',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: 1,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    // Array response — extract consistent headers from first item
    if (data.length === 0) {
      return {
        headers: [],
        rows: [],
        metadata: {
          source: 'fmp',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: 0,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    const first = data[0] as Record<string, unknown>;
    const headers = Object.keys(first).filter(
      (k) => typeof first[k] !== 'object' || first[k] === null
    );
    const rows = (data as Record<string, unknown>[]).map((item) =>
      headers.map((h) => {
        const v = item[h];
        if (v === null || v === undefined) return null;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
        return String(v);
      })
    );

    return {
      headers,
      rows,
      metadata: {
        source: 'fmp',
        endpoint,
        fetchedAt: new Date().toISOString(),
        rowCount: rows.length,
        cached: false,
        quotaUsed: 1,
      },
    };
  }
}
