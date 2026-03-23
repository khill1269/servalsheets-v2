/**
 * ServalSheets - SEC EDGAR Connector
 *
 * Provides access to the U.S. Securities and Exchange Commission (SEC) EDGAR database.
 * Endpoints: company_filings (filings by CIK/ticker), filing_content (filing text),
 *           company_facts (XBRL company facts)
 *
 * Auth: User-Agent header required per SEC fair access policy
 * Rate limiting: 10 requests per second (enforced by SEC)
 * Docs: https://www.sec.gov/cgi-bin/browse-edgar
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

const BASE_URL = 'https://data.sec.gov';
const REQUEST_DELAY_MS = 100; // 10 req/sec = 100ms min between requests

export class SecEdgarConnector implements SpreadsheetConnector {
  readonly id = 'sec_edgar';
  readonly name = 'SEC EDGAR';
  readonly description =
    'U.S. SEC EDGAR database: company filings, financial statements (10-K, 10-Q), insider transactions, and XBRL data';
  readonly authType = 'api_key' as const;

  private userAgent: string = 'ServalSheets (https://github.com/anthropics/servalsheets)';
  private configured = false;
  private requestCount = 0;
  private lastRequestTime = 0;
  private lastResetTime = Date.now();

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    // SEC EDGAR doesn't require an API key, but we accept one for tracking/identification
    // User-Agent is what matters for fair access
    if (credentials.custom?.['userAgent']) {
      this.userAgent = credentials.custom['userAgent'];
    }
    this.configured = true;
    logger.info('SEC EDGAR connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/cgi-bin/browse-edgar?action=getcompany&company=apple&type=10-K&dateb=&owner=exclude&count=1&search_text=&json=1`, {
        headers: { 'User-Agent': this.userAgent },
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
    this.configured = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return [
      {
        id: 'company_filings',
        name: 'Company Filings',
        description: 'Search and list SEC filings by company CIK or ticker symbol',
        category: 'filings',
        params: [
          {
            name: 'company',
            type: 'string',
            required: true,
            description: 'Company name or CIK number',
            example: 'Apple',
          },
          {
            name: 'type',
            type: 'string',
            required: false,
            description: 'Filing type (10-K, 10-Q, 8-K, etc.)',
            example: '10-K',
          },
          {
            name: 'dateb',
            type: 'date',
            required: false,
            description: 'Filings before this date (YYYYMMDD)',
            example: '20240101',
          },
          {
            name: 'count',
            type: 'number',
            required: false,
            description: 'Number of results to return (default 40, max 100)',
            example: '40',
          },
        ],
      },
      {
        id: 'filing_content',
        name: 'Filing Content',
        description: 'Retrieve the full text of a specific SEC filing',
        category: 'filings',
        params: [
          {
            name: 'cik',
            type: 'string',
            required: true,
            description: 'CIK number (10-digit zero-padded)',
            example: '0000320193',
          },
          {
            name: 'accession',
            type: 'string',
            required: true,
            description: 'Accession number (format: XXXXXXXXXX-XX-XXXXXX)',
            example: '0000320193-23-000089',
          },
        ],
      },
      {
        id: 'company_facts',
        name: 'Company Facts (XBRL)',
        description: 'XBRL company facts: revenue, net income, assets, liabilities, etc.',
        category: 'facts',
        params: [
          {
            name: 'cik',
            type: 'string',
            required: true,
            description: 'CIK number (10-digit zero-padded)',
            example: '0000320193',
          },
          {
            name: 'taxonomy',
            type: 'string',
            required: false,
            description: 'XBRL taxonomy (us-gaap, ifrs, srt, etc.)',
            example: 'us-gaap',
          },
          {
            name: 'tag',
            type: 'string',
            required: false,
            description: 'Specific XBRL tag (e.g., NetIncomeLoss)',
            example: 'NetIncomeLoss',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    switch (endpoint) {
      case 'company_filings':
        return {
          endpoint: 'company_filings',
          columns: [
            { name: 'cik', type: 'string', description: 'Central Index Key (CIK)' },
            { name: 'entityName', type: 'string', description: 'Company name' },
            { name: 'type', type: 'string', description: 'Filing type (10-K, 10-Q, etc.)' },
            { name: 'dateB', type: 'date', description: 'Filing date' },
            { name: 'filename', type: 'string', description: 'Filename of the filing' },
            { name: 'accessionNumber', type: 'string', description: 'Accession number' },
          ],
        };
      case 'filing_content':
        return {
          endpoint: 'filing_content',
          columns: [
            { name: 'cik', type: 'string', description: 'CIK number' },
            { name: 'accession', type: 'string', description: 'Accession number' },
            { name: 'filingType', type: 'string', description: 'Type of filing' },
            { name: 'content', type: 'string', description: 'Full filing text (HTML or plain)' },
          ],
        };
      case 'company_facts':
        return {
          endpoint: 'company_facts',
          columns: [
            { name: 'cik', type: 'string', description: 'CIK number' },
            { name: 'tag', type: 'string', description: 'XBRL tag name' },
            { name: 'label', type: 'string', description: 'Human-readable label' },
            { name: 'units', type: 'string', description: 'Unit of measurement' },
            { name: 'value', type: 'number', description: 'Fact value' },
            { name: 'fillingDate', type: 'date', description: 'Filing date' },
          ],
        };
      default:
        throw new ServiceError(`Unknown endpoint: ${endpoint}`, 'NOT_FOUND', 'sec-edgar');
    }
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    // Enforce SEC rate limit (10 req/sec)
    await this.enforceRateLimit();

    let url = '';
    let headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json',
    };

    try {
      switch (endpoint) {
        case 'company_filings': {
          const company = params['company'] as string;
          const type = params['type'] ? `&type=${encodeURIComponent(params['type'] as string)}` : '';
          const dateb = params['dateb'] ? `&dateb=${encodeURIComponent(params['dateb'] as string)}` : '';
          const count = params['count'] || 40;

          url = `${BASE_URL}/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(company)}&owner=exclude&match=&count=${count}${type}${dateb}&json=1`;

          const resp = await fetch(url, { headers });
          if (!resp.ok) {
            throw new ServiceError(`SEC EDGAR API returned ${resp.status}`, 'UNAVAILABLE', 'sec-edgar');
          }

          const data = (await resp.json()) as Record<string, unknown>;
          const filingsData = (data['filings'] as Record<string, unknown> | undefined) || {};
          const filings = ((filingsData as Record<string, unknown>)['files'] || []) as Array<Record<string, unknown>>;

          return {
            headers: ['cik', 'entityName', 'type', 'dateB', 'filename', 'accessionNumber'],
            rows: filings.map((f) => [
              String(data['cik'] || ''),
              String(data['entityName'] || ''),
              String(f['type'] || ''),
              String(f['dateB'] || ''),
              String(f['filename'] || ''),
              String(f['accessionNumber'] || ''),
            ]),
            metadata: {
              source: 'SEC EDGAR',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: filings.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        case 'filing_content': {
          const cik = String(params['cik']).padStart(10, '0');
          const accession = params['accession'] as string;
          url = `${BASE_URL}/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${accession}&xbrl_type=v`;

          const resp = await fetch(url, { headers });
          if (!resp.ok) {
            throw new ServiceError(`Filing not found: ${accession}`, 'NOT_FOUND', 'sec-edgar');
          }

          const content = await resp.text();
          return {
            headers: ['cik', 'accession', 'filingType', 'content'],
            rows: [[cik, accession, params['type'] || 'Unknown', content.substring(0, 10000)]],
            metadata: {
              source: 'SEC EDGAR',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: 1,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        case 'company_facts': {
          const cik = String(params['cik']).padStart(10, '0');
          url = `${BASE_URL}/api/xbrl/companyfacts/CIK${cik}.json`;

          const resp = await fetch(url, { headers });
          if (!resp.ok) {
            throw new ServiceError(`Company facts not found: ${cik}`, 'NOT_FOUND', 'sec-edgar');
          }

          const data = (await resp.json()) as Record<string, unknown>;
          const facts = (data['us-gaap'] || {}) as Record<string, unknown>;
          const rows: (string | number | boolean | null)[][] = [];

          for (const [tag, tagData] of Object.entries(facts)) {
            if (
              typeof tagData === 'object' &&
              tagData !== null &&
              'units' in tagData &&
              typeof (tagData as Record<string, unknown>)['units'] === 'object'
            ) {
              const units = (tagData as Record<string, unknown>)['units'] as Record<string, unknown>;
              for (const [unit, values] of Object.entries(units)) {
                if (Array.isArray(values)) {
                  for (const val of values) {
                    if (typeof val === 'object' && val !== null) {
                      const valNum = (val as Record<string, unknown>)['val'];
                      const valFiled = (val as Record<string, unknown>)['filed'];
                      rows.push([
                        cik,
                        tag,
                        tag,
                        unit,
                        typeof valNum === 'string' || typeof valNum === 'number' || typeof valNum === 'boolean' ? valNum : null,
                        typeof valFiled === 'string' || typeof valFiled === 'number' || typeof valFiled === 'boolean' ? valFiled : null,
                      ]);
                    }
                  }
                }
              }
            }
          }

          return {
            headers: ['cik', 'tag', 'label', 'units', 'value', 'filingDate'],
            rows: rows.slice(0, 1000), // Limit to 1000 rows
            metadata: {
              source: 'SEC EDGAR',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: rows.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        default:
          throw new ServiceError(`Unknown endpoint: ${endpoint}`, 'NOT_FOUND', 'sec-edgar');
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(
        err instanceof Error ? err.message : 'SEC EDGAR query failed',
        'DATA_ERROR',
        'sec-edgar'
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

    return {
      used: this.requestCount,
      limit: 600, // 10 req/sec * 60 sec
      resetAt: new Date(this.lastResetTime + msPerMin).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 600,
      requestsPerDay: 864000, // ~10 req/sec * 86400 sec/day
      burstLimit: 10,
    };
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < REQUEST_DELAY_MS) {
      const delayNeeded = REQUEST_DELAY_MS - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, delayNeeded));
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }
}
