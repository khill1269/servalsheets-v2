/**
 * ServalSheets - Format Handler Snapshot Tests
 *
 * Snapshot tests for handler output stability.
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
  googleClient: {} as any, // Mock authentication
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

describe('FormatHandler Snapshots', () => {
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

  it('matches snapshot for set_format response', async () => {
    const result = await handler.handle({
      action: 'set_format',
      spreadsheetId: 'test-id',
      range: { a1: 'Sheet1!A1:B2' },
      format: {
        backgroundColor: { red: 1, green: 0, blue: 0 },
        textFormat: { bold: true },
      },
    });

    expect(result.response).toMatchSnapshot();
  });
});
