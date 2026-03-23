/**
 * ServalSheets - Gmail Connector
 *
 * Google Gmail API connector for searching and retrieving emails and labels.
 * Provides access to email threads, messages, and label organization.
 *
 * Auth: OAuth2 (uses existing Google credentials)
 * Docs: https://developers.google.com/gmail/api/reference/rest
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

export class GmailConnector implements SpreadsheetConnector {
  readonly id = 'gmail';
  readonly name = 'Gmail';
  readonly description =
    'Google Gmail connector: search emails, retrieve threads, list labels, and access message metadata';
  readonly authType = 'oauth2' as const;

  private oauthToken: string | null = null;
  private configured = false;
  private requestCount = 0;
  private lastResetTime = Date.now();

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    if (!credentials.oauth?.accessToken) {
      throw new ConfigError(
        'Gmail requires OAuth2 access token. Use Google authentication to obtain credentials.',
        'GMAIL_OAUTH_TOKEN'
      );
    }
    this.oauthToken = credentials.oauth.accessToken;
    this.configured = true;
    logger.info('Gmail connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${this.oauthToken}` },
      });
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
    this.oauthToken = null;
    this.configured = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return [
      {
        id: 'messages/search',
        name: 'Search Emails',
        description: 'Search for emails using Gmail search query syntax',
        category: 'search',
        params: [
          {
            name: 'q',
            type: 'string',
            required: true,
            description: 'Gmail search query (e.g., "from:user@example.com subject:invoice")',
            example: 'from:user@example.com',
          },
          {
            name: 'maxResults',
            type: 'number',
            required: false,
            description: 'Maximum results to return (1-100, default: 10)',
            example: '20',
          },
        ],
      },
      {
        id: 'threads/get',
        name: 'Get Thread',
        description: 'Retrieve a complete email thread',
        category: 'detail',
        params: [
          {
            name: 'threadId',
            type: 'string',
            required: true,
            description: 'Thread ID to retrieve',
            example: '1234567890abcdef',
          },
        ],
      },
      {
        id: 'labels/list',
        name: 'List Labels',
        description: 'List all Gmail labels and folders',
        category: 'metadata',
        params: [],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'messages/search': {
        endpoint: 'messages/search',
        columns: [
          { name: 'id', type: 'string', description: 'Message ID' },
          { name: 'threadId', type: 'string', description: 'Thread ID' },
          { name: 'labelIds', type: 'string', description: 'Associated label IDs' },
          { name: 'subject', type: 'string', description: 'Email subject' },
          { name: 'from', type: 'string', description: 'Sender email address' },
          { name: 'date', type: 'date', description: 'Email date' },
        ],
      },
      'threads/get': {
        endpoint: 'threads/get',
        columns: [
          { name: 'id', type: 'string', description: 'Thread ID' },
          { name: 'messageCount', type: 'number', description: 'Number of messages in thread' },
          { name: 'subject', type: 'string', description: 'Thread subject' },
          { name: 'from', type: 'string', description: 'Latest sender' },
          { name: 'snippet', type: 'string', description: 'Thread snippet' },
        ],
      },
      'labels/list': {
        endpoint: 'labels/list',
        columns: [
          { name: 'id', type: 'string', description: 'Label ID' },
          { name: 'name', type: 'string', description: 'Label name' },
          { name: 'type', type: 'string', description: 'Label type (system or user)' },
          { name: 'messageCount', type: 'number', description: 'Number of messages' },
          { name: 'threadCount', type: 'number', description: 'Number of threads' },
        ],
      },
    };
    return schemas[endpoint] ?? { endpoint, columns: [] };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();
    const url = this.buildUrl(endpoint, params);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.oauthToken}` },
    });
    if (!resp.ok) {
      throw new ServiceError(
        `Gmail API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'gmail',
        true
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;
    return this.formatResult(endpoint, data);
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 1000,
      resetAt: new Date(this.lastResetTime + 3600_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 250,
      requestsPerDay: 1000,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildUrl(endpoint: string, params: QueryParams): string {
    const path: Record<string, string> = {
      'messages/search': '/users/me/messages',
      'threads/get': `/users/me/threads/${params['threadId'] || ''}`,
      'labels/list': '/users/me/labels',
    };

    const url = new URL(`https://www.googleapis.com/gmail/v1${path[endpoint] || ''}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && key !== 'threadId') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 3600_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private formatResult(endpoint: string, data: Record<string, unknown>): DataResult {
    if (endpoint === 'messages/search') {
      const messages = (data['messages'] as Array<{ id: string; threadId: string }>) ?? [];
      const rows = messages.map((m) => [m['id'], m['threadId'], '', '', '', '']);
      return {
        headers: ['id', 'threadId', 'labelIds', 'subject', 'from', 'date'],
        rows,
        metadata: {
          source: 'gmail',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    if (endpoint === 'threads/get') {
      const threadId = String(data['id'] ?? '');
      const messageCount = (data['messages'] as unknown[])?.length ?? 0;
      const rows: (string | number | boolean | null)[][] = [[threadId, messageCount, '', '', '']];
      return {
        headers: ['id', 'messageCount', 'subject', 'from', 'snippet'],
        rows,
        metadata: {
          source: 'gmail',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: 1,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    if (endpoint === 'labels/list') {
      const labels = (data['labels'] as Array<{
        id: string;
        name: string;
        type: string;
        messagesTotal?: number;
        threadsTotal?: number;
      }>) ?? [];
      const rows = labels.map((l) => [
        l['id'],
        l['name'],
        l['type'],
        l['messagesTotal'] ?? 0,
        l['threadsTotal'] ?? 0,
      ]);
      return {
        headers: ['id', 'name', 'type', 'messageCount', 'threadCount'],
        rows,
        metadata: {
          source: 'gmail',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    return {
      headers: ['data'],
      rows: [[JSON.stringify(data)]],
      metadata: {
        source: 'gmail',
        endpoint,
        fetchedAt: new Date().toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }
}
