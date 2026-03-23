/**
 * ServalSheets - Google Drive Connector
 *
 * Google Drive API connector for searching files, listing folders, and retrieving metadata.
 * Provides access to file organization, permissions, and sharing information.
 *
 * Auth: OAuth2 (uses existing Google credentials)
 * Docs: https://developers.google.com/drive/api/reference/rest
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

export class DriveConnector implements SpreadsheetConnector {
  readonly id = 'drive';
  readonly name = 'Google Drive';
  readonly description =
    'Google Drive connector: search files, list folders, retrieve metadata and sharing information';
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
        'Google Drive requires OAuth2 access token. Use Google authentication to obtain credentials.',
        'DRIVE_OAUTH_TOKEN'
      );
    }
    this.oauthToken = credentials.oauth.accessToken;
    this.configured = true;
    logger.info('Google Drive connector configured');
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const resp = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=user,storageQuota',
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
        id: 'files/search',
        name: 'Search Files',
        description: 'Search for files in Google Drive',
        category: 'search',
        params: [
          {
            name: 'q',
            type: 'string',
            required: true,
            description: 'Search query (e.g., "name contains \'report\'")',
            example: "name contains 'report'",
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
      {
        id: 'folders/list',
        name: 'List Folder Contents',
        description: 'List files and folders in a specific folder',
        category: 'browse',
        params: [
          {
            name: 'folderId',
            type: 'string',
            required: true,
            description: 'Folder ID to list',
            example: '1a2b3c4d5e6f7g8h9i0j',
          },
          {
            name: 'maxResults',
            type: 'number',
            required: false,
            description: 'Maximum results (default: 50)',
            example: '50',
          },
        ],
      },
      {
        id: 'files/metadata',
        name: 'Get File Metadata',
        description: 'Retrieve detailed metadata for a specific file',
        category: 'metadata',
        params: [
          {
            name: 'fileId',
            type: 'string',
            required: true,
            description: 'File ID to retrieve',
            example: '1a2b3c4d5e6f7g8h9i0j',
          },
        ],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    const schemas: Record<string, DataSchema> = {
      'files/search': {
        endpoint: 'files/search',
        columns: [
          { name: 'id', type: 'string', description: 'File ID' },
          { name: 'name', type: 'string', description: 'File name' },
          { name: 'mimeType', type: 'string', description: 'MIME type' },
          { name: 'size', type: 'number', description: 'File size in bytes' },
          { name: 'createdTime', type: 'date', description: 'Creation date' },
          { name: 'modifiedTime', type: 'date', description: 'Last modified date' },
        ],
      },
      'folders/list': {
        endpoint: 'folders/list',
        columns: [
          { name: 'id', type: 'string', description: 'Item ID' },
          { name: 'name', type: 'string', description: 'Item name' },
          { name: 'type', type: 'string', description: 'Item type (file or folder)' },
          { name: 'mimeType', type: 'string', description: 'MIME type' },
          { name: 'modifiedTime', type: 'date', description: 'Last modified date' },
        ],
      },
      'files/metadata': {
        endpoint: 'files/metadata',
        columns: [
          { name: 'id', type: 'string', description: 'File ID' },
          { name: 'name', type: 'string', description: 'File name' },
          { name: 'mimeType', type: 'string', description: 'MIME type' },
          { name: 'size', type: 'number', description: 'File size in bytes' },
          { name: 'owner', type: 'string', description: 'Owner email' },
          { name: 'shared', type: 'boolean', description: 'Is shared' },
          { name: 'webViewLink', type: 'string', description: 'View link' },
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
        `Google Drive API error: HTTP ${resp.status} ${resp.statusText}`,
        'INTERNAL_ERROR',
        'drive',
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
      requestsPerMinute: 300,
      requestsPerDay: 1000,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildUrl(endpoint: string, params: QueryParams): string {
    const baseUrl = 'https://www.googleapis.com/drive/v3/files';
    const url = new URL(baseUrl);

    if (endpoint === 'files/metadata') {
      return `${baseUrl}/${params['fileId']}?fields=*`;
    }

    url.searchParams.set('fields', 'files(id,name,mimeType,size,createdTime,modifiedTime)');

    if (endpoint === 'files/search') {
      url.searchParams.set('q', String(params['q'] || ''));
      url.searchParams.set('pageSize', String(params['maxResults'] || 10));
    } else if (endpoint === 'folders/list') {
      url.searchParams.set('q', `'${params['folderId']}' in parents and trashed=false`);
      url.searchParams.set('pageSize', String(params['maxResults'] || 50));
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
    if (endpoint === 'files/search' || endpoint === 'folders/list') {
      const files = (data['files'] as Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        createdTime?: string;
        modifiedTime?: string;
      }>) ?? [];
      const rows = files.map((f) => [
        f['id'],
        f['name'],
        f['mimeType'],
        Number(f['size']) || 0,
        f['createdTime'] || '',
        f['modifiedTime'] || '',
      ]);
      return {
        headers: ['id', 'name', 'mimeType', 'size', 'createdTime', 'modifiedTime'],
        rows,
        metadata: {
          source: 'drive',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: rows.length,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    if (endpoint === 'files/metadata') {
      const rows: (string | number | boolean | null)[][] = [[
        String(data['id'] ?? ''),
        String(data['name'] ?? ''),
        String(data['mimeType'] ?? ''),
        data['size'] ? Number(data['size']) : 0,
        String((data['owners'] ? (data['owners'] as { emailAddress?: string }[])[0]?.emailAddress : null) ?? ''),
        !!(data['shared'] ?? false),
        String(data['webViewLink'] ?? ''),
      ]];
      return {
        headers: ['id', 'name', 'mimeType', 'size', 'owner', 'shared', 'webViewLink'],
        rows,
        metadata: {
          source: 'drive',
          endpoint,
          fetchedAt: new Date().toISOString(),
          rowCount: 1,
          cached: false,
          quotaUsed: 1,
        },
      };
    }

    return {
      headers: ['data'],
      rows: [[JSON.stringify(data)]],
      metadata: {
        source: 'drive',
        endpoint,
        fetchedAt: new Date().toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }
}
