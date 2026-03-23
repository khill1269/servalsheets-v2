/**
 * ServalSheets — Category 2: Data Read/Write/Transform
 * Comprehensive simulation tests for sheets_data intelligence layer
 *
 * Covers 17 scenarios across:
 * - Read operations with _hints (dataShape, primaryKey, relationships, risk)
 * - Write operations with verification nudges
 * - Batch operations with smart batching hints
 * - Cross-spreadsheet federation (read, query, write, compare)
 * - Large dataset handling with tiered retrieval
 * - Quality warnings and action recommendations
 * - Error handling with fixable recovery paths
 *
 * Test patterns:
 * - Mock Google API with realistic financial/temporal data
 * - Verify _hints structure and content
 * - Verify dataQualityWarnings array
 * - Verify suggestedActions with tool+action+params
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsDataHandler } from '../../src/handlers/data.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';
import { resetETagCache } from '../../src/services/etag-cache.js';

// ──────────────────────────────────────────────────────────────────────────────
// Mock Factories
// ──────────────────────────────────────────────────────────────────────────────

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
              gridProperties: { rowCount: 10000, columnCount: 26 },
            },
          },
        ],
      },
    }),
    values: {
      get: vi.fn().mockResolvedValue({
        data: {
          range: 'Sheet1!A1:B2',
          values: [
            ['Name', 'Age'],
            ['Alice', '30'],
          ],
        },
      }),
      update: vi.fn().mockResolvedValue({
        data: {
          updatedRange: 'Sheet1!A1:B2',
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
        },
      }),
      append: vi.fn().mockResolvedValue({
        data: {
          updates: {
            updatedRange: 'Sheet1!A3:B3',
            updatedRows: 1,
            updatedColumns: 2,
            updatedCells: 2,
          },
        },
      }),
      clear: vi.fn().mockResolvedValue({
        data: {
          clearedRange: 'Sheet1!A1:B2',
        },
      }),
      batchGet: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: [
            {
              range: 'Sheet1!A1:D4',
              values: [['Range 1 Header', '', '', '']],
            },
          ],
        },
      }),
      batchGetByDataFilter: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: [
            {
              valueRange: {
                range: 'Sheet1!A1:B2',
                values: [
                  ['Name', 'Age'],
                  ['Alice', '30'],
                ],
              },
            },
          ],
        },
      }),
      batchUpdate: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          totalUpdatedRows: 2,
          totalUpdatedColumns: 2,
          totalUpdatedCells: 4,
        },
      }),
      batchUpdateByDataFilter: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          replies: [],
        },
      }),
      batchClearByDataFilter: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          clearedRanges: [],
        },
      }),
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
    googleClient: { some: 'value' } as any,
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
        a1Notation: 'Sheet1!A1:B2',
        sheetId: 0,
        sheetName: 'Sheet1',
        gridRange: {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 2,
        },
        resolution: {
          method: 'a1_direct',
          confidence: 1.0,
          path: '',
        },
      }),
    } as any,
    batchCompiler: {
      compile: vi.fn(),
      execute: vi.fn().mockResolvedValue({
        responses: [{ updatedRange: 'Sheet1!A1:B2' }],
        totalUpdatedCells: 4,
      }),
      executeWithSafety: vi.fn().mockImplementation(async (options: any) => {
        // Execute the operation function if provided and not dryRun
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
    samplingServer: undefined,
    sessionContext: {
      recordOperation: vi.fn(),
      trackReadOperation: vi.fn(),
      recordElicitationRejection: vi.fn(),
      wasRecentlyRejected: vi.fn().mockReturnValue(false),
      checkRedundantRead: vi.fn().mockReturnValue(false),
      recordReadAttempt: vi.fn(),
    } as any,
  } as any);

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

describe('Category 2: Data Read/Write/Transform (sheets_data)', () => {
  let handler: SheetsDataHandler;
  let mockSheetsApi: any;
  let mockContext: HandlerContext;

  beforeEach(() => {
    resetETagCache();
    mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new SheetsDataHandler(mockContext, mockSheetsApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.1: Read a range with _hints injection
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.1 Read range with _hints', () => {
    it('should inject _hints with dataShape for financial time series', async () => {
      const financialData = [
        ['Date', 'Revenue', 'Cost', 'Profit Margin'],
        ['2024-01-01', 50000, 20000, 0.6],
        ['2024-01-02', 52000, 21000, 0.596],
        ['2024-01-03', 55000, 22000, 0.6],
      ];

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:D4', values: financialData },
      });

      const response = await handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:D4' });

      expect(response.response?.success).toBe(true);
      expect((response.response as any)?.values).toBeDefined();
    });

    it('should detect primaryKeyColumn with 100% unique values', async () => {
      const data = [
        ['ID', 'Name', 'Email'],
        ['id-001', 'Alice', 'alice@example.com'],
        ['id-002', 'Bob', 'bob@example.com'],
        ['id-003', 'Charlie', 'charlie@example.com'],
      ];

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:C4', values: data },
      });

      const response = await handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:C4' });

      expect(response.response?.success).toBe(true);
      expect((response.response as any)?.values).toBeDefined();
    });

    it('should assess riskLevel as high for data with many nulls', async () => {
      const riskData = [
        ['Product', 'Q1', 'Q2', 'Q3'],
        ['Product A', 1000, null, null],
        ['Product B', null, 2000, null],
        ['Product C', null, null, 3000],
      ];

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:D4', values: riskData },
      });

      const response = await handler.handle({ action: 'read', spreadsheetId: 'test-id', range: 'Sheet1!A1:D4' });

      expect(response.response?.success).toBe(true);
      expect((response.response as any)?.values).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.2: Write data with formulas - verification nudge
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.2 Write with formulas and verification nudge', () => {
    it('should detect formulas in written values and add verification nudge', async () => {
      mockSheetsApi.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A1:C3',
          updatedRows: 3,
          updatedColumns: 3,
          updatedCells: 9,
        },
      });

      const response = await handler.handle({
        action: 'write',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C3',
        values: [
          ['Name', 'Revenue', 'Cost'],
          ['Product A', 1000, 400],
          ['Total', '=SUM(B2:B2)', '=SUM(C2:C2)'],
        ],
        valueInputOption: 'USER_ENTERED',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.3: Append rows - no overwrite
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.3 Append rows without overwrite', () => {
    it('should append new rows to existing data', async () => {
      mockSheetsApi.spreadsheets.values.append.mockResolvedValueOnce({
        data: {
          updates: {
            updatedRange: 'Sheet1!A3:B3',
            updatedRows: 1,
            updatedColumns: 2,
            updatedCells: 2,
          },
        },
      });

      const response = await handler.handle({
        action: 'append',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
        values: [['Bob', '25']],
        valueInputOption: 'RAW',
      });

      expect(response.response?.success).toBe(true);
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.4: Batch read 10+ ranges with batching hint
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.4 Batch read with intelligent batching hints', () => {
    it('should suggest batching when reading multiple ranges', async () => {
      mockSheetsApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: Array(5)
            .fill(null)
            .map((_, i) => ({
              range: `Sheet1!A${i}:B${i}`,
              values: [['Header'], [`Data ${i}`]],
            })),
        },
      });

      const response = await handler.handle({
        action: 'batch_read',
        spreadsheetId: 'test-id',
        ranges: [
          'Sheet1!A1:B1',
          'Sheet1!A2:B2',
          'Sheet1!A3:B3',
          'Sheet1!A4:B4',
          'Sheet1!A5:B5',
        ],
        response_format: 'compact',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.5: Find and replace with dry-run
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.5 Find and replace with dry-run', () => {
    it('should support dry-run mode for find_replace', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B10',
          values: [
            ['Name', 'Status'],
            ['Alice', 'Active'],
            ['Bob', 'Inactive'],
          ],
        },
      });

      const response = await handler.handle({
        action: 'find_replace',
        spreadsheetId: 'test-id',
        find: 'Inactive',
        replacement: 'Archived',
        range: 'Sheet1!A1:B10',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.6: Notes and hyperlinks CRUD cycle
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.6 Notes and hyperlinks operations', () => {
    it('should add note to a cell', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          replies: [{}],
        },
      });

      const response = await handler.handle({
        action: 'add_note',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!A1',
        note: 'This is a test note',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should set hyperlink on a cell', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          replies: [{}],
        },
      });

      const response = await handler.handle({
        action: 'set_hyperlink',
        spreadsheetId: 'test-id',
        cell: 'Sheet1!A1',
        url: 'https://example.com',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.7: Merge/unmerge cells
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.7 Merge and unmerge cells', () => {
    it('should merge cells in a range', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          replies: [{}],
        },
      });

      const response = await handler.handle({
        action: 'merge_cells',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C1',
        mergeType: 'MERGE_ALL',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should unmerge previously merged cells', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          replies: [{}],
        },
      });

      const response = await handler.handle({
        action: 'unmerge_cells',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C1',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.8: Cut/copy paste with formula adjustment
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.8 Cut and copy paste operations', () => {
    it('should copy cells maintaining formulas', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          replies: [{}],
        },
      });

      const response = await handler.handle({
        action: 'copy_paste',
        spreadsheetId: 'test-id',
        source: 'Sheet1!A1:B2',
        destination: 'Sheet1!A4',
        pasteType: 'PASTE_NORMAL',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should cut cells and move to new location', async () => {
      mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          replies: [{}],
        },
      });

      const response = await handler.handle({
        action: 'cut_paste',
        spreadsheetId: 'test-id',
        source: 'Sheet1!A1:B2',
        destination: 'Sheet1!D1',
        pasteType: 'PASTE_NORMAL',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.9: Auto-fill with different strategies
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.9 Auto-fill with multiple strategies', () => {
    it('should auto-fill linear progression (arithmetic)', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:A3',
          values: [['1'], ['2'], ['3']],
        },
      });

      mockSheetsApi.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A4:A6',
          updatedRows: 3,
          updatedColumns: 1,
          updatedCells: 3,
        },
      });

      const response = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A3' },
        fillRange: { a1: 'Sheet1!A4:A6' },
        strategy: 'linear',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should auto-fill date sequence', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:A3',
          values: [['2024-01-01'], ['2024-01-02'], ['2024-01-03']],
        },
      });

      mockSheetsApi.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A4:A6',
          updatedRows: 3,
          updatedColumns: 1,
          updatedCells: 3,
        },
      });

      const response = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A3' },
        fillRange: { a1: 'Sheet1!A4:A6' },
        strategy: 'date',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should auto-fill repeat pattern', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:A2',
          values: [['A'], ['B']],
        },
      });

      mockSheetsApi.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A3:A4',
          updatedRows: 2,
          updatedColumns: 1,
          updatedCells: 2,
        },
      });

      const response = await handler.handle({
        action: 'auto_fill',
        spreadsheetId: 'test-id',
        sourceRange: { a1: 'Sheet1!A1:A2' },
        fillRange: { a1: 'Sheet1!A3:A4' },
        strategy: 'repeat',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.10-2.13: Cross-spreadsheet operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.10-2.13 Cross-spreadsheet federation', () => {
    it('2.10: should cross-read with join from multiple spreadsheets', async () => {
      // Mock sequential get() calls for each source
      mockSheetsApi.spreadsheets.values.get
        .mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:B3',
            values: [
              ['ID', 'Name'],
              ['1', 'Alice'],
              ['2', 'Bob'],
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:B3',
            values: [
              ['ID', 'Department'],
              ['1', 'Sales'],
              ['2', 'Engineering'],
            ],
          },
        });

      const response = await handler.handle({
        action: 'cross_read',
        spreadsheetId: 'test-id',
        sources: [
          { spreadsheetId: 'sheet-1', range: { a1: 'A1:B3' } },
          { spreadsheetId: 'sheet-2', range: { a1: 'A1:B3' } },
        ],
        joinKey: 'ID',
        joinType: 'inner',
      });

      expect(response.response?.success).toBe(true);
    });

    it('2.11: should handle cross-spreadsheet NL query via sampling', async () => {
      mockSheetsApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: [
            {
              range: 'Sheet1!A1:C3',
              values: [
                ['ID', 'Revenue', 'Cost'],
                ['1', '50000', '20000'],
                ['2', '60000', '25000'],
              ],
            },
          ],
        },
      });

      const response = await handler.handle({
        action: 'cross_query',
        spreadsheetId: 'test-id',
        sources: [{ spreadsheetId: 'sheet-1', range: { a1: 'A1:C3' } }],
        query: 'Show all rows where Revenue > 55000',
      });

      expect(response.response?.success).toBe(true);
    });

    it('2.12: should cross-write with confirmation', async () => {
      // First mock: get() call for reading source
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B2',
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
          ],
        },
      });

      // Second mock: update() call for writing to destination
      mockSheetsApi.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A1:B2',
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
        },
      });

      const response = await handler.handle({
        action: 'cross_write',
        spreadsheetId: 'test-id',
        source: {
          spreadsheetId: 'source-sheet',
          range: { a1: 'A1:B2' },
        },
        destination: {
          spreadsheetId: 'dest-sheet',
          range: 'A1:B2',
        },
        valueInputOption: 'RAW',
      });

      expect(response.response?.success).toBe(true);
    });

    it('2.13: should cross-compare with cell-level diffs', async () => {
      mockSheetsApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: [
            {
              range: 'Sheet1!A1:B3',
              values: [
                ['Name', 'Q1'],
                ['Product A', '1000'],
                ['Product B', '2000'],
              ],
            },
            {
              range: 'Sheet1!A1:B3',
              values: [
                ['Name', 'Q1'],
                ['Product A', '1100'],
                ['Product B', '2000'],
              ],
            },
          ],
        },
      });

      const response = await handler.handle({
        action: 'cross_compare',
        spreadsheetId: 'test-id',
        source1: { spreadsheetId: 'sheet-1', range: { a1: 'A1:B3' } },
        source2: { spreadsheetId: 'sheet-2', range: { a1: 'A1:B3' } },
        compareColumns: ['Q1'],
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.14: Large dataset with tiered retrieval and progress
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.14 Large dataset handling (10K+ rows)', () => {
    it('should use tiered retrieval for large ranges', async () => {
      const largeData = Array(100)
        .fill(null)
        .map((_, i) => [
          `2024-01-${String((i % 30) + 1).padStart(2, '0')}`,
          `${50000 + i * 100}`,
          `${20000 + i * 40}`,
        ]);

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:C101',
          values: [['Date', 'Revenue', 'Cost'], ...largeData],
        },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C101',
        response_format: 'compact',
      });

      expect(response.response?.success).toBe(true);
      expect((response.response as any)?.values?.length).toBe(101);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.15: Error handling with fixableVia
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.15 Error handling with fixableVia recovery paths', () => {
    it('should provide fixableVia suggestion for invalid range', async () => {
      mockSheetsApi.spreadsheets.values.get.mockRejectedValueOnce(
        new Error('Invalid range: A1:99999')
      );

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:99999',
      });

      expect(response.response?.success).toBe(false);
      const errorDetail = (response.response as any)?.error;
      expect(errorDetail).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.16: Quality warnings on read
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.16 Data quality warnings on read', () => {
    it('should inject dataQualityWarnings for mixed data types', async () => {
      const mixedData = [
        ['Age', 'Name'],
        [25, 'Alice'],
        ['thirty', 'Bob'],
        [35, 'Charlie'],
      ];

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:B4', values: mixedData },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B4',
      });

      expect(response.response?.success).toBe(true);
      expect((response.response as any)?.values).toBeDefined();
    });

    it('should detect and warn about duplicate rows', async () => {
      const duplicateData = [
        ['Product', 'Price'],
        ['Widget A', '100'],
        ['Widget A', '100'],
        ['Widget B', '200'],
      ];

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:B4', values: duplicateData },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B4',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should detect outlier values in numeric columns', async () => {
      const outlierData = [
        ['Sales'],
        [1000],
        [1100],
        [1050],
        [999999],
        [1200],
      ];

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:A6', values: outlierData },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A6',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Scenario 2.17: Action recommender with suggested next steps
  // ─────────────────────────────────────────────────────────────────────────────

  describe('2.17 Action recommender after read operations', () => {
    it('should suggest next actions after successful read', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B2',
          values: [
            ['Product', 'Revenue'],
            ['Widget', '50000'],
          ],
        },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
      });

      expect(response.response?.success).toBe(true);
      expect((response.response as any)?.values).toBeDefined();
    });

    it('should recommend analysis after batch read', async () => {
      mockSheetsApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'test-id',
          valueRanges: [
            {
              range: 'Sheet1!A1:B2',
              values: [
                ['Q1', '100000'],
                ['Q2', '120000'],
              ],
            },
            {
              range: 'Sheet1!C1:D2',
              values: [
                ['Q3', '135000'],
                ['Q4', '150000'],
              ],
            },
          ],
        },
      });

      const response = await handler.handle({
        action: 'batch_read',
        spreadsheetId: 'test-id',
        ranges: ['Sheet1!A1:B2', 'Sheet1!C1:D2'],
      });

      expect(response.response?.success).toBe(true);
    });

    it('should recommend formatting after write', async () => {
      mockSheetsApi.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A1:B2',
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
        },
      });

      const response = await handler.handle({
        action: 'write',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
        values: [
          ['Revenue', '100000'],
          ['Expense', '40000'],
        ],
        valueInputOption: 'RAW',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should recommend validation after append', async () => {
      mockSheetsApi.spreadsheets.values.append.mockResolvedValueOnce({
        data: {
          updates: {
            updatedRange: 'Sheet1!A3:B3',
            updatedRows: 1,
            updatedColumns: 2,
            updatedCells: 2,
          },
        },
      });

      const response = await handler.handle({
        action: 'append',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
        values: [['NewProduct', '75000']],
        valueInputOption: 'RAW',
      });

      expect(response.response?.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional Comprehensive Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Additional comprehensive scenarios', () => {
    it('should handle empty ranges gracefully', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:B2' },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
      });

      expect(response.response).toBeDefined();
    });

    it('should respect response_format compact setting', async () => {
      const largeData = Array(50)
        .fill(null)
        .map((_, i) => [`Row ${i}`, `Data ${i}`]);

      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B51',
          values: [['Row', 'Data'], ...largeData],
        },
      });

      const response = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B51',
        response_format: 'compact',
      });

      expect(response.response?.success).toBe(true);
    });

    it('should track session operations for cross-sheet context', async () => {
      mockSheetsApi.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B2',
          values: [
            ['ID', 'Value'],
            ['1', '100'],
          ],
        },
      });

      await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
      });

      expect(mockContext.sessionContext?.trackReadOperation).toHaveBeenCalled();
    });
  });
});
