import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DiscoveryApiClient,
  getDiscoveryApiClient,
  resetDiscoveryApiClient,
  type DiscoverySchema,
} from '../src/services/discovery-client.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('DiscoveryApiClient', () => {
  let client: DiscoveryApiClient;

  beforeEach(() => {
    client = new DiscoveryApiClient({ enabled: true, cacheTTL: 60, timeout: 5000 });
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDiscoveryApiClient();
  });

  describe('getApiSchema', () => {
    it('should fetch Sheets API schema', async () => {
      const mockSchema: DiscoverySchema = {
        id: 'sheets:v4',
        name: 'sheets',
        version: 'v4',
        title: 'Google Sheets API',
        description: 'Reads and writes Google Sheets.',
        documentationLink: 'https://developers.google.com/sheets/',
        schemas: {
          Spreadsheet: {
            type: 'object',
            description: 'Resource that represents a spreadsheet.',
            properties: {
              spreadsheetId: {
                type: 'string',
                description: 'The ID of the spreadsheet.',
              },
              properties: {
                $ref: 'SpreadsheetProperties',
              },
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

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSchema,
      });

      const schema = await client.getApiSchema('sheets', 'v4');

      expect(schema).toEqual(mockSchema);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://sheets.googleapis.com/$discovery/rest?version=v4',
        expect.objectContaining({
          headers: {
            'User-Agent': 'ServalSheets/1.0 (Discovery API Client)',
          },
        })
      );
    });

    it('should fetch Drive API schema', async () => {
      const mockSchema: DiscoverySchema = {
        id: 'drive:v3',
        name: 'drive',
        version: 'v3',
        title: 'Google Drive API',
        description: 'Manages files in Drive.',
        documentationLink: 'https://developers.google.com/drive/',
        schemas: {},
        resources: {},
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSchema,
      });

      const schema = await client.getApiSchema('drive', 'v3');

      expect(schema).toEqual(mockSchema);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        expect.any(Object)
      );
    });

    it('should cache schemas', async () => {
      const mockSchema: DiscoverySchema = {
        id: 'sheets:v4',
        name: 'sheets',
        version: 'v4',
        title: 'Google Sheets API',
        description: 'Test',
        documentationLink: 'https://example.com',
        schemas: {},
        resources: {},
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSchema,
      });

      // First call - should fetch
      await client.getApiSchema('sheets', 'v4');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await client.getApiSchema('sheets', 'v4');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw when Discovery API is disabled', async () => {
      const disabledClient = new DiscoveryApiClient({ enabled: false });

      await expect(disabledClient.getApiSchema('sheets', 'v4')).rejects.toThrow(
        'Discovery API is not enabled'
      );
    });

    it('should throw on HTTP error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(client.getApiSchema('sheets', 'v4')).rejects.toThrow(
        'Discovery API returned 404: Not Found'
      );
    });

    it('should handle timeout', async () => {
      const shortTimeoutClient = new DiscoveryApiClient({ enabled: true, timeout: 100 });

      (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            // Simulate abort signal triggering
            if (options?.signal) {
              setTimeout(() => {
                const abortError = new Error('The operation was aborted');
                abortError.name = 'AbortError';
                reject(abortError);
              }, 50);
            }
          })
      );

      await expect(shortTimeoutClient.getApiSchema('sheets', 'v4')).rejects.toThrow(
        'Discovery API request timed out'
      );
    });
  });

  describe('listAvailableVersions', () => {
    it('should list available versions for Sheets API', async () => {
      const mockResponse = {
        items: [
          { name: 'sheets', version: 'v4', preferred: true },
          { name: 'sheets', version: 'v3' },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const versions = await client.listAvailableVersions('sheets');

      expect(versions).toEqual(['v4', 'v3']);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/discovery/v1/apis?name=sheets',
        expect.any(Object)
      );
    });

    it('should filter by API name', async () => {
      const mockResponse = {
        items: [
          { name: 'sheets', version: 'v4' },
          { name: 'drive', version: 'v3' },
          { name: 'sheets', version: 'v3' },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const versions = await client.listAvailableVersions('sheets');

      expect(versions).toEqual(['v4', 'v3']);
    });

    it('should handle empty response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const versions = await client.listAvailableVersions('sheets');

      expect(versions).toEqual([]);
    });
  });

  describe('compareSchemas', () => {
    it('should detect new fields', () => {
      const currentSchema: DiscoverySchema = {
        id: 'test:v1',
        name: 'test',
        version: 'v1',
        title: 'Test API',
        description: 'Test',
        documentationLink: '',
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
        resources: {},
      };

      const newSchema: DiscoverySchema = {
        ...currentSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string', description: 'The title' },
            },
          },
        },
      };

      const comparison = client.compareSchemas('test', 'v1', currentSchema, newSchema);

      expect(comparison.newFields).toHaveLength(1);
      expect(comparison.newFields[0]?.path).toBe('Spreadsheet.title');
      expect(comparison.newFields[0]?.type).toBe('string');
      expect(comparison.hasChanges).toBe(true);
    });

    it('should detect deprecated fields', () => {
      const currentSchema: DiscoverySchema = {
        id: 'test:v1',
        name: 'test',
        version: 'v1',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              oldField: { type: 'string' },
            },
          },
        },
        resources: {},
      };

      const newSchema: DiscoverySchema = {
        ...currentSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              oldField: { type: 'string', deprecated: true, description: 'Use newField instead' },
            },
          },
        },
      };

      const comparison = client.compareSchemas('test', 'v1', currentSchema, newSchema);

      expect(comparison.deprecatedFields).toHaveLength(1);
      expect(comparison.deprecatedFields[0]?.path).toBe('Spreadsheet.oldField');
      expect(comparison.hasChanges).toBe(true);
    });

    it('should detect type changes', () => {
      const currentSchema: DiscoverySchema = {
        id: 'test:v1',
        name: 'test',
        version: 'v1',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              count: { type: 'string' },
            },
          },
        },
        resources: {},
      };

      const newSchema: DiscoverySchema = {
        ...currentSchema,
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              count: { type: 'integer' },
            },
          },
        },
      };

      const comparison = client.compareSchemas('test', 'v1', currentSchema, newSchema);

      expect(comparison.changedFields).toHaveLength(1);
      expect(comparison.changedFields[0]?.path).toBe('Spreadsheet.count');
      expect(comparison.changedFields[0]?.oldType).toBe('string');
      expect(comparison.changedFields[0]?.newType).toBe('integer');
      expect(comparison.hasChanges).toBe(true);
    });

    it('should detect new methods', () => {
      const currentSchema: DiscoverySchema = {
        id: 'test:v1',
        name: 'test',
        version: 'v1',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {},
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'test.spreadsheets.get',
                path: '/spreadsheets/{id}',
                httpMethod: 'GET',
              },
            },
          },
        },
      };

      const newSchema: DiscoverySchema = {
        ...currentSchema,
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'test.spreadsheets.get',
                path: '/spreadsheets/{id}',
                httpMethod: 'GET',
              },
              create: {
                id: 'test.spreadsheets.create',
                path: '/spreadsheets',
                httpMethod: 'POST',
                description: 'Creates a spreadsheet',
              },
            },
          },
        },
      };

      const comparison = client.compareSchemas('test', 'v1', currentSchema, newSchema);

      expect(comparison.newMethods).toHaveLength(1);
      expect(comparison.newMethods[0]?.name).toBe('spreadsheets.create');
      expect(comparison.hasChanges).toBe(true);
    });

    it('should detect removed methods', () => {
      const currentSchema: DiscoverySchema = {
        id: 'test:v1',
        name: 'test',
        version: 'v1',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {},
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'test.spreadsheets.get',
                path: '/spreadsheets/{id}',
                httpMethod: 'GET',
              },
              delete: {
                id: 'test.spreadsheets.delete',
                path: '/spreadsheets/{id}',
                httpMethod: 'DELETE',
              },
            },
          },
        },
      };

      const newSchema: DiscoverySchema = {
        ...currentSchema,
        resources: {
          spreadsheets: {
            methods: {
              get: {
                id: 'test.spreadsheets.get',
                path: '/spreadsheets/{id}',
                httpMethod: 'GET',
              },
            },
          },
        },
      };

      const comparison = client.compareSchemas('test', 'v1', currentSchema, newSchema);

      expect(comparison.removedMethods).toHaveLength(1);
      expect(comparison.removedMethods[0]).toBe('spreadsheets.delete');
      expect(comparison.hasChanges).toBe(true);
    });

    it('should handle schemas with no changes', () => {
      const schema: DiscoverySchema = {
        id: 'test:v1',
        name: 'test',
        version: 'v1',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {
          Spreadsheet: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
        resources: {},
      };

      const comparison = client.compareSchemas('test', 'v1', schema, schema);

      expect(comparison.hasChanges).toBe(false);
      expect(comparison.newFields).toHaveLength(0);
      expect(comparison.deprecatedFields).toHaveLength(0);
      expect(comparison.changedFields).toHaveLength(0);
      expect(comparison.newMethods).toHaveLength(0);
      expect(comparison.removedMethods).toHaveLength(0);
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      const mockSchema: DiscoverySchema = {
        id: 'sheets:v4',
        name: 'sheets',
        version: 'v4',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {},
        resources: {},
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSchema,
      });

      // Populate cache
      await client.getApiSchema('sheets', 'v4');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      client.clearCache();

      // Should fetch again
      await client.getApiSchema('sheets', 'v4');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should return cache stats', async () => {
      const mockSchema: DiscoverySchema = {
        id: 'sheets:v4',
        name: 'sheets',
        version: 'v4',
        title: 'Test',
        description: 'Test',
        documentationLink: '',
        schemas: {},
        resources: {},
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSchema,
      });

      const emptyStats = client.getCacheStats();
      expect(emptyStats.entries).toBe(0);

      await client.getApiSchema('sheets', 'v4');
      await client.getApiSchema('drive', 'v3');

      const stats = client.getCacheStats();
      expect(stats.entries).toBe(2);
      expect(stats.oldestEntry).toBeGreaterThan(0);
      expect(stats.newestEntry).toBeGreaterThan(0);
    });
  });

  describe('global instance', () => {
    afterEach(() => {
      resetDiscoveryApiClient();
      delete process.env.DISCOVERY_API_ENABLED;
      delete process.env.DISCOVERY_CACHE_TTL;
    });

    it('should create global instance with environment config', () => {
      process.env.DISCOVERY_API_ENABLED = 'true';
      process.env.DISCOVERY_CACHE_TTL = '3600';

      const globalClient = getDiscoveryApiClient();

      expect(globalClient).toBeDefined();
      expect(globalClient.isEnabled()).toBe(true);
    });

    it('should reuse existing global instance', () => {
      const client1 = getDiscoveryApiClient();
      const client2 = getDiscoveryApiClient();

      expect(client1).toBe(client2);
    });

    it('should reset global instance', () => {
      const client1 = getDiscoveryApiClient();
      resetDiscoveryApiClient();
      const client2 = getDiscoveryApiClient();

      expect(client1).not.toBe(client2);
    });
  });
});
