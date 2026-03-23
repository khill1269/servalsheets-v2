/**
 * ServalSheets - Format Handler Response Tests
 *
 * Stable response assertions for handler output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FormatHandler } from '../../src/handlers/format.js';
import type { HandlerContext } from '../../src/handlers/base.js';

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn(),
    batchUpdate: vi.fn(),
  },
});

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

describe('FormatHandler Responses', () => {
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;
  let handler: FormatHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new FormatHandler(mockContext, mockApi as any);

    mockApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      },
    });
    mockApi.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('returns an exact set_format response for a 2x2 range', async () => {
    const result = await handler.handle({
      action: 'set_format',
      spreadsheetId: 'test-id',
      range: { a1: 'Sheet1!A1:B2' },
      format: {
        backgroundColor: { red: 1, green: 0, blue: 0 },
        textFormat: { bold: true },
      },
    });

    expect(result.response).toEqual({
      success: true,
      action: 'set_format',
      cellsFormatted: 4,
      _meta: {
        costEstimate: {
          apiCalls: 1,
          cellsAffected: 4,
          estimatedLatencyMs: 500,
          quotaImpact: {
            current: 0,
            limit: 60,
            remaining: 59,
          },
        },
      },
    });
  });
});
