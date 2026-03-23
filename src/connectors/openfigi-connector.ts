/**
 * ServalSheets - OpenFIGI Connector
 *
 * Provides access to the OpenFIGI identifier mapping service.
 * Maps securities across multiple identifier schemes and returns comprehensive security metadata.
 * Endpoints: mapping (map identifiers to FIGIs), search (search securities by various criteria)
 *
 * Auth: API key (optional, for rate limit increase)
 * Rate limiting: 25 requests per minute (free tier), 100+ with API key
 * Docs: https://www.openfigi.com/api
 */

import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
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

const BASE_URL = 'https://api.openfigi.com/v3';
const FREE_TIER_RPM = 25;
const PAID_TIER_RPM = 100;

export class OpenFigiConnector implements SpreadsheetConnector {
  readonly id = 'openfigi';
  readonly name = 'OpenFIGI';
  readonly description =
    'OpenFIGI identifier mapping: map between ticker, ISIN, CUSIP, SEDOL, FIGI and search securities';
  readonly authType = 'api_key' as const;

  private apiKey: string | null = null;
  private configured = false;
  private requestCount = 0;
  private lastResetTime = Date.now();
  private paidTier = false;

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    if (credentials.apiKey) {
      this.apiKey = credentials.apiKey;
      this.paidTier = true;
    }
    this.configured = true;
    logger.info(`OpenFIGI connector configured (${this.paidTier ? 'paid' : 'free'} tier)`);
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['X-OPENFIGI-APIKEY'] = this.apiKey;
      }

      // Test with a simple ISIN search
      const resp = await fetch(`${BASE_URL}/search?query=Apple`, {
        method: 'GET',
        headers,
      });

      const latency = Date.now() - start;
      return {
        healthy: resp.ok,
        latencyMs: latency,
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
    this.paidTier = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return [
      {
        id: 'mapping',
        name: 'Identifier Mapping',
        description: 'Map securities between different identifier schemes (ticker, ISIN, CUSIP, SEDOL, etc.)',
        category: 'mapping',
        params: [
          {
            name: 'idType',
            type: 'string',
            required: true,
            description: 'Input identifier type (TICKER, ISIN, CUSIP, SEDOL, FIGI, etc.)',
            example: 'TICKER',
          },
          {
            name: 'idValue',
            type: 'string',
            required: true,
            description: 'Value of the identifier',
            example: 'AAPL',
          },
          {
            name: 'exchCode',
            type: 'string',
            required: false,
            description: 'Exchange code (for ticker disambiguation)',
            example: 'US',
          },
          {
            name: 'micCode',
            type: 'string',
            required: false,
            description: 'Market Identifier Code',
            example: 'XNAS',
          },
        ],
      },
      {
        id: 'search',
        name: 'Security Search',
        description: 'Search for securities by name, ticker, or ISIN',
        category: 'search',
        params: [
          {
            name: 'query',
            type: 'string',
            required: true,
            description: 'Search query (company name, ticker, ISIN)',
            example: 'Apple',
          },
          {
            name: 'assetClass',
            type: 'string',
            required: false,
            description: 'Asset class filter (Equity, Fixed Income, etc.)',
            example: 'Equity',
          },
          {
            name: 'marketSector',
            type: 'string',
            required: false,
            description: 'Market sector filter',
            example: 'Technology',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    switch (endpoint) {
      case 'mapping':
        return {
          endpoint: 'mapping',
          columns: [
            { name: 'figi', type: 'string', description: 'Financial Instrument Global Identifier' },
            { name: 'ticker', type: 'string', description: 'Ticker symbol' },
            { name: 'exchCode', type: 'string', description: 'Exchange code' },
            { name: 'name', type: 'string', description: 'Security name' },
            { name: 'isin', type: 'string', description: 'International Securities Identification Number' },
            { name: 'cusip', type: 'string', description: 'Committee on Uniform Security Identification Procedures' },
            { name: 'sedol', type: 'string', description: 'Stock Exchange Daily Official List' },
            { name: 'composite_figi', type: 'string', description: 'Composite FIGI' },
            { name: 'security_type', type: 'string', description: 'Type of security' },
            { name: 'market_sector', type: 'string', description: 'Market sector classification' },
          ],
          sampleRow: {
            figi: 'BBG000B9XRY4',
            ticker: 'AAPL',
            exchCode: 'US',
            name: 'Apple Inc',
            isin: 'US0378331005',
            cusip: '037833100',
            sedol: '2046251',
            composite_figi: 'BBG000B9XRY4',
            security_type: 'Common Stock',
            market_sector: 'Technology',
          },
        };
      case 'search':
        return {
          endpoint: 'search',
          columns: [
            { name: 'figi', type: 'string', description: 'Financial Instrument Global Identifier' },
            { name: 'name', type: 'string', description: 'Security name' },
            { name: 'ticker', type: 'string', description: 'Ticker symbol' },
            { name: 'exchCode', type: 'string', description: 'Exchange code' },
            { name: 'assetClass', type: 'string', description: 'Asset class (Equity, Fixed Income, etc.)' },
            { name: 'marketSector', type: 'string', description: 'Market sector' },
            { name: 'countryCode', type: 'string', description: 'Country code' },
            { name: 'securityType', type: 'string', description: 'Security type' },
          ],
        };
      default:
        throw new ServiceError(`Unknown endpoint: ${endpoint}`, 'CONNECTOR_ERROR', 'openfigi');
    }
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    // Enforce rate limits
    await this.enforceRateLimit();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-OPENFIGI-APIKEY'] = this.apiKey;
    }

    try {
      switch (endpoint) {
        case 'mapping': {
          const idType = params['idType'] as string;
          const idValue = params['idValue'] as string;

          const payload = {
            idType,
            idValue,
            ...(params['exchCode'] && { exchCode: params['exchCode'] }),
            ...(params['micCode'] && { micCode: params['micCode'] }),
          };

          const resp = await fetch(`${BASE_URL}/mapping`, {
            method: 'POST',
            headers,
            body: JSON.stringify([payload]),
          });

          if (!resp.ok) {
            throw new ServiceError(`OpenFIGI API returned ${resp.status}`, 'CONNECTOR_ERROR', 'openfigi');
          }

          const data = (await resp.json()) as Array<Record<string, unknown>>;
          const result = data[0] || {};
          const data_result = (result['data'] || []) as Array<Record<string, unknown>>;

          const rows = data_result.map((d) => [
            String(d['figi'] || ''),
            String(d['ticker'] || ''),
            String(d['exchCode'] || ''),
            String(d['name'] || ''),
            String(d['isin'] || ''),
            String(d['cusip'] || ''),
            String(d['sedol'] || ''),
            String(d['compositeFigi'] || ''),
            String(d['securityType'] || ''),
            String(d['marketSector'] || ''),
          ]);

          return {
            headers: ['figi', 'ticker', 'exchCode', 'name', 'isin', 'cusip', 'sedol', 'composite_figi', 'security_type', 'market_sector'],
            rows,
            metadata: {
              source: 'OpenFIGI',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: rows.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        case 'search': {
          const query = params['query'] as string;
          const assetClass = params['assetClass'] ? `&assetClass=${encodeURIComponent(String(params['assetClass']))}` : '';
          const sector = params['marketSector'] ? `&marketSector=${encodeURIComponent(String(params['marketSector']))}` : '';

          const url = `${BASE_URL}/search?query=${encodeURIComponent(query)}${assetClass}${sector}`;

          const resp = await fetch(url, { headers, method: 'GET' });

          if (!resp.ok) {
            throw new ServiceError(`Search failed: ${resp.status}`, 'CONNECTOR_ERROR', 'openfigi');
          }

          const searchData = (await resp.json()) as Record<string, unknown>;
          const results = (searchData['result'] || []) as Array<Record<string, unknown>>;

          const rows = results.slice(0, 100).map((r) => [
            String(r['figi'] || ''),
            String(r['name'] || ''),
            String(r['ticker'] || ''),
            String(r['exchCode'] || ''),
            String(r['assetClass'] || ''),
            String(r['marketSector'] || ''),
            String((r['country'] || r['countryCode']) || ''),
            String(r['securityType'] || ''),
          ]);

          return {
            headers: ['figi', 'name', 'ticker', 'exchCode', 'assetClass', 'marketSector', 'countryCode', 'securityType'],
            rows,
            metadata: {
              source: 'OpenFIGI',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: rows.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        default:
          throw new ServiceError(`Unknown endpoint: ${endpoint}`, 'CONNECTOR_ERROR', 'openfigi');
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(
        err instanceof Error ? err.message : 'OpenFIGI query failed',
        'DATA_ERROR',
        'openfigi'
      );
    }
  }

  getQuotaUsage(): QuotaStatus {
    const now = Date.now();
    const msPerMin = 60000;
    if (now - this.lastResetTime > msPerMin) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    const limit = this.paidTier ? PAID_TIER_RPM : FREE_TIER_RPM;

    return {
      used: this.requestCount,
      limit,
      resetAt: new Date(this.lastResetTime + msPerMin).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    const rpmLimit = this.paidTier ? PAID_TIER_RPM : FREE_TIER_RPM;
    return {
      requestsPerMinute: rpmLimit,
      requestsPerDay: rpmLimit * 1440,
      burstLimit: 10,
    };
  }

  private async enforceRateLimit(): Promise<void> {
    const limit = this.paidTier ? PAID_TIER_RPM : FREE_TIER_RPM;
    const now = Date.now();
    const msPerMin = 60000;

    if (now - this.lastResetTime > msPerMin) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }

    if (this.requestCount >= limit) {
      const waitTime = this.lastResetTime + msPerMin - now;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        this.requestCount = 0;
        this.lastResetTime = Date.now();
      }
    }

    this.requestCount++;
  }
}
