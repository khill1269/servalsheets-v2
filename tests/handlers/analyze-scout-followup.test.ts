import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockScout = vi.fn();
const mockScoreFromScout = vi.fn();
const mockGenerateQuestions = vi.fn();

vi.mock('../../src/analysis/scout.js', () => ({
  Scout: class {
    scout = mockScout;
  },
}));

vi.mock('../../src/analysis/confidence-scorer.js', () => ({
  ConfidenceScorer: class {
    scoreFromScout = mockScoreFromScout;
  },
}));

vi.mock('../../src/analysis/elicitation-engine.js', () => ({
  ElicitationEngine: class {
    generate = mockGenerateQuestions;
  },
}));

vi.mock('../../src/mcp/sampling.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/mcp/sampling.js')>(
    '../../src/mcp/sampling.js'
  );
  return {
    ...actual,
    generateAIInsight: vi.fn().mockResolvedValue('Scout summary'),
  };
});

vi.mock('../../src/utils/cache-adapter.js', () => ({
  getCacheAdapter: vi.fn().mockReturnValue({}),
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

import { handleScoutAction } from '../../src/handlers/analyze-actions/scout.js';

describe('handleScoutAction follow-up wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures elicitation answers into the understanding store when the client supports elicitation', async () => {
    const assessment = {
      spreadsheetId: 'sheet-123',
      overallScore: 42,
      overallLevel: 'moderate',
      dimensions: [
        {
          dimension: 'purpose',
          score: 30,
          level: 'low',
          evidence: [],
          gaps: ['Need the workbook purpose'],
          suggestedQuestions: ['What is this workbook used for?'],
        },
      ],
      shouldElicit: true,
      topGaps: [
        {
          dimension: 'purpose',
          gap: 'Need the workbook purpose',
          impactOnConfidence: 18,
          question: 'What is this workbook used for?',
        },
      ],
      dataTier: 2,
      assessedAt: Date.now(),
    };

    mockScout.mockResolvedValue({
      spreadsheetId: 'sheet-123',
      title: 'Ops Tracker',
      sheets: [{ sheetId: 1, title: 'Summary', rowCount: 25, columnCount: 5, estimatedCells: 125 }],
      indicators: {
        sizeCategory: 'small',
        estimatedCells: 125,
        complexityScore: 28,
        hasFormulas: false,
        hasVisualizations: false,
        hasDataQuality: false,
        multiSheet: false,
        recommendedDepth: 'sample',
      },
      detectedIntent: 'understand',
      intentConfidence: 0.76,
      intentReason: 'Single-sheet operational tracker',
      recommendations: ['Add business context'],
      nextActions: { recommended: null, alternatives: [] },
      retrievedAt: Date.now(),
      latencyMs: 15,
    });
    mockScoreFromScout.mockReturnValue(assessment);
    mockGenerateQuestions.mockReturnValue({
      shouldElicit: true,
      reason: 'Need more context',
      questions: [
        {
          id: 'q1',
          question: 'What is this workbook used for?',
          reason: 'Need the workbook purpose',
          type: 'free_text',
          priority: 'important',
        },
      ],
      confidenceSummary: {
        overall: 42,
        structure: 70,
        content: 55,
        relationships: 35,
        purpose: 30,
      },
      recommendedBatchSize: 1,
      projectedConfidenceAfterElicitation: 60,
    });

    const recordOperation = vi.fn();
    const initFromScout = vi.fn();
    const integrateUserAnswers = vi.fn();

    const result = await handleScoutAction(
      {
        spreadsheetId: 'sheet-123',
      },
      {
        sheetsApi: {} as any,
        samplingServer: {} as any,
        context: {
          sessionContext: {
            recordOperation,
            understandingStore: {
              initFromScout,
              integrateUserAnswers,
            },
          } as any,
          elicitationServer: {
            getClientCapabilities: vi.fn().mockReturnValue({ elicitation: { form: true } }),
            elicitInput: vi.fn().mockResolvedValue({
              action: 'accept',
              content: { answer: 'Track weekly operations for finance' },
            }),
          } as any,
        },
      }
    );

    expect(result.success).toBe(true);
    expect(initFromScout).toHaveBeenCalledWith(
      'sheet-123',
      'Ops Tracker',
      [{ sheetId: 1, title: 'Summary' }],
      assessment
    );
    expect(integrateUserAnswers).toHaveBeenCalledWith(
      'sheet-123',
      assessment,
      { freeformContext: 'Track weekly operations for finance' }
    );
    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'sheets_analyze',
        action: 'scout',
        spreadsheetId: 'sheet-123',
      })
    );
  });
});
