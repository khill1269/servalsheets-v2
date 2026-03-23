import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  PivotCreateInput,
  PivotDeleteInput,
  PivotGetInput,
  PivotListInput,
  PivotRefreshInput,
  PivotUpdateInput,
  VisualizeResponse,
} from '../../schemas/visualize.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import {
  buildGridRangeInput,
  parseCellReference,
  toGridRange as toApiGridRange,
  type GridRangeInput,
} from '../../utils/google-sheets-helpers.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';

interface PivotsDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  toGridRange: (spreadsheetId: string, rangeInput: RangeInput) => Promise<GridRangeInput>;
  resolveSheetId: (spreadsheetId: string, sheetName?: string) => Promise<number>;
  validateGridDataSize: (spreadsheetId: string, sheetId?: number) => Promise<unknown | null>;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => VisualizeResponse;
  error: (error: ErrorDetail) => VisualizeResponse;
  notFoundError: (resourceType: string, resourceId: string | number) => VisualizeResponse;
}

export async function handlePivotCreateAction(
  input: PivotCreateInput,
  deps: PivotsDeps
): Promise<VisualizeResponse> {
  // Idempotency guard: check if a pivot table with the same source range already exists
  try {
    const existing = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties,sheets.data.rowData.values.pivotTable',
    });

    const sourceRangeGrid = await deps.toGridRange(input.spreadsheetId, input.sourceRange);
    const sourceGridRange = toApiGridRange(sourceRangeGrid);

    // Check all sheets for a pivot table with the same source range
    for (const sheet of existing.data.sheets ?? []) {
      if (sheet.data) {
        for (const data of sheet.data) {
          if (data.rowData) {
            for (const row of data.rowData) {
              if (row.values) {
                for (const value of row.values) {
                  if (value.pivotTable && value.pivotTable.source) {
                    // Compare source ranges: check sheet ID, row boundaries, and column boundaries
                    const existing_source = value.pivotTable.source;
                    const sameSheetId = existing_source.sheetId === sourceGridRange.sheetId;
                    const sameRows =
                      (existing_source.startRowIndex ?? 0) === (sourceGridRange.startRowIndex ?? 0) &&
                      (existing_source.endRowIndex ?? 0) === (sourceGridRange.endRowIndex ?? 0);
                    const sameCols =
                      (existing_source.startColumnIndex ?? 0) ===
                        (sourceGridRange.startColumnIndex ?? 0) &&
                      (existing_source.endColumnIndex ?? 0) ===
                        (sourceGridRange.endColumnIndex ?? 0);

                    if (sameSheetId && sameRows && sameCols) {
                      // Duplicate pivot table found (same source range)
                      return deps.success('pivot_create', {
                        pivotTable: {
                          sheetId: sheet.properties?.sheetId ?? 0,
                          sourceRange: normalizeGridRange(
                            existing_source,
                            sheet.properties?.sheetId ?? 0
                          ),
                          rowGroups: value.pivotTable.rows?.length ?? 0,
                          columnGroups: value.pivotTable.columns?.length ?? 0,
                          values: value.pivotTable.values?.length ?? 0,
                        },
                        _idempotent: true,
                        _hint: 'A pivot table with the same source range already exists. Returning existing pivot instead of creating a duplicate.',
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Non-blocking: proceed with creation if lookup fails
  }

  const sourceRange = await deps.toGridRange(input.spreadsheetId, input.sourceRange);
  const destination = await toDestination(
    deps,
    input.spreadsheetId,
    input.destinationCell,
    input.destinationSheetId
  );

  const pivot: sheets_v4.Schema$PivotTable = {
    source: toApiGridRange(sourceRange),
    rows: input.rows?.map(mapPivotGroup) ?? [],
    columns: input.columns?.map(mapPivotGroup) ?? [],
    values: input.values.map(mapPivotValue),
    filterSpecs: input.filters?.map(mapPivotFilter),
  };

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            start: destination,
            fields: 'pivotTable',
            rows: [
              {
                values: [
                  {
                    pivotTable: pivot,
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  });

  const sheetId = destination.sheetId ?? 0;
  return deps.success('pivot_create', {
    pivotTable: {
      sheetId,
      sourceRange,
      rowGroups: pivot.rows?.length ?? 0,
      columnGroups: pivot.columns?.length ?? 0,
      values: pivot.values?.length ?? 0,
    },
  });
}

export async function handlePivotUpdateAction(
  input: PivotUpdateInput,
  deps: PivotsDeps
): Promise<VisualizeResponse> {
  const sheetId = input.sheetId;
  // Fetch current pivot to enable merge — prevents silent erasure of omitted fields
  const currentPivot = await getCurrentPivotTable(deps, input.spreadsheetId, sheetId);

  if (!currentPivot?.source) {
    return deps.notFoundError('Pivot on sheet', sheetId);
  }

  const pivot: sheets_v4.Schema$PivotTable = {
    source: currentPivot.source,
    // Merge: use input value when provided, otherwise preserve existing field
    rows:
      input.rows !== undefined ? input.rows.map(mapPivotGroup) : (currentPivot.rows ?? undefined),
    columns:
      input.columns !== undefined
        ? input.columns.map(mapPivotGroup)
        : (currentPivot.columns ?? undefined),
    values:
      input.values !== undefined
        ? input.values.map(mapPivotValue)
        : (currentPivot.values ?? undefined),
    filterSpecs:
      input.filters !== undefined
        ? input.filters.map(mapPivotFilter)
        : (currentPivot.filterSpecs ?? undefined),
  };

  if (input.safety?.dryRun) {
    return deps.success('pivot_update', {}, undefined, true);
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            start: {
              sheetId,
              rowIndex: currentPivot.source.startRowIndex ?? 0,
              columnIndex: currentPivot.source.startColumnIndex ?? 0,
            },
            fields: 'pivotTable',
            rows: [
              {
                values: [
                  {
                    pivotTable: pivot,
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  });

  return deps.success('pivot_update', {});
}

export async function handlePivotDeleteAction(
  input: PivotDeleteInput,
  deps: PivotsDeps
): Promise<VisualizeResponse> {
  if (input.safety?.dryRun) {
    return deps.success('pivot_delete', {}, undefined, true);
  }

  // Request confirmation if elicitation available (CRITICAL: deletes entire sheet)
  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'pivot_delete',
      `Delete pivot table by removing entire sheet (ID: ${input.sheetId}) from spreadsheet ${input.spreadsheetId}. This will delete ALL data on the sheet. This action cannot be undone.`
    );

    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  // Create snapshot if requested (CRITICAL operation)
  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'pivot_delete',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  // Find the pivot table's anchor cell on the sheet
  const getResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.data.rowData.values.pivotTable',
    ranges: [],
  });
  const sheet = (getResponse.data.sheets ?? []).find(
    (s) => s.properties?.sheetId === input.sheetId
  );
  let pivotRow = 0;
  let pivotCol = 0;
  if (sheet?.data?.[0]?.rowData) {
    for (let r = 0; r < sheet.data[0].rowData.length; r++) {
      const row = sheet.data[0].rowData[r];
      if (row?.values) {
        for (let c = 0; c < row.values.length; c++) {
          if (row.values[c]?.pivotTable) {
            pivotRow = r;
            pivotCol = c;
            break;
          }
        }
      }
    }
  }

  // Clear the pivot table by setting pivotTable to null on its anchor cell
  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            start: {
              sheetId: input.sheetId,
              rowIndex: pivotRow,
              columnIndex: pivotCol,
            },
            fields: 'pivotTable',
            rows: [{ values: [{ pivotTable: null as unknown as undefined }] }],
          },
        },
      ],
    },
  });

  return deps.success('pivot_delete', {
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handlePivotListAction(
  input: PivotListInput,
  deps: PivotsDeps
): Promise<VisualizeResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets.properties,sheets.data.rowData.values.pivotTable',
  });

  const pivotTables: Array<{ sheetId: number; title: string }> = [];

  for (const sheet of response.data.sheets ?? []) {
    const hasPivot = sheet.data?.some((d) =>
      d.rowData?.some((r) => r.values?.some((v) => v.pivotTable))
    );
    if (hasPivot) {
      pivotTables.push({
        sheetId: sheet.properties?.sheetId ?? 0,
        title: sheet.properties?.title ?? '',
      });
    }
  }

  return deps.success('pivot_list', { pivotTables });
}

export async function handlePivotGetAction(
  input: PivotGetInput,
  deps: PivotsDeps
): Promise<VisualizeResponse> {
  // Validate spreadsheet size before loading full grid data.
  // Also fetch sheet title so we can scope the subsequent includeGridData call.
  const metaResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
  });
  const metaSheets = metaResponse.data.sheets ?? [];
  const targetSheet = metaSheets.find((s) => s.properties?.sheetId === input.sheetId);
  if (!targetSheet?.properties?.title) {
    return deps.error({
      code: ErrorCodes.SHEET_NOT_FOUND,
      message: `Sheet with ID ${input.sheetId} not found`,
      retryable: false,
      suggestedFix: 'Verify the sheet ID is correct',
    });
  }

  const sizeError = await deps.validateGridDataSize(input.spreadsheetId, input.sheetId);
  if (sizeError) return sizeError as VisualizeResponse;

  // Scope to the target sheet only to avoid fetching the entire workbook
  const sheetTitle = targetSheet.properties.title;
  const scopedRange = `'${sheetTitle.replace(/'/g, "''")}'`;
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    ranges: [scopedRange],
    includeGridData: true,
    fields:
      'sheets.data.rowData.values.pivotTable,sheets.properties.sheetId,sheets.properties.title',
  });

  for (const sheet of response.data.sheets ?? []) {
    if (sheet.properties?.sheetId !== input.sheetId) continue;
    for (const data of sheet.data ?? []) {
      for (const row of data.rowData ?? []) {
        for (const value of row.values ?? []) {
          if (value.pivotTable) {
            const pt = value.pivotTable;
            const sourceRange = normalizeGridRange(pt.source, input.sheetId);
            return deps.success('pivot_get', {
              pivotTable: {
                sheetId: input.sheetId,
                sourceRange,
                rowGroups: pt.rows?.length ?? 0,
                columnGroups: pt.columns?.length ?? 0,
                values: pt.values?.length ?? 0,
              },
            });
          }
        }
      }
    }
  }

  return deps.notFoundError('Pivot on sheet', input.sheetId);
}

export async function handlePivotRefreshAction(
  _input: PivotRefreshInput,
  deps: PivotsDeps
): Promise<VisualizeResponse> {
  // Google Sheets pivot tables auto-refresh when their source data changes.
  // There is no explicit refresh API endpoint. The pivot is always current
  // when read via the API.
  return deps.success('pivot_refresh', {
    message:
      'Google Sheets pivot tables refresh automatically when source data changes. ' +
      'No manual refresh is needed. Use pivot_get to read the current pivot state.',
  });
}

async function toDestination(
  deps: PivotsDeps,
  spreadsheetId: string,
  destinationCell?: string,
  destinationSheetId?: number
): Promise<sheets_v4.Schema$GridCoordinate> {
  if (destinationCell) {
    const parsed = parseCellReference(destinationCell);
    const sheetId = await deps.resolveSheetId(spreadsheetId, parsed.sheetName);
    return { sheetId, rowIndex: parsed.row, columnIndex: parsed.col };
  }

  if (destinationSheetId !== undefined) {
    return { sheetId: destinationSheetId, rowIndex: 0, columnIndex: 0 };
  }

  // Default: new sheet
  const newSheet = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: { properties: { title: 'Pivot Table' } },
        },
      ],
    },
  });
  const sheetId = newSheet.data?.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
  return { sheetId, rowIndex: 0, columnIndex: 0 };
}

