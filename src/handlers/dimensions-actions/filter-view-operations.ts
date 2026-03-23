/**
 * Filter View action handlers for sheets_dimensions.
 * Covers: create_filter_view, duplicate_filter_view, update_filter_view,
 *         delete_filter_view, list_filter_views, get_filter_view
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type {
  DimensionsCreateFilterViewInput,
  DimensionsDuplicateFilterViewInput,
  DimensionsUpdateFilterViewInput,
  DimensionsDeleteFilterViewInput,
  DimensionsListFilterViewsInput,
  DimensionsGetFilterViewInput,
  DimensionsResponse,
} from '../../schemas/index.js';
import {
  confirmDestructiveAction,
  safeElicit,
  FILTER_SETTINGS_SCHEMA,
} from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import {
  mapDimensionsCriteria,
  collectFilterViewSummaries,
  findFilterViewSummaryById,
  paginateFilterViews,
} from '../dimensions-filter-helpers.js';
import type { DimensionsHandlerAccess } from './internal.js';

// ─── handleCreateFilterView ───────────────────────────────────────────────────

export async function handleCreateFilterView(
  ha: DimensionsHandlerAccess,
  input: DimensionsCreateFilterViewInput
): Promise<DimensionsResponse> {
  let resolvedTitle = input.title;
  let resolvedCriteria = input.criteria;

  // Interactive wizard: collect filter settings when title is absent
  if (!resolvedTitle && ha.context.server) {
    try {
      const wizardResult = await safeElicit(
        ha.context.server,
        {
          mode: 'form',
          message: 'Configure your filter view: enter a name and optionally a column filter',
          requestedSchema: FILTER_SETTINGS_SCHEMA,
        },
        null
      );
      if (wizardResult) {
        const wiz = wizardResult as {
          filterName?: string;
          columnToFilter: string;
          filterType: string;
          filterValue?: string;
        };
        if (wiz.filterName) resolvedTitle = wiz.filterName;
        if (wiz.columnToFilter && wiz.filterType && !resolvedCriteria) {
          // Convert column letter to 0-based index (A=0, B=1, ...)
          const colIndex =
            wiz.columnToFilter
              .toUpperCase()
              .trim()
              .split('')
              .reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
          const typeMap: Record<string, string> = {
            equals: 'TEXT_EQ',
            contains: 'TEXT_CONTAINS',
            greater_than: 'NUMBER_GREATER',
            less_than: 'NUMBER_LESS',
            between: 'NUMBER_BETWEEN',
            is_empty: 'BLANK',
            is_not_empty: 'NOT_BLANK',
          };
          const conditionType = (typeMap[wiz.filterType] ?? 'TEXT_CONTAINS') as
            | 'TEXT_EQ'
            | 'TEXT_CONTAINS'
            | 'NUMBER_GREATER'
            | 'NUMBER_LESS'
            | 'NUMBER_BETWEEN'
            | 'BLANK'
            | 'NOT_BLANK';
          const noValueTypes = new Set<string>(['BLANK', 'NOT_BLANK']);
          resolvedCriteria = {
            [colIndex]: {
              condition: {
                type: conditionType,
                ...(noValueTypes.has(conditionType) || !wiz.filterValue
                  ? {}
                  : { values: [wiz.filterValue] }),
              },
            },
          };
        }
      }
    } catch {
      // non-blocking: wizard failure does not prevent filter creation
    }
    if (!resolvedTitle) resolvedTitle = 'Filter View';
  }

  const gridRange = input.range
    ? await ha.rangeToGridRange(input.spreadsheetId, input.range, ha.sheetsApi)
    : { sheetId: input.sheetId };

  const response = await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          addFilterView: {
            filter: {
              title: resolvedTitle ?? input.title,
              range: toGridRange(gridRange),
              criteria: resolvedCriteria ? mapDimensionsCriteria(resolvedCriteria) : undefined,
              sortSpecs: input.sortSpecs?.map((spec) => ({
                dimensionIndex: spec.columnIndex,
                sortOrder: spec.sortOrder ?? 'ASCENDING',
              })),
            },
          },
        },
      ],
    },
  });

  const filterViewId = response.data?.replies?.[0]?.addFilterView?.filter?.filterViewId;

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'create_filter_view',
        spreadsheetId: input.spreadsheetId,
        description: `Created filter view`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('create_filter_view', {
    filterViewId: filterViewId ?? undefined,
  });
}

// ─── handleDuplicateFilterView ────────────────────────────────────────────────

export async function handleDuplicateFilterView(
  ha: DimensionsHandlerAccess,
  input: DimensionsDuplicateFilterViewInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('duplicate_filter_view', {}, undefined, true);
  }

  const response = await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          duplicateFilterView: {
            filterId: input.filterViewId,
          },
        },
      ],
    },
  });

  const duplicatedFilterViewId =
    response.data?.replies?.[0]?.duplicateFilterView?.filter?.filterViewId;
  return ha.success('duplicate_filter_view', {
    filterViewId: duplicatedFilterViewId ?? undefined,
  });
}

// ─── handleUpdateFilterView ───────────────────────────────────────────────────

export async function handleUpdateFilterView(
  ha: DimensionsHandlerAccess,
  input: DimensionsUpdateFilterViewInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('update_filter_view', {}, undefined, true);
  }

  const filter: sheets_v4.Schema$FilterView = {
    filterViewId: input.filterViewId,
    title: input.title,
    criteria: input.criteria ? mapDimensionsCriteria(input.criteria) : undefined,
    sortSpecs: input.sortSpecs?.map((spec) => ({
      dimensionIndex: spec.columnIndex,
      sortOrder: spec.sortOrder ?? 'ASCENDING',
    })),
  };

  await ha.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'replies',
    requestBody: {
      requests: [
        {
          updateFilterView: {
            filter,
            fields:
              [
                input.title !== undefined ? 'title' : '',
                input.criteria ? 'criteria' : '',
                input.sortSpecs ? 'sortSpecs' : '',
              ]
                .filter(Boolean)
                .join(',') || 'title',
          },
        },
      ],
    },
  });

  return ha.success('update_filter_view', {});
}

// ─── handleDeleteFilterView ───────────────────────────────────────────────────

export async function handleDeleteFilterView(
  ha: DimensionsHandlerAccess,
  input: DimensionsDeleteFilterViewInput
): Promise<DimensionsResponse> {
  if (input.safety?.dryRun) {
    return ha.success('delete_filter_view', {}, undefined, true);
  }

  // Safety: snapshot BEFORE confirmation (backup must exist before user approves)
  await createSnapshotIfNeeded(
    ha.context.snapshotService,
    {
      operationType: 'delete_filter_view',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  if (ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'delete_filter_view',
      `Delete filter view ${input.filterViewId} from spreadsheet ${input.spreadsheetId}. This cannot be undone.`
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
          deleteFilterView: { filterId: input.filterViewId },
        },
      ],
    },
  });

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_dimensions',
        action: 'delete_filter_view',
        spreadsheetId: input.spreadsheetId,
        description: `Deleted filter view`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return ha.success('delete_filter_view', {});
}

// ─── handleListFilterViews ────────────────────────────────────────────────────

export async function handleListFilterViews(
  ha: DimensionsHandlerAccess,
  input: DimensionsListFilterViewsInput
): Promise<DimensionsResponse> {
  const response = await ha.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.filterViews,sheets.properties.sheetId',
  });

  const filterViews = collectFilterViewSummaries({
    sheets: response.data.sheets,
    sheetId: input.sheetId,
    gridRangeToOutput: (range) => ha.gridRangeToOutput(range),
  });
  const paginated = paginateFilterViews(
    filterViews,
    (input as { limit?: number }).limit ?? 50,
    (input as { cursor?: string }).cursor
  );

  return ha.success('list_filter_views', {
    filterViews: paginated.filterViews,
    totalCount: paginated.totalCount,
    hasMore: paginated.hasMore,
    ...(paginated.nextCursor !== undefined && { nextCursor: paginated.nextCursor }),
  });
}

// ─── handleGetFilterView ──────────────────────────────────────────────────────

export async function handleGetFilterView(
  ha: DimensionsHandlerAccess,
  input: DimensionsGetFilterViewInput
): Promise<DimensionsResponse> {
  const response = await ha.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.filterViews',
  });

  const filterView = findFilterViewSummaryById({
    sheets: response.data.sheets,
    filterViewId: input.filterViewId,
    gridRangeToOutput: (range) => ha.gridRangeToOutput(range),
  });

  if (filterView) {
    return ha.success('get_filter_view', { filterViews: [filterView] });
  }

  return ha.notFoundError('Filter view', input.filterViewId);
}
