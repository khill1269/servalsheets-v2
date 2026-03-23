/**
 * Tests for sheets_analyze.quick_insights action (S3-A)
 *
 * TDD Phase 1: These tests are written BEFORE implementation and must fail initially.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyzeHandler } from '../../src/handlers/analyze.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { resetCapabilityCacheService } from '../../src/services/capability-cache.js';

// Mock capability cache at module level
vi.mock('../../src/services/capability-cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/capability-cache.js')>(
    '../../src/services/capability-cache.js'
  );
  return {
    ...actual,
    getCapabilitiesWithCache: vi.fn().mockResolvedValue({
      sampling: { supportedMethods: ['createMessage'] },
    }),
  };
});

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    values: {
      get: vi.fn().mockResolvedValue({
        data: {
          range: 'Sheet1!A1:D4',
          values: [
            ['Name', 'Age', 'Score', 'Department'],
            ['Alice', '25', '95', 'Engineering'],
            ['Bob', '30', '87', 'Marketing'],
            ['Charlie', '22', '92', 'Engineering'],
          ],
        },
      }),
    },
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-id',
        properties: { title: 'Test Spreadsheet' },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 100, columnCount: 4 },
            },
          },
        ],
      },
    }),
  },
});

const createMockContext = (): HandlerContext =>
  ({
    googleClient: {} as any,
    batchCompiler: {
      compile: vi.fn(),
      execute: vi.fn(),
      executeAll: vi.fn(),
    } as any,
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:D4',
        sheetId: 0,
        sheetName: 'Sheet1',
        gridRange: { sheetId: 0 },
        resolution: { method: 'a1_direct', confidence: 1.0, path: '' },
      }),
    } as any,
    server: {
      createMessage: vi.fn(),
      getClientCapabilities: vi.fn().mockReturnValue({
        sampling: {},
      }),
    } as any,
    requestId: 'test-request-id',
  }) as any;

describe('AnalyzeHandler — quick_insights action (S3-A)', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;
  let handler: AnalyzeHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetCapabilityCacheService();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new AnalyzeHandler(mockContext, mockApi as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('success cases', () => {
    it('should return stats, insights, suggestions, and warnings for a sheet with data', async () => {
      const result = await handler.handle({
        action: 'quick_insights',
        spreadsheetId: 'test-id',
      } as any);

      expect(result.response.success).toBe(true);

      const resp = result.response as any;
      // stats block
      expect(resp.stats).toBeDefined();
      expect(typeof resp.stats.rowCount).toBe('number');
      expect(resp.stats.rowCount).toBeGreaterThan(0);
      expect(typeof resp.stats.columnCount).toBe('number');
      expect(resp.stats.columnCount).toBeGreaterThan(0);
      expect(Array.isArray(resp.stats.dataTypes)).toBe(true);
      expect(typeof resp.stats.emptyRate).toBe('number');
      expect(resp.stats.emptyRate).toBeGreaterThanOrEqual(0);
      expect(resp.stats.emptyRate).toBeLessThanOrEqual(1);

      // insights block
      expect(Array.isArray(resp.insights)).toBe(true);

      // suggestions block
      expect(Array.isArray(resp.suggestions)).toBe(true);

      // warnings block
      expect(Array.isArray(resp.warnings)).toBe(true);
    });

    it('should scope analysis to a given range when provided', async () => {
      // Narrow range: 2 rows × 2 cols
      mockApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B2',
          values: [
            ['Name', 'Age'],
            ['Alice', '25'],
          ],
        },
      });

      const result = await handler.handle({
        action: 'quick_insights',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
      } as any);

      expect(result.response.success).toBe(true);

      const resp = result.response as any;
      expect(resp.stats.rowCount).toBe(1); // header row excluded from data count
      expect(resp.stats.columnCount).toBe(2);
    });

    it('should respect maxInsights parameter', async () => {
      const result = await handler.handle({
        action: 'quick_insights',
        spreadsheetId: 'test-id',
        maxInsights: 2,
      } as any);

      expect(result.response.success).toBe(true);

      const resp = result.response as any;
      // combined insights array should not exceed maxInsights
      expect(Array.isArray(resp.insights)).toBe(true);
      expect(resp.insights.length).toBeLessThanOrEqual(2);
    });
  });

  describe('error cases', () => {
    it('should return success:false when spreadsheet fetch fails', async () => {
      mockApi.spreadsheets.values.get.mockRejectedValueOnce(
        Object.assign(new Error('Spreadsheet not found'), { code: 404 })
      );
      mockApi.spreadsheets.get.mockRejectedValueOnce(
        Object.assign(new Error('Spreadsheet not found'), { code: 404 })
      );

      const result = await handler.handle({
        action: 'quick_insights',
        spreadsheetId: 'nonexistent-id',
      } as any);

      expect(result.response.success).toBe(false);
      expect((result.response as any).error).toBeDefined();
    });
  });
});
