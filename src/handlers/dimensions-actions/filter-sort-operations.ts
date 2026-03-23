/**
 * Filter / Sort / Range-utility action handlers for sheets_dimensions.
 * Covers: set_basic_filter, clear_basic_filter, get_basic_filter, sort_range,
 *         trim_whitespace, randomize_range, text_to_columns, auto_fill
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type {
  DimensionsSetBasicFilterInput,
  DimensionsClearBasicFilterInput,
  DimensionsGetBasicFilterInput,
  DimensionsSortRangeInput,
  DimensionsDeleteDuplicatesInput,
  DimensionsTrimWhitespaceInput,
  DimensionsRandomizeRangeInput,
  DimensionsTextToColumnsInput,
  DimensionsAutoFillInput,
  DimensionsResponse,
} from '../../schemas/index.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import { mapDimensionsCriteria } from '../dimensions-filter-helpers.js';
import type { DimensionsHandlerAccess } from './internal.js';

// ─── handleSetBasicFilter ─────────────────────────────────────────────────────

export async function handleSetBasicFilter(
  ha: DimensionsHandlerAccess,
  input: DimensionsSetBasicFilterInput
): Promise<DimensionsResponse> {
  // v2.0: Enhanced to support incremental updates via optional columnIndex parameter
  // If columnIndex provided: update only that column's criteria (incremental)
  // If columnIndex omitted: replace entire filter (original behavior)

  if (input.columnIndex !== undefined) {
    // Incremental update: merge criteria for specific column
    const currentFilterResponse = await handleGetBasicFilter(ha, {
      action: 'get_basic_filter',
      spreadsheetId: input.spreadsheetId,
      sheetId: input.sheetId,
      verbosity: 'minimal',
    });

    if (!currentFilterResponse.success || !currentFilterResponse.filter) {
      return ha.error({
        code: ErrorCodes.FAILED_PRECONDITION,
        message: 'Cannot update filter criteria: No basic filter exists on this sheet',
        category: 'client',
        severity: 'medium',
        retryable: false,
        suggestedFix: 'Ensure all preconditions are met before retrying',
        resolution:
          'Create a filter first using set_basic_filter without columnIndex, then add criteria',
      });
    }

    // Merge new criteria for the specific column
    // Extract the criteria for the target column: try exact column key first, then take the first entry
    const columnCriteria =
      input.criteria?.[input.columnIndex] ??
      (input.criteria ? Object.values(input.criteria)[0] : undefined) ??
      {};
    const updatedCriteria = {
      ...currentFilterResponse.filter.criteria,
      [input.columnIndex]: columnCriteria,
    };

    await ha.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      fields: 'replies',
      requestBody: {
        requests: [
          {
            setBasicFilter: {
              filter: {
                range: currentFilterResponse.filter.range,
                criteria: mapDimensionsCriteria(updatedCriteria),
              },
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (ha.context.sessionContext) {
        ha.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'set_basic_filter',
          spreadsheetId: input.spreadsheetId,
          description: `Set basic filter criteria`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return ha.success('set_basic_filter', {
      message: `Updated filter criteria for column ${input.columnIndex}`,
      columnIndex: input.columnIndex,
    });
  }

  // Full filter replacement (original behavior)
  const gridRange = input.range
    ? await ha.rangeToGridRange(input.spreadsheetId, input.range, ha.sheetsApi)
    : { sheetId: input.sheetId };

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          setBasicFilter: {
            filter: {
              range: toGridRange(gridRange),
              criteria: input.criteria ? mapDimensionsCriteria(input.criteria) : undefined,
            },
          },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'set_basic_filter',
        spreadsheetId: input.spreadsheetId,
        description: `Set basic filter`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('set_basic_filter', {});
}

// ─── handleClearBasicFilter ───────────────────────────────────────────────────

export async function handleClearBasicFilter(
  ha: DimensionsHandlerAccess,
  input: DimensionsClearBasicFilterInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('clear_basic_filter', {}, undefined, true);
  }

  // Safety: snapshot BEFORE confirmation (backup must exist before user approves)
  await createSnapshotIfNeeded(
    ha.context.snapshotService,
    {
      operationType: 'clear_basic_filter',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  if (ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'clear_basic_filter',
      `Remove the basic filter from sheet ${input.sheetId} in spreadsheet ${input.spreadsheetId}. Filtered rows will become visible again.`
    );
    if (!confirmation.confirmed) {
      return ha.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          clearBasicFilter: { sheetId: input.sheetId },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'clear_basic_filter',
        spreadsheetId: input.spreadsheetId,
        description: `Cleared basic filter`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('clear_basic_filter', {});
}

// ─── handleGetBasicFilter ─────────────────────────────────────────────────────

export async function handleGetBasicFilter(
  ha: DimensionsHandlerAccess,
  input: DimensionsGetBasicFilterInput
): Promise<DimensionsResponse> {
  const response = await ha.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.basicFilter',
  });

  for (const sheet of response.data.sheets ?? []) {
    if (sheet.properties?.sheetId === input.sheetId && sheet.basicFilter) {
      return ha.success('get_basic_filter', {
        filter: {
          range: ha.gridRangeToOutput(sheet.basicFilter.range ?? { sheetId: input.sheetId }),
          criteria: sheet.basicFilter.criteria ?? {},
        },
      });
    }
  }

  return ha.success('get_basic_filter', {});
}

// ─── handleSortRange ──────────────────────────────────────────────────────────

export async function handleSortRange(
  ha: DimensionsHandlerAccess,
  input: DimensionsSortRangeInput
): Promise<DimensionsResponse> {
  let resolvedInput = input;

  // Wizard: If range is provided but sortSpecs is missing, elicit sort direction
  if (resolvedInput.range && (!resolvedInput.sortSpecs || resolvedInput.sortSpecs.length === 0)) {
    if (ha.context?.server?.elicitInput) {
      try {
        const wizard = await ha.context.server.elicitInput({
          message: 'Range ready to sort. Which direction?',
          requestedSchema: {
            type: 'object',
            properties: {
              direction: {
                type: 'string',
                title: 'Sort direction',
                description: 'Sort ascending (A→Z) or descending (Z→A)?',
                enum: ['ASCENDING', 'DESCENDING'],
              },
            },
          },
        });
        const wizardContent = wizard?.content as Record<string, unknown> | undefined;
        const direction =
          wizardContent?.['direction'] === 'ASCENDING' ||
          wizardContent?.['direction'] === 'DESCENDING'
            ? wizardContent['direction']
            : undefined;
        if (wizard?.action === 'accept' && direction) {
          // Create default sort spec for first column with chosen direction
          resolvedInput = {
            ...resolvedInput,
            sortSpecs: [
              {
                columnIndex: 0,
                sortOrder: direction,
              },
            ],
          };
        }
      } catch {
        // Elicitation not available — use default ascending if still missing
        if (!resolvedInput.sortSpecs || resolvedInput.sortSpecs.length === 0) {
          resolvedInput = {
            ...resolvedInput,
            sortSpecs: [{ columnIndex: 0, sortOrder: 'ASCENDING' as const }],
          };
        }
      }
    }
  }

  // Fallback: ensure sortSpecs is always defined
  if (!resolvedInput.sortSpecs || resolvedInput.sortSpecs.length === 0) {
    resolvedInput = {
      ...resolvedInput,
      sortSpecs: [{ columnIndex: 0, sortOrder: 'ASCENDING' as const }],
    };
  }

  const gridRange = await ha.rangeToGridRange(
    resolvedInput.spreadsheetId,
    resolvedInput.range,
    ha.sheetsApi
  );

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: resolvedInput.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          sortRange: {
            range: toGridRange(gridRange),
            sortSpecs: resolvedInput.sortSpecs.map((spec) => ({
              dimensionIndex: spec.columnIndex,
              sortOrder: spec.sortOrder ?? 'ASCENDING',
              foregroundColor: spec.foregroundColor,
              backgroundColor: spec.backgroundColor,
            })),
          },
        },
      ],
    },
  });

  const rangeStr =
    typeof resolvedInput.range === 'string'
      ? resolvedInput.range
      : ((resolvedInput.range as { a1?: string }).a1 ?? '');

  // Wire session context: note that data was sorted
  try {
    if (ha.context.sessionContext) {
      const sortDesc = resolvedInput.sortSpecs
        .map((s) => `col ${s.columnIndex} ${s.sortOrder ?? 'ASCENDING'}`)
        .join(', ');
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'sort_range',
        spreadsheetId: resolvedInput.spreadsheetId,
        range: rangeStr,
        description: `Sorted range ${rangeStr} by: ${sortDesc}`,
        undoable: true,
      });
    }
  } catch {
    /* non-blocking */
  }

  return ha.success('sort_range', {});
}

