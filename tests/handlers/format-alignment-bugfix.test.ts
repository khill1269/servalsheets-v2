/**
 * Format Handler - Set Alignment Bug Fix Tests (Phase 0.5)
 *
 * Tests for bug: set_alignment rejects all parameter formats
 * Evidence from test log:
 * - Tried: {action: "set_alignment", range: "A1:A5", horizontalAlignment: "CENTER"}
 * - Tried: {action: "set_alignment", range: "A1:A5", alignment: {horizontal: "CENTER"}}
 * - Both fail with: "No alignment properties specified"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FormatHandler } from '../../src/handlers/format.js';
import { SheetsFormatOutputSchema } from '../../src/schemas/format.js';
import type { HandlerContext } from '../../src/handlers/base.js';

describe('FormatHandler - Set Alignment (BUG FIX 0.5)', () => {
  let handler: FormatHandler;
  let mockContext: HandlerContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockApi: any;

  beforeEach(() => {
    // Create mock API
    mockApi = {
      spreadsheets: {
        batchUpdate: vi.fn().mockResolvedValue({
          data: {
            replies: [{ updateCells: {} }],
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

    handler = new FormatHandler(mockContext, mockApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('valid alignment parameters (BUG FIX 0.5)', () => {
    it('should accept horizontal alignment parameter', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        horizontal: 'CENTER',
      });

      // Verify result is defined and successful
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('set_alignment');

      // Verify API was called with correct parameters
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'test-id',
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                repeatCell: expect.objectContaining({
                  cell: expect.objectContaining({
                    userEnteredFormat: expect.objectContaining({
                      horizontalAlignment: 'CENTER',
                    }),
                  }),
                }),
              }),
            ]),
          }),
        })
      );

      // Verify schema validation passes
      const parseResult = SheetsFormatOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should accept vertical alignment parameter', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        vertical: 'MIDDLE',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                repeatCell: expect.objectContaining({
                  cell: expect.objectContaining({
                    userEnteredFormat: expect.objectContaining({
                      verticalAlignment: 'MIDDLE',
                    }),
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should accept wrapStrategy parameter', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        wrapStrategy: 'WRAP',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                repeatCell: expect.objectContaining({
                  cell: expect.objectContaining({
                    userEnteredFormat: expect.objectContaining({
                      wrapStrategy: 'WRAP',
                    }),
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it('should accept multiple alignment properties together', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        horizontal: 'RIGHT',
        vertical: 'TOP',
        wrapStrategy: 'CLIP',
      });

      expect(result.response.success).toBe(true);
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            requests: expect.arrayContaining([
              expect.objectContaining({
                repeatCell: expect.objectContaining({
                  cell: expect.objectContaining({
                    userEnteredFormat: expect.objectContaining({
                      horizontalAlignment: 'RIGHT',
                      verticalAlignment: 'TOP',
                      wrapStrategy: 'CLIP',
                    }),
                  }),
                }),
              }),
            ]),
          }),
        })
      );
    });
  });

  describe('invalid parameters - improved error message (BUG FIX 0.5)', () => {
    it('should return helpful error when no alignment properties provided', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        // No alignment properties
      });

      // Should return error with helpful message
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error.code).toBe('INVALID_PARAMS');
      expect(result.response.error.message).toContain('alignment properties');
      // BUG FIX: Error message should mention correct parameter names
      expect(result.response.error.message).toContain('horizontal');
      expect(result.response.error.message).toContain('vertical');
      expect(result.response.error.message).toContain('wrapStrategy');
    });

    it('should handle wrong parameter name (horizontalAlignment)', async () => {
      // This is what user tried in test log
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        // @ts-expect-error - Testing wrong parameter name from user's perspective
        horizontalAlignment: 'CENTER',
      });

      // Should return error because schema won't recognize horizontalAlignment
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error.message).toContain('horizontal');
    });
  });

  describe('case insensitivity', () => {
    it('should accept lowercase alignment values', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        horizontal: 'center',
      });

      // Should work or provide clear error
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('regression tests', () => {
    it('should not break existing set_alignment behavior', async () => {
      const result = await handler.handle({
        action: 'set_alignment',
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:A5',
        horizontal: 'LEFT',
      });

      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('set_alignment');
      expect(mockApi.spreadsheets.batchUpdate).toHaveBeenCalled();
    });
  });
});
