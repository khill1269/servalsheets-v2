/**
 * Preset and batch format action handlers:
 * apply_preset, auto_fit, batch_format
 * Sparkline actions: sparkline_add, sparkline_get, sparkline_clear
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { RangeResolutionError } from '../../core/range-resolver.js';
import type { FormatResponse, FormatRequest } from '../../schemas/index.js';
import type { FormatHandlerAccess } from './internal.js';
import { PRESET_COLORS, type ConditionType } from './internal.js';
import { rgbToHex } from './helpers.js';

// ─── handleApplyPreset ────────────────────────────────────────────────────────

export async function handleApplyPreset(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'apply_preset' }
): Promise<FormatResponse> {
  const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range!);
  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  const googleRange = toGridRange(gridRange);
  const requests: sheets_v4.Schema$Request[] = [];

  switch (input.preset!) {
    case 'header_row':
      requests.push({
        repeatCell: {
          range: googleRange,
          cell: {
            userEnteredFormat: {
              backgroundColor: PRESET_COLORS.headerBg,
              textFormat: {
                bold: true,
                foregroundColor: PRESET_COLORS.headerText,
              },
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      });
      break;

    case 'alternating_rows':
      requests.push({
        addBanding: {
          bandedRange: {
            range: googleRange,
            rowProperties: {
              firstBandColor: PRESET_COLORS.altRowFirst,
              secondBandColor: PRESET_COLORS.altRowSecond,
            },
          },
        },
      });
      break;

    case 'total_row':
      requests.push({
        repeatCell: {
          range: googleRange,
          cell: {
            userEnteredFormat: {
              backgroundColor: PRESET_COLORS.totalRowBg,
              textFormat: { bold: true },
              borders: {
                top: {
                  style: 'SOLID_MEDIUM',
                  color: PRESET_COLORS.totalRowBorder,
                },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,borders.top)',
        },
      });
      break;

    case 'currency':
      requests.push({
        repeatCell: {
          range: googleRange,
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
      break;

    case 'percentage':
      requests.push({
        repeatCell: {
          range: googleRange,
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'PERCENT', pattern: '0.00%' },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
      break;

    case 'date':
      requests.push({
        repeatCell: {
          range: googleRange,
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
            },
          },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
      break;

    case 'highlight_positive':
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'NUMBER_GREATER',
                values: [{ userEnteredValue: '0' }],
              },
              format: {
                backgroundColor: PRESET_COLORS.positiveHighlight,
              },
            },
          },
          index: 0,
        },
      });
      break;

    case 'highlight_negative':
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'NUMBER_LESS',
                values: [{ userEnteredValue: '0' }],
              },
              format: {
                backgroundColor: PRESET_COLORS.negativeHighlight,
              },
            },
          },
          index: 0,
        },
      });
      break;
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_format',
        action: 'apply_preset',
        spreadsheetId: input.spreadsheetId,
        range: rangeA1,
        description: `Applied "${input.preset}" preset to ${ha.exactCellCount(googleRange)} cell(s) in ${rangeA1}`,
        undoable: false,
        cellsAffected: ha.exactCellCount(googleRange),
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('apply_preset', {
    cellsFormatted: ha.exactCellCount(googleRange),
  });
}

// ─── handleAutoFit ────────────────────────────────────────────────────────────

export async function handleAutoFit(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'auto_fit' }
): Promise<FormatResponse> {
  let gridRange: {
    sheetId: number;
    startRowIndex?: number;
    endRowIndex?: number;
    startColumnIndex?: number;
    endColumnIndex?: number;
  };

  if (input.range) {
    const rangeA1 = await ha.resolveRange(input.spreadsheetId, input.range);
    gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
  } else if (input.sheetId !== undefined) {
    gridRange = {
      sheetId: input.sheetId,
      startRowIndex: 0,
      endRowIndex: 1000000,
      startColumnIndex: 0,
      endColumnIndex: 26,
    };
  } else {
    throw new RangeResolutionError('Either range or sheetId must be provided');
  }

  const requests: sheets_v4.Schema$Request[] = [];

  const dimension = input.dimension ?? 'BOTH';
  if (dimension === 'ROWS' || dimension === 'BOTH') {
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: gridRange.sheetId,
          dimension: 'ROWS',
          startIndex: gridRange.startRowIndex,
          endIndex: gridRange.endRowIndex,
        },
      },
    });
  }

  if (dimension === 'COLUMNS' || dimension === 'BOTH') {
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: gridRange.sheetId,
          dimension: 'COLUMNS',
          startIndex: gridRange.startColumnIndex,
          endIndex: gridRange.endColumnIndex,
        },
      },
    });
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  return ha.makeSuccess('auto_fit', {});
}

// ─── handleBatchFormat ────────────────────────────────────────────────────────

export async function handleBatchFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'batch_format' }
): Promise<FormatResponse> {
  const rawInput = input as unknown as Record<string, unknown>;
  const operations = rawInput['operations'] as Array<Record<string, unknown>> | undefined;

  if (!operations || operations.length === 0) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'No operations provided. Supply at least one operation in the operations array.',
      retryable: false,
      suggestedFix: 'Provide operations array with at least one format operation',
    });
  }

  if (input.safety?.dryRun) {
    return ha.makeSuccess(
      'batch_format',
      {
        cellsFormatted: 0,
        operationsApplied: operations.length,
        apiCallsSaved: Math.max(0, operations.length - 1),
      },
      undefined,
      true
    );
  }

  const requests: sheets_v4.Schema$Request[] = [];
  let totalCellsFormatted = 0;
  const skippedOps: string[] = [];

  for (let opIdx = 0; opIdx < operations.length; opIdx++) {
    await ha.sendProgress(
      opIdx,
      operations.length,
      `Preparing format operation ${opIdx + 1}/${operations.length}`
    );
    const op = operations[opIdx]!;
    const opType = op['type'] as string;
    const rawRange = op['range'];
    const rangeInput =
      typeof rawRange === 'string' ? { a1: rawRange } : (rawRange as { a1: string });

    const rangeA1 = await ha.resolveRange(input.spreadsheetId, rangeInput);
    const gridRange = await ha.a1ToGridRange(input.spreadsheetId, rangeA1);
    const googleRange = toGridRange(gridRange);
    totalCellsFormatted += ha.exactCellCount(googleRange);

    switch (opType) {
      case 'background': {
        const colorInput = op['color'] || op['colorStyle'];

        if (typeof colorInput === 'object' && colorInput !== null) {
          const colorRecord = colorInput as Record<string, unknown>;
          if ('rgbColor' in colorRecord || 'themeColor' in colorRecord) {
            const backgroundColorStyle = colorInput as sheets_v4.Schema$ColorStyle;
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: { userEnteredFormat: { backgroundColorStyle } },
                fields: 'userEnteredFormat.backgroundColorStyle',
              },
            });
          } else {
            const backgroundColor = colorInput as sheets_v4.Schema$Color;
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: { userEnteredFormat: { backgroundColor } },
                fields: 'userEnteredFormat.backgroundColor',
              },
            });
          }
        } else {
          skippedOps.push(
            `Operation ${opIdx}: type 'background' requires 'color' or 'colorStyle' (e.g. {red:1, green:0, blue:0} or {rgbColor:{red:1,green:0,blue:0}} or {themeColor:"ACCENT1"})`
          );
        }
        break;
      }

      case 'text_format': {
        const textFormat = op['textFormat'] as sheets_v4.Schema$TextFormat;
        if (textFormat) {
          requests.push({
            repeatCell: {
              range: googleRange,
              cell: { userEnteredFormat: { textFormat } },
              fields: 'userEnteredFormat.textFormat',
            },
          });
        } else {
          skippedOps.push(
            `Operation ${opIdx}: type 'text_format' requires 'textFormat' (e.g. {bold:true, fontSize:12})`
          );
        }
        break;
      }

      case 'number_format': {
        const numberFormat = op['numberFormat'] as sheets_v4.Schema$NumberFormat;
        if (numberFormat) {
          requests.push({
            repeatCell: {
              range: googleRange,
              cell: { userEnteredFormat: { numberFormat } },
              fields: 'userEnteredFormat.numberFormat',
            },
          });
        } else {
          skippedOps.push(
            `Operation ${opIdx}: type 'number_format' requires 'numberFormat' (e.g. {type:"CURRENCY", pattern:"$#,##0.00"})`
          );
        }
        break;
      }

      case 'alignment': {
        const cellFormat: sheets_v4.Schema$CellFormat = {};
        const fields: string[] = [];
        if (op['horizontal']) {
          cellFormat.horizontalAlignment = op['horizontal'] as string;
          fields.push('horizontalAlignment');
        }
        if (op['vertical']) {
          cellFormat.verticalAlignment = op['vertical'] as string;
          fields.push('verticalAlignment');
        }
        if (op['wrapStrategy']) {
          cellFormat.wrapStrategy = op['wrapStrategy'] as string;
          fields.push('wrapStrategy');
        }
        if (fields.length > 0) {
          requests.push({
            repeatCell: {
              range: googleRange,
              cell: { userEnteredFormat: cellFormat },
              fields: `userEnteredFormat(${fields.join(',')})`,
            },
          });
        } else {
          skippedOps.push(
            `Operation ${opIdx}: type 'alignment' requires at least one of: 'horizontal', 'vertical', 'wrapStrategy'`
          );
        }
        break;
      }

      case 'borders': {
        const updateBordersRequest: sheets_v4.Schema$UpdateBordersRequest = {
          range: googleRange,
        };
        if (op['top']) updateBordersRequest.top = op['top'] as sheets_v4.Schema$Border;
        if (op['bottom']) updateBordersRequest.bottom = op['bottom'] as sheets_v4.Schema$Border;
        if (op['left']) updateBordersRequest.left = op['left'] as sheets_v4.Schema$Border;
        if (op['right']) updateBordersRequest.right = op['right'] as sheets_v4.Schema$Border;
        if (op['innerHorizontal'])
          updateBordersRequest.innerHorizontal = op['innerHorizontal'] as sheets_v4.Schema$Border;
        if (op['innerVertical'])
          updateBordersRequest.innerVertical = op['innerVertical'] as sheets_v4.Schema$Border;
        requests.push({ updateBorders: updateBordersRequest });
        break;
      }

      case 'format': {
        const format = op['format'] as Record<string, unknown>;
        if (format) {
          const cellFormat: sheets_v4.Schema$CellFormat = {};
          const fields: string[] = [];
          if (format['backgroundColorStyle'] || format['backgroundColor']) {
            const bgInput = format['backgroundColorStyle'] || format['backgroundColor'];
            const bgRecord = bgInput as Record<string, unknown>;
            if (
              typeof bgInput === 'object' &&
              bgInput !== null &&
              ('rgbColor' in bgRecord || 'themeColor' in bgRecord)
            ) {
              cellFormat.backgroundColorStyle = bgInput as sheets_v4.Schema$ColorStyle;
              fields.push('backgroundColorStyle');
            } else {
              const backgroundColorStyle: sheets_v4.Schema$ColorStyle = {
                rgbColor: bgInput as sheets_v4.Schema$Color,
              };
              cellFormat.backgroundColorStyle = backgroundColorStyle;
              fields.push('backgroundColorStyle');
            }
          }
          if (format['textFormat']) {
            cellFormat.textFormat = format['textFormat'] as sheets_v4.Schema$TextFormat;
            fields.push('textFormat');
          }
          if (format['horizontalAlignment']) {
            cellFormat.horizontalAlignment = format['horizontalAlignment'] as string;
            fields.push('horizontalAlignment');
          }
          if (format['verticalAlignment']) {
            cellFormat.verticalAlignment = format['verticalAlignment'] as string;
            fields.push('verticalAlignment');
          }
          if (format['wrapStrategy']) {
            cellFormat.wrapStrategy = format['wrapStrategy'] as string;
            fields.push('wrapStrategy');
          }
          if (format['numberFormat']) {
            cellFormat.numberFormat = format['numberFormat'] as sheets_v4.Schema$NumberFormat;
            fields.push('numberFormat');
          }
          if (format['borders']) {
            cellFormat.borders = format['borders'] as sheets_v4.Schema$Borders;
            fields.push('borders');
          }
          if (fields.length > 0) {
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: { userEnteredFormat: cellFormat },
                fields: `userEnteredFormat(${fields.join(',')})`,
              },
            });
          }
        }
        break;
      }

      case 'preset': {
        const preset = op['preset'] as string;
        switch (preset) {
          case 'header_row':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.4, blue: 0.6 },
                    textFormat: {
                      bold: true,
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                    },
                    horizontalAlignment: 'CENTER',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
              },
            });
            break;
          case 'alternating_rows':
            requests.push({
              addBanding: {
                bandedRange: {
                  range: googleRange,
                  rowProperties: {
                    firstBandColor: { red: 1, green: 1, blue: 1 },
                    secondBandColor: { red: 0.95, green: 0.95, blue: 0.95 },
                  },
                },
              },
            });
            break;
          case 'total_row':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true },
                    borders: {
                      top: {
                        style: 'SOLID_MEDIUM',
                        color: { red: 0, green: 0, blue: 0 },
                      },
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,borders.top)',
              },
            });
            break;
          case 'currency':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            });
            break;
          case 'percentage':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: 'PERCENT', pattern: '0.0%' },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            });
            break;
          case 'date':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            });
            break;
          case 'highlight_positive':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 },
                  },
                },
                fields: 'userEnteredFormat.backgroundColor',
              },
            });
            break;
          case 'highlight_negative':
            requests.push({
              repeatCell: {
                range: googleRange,
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.95, green: 0.85, blue: 0.85 },
                  },
                },
                fields: 'userEnteredFormat.backgroundColor',
              },
            });
            break;
        }
        break;
      }

      default:
        ha.context.logger?.warn(`Unknown batch_format operation type: ${opType}`);
    }
  }

  if (requests.length === 0) {
    const diagnostics =
      skippedOps.length > 0
        ? `\n${skippedOps.join('\n')}`
        : '\nEnsure each operation has a valid type and the required parameters for that type.';
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `No valid format operations could be built from ${operations.length} operation(s).${diagnostics}`,
      retryable: false,
      suggestedFix:
        'Each operation needs: type (background|text_format|number_format|alignment|borders|format|preset) + type-specific params. Example: {type:"background", range:"A1:B5", color:{red:1,green:0,blue:0}}',
    });
  }

  if (requests.length > 100) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `batch_format built ${requests.length} API subrequests but Google Sheets API allows max 100 per batchUpdate call.`,
      retryable: false,
      suggestedFix: 'Split into multiple batch_format calls with up to 100 operations each',
      details: { requestCount: requests.length, limit: 100 },
    });
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: { requests },
  });

  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_format',
        action: 'batch_format',
        spreadsheetId: input.spreadsheetId,
        description: `Batch formatted ${totalCellsFormatted} cell(s) with ${requests.length} operation(s)`,
        undoable: false,
      });
    }
  } catch {
    /* non-blocking */
  }

  return ha.makeSuccess('batch_format', {
    cellsFormatted: totalCellsFormatted,
    operationsApplied: requests.length,
    apiCallsSaved: Math.max(0, requests.length - 1),
  });
}

