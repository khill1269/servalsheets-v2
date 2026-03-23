/**
 * ServalSheets - Web Search Connector
 *
 * Provides web search capabilities via Google Custom Search API or Serper API.
 * Endpoints: web/search, web/fetch_page
 *
 * Auth: API key (configurable per provider)
 * Docs: https://developers.google.com/custom-search or https://serper.dev/docs
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

export class WebSearchConnector implements SpreadsheetConnector {
  readonly id = 'web-search';
  readonly name = 'Web Search';
  readonly description =
    'Search the web and fetch page content using Google Custom Search API or Serper API';
  readonly authType = 'api_key' as const;

  private apiKey: string | null = null;
  private searchEngine: 'google' | 'serper' = 'google';
  private configured = false;
  private requestCount = 0;
  private lastResetTime = Date.now();

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    if (!credentials.apiKey) {
      throw new ConfigError(
        'Web Search requires an API key (Google Custom Search or Serper)',
        'WEB_SEARCH_API_KEY'
      );
    }
    if (!credentials.custom?.['engine']) {
      throw new ConfigError(
        'Web Search requires engine configuration (google or serper)',
        'WEB_SEARCH_ENGINE'
      );
    }

    this.apiKey = credentials.apiKey;
    const engine = credentials.custom['engine'];
    this.searchEngine = (engine === 'google' || engine === 'serper' ? engine : 'google') as 'google' | 'serper';
    this.configured = true;
    logger.info(`Web Search connector configured (engine: ${this.searchEngine})`);
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    if (!this.configured || !this.apiKey) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: 'Not configured',
        lastChecked: new Date().toISOString(),
      };
    }

    try {
      // Test with a simple search query
      const result = await this.search('test', { maxResults: 1 });
      return {
        healthy: result.rows.length > 0,
        latencyMs: Date.now() - start,
        message: result.rows.length > 0 ? 'OK' : 'No results',
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
        id: 'web/search',
        name: 'Web Search',
        description: 'Search the web and return results',
        category: 'search',
        params: [
          {
            name: 'query',
            type: 'string',
            required: true,
            description: 'Search query',
            example: 'climate change news',
          },
          {
            name: 'maxResults',
            type: 'number',
            required: false,
            description: 'Maximum number of results (1-10)',
            example: '5',
          },
        ],
      },
      {
        id: 'web/fetch_page',
        name: 'Fetch Page Content',
        description: 'Fetch and extract content from a URL',
        category: 'fetch',
        params: [
          {
            name: 'url',
            type: 'string',
            required: true,
            description: 'URL to fetch',
            example: 'https://example.com',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    if (endpoint === 'web/search') {
      return {
        endpoint: 'web/search',
        columns: [
          { name: 'title', type: 'string', description: 'Page title' },
          { name: 'url', type: 'string', description: 'Page URL' },
          { name: 'snippet', type: 'string', description: 'Search result snippet' },
          { name: 'position', type: 'number', description: 'Result ranking position' },
        ],
      };
    }
    if (endpoint === 'web/fetch_page') {
      return {
        endpoint: 'web/fetch_page',
        columns: [
          { name: 'url', type: 'string', description: 'Fetched URL' },
          { name: 'title', type: 'string', description: 'Page title' },
          { name: 'content', type: 'string', description: 'Page body content (text)' },
          { name: 'statusCode', type: 'number', description: 'HTTP status code' },
        ],
      };
    }
    throw new ServiceError(
      `Unknown endpoint: ${endpoint}`,
      'INVALID_PARAMS',
      'WebSearchConnector'
    );
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    if (endpoint === 'web/search') {
      const query = params['query'] as string;
      const maxResults = (params['maxResults'] as number) ?? 5;
      return this.search(query, { maxResults });
    }
    if (endpoint === 'web/fetch_page') {
      const url = params['url'] as string;
      return this.fetchPage(url);
    }
    throw new ServiceError(
      `Unknown endpoint: ${endpoint}`,
      'INVALID_PARAMS',
      'WebSearchConnector'
    );
  }

  private async search(
    query: string,
    options: { maxResults?: number }
  ): Promise<DataResult> {
    // Phase 3 implementation: calls Google Custom Search API or Serper API
    throw new ServiceError(
      'Web search implementation deferred to Phase 3 (Step 062)',
      'NOT_IMPLEMENTED',
      'WebSearchConnector'
    );
  }

  private async fetchPage(url: string): Promise<DataResult> {
    // Phase 3 implementation: fetches and extracts page content
    throw new ServiceError(
      'Page fetch implementation deferred to Phase 3 (Step 062)',
      'NOT_IMPLEMENTED',
      'WebSearchConnector'
    );
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: this.searchEngine === 'google' ? 100 : 1000, // Per-day limits vary by provider
      resetAt: new Date(this.lastResetTime + 24 * 60 * 60 * 1000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: this.searchEngine === 'google' ? 10 : 100,
      requestsPerDay: this.searchEngine === 'google' ? 100 : 1000,
    };
  }
}
