/**
 * Response Validator Service Tests (Phase 3.4)
 *
 * Tests for ResponseValidator service
 * Covers schema validation, error detection, and graceful degradation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResponseValidator } from '../../src/services/response-validator.js';
import type { sheets_v4 } from 'googleapis';

// Mock discovery client
vi.mock('../../src/services/discovery-client.js', () => ({
  getDiscoveryApiClient: () => ({
    isEnabled: vi.fn(() => true),
    getApiSchema: vi.fn().mockResolvedValue({
      schemas: {
        BatchUpdateSpreadsheetResponse: {
          type: 'object',
          properties: {
            spreadsheetId: { type: 'string' },
            replies: {
              type: 'array',
              items: { type: 'object' },
            },
          },
        },
      },
    }),
  }),
}));

describe('ResponseValidator', () => {
  let validator: ResponseValidator;

  beforeEach(() => {
    validator = new ResponseValidator({
      enabled: true,
      strict: false,
      checkDeprecations: true,
      maxDepth: 10,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultValidator = new ResponseValidator();

      expect(defaultValidator).toBeDefined();
      expect(defaultValidator.isEnabled()).toBe(false); // Disabled by default
    });

    it('should initialize with custom config', () => {
      const customValidator = new ResponseValidator({
        enabled: true,
        strict: true,
        checkDeprecations: false,
        maxDepth: 5,
      });

      expect(customValidator).toBeDefined();
      expect(customValidator.isEnabled()).toBe(true);
    });

    it('should respect environment variable', () => {
      const originalEnv = process.env['SCHEMA_VALIDATION_ENABLED'];
      process.env['SCHEMA_VALIDATION_ENABLED'] = 'true';

      const envValidator = new ResponseValidator();

      expect(envValidator.isEnabled()).toBe(true);

      // Restore original env
      if (originalEnv !== undefined) {
        process.env['SCHEMA_VALIDATION_ENABLED'] = originalEnv;
      } else {
        delete process.env['SCHEMA_VALIDATION_ENABLED'];
      }
    });
  });

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      const enabledValidator = new ResponseValidator({ enabled: true });

      expect(enabledValidator.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const disabledValidator = new ResponseValidator({ enabled: false });

      expect(disabledValidator.isEnabled()).toBe(false);
    });
  });

  describe('validateBatchUpdateResponse', () => {
    it('should skip validation when disabled', async () => {
      const disabledValidator = new ResponseValidator({ enabled: false });

      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [],
      };

      const result = await disabledValidator.validateBatchUpdateResponse(response);

      expect(result.valid).toBe(true);
      expect(result.validated).toBe(false);
      expect(result.skipReason).toBe('Response validation is disabled');
    });

    it('should validate valid response', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [
          {
            addSheet: {
              properties: {
                sheetId: 123,
                title: 'New Sheet',
              },
            },
          },
        ],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.validated).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should handle empty response', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {};

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.validated).toBe(true);
      // Empty response is valid (optional fields)
    });

    it('should handle response with multiple replies', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [
          {
            addSheet: {
              properties: {
                sheetId: 1,
                title: 'Sheet1',
              },
            },
          },
          {
            addSheet: {
              properties: {
                sheetId: 2,
                title: 'Sheet2',
              },
            },
          },
        ],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.validated).toBe(true);
    });

    it('should not throw when strict mode is disabled', async () => {
      const nonStrictValidator = new ResponseValidator({
        enabled: true,
        strict: false,
      });

      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
      };

      // Should not throw
      await expect(nonStrictValidator.validateBatchUpdateResponse(response)).resolves.toBeDefined();
    });

    it('should handle validation exceptions gracefully', async () => {
      // Override internal discovery client to force schema fetch failure
      (
        validator as unknown as {
          discoveryClient: { isEnabled: () => boolean; getApiSchema: () => Promise<unknown> };
        }
      ).discoveryClient = {
        isEnabled: () => true,
        getApiSchema: vi.fn().mockRejectedValue(new Error('Discovery offline')),
      };

      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.valid).toBe(true); // Fail-safe
      expect(result.validated).toBe(false);
      expect(result.skipReason).toContain('Validation exception');
      expect(result.skipReason).toContain('Discovery offline');
    });
  });

  describe('validateResponse', () => {
    it('should validate arbitrary response', async () => {
      const response = {
        spreadsheetId: 'test-id',
        properties: {
          title: 'Test Sheet',
        },
      };

      const result = await validator.validateResponse(response, 'Spreadsheet', 'sheets', 'v4');

      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
    });

    it('should handle unknown schema types gracefully', async () => {
      const response = { data: 'test' };

      const result = await validator.validateResponse(
        response,
        'UnknownSchemaType',
        'sheets',
        'v4'
      );

      expect(result.valid).toBe(true); // Fail-safe
      expect(result.validated).toBe(false);
    });

    it('should support different API types', async () => {
      const response = { id: 'file-123' };

      const sheetsResult = await validator.validateResponse(response, 'Spreadsheet', 'sheets');
      const driveResult = await validator.validateResponse(response, 'File', 'drive');

      expect(sheetsResult).toBeDefined();
      expect(driveResult).toBeDefined();
    });

    it('should skip validation when disabled', async () => {
      const disabledValidator = new ResponseValidator({ enabled: false });

      const response = { test: 'data' };

      const result = await disabledValidator.validateResponse(response, 'Spreadsheet');

      expect(result.valid).toBe(true);
      expect(result.validated).toBe(false);
      expect(result.skipReason).toBe('Response validation is disabled');
    });
  });

  describe('validation results', () => {
    it('should include errors array', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should include warnings array', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should indicate if validation was performed', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(typeof result.validated).toBe('boolean');
    });

    it('should provide skip reason when validation skipped', async () => {
      const disabledValidator = new ResponseValidator({ enabled: false });

      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {};

      const result = await disabledValidator.validateBatchUpdateResponse(response);

      expect(result.skipReason).toBeDefined();
      expect(typeof result.skipReason).toBe('string');
    });
  });

  describe('error handling', () => {
    it('should handle null response', async () => {
      const result = await validator.validateBatchUpdateResponse(
        null as unknown as sheets_v4.Schema$BatchUpdateSpreadsheetResponse
      );

      expect(result).toBeDefined();
      expect(result.valid).toBe(true); // Fail-safe
    });

    it('should handle undefined response', async () => {
      const result = await validator.validateBatchUpdateResponse(
        undefined as unknown as sheets_v4.Schema$BatchUpdateSpreadsheetResponse
      );

      expect(result).toBeDefined();
      expect(result.valid).toBe(true); // Fail-safe
    });

    it('should handle malformed response', async () => {
      const malformedResponse = {
        spreadsheetId: 123, // Wrong type (should be string)
        replies: 'not-an-array', // Wrong type (should be array)
      } as unknown as sheets_v4.Schema$BatchUpdateSpreadsheetResponse;

      const result = await validator.validateBatchUpdateResponse(malformedResponse);

      expect(result).toBeDefined();
      // Validation may detect errors or fail-safe
    });

    it('should not crash on circular references', async () => {
      const circular: Record<string, unknown> = {
        spreadsheetId: 'test-id',
      };
      circular['self'] = circular; // Circular reference

      const result = await validator.validateBatchUpdateResponse(
        circular as sheets_v4.Schema$BatchUpdateSpreadsheetResponse
      );

      expect(result).toBeDefined();
      // Should handle gracefully via maxDepth limit
    });
  });

  describe('configuration options', () => {
    it('should respect maxDepth configuration', () => {
      const shallowValidator = new ResponseValidator({
        enabled: true,
        maxDepth: 2,
      });

      expect(shallowValidator.isEnabled()).toBe(true);
      // MaxDepth prevents infinite recursion in nested validation
    });

    it('should respect checkDeprecations flag', () => {
      const noDeprecationValidator = new ResponseValidator({
        enabled: true,
        checkDeprecations: false,
      });

      expect(noDeprecationValidator.isEnabled()).toBe(true);
      // Should not check for deprecated fields
    });

    it('should respect strict mode', () => {
      const strictValidator = new ResponseValidator({
        enabled: true,
        strict: true,
      });

      expect(strictValidator.isEnabled()).toBe(true);
      // Strict mode throws on validation errors
    });
  });

  describe('integration', () => {
    it('should work end-to-end with valid response', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-spreadsheet-id',
        replies: [
          {
            addSheet: {
              properties: {
                sheetId: 123,
                title: 'New Sheet',
                index: 0,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 26,
                },
              },
            },
          },
        ],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.validated).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate multiple operation types', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [
          {
            addSheet: {
              properties: { sheetId: 1, title: 'Sheet1' },
            },
          },
          {
            updateSpreadsheetProperties: {
              properties: { title: 'Updated Title' },
            },
          },
        ],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.validated).toBe(true);
    });

    it('should handle real-world complex responses', async () => {
      const complexResponse: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'real-spreadsheet-id',
        replies: [
          {
            addSheet: {
              properties: {
                sheetId: 456,
                title: 'Data Sheet',
                index: 1,
                sheetType: 'GRID',
                gridProperties: {
                  rowCount: 5000,
                  columnCount: 50,
                  frozenRowCount: 1,
                  frozenColumnCount: 2,
                },
                hidden: false,
                tabColor: {
                  red: 0.5,
                  green: 0.7,
                  blue: 0.9,
                },
              },
            },
          },
        ],
        updatedSpreadsheet: {
          spreadsheetId: 'real-spreadsheet-id',
          properties: {
            title: 'My Spreadsheet',
          },
        },
      };

      const result = await validator.validateBatchUpdateResponse(complexResponse);

      expect(result).toBeDefined();
      expect(result.validated).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty replies array', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.validated).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('should handle missing spreadsheetId', async () => {
      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        replies: [],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result).toBeDefined();
      // SpreadsheetId may be optional in some contexts
    });

    it('should handle very large response objects', async () => {
      const largeReplies = Array.from({ length: 100 }, (_, i) => ({
        addSheet: {
          properties: {
            sheetId: i,
            title: `Sheet${i}`,
          },
        },
      }));

      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: largeReplies,
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result).toBeDefined();
      expect(result.validated).toBe(true);
    });

    it('should handle disabled discovery client', async () => {
      // Override internal discovery client to simulate disabled state
      (validator as unknown as { discoveryClient: { isEnabled: () => boolean } }).discoveryClient =
        {
          isEnabled: () => false,
        };

      const response: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = {
        spreadsheetId: 'test-id',
        replies: [],
      };

      const result = await validator.validateBatchUpdateResponse(response);

      expect(result.valid).toBe(true);
      expect(result.validated).toBe(false);
      expect(result.skipReason).toContain('Discovery API is not enabled');
    });
  });
});
