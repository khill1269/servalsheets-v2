import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { logger } from '../../utils/logger.js';

type AnalyzePerformanceRequest = {
  spreadsheetId: string;
  maxSheets?: number;
};

/**
 * Decomposed action handler for `analyze_performance`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleAnalyzePerformanceAction(
  input: AnalyzePerformanceRequest,
  sheetsApi: sheets_v4.Sheets
): Promise<AnalyzeResponse> {
  const startTime = Date.now();
  const maxSheets = input.maxSheets ?? 5;

  try {
    const metadataOnly = await sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      includeGridData: false,
      fields:
        'spreadsheetId,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
    });

    const allSheets = metadataOnly.data.sheets ?? [];
    const sheetsToAnalyze = allSheets.slice(0, maxSheets);
    const ranges = sheetsToAnalyze.map((s) => `${s.properties?.title ?? 'Sheet1'}!A1:Z1000`);

    const spreadsheet = await sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      includeGridData: true,
      ranges,
      fields:
        'spreadsheetId,properties,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),data(rowData(values(userEnteredValue))),conditionalFormats,charts)',
    });

    const sheets = spreadsheet.data.sheets ?? [];

    const performance = {
      totalCells: sheets.reduce((sum, sheet) => {
        const rows = sheet.properties?.gridProperties?.rowCount ?? 0;
        const cols = sheet.properties?.gridProperties?.columnCount ?? 0;
        return sum + rows * cols;
      }, 0),
      largeSheets: sheets
        .filter((sheet) => {
          const rows = sheet.properties?.gridProperties?.rowCount ?? 0;
          const cols = sheet.properties?.gridProperties?.columnCount ?? 0;
          return rows * cols > 50000;
        })
        .map((sheet) => sheet.properties?.title ?? 'Untitled'),
      complexFormulas: sheets.reduce(
        (sum, sheet) =>
          sum +
          (sheet.data?.[0]?.rowData?.filter((row) =>
            row.values?.some((cell) => cell.userEnteredValue?.formulaValue)
          ).length ?? 0),
        0
      ),
      conditionalFormats: sheets.reduce(
        (sum, sheet) => sum + (sheet.conditionalFormats?.length ?? 0),
        0
      ),
      charts: sheets.reduce((sum, sheet) => sum + (sheet.charts?.length ?? 0), 0),
    };

    const recommendations: Array<{
      type:
        | 'VOLATILE_FORMULAS'
        | 'EXCESSIVE_FORMULAS'
        | 'LARGE_RANGES'
        | 'CIRCULAR_REFERENCES'
        | 'INEFFICIENT_STRUCTURE'
        | 'TOO_MANY_SHEETS';
      severity: 'low' | 'medium' | 'high';
      description: string;
      estimatedImpact: string;
      recommendation: string;
      executableFix?: {
        tool: string;
        action: string;
        params: Record<string, unknown>;
        description: string;
      };
    }> = [];

    if (performance.totalCells > 1000000) {
      recommendations.push({
        type: 'LARGE_RANGES',
        severity: 'high',
        description: `Spreadsheet has ${performance.totalCells.toLocaleString()} cells`,
        estimatedImpact: 'Slow load times, high memory usage',
        recommendation: 'Consider splitting into multiple smaller spreadsheets',
        executableFix: {
          tool: 'sheets_core',
          action: 'create',
          params: {
            title: `${input.spreadsheetId}-split`,
            sheets: [{ title: 'Sheet1', rowCount: 1000, columnCount: 26 }],
          },
          description: 'Create a new spreadsheet for splitting data',
        },
      });
    }

    if (performance.largeSheets.length > 0) {
      recommendations.push({
        type: 'INEFFICIENT_STRUCTURE',
        severity: 'medium',
        description: `Large sheets detected: ${performance.largeSheets.join(', ')}`,
        estimatedImpact: 'Slower sheet switching and rendering',
        recommendation: 'Archive or split large sheets',
      });
    }

    if (performance.conditionalFormats > 50) {
      recommendations.push({
        type: 'INEFFICIENT_STRUCTURE',
        severity: 'medium',
        description: `${performance.conditionalFormats} conditional format rules`,
        estimatedImpact: 'Increased rendering time',
        recommendation: 'Consolidate or remove unused conditional formats',
        executableFix: {
          tool: 'sheets_format',
          action: 'rule_list_conditional_formats',
          params: {
            spreadsheetId: input.spreadsheetId,
          },
          description: 'List all conditional formats to review and consolidate',
        },
      });
    }

    if (performance.charts > 20) {
      recommendations.push({
        type: 'INEFFICIENT_STRUCTURE',
        severity: 'low',
        description: `${performance.charts} charts present`,
        estimatedImpact: 'Slower initial load',
        recommendation: 'Consider moving charts to separate dashboard sheets',
      });
    }

    const overallScore = Math.max(
      0,
      100 -
        ((performance.totalCells > 1000000 ? 30 : 0) +
          performance.largeSheets.length * 10 +
          (performance.conditionalFormats > 50 ? 20 : 0) +
          (performance.charts > 20 ? 10 : 0))
    );

    const duration = Date.now() - startTime;

    return {
      success: true,
      action: 'analyze_performance',
      performance: {
        overallScore,
        recommendations,
        estimatedImprovementPotential:
          recommendations.length > 0
            ? `${recommendations.length} optimization${recommendations.length > 1 ? 's' : ''} available`
            : 'No major optimizations needed',
      },
      duration,
      message:
        allSheets.length > maxSheets
          ? `Performance score: ${overallScore}/100 (${recommendations.length} recommendations). Results truncated to ${sheetsToAnalyze.length} of ${allSheets.length} sheets — pass maxSheets to increase limit (max 50).`
          : `Performance score: ${overallScore}/100 (${recommendations.length} recommendations)`,
    };
  } catch (error) {
    logger.error('Failed to analyze performance', {
      component: 'analyze-handler',
      action: 'analyze_performance',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to analyze performance',
        retryable: true,
      },
    };
  }
}