function mapPivotGroup(
  group: NonNullable<PivotCreateInput['rows']>[number]
): sheets_v4.Schema$PivotGroup {
  return {
    sourceColumnOffset: group.sourceColumnOffset,
    showTotals: group.showTotals,
    sortOrder: group.sortOrder ?? 'ASCENDING',
    groupRule: group.groupRule
      ? {
          dateTimeRule: group.groupRule.dateTimeRule
            ? { type: group.groupRule.dateTimeRule.type }
            : undefined,
          manualRule: group.groupRule.manualRule
            ? {
                groups: group.groupRule.manualRule.groups.map((ruleGroup) => ({
                  groupName: { stringValue: ruleGroup.groupName },
                  items: ruleGroup.items.map((item) => ({ stringValue: item })),
                })),
              }
            : undefined,
          histogramRule: group.groupRule.histogramRule
            ? {
                interval: group.groupRule.histogramRule.interval,
                start: group.groupRule.histogramRule.start,
                end: group.groupRule.histogramRule.end,
              }
            : undefined,
        }
      : undefined,
  };
}

function mapPivotValue(
  value: NonNullable<PivotCreateInput['values']>[number]
): sheets_v4.Schema$PivotValue {
  return {
    sourceColumnOffset: value.sourceColumnOffset,
    summarizeFunction: value.summarizeFunction,
    name: value.name,
    calculatedDisplayType: value.calculatedDisplayType,
  };
}

