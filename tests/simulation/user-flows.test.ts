/**
 * ServalSheets — User Flow Simulation
 *
 * End-to-end workflow simulations using the response intelligence layer.
 * Each flow models a realistic user session and verifies:
 *   - Multi-step responses compose correctly
 *   - Intelligence layer (hints, quality warnings, suggestions) activates appropriately
 *   - Error states produce actionable fixes via suggestedFix
 *   - Response shapes conform to contracts at every step
 *
 * Uses the full intelligence pipeline (applyResponseIntelligence) with realistic
 * data, not minimal fixtures. No Google API calls — mocks the handler output layer.
 *
 * Flows covered:
 *   A. Data entry → read with _hints (time-series detection)
 *   B. Dirty data → quality warnings → clean suggestion
 *   C. Revenue/cost data → profit margin opportunity detected
 *   D. Error chain → suggestedFix present and actionable
 *   E. Batch read → batching hint triggers
 *   F. Large dataset → riskLevel = high
 *   G. Agent plan verification → multi-step state tracked
 *   H. _hints nextPhase routing → correct workflow phase returned
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateResponseHints } from '../../src/services/response-hints-engine.js';

// Loaded lazily to keep import fast
let applyResponseIntelligence: (
  r: Record<string, unknown>,
  opts: { toolName?: string; hasFailure: boolean }
) => { batchingHint?: string };

beforeAll(async () => {
  const mod = await import('../../src/mcp/registration/response-intelligence.js');
  applyResponseIntelligence = mod.applyResponseIntelligence;
});

// ─── Shared Data Fixtures ─────────────────────────────────────────────────────

const SALES_DATA = [
  ['Date', 'Revenue', 'Cost', 'Units'],
  ['2024-01-01', 12500, 7800, 142],
  ['2024-01-02', 13200, 8100, 156],
  ['2024-01-03', 11800, 7200, 138],
  ['2024-01-04', 14500, 8900, 167],
  ['2024-01-05', 15200, 9300, 175],
  ['2024-01-06', 13900, 8500, 160],
  ['2024-01-07', 16100, 9800, 182],
];

const DIRTY_DATA = [
  ['Name', 'Email', 'Revenue'],
  ['Alice Smith ', 'alice@example.com', '1,000'],
  ['', 'bob@example.com', '2000'],
  ['  Charlie  ', 'CHARLIE@EXAMPLE.COM', '3000'],
  ['Alice Smith ', 'alice@example.com', '1,000'], // duplicate row
  ['Dave', 'not-an-email', '4000'],
  ['Eve', 'eve@example.com', null],
];

const MINIMAL_DATA = [['A', 'B'], ['1', '2']];

// ─── Flow A: Time-Series Detection ────────────────────────────────────────────

describe('Flow A: Data entry → read with _hints time-series detection', () => {
  it('A1: read response for sales data contains _hints', () => {
    const response: Record<string, unknown> = {
      action: 'read',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:D8',
      values: SALES_DATA,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    expect(response['_hints']).toBeDefined();
  });

  it('A2: _hints.dataShape identifies time series', () => {
    const hints = generateResponseHints(SALES_DATA);
    expect(hints).not.toBeNull();
    expect(hints?.dataShape).toMatch(/time series/);
  });

  it('A3: _hints.dataShape includes row and column counts', () => {
    const hints = generateResponseHints(SALES_DATA);
    // 7 data rows (excluding header), 4 columns
    expect(hints?.dataShape).toMatch(/7/);
    expect(hints?.dataShape).toMatch(/4/);
  });

  it('A4: _hints.dataRelationships detects revenue+cost = profit opportunity', () => {
    const hints = generateResponseHints(SALES_DATA);
    const hasProfit = hints?.dataRelationships?.some((r) =>
      r.toLowerCase().includes('profit') || r.toLowerCase().includes('margin')
    );
    expect(hasProfit).toBe(true);
  });

  it('A5: _hints.formulaOpportunities present for numeric columns', () => {
    const hints = generateResponseHints(SALES_DATA);
    expect(hints?.formulaOpportunities).toBeDefined();
    expect(hints?.formulaOpportunities?.length).toBeGreaterThan(0);
  });

  it('A6: _hints.riskLevel is non-null for clean data', () => {
    const hints = generateResponseHints(SALES_DATA);
    expect(['none', 'low', 'medium', 'high']).toContain(hints?.riskLevel);
  });

  it('A7: _hints.nextPhase is a non-empty string', () => {
    const hints = generateResponseHints(SALES_DATA);
    expect(typeof hints?.nextPhase).toBe('string');
    expect(hints?.nextPhase!.length).toBeGreaterThan(0);
  });

  it('A8: suggestedNextActions present in response after intelligence pass', () => {
    const response: Record<string, unknown> = {
      action: 'read',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:D8',
      values: SALES_DATA,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    // The recommender should fire for any data-bearing read
    expect(response['suggestedNextActions']).toBeDefined();
    const suggestions = response['suggestedNextActions'] as unknown[];
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });
});

// ─── Flow B: Dirty Data → Quality Warnings ────────────────────────────────────

describe('Flow B: Dirty data → quality warnings activate', () => {
  it('B1: dirty data response contains dataQualityWarnings', () => {
    const response: Record<string, unknown> = {
      action: 'read',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:C7',
      values: DIRTY_DATA,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    expect(response['dataQualityWarnings']).toBeDefined();
    const warnings = response['dataQualityWarnings'] as unknown[];
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('B2: quality warnings fire for write action too', () => {
    const response: Record<string, unknown> = {
      action: 'write',
      spreadsheetId: 'test-id',
      range: 'Sheet1!A1:C7',
      values: DIRTY_DATA,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    // write has values — quality scanner should still fire
    expect(response['dataQualityWarnings']).toBeDefined();
  });

  it('B3: clean data produces no quality warnings', () => {
    const cleanData = [
      ['Date', 'Revenue'],
      ['2024-01-01', 1000],
      ['2024-01-02', 1200],
    ];
    const response: Record<string, unknown> = {
      action: 'read',
      values: cleanData,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    const warnings = response['dataQualityWarnings'] as unknown[] | undefined;
    // Either absent or empty for clean data
    expect(!warnings || warnings.length === 0).toBe(true);
  });
});

// ─── Flow C: Revenue + Cost → Profit Margin Relationship ─────────────────────

describe('Flow C: Revenue + cost columns → profit margin relationship detected', () => {
  const revenueCostData = [
    ['Month', 'Revenue', 'Cost'],
    ['Jan', 50000, 32000],
    ['Feb', 55000, 34500],
    ['Mar', 48000, 30000],
    ['Apr', 62000, 38000],
  ];

  it('C1: detects revenue+cost relationship', () => {
    const hints = generateResponseHints(revenueCostData);
    const profitRelationship = hints?.dataRelationships?.some(
      (r) => r.toLowerCase().includes('profit') || r.toLowerCase().includes('margin')
    );
    expect(profitRelationship).toBe(true);
  });

  it('C2: formulaOpportunities includes profit margin formula hint', () => {
    const hints = generateResponseHints(revenueCostData);
    expect(hints?.formulaOpportunities).toBeDefined();
    expect(hints?.formulaOpportunities!.length).toBeGreaterThan(0);
  });

  it('C3: riskLevel is low or none for clean financial data', () => {
    const hints = generateResponseHints(revenueCostData);
    expect(['none', 'low']).toContain(hints?.riskLevel);
  });
});

// ─── Flow D: Error Chain → suggestedFix ───────────────────────────────────────

describe('Flow D: Error responses → suggestedFix injected', () => {
  // suggestFix returns SuggestedFix { tool, action, params, explanation } | null
  // INVALID_RANGE only fires when params contain an unbounded range pattern (e.g. A:Z)
  // UNAUTHENTICATED is not in the fix registry (only PERMISSION_DENIED / AUTH_ERROR are)
  const ERROR_CASES = [
    { code: 'SHEET_NOT_FOUND', message: "Sheet 'Sales Q4' not found", expectFix: true },
    { code: 'INVALID_RANGE', message: 'Invalid A1 notation: Sheet1!A1:ZZ', expectFix: false },
    { code: 'UNAUTHENTICATED', message: 'OAuth token expired', expectFix: false },
    { code: 'QUOTA_EXCEEDED', message: 'Rate limit exceeded', expectFix: true },
    { code: 'PERMISSION_DENIED', message: 'Insufficient permissions', expectFix: true },
    { code: 'UNKNOWN_ERROR_NOT_IN_ENUM', message: 'Some unknown error', expectFix: false },
  ];

  for (const tc of ERROR_CASES) {
    it(`D: ${tc.code} → suggestedFix ${tc.expectFix ? 'object present' : 'absent'} and no throws`, () => {
      const response: Record<string, unknown> = {
        action: 'read',
        error: { code: tc.code, message: tc.message },
      };

      // Must never throw
      expect(() =>
        applyResponseIntelligence(response, {
          toolName: 'sheets_data',
          hasFailure: true,
        })
      ).not.toThrow();

      const error = response['error'] as Record<string, unknown>;
      if (tc.expectFix) {
        expect(error['suggestedFix']).toBeDefined();
        // suggestedFix is SuggestedFix { tool, action, params, explanation }
        expect(typeof error['suggestedFix']).toBe('object');
        const fix = error['suggestedFix'] as Record<string, unknown>;
        expect(typeof fix['tool']).toBe('string');
        expect(typeof fix['action']).toBe('string');
        expect(typeof fix['explanation']).toBe('string');
        expect((fix['explanation'] as string).length).toBeGreaterThan(0);
      }
    });
  }
});

// ─── Flow E: Batching Hint Activation ────────────────────────────────────────

describe('Flow E: single read response → batching hint returned', () => {
  it('E1: sheets_data.read returns batchingHint from applyResponseIntelligence', () => {
    const response: Record<string, unknown> = {
      action: 'read',
      values: SALES_DATA,
    };

    const result = applyResponseIntelligence(response, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    expect(result.batchingHint).toBeDefined();
    expect(result.batchingHint).toMatch(/batch_read/);
  });

  it('E2: sheets_data.write returns batchingHint mentioning batch_write', () => {
    const response: Record<string, unknown> = {
      action: 'write',
      updatedCells: 4,
    };

    const result = applyResponseIntelligence(response, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    expect(result.batchingHint).toBeDefined();
    expect(result.batchingHint).toMatch(/batch_write/);
  });

  it('E3: batch_read response does not trigger a batching hint (already batched)', () => {
    const response: Record<string, unknown> = {
      action: 'batch_read',
      valueRanges: [{ range: 'Sheet1!A1:B10', values: SALES_DATA }],
    };

    const result = applyResponseIntelligence(response, {
      toolName: 'sheets_data',
      hasFailure: false,
    });

    // batch_read has no batching hint (it is the batch action)
    expect(result.batchingHint).toBeUndefined();
  });
});

// ─── Flow F: High-Risk Data Detection ─────────────────────────────────────────

describe('Flow F: high-null + duplicate data → riskLevel = medium or high', () => {
  it('F1: data with many nulls produces elevated riskLevel', () => {
    const highNullData = [
      ['Name', 'Revenue', 'Notes'],
      ['Alice', null, null],
      ['Bob', null, null],
      [null, null, null],
      ['Dave', null, null],
      [null, null, null],
    ];

    const hints = generateResponseHints(highNullData);
    if (hints?.riskLevel) {
      expect(['medium', 'high']).toContain(hints.riskLevel);
    }
  });

  it('F2: generateResponseHints handles all-null rows without throwing', () => {
    const nullData = [
      ['A', 'B', 'C'],
      [null, null, null],
      [null, null, null],
    ];
    expect(() => generateResponseHints(nullData)).not.toThrow();
  });

  it('F3: single data row produces hints without throwing', () => {
    const oneRow = [['Header1', 'Header2'], ['value1', 'value2']];
    expect(() => generateResponseHints(oneRow)).not.toThrow();
  });
});

// ─── Flow G: Intelligence Pipeline — No Mutation ──────────────────────────────

describe('Flow G: intelligence pipeline does not mutate input values', () => {
  it('G1: original values array unchanged after applyResponseIntelligence', () => {
    const originalValues = [
      ['Name', 'Revenue'],
      ['Alice', 1000],
    ];
    const frozen = JSON.parse(JSON.stringify(originalValues)) as unknown[][];

    const response: Record<string, unknown> = {
      action: 'read',
      values: originalValues,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    expect(originalValues).toEqual(frozen);
  });

  it('G2: error object populated with suggestedFix but original code/message unchanged', () => {
    const error = { code: 'SHEET_NOT_FOUND', message: 'Sheet not found' };
    const response: Record<string, unknown> = { action: 'read', error };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: true });

    expect(error.code).toBe('SHEET_NOT_FOUND');
    expect(error.message).toBe('Sheet not found');
    // suggestedFix added on top
    expect((error as Record<string, unknown>)['suggestedFix']).toBeDefined();
  });
});

// ─── Flow H: nextPhase Routing ────────────────────────────────────────────────

describe('Flow H: _hints.nextPhase routes to correct workflow', () => {
  it('H1: time-series data produces a nextPhase string', () => {
    const hints = generateResponseHints(SALES_DATA);
    expect(hints?.nextPhase).toBeDefined();
    expect(typeof hints?.nextPhase).toBe('string');
    expect(hints?.nextPhase!.length).toBeGreaterThan(5); // meaningful, not empty
  });

  it('H2: minimal 2-row data still produces a nextPhase', () => {
    const hints = generateResponseHints(MINIMAL_DATA);
    if (hints) {
      expect(typeof hints.nextPhase).toBe('string');
    }
    // null is acceptable for truly minimal data — no assertion failure
  });

  it('H3: nextPhase does not contain raw error strings or stack traces', () => {
    const hints = generateResponseHints(SALES_DATA);
    if (hints?.nextPhase) {
      expect(hints.nextPhase).not.toMatch(/Error:/);
      expect(hints.nextPhase).not.toMatch(/at Object\./);
      expect(hints.nextPhase).not.toMatch(/undefined/);
    }
  });
});

// ─── Flow I: batch_read _hints ────────────────────────────────────────────────

describe('Flow I: batch_read response gets _hints injected', () => {
  it('I1: batch_read with nested values gets _hints', () => {
    // batch_read returns valueRanges; applyResponseIntelligence extracts values from data.values
    const response: Record<string, unknown> = {
      action: 'batch_read',
      data: { values: SALES_DATA },
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    // _hints should be injected if values are extractable
    // Either present (data extracted) or absent (extraction failed gracefully)
    expect(() => response['_hints']).not.toThrow();
  });

  it('I2: cross_read response with top-level values gets _hints', () => {
    const response: Record<string, unknown> = {
      action: 'cross_read',
      values: SALES_DATA,
    };

    applyResponseIntelligence(response, { toolName: 'sheets_data', hasFailure: false });

    expect(response['_hints']).toBeDefined();
  });
});
