/**
 * Tests for P5.1 (Persistent Connector Configuration) & P5.2 (Persistent Subscriptions)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeRmSync } from '../helpers/safe-cleanup.js';
import { ConnectorManager } from '../../src/connectors/connector-manager.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
import type { SpreadsheetConnector, ConnectorCredentials } from '../../src/connectors/types.js';

// Mock connector for testing
class MockConnector implements SpreadsheetConnector {
  id = 'test_mock';
  name = 'Mock Test Connector';
  description = 'Test connector';
  authType = 'api_key';
  private isConfig = false;

  isConfigured(): boolean {
    return this.isConfig;
  }

  getRateLimits() {
    return { requestsPerMinute: 60, requestsPerDay: 10000 };
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    if (!credentials.apiKey) {
      throw new Error('API key required');
    }
    this.isConfig = true;
  }

  async query() {
    return { headers: ['col1'], rows: [['val1']], metadata: { rowCount: 1 } };
  }

  async listEndpoints() {
    return [];
  }

  async getSchema() {
    return { fields: [] };
  }

  async healthCheck() {
    return {
      healthy: true,
      latencyMs: 10,
      message: 'OK',
      lastChecked: new Date().toISOString(),
    };
  }

  async dispose(): Promise<void> {
    // no-op
  }
}

describe('P5.1: Persistent Connector Configuration', () => {
  let configDir: string;
  let manager: ConnectorManager;

  beforeEach(() => {
    // Use unique temp directory for test isolation — configDir is a subdir
    // that does NOT exist yet (so "should handle missing configuration directory" works)
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'serval-test-connectors-'));
    configDir = path.join(tmpParent, 'connectors');
    process.env['CONNECTOR_ENCRYPTION_KEY'] = 'test-encryption-key-32-chars-min!!';
    resetEnvForTest();
  });

  afterEach(async () => {
    // Clean up
    if (manager) {
      await manager.dispose();
    }
    if (fs.existsSync(configDir)) {
      safeRmSync(configDir, { recursive: true, force: true });
    }
  });

  it('should persist connector configuration to disk', async () => {
    manager = new ConnectorManager(configDir);
    const connector = new MockConnector();
    manager.register(connector);

    const credentials: ConnectorCredentials = { apiKey: 'test-key-123' };
    const result = await manager.configure('test_mock', credentials);

    expect(result.success).toBe(true);

    // Verify file was created
    const configFile = path.join(configDir, 'test_mock.json');
    expect(fs.existsSync(configFile)).toBe(true);

    // Config is stored encrypted — verify the encrypted envelope format
    const content = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(content.ciphertext).toBeDefined();
    expect(content.iv).toBeDefined();
    expect(content.tag).toBeDefined();
    // Verify the connector was actually configured (proves persistence worked)
    expect(manager.listConnectors().connectors[0].configured).toBe(true);
  });

  it('should restore persisted configurations on initialize', async () => {
    // First manager: configure and save
    manager = new ConnectorManager(configDir);
    const connector1 = new MockConnector();
    manager.register(connector1);

    await manager.configure('test_mock', { apiKey: 'persisted-key' });
    await manager.dispose();

    // Second manager: should restore
    manager = new ConnectorManager(configDir);
    const connector2 = new MockConnector();
    manager.register(connector2);

    const before = manager.listConnectors();
    expect(before.connectors[0].configured).toBe(false); // Not yet restored

    await manager.initialize();

    const after = manager.listConnectors();
    expect(after.connectors[0].configured).toBe(true); // Restored!
  });

  it('should handle missing configuration directory', async () => {
    manager = new ConnectorManager(configDir);
    const connector = new MockConnector();
    manager.register(connector);

    // Directory doesn't exist yet
    expect(fs.existsSync(configDir)).toBe(false);

    // Should create directory and save config
    await manager.configure('test_mock', { apiKey: 'key' });

    expect(fs.existsSync(configDir)).toBe(true);
  });
});

describe('P5.2: Persistent Subscriptions', () => {
  let configDir: string;
  let manager: ConnectorManager;

  beforeEach(() => {
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'serval-test-subs-'));
    configDir = path.join(tmpParent, 'subscriptions');
  });

  afterEach(async () => {
    if (manager) {
      await manager.dispose();
    }
    if (fs.existsSync(configDir)) {
      safeRmSync(configDir, { recursive: true, force: true });
    }
  });

  it('should persist subscriptions to disk', async () => {
    manager = new ConnectorManager(configDir);
    const connector = new MockConnector();
    manager.register(connector);
    await manager.configure('test_mock', { apiKey: 'key' });

    const sub = manager.subscribe(
      'test_mock',
      'endpoint',
      { param: 'value' },
      { interval: 'hourly' },
      {
        spreadsheetId: 'ss-123',
        range: 'A1:B10',
      }
    );

    // Wait for async fire-and-forget persistence to complete
    await wait(100);

    // Verify file was created
    const subFile = path.join(configDir, `${sub.id}.json`);
    expect(fs.existsSync(subFile)).toBe(true);

    const content = JSON.parse(fs.readFileSync(subFile, 'utf-8'));
    expect(content.id).toBe(sub.id);
    expect(content.endpoint).toBe('endpoint');
    expect(content.createdAt).toBeDefined();
  });

  it('should restore subscriptions on initialize', async () => {
    // First manager: create subscription
    manager = new ConnectorManager(configDir);
    const connector1 = new MockConnector();
    manager.register(connector1);
    await manager.configure('test_mock', { apiKey: 'key' });

    const subId = manager.subscribe(
      'test_mock',
      'endpoint',
      { param: 'value' },
      { interval: 'hourly' },
      {
        spreadsheetId: 'ss-123',
        range: 'A1:B10',
      }
    ).id;

    // Wait for fire-and-forget persistence before dispose
    await wait(100);
    await manager.dispose();

    // Second manager: should restore
    manager = new ConnectorManager(configDir);
    const connector2 = new MockConnector();
    manager.register(connector2);
    await manager.configure('test_mock', { apiKey: 'key' });

    const before = manager.listSubscriptions();
    expect(before).toHaveLength(0); // Not yet restored

    await manager.initialize();

    const after = manager.listSubscriptions();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(subId);
    expect(after[0].endpoint).toBe('endpoint');
    expect(after[0].status).toBe('active');
  });

  it('should delete persisted subscription when unsubscribed', async () => {
    manager = new ConnectorManager(configDir);
    const connector = new MockConnector();
    manager.register(connector);
    await manager.configure('test_mock', { apiKey: 'key' });

    const sub = manager.subscribe(
      'test_mock',
      'endpoint',
      { param: 'value' },
      { interval: 'hourly' },
      {
        spreadsheetId: 'ss-123',
        range: 'A1:B10',
      }
    );

    // Wait for fire-and-forget persistence to complete
    await wait(100);

    const subFile = path.join(configDir, `${sub.id}.json`);
    expect(fs.existsSync(subFile)).toBe(true);

    manager.unsubscribe(sub.id);

    // Wait for async fire-and-forget deletion to complete
    await wait(100);

    // File should be deleted
    expect(fs.existsSync(subFile)).toBe(false);
  });

  it('should preserve nextId to prevent subscription ID collisions', async () => {
    manager = new ConnectorManager(configDir);
    const connector = new MockConnector();
    manager.register(connector);
    await manager.configure('test_mock', { apiKey: 'key' });

    // Create first subscription
    const sub1 = manager.subscribe(
      'test_mock',
      'endpoint',
      { param: 'value' },
      { interval: 'hourly' },
      {
        spreadsheetId: 'ss-123',
        range: 'A1:B10',
      }
    );
    expect(sub1.id).toBe('sub_1');

    // Wait for fire-and-forget persistence before dispose
    await wait(100);
    await manager.dispose();

    // Restore and create new subscription
    manager = new ConnectorManager(configDir);
    manager.register(new MockConnector());
    await manager.configure('test_mock', { apiKey: 'key' });
    await manager.initialize();

    const sub2 = manager.subscribe(
      'test_mock',
      'endpoint',
      { param: 'value2' },
      { interval: 'daily' },
      {
        spreadsheetId: 'ss-456',
        range: 'C1:D10',
      }
    );

    // Should be sub_2, not sub_1 (which would be a collision)
    expect(sub2.id).toBe('sub_2');
  });
});

describe('P5.3: Cron subscription restore on startup', () => {
  let configDir: string;
  let manager: ConnectorManager;

  beforeEach(() => {
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'serval-test-cron-'));
    configDir = path.join(tmpParent, 'cron');
  });

  afterEach(async () => {
    if (manager) {
      await manager.dispose();
    }
    if (fs.existsSync(configDir)) {
      safeRmSync(configDir, { recursive: true, force: true });
    }
  });

  it('should restore custom cron subscriptions with cron timer (not setInterval)', async () => {
    // Session 1: create a custom cron subscription
    manager = new ConnectorManager(configDir);
    const connector1 = new MockConnector();
    manager.register(connector1);
    await manager.configure('test_mock', { apiKey: 'key' });

    const sub = manager.subscribe(
      'test_mock',
      'endpoint',
      { param: 'value' },
      { interval: 'custom', customCronExpression: '0 */6 * * *', timezone: 'UTC' },
      { spreadsheetId: 'ss-123', range: 'A1:B10' }
    );

    await wait(100);
    await manager.dispose();

    // Session 2: restore and verify the subscription exists with cron schedule
    manager = new ConnectorManager(configDir);
    const connector2 = new MockConnector();
    manager.register(connector2);
    await manager.configure('test_mock', { apiKey: 'key' });

    await manager.initialize();

    const subs = manager.listSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].id).toBe(sub.id);
    expect(subs[0].schedule.interval).toBe('custom');
    expect(subs[0].schedule.customCronExpression).toBe('0 */6 * * *');
    expect(subs[0].status).toBe('active');
  });
});

