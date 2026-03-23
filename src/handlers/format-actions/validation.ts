/**
 * Data validation and suggest_format action handlers:
 * set_data_validation, clear_data_validation, list_data_validations, suggest_format
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { buildGridRangeInput, toGridRange } from '../../utils/google-sheets-helpers.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import {
  assertSamplingConsent,
  checkSamplingSupport,
  withSamplingTimeout,
  generateAIInsight,
} from '../../mcp/sampling.js';
import { isLLMFallbackAvailable, createMessageWithFallback } from '../../services/llm-fallback.js';
import type { FormatResponse, FormatRequest } from '../../schemas/index.js';
import type { FormatHandlerAccess, ConditionType } from './internal.js';

// ─── handleSetDataValidation ──────────────────────────────────────────────────

export async function handleSetDataValidation(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'set_data_validation' }
): Promise<FormatResponse> {
  const gridRange = await ha.resolveRangeInput(input.spreadsheetId, input.range!);

  const condition: sheets_v4.Schema$BooleanCondition = {
    type: input.condition!.type,
  };

  if (input.condition!.values && input.condition!.values.length > 0) {
    condition.values = input.condition!.values.map((v) => ({
      userEnteredValue: v,
    }));
  }

  await ha.api.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: toGridRange(gridRange),
            rule: {
              condition,
              inputMessage: input.inputMessage,
              strict: input.strict ?? true,
              showCustomUi: input.showDropdown ?? true,
            },
          },
        },
      ],
    },
  });

  return ha.makeSuccess('set_data_validation', {});
}

// ─── handleClearDataValidation ────────────────────────────────────────────────

export async function handleClearDataValidation(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'clear_data_validation' }
): Promise<FormatResponse> {
  if (input.safety?.dryRun) {
    return ha.makeSuccess('clear_data_validation', {}, undefined, true);
  }

  const gridRange = await ha.resolveRangeInput(input.spreadsheetId, input.range!);

  // Safety: confirm before clearing data validation rules
  if (ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'clear_data_validation',
      `Clear all data validation rules from the specified range in spreadsheet ${input.spreadsheetId}. Dropdown lists and validation constraints will be removed.`
    );
    if (!confirmation.confirmed) {
      return ha.makeSuccess('clear_data_validation', {
        _cancelled: true,
        reason: confirmation.reason || 'User cancelled the operation',
      });
    }
  }

  const snapshot = await createSnapshotIfNeeded(
    ha.context.snapshotService,
    {
      operationType: 'rule_clear_data_validation',
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
          setDataValidation: {
            range: toGridRange(gridRange),
            // Omitting rule clears validation
          },
        },
      ],
    },
  });

  return ha.makeSuccess('clear_data_validation', {
    snapshotId: snapshot?.snapshotId,
  });
}

// ─── handleListDataValidations ────────────────────────────────────────────────

export async function handleListDataValidations(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'list_data_validations' }
): Promise<FormatResponse> {
  let rangeStr: string | undefined;
  if (input.range) {
    if (typeof input.range === 'string') {
      rangeStr = input.range;
    } else if ('a1' in input.range) {
      rangeStr = input.range.a1;
    } else if ('namedRange' in input.range) {
      rangeStr = input.range.namedRange;
    } else {
      rangeStr = 'A1:ZZ1000';
    }
  }

  const ranges = rangeStr ? [rangeStr] : [];

  if (!rangeStr) {
    const metaResponse = await ha.api.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      includeGridData: false,
      fields: 'sheets(properties(sheetId,gridProperties))',
    });
    const metaSheet = metaResponse.data.sheets?.find(
      (s) => s.properties?.sheetId === input.sheetId
    );
    if (!metaSheet?.properties?.gridProperties) {
      return ha.makeError({
        code: ErrorCodes.SHEET_NOT_FOUND,
        message: `Sheet with ID ${input.sheetId} not found`,
        retryable: false,
        suggestedFix: 'Verify the sheet name or ID is correct',
      });
    }
    const rowCount = metaSheet.properties.gridProperties.rowCount ?? 1000;
    const colCount = metaSheet.properties.gridProperties.columnCount ?? 26;
    const totalCells = rowCount * colCount;
    if (totalCells > 10000) {
      return ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: `Sheet has ${totalCells.toLocaleString()} cells (${rowCount}×${colCount}). Provide 'range' parameter to prevent timeout.`,
        resolution: `Specify a range parameter to limit scan area (e.g., range: "A1:Z100"). For best performance, use ranges <10K cells.`,
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }
  }

  const response = await ha.api.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    ranges,
    includeGridData: true,
    fields: 'sheets(properties(sheetId,gridProperties),data.rowData.values.dataValidation)',
  });

  const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
  if (!sheet?.properties?.gridProperties) {
    return ha.makeError({
      code: ErrorCodes.SHEET_NOT_FOUND,
      message: `Sheet with ID ${input.sheetId} not found`,
      retryable: false,
      suggestedFix: 'Verify the sheet name or ID is correct',
    });
  }

  const sheetData = sheet;
  const allValidations: Array<{
    range: {
      sheetId: number;
      startRowIndex?: number;
      endRowIndex?: number;
      startColumnIndex?: number;
      endColumnIndex?: number;
    };
    condition: { type: ConditionType; values?: string[] };
  }> = [];

  sheetData?.data?.forEach((data) => {
    const startRowIndex = data.startRow ?? 0;
    const startColumnIndex = data.startColumn ?? 0;

    data.rowData?.forEach((row, rowIdx) => {
      row.values?.forEach((cell, colIdx) => {
        if (cell.dataValidation?.condition) {
          const condType = cell.dataValidation.condition.type as ConditionType;
          const absoluteRow = startRowIndex + rowIdx;
          const absoluteCol = startColumnIndex + colIdx;

          allValidations.push({
            range: buildGridRangeInput(
              input.sheetId!,
              absoluteRow,
              absoluteRow + 1,
              absoluteCol,
              absoluteCol + 1
            ),
            condition: {
              type: condType,
              values: cell.dataValidation.condition.values?.map((v) => v.userEnteredValue ?? ''),
            },
          });
        }
      });
    });
  });

  const pageLimit = (input as { limit?: number; cursor?: string }).limit ?? 50;
  const offset = (input as { limit?: number; cursor?: string }).cursor
    ? parseInt((input as { limit?: number; cursor?: string }).cursor!, 10)
    : 0;
  const totalCount = allValidations.length;
  const validations = allValidations.slice(offset, offset + pageLimit);
  const hasMore = offset + pageLimit < totalCount;
  const nextCursor = hasMore ? String(offset + pageLimit) : undefined;

  return ha.makeSuccess('list_data_validations', {
    validations,
    totalCount,
    hasMore,
    ...(nextCursor !== undefined && { nextCursor }),
    ...(input.range && { scannedRange: ranges[0] }),
  });
}

// ─── handleSuggestFormat ──────────────────────────────────────────────────────

export async function handleSuggestFormat(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'suggest_format' }
): Promise<FormatResponse> {
  const startTime = Date.now();

  const rangeStr =
    typeof input.range === 'string'
      ? input.range
      : input.range && 'a1' in input.range
        ? input.range.a1
        : 'A1';

  let gridData: sheets_v4.Schema$GridData | undefined;
  try {
    const response = await ha.api.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      ranges: [rangeStr],
      includeGridData: true,
      fields: 'sheets.data.rowData.values(formattedValue,effectiveValue,effectiveFormat)',
    });

    const sheet = response.data.sheets?.[0];
    gridData = sheet?.data?.[0];
    if (!gridData || !gridData.rowData || gridData.rowData.length === 0) {
      return ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Range contains no data',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }
  } catch (error) {
    return ha.makeError({
      code: ErrorCodes.INTERNAL_ERROR,
      message: `Failed to fetch range data: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      suggestedFix: 'Please try again. If the issue persists, contact support',
    });
  }

  const samplingSupport = ha.context.server
    ? checkSamplingSupport(ha.context.server.getClientCapabilities?.())
    : { supported: false };
  const hasLLMFallback = isLLMFallbackAvailable();

  if (!hasLLMFallback && (!ha.context.server || !samplingSupport.supported)) {
    return handleSuggestFormatRuleBased(ha, input, gridData.rowData);
  }

  try {
    const sampleRows = gridData.rowData.slice(0, 10);
    const sampleData = sampleRows.map(
      (row) => row.values?.map((cell) => cell.formattedValue || cell.effectiveValue) || []
    );

    const currentFormats = sampleRows.slice(0, 3).map(
      (row) =>
        row.values?.map((cell) => ({
          backgroundColor: cell.effectiveFormat?.backgroundColor,
          textFormat: cell.effectiveFormat?.textFormat,
          numberFormat: cell.effectiveFormat?.numberFormat,
        })) || []
    );

    const prompt = `Analyze this spreadsheet data and suggest the ${input.maxSuggestions || 3} best formatting options to improve readability and visual hierarchy.

**Data range:** ${rangeStr}
**Row count:** ${gridData.rowData.length}
**Column count:** ${gridData.rowData[0]?.values?.length || 0}

**Sample data (first 10 rows):**
\`\`\`json
${JSON.stringify(sampleData, null, 2)}
\`\`\`

**Current formatting (first 3 rows):**
\`\`\`json
${JSON.stringify(currentFormats, null, 2)}
\`\`\`

For each formatting suggestion, provide:
1. A descriptive title
2. Clear explanation of how this improves the presentation
3. Confidence score (0-100)
4. Reasoning for this formatting choice
5. Format options:
   - Background color (RGB object, optional)
   - Text format (bold, italic, fontSize, fontFamily, optional)
   - Number format (type and pattern, optional)
   - Borders (boolean, optional)
   - Alignment (LEFT, CENTER, RIGHT, optional)

Format your response as JSON:
{
  "suggestions": [
    {
      "title": "Header Row Formatting",
      "explanation": "Makes column headers stand out with bold text and colored background",
      "confidence": 95,
      "reasoning": "First row appears to be headers based on text content",
      "formatOptions": {
        "backgroundColor": {"red": 0.85, "green": 0.85, "blue": 0.85},
        "textFormat": {"bold": true, "fontSize": 11},
        "alignment": "CENTER"
      }
    }
  ]
}`;

    const systemPrompt = `You are an expert in spreadsheet design and data visualization.
Analyze spreadsheet content and formatting to suggest improvements for readability and visual hierarchy.
Consider data types, patterns, and best practices for professional spreadsheet design.
Always return valid JSON in the exact format requested.`;

    const llmResult = await createMessageWithFallback(
      ha.context.server as Parameters<typeof createMessageWithFallback>[0],
      {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt,
        maxTokens: 2048,
      }
    );
    const duration = Date.now() - startTime;

    const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return handleSuggestFormatRuleBased(ha, input, gridData.rowData);
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      suggestions?: Array<{
        title: string;
        explanation: string;
        confidence: number;
        reasoning: string;
        formatOptions: Record<string, unknown>;
      }>;
    };
    let suggestions = parsed.suggestions ?? [];

    try {
      if (ha.context.sessionContext && suggestions.length > 0) {
        const filtered = [];
        for (const suggestion of suggestions) {
          const title = suggestion.title ?? '';
          const avoided = await ha.context.sessionContext.shouldAvoidSuggestion(title);
          if (!avoided) {
            filtered.push(suggestion);
          }
        }
        suggestions = filtered;
      }
    } catch {
      /* non-blocking */
    }

    if (ha.context.samplingServer && suggestions.length > 0) {
      try {
        await assertSamplingConsent();
        const settled = await Promise.allSettled(
          suggestions.map(async (suggestion) => {
            try {
              const rationaleResult = await withSamplingTimeout(() =>
                ha.context.samplingServer!.createMessage({
                  messages: [
                    {
                      role: 'user' as const,
                      content: {
                        type: 'text' as const,
                        text: `In one concise sentence, explain why "${suggestion.title}" is a good formatting choice for this spreadsheet data.`,
                      },
                    },
                  ],
                  maxTokens: 128,
                })
              );
              const rationaleText = Array.isArray(rationaleResult.content)
                ? ((
                    rationaleResult.content.find((c) => c.type === 'text') as
                      | { text: string }
                      | undefined
                  )?.text ?? '')
                : ((rationaleResult.content as { text?: string }).text ?? '');
              return { ...suggestion, aiRationale: rationaleText.trim() };
            } catch {
              return suggestion;
            }
          })
        );
        suggestions = settled
          .filter(
            (r): r is PromiseFulfilledResult<(typeof suggestions)[number]> =>
              r.status === 'fulfilled'
          )
          .map((r) => r.value);
      } catch {
        /* non-blocking */
      }
    }

    try {
      if (ha.context.sessionContext && suggestions.length > 0) {
        ha.context.sessionContext.recordOperation({
          tool: 'sheets_format',
          action: 'suggest_format',
          spreadsheetId: input.spreadsheetId,
          description: `Generated ${suggestions.length} format suggestions for ${input.range ?? 'spreadsheet'}`,
          undoable: false,
        });
      }
    } catch {
      /* non-blocking */
    }

    let explanation: string | undefined;
    try {
      if (ha.context.samplingServer && suggestions.length > 0) {
        const suggestionsText = suggestions
          .slice(0, 3)
          .map((s) => `${s.title}: ${s.explanation}`)
          .join('; ');
        explanation = await generateAIInsight(
          ha.context.samplingServer,
          'dataAnalysis',
          `Explain why these format suggestions improve readability and data comprehension: ${suggestionsText}`,
          { column_count: sampleRows[0]?.values?.length ?? 0, row_count: sampleRows.length }
        );
      }
    } catch {
      /* non-blocking - explanation is optional */
    }

    return ha.makeSuccess('suggest_format', {
      suggestions,
      explanation,
      _meta: {
        duration,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    return handleSuggestFormatRuleBased(ha, input, gridData.rowData);
  }
}

// ─── handleSuggestFormatRuleBased ─────────────────────────────────────────────

async function handleSuggestFormatRuleBased(
  ha: FormatHandlerAccess,
  input: FormatRequest & { action: 'suggest_format' },
  prefetchedRows?: sheets_v4.Schema$RowData[]
): Promise<FormatResponse> {
  let rows: sheets_v4.Schema$RowData[];

  if (prefetchedRows) {
    rows = prefetchedRows;
  } else {
    let rangeStr: string;
    if (typeof input.range === 'string') {
      rangeStr = input.range;
    } else if (input.range && 'a1' in input.range) {
      rangeStr = input.range.a1 ?? 'A1:Z10';
    } else {
      try {
        const metaResp = await ha.api.spreadsheets.get({
          spreadsheetId: input.spreadsheetId,
          fields: 'sheets(properties(title,gridProperties(columnCount)))',
        });
        const firstSheet = metaResp.data.sheets?.[0];
        const colCount = Math.min(firstSheet?.properties?.gridProperties?.columnCount ?? 26, 100);
        const colLetter = String.fromCharCode(64 + Math.min(colCount, 26));
        const title = firstSheet?.properties?.title ?? 'Sheet1';
        const escaped = title.replace(/'/g, "''");
        rangeStr = `'${escaped}'!A1:${colLetter}10`;
      } catch {
        rangeStr = 'A1:Z10';
      }
    }

    const response = await ha.api.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      ranges: [rangeStr],
      includeGridData: true,
      fields: 'sheets.data.rowData.values(formattedValue,effectiveValue)',
    });

    const sheet = response.data.sheets?.[0];
    rows = sheet?.data?.[0]?.rowData ?? [];
  }

  const suggestions: Array<{
    title: string;
    explanation: string;
    confidence: number;
    reasoning: string;
    formatOptions: Record<string, unknown>;
  }> = [];

  const firstRow = rows[0]?.values ?? [];
  const secondRow = rows[1]?.values ?? [];
  const firstRowIsText =
    firstRow.length > 0 &&
    firstRow.every((c) => c.formattedValue && isNaN(Number(c.formattedValue)));
  const secondRowHasNumbers = secondRow.some((c) => c.effectiveValue?.numberValue !== undefined);
  if (firstRowIsText && secondRowHasNumbers) {
    suggestions.push({
      title: 'Header Row Formatting',
      explanation: 'Make column headers stand out with bold text and a light background',
      confidence: 85,
      reasoning:
        'First row contains text labels while subsequent rows have numeric data — classic header pattern',
      formatOptions: {
        backgroundColor: { red: 0.85, green: 0.85, blue: 0.85 },
        textFormat: { bold: true, fontSize: 11 },
        alignment: 'CENTER',
      },
    });
  }

  const hasNumbers = rows
    .slice(1)
    .some((r) => r.values?.some((c) => c.effectiveValue?.numberValue !== undefined));
  if (hasNumbers) {
    suggestions.push({
      title: 'Number Formatting',
      explanation: 'Apply consistent number formatting to numeric columns',
      confidence: 70,
      reasoning: 'Numeric data detected — standardized formatting improves readability',
      formatOptions: {
        numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
      },
    });
  }

  if (rows.length > 3) {
    suggestions.push({
      title: 'Alternating Row Colors',
      explanation: 'Add alternating light/white row backgrounds to improve readability',
      confidence: 60,
      reasoning: 'Tables with more than 3 rows benefit from banding to track rows visually',
      formatOptions: {
        banding: {
          headerColor: { red: 0.85, green: 0.85, blue: 0.85 },
          firstBandColor: { red: 1, green: 1, blue: 1 },
          secondBandColor: { red: 0.95, green: 0.95, blue: 0.95 },
        },
      },
    });
  }

  return ha.makeSuccess('suggest_format', {
    suggestions,
    _meta: {
      duration: 0,
      timestamp: new Date().toISOString(),
      source: 'rule-based-fallback',
    },
  });
}
