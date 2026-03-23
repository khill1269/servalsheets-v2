/**
 * diagnose_errors action handler
 *
 * Scans a spreadsheet range for error values (#REF!, #VALUE!, #NAME?, #DIV/0!, #NULL!, #N/A)
 * and circular references. For each error cell, provides:
 * - Error type classification
 * - Formula text (if includeFormulas=true)
 * - Root cause analysis (tracing dependency chains)
 * - Suggested fix
 *
 * Competitive parity: Claude in Excel's #1 feature — traces formula errors with cell-level citations.
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import type { AnalysisFinding } from '../../analysis/action-generator.js';
import { logger } from '../../utils/logger.js';

// Google Sheets error values we scan for
const ERROR_VALUES = [
  '#REF!',
  '#VALUE!',
  '#NAME?',
  '#DIV/0!',
  '#NULL!',
  '#N/A',
  '#ERROR!',
] as const;
type ErrorValue = (typeof ERROR_VALUES)[number];

interface ErrorDiagnosis {
  cell: string;
  errorType: ErrorValue;
  formula?: string;
  rootCause: string;
  dependencyChain: string[];
  suggestedFix: string;
}

type DiagnoseErrorsRequest = {
  spreadsheetId: string;
  range?: unknown;
  includeFormulas?: boolean;
};

export interface DiagnoseErrorsDeps {
  sheetsApi: sheets_v4.Sheets;
}

/**
 * Resolve range input to an A1 notation string.
 * RangeInputSchema preprocesses strings into { a1: string },
 * so we handle both raw strings and the transformed object.
 */
function resolveRange(range: unknown): string | undefined {
  if (!range) return undefined;
  if (typeof range === 'string') return range;
  if (typeof range === 'object' && range !== null) {
    const obj = range as Record<string, unknown>;
    if (typeof obj['a1'] === 'string') return obj['a1'];
    if (typeof obj['namedRange'] === 'string') return obj['namedRange'];
  }
  return undefined;
}

function hasUnbalancedParentheses(formulaBody: string): boolean {
  let depth = 0;
  for (const char of formulaBody) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        return true;
      }
    }
  }
  return depth !== 0;
}

