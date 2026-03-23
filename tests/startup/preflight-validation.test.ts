/**
 * Tests for Pre-Flight Validation System
 *
 * Tests startup validation checks that run before server initialization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, accessSync, constants as fsConstants, readFileSync } from 'fs';
import { runPreflightChecks } from '../../src/startup/preflight-validation.js';

// Store original env
const originalEnv = { ...process.env };

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  accessSync: vi.fn(),
  readFileSync: vi.fn(),
  constants: { W_OK: 2 },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('net', () => ({
  createServer: vi.fn(() => {
    const EventEmitter = require('events');
    const server = new EventEmitter();
    server.listen = vi.fn((port: number) => {
      // Simulate successful port binding
      setTimeout(() => server.emit('listening'), 0);
    });
    server.close = vi.fn();
    return server;
  }),
}));

describe('Pre-Flight Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['SKIP_PREFLIGHT'];
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ engines: { node: '>=20.0.0' } }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('SKIP_PREFLIGHT flag', () => {
    it('should skip all checks when SKIP_PREFLIGHT=true', async () => {
      process.env['SKIP_PREFLIGHT'] = 'true';

      const result = await runPreflightChecks();

      expect(result.checks).toHaveLength(0);
      expect(result.criticalFailures).toBe(0);
      expect(result.warnings).toBe(0);
    });

    it('should run checks when SKIP_PREFLIGHT is not set', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      expect(result.checks.length).toBeGreaterThan(0);
    });
  });

  describe('Build Artifacts Check', () => {
    it('should pass when all build artifacts exist', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const buildCheck = result.checks.find((c) => c.name === 'Build Artifacts');
      expect(buildCheck).toBeDefined();
      expect(buildCheck?.result.passed).toBe(true);
      expect(buildCheck?.critical).toBe(true);
    });

    it('should fail when dist/ directory missing', async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return !pathStr.includes('dist');
      });
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const buildCheck = result.checks.find((c) => c.name === 'Build Artifacts');
      expect(buildCheck?.result.passed).toBe(false);
      expect(buildCheck?.result.message).toContain('dist/ directory not found');
      expect(buildCheck?.result.fix).toContain('npm run build');
    });

    it('should fail when dist/cli.js missing', async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return !pathStr.includes('cli.js');
      });
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const buildCheck = result.checks.find((c) => c.name === 'Build Artifacts');
      expect(buildCheck?.result.passed).toBe(false);
      expect(buildCheck?.result.message).toContain('dist/cli.js not found');
    });

    it('should fail when dist/server.js missing', async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return !pathStr.includes('server.js');
      });
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const buildCheck = result.checks.find((c) => c.name === 'Build Artifacts');
      expect(buildCheck?.result.passed).toBe(false);
      expect(buildCheck?.result.message).toContain('dist/server.js not found');
    });
  });

  describe('Node.js Version Check', () => {
    it('should pass with Node.js v20.x', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const nodeCheck = result.checks.find((c) => c.name === 'Node.js Version');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck?.result.passed).toBe(true);
      expect(nodeCheck?.critical).toBe(true);
      expect(nodeCheck?.result.details?.required).toBe('>=20.0.0');
    });

    it('should fail when package.json requires a newer Node major', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ engines: { node: '>=999.0.0' } }));

      const result = await runPreflightChecks();

      const nodeCheck = result.checks.find((c) => c.name === 'Node.js Version');
      expect(nodeCheck?.result.passed).toBe(false);
      expect(nodeCheck?.result.message).toContain('requires >=999.0.0');
    });
  });

  describe('Configuration Validation Check', () => {
    it('should pass with valid configuration', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck).toBeDefined();
      expect(configCheck?.result.passed).toBe(true);
      expect(configCheck?.critical).toBe(true);
    });

    it('should fail with invalid ENCRYPTION_KEY length', async () => {
      process.env['ENCRYPTION_KEY'] = 'tooshort';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(false);
      expect(configCheck?.result.message).toContain('Configuration validation failed');
      const issues = configCheck?.result.details?.issues as string[];
      expect(issues).toBeDefined();
      expect(
        issues.some((issue: string) => issue.includes('ENCRYPTION_KEY must be 64 hex characters'))
      ).toBe(true);
    });

    it('should fail with incomplete local OAuth client configuration', async () => {
      process.env['GOOGLE_CLIENT_ID'] = 'test-client-id';
      // Missing GOOGLE_CLIENT_SECRET
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(false);
      expect(configCheck?.result.message).toContain('Configuration validation failed');
      const issues = configCheck?.result.details?.issues as string[];
      expect(issues).toBeDefined();
      expect(
        issues.some((issue: string) => issue.includes('Incomplete OAuth client configuration'))
      ).toBe(true);
    });

    it('should fail with incomplete remote OAuth configuration', async () => {
      process.env['JWT_SECRET'] = 'a'.repeat(64);
      process.env['STATE_SECRET'] = 'b'.repeat(64);
      process.env['OAUTH_CLIENT_SECRET'] = 'c'.repeat(32);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(false);
      const issues = configCheck?.result.details?.issues as string[];
      expect(issues).toBeDefined();
      expect(
        issues.some((issue: string) => issue.includes('Incomplete remote OAuth configuration'))
      ).toBe(true);
    });

    it('should pass with complete remote OAuth configuration', async () => {
      process.env['JWT_SECRET'] = 'a'.repeat(64);
      process.env['STATE_SECRET'] = 'b'.repeat(64);
      process.env['OAUTH_CLIENT_SECRET'] = 'c'.repeat(32);
      process.env['GOOGLE_CLIENT_ID'] = 'google-client-id';
      process.env['GOOGLE_CLIENT_SECRET'] = 'google-client-secret';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(true);
    });

    it('should fail with invalid REDIS_URL format', async () => {
      process.env['REDIS_URL'] = 'http://localhost:6379';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(false);
      expect(configCheck?.result.message).toContain('Configuration validation failed');
      const issues = configCheck?.result.details?.issues as string[];
      expect(issues).toBeDefined();
      expect(
        issues.some((issue: string) => issue.includes('REDIS_URL should start with redis://'))
      ).toBe(true);
    });

    it('should pass with valid REDIS_URL', async () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(true);
    });

    it('should pass with valid rediss:// URL', async () => {
      process.env['REDIS_URL'] = 'rediss://localhost:6379';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const configCheck = result.checks.find((c) => c.name === 'Configuration Validation');
      expect(configCheck?.result.passed).toBe(true);
    });
  });

  describe('File System Permissions Check', () => {
    it('should pass when directory is writable', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const fsCheck = result.checks.find((c) => c.name === 'File System Permissions');
      expect(fsCheck).toBeDefined();
      expect(fsCheck?.result.passed).toBe(true);
      expect(fsCheck?.critical).toBe(false); // Non-critical check
    });

    it('should pass when directory does not exist (will be created)', async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return !pathStr.includes('.servalsheets');
      });
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const fsCheck = result.checks.find((c) => c.name === 'File System Permissions');
      expect(fsCheck?.result.passed).toBe(true);
      expect(fsCheck?.result.message).toContain('will be created');
    });

    it('should fail when directory is not writable', async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.includes('.servalsheets');
      });
      vi.mocked(accessSync).mockImplementation((path, mode) => {
        const pathStr = String(path);
        if (pathStr.includes('.servalsheets') && mode === fsConstants.W_OK) {
          throw new Error('EACCES: permission denied');
        }
      });

      const result = await runPreflightChecks();

      const fsCheck = result.checks.find((c) => c.name === 'File System Permissions');
      expect(fsCheck?.result.passed).toBe(false);
      expect(fsCheck?.result.message).toContain('permission');
      expect(fsCheck?.result.fix).toContain('chmod');
    });
  });

  describe('Port Availability Check', () => {
    it('should skip check in STDIO mode', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const portCheck = result.checks.find((c) => c.name === 'Port Availability');
      expect(portCheck).toBeDefined();
      expect(portCheck?.result.passed).toBe(true);
      expect(portCheck?.result.message).toContain('STDIO mode');
      expect(portCheck?.critical).toBe(false);
    });

    it('should check port in HTTP mode', async () => {
      // Add --http flag to argv
      process.argv.push('--http');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const portCheck = result.checks.find((c) => c.name === 'Port Availability');
      expect(portCheck).toBeDefined();
      expect(portCheck?.result.passed).toBe(true);

      // Cleanup
      process.argv.pop();
    });
  });

  describe('Results Summary', () => {
    it('should count critical failures correctly', async () => {
      vi.mocked(existsSync).mockReturnValue(false); // Fail build check
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      expect(result.criticalFailures).toBeGreaterThan(0);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.failures[0]).toHaveProperty('name');
      expect(result.failures[0]).toHaveProperty('message');
      expect(result.failures[0]).toHaveProperty('fix');
    });

    it('should count warnings correctly', async () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        // Make .servalsheets exist but not writable (warning, not critical)
        return pathStr.includes('.servalsheets');
      });
      vi.mocked(accessSync).mockImplementation((path, mode) => {
        const pathStr = String(path);
        if (pathStr.includes('.servalsheets') && mode === fsConstants.W_OK) {
          throw new Error('EACCES: permission denied');
        }
      });

      const result = await runPreflightChecks();

      expect(result.warnings).toBeGreaterThan(0);
      expect(result.warningList.length).toBeGreaterThan(0);
      expect(result.warningList[0]).toHaveProperty('name');
      expect(result.warningList[0]).toHaveProperty('message');
    });

    it('should handle check exceptions gracefully', async () => {
      // Mock to throw an exception
      vi.mocked(existsSync).mockImplementation(() => {
        throw new Error('Filesystem error');
      });

      const result = await runPreflightChecks();

      // Should complete without crashing
      expect(result).toBeDefined();
      expect(result.checks.length).toBeGreaterThan(0);

      // Failed checks should be recorded
      const failedChecks = result.checks.filter((c) => !c.result.passed);
      expect(failedChecks.length).toBeGreaterThan(0);
    });
  });

  describe('Module Resolution Check', () => {
    it('should identify the check exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const moduleCheck = result.checks.find((c) => c.name === 'Module Resolution');
      expect(moduleCheck).toBeDefined();
      expect(moduleCheck?.critical).toBe(true);
    });
  });

  describe('Integration', () => {
    it('should run all 9 checks', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      expect(result.checks).toHaveLength(9);

      const checkNames = result.checks.map((c) => c.name);
      expect(checkNames).toContain('Build Artifacts');
      expect(checkNames).toContain('Node.js Version');
      expect(checkNames).toContain('Module Resolution');
      expect(checkNames).toContain('Configuration Validation');
      expect(checkNames).toContain('File System Permissions');
      expect(checkNames).toContain('Port Availability');
      expect(checkNames).toContain('Tool Registration Parity');
      expect(checkNames).toContain('Server Instructions Length');
    });

    it('should mark critical checks correctly', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(accessSync).mockImplementation(() => {});

      const result = await runPreflightChecks();

      const criticalChecks = result.checks.filter((c) => c.critical);
      const nonCriticalChecks = result.checks.filter((c) => !c.critical);

      expect(criticalChecks.length).toBe(4); // Build, Node, Modules, Config
      expect(nonCriticalChecks.length).toBe(5); // File System, Port, Tool Registration Parity, Server Instructions Length, + 1 new
    });
  });
});
