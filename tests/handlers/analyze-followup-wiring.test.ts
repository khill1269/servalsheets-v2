import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../src/handlers/base.js';

const mocks = vi.hoisted(() => ({
  handleComprehensiveAction: vi.fn(),
  scoreFromComprehensive: vi.fn(),
  buildSemanticIndex: vi.fn(),
}));

vi.mock('../../src/handlers/analyze-actions/comprehensive.js', () => ({
  handleComprehensiveAction: mocks.handleComprehensiveAction,
}));

vi.mock('../../src/analysis/confidence-scorer.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/analysis/confidence-scorer.js')>(
    '../../src/analysis/confidence-scorer.js'
  );
  return {
    ...actual,
    ConfidenceScorer: class {
      scoreFromComprehensive = mocks.scoreFromComprehensive;
    },
  };
});

vi.mock('../../src/analysis/workbook-semantics.js', () => ({
  buildSemanticIndex: mocks.buildSemanticIndex,
}));

vi.mock('../../src/utils/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

import { AnalyzeHandler } from '../../src/handlers/analyze.js';

describe('AnalyzeHandler follow-up wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists a semantic index after successful comprehensive analysis', async () => {
    const updateFromComprehensive = vi.fn();
    const updateSemanticIndex = vi.fn();

    mocks.handleComprehensiveAction.mockResolvedValue({
      success: true,
      action: 'comprehensive',
      summary: 'Comprehensive analysis complete',
      message: 'Comprehensive analysis complete',
    });
    mocks.scoreFromComprehensive.mockReturnValue({
      spreadsheetId: 'sheet-123',
      overallScore: 82,
      overallLevel: 'high',
      dimensions: [],
      topGaps: [],
      dataTier: 4,
      assessedAt: Date.now(),
      shouldElicit: false,
    });
    mocks.buildSemanticIndex.mockReturnValue({
      workbookType: 'budget',
      workbookTypeConfidence: 89,
      entities: [],
      relationships: [],
      temporalPattern: 'monthly',
      keyColumns: [],
      dataRegions: [],
      suggestedOperations: ['aggregate'],
    });

    const context: HandlerContext = {
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
      sessionContext: {
        understandingStore: {
          updateFromComprehensive,
          updateSemanticIndex,
        },
      } as any,
    };

    const handler = new AnalyzeHandler(
      context,
      {
        spreadsheets: {
          get: vi.fn(),
          values: { get: vi.fn() },
        },
      } as any
    );

    const result = await handler.handle({
      action: 'comprehensive',
      spreadsheetId: 'sheet-123',
    } as any);

    expect(result.response.success).toBe(true);
    expect(updateFromComprehensive).toHaveBeenCalledWith(
      'sheet-123',
      expect.objectContaining({
        overallScore: 82,
        overallLevel: 'high',
      }),
      { detectedDomain: undefined }
    );
    expect(mocks.buildSemanticIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        action: 'comprehensive',
      })
    );
    expect(updateSemanticIndex).toHaveBeenCalledWith(
      'sheet-123',
      expect.objectContaining({
        workbookType: 'budget',
        workbookTypeConfidence: 89,
      })
    );
  });
});
