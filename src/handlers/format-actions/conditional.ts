/**
 * Conditional formatting action handlers:
 * rule_add_conditional_format, rule_update_conditional_format,
 * rule_delete_conditional_format, rule_list_conditional_formats,
 * add_conditional_format_rule, generate_conditional_format
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import {
  buildGridRangeInput,
  toGridRange,
  parseA1Notation,
} from '../../utils/google-sheets-helpers.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { confirmDestructiveAction, elicitConditionalFormatPreset } from '../../mcp/elicitation.js';
import type { FormatResponse, FormatRequest } from '../../schemas/index.js';
import type { FormatHandlerAccess } from './internal.js';
import { isElicitableRulePreset, type ConditionType } from './internal.js';
import { parseNLConditionalFormat } from './helpers.js';

function toConditionValues(
  values: unknown[] | undefined
): sheets_v4.Schema$ConditionValue[] | undefined {
  return values?.map((value) => {
    if (typeof value === 'string') {
      return { userEnteredValue: value };
    }
    if (
      value &&
      typeof value === 'object' &&
      'userEnteredValue' in value &&
      typeof (value as { userEnteredValue?: unknown }).userEnteredValue === 'string'
    ) {
      return {
        userEnteredValue: (value as { userEnteredValue: string }).userEnteredValue,
      };
    }
    return { userEnteredValue: String(value ?? '') };
  });
}

// ─── handleRuleAddConditionalFormat ──────────────────────────────────────────

export async function handleRuleAddConditionalFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'rule_add_conditional_format' }
): Promise<FormatResponse> {
  const gridRange = await ha.resolveGridRange(
    input.spreadsheetId,
    input.sheetId as number,
    input.range!
  );

  const affectedCells =
    ((gridRange.endRowIndex ?? 0) - (gridRange.startRowIndex ?? 0)) *
    ((gridRange.endColumnIndex ?? 0) - (gridRange.startColumnIndex ?? 0));

  if (input.safety?.dryRun) {
    let existingRules = 0;
    try {
      const response = await ha.api.spreadsheets.get({
        spreadsheetId: input.spreadsheetId,
        fields: 'sheets.conditionalFormats',
      });
      const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
      existingRules = sheet?.conditionalFormats?.length ?? 0;
    } catch {
      // Ignore errors in preview
    }

    return ha.makeSuccess(
      'rule_add_conditional_format',
      {
        ruleIndex: input.index ?? 0,
        dryRun: true,
        rulePreview: {
          affectedRanges: [gridRange],
          affectedCells,
          existingRules,
        },
      },
      undefined,
      true
    );
  }

  let rule: sheets_v4.Schema$ConditionalFormatRule;

  if (input.rule!.type === 'boolean') {
    rule = {
      ranges: [toGridRange(gridRange)],
      booleanRule: {
        condition: {
          type: input.rule!.condition.type,
          values: toConditionValues(input.rule!.condition.values as unknown[] | undefined),
        },
        format: {
          backgroundColor: input.rule!.format.backgroundColor,
          textFormat: input.rule!.format.textFormat,
        },
      },
    };
  } else {
    rule = {
      ranges: [toGridRange(gridRange)],
      gradientRule: {
        minpoint: {
          type: input.rule!.minpoint.type,
          value: input.rule!.minpoint.value,
          color: input.rule!.minpoint.color,
          colorStyle: { rgbColor: input.rule!.minpoint.color },
        },
        midpoint: input.rule!.midpoint
          ? {
              type: input.rule!.midpoint.type,
              value: input.rule!.midpoint.value,
              color: input.rule!.midpoint.color,
              colorStyle: { rgbColor: input.rule!.midpoint.color },
            }
          : undefined,
        maxpoint: {
          type: input.rule!.maxpoint.type,
          value: input.rule!.maxpoint.value,
          color: input.rule!.maxpoint.color,
          colorStyle: { rgbColor: input.rule!.maxpoint.color },
        },
      },
    };
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          addConditionalFormatRule: {
            rule,
            index: input.index ?? 0,
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
        action: 'rule_add_conditional_format',
        spreadsheetId: input.spreadsheetId,
        description: `Added conditional format rule at index ${input.index ?? 0}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('rule_add_conditional_format', {
    ruleIndex: input.index ?? 0,
  });
}

// ─── handleRuleUpdateConditionalFormat ───────────────────────────────────────

export async function handleRuleUpdateConditionalFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'rule_update_conditional_format' }
): Promise<FormatResponse> {
  if (input.safety?.dryRun) {
    return ha.makeSuccess(
      'rule_update_conditional_format',
      { ruleIndex: input.ruleIndex! },
      undefined,
      true
    );
  }

  const response = await ha.api.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.conditionalFormats,sheets.properties.sheetId',
  });

  const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
  const currentRule = sheet?.conditionalFormats?.[input.ruleIndex!];

  if (!currentRule) {
    return ha.makeError({
      code: ErrorCodes.RANGE_NOT_FOUND,
      message: `Conditional format rule at index ${input.ruleIndex} not found`,
      retryable: false,
      suggestedFix: 'Verify the range reference is correct and the sheet exists',
    });
  }

  if (input.rule) {
    if (input.rule.type === 'boolean') {
      currentRule.booleanRule = {
        condition: {
          type: input.rule.condition.type,
          values: toConditionValues(input.rule.condition.values as unknown[] | undefined),
        },
        format: {
          backgroundColor: input.rule.format.backgroundColor,
          textFormat: input.rule.format.textFormat,
        },
      };
    } else {
      currentRule.gradientRule = {
        minpoint: {
          type: input.rule.minpoint.type,
          value: input.rule.minpoint.value,
          color: input.rule.minpoint.color,
          colorStyle: { rgbColor: input.rule.minpoint.color },
        },
        midpoint: input.rule.midpoint
          ? {
              type: input.rule.midpoint.type,
              value: input.rule.midpoint.value,
              color: input.rule.midpoint.color,
              colorStyle: { rgbColor: input.rule.midpoint.color },
            }
          : undefined,
        maxpoint: {
          type: input.rule.maxpoint.type,
          value: input.rule.maxpoint.value,
          color: input.rule.maxpoint.color,
          colorStyle: { rgbColor: input.rule.maxpoint.color },
        },
      };
    }
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateConditionalFormatRule: {
            rule: currentRule,
            index: input.ruleIndex!,
            sheetId: input.sheetId,
            newIndex: input.newIndex,
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
        action: 'rule_update_conditional_format',
        spreadsheetId: input.spreadsheetId,
        description: `Updated conditional format rule at index ${input.ruleIndex}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('rule_update_conditional_format', {
    ruleIndex: input.newIndex ?? input.ruleIndex!,
  });
}

// ─── handleRuleDeleteConditionalFormat ───────────────────────────────────────

export async function handleRuleDeleteConditionalFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'rule_delete_conditional_format' }
): Promise<FormatResponse> {
  if (input.safety?.dryRun) {
    return ha.makeSuccess('rule_delete_conditional_format', {}, undefined, true);
  }

  // Safety: confirm before deleting conditional format rule
  if (ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'rule_delete_conditional_format',
      `Delete conditional format rule at index ${input.ruleIndex} from sheet ${input.sheetId} in spreadsheet ${input.spreadsheetId}.`
    );
    if (!confirmation.confirmed) {
      return ha.makeSuccess('rule_delete_conditional_format', {
        _cancelled: true,
        reason: confirmation.reason || 'User cancelled the operation',
      });
    }
  }

  const snapshot = await createSnapshotIfNeeded(
    ha.context.snapshotService,
    {
      operationType: 'rule_delete_conditional_format',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteConditionalFormatRule: {
            sheetId: input.sheetId!,
            index: input.ruleIndex!,
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
        action: 'rule_delete_conditional_format',
        spreadsheetId: input.spreadsheetId,
        description: `Deleted conditional format rule at index ${input.ruleIndex}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('rule_delete_conditional_format', {
    snapshotId: snapshot?.snapshotId,
  });
}

// ─── handleRuleListConditionalFormats ─────────────────────────────────────────

export async function handleRuleListConditionalFormats(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'rule_list_conditional_formats' }
): Promise<FormatResponse> {
  const response = await ha.api.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.conditionalFormats,sheets.properties.sheetId',
  });

  const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
  const allRules = (sheet?.conditionalFormats ?? []).map((rule, index) => ({
    index,
    type: rule.booleanRule ? ('boolean' as const) : ('gradient' as const),
    ranges: (rule.ranges ?? []).map((r) =>
      buildGridRangeInput(
        r.sheetId ?? 0,
        r.startRowIndex ?? undefined,
        r.endRowIndex ?? undefined,
        r.startColumnIndex ?? undefined,
        r.endColumnIndex ?? undefined
      )
    ),
  }));

  const limit = 50;
  const totalCount = allRules.length;
  const rules = allRules.slice(0, limit);
  const truncated = totalCount > limit;

  return ha.makeSuccess('rule_list_conditional_formats', {
    rules,
    totalCount,
    truncated,
    ...(truncated && {
      suggestion: `Found ${totalCount} rules. Showing first ${limit}. Use sheets_core action "get" to retrieve full rule data if needed.`,
    }),
  });
}

// ─── handleAddConditionalFormatRule ──────────────────────────────────────────

export async function handleAddConditionalFormatRule(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'add_conditional_format_rule' }
): Promise<FormatResponse> {
  // Elicitation wizard: ask for rulePreset when absent
  let resolvedInput = input;
  if (!input.rulePreset && ha.context.elicitationServer) {
    // P0-1 defensive guard: elicitConditionalFormatPreset may be unavailable if the
    // compiled JS is stale. Fall back to default preset instead of crashing the entire
    // sheets_format tool. See BUG_REPORT_2026-03-16.md §P0-1.
    if (typeof elicitConditionalFormatPreset === 'function') {
      const rangeDisplay =
        typeof input.range === 'string'
          ? input.range
          : input.range && 'a1' in input.range
            ? input.range.a1
            : '';
      const elicited = await elicitConditionalFormatPreset(
        ha.context.elicitationServer,
        rangeDisplay
      );
      if (elicited && isElicitableRulePreset(elicited.preset)) {
        resolvedInput = { ...input, rulePreset: elicited.preset };
      }
    }
    if (!resolvedInput.rulePreset) {
      resolvedInput = { ...resolvedInput, rulePreset: 'highlight_blanks' };
    }
  }

  const gridRange = await ha.resolveGridRange(
    resolvedInput.spreadsheetId,
    resolvedInput.sheetId as number,
    resolvedInput.range!
  );
  const googleRange = toGridRange(gridRange);

  // Idempotency guard: check if an identical rule already exists
  try {
    const existing = await ha.api.spreadsheets.get({
      spreadsheetId: resolvedInput.spreadsheetId,
      fields: 'sheets.conditionalFormats,sheets.properties.sheetId',
    });

    const sheet = existing.data.sheets?.find(
      (s) => s.properties?.sheetId === resolvedInput.sheetId
    );
    const existingRules = sheet?.conditionalFormats ?? [];

    for (const rule of existingRules) {
      // Check if rule has same range and same preset type
      const ruleRange = rule.ranges?.[0];
      if (
        ruleRange &&
        ruleRange.sheetId === gridRange.sheetId &&
        ruleRange.startRowIndex === gridRange.startRowIndex &&
        ruleRange.endRowIndex === gridRange.endRowIndex &&
        ruleRange.startColumnIndex === gridRange.startColumnIndex &&
        ruleRange.endColumnIndex === gridRange.endColumnIndex
      ) {
        // Check if rule type matches the preset
        let presetMatches = false;
        switch (resolvedInput.rulePreset) {
          case 'highlight_duplicates':
            presetMatches = !!(
              rule.booleanRule?.condition?.type === 'CUSTOM_FORMULA' &&
              rule.booleanRule?.condition?.values?.[0]?.userEnteredValue?.includes('COUNTIF')
            );
            break;
          case 'highlight_blanks':
            presetMatches = rule.booleanRule?.condition?.type === 'BLANK' || false;
            break;
          case 'highlight_errors':
            presetMatches = !!(
              rule.booleanRule?.condition?.type === 'CUSTOM_FORMULA' &&
              rule.booleanRule?.condition?.values?.[0]?.userEnteredValue?.includes('ISERROR')
            );
            break;
          case 'color_scale_green_red':
          case 'color_scale_blue_red':
          case 'data_bars':
          case 'traffic_light':
            presetMatches = !!rule.gradientRule;
            break;
          case 'top_10_percent':
          case 'bottom_10_percent':
          case 'above_average':
          case 'below_average':
          case 'negative_red_positive_green':
          case 'variance_highlight':
            presetMatches = !!rule.booleanRule?.condition?.type;
            break;
        }

        if (presetMatches) {
          return ha.makeSuccess('add_conditional_format_rule', {
            ruleIndex: existingRules.indexOf(rule),
            _idempotent: true,
            _hint: `A conditional format rule with preset "${resolvedInput.rulePreset}" already exists for this range. Returning existing rule index.`,
          });
        }
      }
    }
  } catch {
    // Non-blocking: proceed with creation if check fails
  }

  let request: sheets_v4.Schema$Request;

  switch (resolvedInput.rulePreset!) {
    case 'highlight_duplicates':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=COUNTIF($A:$A,A1)>1' }],
              },
              format: { backgroundColor: { red: 1, green: 0.9, blue: 0.9 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'highlight_blanks':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: { type: 'BLANK' },
              format: { backgroundColor: { red: 1, green: 1, blue: 0.8 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'highlight_errors':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=ISERROR(A1)' }],
              },
              format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'color_scale_green_red':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            gradientRule: {
              minpoint: {
                type: 'MIN',
                color: { red: 0.8, green: 1, blue: 0.8 },
              },
              maxpoint: {
                type: 'MAX',
                color: { red: 1, green: 0.8, blue: 0.8 },
              },
            },
          },
          index: 0,
        },
      };
      break;

    case 'color_scale_blue_red':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            gradientRule: {
              minpoint: {
                type: 'MIN',
                color: { red: 0.8, green: 0.8, blue: 1 },
              },
              maxpoint: {
                type: 'MAX',
                color: { red: 1, green: 0.8, blue: 0.8 },
              },
            },
          },
          index: 0,
        },
      };
      break;

    case 'data_bars':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            gradientRule: {
              minpoint: { type: 'MIN', color: { red: 1, green: 1, blue: 1 } },
              maxpoint: {
                type: 'MAX',
                color: { red: 0.2, green: 0.6, blue: 0.9 },
              },
            },
          },
          index: 0,
        },
      };
      break;

    case 'top_10_percent':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=A1>=PERCENTILE($A:$A,0.9)' }],
              },
              format: { backgroundColor: { red: 0.8, green: 1, blue: 0.8 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'bottom_10_percent':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=A1<=PERCENTILE($A:$A,0.1)' }],
              },
              format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'above_average':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=A1>AVERAGE($A:$A)' }],
              },
              format: { backgroundColor: { red: 0.8, green: 1, blue: 0.8 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'below_average':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: '=A1<AVERAGE($A:$A)' }],
              },
              format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } },
            },
          },
          index: 0,
        },
      };
      break;

    case 'negative_red_positive_green': {
      const negativeRule: sheets_v4.Schema$Request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'NUMBER_LESS',
                values: [{ userEnteredValue: '0' }],
              },
              format: {
                backgroundColor: { red: 1, green: 0.85, blue: 0.85 },
                textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } },
              },
            },
          },
          index: 0,
        },
      };
      const positiveRule: sheets_v4.Schema$Request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'NUMBER_GREATER',
                values: [{ userEnteredValue: '0' }],
              },
              format: {
                backgroundColor: { red: 0.85, green: 1, blue: 0.85 },
                textFormat: { foregroundColor: { red: 0, green: 0.5, blue: 0 } },
              },
            },
          },
          index: 1,
        },
      };
      await ha.api.spreadsheets.batchUpdate({
        spreadsheetId: resolvedInput.spreadsheetId,
        requestBody: { requests: [negativeRule, positiveRule] },
      });

      // Record operation in session context for LLM follow-up references
      try {
        if (ha.context.sessionContext) {
          ha.context.sessionContext.recordOperation({
            tool: 'sheets_format',
            action: 'add_conditional_format_rule',
            spreadsheetId: resolvedInput.spreadsheetId,
            description: `Added conditional format rule preset: ${resolvedInput.rulePreset}`,
            undoable: false,
          });
        }
      } catch {
        // Non-blocking: session context recording is best-effort
      }

      return ha.makeSuccess('add_conditional_format_rule', { ruleIndex: 0, rulesAdded: 2 });
    }

    case 'traffic_light':
      request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            gradientRule: {
              minpoint: {
                type: 'MIN',
                color: { red: 1, green: 0.8, blue: 0.8 },
              },
              midpoint: {
                type: 'PERCENTILE',
                value: '50',
                color: { red: 1, green: 1, blue: 0.7 },
              },
              maxpoint: {
                type: 'MAX',
                color: { red: 0.8, green: 1, blue: 0.8 },
              },
            },
          },
          index: 0,
        },
      };
      break;

    case 'variance_highlight': {
      const negVarRule: sheets_v4.Schema$Request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'NUMBER_LESS',
                values: [{ userEnteredValue: '-0.1' }],
              },
              format: {
                backgroundColor: { red: 1, green: 0.85, blue: 0.85 },
                textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } },
              },
            },
          },
          index: 0,
        },
      };
      const posVarRule: sheets_v4.Schema$Request = {
        addConditionalFormatRule: {
          rule: {
            ranges: [googleRange],
            booleanRule: {
              condition: {
                type: 'NUMBER_GREATER',
                values: [{ userEnteredValue: '0.1' }],
              },
              format: {
                backgroundColor: { red: 0.85, green: 1, blue: 0.85 },
                textFormat: { foregroundColor: { red: 0, green: 0.5, blue: 0 } },
              },
            },
          },
          index: 1,
        },
      };
      await ha.api.spreadsheets.batchUpdate({
        spreadsheetId: resolvedInput.spreadsheetId,
        requestBody: { requests: [negVarRule, posVarRule] },
      });

      // Record operation in session context for LLM follow-up references
      try {
        if (ha.context.sessionContext) {
          ha.context.sessionContext.recordOperation({
            tool: 'sheets_format',
            action: 'add_conditional_format_rule',
            spreadsheetId: resolvedInput.spreadsheetId,
            description: `Added conditional format rule preset: ${resolvedInput.rulePreset}`,
            undoable: false,
          });
        }
      } catch {
        // Non-blocking: session context recording is best-effort
      }

      return ha.makeSuccess('add_conditional_format_rule', { ruleIndex: 0, rulesAdded: 2 });
    }

    default:
      return ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: `Unknown conditional format preset: "${resolvedInput.rulePreset}". Available presets: highlight_duplicates, highlight_blanks, highlight_errors, color_scale, data_bar, above_average, top_n, positive_negative, traffic_light, variance_highlight`,
        retryable: false,
        suggestedFix:
          'Use one of the listed presets, or use rule_add_conditional_format for custom rules',
      });
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: resolvedInput.spreadsheetId,
    requestBody: { requests: [request] },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_format',
        action: 'add_conditional_format_rule',
        spreadsheetId: resolvedInput.spreadsheetId,
        description: `Added conditional format rule preset: ${resolvedInput.rulePreset}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.makeSuccess('add_conditional_format_rule', { ruleIndex: 0 });
}

// ─── handleGenerateConditionalFormat ─────────────────────────────────────────

export async function handleGenerateConditionalFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'generate_conditional_format' }
): Promise<FormatResponse> {
  const {
    spreadsheetId,
    description,
    applyImmediately = true,
  } = input as {
    spreadsheetId: string;
    description: string;
    range: unknown;
    sheetId?: number;
    applyImmediately?: boolean;
  };
  const range = (input as Record<string, unknown>)['range'] as unknown;

  // BUG-7 fix: Resolve sheetId from range when not explicitly provided.
  // Previously defaulted to 0, which may not match the target sheet and
  // could produce NaN when sheet names with spaces fail parseInt.
  let sheetId = (input as Record<string, unknown>)['sheetId'] as number | undefined;
  if (sheetId === undefined || sheetId === null || Number.isNaN(sheetId)) {
    try {
      const rangeStr = typeof range === 'string' ? range : (range as { a1?: string })?.a1;
      if (rangeStr) {
        const parsed = parseA1Notation(rangeStr);
        if (parsed.sheetName) {
          sheetId = await ha.getSheetId(spreadsheetId, parsed.sheetName);
        }
      }
    } catch {
      // Fall through to default
    }
    if (sheetId === undefined || sheetId === null || Number.isNaN(sheetId)) {
      sheetId = 0;
    }
  }

  const parsed = parseNLConditionalFormat(description);
  if (!parsed.success) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Could not parse conditional format description: "${description}". ${parsed.hint}`,
      retryable: false,
      suggestedFix:
        'Try: "highlight values greater than 100 in red", "color scale green to red", "highlight blanks in yellow", "above average in green"',
    });
  }

  if (!applyImmediately) {
    return ha.makeSuccess('generate_conditional_format', {
      generatedRule: parsed.rule,
      message: `Rule generated (not applied). Set applyImmediately:true to apply.`,
    });
  }

  if (parsed.rulePreset) {
    return handleAddConditionalFormatRule(ha, {
      spreadsheetId,
      sheetId,
      range,
      rulePreset: parsed.rulePreset,
      action: 'add_conditional_format_rule',
    } as FormatRequest & { action: 'add_conditional_format_rule' });
  }

  if (parsed.rule) {
    return handleRuleAddConditionalFormat(ha, {
      spreadsheetId,
      sheetId,
      range,
      rule: parsed.rule,
      action: 'rule_add_conditional_format',
    } as FormatRequest & { action: 'rule_add_conditional_format' });
  }

  return ha.makeError({
    code: ErrorCodes.INTERNAL_ERROR,
    message: 'Rule parsing produced no output',
    retryable: false,
    suggestedFix: 'Use add_conditional_format_rule directly with a preset',
  });
}

// Re-export for submodule use
export type { ConditionType };
