/**
 * Merge / unmerge / cut-paste / copy-paste / detect-spill handlers for sheets_data.
 */

import { ErrorCodes } from '../error-codes.js';
import type { DataResponse, SheetsDataInput } from '../../schemas/data.js';
import {
  buildGridRangeInput,
  parseCellReference,
  toGridRange,
} from '../../utils/google-sheets-helpers.js';
import type { DataHandlerAccess } from './internal.js';
import { MAX_CELLS_PER_REQUEST } from './internal.js';
import {
  resolveRangeToA1,
  a1ToGridRange,
  buildCellRef,
  requestDestructiveConfirmation,
} from './helpers.js';

type DataRequest = SheetsDataInput['request'];

// ─── handleMergeCells ─────────────────────────────────────────────────────────

export async function handleMergeCells(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'merge_cells' }
): Promise<DataResponse> {
  const rangeA1 = await resolveRangeToA1(ha, input.spreadsheetId, input.range);
  const gridRange = await a1ToGridRange(ha, input.spreadsheetId, rangeA1);

  await ha.withCircuitBreaker('batchUpdate.mergeCells', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            mergeCells: {
              range: toGridRange(gridRange),
              mergeType: input.mergeType ?? 'MERGE_ALL',
            },
          },
        ],
      },
    })
  );

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'merge_cells',
        spreadsheetId: input.spreadsheetId,
        description: `Merged cells in range ${rangeA1}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('merge_cells', {});
}

// ─── handleUnmergeCells ───────────────────────────────────────────────────────

export async function handleUnmergeCells(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'unmerge_cells' }
): Promise<DataResponse> {
  const rangeA1 = await resolveRangeToA1(ha, input.spreadsheetId, input.range);
  const gridRange = await a1ToGridRange(ha, input.spreadsheetId, rangeA1);

  // Safety: confirm destructive unmerge operation
  const unmergeConfirmation = await requestDestructiveConfirmation(
    ha,
    'unmerge_cells',
    `Unmerge cells in ${rangeA1}. Merged cell formatting will be lost.`,
    1000,
    100
  );
  if (!unmergeConfirmation.proceed) {
    return ha.makeSuccess('unmerge_cells', {
      _cancelled: true,
      reason: unmergeConfirmation.reason ?? 'User cancelled the unmerge operation',
    });
  }

  await ha.withCircuitBreaker('batchUpdate.unmergeCells', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            unmergeCells: {
              range: toGridRange(gridRange),
            },
          },
        ],
      },
    })
  );

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'unmerge_cells',
        spreadsheetId: input.spreadsheetId,
        description: `Unmerged cells in range ${rangeA1}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('unmerge_cells', {});
}

// ─── handleGetMerges ─────────────────────────────────────────────────────────

export async function handleGetMerges(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'get_merges' }
): Promise<DataResponse> {
  const response = await ha.api.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.merges,sheets.properties.sheetId',
  });

  const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
  const merges = (sheet?.merges ?? []).map((m) => ({
    startRow: m.startRowIndex ?? 0,
    endRow: m.endRowIndex ?? 0,
    startColumn: m.startColumnIndex ?? 0,
    endColumn: m.endColumnIndex ?? 0,
  }));

  return ha.makeSuccess('get_merges', { merges });
}

// ─── handleCutPaste ───────────────────────────────────────────────────────────
// SECURITY: Formula injection check NOT required for cut_paste.
// Uses Google Sheets CutPasteRequest which operates on existing cell data
// within the spreadsheet. User-supplied formula injection is only a risk for
// write, append, and find_replace (all checked via checkFormulaInjection
// in helpers.ts:173). This is an accepted risk — not an oversight.

