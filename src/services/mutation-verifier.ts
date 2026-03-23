/**
 * Mutation Verifier Service
 *
 * Verifies that mutations (write, append, clear, delete, format) actually
 * succeeded by reading back affected ranges after the Google API call returns.
 * Uses CachedSheetsApi with ETag cache so read-back is nearly free (304 Not Modified).
 *
 * @purpose Post-mutation verification to detect silent write failures
 * @category Data Integrity
 * @dependencies cached-sheets-api, logger
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import { executeWithRetry } from '../utils/retry.js';
import { getEnv } from '../config/env.js';
import { ServiceError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationOperation =
  | 'write'
  | 'append'
  | 'clear'
  | 'delete_rows'
  | 'delete_columns'
  | 'create_sheet'
  | 'delete_sheet'
  | 'format';

export interface VerificationResult {
  status: 'verified' | 'diverged' | 'skipped';
  operation: MutationOperation;
  details?: string;
  /** Time in ms for the verification read-back */
  durationMs?: number;
}

export interface WriteVerification {
  spreadsheetId: string;
  range: string;
  expectedValues: unknown[][];
}

export interface AppendVerification {
  spreadsheetId: string;
  range: string;
  expectedRowCountIncrease: number;
  previousRowCount: number;
}

export interface ClearVerification {
  spreadsheetId: string;
  range: string;
}

export interface SheetExistenceVerification {
  spreadsheetId: string;
  sheetTitle: string;
  shouldExist: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MutationVerifier {
  constructor(private sheetsApi: sheets_v4.Sheets) {}

  private finalize(result: VerificationResult): VerificationResult {
    if (result.status === 'diverged' && getEnv().MUTATION_VERIFY_STRICT) {
      throw new ServiceError(
        `Mutation verification diverged for ${result.operation}: ${result.details ?? 'read-back mismatch'}`,
        'INTERNAL_ERROR',
        'mutation-verifier',
        true
      );
    }

    return result;
  }

  private handleVerificationError(
    error: unknown,
    operation: MutationOperation
  ): VerificationResult {
    if (error instanceof ServiceError && error.serviceName === 'mutation-verifier') {
      throw error;
    }

    logger.warn('Mutation verification read-back failed', {
      component: 'mutation-verifier',
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'skipped', operation, details: 'Read-back failed' };
  }

  /**
   * Verify a write operation by reading back the affected range
   */
  async verifyWrite(params: WriteVerification): Promise<VerificationResult> {
    const start = Date.now();
    try {
      const response = await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.get({
          spreadsheetId: params.spreadsheetId,
          range: params.range,
          valueRenderOption: 'UNFORMATTED_VALUE',
        })
      );

      const actual = response.data.values || [];
      const expected = params.expectedValues;

      // Compare row counts
      if (actual.length !== expected.length) {
        return this.finalize({
          status: 'diverged',
          operation: 'write',
          details: `Row count mismatch: expected ${expected.length}, got ${actual.length}`,
          durationMs: Date.now() - start,
        });
      }

      // Spot-check first and last rows for value match
      const mismatches: string[] = [];
      for (const rowIdx of [0, Math.max(0, expected.length - 1)]) {
        const expectedRow = expected[rowIdx];
        const actualRow = actual[rowIdx];
        if (!expectedRow || !actualRow) continue;
        for (let col = 0; col < expectedRow.length; col++) {
          if (String(expectedRow[col]) !== String(actualRow[col] ?? '')) {
            mismatches.push(
              `[${rowIdx},${col}]: expected "${expectedRow[col]}", got "${actualRow[col]}"`
            );
          }
        }
      }

      if (mismatches.length > 0) {
        return this.finalize({
          status: 'diverged',
          operation: 'write',
          details: `Value mismatches: ${mismatches.slice(0, 5).join('; ')}`,
          durationMs: Date.now() - start,
        });
      }

      return this.finalize({
        status: 'verified',
        operation: 'write',
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return this.handleVerificationError(error, 'write');
    }
  }

  /**
   * Verify an append operation by checking row count increased
   */
  async verifyAppend(params: AppendVerification): Promise<VerificationResult> {
    const start = Date.now();
    try {
      const response = await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.get({
          spreadsheetId: params.spreadsheetId,
          range: params.range,
          valueRenderOption: 'UNFORMATTED_VALUE',
        })
      );

      const actual = response.data.values || [];
      const expectedMin = params.previousRowCount + params.expectedRowCountIncrease;

      if (actual.length < expectedMin) {
        return this.finalize({
          status: 'diverged',
          operation: 'append',
          details: `Expected at least ${expectedMin} rows, got ${actual.length}`,
          durationMs: Date.now() - start,
        });
      }

      return this.finalize({
        status: 'verified',
        operation: 'append',
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return this.handleVerificationError(error, 'append');
    }
  }

  /**
   * Verify a clear operation by checking range is empty
   */
  async verifyClear(params: ClearVerification): Promise<VerificationResult> {
    const start = Date.now();
    try {
      const response = await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.values.get({
          spreadsheetId: params.spreadsheetId,
          range: params.range,
          valueRenderOption: 'UNFORMATTED_VALUE',
        })
      );

      const actual = response.data.values || [];
      const hasContent = actual.some((row) =>
        row.some((cell) => cell !== null && cell !== '' && cell !== undefined)
      );

      if (hasContent) {
        return this.finalize({
          status: 'diverged',
          operation: 'clear',
          details: `Range still contains data after clear (${actual.length} rows with content)`,
          durationMs: Date.now() - start,
        });
      }

      return this.finalize({
        status: 'verified',
        operation: 'clear',
        durationMs: Date.now() - start,
      });
    } catch (error) {
      return this.handleVerificationError(error, 'clear');
    }
  }

  /**
   * Verify sheet creation or deletion by checking sheet existence
   */
  async verifySheetExistence(params: SheetExistenceVerification): Promise<VerificationResult> {
    const start = Date.now();
    const operation: MutationOperation = params.shouldExist ? 'create_sheet' : 'delete_sheet';
    try {
      const response = await executeWithRetry(() =>
        this.sheetsApi.spreadsheets.get({
          spreadsheetId: params.spreadsheetId,
          fields: 'sheets.properties.title',
        })
      );

      const sheets = response.data.sheets || [];
      const exists = sheets.some((s) => s.properties?.title === params.sheetTitle);

      if (exists !== params.shouldExist) {
        return this.finalize({
          status: 'diverged',
          operation,
          details: params.shouldExist
            ? `Sheet "${params.sheetTitle}" not found after creation`
            : `Sheet "${params.sheetTitle}" still exists after deletion`,
          durationMs: Date.now() - start,
        });
      }

      return this.finalize({ status: 'verified', operation, durationMs: Date.now() - start });
    } catch (error) {
      return this.handleVerificationError(error, operation);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _verifier: MutationVerifier | undefined;

export function getMutationVerifier(sheetsApi?: sheets_v4.Sheets): MutationVerifier | undefined {
  if (!_verifier && sheetsApi) {
    _verifier = new MutationVerifier(sheetsApi);
  }
  return _verifier;
}

export function setMutationVerifier(verifier: MutationVerifier): void {
  _verifier = verifier;
}
