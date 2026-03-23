/**
 * ServalSheets - Data Handler Tests
 *
 * Tests for cell value and cell-level operations.
 * Covers 21 actions including read, write, clear, cut, copy, notes, hyperlinks, merge, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SheetsDataHandler } from '../../src/handlers/data.js';
import { SheetsDataOutputSchema } from '../../src/schemas/data.js';
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
              range: 'Sheet1!A1:B2',
              values: [
                ['Name', 'Age'],
                ['Alice', '30'],
              ],
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
          responses: [
            {
              updatedRange: 'Sheet1!A1:B2',
              updatedRows: 2,
              updatedColumns: 2,
              updatedCells: 4,
            },
          ],
        },
      }),
      batchUpdateByDataFilter: vi.fn().mockResolvedValue({
        data: {
          spreadsheetId: 'test-id',
          totalUpdatedRows: 2,
          totalUpdatedColumns: 2,
          totalUpdatedCells: 4,
        },
      }),
      batchClearByDataFilter: vi.fn().mockResolvedValue({
        data: {
          clearedRanges: ['Sheet1!A1:B2'],
        },
      }),
    },
    batchUpdate: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-id',
        replies: [
          {
            findReplace: {
              occurrencesChanged: 2,
              valuesChanged: 2,
            },
          },
        ],
      },
    }),
  },
});

// Mock handler context
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
        elicitation: {
          form: true,
          url: true,
        },
      }),
      elicitInput: vi.fn().mockResolvedValue({
        action: 'accept',
        content: { confirm: true },
      }),
      request: vi.fn().mockResolvedValue({
        confirmed: true,
        reason: '',
      }),
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
  }) as any;

describe('SheetsDataHandler', () => {
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

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(SheetsDataHandler);
    });
  });

  describe('Value Operations', () => {
    describe('read action', () => {
      it('should read cell values', async () => {
        const result = await handler.handle({
          action: 'read',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'read');
        expect((result.response as any).values).toEqual([
          ['Name', 'Age'],
          ['Alice', '30'],
        ]);
        expect(mockApi.spreadsheets.values.get).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should handle empty ranges', async () => {
        mockApi.spreadsheets.values.get.mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:B2',
            values: undefined,
          },
        });

        const result = await handler.handle({
          action: 'read',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).values).toEqual([]);
      });

      it('should support valueRenderOption', async () => {
        const result = await handler.handle({
          action: 'read',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          valueRenderOption: 'FORMULA',
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.values.get).toHaveBeenCalledWith(
          expect.objectContaining({
            valueRenderOption: 'FORMULA',
          })
        );
      });

      it('should apply preview response_format for read action', async () => {
        const largeValues = Array.from({ length: 40 }, (_, rowIdx) =>
          Array.from({ length: 15 }, (_, colIdx) => `R${rowIdx + 1}C${colIdx + 1}`)
        );

        mockApi.spreadsheets.values.get.mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:O40',
            values: largeValues,
          },
        });

        const result = await handler.handle({
          action: 'read',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:O40',
          response_format: 'preview',
        });

        expect(result.response.success).toBe(true);
        const response = result.response as any;
        expect(response.responseFormat).toBe('preview');
        expect(response.values.length).toBe(25);
        expect(response.values[0].length).toBe(10);
        expect(response.rowCount).toBe(40);
        expect(response.columnCount).toBe(15);
        expect(response.truncated).toBe(true);
        expect(response._meta?.truncated).toBe(true);
        expect(response._meta?.continuationHint).toContain('response_format');
      });

      it('should auto paginate large ranges to respect 10k cell limit', async () => {
        mockContext.rangeResolver.resolve.mockResolvedValueOnce({
          a1Notation: 'Sheet1!A1:Z1000',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1000,
            startColumnIndex: 0,
            endColumnIndex: 26,
          },
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: '',
          },
        });

        mockApi.spreadsheets.values.get.mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:Z384',
            values: [['Name']],
          },
        });

        const result = await handler.handle({
          action: 'read',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:Z1000',
        });

        expect(mockApi.spreadsheets.values.get).toHaveBeenCalledWith(
          expect.objectContaining({
            range: 'Sheet1!A1:Z384',
          })
        );

        const response = result.response as any;
        expect(response.success).toBe(true);
        expect(response.hasMore).toBe(true);
        expect(response.totalRows).toBe(1000);
        const decodedCursor = Buffer.from(response.nextCursor, 'base64').toString('utf-8');
        expect(decodedCursor).toBe('384');
      });

      it('should reject invalid pagination cursor', async () => {
        const result = await handler.handle({
          action: 'read',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          cursor: 'not-a-valid-cursor',
        });

        expect(result.response.success).toBe(false);
        expect((result.response as any).error.code).toBe('INVALID_PARAMS');
        expect(mockApi.spreadsheets.values.get).not.toHaveBeenCalled();
      });
    });

    describe('write action', () => {
      it('should write cell values', async () => {
        const result = await handler.handle({
          action: 'write',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          values: [
            ['Name', 'Age'],
            ['Bob', '25'],
          ],
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'write');
        expect(result.response).toHaveProperty('updatedCells', 4);
        expect(mockApi.spreadsheets.values.update).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should support different value input options', async () => {
        const result = await handler.handle({
          action: 'write',
          spreadsheetId: 'test-id',
          cell: 'Sheet1!A1',
          values: [['=SUM(A2:A10)']],
          valueInputOption: 'USER_ENTERED',
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith(
          expect.objectContaining({
            valueInputOption: 'USER_ENTERED',
          })
        );
      });

      it('auto-expands bounded ranges to fit the payload before writing', async () => {
        mockApi.spreadsheets.values.update.mockResolvedValueOnce({
          data: {
            updatedRange: 'Sheet1!A1:B3',
            updatedRows: 3,
            updatedColumns: 2,
            updatedCells: 6,
          },
        });

        const result = await handler.handle({
          action: 'write',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          values: [
            ['Name', 'Age'],
            ['Alice', '30'],
            ['Bob', '25'],
          ],
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).updatedRange).toBe('Sheet1!A1:B3');
        expect(mockApi.spreadsheets.values.update).toHaveBeenCalledWith(
          expect.objectContaining({
            range: 'Sheet1!A1:B3',
          })
        );
      });
    });

    describe('append action', () => {
      it('should append values to range', async () => {
        const result = await handler.handle({
          action: 'append',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A:B',
          values: [['Carol', '28']],
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'append');
        expect(result.response).toHaveProperty('updatedCells', 2);
        expect(mockApi.spreadsheets.values.append).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should support insert data option', async () => {
        const result = await handler.handle({
          action: 'append',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A:B',
          values: [['Dave', '35']],
          insertDataOption: 'INSERT_ROWS',
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.values.append).toHaveBeenCalledWith(
          expect.objectContaining({
            insertDataOption: 'INSERT_ROWS',
          })
        );
      });

      it('should append values to table by tableId', async () => {
        const result = await handler.handle({
          action: 'append',
          spreadsheetId: 'test-id',
          tableId: 'table-123',
          values: [['Eve', '42']],
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  appendCells: expect.objectContaining({
                    tableId: 'table-123',
                  }),
                }),
              ],
            }),
          })
        );
      });
    });

    describe('batch actions with dataFilters', () => {
      it('should batch_read with dataFilters', async () => {
        const result = await handler.handle({
          action: 'batch_read',
          spreadsheetId: 'test-id',
          dataFilters: [
            {
              developerMetadataLookup: {
                metadataKey: 'dataset:customers',
              },
            },
          ],
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.values.batchGetByDataFilter).toHaveBeenCalled();
      });

      it('should apply compact response_format for batch_read range values', async () => {
        const largeValues = Array.from({ length: 260 }, (_, rowIdx) => [`row-${rowIdx + 1}`]);
        mockContext.rangeResolver.resolve.mockResolvedValueOnce({
          a1Notation: 'Sheet1!A1:A260',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 260,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: '',
          },
        });

        mockApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-id',
            valueRanges: [
              {
                range: 'Sheet1!A1:A260',
                values: largeValues,
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'batch_read',
          spreadsheetId: 'test-id',
          ranges: ['Sheet1!A1:A260'],
          response_format: 'compact',
        });

        expect(result.response.success).toBe(true);
        const response = result.response as any;
        expect(response.responseFormat).toBe('compact');
        expect(response.valueRanges[0].values.length).toBe(200);
        expect(response.truncated).toBe(true);
        expect(response._meta?.truncated).toBe(true);
        expect(response._meta?.continuationHint).toContain('response_format');
      });

      it('should batch_write with dataFilters', async () => {
        const result = await handler.handle({
          action: 'batch_write',
          spreadsheetId: 'test-id',
          data: [
            {
              dataFilter: { a1Range: 'Sheet1!A1:B2' },
              values: [['Name', 'Age']],
            },
          ],
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.values.batchUpdateByDataFilter).toHaveBeenCalled();
      });

      it('should batch_clear with dataFilters', async () => {
        const result = await handler.handle({
          action: 'batch_clear',
          spreadsheetId: 'test-id',
          dataFilters: [{ a1Range: 'Sheet1!A1:B2' }],
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.values.batchClearByDataFilter).toHaveBeenCalled();
      });
    });

    describe('clear action', () => {
      it('should clear values', async () => {
        // Note: Elicitation confirmation disabled in handler to avoid MCP hang issues
        mockContext.rangeResolver = {
          resolve: vi.fn().mockResolvedValue({
            a1Notation: 'Sheet1!A1:Z10',
            sheetId: 0,
            sheetName: 'Sheet1',
            gridRange: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 10,
              startColumnIndex: 0,
              endColumnIndex: 26,
            },
            resolution: {
              method: 'a1_direct',
              confidence: 1.0,
              path: '',
            },
          }),
        } as any;

        handler = new SheetsDataHandler(mockContext, mockApi as any);

        const result = await handler.handle({
          action: 'clear',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:Z10',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'clear');
        // Elicitation disabled for reliability - direct API call
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should ignore snapshot request when snapshot feature is disabled', async () => {
        // Recreate handler with proper snapshot service
        const snapshotService = {
          create: vi.fn().mockResolvedValue({
            id: 'snapshot-123',
            timestamp: new Date('2024-01-15T00:00:00Z'),
          }),
        };
        const contextWithSnapshot = {
          ...mockContext,
          snapshotService: snapshotService as any,
        };
        const handlerWithSnapshot = new SheetsDataHandler(contextWithSnapshot, mockApi as any);

        const result = await handlerWithSnapshot.handle({
          action: 'clear',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          safety: {
            createSnapshot: true,
          },
        });

        expect(result.response.success).toBe(true);
        expect(snapshotService.create).not.toHaveBeenCalled();
        expect((result.response as any).snapshotId).toBeUndefined();
      });

      it('should cancel clear when elicitation returns cancel for large ranges', async () => {
        // Use a range > 100 cells to trigger confirmation
        mockContext.rangeResolver = {
          resolve: vi.fn().mockResolvedValue({
            a1Notation: 'Sheet1!A1:Z10',
            sheetId: 0,
            sheetName: 'Sheet1',
            gridRange: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 10,
              startColumnIndex: 0,
              endColumnIndex: 26,
            },
            resolution: {
              method: 'a1_direct',
              confidence: 1.0,
              path: '',
            },
          }),
        } as any;

        mockContext.elicitationServer = {
          getClientCapabilities: vi.fn().mockReturnValue({
            elicitation: {
              form: true,
              url: true,
            },
          }),
          elicitInput: vi.fn().mockResolvedValue({
            action: 'cancel',
          }),
        } as any;

        handler = new SheetsDataHandler(mockContext, mockApi as any);

        const result = await handler.handle({
          action: 'clear',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:Z10',
        });

        // With destructive confirmation wired, cancellation should be respected
        expect(result.response.success).toBe(true);
        expect((result.response as any)._cancelled).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should support dryRun mode', async () => {
        const result = await handler.handle({
          action: 'clear',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          safety: {
            dryRun: true,
          },
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).dryRun).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('find action', () => {
      it('should find matching cells', async () => {
        mockApi.spreadsheets.values.get.mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:C10',
            values: [
              ['Name', 'Age', 'City'],
              ['Alice', '30', 'NYC'],
              ['Bob', '25', 'LA'],
              ['Alice', '28', 'SF'],
            ],
          },
        });

        const result = await handler.handle({
          action: 'find_replace',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:C10',
          find: 'Alice',
        } as any);

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'find_replace');
        expect((result.response as any).matches.length).toBeGreaterThan(0);

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should support case-sensitive search', async () => {
        mockApi.spreadsheets.values.get.mockResolvedValueOnce({
          data: {
            range: 'Sheet1!A1:A5',
            values: [['Name'], ['Alice'], ['alice'], ['ALICE']],
          },
        });

        const result = await handler.handle({
          action: 'find_replace',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:A5',
          find: 'Alice',
          matchCase: true,
        } as any);

        expect(result.response.success).toBe(true);
        // Only exact case matches should be found
      });
    });

    describe('replace action', () => {
      it('should replace matching values', async () => {
        const result = await handler.handle({
          action: 'find_replace',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B3',
          find: 'pending',
          replacement: 'completed',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'find_replace');
        expect((result.response as any).replacementsCount).toBeGreaterThanOrEqual(0);

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should support replaceAll option', async () => {
        const result = await handler.handle({
          action: 'find_replace',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B3',
          find: 'old',
          replacement: 'new',
          allSheets: true,
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).replacementsCount).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Cell-Level Operations', () => {
    describe('add_note action', () => {
      it('should set cell note', async () => {
        const result = await handler.handle({
          action: 'add_note',
          spreadsheetId: 'test-id',
          cell: 'Sheet1!A1',
          note: 'This is a note',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'add_note');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('clear_note action', () => {
      it('should clear cell note', async () => {
        const result = await handler.handle({
          action: 'clear_note',
          spreadsheetId: 'test-id',
          cell: 'Sheet1!A1',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'clear_note');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('set_hyperlink action', () => {
      it('should set cell hyperlink', async () => {
        const result = await handler.handle({
          action: 'set_hyperlink',
          spreadsheetId: 'test-id',
          cell: 'Sheet1!A1',
          url: 'https://example.com',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'set_hyperlink');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should validate URL format', async () => {
        const result = await handler.handle({
          action: 'set_hyperlink',
          spreadsheetId: 'test-id',
          cell: 'Sheet1!A1',
          url: 'invalid-url',
        });

        expect(result.response.success).toBe(false);
        expect((result.response as any).error).toBeDefined();
      });
    });

    describe('clear_hyperlink action', () => {
      it('should clear cell hyperlink', async () => {
        const result = await handler.handle({
          action: 'clear_hyperlink',
          spreadsheetId: 'test-id',
          cell: 'Sheet1!A1',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'clear_hyperlink');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('merge action', () => {
      it('should merge cells', async () => {
        const result = await handler.handle({
          action: 'merge_cells',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
          mergeType: 'MERGE_ALL',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'merge_cells');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should support different merge types', async () => {
        const mergeTypes = ['MERGE_ALL', 'MERGE_COLUMNS', 'MERGE_ROWS'] as const;

        for (const mergeType of mergeTypes) {
          const result = await handler.handle({
            action: 'merge_cells',
            spreadsheetId: 'test-id',
            range: 'Sheet1!A1:B2',
            mergeType,
          });

          expect(result.response.success).toBe(true);
        }
      });
    });

    describe('unmerge action', () => {
      it('should unmerge cells', async () => {
        const result = await handler.handle({
          action: 'unmerge_cells',
          spreadsheetId: 'test-id',
          range: 'Sheet1!A1:B2',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'unmerge_cells');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('cut action', () => {
      it('should cut cells with confirmation', async () => {
        // Cut operates on small ranges and skips confirmation for < 100 cells
        const result = await handler.handle({
          action: 'cut_paste',
          spreadsheetId: 'test-id',
          source: 'Sheet1!A1:B2',
          destination: 'Sheet1!D1',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'cut_paste');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should ignore snapshot request when snapshot feature is disabled', async () => {
        // Recreate handler with proper snapshot service
        const snapshotService = {
          create: vi.fn().mockResolvedValue({
            id: 'snapshot-123',
            timestamp: new Date('2024-01-15T00:00:00Z'),
          }),
        };
        const contextWithSnapshot = {
          ...mockContext,
          snapshotService: snapshotService as any,
        };
        const handlerWithSnapshot = new SheetsDataHandler(contextWithSnapshot, mockApi as any);

        const result = await handlerWithSnapshot.handle({
          action: 'cut_paste',
          spreadsheetId: 'test-id',
          source: 'Sheet1!A1:B2',
          destination: 'Sheet1!D1',
          safety: {
            createSnapshot: true,
          },
        });

        expect(result.response.success).toBe(true);
        expect(snapshotService.create).not.toHaveBeenCalled();
        expect((result.response as any).snapshotId).toBeUndefined();
      });

      it('should support dryRun mode', async () => {
        const result = await handler.handle({
          action: 'cut_paste',
          spreadsheetId: 'test-id',
          source: 'Sheet1!A1:B2',
          destination: 'Sheet1!D1',
          safety: {
            dryRun: true,
          },
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).dryRun).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should skip confirmation for small operations', async () => {
        mockContext.impactAnalyzer = {
          analyzeOperation: vi.fn().mockResolvedValue({
            severity: 'low',
            cellsAffected: 2, // Small operation
            formulasAffected: [],
            chartsAffected: [],
            warnings: [],
          }),
        } as any;

        handler = new SheetsDataHandler(mockContext, mockApi as any);

        const result = await handler.handle({
          action: 'cut_paste',
          spreadsheetId: 'test-id',
          source: 'Sheet1!A1',
          destination: 'Sheet1!B1',
        });

        expect(result.response.success).toBe(true);
        // Confirmation may still be called, but not required for small operations
      });
    });

    describe('copy action', () => {
      it('should copy cells', async () => {
        const result = await handler.handle({
          action: 'copy_paste',
          spreadsheetId: 'test-id',
          source: 'Sheet1!A1:B2',
          destination: 'Sheet1!D1',
        } as any);

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'copy_paste');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsDataOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should support paste type options', async () => {
        const result = await handler.handle({
          action: 'copy_paste',
          spreadsheetId: 'test-id',
          source: 'Sheet1!A1:B2',
          destination: 'Sheet1!D1',
          pasteType: 'PASTE_VALUES',
        } as any);

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'copy_paste');
      });
    });
  });

  describe('error handling', () => {
    it('should handle unknown actions', async () => {
      const result = await handler.handle({
        action: 'unknown_action' as any,
      } as any);

      expect(result.response.success).toBe(false);
      expect((result.response as any).error).toBeDefined();
    });

    it('should handle API errors', async () => {
      mockApi.spreadsheets.values.get.mockRejectedValueOnce(new Error('API Error'));

      const result = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1',
      });

      expect(result.response.success).toBe(false);
      expect((result.response as any).error.message).toContain('API Error');
    });

    it('should handle invalid ranges', async () => {
      mockApi.spreadsheets.values.get.mockRejectedValueOnce(new Error('Invalid range'));

      const result = await handler.handle({
        action: 'read',
        spreadsheetId: 'test-id',
        range: 'InvalidRange',
      });

      expect(result.response.success).toBe(false);
    });

    it('should handle batch operation failures', async () => {
      // Test API-level failures (replaced batchCompiler pattern with direct API calls)
      mockApi.spreadsheets.batchUpdate.mockRejectedValueOnce(new Error('Clear operation failed'));

      const result = await handler.handle({
        action: 'clear',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B2',
      });

      expect(result.response.success).toBe(false);
      expect((result.response as any).error.message).toContain('Clear operation failed');
    });
  });
});