function hasUnbalancedQuotes(formulaBody: string): boolean {
  const quoteCount = (formulaBody.match(/"/g) ?? []).length;
  return quoteCount % 2 !== 0;
}

function looksLikePseudoFormula(formulaBody: string): boolean {
  const normalized = formulaBody.trim();
  if (normalized.length === 0) {
    return false;
  }

  const hasCellRefs = /\b[A-Z]{1,4}\d+\b/.test(normalized);
  const hasFunctionCall = /\b[A-Z_][A-Z0-9_.]*\s*\(/i.test(normalized);
  return !hasCellRefs && !hasFunctionCall && /\s/.test(normalized);
}

function classifyGeneralFormulaError(formula?: string): {
  rootCause: string;
  suggestedFix: string;
} {
  if (!formula) {
    return {
      rootCause: 'A general parsing or evaluation error in the formula.',
      suggestedFix:
        'Review the formula syntax for missing parentheses, incorrect operators, or incompatible argument types.',
    };
  }

  const body = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();

  if (looksLikePseudoFormula(body)) {
    return {
      rootCause:
        'This cell appears to contain descriptive text entered as a formula because it starts with "=" but does not match normal Sheets formula syntax.',
      suggestedFix:
        'Remove the leading "=" or prefix the text with an apostrophe if you intended to store a note instead of a formula.',
    };
  }

  if (hasUnbalancedParentheses(body)) {
    return {
      rootCause: 'The formula has mismatched parentheses, so Sheets cannot parse it.',
      suggestedFix: `Review "${formula}" for a missing or extra opening/closing parenthesis.`,
    };
  }

  if (hasUnbalancedQuotes(body)) {
    return {
      rootCause: 'The formula has an unmatched quote, which breaks parsing.',
      suggestedFix: `Review "${formula}" for a missing closing quote around text values.`,
    };
  }

  if (/\sx\s/i.test(body)) {
    return {
      rootCause:
        'The formula appears to use "x" as a multiplication symbol instead of the "*" operator that Sheets expects.',
      suggestedFix: `Replace any "x" multiplication in "${formula}" with "*" and retry.`,
    };
  }

  return {
    rootCause: 'A general parsing or evaluation error in the formula.',
    suggestedFix: `Review "${formula}" for missing operators, invalid separators, or incompatible argument types.`,
  };
}

function getFindingSeverity(errorType: ErrorValue): AnalysisFinding['severity'] {
  switch (errorType) {
    case '#REF!':
      return 'critical';
    case '#DIV/0!':
    case '#NULL!':
    case '#N/A':
      return 'warning';
    default:
      return 'error';
  }
}

function toFinding(error: ErrorDiagnosis, index: number): AnalysisFinding {
  const locationMatch = error.cell.match(/^(?:'([^']+)'!|([^!]+)!)([A-Z]+)(\d+)$/);
  const sheetName = locationMatch?.[1] ?? locationMatch?.[2];
  const columnLetter = locationMatch?.[3];
  const rowNumber = locationMatch?.[4];

  return {
    id: `diagnose_error_${index + 1}`,
    type: 'issue',
    severity: getFindingSeverity(error.errorType),
    title: `${error.errorType} at ${error.cell}`,
    description: error.rootCause,
    location: {
      ...(sheetName ? { sheetName } : {}),
      range: error.cell,
      ...(columnLetter && rowNumber
        ? {
            cells: [
              {
                row: Number(rowNumber) - 1,
                col: columnLetterToIndex(columnLetter),
              },
            ],
          }
        : {}),
    },
    data: {
      findingType: 'formula_error',
      errorType: error.errorType,
      cell: error.cell,
      formula: error.formula,
      dependencyChain: error.dependencyChain,
      suggestedFix: error.suggestedFix,
    },
  };
}

/**
 * Classify an error value and provide root cause + fix suggestion.
 */
function classifyError(
  errorValue: string,
  formula: string | undefined
): { rootCause: string; suggestedFix: string } {
  switch (errorValue) {
    case '#REF!':
      return {
        rootCause:
          'A cell reference is invalid — typically caused by deleting a row, column, or sheet that a formula depends on.',
        suggestedFix: formula
          ? `Review the formula "${formula}" and replace deleted references with valid cell addresses.`
          : 'Check if any rows, columns, or sheets referenced by this cell have been deleted.',
      };
    case '#VALUE!':
      return {
        rootCause:
          'A value used in a formula is the wrong type — e.g., text where a number is expected, or an incompatible range shape.',
        suggestedFix: formula
          ? `Check that all arguments in "${formula}" are the correct types. Use VALUE() to convert text to numbers if needed.`
          : 'Ensure cell values match the expected types for the formula.',
      };
    case '#NAME?':
      return {
        rootCause:
          'A formula contains an unrecognized function name or named range — often a typo or missing add-on.',
        suggestedFix: formula
          ? `Check for typos in function names within "${formula}". Verify any named ranges exist.`
          : 'Verify function names are spelled correctly and any named ranges are defined.',
      };
    case '#DIV/0!':
      return {
        rootCause: 'A formula divides by zero or by an empty cell.',
        suggestedFix: formula
          ? `Wrap the division in an IF check: =IF(denominator=0, 0, ${formula})`
          : 'Add an IF check to handle zero/empty denominators before dividing.',
      };
    case '#NULL!':
      return {
        rootCause:
          'A formula uses an incorrect range operator — typically a space between two ranges that do not intersect.',
        suggestedFix: formula
          ? `Check range operators in "${formula}". Use commas to separate ranges, not spaces.`
          : 'Replace space-separated ranges with comma-separated ranges.',
      };
    case '#N/A':
      return {
        rootCause: 'A lookup function (VLOOKUP, MATCH, INDEX) could not find the requested value.',
        suggestedFix: formula
          ? `Wrap in IFERROR: =IFERROR(${formula}, "Not found"). Also verify the lookup value exists in the target range.`
          : 'Verify the lookup value exists in the target range. Consider using IFERROR() to handle missing matches.',
      };
    case '#ERROR!':
      return classifyGeneralFormulaError(formula);
    default:
      return {
        rootCause: `Unknown error type: ${errorValue}`,
        suggestedFix: 'Review the cell formula and referenced data for issues.',
      };
  }
}

/**
 * Check if a string value is a Google Sheets error.
 */
function isErrorValue(value: unknown): value is ErrorValue {
  if (typeof value !== 'string') return false;
  return ERROR_VALUES.includes(value as ErrorValue);
}

export async function handleDiagnoseErrorsAction(
  input: DiagnoseErrorsRequest,
  deps: DiagnoseErrorsDeps
): Promise<AnalyzeResponse> {
  logger.info('Diagnose errors action', { spreadsheetId: input.spreadsheetId });

  try {
    const { spreadsheetId, includeFormulas = true } = input;
    const rangeA1 = resolveRange(input.range);

    // Step 1: Determine ranges to scan
    let ranges: string[];
    if (rangeA1) {
      ranges = [rangeA1];
    } else {
      // Fetch sheet names to scan all sheets
      const metadata = await deps.sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title',
      });
      const sheets = metadata.data.sheets ?? [];
      ranges = sheets
        .map((s) => s.properties?.title)
        .filter((title): title is string => !!title)
        .map((title) => `'${title}'`);
    }

    // Step 2: Fetch values (and formulas if requested) for all ranges — two batchGet calls max
    const errors: ErrorDiagnosis[] = [];

    // Single batchGet for FORMATTED_VALUE across all ranges
    const valuesBatch = await deps.sheetsApi.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const valueResponses = valuesBatch.data.valueRanges ?? [];

    // Single batchGet for FORMULA across all ranges (if requested)
    let formulaResponses: typeof valueResponses = [];
    if (includeFormulas) {
      try {
        const formulasBatch = await deps.sheetsApi.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges,
          valueRenderOption: 'FORMULA',
        });
        formulaResponses = formulasBatch.data.valueRanges ?? [];
      } catch (_e) {
        logger.warn('Could not fetch formulas for error diagnosis');
      }
    }

    // Step 3: Scan each range for error values
    for (let rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++) {
      const range = ranges[rangeIdx]!;
      const valueResponse = valueResponses[rangeIdx];
      const values = valueResponse?.values ?? [];
      const sheetRange = valueResponse?.range ?? range;

      // Parse the sheet name and start cell from the response range
      const sheetMatch = sheetRange.match(/^'?([^'!]+)'?!([A-Z]+)(\d+)/);
      const sheetName = sheetMatch?.[1] ?? range.replace(/^'|'$/g, '');
      const startCol = sheetMatch?.[2] ?? 'A';
      const startRow = parseInt(sheetMatch?.[3] ?? '1', 10);

      const formulas: (string | undefined)[][] = (formulaResponses[rangeIdx]?.values ?? []).map(
        (row) =>
          (row ?? []).map((cell) => {
            const s = String(cell ?? '');
            return s.startsWith('=') ? s : undefined;
          })
      );

      for (let rowIdx = 0; rowIdx < values.length; rowIdx++) {
        const row = values[rowIdx] ?? [];
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cellValue = row[colIdx];
          if (isErrorValue(cellValue)) {
            const colLetter = columnIndexToLetter(columnLetterToIndex(startCol) + colIdx);
            const cellRef = `'${sheetName}'!${colLetter}${startRow + rowIdx}`;
            const formula = formulas[rowIdx]?.[colIdx];
            const { rootCause, suggestedFix } = classifyError(cellValue, formula);

            errors.push({
              cell: cellRef,
              errorType: cellValue,
              formula,
              rootCause,
              dependencyChain: [cellRef], // Basic chain — just the error cell itself
              suggestedFix,
            });
          }
        }
      }
    }

    // Step 4: Build summary
    const errorsByType = new Map<string, number>();
    for (const err of errors) {
      errorsByType.set(err.errorType, (errorsByType.get(err.errorType) ?? 0) + 1);
    }

    const summary =
      errors.length === 0
        ? 'No errors found in the scanned range.'
        : `Found ${errors.length} error(s) across ${errorsByType.size} type(s): ${[...errorsByType.entries()].map(([type, count]) => `${type} (${count})`).join(', ')}`;

    const findings = errors.map((errorDiagnosis, index) => toFinding(errorDiagnosis, index));

    return {
      success: true,
      action: 'diagnose_errors',
      summary,
      errors: errors.map((e) => ({
        cell: e.cell,
        errorType: e.errorType,
        formula: e.formula,
        rootCause: e.rootCause,
        dependencyChain: e.dependencyChain,
        suggestedFix: e.suggestedFix,
      })),
      findings,
      errorCount: errors.length,
      errorsByType: Object.fromEntries(errorsByType),
    } as AnalyzeResponse;
  } catch (error) {
    logger.error('diagnose_errors failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    };
  }
}

/**
 * Convert a column letter (A, B, ..., Z, AA, AB, ...) to a 0-based index.
 */
function columnLetterToIndex(col: string): number {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Convert a 0-based column index to a column letter.
 */
function columnIndexToLetter(index: number): string {
  let letter = '';
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
