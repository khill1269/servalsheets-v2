/**
 * Tests for AppsScriptEvaluator (16-F5)
 *
 * Covers:
 * - requiresApiEval() detection of Google-only functions
 * - evaluateFormula() success path (write → read → clear)
 * - evaluateFormula() error paths (get throws, update throws)
 * - evaluateMany() sequential ordering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AppsScriptEvaluator,
  GOOGLE_ONLY_FUNCTIONS,
  HYPERFORMULA_NATIVE,
} from '../../src/services/apps-script-evaluator.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockGoogleClient(overrides?: {
  updateResult?: unknown;
  getResult?: unknown;
  clearResult?: unknown;
  updateError?: Error;
  getError?: Error;
  clearError?: Error;
}): GoogleApiClient {
  const update = overrides?.updateError
    ? vi.fn().mockRejectedValue(overrides.updateError)
    : vi.fn().mockResolvedValue({ data: {} });

  const get = overrides?.getError
    ? vi.fn().mockRejectedValue(overrides.getError)
    : vi.fn().mockResolvedValue(
        overrides?.getResult ?? { data: { values: [['42']] } }
      );

  const clear = overrides?.clearError
    ? vi.fn().mockRejectedValue(overrides.clearError)
    : vi.fn().mockResolvedValue({ data: {} });

  return {
    sheets: {
      spreadsheets: {
        values: {
          update,
          get,
          clear,
        },
      },
    },
  } as unknown as GoogleApiClient;
}

// ---------------------------------------------------------------------------
// AppsScriptEvaluator.requiresApiEval
// ---------------------------------------------------------------------------

describe('AppsScriptEvaluator.requiresApiEval', () => {
  it('returns true for QUERY formulas', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=QUERY(A1:D100,"SELECT A,B WHERE C>0")')
    ).toBe(true);
  });

  it('returns true for IMPORTRANGE', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=IMPORTRANGE("abc123","Sheet1!A1:B10")')
    ).toBe(true);
  });

  it('returns true for GOOGLEFINANCE', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=GOOGLEFINANCE("GOOG","price")')
    ).toBe(true);
  });

  it('returns true for IMPORTDATA', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=IMPORTDATA("https://example.com/data.csv")')
    ).toBe(true);
  });

  it('returns true for SPARKLINE', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=SPARKLINE(A1:A10)')
    ).toBe(true);
  });

  it('returns true for GOOGLETRANSLATE', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=GOOGLETRANSLATE(A1,"en","fr")')
    ).toBe(true);
  });

  it('returns true for ARRAYFORMULA', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=ARRAYFORMULA(A1:A10*2)')
    ).toBe(true);
  });

  it('returns false for SUM', () => {
    expect(AppsScriptEvaluator.requiresApiEval('=SUM(A1:A10)')).toBe(false);
  });

  it('returns false for XLOOKUP', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=XLOOKUP(A1,B1:B100,C1:C100)')
    ).toBe(false);
  });

  it('returns false for VLOOKUP', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=VLOOKUP(A1,B1:C100,2,FALSE)')
    ).toBe(false);
  });

  it('returns false for IF with nested SUM', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=IF(SUM(A1:A10)>0,"yes","no")')
    ).toBe(false);
  });

  it('is case-insensitive — lowercase query( returns true', () => {
    expect(
      AppsScriptEvaluator.requiresApiEval('=query(A1:B10,"SELECT A")')
    ).toBe(true);
  });

  it('does not false-positive on partial name match (e.g. IMPORTANTTHING)', () => {
    // "IMPORTANTTHING(" does not contain IMPORTRANGE( or IMPORTDATA(
    expect(
      AppsScriptEvaluator.requiresApiEval('=IMPORTANTTHING(A1)')
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GOOGLE_ONLY_FUNCTIONS and HYPERFORMULA_NATIVE sets
// ---------------------------------------------------------------------------

describe('GOOGLE_ONLY_FUNCTIONS set', () => {
  it('contains QUERY', () => expect(GOOGLE_ONLY_FUNCTIONS.has('QUERY')).toBe(true));
  it('contains IMPORTRANGE', () => expect(GOOGLE_ONLY_FUNCTIONS.has('IMPORTRANGE')).toBe(true));
  it('contains GOOGLEFINANCE', () => expect(GOOGLE_ONLY_FUNCTIONS.has('GOOGLEFINANCE')).toBe(true));
  it('does NOT contain XLOOKUP', () => expect(GOOGLE_ONLY_FUNCTIONS.has('XLOOKUP')).toBe(false));
});

describe('HYPERFORMULA_NATIVE set', () => {
  it('contains XLOOKUP', () => expect(HYPERFORMULA_NATIVE.has('XLOOKUP')).toBe(true));
  it('contains FILTER', () => expect(HYPERFORMULA_NATIVE.has('FILTER')).toBe(true));
  it('does NOT contain QUERY', () => expect(HYPERFORMULA_NATIVE.has('QUERY')).toBe(false));
});

// ---------------------------------------------------------------------------
// AppsScriptEvaluator.evaluateFormula — success path
// ---------------------------------------------------------------------------

describe('AppsScriptEvaluator.evaluateFormula', () => {
  const SPREADSHEET_ID = 'test-spreadsheet-id';
  const SHEET_NAME = 'Sheet1';
  const FORMULA = '=QUERY(A1:D100,"SELECT A,B WHERE C>0")';

  it('writes formula, reads result, clears scratch cell — success path', async () => {
    const googleClient = createMockGoogleClient({
      getResult: { data: { values: [['hello']] } },
    });
    const evaluator = new AppsScriptEvaluator(googleClient);

    const result = await evaluator.evaluateFormula(SPREADSHEET_ID, SHEET_NAME, FORMULA);

    // update called with USER_ENTERED and the formula
    const updateMock = googleClient.sheets.spreadsheets.values.update as ReturnType<typeof vi.fn>;
    expect(updateMock).toHaveBeenCalledOnce();
    const updateCall = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateCall['spreadsheetId']).toBe(SPREADSHEET_ID);
    expect(updateCall['valueInputOption']).toBe('USER_ENTERED');
    expect((updateCall['requestBody'] as { values: unknown[][] })['values'][0]![0]).toBe(FORMULA);

    // get called on the scratch range
    const getMock = googleClient.sheets.spreadsheets.values.get as ReturnType<typeof vi.fn>;
    expect(getMock).toHaveBeenCalledOnce();
    const getCall = getMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(getCall['spreadsheetId']).toBe(SPREADSHEET_ID);
    expect(getCall['valueRenderOption']).toBe('FORMATTED_VALUE');

    // clear called in finally block
    const clearMock = googleClient.sheets.spreadsheets.values.clear as ReturnType<typeof vi.fn>;
    expect(clearMock).toHaveBeenCalledOnce();

    // result shape
    expect(result.value).toBe('hello');
    expect(result.evaluatedViaApi).toBe(true);
    expect(result.rawFormula).toBe(FORMULA);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns null value when Sheets API returns no values', async () => {
    const googleClient = createMockGoogleClient({
      getResult: { data: { values: undefined } },
    });
    const evaluator = new AppsScriptEvaluator(googleClient);

    const result = await evaluator.evaluateFormula(SPREADSHEET_ID, SHEET_NAME, FORMULA);

    expect(result.value).toBeNull();
    expect(result.evaluatedViaApi).toBe(true);
  });

  it('clears scratch cell even when get() throws', async () => {
    const googleClient = createMockGoogleClient({
      getError: new Error('API quota exceeded'),
    });
    const evaluator = new AppsScriptEvaluator(googleClient);

    const result = await evaluator.evaluateFormula(SPREADSHEET_ID, SHEET_NAME, FORMULA);

    // clear must still be called
    const clearMock = googleClient.sheets.spreadsheets.values.clear as ReturnType<typeof vi.fn>;
    expect(clearMock).toHaveBeenCalledOnce();

    // result captures the error
    expect(result.error).toBe('API quota exceeded');
    expect(result.value).toBeNull();
    expect(result.evaluatedViaApi).toBe(true);
  });

  it('returns error result when update() throws', async () => {
    const googleClient = createMockGoogleClient({
      updateError: new Error('insufficient permissions'),
    });
    const evaluator = new AppsScriptEvaluator(googleClient);

    const result = await evaluator.evaluateFormula(SPREADSHEET_ID, SHEET_NAME, FORMULA);

    expect(result.error).toBe('insufficient permissions');
    expect(result.value).toBeNull();
    expect(result.evaluatedViaApi).toBe(true);

    // clear is still called (finally block)
    const clearMock = googleClient.sheets.spreadsheets.values.clear as ReturnType<typeof vi.fn>;
    expect(clearMock).toHaveBeenCalledOnce();
  });

  it('does not throw when clear() itself fails', async () => {
    const googleClient = createMockGoogleClient({
      clearError: new Error('write limit exceeded'),
    });
    const evaluator = new AppsScriptEvaluator(googleClient);

    // Should not throw — clear error is only logged
    await expect(
      evaluator.evaluateFormula(SPREADSHEET_ID, SHEET_NAME, FORMULA)
    ).resolves.not.toThrow();
  });

  it('uses sheetName in the range reference', async () => {
    const googleClient = createMockGoogleClient();
    const evaluator = new AppsScriptEvaluator(googleClient);

    await evaluator.evaluateFormula(SPREADSHEET_ID, 'My Sheet', FORMULA);

    const updateMock = googleClient.sheets.spreadsheets.values.update as ReturnType<typeof vi.fn>;
    const updateCall = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    // Range should contain the sheet name
    expect(String(updateCall['range'])).toContain('My Sheet');
  });
});

// ---------------------------------------------------------------------------
// AppsScriptEvaluator.evaluateMany
// ---------------------------------------------------------------------------

describe('AppsScriptEvaluator.evaluateMany', () => {
  it('returns results for each formula in order', async () => {
    let callCount = 0;
    const googleClient = {
      sheets: {
        spreadsheets: {
          values: {
            update: vi.fn().mockResolvedValue({ data: {} }),
            get: vi.fn().mockImplementation(() => {
              callCount++;
              return Promise.resolve({ data: { values: [[`result-${callCount}`]] } });
            }),
            clear: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      },
    } as unknown as GoogleApiClient;

    const evaluator = new AppsScriptEvaluator(googleClient);
    const formulas = [
      '=QUERY(A1:B10,"SELECT A")',
      '=IMPORTRANGE("id","Sheet1!A1")',
      '=GOOGLEFINANCE("GOOG")',
    ];

    const results = await evaluator.evaluateMany('sid', 'Sheet1', formulas);

    expect(results).toHaveLength(3);
    expect(results[0]!.value).toBe('result-1');
    expect(results[1]!.value).toBe('result-2');
    expect(results[2]!.value).toBe('result-3');
    // rawFormula must match input order
    expect(results[0]!.rawFormula).toBe(formulas[0]);
    expect(results[1]!.rawFormula).toBe(formulas[1]);
    expect(results[2]!.rawFormula).toBe(formulas[2]);
  });

  it('returns empty array for empty input', async () => {
    const googleClient = createMockGoogleClient();
    const evaluator = new AppsScriptEvaluator(googleClient);

    const results = await evaluator.evaluateMany('sid', 'Sheet1', []);
    expect(results).toEqual([]);
  });

  it('continues evaluating after one formula errors', async () => {
    let callCount = 0;
    const googleClient = {
      sheets: {
        spreadsheets: {
          values: {
            update: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.reject(new Error('first fails'));
              return Promise.resolve({ data: {} });
            }),
            get: vi.fn().mockResolvedValue({ data: { values: [['ok']] } }),
            clear: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      },
    } as unknown as GoogleApiClient;

    const evaluator = new AppsScriptEvaluator(googleClient);
    const results = await evaluator.evaluateMany('sid', 'Sheet1', [
      '=QUERY(A1:B10,"SELECT A")',
      '=GOOGLEFINANCE("GOOG")',
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.error).toBeDefined();
    expect(results[1]!.value).toBe('ok');
  });
});
