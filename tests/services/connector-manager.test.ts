import { describe, expect, it } from 'vitest';
import {
  ConnectorManager,
  connectorManager,
  initializeBuiltinConnectors,
  registerBuiltinConnectors,
} from '../../src/connectors/connector-manager.js';
import type {
  ConnectorCredentials,
  DataEndpoint,
  DataResult,
  DataSchema,
  HealthStatus,
  QueryParams,
  QuotaStatus,
  RateLimitInfo,
  SpreadsheetConnector,
} from '../../src/connectors/types.js';

class StubConnector implements SpreadsheetConnector {
  readonly id = 'stub';
  readonly name = 'Stub';
  readonly description = 'Stub connector for tests';
  readonly authType = 'none' as const;

  private configured = true;

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(_credentials: ConnectorCredentials): Promise<void> {
    this.configured = true;
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      healthy: true,
      latencyMs: 1,
      message: 'ok',
      lastChecked: new Date('2024-01-15T00:00:00Z').toISOString(),
    };
  }

  async dispose(): Promise<void> {
    this.configured = false;
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return [
      {
        id: 'prices',
        name: 'Prices',
        description: 'Stub endpoint',
        category: 'test',
        params: [],
      },
    ];
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    return {
      endpoint,
      columns: [{ name: 'symbol', type: 'string' }],
    };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    if (endpoint === 'fail') {
      throw new Error('forced failure');
    }
    return {
      headers: ['symbol', 'value'],
      rows: [[String(params['symbol'] ?? 'AAPL'), 100]],
      metadata: {
        source: 'stub',
        endpoint,
        fetchedAt: new Date('2024-01-15T00:00:00Z').toISOString(),
        rowCount: 1,
        cached: false,
        quotaUsed: 1,
      },
    };
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: 0,
      limit: 60,
      resetAt: new Date(1704067200000 + 60_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 60,
      requestsPerDay: 1000,
    };
  }
}

describe('ConnectorManager', () => {
  it('registers built-in connectors and remains idempotent', async () => {
    const manager = new ConnectorManager();

    const first = registerBuiltinConnectors(manager);
    const second = registerBuiltinConnectors(manager);

    const connectorIds = manager.listConnectors().connectors.map((c) => c.id);

    expect(first.total).toBe(12);
    expect(first.registered).toBe(12);
    expect(second.registered).toBe(0);
    expect(connectorIds).toEqual(
      expect.arrayContaining([
        'finnhub',
        'fred',
        'alpha_vantage',
        'fmp',
        'polygon',
        'gmail',
        'drive',
        'docs',
        'sec_edgar',
        'world_bank',
        'openfigi',
        'rest_public_json',
      ])
    );

    await manager.dispose();
  });

  it('supports query, batch_query, and subscription lifecycle', async () => {
    const manager = new ConnectorManager();
    manager.register(new StubConnector());

    const first = await manager.query('stub', 'prices', { symbol: 'MSFT' });
    const second = await manager.query('stub', 'prices', { symbol: 'MSFT' });

    expect(first.metadata.cached).toBe(false);
    expect(second.metadata.cached).toBe(true);
    expect(second.rows[0]?.[0]).toBe('MSFT');

    const batch = await manager.batchQuery([
      { connectorId: 'stub', endpoint: 'prices', params: { symbol: 'AAPL' } },
      { connectorId: 'stub', endpoint: 'fail', params: {} },
    ]);

    expect(batch.results).toHaveLength(2);
    expect('headers' in batch.results[0]!).toBe(true);
    expect('error' in batch.results[1]!).toBe(true);

    const subscription = manager.subscribe(
      'stub',
      'prices',
      { symbol: 'AAPL' },
      { interval: 'hourly' },
      { spreadsheetId: 'spreadsheet-id', range: 'Sheet1!A1' }
    );

    expect(subscription.id).toMatch(/^sub_/);
    expect(manager.listSubscriptions()).toHaveLength(1);
    expect(manager.unsubscribe(subscription.id)).toBe(true);
    expect(manager.listSubscriptions()).toHaveLength(0);

    await manager.dispose();
  });

  it('singleton connector manager exposes built-ins without manual registration', () => {
    initializeBuiltinConnectors();
    const connectorIds = connectorManager.listConnectors().connectors.map((c) => c.id);
    expect(connectorIds.length).toBeGreaterThan(0);
    expect(connectorIds).toContain('finnhub');
  });
});
