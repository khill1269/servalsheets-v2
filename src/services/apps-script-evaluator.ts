/**
 * AppsScriptEvaluator — Google Sheets API fallback for Google-only functions.
 *
 * Handles evaluation of functions that HyperFormula cannot evaluate locally:
 * QUERY, IMPORTRANGE, GOOGLEFINANCE, IMPORTDATA, IMPORTFEED, IMPORTHTML,
 * IMPORTXML, SPARKLINE, IMAGE, GOOGLETRANSLATE, DETECTLANGUAGE, ARRAYFORMULA.
 *
 * Strategy: write formula to scratch cell ZZ9999, read computed value back
 * (forcing server-side recalc), then clear the scratch cell.
 */

import { executeWithRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';
import type { GoogleApiClient } from './google-api.js';

// ============================================================================
// Function sets
// ============================================================================

/** Functions that require Google's servers to evaluate (no HyperFormula equivalent) */
export const GOOGLE_ONLY_FUNCTIONS = new Set([
  'QUERY',
  'IMPORTRANGE',
  'GOOGLEFINANCE',
  'IMPORTDATA',
  'IMPORTFEED',
  'IMPORTHTML',
  'IMPORTXML',
  'SPARKLINE',
  'IMAGE',
  'GOOGLETRANSLATE',
  'DETECTLANGUAGE',
  'ARRAYFORMULA',
]);

/** Functions HyperFormula supports natively — do NOT need API fallback */
export const HYPERFORMULA_NATIVE = new Set(['FILTER', 'UNIQUE', 'SORT', 'SORTBY', 'XLOOKUP']);

// ============================================================================
// Types
// ============================================================================

export interface AppsScriptEvalResult {
  value: unknown;
  rawFormula: string;
  evaluatedViaApi: boolean;
  durationMs: number;
  error?: string;
}

// ============================================================================
// AppsScriptEvaluator
// ============================================================================

export class AppsScriptEvaluator {
  /** Scratch cell — column ZZ (702), row 9999. Well outside typical data ranges. */
  private static readonly SCRATCH_RANGE = 'ZZ9999';

  constructor(private readonly googleClient: GoogleApiClient) {}

  /**
   * Returns true if the formula contains any Google-only functions
   * that cannot be evaluated by HyperFormula locally.
   */
  static requiresApiEval(formula: string): boolean {
    const upper = formula.toUpperCase();
    for (const fn of GOOGLE_ONLY_FUNCTIONS) {
      // Match function name followed by '(' to avoid partial matches
      if (upper.includes(`${fn}(`)) return true;
    }
    return false;
  }

  /**
   * Evaluate a formula using the Google Sheets API as the authoritative engine.
   *
   * Steps:
   * 1. Write formula to scratch cell ZZ9999 in the target sheet
   * 2. Read the computed value back (FORMATTED_VALUE forces server-side recalc)
   * 3. Clear the scratch cell (always, in finally block)
   */
  async evaluateFormula(
    spreadsheetId: string,
    sheetName: string,
    formula: string
  ): Promise<AppsScriptEvalResult> {
    const start = Date.now();
    const scratchRange = `'${sheetName}'!${AppsScriptEvaluator.SCRATCH_RANGE}`;

    try {
      // Step 1: Write formula to scratch cell
      await executeWithRetry(() =>
        this.googleClient.sheets.spreadsheets.values.update({
          spreadsheetId,
          range: scratchRange,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[formula]] },
        })
      );

      // Step 2: Read back the computed value
      // valueRenderOption: FORMATTED_VALUE forces server-side recalculation
      const response = await executeWithRetry(() =>
        this.googleClient.sheets.spreadsheets.values.get({
          spreadsheetId,
          range: scratchRange,
          valueRenderOption: 'FORMATTED_VALUE',
        })
      );

      const value = (response as { data: { values?: unknown[][] } }).data.values?.[0]?.[0] ?? null;

      return {
        value,
        rawFormula: formula,
        evaluatedViaApi: true,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('AppsScriptEvaluator: formula evaluation failed', {
        spreadsheetId,
        sheetName,
        formula: formula.slice(0, 80),
        error: message,
      });
      return {
        value: null,
        rawFormula: formula,
        evaluatedViaApi: true,
        durationMs: Date.now() - start,
        error: message,
      };
    } finally {
      // Step 3: Always clear the scratch cell
      try {
        await this.googleClient.sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: scratchRange,
        });
      } catch (clearErr: unknown) {
        logger.warn('AppsScriptEvaluator: failed to clear scratch cell', {
          spreadsheetId,
          range: scratchRange,
          error: clearErr instanceof Error ? clearErr.message : String(clearErr),
        });
      }
    }
  }

  /**
   * Batch-evaluate multiple Google-only formulas.
   * Runs sequentially to avoid concurrent writes to the scratch cell.
   */
  async evaluateMany(
    spreadsheetId: string,
    sheetName: string,
    formulas: string[]
  ): Promise<AppsScriptEvalResult[]> {
    const results: AppsScriptEvalResult[] = [];
    for (const formula of formulas) {
      results.push(await this.evaluateFormula(spreadsheetId, sheetName, formula));
    }
    return results;
  }
}
