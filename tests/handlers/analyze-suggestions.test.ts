/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
/**
 * ServalSheets - F4 Smart Suggestions Tests
 *
 * Tests for suggest_next_actions and auto_enhance actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalyzeHandler } from '../../src/handlers/analyze.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import { resetCapabilityCacheService } from '../../src/services/capability-cache.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock capability cache
vi.mock('../../src/services/capability-cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/capability-cache.js')>(
    '../../src/services/capability-cache.js'
  );
  return {
    ...actual,
    getCapabilitiesWithCache: vi.fn().mockResolvedValue({
      sampling: { supportedMethods: ['createMessage'] },
    }),
  };
});

// Mock session context (for rejection filtering + background analysis boosting)
vi.mock('../../src/services/session-context.js', () => ({
  getSessionContext: vi.fn().mockReturnValue({
    shouldAvoidSuggestion: vi.fn().mockResolvedValue(false),
    getRecentAnalysis: vi.fn().mockReturnValue(undefined),
  }),
}));

// Mock request context (for sendProgress)
vi.mock('../../src/utils/request-context.js', () => ({
  sendProgress: vi.fn(),
  getRequestContext: vi.fn().mockReturnValue({ timeoutMs: 30000 }),
}));

// Mock logger — must inline because vi.mock is hoisted
vi.mock('../../src/utils/logger.js', () => {
  const childLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnValue(childLogger),
    },
    createChildLogger: vi.fn().mockReturnValue(childLogger),
  };
});

// Mock cache adapter
vi.mock('../../src/utils/cache-adapter.js', () => ({
  getCacheAdapter: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    clear: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock data for Scout results
// ---------------------------------------------------------------------------

const mockScoutResult = {
  spreadsheetId: 'test-spreadsheet-id',
  title: 'Test Spreadsheet',
  sheets: [
    {
      sheetId: 0,
      title: 'Sheet1',
      rowCount: 100,
      columnCount: 5,
      estimatedCells: 500,
    },
  ],
  indicators: {
    sizeCategory: 'small',
    estimatedCells: 500,
    complexityScore: 25,
    hasFormulas: false,
    hasVisualizations: false,
    hasDataQuality: false,
    multiSheet: false,
    recommendedDepth: 'sample',
  },
  columnTypes: [
    { index: 0, header: 'Name', detectedType: 'text', nullable: false, uniqueRatio: 0.95 },
    { index: 1, header: 'Revenue', detectedType: 'number', nullable: false },
    { index: 2, header: 'Cost', detectedType: 'number', nullable: false },
    { index: 3, header: 'Date', detectedType: 'date', nullable: false },
    { index: 4, header: 'Status', detectedType: 'text', nullable: true, uniqueRatio: 0.15 },
  ],
  detectedIntent: 'auto',
  intentConfidence: 0.7,
  intentReason: 'Auto-detected',
  recommendations: [],
  nextActions: {
    recommended: null,
    alternatives: [],
  },
  retrievedAt: 1704067200000,
  latencyMs: 150,
};

// ---------------------------------------------------------------------------
// Mock Scout module — use class syntax for new() compatibility
// ---------------------------------------------------------------------------

vi.mock('../../src/analysis/scout.js', () => {
  return {
    Scout: class MockScout {
      scout = vi.fn().mockResolvedValue(mockScoutResult);
    },
    type: {} as any,
  };
});

// Mock action generator — use class syntax for new() compatibility
vi.mock('../../src/analysis/action-generator.js', () => ({
  ActionGenerator: class MockActionGenerator {
    generate = vi.fn().mockResolvedValue({ actions: [], summary: {} });
  },
}));

// ---------------------------------------------------------------------------
// Do NOT mock suggestion-engine.js — let it use the real implementation
// with the mocked Scout and ActionGenerator dependencies.
// The handler does `await import('../analysis/suggestion-engine.js')` which
// will get the real SuggestionEngine, but it creates Scout and ActionGenerator
// which are mocked above.
// ---------------------------------------------------------------------------

// Sheets API mock
const createMockSheetsApi = () => ({
  spreadsheets: {
    values: { get: vi.fn() },
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        properties: { title: 'Test Spreadsheet' },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: 'Sheet1',
              gridProperties: { rowCount: 100, columnCount: 5 },
            },
          },
        ],
      },
    }),
  },
});

// Handler context mock
const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {
    compile: vi.fn(),
    execute: vi.fn(),
    executeAll: vi.fn(),
  } as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({
      a1Notation: 'Sheet1!A1:E100',
      sheetId: 0,
      sheetName: 'Sheet1',
      gridRange: { sheetId: 0 },
      resolution: { method: 'a1_direct', confidence: 1.0, path: '' },
    }),
  } as any,
  server: {
    createMessage: vi.fn(),
    getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
  } as any,
  requestId: 'test-request-id',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('F4: Smart Suggestions', () => {
  let handler: AnalyzeHandler;
  let mockApi: ReturnType<typeof createMockSheetsApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockSheetsApi();
    mockContext = createMockContext();
    handler = new AnalyzeHandler(mockContext, mockApi as any);
    resetCapabilityCacheService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('suggest_next_actions', () => {
    it('returns suggestions for a spreadsheet with data', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
        },
      } as any);

      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('suggest_next_actions');
      expect(Array.isArray(result.response.suggestions)).toBe(true);
      expect(result.response.suggestions.length).toBeGreaterThan(0);
    });

    it('respects maxSuggestions parameter', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
          maxSuggestions: 2,
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response.suggestions.length).toBeLessThanOrEqual(2);
    });

    it('filters by category', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
          categories: ['formulas'],
        },
      } as any);

      expect(result.response.success).toBe(true);
      for (const suggestion of result.response.suggestions) {
        expect(suggestion.category).toBe('formulas');
      }
    });

    it('each suggestion has executable action params', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
        },
      } as any);

      expect(result.response.success).toBe(true);
      for (const suggestion of result.response.suggestions) {
        expect(typeof suggestion.id).toBe('string');
        expect(typeof suggestion.title).toBe('string');
        expect(typeof suggestion.description).toBe('string');
        expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
        expect(suggestion.confidence).toBeLessThanOrEqual(1);
        expect(typeof suggestion.category).toBe('string');
        expect(typeof suggestion.impact).toBe('string');
        expect(typeof suggestion.action.tool).toBe('string');
        expect(typeof suggestion.action.action).toBe('string');
        expect(suggestion.action.params).not.toBeNull();
      }
    });

    it('includes scout summary in response', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response.scoutSummary.title).toBe('Test Spreadsheet');
      expect(result.response.scoutSummary.sheetCount).toBe(1);
    });

    it('detects revenue + cost → profit margin suggestion', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
          categories: ['formulas'],
        },
      } as any);

      expect(result.response.success).toBe(true);
      const profitSuggestion = result.response.suggestions.find(
        (s: any) => s.id === 'add_profit_margin'
      );
      expect(profitSuggestion).toBeDefined();
      expect(profitSuggestion.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects dropdown candidate from low-unique-ratio text column', async () => {
      const result = await handler.handle({
        request: {
          action: 'suggest_next_actions',
          spreadsheetId: 'test-spreadsheet-id',
          categories: ['data_quality'],
        },
      } as any);

      expect(result.response.success).toBe(true);
      const dropdownSuggestion = result.response.suggestions.find(
        (s: any) => s.id === 'add_data_validation'
      );
      expect(dropdownSuggestion).toBeDefined();
    });
  });

  describe('discover_action', () => {
    it('disambiguates Drive spreadsheet listing from sheet-tab listing', async () => {
      const driveResult = await handler.handle({
        request: {
          action: 'discover_action',
          query: 'list spreadsheets in drive',
        },
      } as any);

      expect(driveResult.response.success).toBe(true);
      expect(driveResult.response.action).toBe('discover_action');
      expect(driveResult.response.matches.length).toBeGreaterThan(0);
      expect(driveResult.response.matches[0]).toMatchObject({
        tool: 'sheets_core',
        action: 'list',
      });

      const tabsResult = await handler.handle({
        request: {
          action: 'discover_action',
          query: 'list tabs in this spreadsheet',
        },
      } as any);

      expect(tabsResult.response.success).toBe(true);
      expect(tabsResult.response.matches.length).toBeGreaterThan(0);
      expect(tabsResult.response.matches[0]).toMatchObject({
        tool: 'sheets_core',
        action: 'list_sheets',
      });
    });

    it('returns guidance fields for matches', async () => {
      const result = await handler.handle({
        request: {
          action: 'discover_action',
          query: 'append rows to the bottom',
          maxResults: 3,
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response.matchCount).toBeGreaterThan(0);
      expect(result.response.matches[0]).toHaveProperty('whenToUse');
      expect(result.response.matches[0]).toHaveProperty('whenNotToUse');
      expect(result.response.matches[0]).toHaveProperty('commonMistake');
    });

    it('returns clarification guidance for ambiguous queries', async () => {
      const result = await handler.handle({
        request: {
          action: 'discover_action',
          query: 'list',
          maxResults: 5,
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response.needsClarification).toBe(true);
      expect(result.response.clarificationReason).toBe('underspecified_query');
      expect(result.response.clarificationQuestion).toBeDefined();
      expect(Array.isArray(result.response.clarificationOptions)).toBe(true);
      expect(result.response.clarificationOptions.length).toBeGreaterThan(0);
    });
  });

  describe('auto_enhance', () => {
    it('returns preview of enhancements in preview mode', async () => {
      const result = await handler.handle({
        request: {
          action: 'auto_enhance',
          spreadsheetId: 'test-spreadsheet-id',
          mode: 'preview',
        },
      } as any);

      expect(result.response).toBeDefined();
      expect(result.response.success).toBe(true);
      expect(result.response.action).toBe('auto_enhance');
      expect(result.response.mode).toBe('preview');
      expect(Array.isArray(result.response.enhancements)).toBe(true);
      expect(result.response.enhanceSummary.applied).toBe(0);
    });

    it('applies enhancements in apply mode', async () => {
      const result = await handler.handle({
        request: {
          action: 'auto_enhance',
          spreadsheetId: 'test-spreadsheet-id',
          mode: 'apply',
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response.mode).toBe('apply');
      expect(result.response.enhanceSummary.applied).toBeGreaterThanOrEqual(0);
    });

    it('defaults to formatting + structure categories', async () => {
      const result = await handler.handle({
        request: {
          action: 'auto_enhance',
          spreadsheetId: 'test-spreadsheet-id',
          mode: 'preview',
        },
      } as any);

      expect(result.response.success).toBe(true);
      for (const enhancement of result.response.enhancements) {
        expect(['formatting', 'structure']).toContain(
          enhancement.suggestion.category
        );
      }
    });

    it('respects maxEnhancements parameter', async () => {
      const result = await handler.handle({
        request: {
          action: 'auto_enhance',
          spreadsheetId: 'test-spreadsheet-id',
          mode: 'preview',
          maxEnhancements: 1,
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(result.response.enhancements.length).toBeLessThanOrEqual(1);
    });

    it('handles errors gracefully', async () => {
      // Temporarily replace the Scout mock's quickScan in the module
      const scoutModule = await import('../../src/analysis/scout.js');
      const OrigScout = scoutModule.Scout;
      // @ts-expect-error — replacing module export for test
      scoutModule.Scout = class FailingScout {
        scout = vi.fn().mockRejectedValue(new Error('API unavailable'));
      };

      const result = await handler.handle({
        request: {
          action: 'auto_enhance',
          spreadsheetId: 'test-spreadsheet-id',
          mode: 'preview',
        },
      } as any);

      // Restore
      // @ts-expect-error — restoring original
      scoutModule.Scout = OrigScout;

      expect(result.response.success).toBe(false);
      expect(result.response.error.code).toBe('INTERNAL_ERROR');
      expect(result.response.error.retryable).toBe(true);
    });
  });
});
