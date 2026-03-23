/**
 * ServalSheets - World Bank Open Data Connector
 *
 * Provides access to World Bank's comprehensive economic and development datasets.
 * Endpoints: indicators (GDP, population, inflation, etc. by country/year),
 *           countries (country metadata), topics (topic listings)
 *
 * Auth: None required (public API)
 * Rate limiting: None enforced (public API)
 * Docs: https://data.worldbank.org/developers
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

const BASE_URL = 'https://api.worldbank.org/v2';

export class WorldBankConnector implements SpreadsheetConnector {
  readonly id = 'world_bank';
  readonly name = 'World Bank Open Data';
  readonly description =
    'World Bank development indicators: GDP, population, inflation, employment, education, health, and more across all countries';
  readonly authType = 'none' as const;

  private configured = false;

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    // World Bank API requires no authentication
    this.configured = true;
    logger.info('World Bank connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/country?format=json&per_page=1`);
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
        id: 'indicators',
        name: 'Economic Indicators',
        description: 'Query development indicators by country, indicator code, and year',
        category: 'indicators',
        params: [
          {
            name: 'indicator',
            type: 'string',
            required: true,
            description: 'Indicator code (e.g., NY.GDP.MKTP.CD for GDP in current US$)',
            example: 'NY.GDP.MKTP.CD',
          },
          {
            name: 'country',
            type: 'string',
            required: false,
            description: 'ISO 3166-1 alpha-2 country code or region code',
            example: 'US',
          },
          {
            name: 'date',
            type: 'string',
            required: false,
            description: 'Year or year range (YYYY or YYYY:YYYY)',
            example: '2020',
          },
          {
            name: 'per_page',
            type: 'number',
            required: false,
            description: 'Results per page (default 50, max 10000)',
            example: '100',
          },
        ],
      },
      {
        id: 'countries',
        name: 'Countries',
        description: 'List countries and regions with metadata',
        category: 'metadata',
        params: [
          {
            name: 'region',
            type: 'string',
            required: false,
            description: 'Region code (e.g., NA for North America, AFR for Africa)',
            example: 'EAS',
          },
          {
            name: 'income_level',
            type: 'string',
            required: false,
            description: 'Income level (HIC, MIC, LIC, LMIC, UMIC)',
            example: 'HIC',
          },
          {
            name: 'per_page',
            type: 'number',
            required: false,
            description: 'Results per page (default 10, max 500)',
            example: '100',
          },
        ],
      },
      {
        id: 'topics',
        name: 'Topics',
        description: 'List available indicator topics (e.g., Economy & Growth, Health)',
        category: 'metadata',
        params: [
          {
            name: 'per_page',
            type: 'number',
            required: false,
            description: 'Results per page (default 10)',
            example: '50',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    switch (endpoint) {
      case 'indicators':
        return {
          endpoint: 'indicators',
          columns: [
            { name: 'country', type: 'string', description: 'Country name' },
            { name: 'countryCode', type: 'string', description: 'ISO country code' },
            { name: 'indicator', type: 'string', description: 'Indicator code' },
            { name: 'indicatorName', type: 'string', description: 'Indicator description' },
            { name: 'year', type: 'string', description: 'Year of measurement' },
            { name: 'value', type: 'number', description: 'Indicator value' },
            { name: 'unit', type: 'string', description: 'Unit of measurement' },
          ],
          sampleRow: {
            country: 'United States',
            countryCode: 'US',
            indicator: 'NY.GDP.MKTP.CD',
            indicatorName: 'GDP (current US$)',
            year: '2020',
            value: 20940000000000,
            unit: 'US$',
          },
        };
      case 'countries':
        return {
          endpoint: 'countries',
          columns: [
            { name: 'code', type: 'string', description: 'Country code' },
            { name: 'name', type: 'string', description: 'Country name' },
            { name: 'region', type: 'string', description: 'Region name' },
            { name: 'incomeLevel', type: 'string', description: 'Income level classification' },
            { name: 'lendingType', type: 'string', description: 'Type of lending' },
            { name: 'capitalCity', type: 'string', description: 'Capital city' },
            { name: 'latitude', type: 'number', description: 'Latitude' },
            { name: 'longitude', type: 'number', description: 'Longitude' },
          ],
        };
      case 'topics':
        return {
          endpoint: 'topics',
          columns: [
            { name: 'id', type: 'string', description: 'Topic ID' },
            { name: 'value', type: 'string', description: 'Topic name' },
            { name: 'sourceNote', type: 'string', description: 'Topic description' },
          ],
        };
      default:
        throw new ServiceError(`Unknown endpoint: ${endpoint}`, 'NOT_FOUND', 'world_bank');
    }
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    try {
      switch (endpoint) {
        case 'indicators': {
          const indicator = params['indicator'] as string;
          const country = params['country'] ? `/${String(params['country'])}` : '';
          const date = params['date'] ? `?date=${encodeURIComponent(String(params['date']))}` : '';
          const perPage = params['per_page'] || 50;
          const url = `${BASE_URL}/country${country}/indicator/${indicator}${date}&format=json&per_page=${perPage}`;

          const resp = await fetch(url);
          if (!resp.ok) {
            throw new ServiceError(`World Bank API returned ${resp.status}`, 'UNAVAILABLE', 'world_bank');
          }

          const data = (await resp.json()) as unknown[];
          if (!Array.isArray(data) || data.length < 2) {
            return {
              headers: ['country', 'countryCode', 'indicator', 'indicatorName', 'year', 'value', 'unit'],
              rows: [],
              metadata: {
                source: 'World Bank Open Data',
                endpoint,
                fetchedAt: new Date().toISOString(),
                rowCount: 0,
                cached: false,
                quotaUsed: 1,
              },
            };
          }

          const records = data[1] as Array<Record<string, unknown>>;
          const rows = records
            .filter((r) => r['value'] !== null)
            .map((r) => [
              String((r['country'] as Record<string, unknown>)?.['value'] || r['countryiso3code'] || ''),
              String(r['countryiso3code'] || ''),
              String((r['indicator'] as Record<string, unknown>)?.['id'] || ''),
              String((r['indicator'] as Record<string, unknown>)?.['value'] || ''),
              String(r['date'] || ''),
              Number(r['value']) || null,
              '',
            ]);

          return {
            headers: ['country', 'countryCode', 'indicator', 'indicatorName', 'year', 'value', 'unit'],
            rows,
            metadata: {
              source: 'World Bank Open Data',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: rows.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        case 'countries': {
          const region = params['region'] ? `?region=${encodeURIComponent(String(params['region']))}` : '';
          const incomeLevel = params['income_level']
            ? `&incomeLevel=${encodeURIComponent(String(params['income_level']))}`
            : '';
          const perPage = params['per_page'] || 100;
          const url = `${BASE_URL}/country${region}${incomeLevel}&format=json&per_page=${perPage}`;

          const resp = await fetch(url);
          if (!resp.ok) {
            throw new ServiceError(`Countries query failed: ${resp.status}`, 'CONNECTOR_ERROR', 'world_bank');
          }

          const data = (await resp.json()) as unknown[];
          if (!Array.isArray(data) || data.length < 2) {
            return {
              headers: ['code', 'name', 'region', 'incomeLevel', 'lendingType', 'capitalCity', 'latitude', 'longitude'],
              rows: [],
              metadata: {
                source: 'World Bank Open Data',
                endpoint,
                fetchedAt: new Date().toISOString(),
                rowCount: 0,
                cached: false,
                quotaUsed: 1,
              },
            };
          }

          const countries = data[1] as Array<Record<string, unknown>>;
          const rows = countries.map((c) => [
            String(c['id'] || ''),
            String(c['name'] || ''),
            String((c['region'] as Record<string, unknown>)?.['value'] || ''),
            String((c['incomeLevel'] as Record<string, unknown>)?.['value'] || ''),
            String((c['lendingType'] as Record<string, unknown>)?.['value'] || ''),
            String(c['capitalCity'] || ''),
            Number((c['latitude'] as unknown) || 0) || null,
            Number((c['longitude'] as unknown) || 0) || null,
          ]);

          return {
            headers: ['code', 'name', 'region', 'incomeLevel', 'lendingType', 'capitalCity', 'latitude', 'longitude'],
            rows,
            metadata: {
              source: 'World Bank Open Data',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: rows.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        case 'topics': {
          const perPage = params['per_page'] || 50;
          const url = `${BASE_URL}/topic?format=json&per_page=${perPage}`;

          const resp = await fetch(url);
          if (!resp.ok) {
            throw new ServiceError(`Topics query failed: ${resp.status}`, 'CONNECTOR_ERROR', 'world_bank');
          }

          const data = (await resp.json()) as unknown[];
          if (!Array.isArray(data) || data.length < 2) {
            return {
              headers: ['id', 'value', 'sourceNote'],
              rows: [],
              metadata: {
                source: 'World Bank Open Data',
                endpoint,
                fetchedAt: new Date().toISOString(),
                rowCount: 0,
                cached: false,
                quotaUsed: 1,
              },
            };
          }

          const topics = data[1] as Array<Record<string, unknown>>;
          const rows = topics.map((t) => [String(t['id'] || ''), String(t['value'] || ''), String(t['sourceNote'] || '')]);

          return {
            headers: ['id', 'value', 'sourceNote'],
            rows,
            metadata: {
              source: 'World Bank Open Data',
              endpoint,
              fetchedAt: new Date().toISOString(),
              rowCount: rows.length,
              cached: false,
              quotaUsed: 1,
            },
          };
        }

        default:
          throw new ServiceError(`Unknown endpoint: ${endpoint}`, 'NOT_FOUND', 'world_bank');
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(
        err instanceof Error ? err.message : 'World Bank query failed',
        'CONNECTOR_ERROR',
        'world_bank'
      );
    }
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: 0,
      limit: 10000,
      resetAt: new Date(Date.now() + 86400000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 10000,
      requestsPerDay: 1000000,
    };
  }
}
