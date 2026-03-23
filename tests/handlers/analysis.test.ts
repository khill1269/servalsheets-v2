/**
 * ServalSheets v4 - Analysis Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyzeHandler } from '../../src/handlers/analyze.js';
import { SheetsAnalyzeOutputSchema } from '../../src/schemas/analyze.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4 } from 'googleapis';

const createMockSheetsApi = () => ({
  spreadsheets: {
    values: {
      get: vi.fn(),
    },
    get: vi.fn(),
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B3' }),
  } as any,
});

describe('AnalyzeHandler', () => {
  let handler: AnalyzeHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new AnalyzeHandler(mockContext, mockSheetsApi as unknown as sheets_v4.Sheets);

    mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
      data: {
        values: [
          ['A', 'B'],
          [1, 2],
          [3, 4],
        ],
      },
    });
    mockSheetsApi.spreadsheets.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 10, columnCount: 5 },
            },
            charts: [],
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('runs data quality check', async () => {
    const result = await handler.handle({
      action: 'analyze_quality',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:B3' },
    });

    const parsed = SheetsAnalyzeOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.response.success).toBe(true);
  });

  it('runs fast path data analysis', async () => {
    const result = await handler.handle({
      action: 'analyze_data',
      spreadsheetId: 'sheet-id',
      analysisTypes: ['summary'],
    });

    expect(result.response.success).toBe(true);
    if (result.response.success) {
      expect(result.response.action).toBe('analyze_data');
    }
  });

  it('returns error when API throws for nonexistent spreadsheetId on analyze_quality', async () => {
    mockSheetsApi.spreadsheets.values.get.mockRejectedValue(
      Object.assign(new Error('Spreadsheet not found'), { code: 404 })
    );

    const result = await handler.handle({
      action: 'analyze_quality',
      spreadsheetId: 'nonexistent-id',
      range: { a1: 'Sheet1!A1:B3' },
    });

    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error).toBeDefined();
      expect(result.response.error.code).toBeDefined();
    }
  });

  it('returns error when API throws on analyze_quality', async () => {
    mockSheetsApi.spreadsheets.values.get.mockRejectedValue(
      new Error('API unavailable')
    );

    const result = await handler.handle({
      action: 'analyze_quality',
      spreadsheetId: 'sheet-id',
      range: { a1: 'Sheet1!A1:B3' },
    });

    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error).toBeDefined();
    }
  });

  it('returns error when API throws on analyze_data', async () => {
    mockSheetsApi.spreadsheets.get.mockRejectedValue(
      new Error('Spreadsheet not found')
    );

    const result = await handler.handle({
      action: 'analyze_data',
      spreadsheetId: 'nonexistent-id',
      analysisTypes: ['summary'],
    });

    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.error).toBeDefined();
    }
  });
});
