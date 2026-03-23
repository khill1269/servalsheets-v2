/**
 * Tests for diagnose_errors action in sheets_analyze
 *
 * Verifies:
 * - Error detection for all Google Sheets error types
 * - Correct root cause classification
 * - Suggested fixes provided
 * - No errors → empty array
 * - Range filtering works
 * - Formula inclusion toggle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDiagnoseErrorsAction } from '../../src/handlers/analyze-actions/diagnose-errors.js';
import { handleGenerateActionsAction } from '../../src/handlers/analyze-actions/plan-execute.js';
import type { DiagnoseErrorsDeps } from '../../src/handlers/analyze-actions/diagnose-errors.js';

type ValueRangeResponse = { data: { valueRanges?: Array<{ range?: string; values?: unknown[][] }> } };

// Helper to build a batchGet response for one or more ranges
function batchGetResponse(
  entries: Array<{ range: string; values: unknown[][] }>
): ValueRangeResponse {
  return {
    data: {
      valueRanges: entries.map(({ range, values }) => ({ range, values })),
    },
  };
}

// Helper to create a mock Sheets API backed by batchGet
function createMockSheetsApi(overrides: {
  batchGetValues?: (params: Record<string, unknown>) => ValueRangeResponse;
  batchGetFormulas?: (params: Record<string, unknown>) => ValueRangeResponse;
  getSpreadsheet?: (params: Record<string, unknown>) => { data: { sheets?: Array<{ properties?: { title?: string } }> } };
} = {}): DiagnoseErrorsDeps['sheetsApi'] {
  const mockApi = {
    spreadsheets: {
      get: vi.fn().mockImplementation((params: Record<string, unknown>) => {
        if (overrides.getSpreadsheet) {
          return overrides.getSpreadsheet(params);
        }
        return {
          data: {
            sheets: [{ properties: { title: 'Sheet1' } }],
          },
        };
      }),
      values: {
        batchGet: vi.fn().mockImplementation((params: Record<string, unknown>) => {
          const renderOption = params['valueRenderOption'] as string;
          if (renderOption === 'FORMULA' && overrides.batchGetFormulas) {
            return overrides.batchGetFormulas(params);
          }
          if (overrides.batchGetValues) {
            return overrides.batchGetValues(params);
          }
          // Default: return empty valueRanges
          const ranges = (params['ranges'] as string[]) ?? [];
          return batchGetResponse(ranges.map((r) => ({ range: r, values: [] })));
        }),
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mockApi as any;
}

describe('diagnose_errors action', () => {
  let deps: DiagnoseErrorsDeps;

  beforeEach(() => {
    deps = {
      sheetsApi: createMockSheetsApi(),
    };
  });

  it('returns empty errors array when no errors found', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:C3', values: [['Name', 'Revenue', 'Cost'], ['Product A', '1000', '500'], ['Product B', '2000', '800']] }]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:C3' },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result as Record<string, unknown>)['errorCount']).toBe(0);
      expect((result as Record<string, unknown>)['errors']).toEqual([]);
      expect((result as Record<string, unknown>)['summary']).toContain('No errors found');
    }
  });

  it('detects #REF! errors with root cause', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:B2', values: [['Name', 'Total'], ['Item 1', '#REF!']] }]),
      batchGetFormulas: () =>
        batchGetResponse([{ range: 'Sheet1!A1:B2', values: [['Name', 'Total'], ['Item 1', '=SUM(C2:C10)']] }]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:B2' },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const errors = (result as Record<string, unknown>)['errors'] as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(1);
      expect(errors[0]?.['errorType']).toBe('#REF!');
      expect(errors[0]?.['cell']).toContain('B2');
      expect(errors[0]?.['rootCause']).toContain('invalid');
      expect(errors[0]?.['suggestedFix']).toBeTruthy();
    }
  });

  it('detects multiple error types in same range', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{
          range: 'Sheet1!A1:D3',
          values: [
            ['Data', 'Formula1', 'Formula2', 'Formula3'],
            ['10', '#DIV/0!', '#N/A', '#VALUE!'],
            ['20', '30', '#NAME?', '40'],
          ],
        }]),
      batchGetFormulas: () =>
        batchGetResponse([{
          range: 'Sheet1!A1:D3',
          values: [
            ['Data', 'Formula1', 'Formula2', 'Formula3'],
            ['10', '=A2/0', '=VLOOKUP("x",E:E,1)', '=A2+"text"'],
            ['20', '30', '=MYFUNC(A3)', '40'],
          ],
        }]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:D3' },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const errors = (result as Record<string, unknown>)['errors'] as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(4);

      const errorTypes = errors.map((e) => e['errorType']);
      expect(errorTypes).toContain('#DIV/0!');
      expect(errorTypes).toContain('#N/A');
      expect(errorTypes).toContain('#VALUE!');
      expect(errorTypes).toContain('#NAME?');

      const errorsByType = (result as Record<string, unknown>)['errorsByType'] as Record<string, number>;
      expect(errorsByType['#DIV/0!']).toBe(1);
      expect(errorsByType['#N/A']).toBe(1);
      expect(errorsByType['#VALUE!']).toBe(1);
      expect(errorsByType['#NAME?']).toBe(1);
    }
  });

  it('scans all sheets when no range specified', async () => {
    deps.sheetsApi = createMockSheetsApi({
      getSpreadsheet: () => ({
        data: {
          sheets: [
            { properties: { title: 'Revenue' } },
            { properties: { title: 'Costs' } },
          ],
        },
      }),
      batchGetValues: (params) => {
        const ranges = (params['ranges'] as string[]) ?? [];
        return batchGetResponse(ranges.map((r) => ({ range: r, values: [['OK', 'Fine']] })));
      },
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id' },
      deps
    );

    expect(result.success).toBe(true);
    // Both sheets are fetched in a single batchGet call
    // @ts-expect-error test helper access
    const batchGetMock = deps.sheetsApi.spreadsheets.values.batchGet;
    const firstCallRanges: string[] = batchGetMock.mock.calls[0][0]['ranges'];
    expect(firstCallRanges).toHaveLength(2);
  });

  it('handles formula fetch failure gracefully', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Header'], ['#REF!']] }]),
      batchGetFormulas: () => {
        throw new Error('Permission denied');
      },
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:A2' },
      deps
    );

    // Should still succeed with errors detected, just no formula info
    expect(result.success).toBe(true);
    if (result.success) {
      const errors = (result as Record<string, unknown>)['errors'] as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(1);
      expect(errors[0]?.['errorType']).toBe('#REF!');
      // Formula should be undefined since fetch failed
      expect(errors[0]?.['formula']).toBeUndefined();
    }
  });

  it('respects includeFormulas=false', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Header'], ['#VALUE!']] }]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:A2', includeFormulas: false },
      deps
    );

    expect(result.success).toBe(true);
    // Should only have called batchGet once (no formula fetch)
    // @ts-expect-error test helper
    expect(deps.sheetsApi.spreadsheets.values.batchGet).toHaveBeenCalledTimes(1);
  });

  it('provides #DIV/0! specific fix suggestion', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Ratio'], ['#DIV/0!']] }]),
      batchGetFormulas: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Ratio'], ['=B2/C2']] }]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:A2' },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const errors = (result as Record<string, unknown>)['errors'] as Array<Record<string, unknown>>;
      expect(errors).toHaveLength(1);
      expect(errors[0]?.['suggestedFix']).toContain('IF');
      expect(errors[0]?.['rootCause']).toContain('divides by zero');
    }
  });

  it('emits canonical findings for downstream action generation', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Ratio'], ['#REF!']] }]),
      batchGetFormulas: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Ratio'], ['=SUM(B2:C2)']] }]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:A2' },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const findings = (result as Record<string, unknown>)['findings'] as Array<
        Record<string, unknown>
      >;
      expect(findings).toHaveLength(1);
      expect(findings[0]?.['type']).toBe('issue');
      expect(findings[0]?.['severity']).toBe('critical');
      expect(findings[0]?.['title']).toBe("#REF! at 'Sheet1'!A2");
    }
  });

  it('lets generate_actions consume diagnose_errors output directly', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Header'], ['#REF!']] }]),
      batchGetFormulas: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Header'], ['=SUM(B2:C2)']] }]),
    });

    const diagnoseResult = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:A2' },
      deps
    );

    const actionResult = await handleGenerateActionsAction({
      spreadsheetId: 'test-id',
      intent: 'fix_critical',
      findings: diagnoseResult as Record<string, unknown>,
    });

    expect(actionResult.success).toBe(true);
    if (actionResult.success) {
      expect(actionResult.actionPlan?.totalActions).toBeGreaterThan(0);
      expect(actionResult.actionPlan?.actions[0]).toMatchObject({
        tool: 'sheets_analyze',
        action: 'drill_down',
      });
    }
  });

  it('classifies descriptive pseudo-formulas behind #ERROR! cells', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () =>
        batchGetResponse([{ range: 'Sheet1!A1:A2', values: [['Header'], ['#ERROR!']] }]),
      batchGetFormulas: () =>
        batchGetResponse([
          { range: 'Sheet1!A1:A2', values: [['Header'], ['=Units x Purchase Price/Unit']] },
        ]),
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'test-id', range: 'Sheet1!A1:A2' },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const errors = (result as Record<string, unknown>)['errors'] as Array<Record<string, unknown>>;
      expect(errors[0]?.['rootCause']).toContain('descriptive text');
      expect(errors[0]?.['suggestedFix']).toContain('leading "="');
    }
  });

  it('handles API errors gracefully', async () => {
    deps.sheetsApi = createMockSheetsApi({
      batchGetValues: () => {
        throw new Error('Spreadsheet not found');
      },
    });

    const result = await handleDiagnoseErrorsAction(
      { spreadsheetId: 'nonexistent', range: 'Sheet1!A1:A10' },
      deps
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toContain('Spreadsheet not found');
    }
  });
});
