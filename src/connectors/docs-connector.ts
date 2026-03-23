/**
 * ServalSheets - Google Docs Connector
 *
 * Google Docs API connector for reading document content and metadata.
 * Provides access to document structure, text content, and revision history.
 *
 * Auth: OAuth2 (uses existing Google credentials)
 * Docs: https://developers.google.com/docs/api/reference/rest
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

export class DocsConnector implements SpreadsheetConnector {
  readonly id = 'docs';
  readonly name = 'Google Docs';
  readonly description =
    'Google Docs connector: retrieve document text content, metadata, and search documents in Drive';
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
        'Google Docs requires OAuth2 access token. Use Google authentication to obtain credentials.',
        'DOCS_OAUTH_TOKEN'
      );
    }
    this.oauthToken = credentials.oauth.accessToken;
    this.configured = true;
    logger.info('Google Docs connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Use Drive API to verify auth (Docs API doesn't have a dedicated health endpoint)
      const resp = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=user',
        {
          headers: { Authorization: `Bearer ${this.oauthToken}` },
        }
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
    this.oauthToken = null;
    this.configured = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return [
      {
        id: 'documents/get',
        name: 'Get Document Content',
        description: 'Retrieve full text content and metadata from a Google Doc',
        category: 'read',
        params: [
          {
            name: 'documentId',
            type: 'string',
            required: true,
            description: 'Google Doc ID (from URL)',
            example: '1a2b3c4d5e6f7g8h9i0j-1k2l3m4n5o6p7q8r9s',
          },
        ],
      },
      {
        id: 'documents/search',
        name: 'Search Documents',
        description: 'Search for Google Docs by name in Drive',
        category: 'search',
        params: [
          {
            name: 'query',
            type: 'string',
            required: true,
            description: 'Document name search term',
            example: 'quarterly report',
          },
          {
            name: 'maxResults',
            type: 'number',
            required: false,
            description: 'Maximum results (1-100, default: 10)',
            example: '20',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'documents/get': {
        endpoint: 'documents/get',
        columns: [
          { name: 'documentId', type: 'string', description: 'Document ID' },
          { name: 'title', type: 'string', description: 'Document title' },
          { name: 'text', type: 'string', description: 'Full text content' },
          { name: 'headingCount', type: 'number', description: 'Number of headings' },
          { name: 'paragraphCount', type: 'number', description: 'Number of paragraphs' },
          { name: 'revisionId', type: 'string', description: 'Current revision ID' },
          { name: 'suggestedChanges', type: 'number', description: 'Count of suggested edits' },
        ],
      },
      'documents/search': {
        endpoint: 'documents/search',
        columns: [
          { name: 'id', type: 'string', description: 'Document ID' },
          { name: 'name', type: 'string', description: 'Document name' },
          { name: 'mimeType', type: 'string', description: 'MIME type' },
          { name: 'createdTime', type: 'date', description: 'Creation date' },
          { name: 'modifiedTime', type: 'date', description: 'Last modified date' },
          { name: 'webViewLink', type: 'string', description: 'Link to open in web' },
        ],
      },
    };
    return schemas[endpoint] ?? { endpoint, columns: [] };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();

    if (endpoint === 'documents/get') {
      const documentId = String(params['documentId'] || '');
      const resp = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}`,
        {
          headers: { Authorization: `Bearer ${this.oauthToken}` },
        }
      );
      if (!resp.ok) {
        throw new ServiceError(
          `Google Docs API error: HTTP ${resp.status} ${resp.statusText}`,
          'INTERNAL_ERROR',
          'docs',
          true
        );
      }
      const data = (await resp.json()) as Record<string, unknown>;
      return this.formatDocumentResult(documentId, data);
    }

    if (endpoint === 'documents/search') {
      const query = `mimeType='application/vnd.google-apps.document' and name contains '${String(params['query'] || '')}'`;
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', query);
      url.searchParams.set(
        'fields',
        'files(id,name,mimeType,createdTime,modifiedTime,webViewLink)'
      );
      url.searchParams.set('pageSize', String(params['maxResults'] || 10));

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.oauthToken}` },
      });
      if (!resp.ok) {
        throw new ServiceError(
          `Google Drive API error: HTTP ${resp.status} ${resp.statusText}`,
          'INTERNAL_ERROR',
          'docs',
          true
        );
      }
      const data = (await resp.json()) as Record<string, unknown>;
      return this.formatSearchResult(data);
    }

    return {
      headers: ['data'],
      rows: [['Unknown endpoint']],
      metadata: {
        source: 'docs',
        endpoint,
        fetchedAt: new Date().toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 300,
      resetAt: new Date(this.lastResetTime + 3600_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 100,
      requestsPerDay: 1000,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 3600_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private extractDocumentText(data: Record<string, unknown>): string {
    const body = data['body'] as { content?: Array<{ paragraph?: Record<string, unknown> }> };
    if (!body?.content) return '';

    let text = '';
    for (const element of body.content) {
      if (element.paragraph) {
        const elements = element.paragraph['elements'] as Array<{
          textRun?: { content: string };
        }>;
        if (elements) {
          for (const el of elements) {
            if (el.textRun?.content) {
              text += el.textRun.content;
            }
          }
        }
        text += '\n';
      }
    }
    return text;
  }

  private formatDocumentResult(documentId: string, data: Record<string, unknown>): DataResult {
    const text = this.extractDocumentText(data);
    const title = (data['title'] as string) ?? '';
    const revisionId = (data['revisionId'] as string) ?? '';

    const rows = [[
      documentId,
      title,
      text,
      0, // headingCount (simplified)
      (text.match(/\n/g) ?? []).length, // paragraph count approximation
      revisionId,
      0, // suggestedChanges
    ]];

    return {
      headers: [
        'documentId',
        'title',
        'text',
        'headingCount',
        'paragraphCount',
        'revisionId',
        'suggestedChanges',
      ],
      rows,
      metadata: {
        source: 'docs',
        endpoint: 'documents/get',
        fetchedAt: new Date().toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }

  private formatSearchResult(data: Record<string, unknown>): DataResult {
    const files = (data['files'] as Array<{
      id: string;
      name: string;
      mimeType: string;
      createdTime?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>) ?? [];

    const rows = files.map((f) => [
      f['id'],
      f['name'],
      f['mimeType'],
      f['createdTime'] || '',
      f['modifiedTime'] || '',
      f['webViewLink'] || '',
    ]);

    return {
      headers: ['id', 'name', 'mimeType', 'createdTime', 'modifiedTime', 'webViewLink'],
      rows,
      metadata: {
        source: 'docs',
        endpoint: 'documents/search',
        fetchedAt: new Date().toISOString(),
        rowCount: rows.length,
        cached: false,
        quotaUsed: 1,
      },
    };
  }
}
