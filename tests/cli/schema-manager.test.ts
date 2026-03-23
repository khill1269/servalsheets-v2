import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaManagerCli, type Command, type CliOptions } from '../../src/cli/schema-manager.js';
import type { DiscoverySchema } from '../../src/services/discovery-client.js';
import { resetDiscoveryApiClient } from '../../src/services/discovery-client.js';
import { resetSchemaCache } from '../../src/services/schema-cache.js';
import { resetSchemaValidator } from '../../src/services/schema-validator.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('SchemaManagerCli', () => {
  let cli: SchemaManagerCli;
  let testRootDir: string;

  const mockSheetsSchema: DiscoverySchema = {
    id: 'sheets:v4',
    name: 'sheets',
    version: 'v4',
    title: 'Google Sheets API',
    description: 'Test schema',
    documentationLink: 'https://example.com',
    schemas: {
      Spreadsheet: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string' },
        },
      },
    },
    resources: {
      spreadsheets: {
        methods: {
          get: {
            id: 'sheets.spreadsheets.get',
            path: 'v4/spreadsheets/{spreadsheetId}',
            httpMethod: 'GET',
            description: 'Returns the spreadsheet at the given ID.',
          },
        },
      },
    },
  };

  beforeEach(() => {
    // Enable Discovery API for tests
    process.env.DISCOVERY_API_ENABLED = 'true';
    testRootDir = mkdtempSync(join(tmpdir(), 'servalsheets-schema-manager-test-'));
    process.env.SERVALSHEETS_SCHEMA_CACHE_DIR = join(testRootDir, '.discovery-cache');

    resetSchemaCache();
    cli = new SchemaManagerCli();
    vi.clearAllMocks();

    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    try {
      if (testRootDir && existsSync(testRootDir)) {
        rmSync(testRootDir, { recursive: true, force: true });
      }
    } catch {
      // EPERM in sandboxed environments — safe to ignore
    }
    delete process.env.DISCOVERY_API_ENABLED;
    delete process.env.SERVALSHEETS_SCHEMA_CACHE_DIR;
    resetDiscoveryApiClient();
    resetSchemaCache();
    resetSchemaValidator();
    vi.restoreAllMocks();
  });

  describe('fetch command', () => {
    it('should fetch and cache schemas', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const options: CliOptions = { api: 'sheets', version: 'v4' };
      await cli.run('fetch', options);

      expect(global.fetch).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Fetching Google API schemas')
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cached successfully'));
    });

    it('should fetch all APIs when api=all', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const options: CliOptions = { api: 'all' };
      await cli.run('fetch', options);

      // Should log for both sheets and drive
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/sheets|drive/i));
    });

    it('should handle fetch errors', async () => {
      // Reset to get fresh instance
      resetDiscoveryApiClient();

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      const newCli = new SchemaManagerCli();
      const options: CliOptions = { api: 'sheets' };
      await newCli.run('fetch', options);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'));
    });
  });

  describe('versions command', () => {
    it('should list available versions', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { name: 'sheets', version: 'v4', preferred: true },
            { name: 'sheets', version: 'v3' },
          ],
        }),
      });

      const options: CliOptions = { api: 'sheets' };
      await cli.run('versions', options);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/discovery/v1/apis?name=sheets',
        expect.any(Object)
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('v4'));
    });

    it('should list versions for all APIs', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ name: 'sheets', version: 'v4' }],
        }),
      });

      const options: CliOptions = { api: 'all' };
      await cli.run('versions', options);

      // Should call fetch for both sheets and drive
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear-cache command', () => {
    it('should clear all cache', async () => {
      // First populate cache
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      await cli.run('fetch', { api: 'sheets' });

      // Then clear it
      await cli.run('clear-cache');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Cleared all cached'));
    });

    it('should clear specific API cache', async () => {
      // First populate cache
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      await cli.run('fetch', { api: 'sheets' });

      // Clear specific API
      await cli.run('clear-cache', { api: 'sheets', version: 'v4' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Cleared sheets API v4 cache')
      );
    });
  });

  describe('compare command', () => {
    it('should compare schemas', async () => {
      // Mock Discovery API enabled
      process.env.DISCOVERY_API_ENABLED = 'true';

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const options: CliOptions = { api: 'sheets' };
      await cli.run('compare', options);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Comparing schemas'));
    });

    it('should handle schema comparison', async () => {
      // Reset to get fresh state
      resetDiscoveryApiClient();
      resetSchemaValidator();

      // Mock schema that will complete comparison
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const newCli = new SchemaManagerCli();
      await newCli.run('compare', { api: 'sheets' });

      // Should complete comparison (may find changes or not)
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Comparing schemas'));
    });
  });

  describe('migration-report command', () => {
    it('should generate migration report', async () => {
      process.env.DISCOVERY_API_ENABLED = 'true';

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const options: CliOptions = { api: 'sheets' };
      await cli.run('migration-report', options);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Generating migration report')
      );
    });

    it('should handle no changes', async () => {
      process.env.DISCOVERY_API_ENABLED = 'true';

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      await cli.run('migration-report', { api: 'sheets' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
    });
  });

  describe('help command', () => {
    it('should show help message', async () => {
      await cli.run('help');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Schema Manager CLI'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('USAGE:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('COMMANDS:'));
    });

    it('should show help for unknown command', async () => {
      await cli.run('unknown' as Command);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Schema Manager CLI'));
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      const mockExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Test error'));

      try {
        await cli.run('fetch', { api: 'sheets' });
      } catch (error) {
        // Expected error from process.exit
      }

      mockExitSpy.mockRestore();
    });
  });

  describe('option parsing', () => {
    it('should parse api option', async () => {
      resetDiscoveryApiClient();

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const newCli = new SchemaManagerCli();
      await newCli.run('fetch', { api: 'drive', version: 'v3' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('drive'));
    });

    it('should use default versions', async () => {
      resetDiscoveryApiClient();

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      const newCli = new SchemaManagerCli();
      await newCli.run('fetch', { api: 'sheets' });

      // Should log for sheets API
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('sheets'));
    });
  });

  describe('formatting helpers', () => {
    it('should format bytes correctly', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSheetsSchema,
      });

      await cli.run('fetch', { api: 'sheets' });

      // Should display formatted size in cache stats
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Total size:/));
    });

    it('should display issue icons by severity', async () => {
      process.env.DISCOVERY_API_ENABLED = 'true';

      const schemaWithDeprecation = {
        ...mockSheetsSchema,
        schemas: {
          ...mockSheetsSchema.schemas,
          Spreadsheet: {
            type: 'object',
            properties: {
              spreadsheetId: { type: 'string' },
              oldField: { type: 'string', deprecated: true, description: 'Deprecated' },
            },
          },
        },
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => schemaWithDeprecation,
      });

      await cli.run('compare', { api: 'sheets' });

      // Should show emoji indicators for issues
      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/[🔴🟠🟡🔵ℹ️]/));
    });
  });
});