// ─── handleDeleteDuplicates ───────────────────────────────────────────────────

export async function handleDeleteDuplicates(
  ha: DimensionsHandlerAccess,
  input: DimensionsDeleteDuplicatesInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('delete_duplicates', { rowsAffected: 0 }, undefined, true);
  }

  // Safety: snapshot BEFORE confirmation (backup must exist before user approves)
  await createSnapshotIfNeeded(
    ha.context.snapshotService,
    {
      operationType: 'delete_duplicates',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  if (ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'delete_duplicates',
      `Remove duplicate rows from range ${input.range} in spreadsheet ${input.spreadsheetId}. Duplicate rows will be permanently deleted.`
    );
    if (!confirmation.confirmed) {
      return ha.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  const gridRange = await ha.rangeToGridRange(input.spreadsheetId, input.range, ha.sheetsApi);
  const resolvedRange = toGridRange(gridRange);

  const comparisonColumns =
    input.comparisonColumns && input.comparisonColumns.length > 0
      ? input.comparisonColumns.map((colIndex) => ({
          sheetId: resolvedRange.sheetId,
          dimension: 'COLUMNS' as const,
          startIndex: (resolvedRange.startColumnIndex ?? 0) + colIndex,
          endIndex: (resolvedRange.startColumnIndex ?? 0) + colIndex + 1,
        }))
      : undefined;

  const response = await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          deleteDuplicates: {
            range: resolvedRange,
            comparisonColumns,
          },
        },
      ],
    },
  });

  const rowsAffected = response.data?.replies?.[0]?.deleteDuplicates?.duplicatesRemovedCount ?? 0;

  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'delete_duplicates',
        spreadsheetId: input.spreadsheetId,
        description: `Removed ${rowsAffected} duplicate row(s) from ${input.range}`,
        undoable: true,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('delete_duplicates', { rowsAffected });
}

