import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleComprehensiveAction } from '../../src/handlers/analyze-actions/comprehensive.js';
import type { HandlerContext } from '../../src/handlers/base.js';

vi.mock('../../src/analysis/comprehensive.js', () => ({
  ComprehensiveAnalyzer: vi.fn(),
}));

vi.mock('../../src/handlers/analyze-actions/scout.js', () => ({
  handleScoutAction: vi.fn(),
}));

vi.mock('../../src/utils/heap-watchdog.js', () => ({
  isHeapCritical: vi.fn(),
}));

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestAbortSignal: vi.fn().mockReturnValue(undefined),
  sendProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createContext(): HandlerContext {
  return {
    googleClient: {} as any,
    batchCompiler: {
      compile: vi.fn(),
      execute: vi.fn(),
      executeAll: vi.fn(),
    } as any,
    rangeResolver: {
      resolve: vi.fn(),
    } as any,
    requestId: 'test-request',
  } as HandlerContext;
}

function createScoutFallbackResponse() {
  return {
    success: true as const,
    action: 'scout',
    scout: {
      spreadsheet: {
        id: 'sheet-123',
        title: 'Fallback Sheet',
      },
      sheets: [],
      totals: {
        sheets: 1,
        rows: 10,
        columns: 5,
        estimatedCells: 50,
        namedRanges: 0,
      },
      quickIndicators: {
        emptySheets: 0,
        largeSheets: 0,
        potentialIssues: ['Potential issue A', 'Potential issue B'],
      },
      suggestedAnalyses: [
        {
          type: 'quality' as const,
          priority: 'high' as const,
          reason: 'Assess data quality',
          estimatedDuration: '2-5s',
        },
      ],
      detectedIntent: {
        likely: 'understand' as const,
        confidence: 80,
        signals: ['sheet looks normal'],
      },
    },
    message: 'Scout complete',
  };
}

describe('handleComprehensiveAction', () => {
  let MockComprehensiveAnalyzer: ReturnType<typeof vi.fn>;
  let mockHandleScoutAction: ReturnType<typeof vi.fn>;
  let mockIsHeapCritical: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const comprehensiveModule = await import('../../src/analysis/comprehensive.js');
    MockComprehensiveAnalyzer = vi.mocked(comprehensiveModule.ComprehensiveAnalyzer);

    const scoutModule = await import('../../src/handlers/analyze-actions/scout.js');
    mockHandleScoutAction = vi.mocked(scoutModule.handleScoutAction);
    mockHandleScoutAction.mockResolvedValue(createScoutFallbackResponse());

    const heapModule = await import('../../src/utils/heap-watchdog.js');
    mockIsHeapCritical = vi.mocked(heapModule.isHeapCritical);
    mockIsHeapCritical.mockReturnValue(false);
  });

  it('degrades to scout when heap is already critical', async () => {
    mockIsHeapCritical.mockReturnValue(true);

    const result = await handleComprehensiveAction(
      {
        action: 'comprehensive',
        spreadsheetId: 'sheet-123',
      } as any,
      {
        sheetsApi: {
          spreadsheets: {
            get: vi.fn(),
          },
        } as any,
        context: createContext(),
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.action).toBe('comprehensive');
      expect(result.summary).toContain('degraded to a scout scan');
      expect(result.scout?.spreadsheet.title).toBe('Fallback Sheet');
      expect(result.message).toContain('degraded to scout');
    }
    expect(MockComprehensiveAnalyzer).not.toHaveBeenCalled();
    expect(mockHandleScoutAction).toHaveBeenCalledOnce();
  });

  it('degrades to scout when comprehensive analysis hits memory pressure mid-run', async () => {
    MockComprehensiveAnalyzer.mockImplementation(
      function MockAnalyzer() {
        return {
          analyze: vi.fn().mockRejectedValue(new Error('JavaScript heap out of memory')),
        };
      } as any
    );

    const result = await handleComprehensiveAction(
      {
        action: 'comprehensive',
        spreadsheetId: 'sheet-123',
      } as any,
      {
        sheetsApi: {
          spreadsheets: {
            get: vi.fn().mockResolvedValue({
              data: {
                sheets: [
                  {
                    properties: {
                      sheetId: 0,
                      title: 'Sheet1',
                      gridProperties: { rowCount: 100, columnCount: 10 },
                    },
                  },
                ],
              },
            }),
          },
        } as any,
        context: createContext(),
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.action).toBe('comprehensive');
      expect(result.message).toContain('heap out of memory');
      expect(result.scout?.quickIndicators?.potentialIssues).toContain('Potential issue A');
    }
    expect(mockHandleScoutAction).toHaveBeenCalledOnce();
  });
});
