/**
 * Dimensions Handler - Delete Action Count Parameter Bug Fix Tests (Phase 0.6)
 *
 * Tests for bug: delete action count parameter not converted to endIndex
 * Evidence from test log:
 * - Input: {action: "delete", sheetId: 0, dimension: "ROWS", startIndex: 6, count: 1}
 * - Error: "expected number, received NaN" for endIndex
 * - Bug: count param not being converted to endIndex internally
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DimensionsHandler } from '../../src/handlers/dimensions.js';
import { SheetsDimensionsOutputSchema } from '../../src/schemas/dimensions.js';
import type { HandlerContext } from '../../src/handlers/base.js';

describe('DimensionsHandler - Delete with Count Parameter (BUG FIX 0.6)', () => {
  let handler: DimensionsHandler;
  let mockContext: HandlerContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockApi: any;

  beforeEach(() => {
    // Create mock API
    mockApi = {
      spreadsheets: {
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            replies: [{ deleteDimension: {} }],
          },
        }),
        get: vi.fn().mockResolvedValue({
          data: {
            spreadsheetId: 'test-id',
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
        }),
      },
    };

    // Create mock context
    mockContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock API type
      sheetsApi: mockApi as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock client type
      googleClient: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock auth type
      authClient: { credentials: { access_token: 'test-token' } } as any,
      authService: {
        isAuthenticated: vi.fn().mockReturnValue(true),
        getClient: vi.fn().mockResolvedValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock service type
      } as any,
      rangeResolver: {
        resolve: vi.fn().mockResolvedValue({
          a1Notation: 'Sheet1!A1:A5',
          sheetId: 0,
          sheetName: 'Sheet1',
          gridRange: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: '',
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock resolver type
      } as any,
    };

    handler = new DimensionsHandler(mockContext, mockApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('count parameter conversion (BUG FIX 0.6)', () => {
    it('should accept count parameter and convert to endIndex for delete rows', async () => {
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 6,
        count: 1, // Should be converted to endIndex: 7
      });

      // Verify result is successful
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('delete');

      // Verify API was called with correct endIndex (startIndex + count = 6 + 1 = 7)
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                deleteDimension: expect.objectContaining({
                  range: expect.objectContaining({
                    sheetId: 0,
                    dimension: 'ROWS',
                    startIndex: 6,
                    endIndex: 7, // startIndex + count
                  }),
                }),
              }),
            ]),
          }),
        })
      );

      // Verify schema validation passes
      const parseResult = SheetsDimensionsOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should accept count parameter for delete multiple rows', async () => {
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 10,
        count: 5, // Should be converted to endIndex: 15
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                deleteDimension: expect.objectContaining({
                  range: expect.objectContaining({
                    startIndex: 10,
                    endIndex: 15, // startIndex + count
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should accept count parameter for delete columns', async () => {
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'COLUMNS',
        startIndex: 2,
        count: 3, // Should be converted to endIndex: 5
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                deleteDimension: expect.objectContaining({
                  range: expect.objectContaining({
                    dimension: 'COLUMNS',
                    startIndex: 2,
                    endIndex: 5, // startIndex + count
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should still accept endIndex parameter directly (backward compatibility)', async () => {
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 6,
        endIndex: 7, // Explicit endIndex, no count
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                deleteDimension: expect.objectContaining({
                  range: expect.objectContaining({
                    startIndex: 6,
                    endIndex: 7,
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should prioritize endIndex if both count and endIndex provided', async () => {
      // Edge case: if user provides both, endIndex takes precedence
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 6,
        count: 999, // Should be ignored
        endIndex: 8, // Should be used
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                deleteDimension: expect.objectContaining({
                  range: expect.objectContaining({
                    startIndex: 6,
                    endIndex: 8, // endIndex wins
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should handle missing endIndex gracefully', async () => {
      // Note: Handler bypasses schema validation, so this tests runtime behavior
      // In production, MCP server would validate through schema first
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 6,
        // No count or endIndex - will result in NaN
      });

      // Handler will attempt to calculate count = endIndex - startIndex
      // With endIndex undefined, this becomes NaN, which may succeed or fail
      // The important thing is it doesn't crash
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('regression tests', () => {
    it('should not break existing delete behavior with endIndex', async () => {
      const result = await handler.handle({
        action: 'delete',
        spreadsheetId: 'test-id',
        sheetId: 0,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 1,
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('delete');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });
  });
});
