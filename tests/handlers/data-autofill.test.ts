/**
 * Tests for sheets_data.auto_fill action (S3-B)
 *
 * TDD Phase 1: These tests are written BEFORE implementation and must fail initially.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsDataHandler } from '../../src/handlers/data.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';
import { resetETagCache } from '../../src/services/etag-cache.js';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-id',
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
        ],
      },
    }),
    values: {
      get: vi.fn().mockResolvedValue({
        data: {
          range: 'Sheet1!A1:A3',
          values: [['1'], ['2'], ['3']],
        },
      }),
      update: vi.fn().mockResolvedValue({
        data: {
          updatedRange: 'Sheet1!A4:A6',
          updatedRows: 3,
          updatedColumns: 1,
          updatedCells: 3,
        },
      }),
      append: vi.fn(),
      clear: vi.fn(),
      batchGet: vi.fn(),
      batchGetByDataFilter: vi.fn(),
      batchUpdate: vi.fn(),
      batchUpdateByDataFilter: vi.fn(),
      batchClearByDataFilter: vi.fn(),
    },
    batchUpdate: vi.fn().mockResolvedValue({
      data: { spreadsheetId: 'test-id', replies: [] },
    }),
  },
});

const createMockContext = (): HandlerContext =>
  ({
    requestId: 'test-request',
    timestamp: new Date('2024-01-15T00:00:00Z'),
    session: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
    },
    capabilities: {
      supports: vi.fn(() => true),
      requireCapability: vi.fn(),
      getCapability: vi.fn(),
    },
    googleClient: {} as any,
    authService: {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockResolvedValue({}),
    } as any,
    elicitationServer: {
      getClientCapabilities: vi.fn().mockReturnValue({
        elicitation: { form: true, url: true },
      }),
      elicitInput: vi.fn().mockResolvedValue({ action: 'accept', content: { confirm: true } }),
      request: vi.fn().mockResolvedValue({ confirmed: true, reason: '' }),
    } as any,
    snapshotService: {
      createSnapshot: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-123',
        timestamp: new Date('2024-01-15T00:00:00Z'),
      }),
    } as any,
    impactAnalyzer: {
      analyzeOperation: vi.fn().mockResolvedValue({
        severity: 'low',
        cellsAffected: 4,
        formulasAffected: [],
        chartsAffected: [],
        warnings: [],
      }),
    } as any,
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:A3',
        sheetId: 0,
        sheetName: 'Sheet1',
        gridRange: {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        resolution: { method: 'a1_direct', confidence: 1.0, path: '' },
      }),
    } as any,
    batchCompiler: {
      compile: vi.fn(),
      execute: vi.fn().mockResolvedValue({
        responses: [{ updatedRange: 'Sheet1!A1:A3' }],
        totalUpdatedCells: 3,
      }),
      executeWithSafety: vi.fn().mockImplementation(async (options: any) => {
        if (options.operation && !options.safety?.dryRun) {
          await options.operation();
        }
        return {
          success: true,
          spreadsheetId: options.spreadsheetId,
          responses: [],
          dryRun: options.safety?.dryRun ?? false,
        };
      }),
    } as any,
  }) as any;

describe('SheetsDataHandler — auto_fill action (S3-B)', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;
  let handler: SheetsDataHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    resetETagCache();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new SheetsDataHandler(mockContext, mockApi as any as sheets_v4.Sheets);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('linear pattern fill', () => {
    it('should fill linear pattern [1,2,3] → [4,5,6]', async () => {
      // Source: A1:A3 = [1, 2, 3]
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:A3',
          values: [['1'], ['2'], ['3']],
        },
      });

      const result = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A3' },
        fillRange: { a1: 'Sheet1!A4:A6' },
        strategy: 'linear',
      } as any);

      expect(result.response.success).toBe(true);

      const resp = result.response as any;
      expect(resp.action).toBe('auto_fill');
      expect(typeof resp.cellsFilled).toBe('number');
      expect(resp.cellsFilled).toBe(3);
      expect(resp.detectedPattern).toBe('linear');

      // Verify values written to API
      expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          range: 'Sheet1!A4:A6',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[4], [5], [6]],
          },
        })
      );
    });

    it('should auto-detect linear pattern with strategy=detect', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:A4',
          values: [['10'], ['20'], ['30'], ['40']],
        },
      });

      const result = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A4' },
        fillRange: { a1: 'Sheet1!A5:A6' },
        strategy: 'detect',
      } as any);

      expect(result.response.success).toBe(true);
      const resp = result.response as any;
      expect(resp.detectedPattern).toBe('linear');
      expect(resp.cellsFilled).toBe(2);

      expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { values: [[50], [60]] },
        })
      );
    });
  });

  describe('repeat pattern fill', () => {
    it('should repeat pattern [A,B] to fill 4 cells as [A,B,A,B]', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:A2',
          values: [['Alpha'], ['Beta']],
        },
      });

      const result = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A2' },
        fillRange: { a1: 'Sheet1!A3:A6' },
        strategy: 'repeat',
      } as any);

      expect(result.response.success).toBe(true);

      const resp = result.response as any;
      expect(resp.action).toBe('auto_fill');
      expect(resp.cellsFilled).toBe(4);
      expect(resp.detectedPattern).toBe('repeat');

      expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            values: [['Alpha'], ['Beta'], ['Alpha'], ['Beta']],
          },
        })
      );
    });
  });

  describe('error cases', () => {
    it('should return success:false when spreadsheet fetch fails', async () => {
      mockApi.spreadsheets.values.get.mockRejectedValueOnce(
        Object.assign(new Error('Spreadsheet not found'), { code: 404 })
      );

      const result = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'nonexistent-id',
        sourceRange: { a1: 'Sheet1!A1:A3' },
        fillRange: { a1: 'Sheet1!A4:A6' },
      } as any);

      expect(result.response.success).toBe(false);
      expect((result.response as any).error).toBeDefined();
    });

    it('should return success:false for empty source range', async () => {
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:A3', values: [] },
      });

      const result = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A3' },
        fillRange: { a1: 'Sheet1!A4:A6' },
      } as any);

      expect(result.response.success).toBe(false);
    });
  });
});