// ─── handleTrimWhitespace ─────────────────────────────────────────────────────

export async function handleTrimWhitespace(
  ha: DimensionsHandlerAccess,
  input: DimensionsTrimWhitespaceInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('trim_whitespace', { cellsAffected: 0 }, undefined, true);
  }

  const gridRange = await ha.rangeToGridRange(input.spreadsheetId, input.range, ha.sheetsApi);

  const response = await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          trimWhitespace: {
            range: toGridRange(gridRange),
          },
        },
      ],
    },
  });

  const cellsAffected = response.data?.replies?.[0]?.trimWhitespace?.cellsChangedCount ?? 0;

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'trim_whitespace',
        spreadsheetId: input.spreadsheetId,
        description: `Trimmed whitespace in range ${input.range}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('trim_whitespace', { cellsAffected });
}

// ─── handleRandomizeRange ─────────────────────────────────────────────────────

export async function handleRandomizeRange(
  ha: DimensionsHandlerAccess,
  input: DimensionsRandomizeRangeInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('randomize_range', {}, undefined, true);
  }

  const gridRange = await ha.rangeToGridRange(input.spreadsheetId, input.range, ha.sheetsApi);

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          randomizeRange: {
            range: toGridRange(gridRange),
          },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'randomize_range',
        spreadsheetId: input.spreadsheetId,
        description: `Randomized range ${input.range}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('randomize_range', {});
}

// ─── handleTextToColumns ──────────────────────────────────────────────────────

export async function handleTextToColumns(
  ha: DimensionsHandlerAccess,
  input: DimensionsTextToColumnsInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('text_to_columns', {}, undefined, true);
  }

  const gridRange = await ha.rangeToGridRange(input.spreadsheetId, input.source, ha.sheetsApi);

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          textToColumns: {
            source: toGridRange(gridRange),
            delimiterType: input.delimiterType ?? 'AUTODETECT',
            delimiter: input.delimiterType === 'CUSTOM' ? input.delimiter : undefined,
          },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'text_to_columns',
        spreadsheetId: input.spreadsheetId,
        description: `Split text to columns in range ${input.source}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('text_to_columns', {});
}

// ─── handleAutoFill ───────────────────────────────────────────────────────────

export async function handleAutoFill(
  ha: DimensionsHandlerAccess,
  input: DimensionsAutoFillInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('auto_fill', {}, undefined, true);
  }

  // Build the request based on which parameters are provided
  const autoFillRequest: sheets_v4.Schema$AutoFillRequest = {
    useAlternateSeries: input.useAlternateSeries,
  };

  if (input.sourceRange && input.fillLength !== undefined) {
    // SourceAndDestination mode: explicit source and fill direction
    const sourceGridRange = await ha.rangeToGridRange(
      input.spreadsheetId,
      input.sourceRange,
      ha.sheetsApi
    );
    autoFillRequest.sourceAndDestination = {
      source: toGridRange(sourceGridRange),
      dimension: input.dimension ?? 'ROWS',
      fillLength: input.fillLength,
    };
  } else if (input.range) {
    // Range mode: auto-detect source data within range
    const gridRange = await ha.rangeToGridRange(input.spreadsheetId, input.range, ha.sheetsApi);
    autoFillRequest.range = toGridRange(gridRange);
  } else {
    return ha.error({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'auto_fill requires one of two modes: ' +
        '(1) "range" only - fills within range using first row/column as pattern. Example: { "range": "A1:A10" } ' +
        '(2) "sourceRange" + "fillLength" - extends pattern beyond source. Example: { "sourceRange": "A1:A3", "fillLength": 7 }',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [{ autoFill: autoFillRequest }],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      const rangeDesc = input.range || input.sourceRange || 'range';
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'auto_fill',
        spreadsheetId: input.spreadsheetId,
        description: `Auto-filled range ${rangeDesc}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('auto_fill', {});
}
