/**
 * ServalSheets - Dimensions Handler Tests
 *
 * Tests for row and column dimension operations.
 * Covers all 21 actions across insert, delete, move, resize, visibility, freeze, group, and append.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DimensionsHandler } from '../../src/handlers/dimensions.js';
import { SheetsDimensionsOutputSchema } from '../../src/schemas/dimensions.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { getContextManager } from '../../src/services/context-manager.js';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn(),
    batchUpdate: vi.fn(),
  },
});

// Mock handler context
const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {
    compile: vi.fn(),
    execute: vi.fn(),
    executeAll: vi.fn(),
  } as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({
      a1Notation: 'Sheet1!A1:B2',
      sheetId: 0,
      sheetName: 'Sheet1',
    }),
  } as any,
});

describe('DimensionsHandler', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;
  let handler: DimensionsHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    getContextManager().reset();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new DimensionsHandler(mockContext, mockApi as any);

    // Mock sheet metadata
    mockApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      },
    });
  });

  afterEach(() => {
    getContextManager().reset();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Insert Operations', () => {
    it('should insert rows at specified index', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'insert',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        count: 3,
        inheritFromBefore: false,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'insert');
      expect(result.response).toHaveProperty('rowsAffected', 3);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 8, // startIndex + count
                },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });

      const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should insert columns at specified index', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'insert',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        count: 5,
        inheritFromBefore: true,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'insert');
      expect(result.response).toHaveProperty('columnsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 2,
                  endIndex: 7,
                },
                inheritFromBefore: true,
              },
            },
          ],
        },
      });
    });

    it('should default to inserting 1 row when count not specified', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'insert',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('rowsAffected', 1);
      const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].insertDimension.range.endIndex).toBe(1);
    });

    it('should resolve sheetName when sheetId is omitted', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'insert',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetName: 'Sheet1',
        startIndex: 1,
        count: 2,
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'insert');
      expect(result.response).toHaveProperty('rowsAffected', 2);

      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 1,
                  endIndex: 3,
                },
                inheritFromBefore: false,
              },
            },
          ],
        },
      });
    });
  });

  describe('Delete Operations (Destructive)', () => {
    it('should delete rows in specified range', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'delete',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'delete');
      expect(result.response).toHaveProperty('rowsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 10,
                },
              },
            },
          ],
        },
      });
    });

    it('should delete columns in specified range', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'delete',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        endIndex: 5,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'delete');
      expect(result.response).toHaveProperty('columnsAffected', 3);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 2,
                  endIndex: 5,
                },
              },
            },
          ],
        },
      });
    });

    it('should respect dryRun for delete operations', async () => {
      const result = await handler.handle({
        action: 'delete',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
        endIndex: 10,
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      expect(result.response).toHaveProperty('rowsAffected', 10);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Move Operations', () => {
    it('should move rows to new position', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'move',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
        destinationIndex: 15,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'move');
      expect(result.response).toHaveProperty('rowsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              moveDimension: {
                source: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 10,
                },
                destinationIndex: 15,
              },
            },
          ],
        },
      });
    });

    it('should move columns to new position', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'move',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        endIndex: 5,
        destinationIndex: 10,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'move');
      expect(result.response).toHaveProperty('columnsAffected', 3);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              moveDimension: {
                source: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 2,
                  endIndex: 5,
                },
                destinationIndex: 10,
              },
            },
          ],
        },
      });
    });
  });

  describe('Resize Operations', () => {
    it('should resize rows to specified pixel height', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'resize',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
        endIndex: 10,
        pixelSize: 30,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'resize');
      expect(result.response).toHaveProperty('rowsAffected', 10);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 0,
                  endIndex: 10,
                },
                properties: {
                  pixelSize: 30,
                },
                fields: 'pixelSize',
              },
            },
          ],
        },
      });
    });

    it('should resize columns to specified pixel width', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'resize',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
        endIndex: 5,
        pixelSize: 150,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'resize');
      expect(result.response).toHaveProperty('columnsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 5,
                },
                properties: {
                  pixelSize: 150,
                },
                fields: 'pixelSize',
              },
            },
          ],
        },
      });
    });

    it('should auto-resize rows to fit content', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'auto_resize',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 20,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'auto_resize');
      expect(result.response).toHaveProperty('rowsAffected', 20);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 0,
                  endIndex: 20,
                },
              },
            },
          ],
        },
      });
    });

    it('should auto-resize columns to fit content', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'auto_resize',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: 10,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'auto_resize');
      expect(result.response).toHaveProperty('columnsAffected', 10);
    });
  });

  describe('Visibility Operations', () => {
    it('should hide rows', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'hide',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'hide');
      expect(result.response).toHaveProperty('rowsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 10,
                },
                properties: {
                  hiddenByUser: true,
                },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      });
    });

    it('should hide columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'hide',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        endIndex: 5,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'hide');
      expect(result.response).toHaveProperty('columnsAffected', 3);
    });

    it('should show previously hidden rows', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'show',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'show');
      expect(result.response).toHaveProperty('rowsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 10,
                },
                properties: {
                  hiddenByUser: false,
                },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      });
    });

    it('should show previously hidden columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'show',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        endIndex: 5,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'show');
      expect(result.response).toHaveProperty('columnsAffected', 3);
    });
  });

  describe('Freeze Operations', () => {
    it('should freeze top rows', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'freeze',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        count: 2,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'freeze');
      expect(result.response).toHaveProperty('rowsAffected', 2);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: 0,
                  gridProperties: {
                    frozenRowCount: 2,
                  },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });
    });

    it('should freeze left columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'freeze',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        count: 3,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'freeze');
      expect(result.response).toHaveProperty('columnsAffected', 3);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: 0,
                  gridProperties: {
                    frozenColumnCount: 3,
                  },
                },
                fields: 'gridProperties.frozenColumnCount',
              },
            },
          ],
        },
      });
    });

    it('should unfreeze all rows when count is 0', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'freeze',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        count: 0,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('rowsAffected', 0);
    });
  });

  describe('Group Operations', () => {
    it('should group rows', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'group',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 15,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'group');
      expect(result.response).toHaveProperty('rowsAffected', 10);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              addDimensionGroup: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 15,
                },
              },
            },
          ],
        },
      });
    });

    it('should group columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'group',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        endIndex: 8,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'group');
      expect(result.response).toHaveProperty('columnsAffected', 6);
    });

    it('should ungroup rows', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'ungroup',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 15,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'ungroup');
      expect(result.response).toHaveProperty('rowsAffected', 10);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              deleteDimensionGroup: {
                range: {
                  sheetId: 0,
                  dimension: 'ROWS',
                  startIndex: 5,
                  endIndex: 15,
                },
              },
            },
          ],
        },
      });
    });

    it('should ungroup columns', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'ungroup',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 2,
        endIndex: 8,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'ungroup');
      expect(result.response).toHaveProperty('columnsAffected', 6);
    });
  });

  describe('Append Operations', () => {
    it('should append rows to end of sheet', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'append',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        count: 10,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'append');
      expect(result.response).toHaveProperty('rowsAffected', 10);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId: 0,
                dimension: 'ROWS',
                length: 10,
              },
            },
          ],
        },
      });
    });

    it('should append columns to end of sheet', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'append',
        dimension: 'COLUMNS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        count: 5,
      });

      expect(result.response.success).toBe(true);
      expect(result.response).toHaveProperty('action', 'append');
      expect(result.response).toHaveProperty('columnsAffected', 5);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-id',
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId: 0,
                dimension: 'COLUMNS',
                length: 5,
              },
            },
          ],
        },
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      mockApi.spreadsheets.batchUpdate.mockRejectedValue(
        new Error('API Error: 403 Permission denied')
      );

      const result = await handler.handle({
        action: 'insert',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
        count: 1,
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBeDefined();
    });

    it('should handle invalid action', async () => {
      const result = await handler.handle({
        action: 'invalid_action' as any,
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
      } as any);

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
      expect(result.response.error?.message).toContain('Unknown action');
    });

    it('should validate schema compliance for errors', async () => {
      mockApi.spreadsheets.batchUpdate.mockRejectedValue(new Error('Test error'));

      const result = await handler.handle({
        action: 'delete',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
        endIndex: 5,
      });

      const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('Safety Features', () => {
    it('should respect dryRun for move operations', async () => {
      const result = await handler.handle({
        action: 'move',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 5,
        endIndex: 10,
        destinationIndex: 15,
        safety: { dryRun: true },
      });

      expect(result.response.success).toBe(true);
      expect(result.response.dryRun).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });

    it('should include metadata in successful responses', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const result = await handler.handle({
        action: 'insert',
        dimension: 'ROWS',
        spreadsheetId: 'test-sheet-id',
        sheetId: 0,
        startIndex: 0,
        count: 5,
      });

      expect(result.response.success).toBe(true);
      // Metadata is optional but should be included when present
      if ('_meta' in result.response) {
        expect(result.response._meta).toBeDefined();
      }
    });
  });

  describe('Schema Validation', () => {
    it('should produce schema-compliant output for all actions', async () => {
      mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

      const actions: Array<{
        action: string;
        params: Record<string, any>;
      }> = [
        { action: 'insert', params: { dimension: 'ROWS', startIndex: 0, count: 1 } },
        { action: 'delete', params: { dimension: 'ROWS', startIndex: 0, endIndex: 1 } },
        {
          action: 'resize',
          params: { dimension: 'ROWS', startIndex: 0, endIndex: 5, pixelSize: 30 },
        },
        { action: 'hide', params: { dimension: 'ROWS', startIndex: 0, endIndex: 5 } },
        { action: 'freeze', params: { dimension: 'ROWS', frozenCount: 1 } },
        { action: 'group', params: { dimension: 'ROWS', startIndex: 0, endIndex: 5 } },
        { action: 'append', params: { dimension: 'ROWS', count: 5 } },
      ];

      for (const { action, params } of actions) {
        const result = await handler.handle({
          action,
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          ...params,
        } as any);

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      }
    });
  });

  // ============================================================
  // Range Utility Operations (100% Google API Coverage)
  // ============================================================

  describe('Range Utility Operations', () => {
    describe('trim_whitespace', () => {
      it('should trim whitespace from cells in range', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({
          data: { replies: [{ trimWhitespace: { cellsChangedCount: 15 } }] },
        });

        const result = await handler.handle({
          action: 'trim_whitespace',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:D10',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'trim_whitespace');
        expect(result.response).toHaveProperty('cellsAffected', 15);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                trimWhitespace: {
                  range: expect.objectContaining({ sheetId: 0 }),
                },
              },
            ],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for trim_whitespace', async () => {
        const result = await handler.handle({
          action: 'trim_whitespace',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:D10',
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('cellsAffected', 0);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('randomize_range', () => {
      it('should randomize row order in range', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'randomize_range',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:D10',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'randomize_range');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                randomizeRange: {
                  range: expect.objectContaining({ sheetId: 0 }),
                },
              },
            ],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for randomize_range', async () => {
        const result = await handler.handle({
          action: 'randomize_range',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:D10',
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('text_to_columns', () => {
      it('should split text to columns with auto-detect delimiter', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'text_to_columns',
          spreadsheetId: 'test-sheet-id',
          source: 'Sheet1!A1:A10',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'text_to_columns');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                textToColumns: {
                  source: expect.objectContaining({ sheetId: 0 }),
                  delimiterType: 'AUTODETECT',
                  delimiter: undefined,
                },
              },
            ],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should split text to columns with custom delimiter', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'text_to_columns',
          spreadsheetId: 'test-sheet-id',
          source: 'Sheet1!A1:A10',
          delimiterType: 'CUSTOM',
          delimiter: '|',
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                textToColumns: {
                  source: expect.objectContaining({ sheetId: 0 }),
                  delimiterType: 'CUSTOM',
                  delimiter: '|',
                },
              },
            ],
          },
        });
      });

      it('should respect dryRun for text_to_columns', async () => {
        const result = await handler.handle({
          action: 'text_to_columns',
          spreadsheetId: 'test-sheet-id',
          source: 'Sheet1!A1:A10',
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('auto_fill', () => {
      it('should auto-fill with range mode', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'auto_fill',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:A10',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'auto_fill');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                autoFill: expect.objectContaining({
                  range: expect.objectContaining({ sheetId: 0 }),
                }),
              },
            ],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should auto-fill with sourceAndDestination mode', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'auto_fill',
          spreadsheetId: 'test-sheet-id',
          sourceRange: 'Sheet1!A1:A3',
          fillLength: 10,
          dimension: 'ROWS',
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                autoFill: expect.objectContaining({
                  sourceAndDestination: expect.objectContaining({
                    fillLength: 10,
                    dimension: 'ROWS',
                  }),
                }),
              },
            ],
          },
        });
      });

      it('should auto-fill with alternate series', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'auto_fill',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:A10',
          useAlternateSeries: true,
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [
              {
                autoFill: expect.objectContaining({
                  useAlternateSeries: true,
                }),
              },
            ],
          },
        });
      });

      it('should return error when neither range nor sourceRange provided', async () => {
        const result = await handler.handle({
          action: 'auto_fill',
          spreadsheetId: 'test-sheet-id',
        } as any);

        expect(result.response.success).toBe(false);
        if (!result.response.success) {
          expect(result.response.error.code).toBe('INVALID_PARAMS');
        }
      });

      it('should respect dryRun for auto_fill', async () => {
        const result = await handler.handle({
          action: 'auto_fill',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:A10',
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================================
  // Basic Filter Operations
  // ============================================================

  describe('Basic Filter Operations', () => {
    describe('set_basic_filter', () => {
      it('should set a basic filter using a range', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'set_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          range: 'Sheet1!A1:D10',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'set_basic_filter');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'test-sheet-id',
            requestBody: expect.objectContaining({
              requests: [expect.objectContaining({ setBasicFilter: expect.any(Object) })],
            }),
          })
        );

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should set a basic filter using sheetId only (no range)', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'set_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                {
                  setBasicFilter: {
                    filter: {
                      range: expect.objectContaining({ sheetId: 0 }),
                      criteria: undefined,
                    },
                  },
                },
              ],
            }),
          })
        );
      });

      it('should ignore stale inferred ranges when an explicit sheetId is provided', async () => {
        getContextManager().updateContext({
          spreadsheetId: 'test-sheet-id',
          sheetId: 99,
          range: 'StaleSheet!A1:Z100',
        });
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'set_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                {
                  setBasicFilter: {
                    filter: {
                      range: expect.objectContaining({ sheetId: 0 }),
                      criteria: undefined,
                    },
                  },
                },
              ],
            }),
          })
        );
      });

      it('should return a structured error instead of using stale inferred targets', async () => {
        getContextManager().updateContext({
          spreadsheetId: 'test-sheet-id',
          sheetId: 99,
          range: 'StaleSheet!A1:Z100',
        });

        const result = await handler.handle({
          action: 'set_basic_filter',
          spreadsheetId: 'test-sheet-id',
        } as any);

        expect(result.response.success).toBe(false);
        if (!result.response.success) {
          expect(result.response.error.code).toBe('INVALID_PARAMS');
          expect(result.response.error.message).toContain('explicit range or sheetId');
        }
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });

      it('should return error when incremental update has no existing filter', async () => {
        // get_basic_filter returns no filter (default mock has no basicFilter)
        const result = await handler.handle({
          action: 'set_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          columnIndex: 2,
          criteria: { 2: { hiddenValues: ['foo'] } },
        });

        expect(result.response.success).toBe(false);
        if (!result.response.success) {
          expect(result.response.error.code).toBe('FAILED_PRECONDITION');
        }
      });

      it('should update criteria for specific column (incremental mode)', async () => {
        // Mock get_basic_filter to return an existing filter
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0, title: 'Sheet1' },
                basicFilter: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 10,
                    startColumnIndex: 0,
                    endColumnIndex: 4,
                  },
                  criteria: {},
                },
              },
            ],
          },
        });
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'set_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          columnIndex: 2,
          criteria: { 2: { hiddenValues: ['foo', 'bar'] } },
        });

        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response).toHaveProperty('columnIndex', 2);
        }
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
      });
    });

    describe('clear_basic_filter', () => {
      it('should clear the basic filter from a sheet', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'clear_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'clear_basic_filter');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [{ clearBasicFilter: { sheetId: 0 } }],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for clear_basic_filter', async () => {
        const result = await handler.handle({
          action: 'clear_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('get_basic_filter', () => {
      it('should return filter when one exists on the sheet', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0, title: 'Sheet1' },
                basicFilter: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 20,
                    startColumnIndex: 0,
                    endColumnIndex: 5,
                  },
                  criteria: {},
                },
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'get_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'get_basic_filter');
        if (result.response.success) {
          expect(result.response.filter).toBeDefined();
        }

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should return empty success when no filter on the sheet', async () => {
        // Default mock has no basicFilter
        const result = await handler.handle({
          action: 'get_basic_filter',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response.filter).toBeUndefined();
        }
      });
    });
  });

  // ============================================================
  // Sort Operations
  // ============================================================

  describe('Sort Operations', () => {
    describe('sort_range', () => {
      it('should sort range by a single column ascending', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'sort_range',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:D10',
          sortSpecs: [{ columnIndex: 0, sortOrder: 'ASCENDING' }],
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'sort_range');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            spreadsheetId: 'test-sheet-id',
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  sortRange: expect.objectContaining({
                    sortSpecs: [
                      expect.objectContaining({
                        dimensionIndex: 0,
                        sortOrder: 'ASCENDING',
                      }),
                    ],
                  }),
                }),
              ],
            }),
          })
        );

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should sort range by multiple columns with different orders', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'sort_range',
          spreadsheetId: 'test-sheet-id',
          range: 'Sheet1!A1:D20',
          sortSpecs: [
            { columnIndex: 0, sortOrder: 'ASCENDING' },
            { columnIndex: 2, sortOrder: 'DESCENDING' },
          ],
        });

        expect(result.response.success).toBe(true);
        const call = mockApi.spreadsheets.batchUpdate.mock.calls[0][0];
        expect(call.requestBody.requests[0].sortRange.sortSpecs).toHaveLength(2);
        expect(call.requestBody.requests[0].sortRange.sortSpecs[1].sortOrder).toBe('DESCENDING');
      });

      it('should require an explicit range instead of borrowing stale context for sort_range', async () => {
        getContextManager().updateContext({
          spreadsheetId: 'test-sheet-id',
          range: 'StaleSheet!A1:D20',
        });

        const result = await handler.handle({
          action: 'sort_range',
          spreadsheetId: 'test-sheet-id',
          sortSpecs: [{ columnIndex: 0, sortOrder: 'ASCENDING' }],
        } as any);

        expect(result.response.success).toBe(false);
        if (!result.response.success) {
          expect(result.response.error.code).toBe('INVALID_PARAMS');
          expect(result.response.error.message).toContain('explicit range');
        }
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================================
  // Filter View Operations
  // ============================================================

  describe('Filter View Operations', () => {
    describe('create_filter_view', () => {
      it('should create a filter view on a range', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({
          data: {
            replies: [{ addFilterView: { filter: { filterViewId: 42 } } }],
          },
        });

        const result = await handler.handle({
          action: 'create_filter_view',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          title: 'High Value Customers',
          range: 'Sheet1!A1:D100',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'create_filter_view');
        if (result.response.success) {
          expect(result.response.filterViewId).toBe(42);
        }
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  addFilterView: expect.objectContaining({
                    filter: expect.objectContaining({
                      title: 'High Value Customers',
                    }),
                  }),
                }),
              ],
            }),
          })
        );

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should create a filter view using sheetId only', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({
          data: { replies: [{ addFilterView: { filter: { filterViewId: 7 } } }] },
        });

        const result = await handler.handle({
          action: 'create_filter_view',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
          title: 'My Filter',
        });

        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response.filterViewId).toBe(7);
        }
      });
    });

    describe('duplicate_filter_view', () => {
      it('should duplicate a filter view by ID', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({
          data: {
            replies: [{ duplicateFilterView: { filter: { filterViewId: 84 } } }],
          },
        });

        const result = await handler.handle({
          action: 'duplicate_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'duplicate_filter_view');
        if (result.response.success) {
          expect(result.response.filterViewId).toBe(84);
        }
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [{ duplicateFilterView: { filterId: 42 } }],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for duplicate_filter_view', async () => {
        const result = await handler.handle({
          action: 'duplicate_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('update_filter_view', () => {
      it('should update filter view title', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'update_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
          title: 'Updated Filter Name',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'update_filter_view');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  updateFilterView: expect.objectContaining({
                    filter: expect.objectContaining({
                      filterViewId: 42,
                      title: 'Updated Filter Name',
                    }),
                  }),
                }),
              ],
            }),
          })
        );

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for update_filter_view', async () => {
        const result = await handler.handle({
          action: 'update_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
          title: 'New Name',
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('delete_filter_view', () => {
      it('should delete a filter view by ID', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'delete_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'delete_filter_view');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [{ deleteFilterView: { filterId: 42 } }],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for delete_filter_view', async () => {
        const result = await handler.handle({
          action: 'delete_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('list_filter_views', () => {
      it('should list all filter views across all sheets', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0, title: 'Sheet1' },
                filterViews: [
                  {
                    filterViewId: 1,
                    title: 'View A',
                    range: { sheetId: 0, startRowIndex: 0, endRowIndex: 10 },
                  },
                  {
                    filterViewId: 2,
                    title: 'View B',
                    range: { sheetId: 0, startRowIndex: 0, endRowIndex: 20 },
                  },
                ],
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'list_filter_views',
          spreadsheetId: 'test-sheet-id',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'list_filter_views');
        if (result.response.success) {
          expect(result.response.filterViews).toHaveLength(2);
          expect(result.response.filterViews?.[0].filterViewId).toBe(1);
          expect(result.response.filterViews?.[0].title).toBe('View A');
        }

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should filter views by sheetId', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0, title: 'Sheet1' },
                filterViews: [{ filterViewId: 1, title: 'View A', range: { sheetId: 0 } }],
              },
              {
                properties: { sheetId: 1, title: 'Sheet2' },
                filterViews: [{ filterViewId: 2, title: 'View B', range: { sheetId: 1 } }],
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'list_filter_views',
          spreadsheetId: 'test-sheet-id',
          sheetId: 0,
        });

        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response.filterViews).toHaveLength(1);
          expect(result.response.filterViews?.[0].filterViewId).toBe(1);
        }
      });
    });

    describe('get_filter_view', () => {
      it('should get a specific filter view by ID', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0 },
                filterViews: [
                  {
                    filterViewId: 42,
                    title: 'My View',
                    range: { sheetId: 0, startRowIndex: 0, endRowIndex: 50 },
                    criteria: {},
                  },
                ],
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'get_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 42,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'get_filter_view');
        if (result.response.success) {
          expect(result.response.filterViews).toHaveLength(1);
          expect(result.response.filterViews?.[0].filterViewId).toBe(42);
          expect(result.response.filterViews?.[0].title).toBe('My View');
        }

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should return not-found error when filter view does not exist', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0 },
                filterViews: [],
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'get_filter_view',
          spreadsheetId: 'test-sheet-id',
          filterViewId: 999,
        });

        expect(result.response.success).toBe(false);
      });
    });
  });

  // ============================================================
  // Slicer Operations
  // ============================================================

  describe('Slicer Operations', () => {
    describe('create_slicer', () => {
      it('should create a slicer with anchor position', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({
          data: {
            replies: [{ addSlicer: { slicer: { slicerId: 5 } } }],
          },
        });

        const result = await handler.handle({
          action: 'create_slicer',
          spreadsheetId: 'test-sheet-id',
          title: 'Product Filter',
          dataRange: 'Sheet1!A1:D100',
          filterColumn: 0,
          position: {
            anchorCell: 'F1',
            width: 200,
            height: 150,
          },
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'create_slicer');
        if (result.response.success) {
          expect(result.response.slicerId).toBe(5);
        }
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  addSlicer: expect.objectContaining({
                    slicer: expect.objectContaining({
                      spec: expect.objectContaining({
                        title: 'Product Filter',
                        columnIndex: 0,
                      }),
                    }),
                  }),
                }),
              ],
            }),
          })
        );

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('update_slicer', () => {
      it('should update slicer title and filter column', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'update_slicer',
          spreadsheetId: 'test-sheet-id',
          slicerId: 5,
          title: 'Region Filter',
          filterColumn: 2,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'update_slicer');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              requests: [
                expect.objectContaining({
                  updateSlicerSpec: expect.objectContaining({
                    slicerId: 5,
                    spec: expect.objectContaining({ title: 'Region Filter', columnIndex: 2 }),
                  }),
                }),
              ],
            }),
          })
        );

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for update_slicer', async () => {
        const result = await handler.handle({
          action: 'update_slicer',
          spreadsheetId: 'test-sheet-id',
          slicerId: 5,
          title: 'New Title',
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('delete_slicer', () => {
      it('should delete a slicer by ID', async () => {
        mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: { replies: [{}] } });

        const result = await handler.handle({
          action: 'delete_slicer',
          spreadsheetId: 'test-sheet-id',
          slicerId: 5,
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'delete_slicer');
        expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
          spreadsheetId: 'test-sheet-id',
          requestBody: {
            requests: [{ deleteEmbeddedObject: { objectId: 5 } }],
          },
        });

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should respect dryRun for delete_slicer', async () => {
        const result = await handler.handle({
          action: 'delete_slicer',
          spreadsheetId: 'test-sheet-id',
          slicerId: 5,
          safety: { dryRun: true },
        });

        expect(result.response.success).toBe(true);
        expect(mockApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      });
    });

    describe('list_slicers', () => {
      it('should list all slicers across sheets', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0, title: 'Sheet1' },
                slicers: [
                  { slicerId: 3, spec: { title: 'Product Filter' } },
                  { slicerId: 4, spec: { title: 'Region Filter' } },
                ],
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'list_slicers',
          spreadsheetId: 'test-sheet-id',
        });

        expect(result.response.success).toBe(true);
        expect(result.response).toHaveProperty('action', 'list_slicers');
        if (result.response.success) {
          expect(result.response.slicers).toHaveLength(2);
          expect(result.response.slicers?.[0].slicerId).toBe(3);
          expect(result.response.slicers?.[0].title).toBe('Product Filter');
        }

        const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
        expect(parseResult.success).toBe(true);
      });

      it('should filter slicers by sheetId', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [
              {
                properties: { sheetId: 0, title: 'Sheet1' },
                slicers: [{ slicerId: 1, spec: { title: 'Slicer 1' } }],
              },
              {
                properties: { sheetId: 1, title: 'Sheet2' },
                slicers: [{ slicerId: 2, spec: { title: 'Slicer 2' } }],
              },
            ],
          },
        });

        const result = await handler.handle({
          action: 'list_slicers',
          spreadsheetId: 'test-sheet-id',
          sheetId: 1,
        });

        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response.slicers).toHaveLength(1);
          expect(result.response.slicers?.[0].slicerId).toBe(2);
        }
      });

      it('should return empty list when no slicers exist', async () => {
        mockApi.spreadsheets.get.mockResolvedValueOnce({
          data: {
            sheets: [{ properties: { sheetId: 0, title: 'Sheet1' }, slicers: [] }],
          },
        });

        const result = await handler.handle({
          action: 'list_slicers',
          spreadsheetId: 'test-sheet-id',
        });

        expect(result.response.success).toBe(true);
        if (result.response.success) {
          expect(result.response.slicers).toHaveLength(0);
        }
      });
    });
  });
});
