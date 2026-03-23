/**
 * Basic format action handlers:
 * set_format, set_background, set_text_format, set_number_format,
 * set_alignment, set_borders, clear_format, set_rich_text
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import type { FormatResponse, FormatRequest } from '../../schemas/index.js';
import type { FormatHandlerAccess } from './internal.js';

// ─── handleSetFormat ──────────────────────────────────────────────────────────

export async function handleSetFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_format' }
): Promise<FormatResponse> {
  if (input.safety?.dryRun) {
    return ha.makeSuccess('set_format', { cellsFormatted: 0 }, undefined, true);
  }

  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const format = input.format!;

  const cellFormat: sheets_v4.Schema$CellFormat = {};
  const fields: string[] = [];

  if (format.backgroundColor) {
    cellFormat.backgroundColor = format.backgroundColor;
    fields.push('backgroundColor');
  }
  if (format.backgroundColorStyle) {
    cellFormat['backgroundColorStyle'] = format.backgroundColorStyle;
    fields.push('backgroundColorStyle');
  }
  if (format.textFormat) {
    cellFormat.textFormat = format.textFormat;
    fields.push('textFormat');
  }
  if (format.horizontalAlignment) {
    cellFormat.horizontalAlignment = format.horizontalAlignment;
    fields.push('horizontalAlignment');
  }
  if (format.verticalAlignment) {
    cellFormat.verticalAlignment = format.verticalAlignment;
    fields.push('verticalAlignment');
  }
  if (format.wrapStrategy) {
    cellFormat.wrapStrategy = format.wrapStrategy;
    fields.push('wrapStrategy');
  }
  if (format.numberFormat) {
    cellFormat.numberFormat = format.numberFormat;
    fields.push('numberFormat');
  }
  if (format.borders) {
    cellFormat.borders = format.borders;
    fields.push('borders');
  }
  if (format.textRotation) {
    cellFormat.textRotation = format.textRotation;
    fields.push('textRotation');
  }
  if (format.padding) {
    cellFormat.padding = format.padding;
    fields.push('padding');
  }

  const googleRange = toGridRange(gridRange);
  const fieldMask =
    fields.length > 0 ? `userEnteredFormat(${fields.join(',')})` : 'userEnteredFormat';
  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: googleRange,
            cell: { userEnteredFormat: cellFormat },
            fields: fieldMask,
          },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_format',
        action: 'set_format',
        spreadsheetId: input.spreadsheetId,
        range: rangeA1,
        description: `Formatted ${ha.exactCellCount(googleRange)} cell(s) in ${rangeA1}`,
        undoable: false,
        cellsAffected: ha.exactCellCount(googleRange),
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('set_format', {
    cellsFormatted: ha.exactCellCount(googleRange),
  });
}

// ─── handleSetBackground ──────────────────────────────────────────────────────

export async function handleSetBackground(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_background' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: googleRange,
            cell: {
              userEnteredFormat: {
                backgroundColor: input.color!,
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ],
    },
  });

  return ha.makeSuccess('set_background', {
    cellsFormatted: ha.exactCellCount(googleRange),
  });
}

// ─── handleSetTextFormat ──────────────────────────────────────────────────────

export async function handleSetTextFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_text_format' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: googleRange,
            cell: {
              userEnteredFormat: {
                textFormat: input.textFormat!,
              },
            },
            fields: 'userEnteredFormat.textFormat',
          },
        },
      ],
    },
  });

  return ha.makeSuccess('set_text_format', {
    cellsFormatted: ha.exactCellCount(googleRange),
  });
}

// ─── handleSetNumberFormat ────────────────────────────────────────────────────

export async function handleSetNumberFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_number_format' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: googleRange,
            cell: {
              userEnteredFormat: {
                numberFormat: input.numberFormat!,
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
      ],
    },
  });

  // For date/time formats, surface the spreadsheet locale and timezone so
  // callers can verify their format pattern matches the spreadsheet's locale.
  const isDateType = ['DATE', 'TIME', 'DATE_TIME'].includes(input.numberFormat?.type ?? '');
  let localeInfo: Record<string, string> | undefined;
  if (isDateType) {
    try {
      const meta = await ha.api.spreadsheets.get({
        spreadsheetId: input.spreadsheetId,
        fields: 'properties(locale,timeZone)',
        includeGridData: false,
      });
      const props = meta.data.properties;
      if (props?.locale || props?.timeZone) {
        localeInfo = {};
        if (props.locale) localeInfo['locale'] = props.locale;
        if (props.timeZone) localeInfo['timeZone'] = props.timeZone;
      }
    } catch {
      // Non-blocking: locale info is informational only
    }
  }

  return ha.makeSuccess('set_number_format', {
    cellsFormatted: ha.exactCellCount(googleRange),
    ...(localeInfo ? { spreadsheetLocale: localeInfo } : {}),
  });
}

// ─── handleSetAlignment ───────────────────────────────────────────────────────

export async function handleSetAlignment(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_alignment' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);

  const cellFormat: sheets_v4.Schema$CellFormat = {};
  const fields: string[] = [];

  if (input.horizontal) {
    cellFormat.horizontalAlignment = input.horizontal;
    fields.push('horizontalAlignment');
  }
  if (input.vertical) {
    cellFormat.verticalAlignment = input.vertical;
    fields.push('verticalAlignment');
  }
  if (input.wrapStrategy) {
    cellFormat.wrapStrategy = input.wrapStrategy;
    fields.push('wrapStrategy');
  }

  if (fields.length === 0) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'No alignment properties specified. You must provide at least one of: horizontal (LEFT, CENTER, RIGHT), vertical (TOP, MIDDLE, BOTTOM), or wrapStrategy (OVERFLOW_CELL, LEGACY_WRAP, CLIP, WRAP)',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      resolution:
        'Specify at least one alignment property: horizontal, vertical, or wrapStrategy. Example: { horizontal: "CENTER", vertical: "MIDDLE" }',
    });
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: googleRange,
            cell: { userEnteredFormat: cellFormat },
            fields: `userEnteredFormat(${fields.join(',')})`,
          },
        },
      ],
    },
  });

  return ha.makeSuccess('set_alignment', {
    cellsFormatted: ha.exactCellCount(googleRange),
  });
}

// ─── handleSetBorders ─────────────────────────────────────────────────────────

export async function handleSetBorders(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_borders' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);

  const updateBordersRequest: sheets_v4.Schema$UpdateBordersRequest = {
    range: googleRange,
    top: input.top,
    bottom: input.bottom,
    left: input.left,
    right: input.right,
    innerHorizontal: input.innerHorizontal,
    innerVertical: input.innerVertical,
  };

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [{ updateBorders: updateBordersRequest }],
    },
  });

  return ha.makeSuccess('set_borders', {
    cellsFormatted: ha.exactCellCount(googleRange),
  });
}

// ─── handleClearFormat ────────────────────────────────────────────────────────

export async function handleClearFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'clear_format' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);
  const estimatedCells = ha.exactCellCount(googleRange);

  if (ha.context.elicitationServer && estimatedCells > 500) {
    try {
      const confirmation = await confirmDestructiveAction(
        ha.context.elicitationServer,
        'Clear Formatting',
        `You are about to clear all formatting from approximately ${estimatedCells.toLocaleString()} cells in range ${rangeA1}.\n\nAll number formats, colors, borders, and text styling will be removed. Cell values will not be affected.`
      );

      if (!confirmation.confirmed) {
        return ha.makeError({
          code: ErrorCodes.PRECONDITION_FAILED,
          message: 'Clear formatting operation cancelled by user',
          retryable: false,
          suggestedFix: 'Review the operation requirements and try again',
        });
      }
    } catch (err) {
      ha.context.logger?.warn('Elicitation failed for clear_format, proceeding with operation', {
        error: err,
      });
    }
  }

  if (input.safety?.dryRun) {
    return ha.makeSuccess('clear_format', { cellsFormatted: 0 }, undefined, true);
  }

  const snapshot = await createSnapshotIfNeeded(
    ha.context.snapshotService,
    {
      operationType: 'clear_format',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
      affectedCells: estimatedCells,
    },
    input.safety
  );

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: googleRange,
            cell: { userEnteredFormat: {} },
            fields: 'userEnteredFormat',
          },
        },
      ],
    },
  });

  return ha.makeSuccess('clear_format', {
    cellsFormatted: ha.exactCellCount(googleRange),
    snapshotId: snapshot?.snapshotId,
  });
}

// ─── handleSetRichText ────────────────────────────────────────────────────────

export async function handleSetRichText(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_rich_text' }
): Promise<FormatResponse> {
  const cell = (input as unknown as { cell: string }).cell;
  const runs = (
    input as unknown as { runs: Array<{ text: string; format?: Record<string, unknown> }> }
  ).runs;

  const cellA1 = await ha.resolveRange(input.spreadsheetId, { a1: cell });
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, cellA1);
  const googleRange = toGridRange(gridRange);

  const fullText = runs.map((r) => r.text).join('');

  const textFormatRuns: Array<{ startIndex?: number; format?: Record<string, unknown> }> = [];
  let currentIndex = 0;
  for (const run of runs) {
    if (run.format) {
      textFormatRuns.push({
        startIndex: currentIndex,
        format: run.format,
      });
    } else {
      textFormatRuns.push({
        startIndex: currentIndex,
        format: {},
      });
    }
    currentIndex += run.text.length;
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: googleRange,
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: fullText },
                    textFormatRuns: textFormatRuns,
                  },
                ],
              },
            ],
            fields: 'userEnteredValue,textFormatRuns',
          },
        },
      ],
    },
  });

  return ha.makeSuccess('set_rich_text', {
    cell: cellA1,
    runsApplied: runs.length,
    textLength: fullText.length,
  });
}
