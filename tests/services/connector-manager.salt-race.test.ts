import { createDecipheriv, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

class StubConnector {
  readonly id = 'stub';
  readonly name = 'Stub';
  readonly description = 'Stub connector for tests';
  readonly authType = 'api_key' as const;

  isConfigured(): boolean {
    return true;
  }

  async configure(): Promise<void> {}
  async healthCheck() {
    return {
      healthy: true,
      latencyMs: 1,
      message: 'ok',
      lastChecked: new Date('2024-01-15T00:00:00Z').toISOString(),
    };
  }
  async dispose(): Promise<void> {}
  async listEndpoints() {
    return [];
  }
  async getSchema() {
    return { endpoint: 'stub', columns: [] };
  }
  async query() {
    return {
      headers: [],
      rows: [],
      metadata: {
        source: 'stub',
        endpoint: 'stub',
        fetchedAt: new Date('2024-01-15T00:00:00Z').toISOString(),
        rowCount: 0,
        cached: false,
        quotaUsed: 0,
      },
    };
  }
  getQuotaUsage() {
    return {
      used: 0,
      limit: 1,
      resetAt: new Date('2024-01-15T00:00:00Z').toISOString(),
      unit: 'requests',
    };
  }
  getRateLimits() {
    return { requestsPerMinute: 1 };
  }
}

describe('ConnectorManager salt persistence', () => {
  afterEach(() => {
    delete process.env['CONNECTOR_ENCRYPTION_KEY'];
    delete process.env['CONNECTOR_CONFIG_DIR'];
    vi.restoreAllMocks();
    vi.doUnmock('fs');
    vi.resetModules();
  });

  it('reuses the persisted salt when a salt file already exists', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-salt-race-'));
    process.env['CONNECTOR_ENCRYPTION_KEY'] = 'unit-test-secret';
    process.env['CONNECTOR_CONFIG_DIR'] = tempDir;
    vi.doUnmock('fs');

    const saltFile = path.join(tempDir, '.salt');
    const configFile = path.join(tempDir, 'stub.json');
    const existingSalt = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(saltFile, existingSalt, { mode: 0o600 });

    const { ConnectorManager } = await import('../../src/connectors/connector-manager.js');

    const manager = new ConnectorManager(tempDir);
    manager.register(new StubConnector() as any);

    const configureResult = await manager.configure('stub', {
      apiKey: 'secret-api-key',
    });

    expect(configureResult.success).toBe(true);
    expect(fs.existsSync(configFile)).toBe(true);
    expect(fs.readFileSync(saltFile)).toEqual(existingSalt);

    const rawConfig = fs.readFileSync(configFile, 'utf8');
    const parsed = JSON.parse(rawConfig) as {
      iv: string;
      tag: string;
      ciphertext: string;
      version: 1;
    };
    const key = scryptSync(process.env['CONNECTOR_ENCRYPTION_KEY']!, existingSalt, 32, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const restoredConfig = JSON.parse(decrypted) as {
      connectorId: string;
      credentials: { apiKey: string };
    };

    expect(restoredConfig.connectorId).toBe('stub');
    expect(restoredConfig.credentials).toEqual({ apiKey: 'secret-api-key' });

    const restoredManager = new ConnectorManager(tempDir);
    const restoredConnector = new StubConnector();
    const configureSpy = vi.spyOn(restoredConnector, 'configure');
    restoredManager.register(restoredConnector as any);

    const restoredCount = await restoredManager.restorePersistedConfigs();

    expect(restoredCount).toBe(1);
    expect(configureSpy).toHaveBeenCalledWith({ apiKey: 'secret-api-key' });

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