// ─── Sparkline color helper ───────────────────────────────────────────────────

/**
 * Unwrap SparklineColorInputSchema (ColorStyle | ColorSchema) to a flat RGB object.
 * Theme colors have no hex equivalent and are skipped (returns undefined).
 */
function toFlatRgb(
  color: Record<string, unknown>
): { red?: number; green?: number; blue?: number } | undefined {
  if ('themeColor' in color) return undefined;
  if ('rgbColor' in color && color['rgbColor'] && typeof color['rgbColor'] === 'object') {
    return color['rgbColor'] as { red?: number; green?: number; blue?: number };
  }
  return color as { red?: number; green?: number; blue?: number };
}

// ─── handleSparklineAdd ───────────────────────────────────────────────────────

export async function handleSparklineAdd(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'sparkline_add' }
): Promise<FormatResponse> {
  const dataRangeA1 = await ha.resolveRange(input.spreadsheetId, input.dataRange);

  const options: string[] = [];
  const config = input.config;

  if (config?.type && config.type !== 'LINE') {
    options.push(`"charttype", "${config.type.toLowerCase()}"`);
  }

  const flatColor = config?.color ? toFlatRgb(config.color as Record<string, unknown>) : undefined;
  if (flatColor) options.push(`"color", "${rgbToHex(flatColor)}"`);
  const flatNeg = config?.negativeColor
    ? toFlatRgb(config.negativeColor as Record<string, unknown>)
    : undefined;
  if (flatNeg) options.push(`"negcolor", "${rgbToHex(flatNeg)}"`);
  const flatFirst = config?.firstColor
    ? toFlatRgb(config.firstColor as Record<string, unknown>)
    : undefined;
  if (flatFirst) options.push(`"firstcolor", "${rgbToHex(flatFirst)}"`);
  const flatLast = config?.lastColor
    ? toFlatRgb(config.lastColor as Record<string, unknown>)
    : undefined;
  if (flatLast) options.push(`"lastcolor", "${rgbToHex(flatLast)}"`);
  const flatHigh = config?.highColor
    ? toFlatRgb(config.highColor as Record<string, unknown>)
    : undefined;
  if (flatHigh) options.push(`"highcolor", "${rgbToHex(flatHigh)}"`);
  const flatLow = config?.lowColor
    ? toFlatRgb(config.lowColor as Record<string, unknown>)
    : undefined;
  if (flatLow) options.push(`"lowcolor", "${rgbToHex(flatLow)}"`);

  if (config?.showAxis && config.axisColor) {
    options.push(`"axis", true`);
    const flatAxis = toFlatRgb(config.axisColor as Record<string, unknown>);
    if (flatAxis) options.push(`"axiscolor", "${rgbToHex(flatAxis)}"`);
  } else if (config?.showAxis) {
    options.push(`"axis", true`);
  }

  if (config?.lineWidth !== undefined && config.lineWidth !== 1) {
    options.push(`"linewidth", ${config.lineWidth}`);
  }
  if (config?.minValue !== undefined) options.push(`"ymin", ${config.minValue}`);
  if (config?.maxValue !== undefined) options.push(`"ymax", ${config.maxValue}`);
  if (config?.rtl) options.push(`"rtl", true`);

  const optionsStr = options.length > 0 ? `, {${options.join('; ')}}` : '';
  const formula = `=SPARKLINE(${dataRangeA1}${optionsStr})`;

  if (input.safety?.dryRun) {
    return ha.makeSuccess('sparkline_add', { cell: input.targetCell, formula }, undefined, true);
  }

  await ha.api.spreadsheets.values.update({
    spreadsheetId: input.spreadsheetId,
    range: input.targetCell,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[formula]] },
  });

  return ha.makeSuccess('sparkline_add', { cell: input.targetCell, formula });
}