function mapPivotFilter(
  filter: NonNullable<PivotCreateInput['filters']>[number]
): sheets_v4.Schema$PivotFilterSpec {
  return {
    columnOffsetIndex: filter.sourceColumnOffset,
    filterCriteria: {
      visibleValues: filter.filterCriteria.visibleValues,
      condition: filter.filterCriteria.condition
        ? {
            type: filter.filterCriteria.condition.type as sheets_v4.Schema$BooleanCondition['type'],
            values: filter.filterCriteria.condition.values?.map((value) => ({
              userEnteredValue: value,
            })),
          }
        : undefined,
    },
  };
}

function normalizeGridRange(
  range: sheets_v4.Schema$GridRange | undefined,
  fallbackSheetId: number
): GridRangeInput {
  return buildGridRangeInput(
    range?.sheetId ?? fallbackSheetId,
    range?.startRowIndex ?? undefined,
    range?.endRowIndex ?? undefined,
    range?.startColumnIndex ?? undefined,
    range?.endColumnIndex ?? undefined
  );
}

async function getCurrentPivotTable(
  deps: PivotsDeps,
  spreadsheetId: string,
  sheetId: number
): Promise<sheets_v4.Schema$PivotTable | null> {
  try {
    const response = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties,sheets.data.rowData.values.pivotTable',
    });

    for (const sheet of response.data.sheets ?? []) {
      if (sheet.properties?.sheetId !== sheetId) continue;
      for (const data of sheet.data ?? []) {
        for (const row of data.rowData ?? []) {
          for (const value of row.values ?? []) {
            if (value.pivotTable) return value.pivotTable;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
