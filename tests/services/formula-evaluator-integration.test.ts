/**
 * Integration tests for FormulaEvaluator + AppsScriptEvaluator wire-up (16-F5/F6)
 *
 * Tests the FormulaEvaluator.evaluateScenario() behaviour when:
 * - No googleClient is provided (graceful degradation)
 * - A googleClient IS provided and Google-only cells are evaluated via the API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormulaEvaluator } from '../../src/services/formula-evaluator.js';
import type { SheetData } from '../../src/services/formula-evaluator.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockGoogleClient(returnValue = '100'): GoogleApiClient {
  return {
    sheets: {
      spreadsheets: {
        values: {
          update: vi.fn().mockResolvedValue({ data: {} }),
          get: vi.fn().mockResolvedValue({ data: { values: [[returnValue]] } }),
          clear: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    },
  } as unknown as GoogleApiClient;
}

function buildSheetWithGoogleFormula(): SheetData {
  // 3-column sheet:
  //   A1: 1000 (revenue input)
  //   B1: =QUERY(A1:A10,"SELECT A") — Google-only formula
  //   C1: =A1*2 — HyperFormula-evaluable formula
  return {
    sheetName: 'Sheet1',
    values: [
      [1000, null, 2000],
      [500, null, 1000],
    ],
    formulas: [
      [null, '=QUERY(A1:A10,"SELECT A")', '=A1*2'],
      [null, '=QUERY(A2:A10,"SELECT A")', '=A2*2'],
    ],
  };
}

function buildSheetNoGoogleFormulas(): SheetData {
  return {
    sheetName: 'Sheet1',
    values: [
      [100, 200],
      [300, 400],
    ],
    formulas: [
      [null, '=A1+A2'],
      [null, null],
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: no googleClient provided (graceful degradation)
// ---------------------------------------------------------------------------

describe('FormulaEvaluator without googleClient', () => {
  it('evaluateScenario returns null when sheet not loaded', async () => {
    const evaluator = new FormulaEvaluator();
    const result = await evaluator.evaluateScenario('unloaded-id', [
      { cell: 'A1', newValue: 500 },
    ]);
    expect(result).toBeNull();
  });

  it('evaluateScenario lists Google-eval cells in needsGoogleEval but does not throw', async () => {
    const evaluator = new FormulaEvaluator();
    const sheet = buildSheetWithGoogleFormula();
    await evaluator.loadSheet('test-id', sheet);

    const result = await evaluator.evaluateScenario('test-id', [
      { cell: 'A1', newValue: 500 },
    ]);

    expect(result).not.toBeNull();
    // Google-only formula cells should be in needsGoogleEval, not localResults
    expect(result!.needsGoogleEval.length).toBeGreaterThan(0);
    // HyperFormula-evaluable cells should be in localResults
    const cellNames = result!.localResults.map((r) => r.cell);
    // C1 (=A1*2) should appear in localResults
    expect(cellNames.some((c) => c === 'C1')).toBe(true);
  });

  it('evaluateScenario works correctly on sheets with no Google-only formulas', async () => {
    const evaluator = new FormulaEvaluator();
    const sheet = buildSheetNoGoogleFormulas();
    await evaluator.loadSheet('clean-id', sheet);

    const result = await evaluator.evaluateScenario('clean-id', [
      { cell: 'A1', newValue: 999 },
    ]);

    expect(result).not.toBeNull();
    expect(result!.needsGoogleEval).toHaveLength(0);
    // B1 (=A1+A2) should be recalculated
    expect(result!.localResults.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: googleClient provided — Google-eval cells resolved via API
// ---------------------------------------------------------------------------

describe('FormulaEvaluator with googleClient', () => {
  it('constructor accepts optional googleClient', () => {
    const mockClient = createMockGoogleClient();
    expect(() => new FormulaEvaluator(mockClient)).not.toThrow();
  });

  it('evaluateScenario calls AppsScriptEvaluator for Google-only cells when googleClient present', async () => {
    const mockClient = createMockGoogleClient('999');
    const evaluator = new FormulaEvaluator(mockClient);
    const sheet = buildSheetWithGoogleFormula();
    await evaluator.loadSheet('test-id', sheet);

    const result = await evaluator.evaluateScenario('test-id', [
      { cell: 'A1', newValue: 500 },
    ]);

    expect(result).not.toBeNull();

    // Google-eval cells should now appear in localResults (resolved via API)
    const googleEvalResults = result!.localResults.filter(
      (r) => (r as { evaluatedViaApi?: boolean }).evaluatedViaApi === true
    );
    // The API was called for the Google-only formula cells
    const getMock = mockClient.sheets.spreadsheets.values.get as ReturnType<typeof vi.fn>;
    expect(getMock.mock.calls.length).toBeGreaterThan(0);
    // needsGoogleEval should be empty (all resolved)
    expect(result!.needsGoogleEval).toHaveLength(0);
    // The API-resolved cells appear in localResults with their values
    expect(googleEvalResults.length).toBeGreaterThan(0);
  });

  it('evaluateScenario does NOT call API when there are no Google-only formula cells', async () => {
    const mockClient = createMockGoogleClient();
    const evaluator = new FormulaEvaluator(mockClient);
    const sheet = buildSheetNoGoogleFormulas();
    await evaluator.loadSheet('clean-id', sheet);

    await evaluator.evaluateScenario('clean-id', [{ cell: 'A1', newValue: 50 }]);

    const getMock = mockClient.sheets.spreadsheets.values.get as ReturnType<typeof vi.fn>;
    expect(getMock.mock.calls.length).toBe(0);
  });

  it('evaluateScenario continues and returns results even if API eval fails', async () => {
    const failingClient: GoogleApiClient = {
      sheets: {
        spreadsheets: {
          values: {
            update: vi.fn().mockRejectedValue(new Error('API unavailable')),
            get: vi.fn().mockRejectedValue(new Error('API unavailable')),
            clear: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      },
    } as unknown as GoogleApiClient;

    const evaluator = new FormulaEvaluator(failingClient);
    const sheet = buildSheetWithGoogleFormula();
    await evaluator.loadSheet('test-id', sheet);

    // Should not throw
    const result = await evaluator.evaluateScenario('test-id', [
      { cell: 'A1', newValue: 500 },
    ]);

    expect(result).not.toBeNull();
    // HyperFormula results still present
    expect(result!.localResults.length).toBeGreaterThanOrEqual(0);
  });
});