describe('Integration: Config + Subscriptions together', () => {
  let configDir: string;
  let manager: ConnectorManager;

  beforeEach(() => {
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'serval-test-integ-'));
    configDir = path.join(tmpParent, 'integration');
    process.env['CONNECTOR_ENCRYPTION_KEY'] = 'test-encryption-key-32-chars-min!!';
    resetEnvForTest();
  });

  afterEach(async () => {
    if (manager) {
      await manager.dispose();
    }
    if (fs.existsSync(configDir)) {
      safeRmSync(configDir, { recursive: true, force: true });
    }
  });

  it('should restore both configs and subscriptions on startup', async () => {
    // Session 1: Set up connector with subscription
    manager = new ConnectorManager(configDir);
    const connector1 = new MockConnector();
    manager.register(connector1);
    await manager.configure('test_mock', { apiKey: 'production-key' });

    const sub1 = manager.subscribe(
      'test_mock',
      'market_data',
      { symbol: 'AAPL' },
      { interval: 'hourly' },
      {
        spreadsheetId: 'ss-production',
        range: 'Sheet1!A1:C100',
      }
    );

    expect(manager.listSubscriptions()).toHaveLength(1);
    // Wait for fire-and-forget persistence before dispose
    await wait(100);
    await manager.dispose();

    // Session 2: Verify everything is restored
    manager = new ConnectorManager(configDir);
    const connector2 = new MockConnector();
    manager.register(connector2);

    // Before initialize: nothing restored
    expect(manager.listConnectors().connectors[0].configured).toBe(false);
    expect(manager.listSubscriptions()).toHaveLength(0);

    // After initialize: everything restored
    await manager.initialize();

    expect(manager.listConnectors().connectors[0].configured).toBe(true);
    const subs = manager.listSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].id).toBe(sub1.id);
    expect(subs[0].destination.range).toBe('Sheet1!A1:C100');
  });
});