export async function handleCutPaste(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'cut_paste' }
): Promise<DataResponse> {
  const rangeA1 = await resolveRangeToA1(ha, input.spreadsheetId, input.source);
  const sourceRange = await a1ToGridRange(ha, input.spreadsheetId, rangeA1);

  // Safety: confirm destructive cut operation (source cells will be cleared)
  const cutConfirmation = await requestDestructiveConfirmation(
    ha,
    'cut_paste',
    `Cut data from ${rangeA1} and paste to ${input.destination}. Source cells will be cleared.`,
    1000,
    100
  );
  if (!cutConfirmation.proceed) {
    return ha.makeSuccess('cut_paste', {
      _cancelled: true,
      reason: cutConfirmation.reason ?? 'User cancelled the cut/paste operation',
    });
  }

  if (input.safety?.dryRun) {
    return ha.makeSuccess('cut_paste', {}, undefined, true);
  }

  let destParsed;
  try {
    destParsed = parseCellReference(input.destination);
  } catch (_error) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Invalid destination cell reference: ${input.destination}. Expected format: 'Sheet1!A1' or 'A1'`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const destinationSheetId = destParsed.sheetName
    ? await ha.getSheetId(input.spreadsheetId, destParsed.sheetName, ha.api)
    : sourceRange.sheetId;

  await ha.withCircuitBreaker('batchUpdate.cutPaste', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            cutPaste: {
              source: toGridRange(sourceRange),
              destination: {
                sheetId: destinationSheetId,
                rowIndex: destParsed.row,
                columnIndex: destParsed.col,
              },
              pasteType: input.pasteType ?? 'PASTE_NORMAL',
            },
          },
        ],
      },
    })
  );

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'cut_paste',
        spreadsheetId: input.spreadsheetId,
        description: `Cut data from source to destination (${rangeA1} → ${input.destination})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('cut_paste', {});
}

// ─── handleCopyPaste ─────────────────────────────────────────────────────────
// SECURITY: Formula injection check NOT required for copy_paste.
// Uses Google Sheets CopyPasteRequest which operates on existing cell data
// within the spreadsheet. Same rationale as cut_paste above.

export async function handleCopyPaste(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'copy_paste' }
): Promise<DataResponse> {
  ha.context.metrics?.recordConfirmationSkip({
    action: 'sheets_data.copy_paste',
    reason: 'elicitation_disabled',
    timestamp: Date.now(),
    spreadsheetId: input.spreadsheetId,
    destructive: true,
  });

  const rangeA1 = await resolveRangeToA1(ha, input.spreadsheetId, input.source);
  const sourceRange = await a1ToGridRange(ha, input.spreadsheetId, rangeA1);

  let destParsed;
  try {
    destParsed = parseCellReference(input.destination);
  } catch (_error) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Invalid destination cell reference: ${input.destination}. Expected format: 'Sheet1!A1' or 'A1'`,
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const destinationSheetId = destParsed.sheetName
    ? await ha.getSheetId(input.spreadsheetId, destParsed.sheetName, ha.api)
    : sourceRange.sheetId;

  const sourceRows = (sourceRange.endRowIndex ?? 0) - (sourceRange.startRowIndex ?? 0);
  const sourceCols = (sourceRange.endColumnIndex ?? 0) - (sourceRange.startColumnIndex ?? 0);

  await ha.withCircuitBreaker('batchUpdate.copyPaste', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            copyPaste: {
              source: toGridRange(sourceRange),
              destination: toGridRange(
                buildGridRangeInput(
                  destinationSheetId,
                  destParsed.row,
                  destParsed.row + sourceRows,
                  destParsed.col,
                  destParsed.col + sourceCols
                )
              ),
              pasteType: input.pasteType ?? 'PASTE_NORMAL',
            },
          },
        ],
      },
    })
  );

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'copy_paste',
        spreadsheetId: input.spreadsheetId,
        description: `Copied data from source to destination (${rangeA1} → ${input.destination})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('copy_paste', {});
}

// ─── handleDetectSpillRanges ──────────────────────────────────────────────────

