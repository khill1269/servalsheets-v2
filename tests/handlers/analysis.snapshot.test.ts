/**
 * ServalSheets - Analysis Handler Snapshot Tests
 *
 * Snapshot tests for handler output stability.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyzeHandler } from '../../src/handlers/analyze.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { cacheManager } from '../../src/utils/cache-manager.js';
import type { sheets_v4 } from 'googleapis';

vi.mock('../../src/resources/analyze.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/resources/analyze.js')>(
    '../../src/resources/analyze.js'
  );
  return {
    ...actual,
    storeAnalysisResult: vi.fn().mockReturnValue('analysis-test'),
  };
});

const createMockSheetsApi = () => ({
  spreadsheets: {
    values: {
      get: vi.fn(),
    },
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-sheet-id',
        properties: { title: 'Test Sheet' },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 4, columnCount: 2 },
            },
            charts: [],
          },
        ],
      },
    }),
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B4' }),
  } as any,
});

describe('AnalyzeHandler Snapshots', () => {
  let handler: AnalyzeHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheManager.clear();
    mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new AnalyzeHandler(mockContext, mockSheetsApi as unknown as sheets_v4.Sheets);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches snapshot for analyze_data response', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    mockSheetsApi.spreadsheets.values.get.mockResolvedValue({
      data: {
        values: [
          ['Name', 'Score'],
          ['Alice', 5],
          ['Bob', 5],
          ['Cara', 5],
        ],
      },
    });

    const result = await handler.handle({
      action: 'analyze_data',
      spreadsheetId: 'test-sheet-id',
      analysisTypes: ['summary'],
    });

    expect(result.response).toMatchSnapshot();
  });
});
