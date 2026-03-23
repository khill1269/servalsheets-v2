import { ErrorCodes } from '../error-codes.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { logger } from '../../utils/logger.js';

type AnalyzeQualityRequest = {
  spreadsheetId: string;
  range: { a1: string } | { namedRange: string } | { semantic: unknown } | { grid: unknown };
};

interface ConvertedRangeInput {
  a1?: string;
  sheetName?: string;
  range?: string;
}

export interface AnalyzeQualityDeps {
  convertRangeInput: (range: AnalyzeQualityRequest['range']) => ConvertedRangeInput | undefined;
  resolveAnalyzeRange: (range?: ConvertedRangeInput) => string | undefined;
  readData: (spreadsheetId: string, range?: string) => Promise<unknown[][]>;
}

/**
 * Decomposed action handler for `analyze_quality`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleAnalyzeQualityAction(
  input: AnalyzeQualityRequest,
  deps: AnalyzeQualityDeps
): Promise<AnalyzeResponse> {
  const startTime = Date.now();

  try {
    const convertedQualityRange = deps.convertRangeInput(input.range);
    const rangeStr = deps.resolveAnalyzeRange(convertedQualityRange);
    const data = await deps.readData(input.spreadsheetId, rangeStr);

    if (data.length === 0) {
      return {
        success: false,
        error: {
          code: ErrorCodes.NO_DATA,
          message: 'No data found in the specified range',
          retryable: false,
        },
      };
    }

    const { checkColumnQuality, detectDataType } = await import('../../analysis/helpers.js');

    const headers = data[0]?.map(String) ?? [];
    const dataRows = data.slice(1);

    const columnResults = headers.map((header, colIndex) => {
      const columnData = dataRows.map((row) => row[colIndex]);
      const dataType = detectDataType(columnData);
      const quality = checkColumnQuality(columnData, dataType);

      return {
        column: header,
        dataType,
        completeness: quality.completeness,
        consistency: quality.consistency,
        issues: quality.issues,
      };
    });

    const avgCompleteness =
      columnResults.reduce((sum, col) => sum + col.completeness, 0) / columnResults.length;
    const avgConsistency =
      columnResults.reduce((sum, col) => sum + col.consistency, 0) / columnResults.length;
    const overallScore = (avgCompleteness + avgConsistency) / 2;

    const issues = columnResults.flatMap((col) =>
      col.issues.map((issue) => ({
        type: 'MIXED_DATA_TYPES' as const,
        severity: 'medium' as const,
        location: col.column,
        description: issue,
        autoFixable: false,
        fixTool: undefined,
        fixAction: undefined,
      }))
    );

    const duration = Date.now() - startTime;

    return {
      success: true,
      action: 'analyze_quality',
      dataQuality: {
        score: overallScore,
        completeness: avgCompleteness,
        consistency: avgConsistency,
        accuracy: Math.round(avgConsistency),
        issues,
        summary: `Quality score: ${overallScore.toFixed(1)}% (${issues.length} issues found)`,
      },
      duration,
      message: `Quality score: ${overallScore.toFixed(1)}%`,
    };
  } catch (error) {
    logger.error('Failed to analyze quality', {
      component: 'analyze-handler',
      action: 'analyze_quality',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to analyze quality',
        retryable: true,
      },
    };
  }
}
