import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { logger } from '../../utils/logger.js';

type AnalyzeStructureRequest = {
  spreadsheetId: string;
};

/**
 * Decomposed action handler for `analyze_structure`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleAnalyzeStructureAction(
  input: AnalyzeStructureRequest,
  sheetsApi: sheets_v4.Sheets
): Promise<AnalyzeResponse> {
  const startTime = Date.now();

  try {
    const spreadsheet = await sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields:
        'spreadsheetId,properties,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount))),namedRanges(namedRangeId,name,range)',
    });

    const sheets = spreadsheet.data.sheets ?? [];
    const namedRanges = spreadsheet.data.namedRanges ?? [];

    const sheetTitleById = new Map<number, string>(
      sheets
        .filter((s) => s.properties?.sheetId != null)
        .map((s) => [s.properties!.sheetId!, s.properties?.title ?? 'Untitled'])
    );

    const totalRows = sheets.reduce(
      (sum, sheet) => sum + (sheet.properties?.gridProperties?.rowCount ?? 0),
      0
    );
    const totalColumns = sheets.reduce(
      (sum, sheet) => sum + (sheet.properties?.gridProperties?.columnCount ?? 0),
      0
    );

    const structure = {
      sheets: sheets.length,
      totalRows,
      totalColumns,
      namedRanges: namedRanges.map((nr) => ({
        name: nr.name ?? 'Unnamed',
        range:
          nr.range?.startRowIndex !== undefined && nr.range.startRowIndex !== null
            ? `${sheetTitleById.get(nr.range.sheetId ?? 0) ?? 'Sheet1'}!R${nr.range.startRowIndex + 1}C${(nr.range.startColumnIndex ?? 0) + 1}:R${nr.range.endRowIndex ?? 0}C${nr.range.endColumnIndex ?? 0}`
            : 'Unknown',
      })),
    };

    const duration = Date.now() - startTime;

    return {
      success: true,
      action: 'analyze_structure',
      structure,
      duration,
      message: `Analyzed structure: ${structure.sheets} sheets, ${structure.totalRows} total rows, ${structure.namedRanges?.length ?? 0} named ranges`,
    };
  } catch (error) {
    logger.error('Failed to analyze structure', {
      component: 'analyze-handler',
      action: 'analyze_structure',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to analyze structure',
        retryable: true,
      },
    };
  }
}