export async function handleDetectSpillRanges(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'detect_spill_ranges' }
): Promise<DataResponse> {
  let rangeStr: string | undefined;
  if (input.range) {
    rangeStr = await resolveRangeToA1(ha, input.spreadsheetId!, input.range);
  }

  const result = await ha.api.spreadsheets.get({
    spreadsheetId: input.spreadsheetId!,
    ...(rangeStr
      ? {
          ranges: [rangeStr],
          fields:
            'sheets(properties(sheetId,title,gridProperties),data.rowData.values.userEnteredValue)',
          includeGridData: true,
        }
      : {
          fields: 'sheets(properties(sheetId,title,gridProperties))',
          includeGridData: false,
        }),
  });

  if (!rangeStr) {
    let sheetTitle: string;
    if (input.sheetId !== undefined) {
      const sheet = result.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
      sheetTitle = sheet?.properties?.title ?? 'Sheet1';
    } else {
      sheetTitle = result.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
    }
    rangeStr = sheetTitle;
  }

  const resolvedSheet =
    result.data.sheets?.find(
      (s) => s.properties?.title === rangeStr || rangeStr?.startsWith(s.properties?.title ?? '\x00')
    ) ?? result.data.sheets?.[0];
  const gridProps = resolvedSheet?.properties?.gridProperties;
  if (gridProps) {
    const totalCells = (gridProps.rowCount ?? 1000) * (gridProps.columnCount ?? 26);
    if (totalCells > MAX_CELLS_PER_REQUEST) {
      const maxRows = Math.floor(MAX_CELLS_PER_REQUEST / (gridProps.columnCount ?? 26));
      const sheetTitle = resolvedSheet?.properties?.title ?? 'Sheet1';
      rangeStr = `${sheetTitle}!A1:${String.fromCharCode(64 + Math.min(gridProps.columnCount ?? 26, 26))}${maxRows}`;
    }
  }

  let gridResult = result;
  if (!result.data.sheets?.[0]?.data) {
    gridResult = await ha.api.spreadsheets.get({
      spreadsheetId: input.spreadsheetId!,
      ranges: [rangeStr!],
      fields:
        'sheets(properties(sheetId,title,gridProperties),data.rowData.values.userEnteredValue)',
      includeGridData: true,
    });
  }

  const sheetName = rangeStr.split('!')[0];
  const sheetData = gridResult.data.sheets?.[0]?.data?.[0];
  const rows = sheetData?.rowData ?? [];

  const dynamicArrayRe =
    /^=\s*(FILTER|SORT|UNIQUE|SEQUENCE|RANDARRAY|XLOOKUP|XMATCH|MMULT|TRANSPOSE|FLATTEN|CHOOSEROWS|CHOOSECOLS|HSTACK|VSTACK|TOROW|TOCOL|BYROW|BYCOL|MAP|REDUCE|SCAN|MAKEARRAY)\s*\(/i;

  const spillRanges: Array<{
    sourceCell: string;
    formula: string;
    spillRange: string;
    rows: number;
    cols: number;
  }> = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const cells = rows[rowIdx]?.values ?? [];
    for (let colIdx = 0; colIdx < cells.length; colIdx++) {
      const formula = cells[colIdx]?.userEnteredValue?.formulaValue ?? '';
      if (!formula || !dynamicArrayRe.test(formula)) continue;

      let spillCols = 1;
      for (let c = colIdx + 1; c < cells.length; c++) {
        const adj = cells[c]?.userEnteredValue;
        if (!adj || (adj as { formulaValue?: string }).formulaValue) break;
        spillCols++;
      }

      let spillRows = 1;
      for (let r = rowIdx + 1; r < Math.min(rowIdx + 1000, rows.length); r++) {
        const adjCell = rows[r]?.values?.[colIdx]?.userEnteredValue;
        if (!adjCell || (adjCell as { formulaValue?: string }).formulaValue) break;
        spillRows++;
      }

      const startRef = buildCellRef(rowIdx, colIdx);
      const endRef = buildCellRef(rowIdx + spillRows - 1, colIdx + spillCols - 1);
      spillRanges.push({
        sourceCell: `${sheetName}!${startRef}`,
        formula,
        spillRange: `${sheetName}!${startRef}:${endRef}`,
        rows: spillRows,
        cols: spillCols,
      });
    }
  }

  return ha.makeSuccess('detect_spill_ranges', { spillRanges });
}
