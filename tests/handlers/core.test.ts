/**
 * ServalSheets - Core Handler Tests
 *
 * Tests for core spreadsheet and sheet/tab operations.
 * Covers 15 actions: 8 spreadsheet operations + 7 sheet operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SheetsCoreHandler } from '../../src/handlers/core.js';
import { SheetsCoreOutputSchema } from '../../src/schemas/core.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4, drive_v3 } from 'googleapis';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        properties: {
          title: 'Test Spreadsheet',
          locale: 'en_US',
          timeZone: 'America/Los_Angeles',
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              index: 0,
              gridProperties: {
                rowCount: 1000,
                columnCount: 26,
              },
            },
          },
        ],
      },
    }),
    create: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'new-spreadsheet-id',
        properties: {
          title: 'New Spreadsheet',
        },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
            },
          },
        ],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        replies: [{}],
        updatedSpreadsheet: {
          spreadsheetId: 'test-spreadsheet-id',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test-spreadsheet-id',
          properties: {
            title: 'Test Spreadsheet',
            locale: 'en_US',
            timeZone: 'America/Los_Angeles',
          },
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        },
      },
    }),
    sheets: {
      copyTo: vi.fn().mockResolvedValue({
        data: {
          sheetId: 789,
          title: 'Sheet1',
          index: 0,
          gridProperties: {
            rowCount: 1000,
            columnCount: 26,
          },
        },
      }),
    },
    values: {
      batchGet: vi.fn().mockResolvedValue({
        data: { valueRanges: [] },
      }),
      get: vi.fn().mockResolvedValue({
        data: { values: [] },
      }),
      update: vi.fn().mockResolvedValue({ data: {} }),
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
      clear: vi.fn().mockResolvedValue({ data: {} }),
      batchClear: vi.fn().mockResolvedValue({ data: {} }),
      append: vi.fn().mockResolvedValue({ data: {} }),
    },
  },
});

// Mock Google Drive API
const createMockDriveApi = () => ({
  files: {
    get: vi.fn().mockResolvedValue({
      data: {
        id: 'test-spreadsheet-id',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
    }),
    copy: vi.fn().mockResolvedValue({
      data: {
        id: 'copied-spreadsheet-id',
        name: 'Copy of Test Spreadsheet',
      },
    }),
    list: vi.fn().mockResolvedValue({
      data: {
        files: [
          {
            id: 'spreadsheet-1',
            name: 'Spreadsheet 1',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            createdTime: '2024-01-01T00:00:00Z',
            modifiedTime: '2024-01-02T00:00:00Z',
          },
          {
            id: 'spreadsheet-2',
            name: 'Spreadsheet 2',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            createdTime: '2024-01-03T00:00:00Z',
            modifiedTime: '2024-01-04T00:00:00Z',
          },
        ],
        nextPageToken: undefined,
      },
    }),
  },
});

// Mock handler context
const createMockContext = (): HandlerContext =>
  ({
    requestId: 'test-request',
    timestamp: new Date('2024-01-15T00:00:00Z'),
    auth: {
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive',
      ],
    },
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
    googleClient: {
      sheets: vi.fn(),
      drive: vi.fn(),
    } as any,
    authService: {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockResolvedValue({}),
    } as any,
    elicitationServer: {
      request: vi.fn().mockResolvedValue({
        confirmed: true,
        reason: '',
      }),
      elicitInput: vi.fn().mockResolvedValue({
        action: 'accept',
        content: { confirm: true },
      }),
      getClientCapabilities: vi.fn().mockReturnValue({
        elicitation: { form: true },
      }),
    } as any,
    snapshotService: {
      createSnapshot: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-123',
        timestamp: new Date('2024-01-15T00:00:00Z'),
      }),
      create: vi.fn().mockResolvedValue({
        id: 'snapshot-123',
        timestamp: new Date('2024-01-15T00:00:00Z'),
      }),
    } as any,
    impactAnalyzer: {
      analyzeOperation: vi.fn().mockResolvedValue({
        severity: 'low',
        cellsAffected: 0,
        formulasAffected: [],
        chartsAffected: [],
        warnings: [],
      }),
    } as any,
    rangeResolver: {
      resolve: vi.fn(),
    } as any,
    batchCompiler: {
      compile: vi.fn(),
      execute: vi.fn(),
    } as any,
  }) as any;

describe('SheetsCoreHandler', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockDriveApi: ReturnType<typeof createMockDriveApi>;
  let mockContext: HandlerContext;
  let handler: SheetsCoreHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockDriveApi = createMockDriveApi();
    mockContext = createMockContext();
    handler = new SheetsCoreHandler(
      mockContext,
      mockApi as any as sheets_v4.Sheets,
      mockDriveApi as any as drive_v3.Drive
    );
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(SheetsCoreHandler);
    });
  });

  describe('Spreadsheet Operations', () => {
    describe('get action', () => {
      it('should get spreadsheet metadata', async () => {
        const result = await handler.handle({
          action: 'get',
          spreadsheetId: 'test-spreadsheet-id',
        });

        expect(result.response).toMatchObject({
          success: true,
          action: 'get',
          spreadsheet: expect.objectContaining({
            spreadsheetId: 'test-spreadsheet-id',
            title: 'Test Spreadsheet',
          }),
        });

        expect(mockApi.spreadsheets.get).toHaveBeenCalledTimes(1);
        expect(mockApi.spreadsheets.get).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'test-spreadsheet-id',
          })
        );

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should include sheets in response', async () => {
        const result = await handler.handle({
          action: 'get',
          spreadsheetId: 'test-spreadsheet-id',
          includeSheets: true,
        });

        expect(result.response).toMatchObject({
          success: true,
          action: 'get',
          spreadsheet: expect.objectContaining({
            spreadsheetId: 'test-spreadsheet-id',
            sheets: expect.any(Array),
          }),
        });

        const spreadsheet = (result.response as any).spreadsheet;
        expect(spreadsheet.sheets).toHaveLength(1);
        expect(spreadsheet.sheets[0]).toMatchObject({
          sheetId: expect.any(Number),
          title: 'Sheet1',
        });
      });

      it('should apply preview response_format to sheet metadata list', async () => {
        const largeSheets = Array.from({ length: 30 }, (_, index) => ({
          properties: {
            sheetId: index,
            title: `Sheet${index + 1}`,
            index,
            gridProperties: { rowCount: 1000, columnCount: 26 },
          },
        }));

        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-spreadsheet-id',
            properties: {
              title: 'Test Spreadsheet',
              locale: 'en_US',
              timeZone: 'America/Los_Angeles',
            },
            sheets: largeSheets,
          },
        });

        const result = await handler.handle({
          action: 'get',
          spreadsheetId: 'test-spreadsheet-id',
          response_format: 'preview',
        } as any);

        expect(result.response.success).toBe(true);
        expect((result.response as any).responseFormat).toBe('preview');
        expect((result.response as any).truncated).toBe(true);
        expect((result.response as any).totalSheets).toBe(30);
        expect((result.response as any).returnedSheets).toBe(10);
        expect((result.response as any).spreadsheet.sheets).toHaveLength(10);
        expect((result.response as any)._meta?.truncated).toBe(true);
        expect((result.response as any)._meta?.continuationHint).toContain('response_format');
      });

      it('should handle API errors gracefully', async () => {
        mockApi.spreadsheets.get.mockRejectedValueOnce(new Error('Spreadsheet not found'));

        const result = await handler.handle({
          action: 'get',
          spreadsheetId: 'nonexistent-id',
        });

        expect(result.response).toMatchObject({
          success: false,
          error: expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String),
          }),
        });

        expect((result.response as any).error.message).not.toBeUndefined();
      });

      it('should resolve Drive shortcut IDs before fetching spreadsheet metadata', async () => {
        mockDriveApi.files.get.mockResolvedValueOnce({
          data: {
            id: 'shortcut-sheet-id',
            mimeType: 'application/vnd.google-apps.shortcut',
            shortcutDetails: {
              targetId: 'resolved-sheet-id',
              targetMimeType: 'application/vnd.google-apps.spreadsheet',
            },
          },
        });
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'resolved-sheet-id',
            properties: {
              title: 'Resolved Spreadsheet',
            },
            sheets: [],
          },
        });

        const result = await handler.handle({
          action: 'get',
          spreadsheetId: 'shortcut-sheet-id',
        });

        expect(result.response.success).toBe(true);
        expect(mockDriveApi.files.get).toHaveBeenCalledWith(
          expect.objectContaining({
            fileId: 'shortcut-sheet-id',
          })
        );
        expect(mockApi.spreadsheets.get).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'resolved-sheet-id',
          })
        );
      });
    });

    describe('create action', () => {
      it('should create a new spreadsheet', async () => {
        const result = await handler.handle({
          action: 'create',
          title: 'My New Spreadsheet',
        });

        expect(result.response).toMatchObject({
          success: true,
          action: 'create',
          spreadsheet: expect.objectContaining({
            spreadsheetId: 'new-spreadsheet-id',
            sheets: expect.arrayContaining([
              expect.objectContaining({
                sheetId: 0,
                title: 'Sheet1',
              }),
            ]),
          }),
        });

        // Verify URL is either present and valid, or not present (handler-dependent)
        if ((result.response as any).spreadsheetUrl) {
          expect((result.response as any).spreadsheetUrl).toContain('new-spreadsheet-id');
        }

        expect(mockApi.spreadsheets.create).toHaveBeenCalledTimes(1);
        expect(mockApi.spreadsheets.create).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              properties: expect.objectContaining({
                title: 'My New Spreadsheet',
              }),
            }),
          })
        );

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should create spreadsheet with custom properties', async () => {
        const result = await handler.handle({
          action: 'create',
          title: 'Custom Spreadsheet',
          locale: 'en_GB',
          timeZone: 'Europe/London',
        });

        expect(result.response).toMatchObject({
          success: true,
          action: 'create',
          spreadsheet: expect.objectContaining({
            spreadsheetId: expect.any(String),
          }),
        });

        expect(mockApi.spreadsheets.create).toHaveBeenCalledTimes(1);
        expect(mockApi.spreadsheets.create).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              properties: expect.objectContaining({
                title: 'Custom Spreadsheet',
                locale: 'en_GB',
                timeZone: 'Europe/London',
              }),
            }),
          })
        );
      });
    });

    describe('copy action', () => {
      it('should copy a spreadsheet', async () => {
        const result = await handler.handle({
          action: 'copy',
          spreadsheetId: 'test-spreadsheet-id',
          destinationTitle: 'Copy of Spreadsheet',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'copy');
        expect((result.response as any).spreadsheet.spreadsheetId).toBe('copied-spreadsheet-id');
        expect((result.response as any).spreadsheet.title).toBe('Copy of Test Spreadsheet');
        expect(mockDriveApi.files.copy).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should handle copy errors', async () => {
        mockDriveApi.files.copy.mockRejectedValueOnce(new Error('Permission denied'));

        const result = await handler.handle({
          action: 'copy',
          spreadsheetId: 'test-spreadsheet-id',
          destinationTitle: 'Copy',
        });

        expect(result.response.success).toBe(false);
      });
    });

    describe('update_properties action', () => {
      it('should update spreadsheet properties', async () => {
        const result = await handler.handle({
          action: 'update_properties',
          spreadsheetId: 'test-spreadsheet-id',
          title: 'Updated Title',
          locale: 'fr_FR',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'update_properties');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('get_url action', () => {
      it('should generate spreadsheet URL', async () => {
        const result = await handler.handle({
          action: 'get_url',
          spreadsheetId: 'test-spreadsheet-id',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'get_url');
        expect(result.response).toHaveProperty('url');
        expect((result.response as any).url).toContain('test-spreadsheet-id');

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should generate URL with sheet ID', async () => {
        const result = await handler.handle({
          action: 'get_url',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).url).toContain('gid=123');
      });
    });

    describe('batch_get action', () => {
      it('should get multiple spreadsheets', async () => {
        const result = await handler.handle({
          action: 'batch_get',
          spreadsheetIds: ['id1', 'id2'],
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'batch_get');
        expect((result.response as any).spreadsheets).toHaveLength(2);

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should apply preview response_format to spreadsheet batch list', async () => {
        const spreadsheetIds = Array.from({ length: 12 }, (_, i) => `id-${i + 1}`);

        const result = await handler.handle({
          action: 'batch_get',
          spreadsheetIds,
          response_format: 'preview',
        } as any);

        expect(result.response.success).toBe(true);
        expect((result.response as any).responseFormat).toBe('preview');
        expect((result.response as any).truncated).toBe(true);
        expect((result.response as any).totalSpreadsheets).toBe(12);
        expect((result.response as any).returnedSpreadsheets).toBe(10);
        expect((result.response as any).spreadsheets).toHaveLength(10);
        expect((result.response as any)._meta?.truncated).toBe(true);
        expect((result.response as any)._meta?.continuationHint).toContain('response_format');
      });

      it('should resolve shortcut IDs in batch_get requests', async () => {
        mockDriveApi.files.get.mockImplementation(async ({ fileId }: { fileId?: string }) => {
          if (fileId === 'shortcut-batch-id') {
            return {
              data: {
                id: 'shortcut-batch-id',
                mimeType: 'application/vnd.google-apps.shortcut',
                shortcutDetails: {
                  targetId: 'resolved-batch-id',
                  targetMimeType: 'application/vnd.google-apps.spreadsheet',
                },
              },
            };
          }
          return {
            data: {
              id: fileId,
              mimeType: 'application/vnd.google-apps.spreadsheet',
            },
          };
        });

        const result = await handler.handle({
          action: 'batch_get',
          spreadsheetIds: ['shortcut-batch-id', 'regular-batch-id'],
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.get).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'resolved-batch-id',
          })
        );
        expect(mockApi.spreadsheets.get).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'regular-batch-id',
          })
        );
      });

      it('should emit progress notifications for large batch_get requests', async () => {
        const notification = vi.fn().mockResolvedValue(undefined);
        const requestContext = createRequestContext({
          requestId: 'core-batch-get-progress',
          progressToken: 'core-batch-get-progress',
          sendNotification: notification,
        });

        const spreadsheetIds = Array.from({ length: 20 }, (_, i) => `id-${i + 1}`);
        const result = await runWithRequestContext(requestContext, () =>
          handler.handle({
            action: 'batch_get',
            spreadsheetIds,
          })
        );

        expect(result.response.success).toBe(true);
        expect(notification).toHaveBeenCalled();
        expect(notification.mock.calls[0]?.[0]).toMatchObject({
          method: 'notifications/progress',
          params: expect.objectContaining({
            total: 20,
            progress: 0,
          }),
        });
      });
    });

    describe('get_comprehensive action', () => {
      it('should get comprehensive spreadsheet data', async () => {
        const result = await handler.handle({
          action: 'get_comprehensive',
          spreadsheetId: 'test-spreadsheet-id',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'get_comprehensive');
        expect((result.response as any).comprehensiveMetadata.spreadsheetId).toBe(
          'test-spreadsheet-id'
        );

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('describe_workbook action', () => {
      it('should return structured workbook summary', async () => {
        // resolveSpreadsheetShortcutId() calls files.get before the action runs — queue a no-op response
        mockDriveApi.files.get.mockResolvedValueOnce({
          data: { id: 'test-spreadsheet-id', mimeType: 'application/vnd.google-apps.spreadsheet' },
        });
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-spreadsheet-id',
            properties: { title: 'My Budget', locale: 'en_US', timeZone: 'America/New_York' },
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
        });
        // Pass 2: bounded values.batchGet returns formula data for formula/cell counting
        mockApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
          data: {
            valueRanges: [
              {
                range: "'Sheet1'!A1:Z1000",
                values: [['100', '=A1*2']],
              },
            ],
          },
        });
        mockDriveApi.files.get.mockResolvedValueOnce({
          data: {
            modifiedTime: '2024-06-01T12:00:00Z',
            owners: [{ emailAddress: 'owner@example.com' }],
          },
        });

        const result = await handler.handle({
          action: 'describe_workbook',
          spreadsheetId: 'test-spreadsheet-id',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'describe_workbook');
        const summary = (result.response as any).workbookSummary;
        expect(summary.title).toBe('My Budget');
        expect(summary.sheetCount).toBe(1);
        expect(summary.sheets).toHaveLength(1);
        expect(summary.sheets[0].name).toBe('Sheet1');
        expect(summary.sheets[0].formulaCount).toBe(1);
        expect(summary.sheets[0].nonEmptyCells).toBe(2);
        expect(summary.sheets[0].isEmpty).toBe(false);
        expect(summary.totalFormulaCount).toBe(1);
        // Drive API call is optional but should work when driveApi is passed
        expect(mockDriveApi.files.get).toHaveBeenCalledWith({
          fileId: 'test-spreadsheet-id',
          fields: 'modifiedTime,owners(emailAddress)',
        });
        expect(summary.lastModifiedTime).toBe('2024-06-01T12:00:00Z');
        expect(summary.ownerEmail).toBe('owner@example.com');

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should return isEmpty true for sheets with no data', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'empty-sheet-id',
            properties: { title: 'Empty' },
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
        });
        // Pass 2: values.batchGet returns empty for an empty sheet
        mockApi.spreadsheets.values.batchGet.mockResolvedValueOnce({
          data: { valueRanges: [{ range: "'Sheet1'!A1:Z1000", values: [] }] },
        });

        const result = await handler.handle({
          action: 'describe_workbook',
          spreadsheetId: 'empty-sheet-id',
        });

        expect(result.response.success).toBe(true);
        const summary = (result.response as any).workbookSummary;
        expect(summary.sheets[0].isEmpty).toBe(true);
        expect(summary.sheets[0].formulaCount).toBe(0);
        expect(summary.totalCells).toBe(0);
      });
    });

    describe('list action', () => {
      it('should list spreadsheets', async () => {
        const result = await handler.handle({
          action: 'list',
          maxResults: 10,
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'list');
        expect((result.response as any).spreadsheets).toHaveLength(2);
        expect(mockDriveApi.files.list).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should apply preview response_format to spreadsheet list results', async () => {
        const files = Array.from({ length: 14 }, (_, i) => ({
          id: `spreadsheet-${i + 1}`,
          name: `Spreadsheet ${i + 1}`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          createdTime: '2024-01-01T00:00:00Z',
          modifiedTime: '2024-01-02T00:00:00Z',
        }));
        mockDriveApi.files.list.mockResolvedValueOnce({
          data: {
            files,
            nextPageToken: undefined,
          },
        });

        const result = await handler.handle({
          action: 'list',
          response_format: 'preview',
        } as any);

        expect(result.response.success).toBe(true);
        expect((result.response as any).responseFormat).toBe('preview');
        expect((result.response as any).truncated).toBe(true);
        expect((result.response as any).totalSpreadsheets).toBe(14);
        expect((result.response as any).returnedSpreadsheets).toBe(10);
        expect((result.response as any).spreadsheets).toHaveLength(10);
        expect((result.response as any)._meta?.truncated).toBe(true);
        expect((result.response as any)._meta?.continuationHint).toContain('response_format');
      });

      it('should filter by query', async () => {
        const result = await handler.handle({
          action: 'list',
          query: 'name contains "Budget"',
        });

        expect(result.response.success).toBe(true);
        expect(mockDriveApi.files.list).toHaveBeenCalledWith(
          expect.objectContaining({
            q: expect.stringContaining('Budget'),
          })
        );
      });
    });
  });

  describe('Sheet/Tab Operations', () => {
    describe('add_sheet action', () => {
      it('should add a new sheet', async () => {
        const result = await handler.handle({
          action: 'add_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          title: 'New Sheet',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'add_sheet');
        expect((result.response as any).sheet).not.toBeNull();
        expect((result.response as any).sheet.title).toBe('New Sheet');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should add sheet with custom properties', async () => {
        const result = await handler.handle({
          action: 'add_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          title: 'Custom Sheet',
          index: 1,
          rowCount: 500,
          columnCount: 20,
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'test-spreadsheet-id',
            requestBody: expect.objectContaining({
              requests: expect.arrayContaining([
                expect.objectContaining({
                  addSheet: expect.objectContaining({
                    properties: expect.objectContaining({
                      title: 'Custom Sheet',
                      index: 1,
                    }),
                  }),
                }),
              ]),
            }),
          })
        );
      });
    });

    describe('delete_sheet action', () => {
      it('should delete a sheet with confirmation', async () => {
        const result = await handler.handle({
          action: 'delete_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'delete_sheet');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should create snapshot before deletion', async () => {
        const result = await handler.handle({
          action: 'delete_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
          safety: {
            createSnapshot: true,
          } as any, // Using createSnapshot instead of autoSnapshot to match utility function
        });

        expect(result.response.success).toBe(true);
        expect(mockContext.snapshotService?.create).toHaveBeenCalled();
        expect((result.response as any).snapshotId).toBe('snapshot-123');
      });

      it('should handle cancelled deletion', async () => {
        mockContext.elicitationServer = {
          request: vi.fn().mockResolvedValue({
            confirmed: false,
            reason: 'User cancelled',
          }),
          elicitInput: vi.fn().mockResolvedValue({
            action: 'reject',
            content: {},
          }),
          getClientCapabilities: vi.fn().mockReturnValue({
            elicitation: { form: true },
          }),
        } as any;

        handler = new SheetsCoreHandler(
          mockContext,
          mockApi as any as sheets_v4.Sheets,
          mockDriveApi as any as drive_v3.Drive
        );

        const result = await handler.handle({
          action: 'delete_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
        });

        expect(result.response.success).toBe(false);
        expect((result.response as any).error.code).toBe('PRECONDITION_FAILED');
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should support dryRun mode', async () => {
        const result = await handler.handle({
          action: 'delete_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
          safety: {
            dryRun: true,
          },
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).dryRun).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('duplicate_sheet action', () => {
      it('should duplicate a sheet', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-spreadsheet-id',
            replies: [
              {
                duplicateSheet: {
                  properties: {
                    sheetId: 456,
                    title: 'Copy of Sheet1',
                    index: 1,
                    gridProperties: {
                      rowCount: 1000,
                      columnCount: 26,
                    },
                  },
                },
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'duplicate_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
          newSheetName: 'Copy of Sheet1',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'duplicate_sheet');
        expect((result.response as any).sheet.sheetId).toBe(456);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('update_sheet action', () => {
      it('should update sheet properties', async () => {
        // Mock batchUpdate to return updatedSpreadsheet with the updated sheet
        mockApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-spreadsheet-id',
            replies: [{}],
            updatedSpreadsheet: {
              spreadsheetId: 'test-spreadsheet-id',
              sheets: [
                {
                  properties: {
                    sheetId: 123,
                    title: 'Updated Sheet Name',
                    index: 0,
                    gridProperties: { rowCount: 1000, columnCount: 26 },
                  },
                },
              ],
            },
          },
        });

        const result = await handler.handle({
          action: 'update_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 123,
          title: 'Updated Sheet Name',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'update_sheet');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should resolve sheetName to sheetId 0 for first sheet', async () => {
        // First get call is for sheetName→sheetId resolution
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-spreadsheet-id',
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
          },
        });
        // batchUpdate returns updatedSpreadsheet (replaces the second get call)
        mockApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
          data: {
            spreadsheetId: 'test-spreadsheet-id',
            replies: [{}],
            updatedSpreadsheet: {
              spreadsheetId: 'test-spreadsheet-id',
              sheets: [
                {
                  properties: {
                    sheetId: 0,
                    title: 'Summary',
                    index: 0,
                    gridProperties: { rowCount: 1000, columnCount: 26 },
                  },
                },
              ],
            },
          },
        });

        const result = await handler.handle({
          action: 'update_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetName: 'Sheet1',
          title: 'Summary',
        } as any);

        expect(result.response.success).toBe(true);

        const batchUpdateArgs = mockApi.spreadsheets.batchUpdate.mock.calls[0]?.[0] as any;
        expect(
          batchUpdateArgs.requestBody.requests[0].updateSheetProperties.properties.sheetId
        ).toBe(0);
      });
    });

    describe('copy_sheet_to action', () => {
      it('should copy sheet to another spreadsheet', async () => {
        const result = await handler.handle({
          action: 'copy_sheet_to',
          spreadsheetId: 'source-id',
          sheetId: 123,
          destinationSpreadsheetId: 'destination-id',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'copy_sheet_to');
        expect((result.response as any).sheet.sheetId).toBe(789);

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('list_sheets action', () => {
      it('should list all sheets in spreadsheet', async () => {
        const result = await handler.handle({
          action: 'list_sheets',
          spreadsheetId: 'test-spreadsheet-id',
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'list_sheets');
        expect((result.response as any).sheets).toHaveLength(1);
        expect((result.response as any).sheets[0]).toHaveProperty('sheetId', 0);

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should apply compact response_format to long sheet lists', async () => {
        const largeSheets = Array.from({ length: 60 }, (_, index) => ({
          properties: {
            sheetId: index,
            title: `Sheet${index + 1}`,
            index,
            gridProperties: { rowCount: 1000, columnCount: 26 },
          },
        }));

        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: largeSheets,
          },
        });

        const result = await handler.handle({
          action: 'list_sheets',
          spreadsheetId: 'test-spreadsheet-id',
          response_format: 'compact',
        } as any);

        expect(result.response.success).toBe(true);
        expect((result.response as any).responseFormat).toBe('compact');
        expect((result.response as any).truncated).toBe(true);
        expect((result.response as any).totalSheets).toBe(60);
        expect((result.response as any).returnedSheets).toBe(50);
        expect((result.response as any).sheets).toHaveLength(50);
        expect((result.response as any)._meta?.truncated).toBe(true);
        expect((result.response as any)._meta?.continuationHint).toContain('response_format');
      });
    });

    describe('get_sheet action', () => {
      it('should get sheet by ID', async () => {
        const result = await handler.handle({
          action: 'get_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 0,
        });

        expect(result).toBeDefined();
        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'get_sheet');
        expect((result.response as any).sheet.sheetId).toBe(0);
        expect((result.response as any).sheet.title).toBe('Sheet1');

        const parseResult = SheetsCoreOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should get sheet by ID (0)', async () => {
        const result = await handler.handle({
          action: 'get_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        expect((result.response as any).sheet.sheetId).toBe(0);
        expect((result.response as any).sheet.title).toBe('Sheet1');
      });

      it('should handle sheet not found', async () => {
        const result = await handler.handle({
          action: 'get_sheet',
          spreadsheetId: 'test-spreadsheet-id',
          sheetId: 999,
        });

        expect(result.response.success).toBe(false);
        expect((result.response as any).error).toBeDefined();
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

    it('should handle authentication errors', async () => {
      mockContext = createMockContext();
      mockContext.googleClient = undefined as any;

      handler = new SheetsCoreHandler(mockContext, mockApi as any, mockDriveApi as any);

      // requireAuth() throws before the try-catch, so we expect it to throw
      await expect(
        handler.handle({
          action: 'get',
          spreadsheetId: 'test-id',
        })
      ).rejects.toThrow();
    });

    it('should handle API errors', async () => {
      mockApi.spreadsheets.get.mockRejectedValueOnce(new Error('API Error'));

      const result = await handler.handle({
        action: 'get',
        spreadsheetId: 'test-id',
      });

      expect(result.response.success).toBe(false);
      expect((result.response as any).error.message).toContain('API Error');
    });
  });
});