// ─── handleSparklineGet ───────────────────────────────────────────────────────

export async function handleSparklineGet(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'sparkline_get' }
): Promise<FormatResponse> {
  const response = await ha.api.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    range: input.cell,
    valueRenderOption: 'FORMULA',
  });

  const formula = response.data.values?.[0]?.[0];

  if (!formula || !String(formula).toUpperCase().startsWith('=SPARKLINE(')) {
    return ha.makeError({
      code: ErrorCodes.NOT_FOUND,
      message: `No sparkline found in cell ${input.cell}`,
      retryable: false,
      suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
    });
  }

  return ha.makeSuccess('sparkline_get', { cell: input.cell, formula: String(formula) });
}

// ─── handleSparklineClear ─────────────────────────────────────────────────────

export async function handleSparklineClear(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'sparkline_clear' }
): Promise<FormatResponse> {
  if (input.safety?.dryRun) {
    return ha.makeSuccess('sparkline_clear', { cell: input.cell }, undefined, true);
  }

  const gridRange = await ha.a1ToGridRange(input.spreadsheetId, input.cell);

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: toGridRange(gridRange),
            fields: 'userEnteredValue',
          },
        },
      ],
    },
  });

  return ha.makeSuccess('sparkline_clear', { cell: input.cell });
}

// Re-export ConditionType for use in other submodules
export type { ConditionType };
