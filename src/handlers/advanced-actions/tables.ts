import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { SheetsAdvancedInput, AdvancedResponse } from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary, RangeInput } from '../../schemas/shared.js';
import type { GridRangeInput } from '../../utils/google-sheets-helpers.js';
import {
  buildA1Notation,
  parseA1Notation,
  buildGridRangeInput,
  toGridRange,
} from '../../utils/google-sheets-helpers.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';

type AdvancedSuccess = Extract<AdvancedResponse, { success: true }>;

type CreateTableRequest = Extract<SheetsAdvancedInput['request'], { action: 'create_table' }>;
type DeleteTableRequest = Extract<SheetsAdvancedInput['request'], { action: 'delete_table' }>;
type ListTablesRequest = Extract<SheetsAdvancedInput['request'], { action: 'list_tables' }>;
type UpdateTableRequest = Extract<SheetsAdvancedInput['request'], { action: 'update_table' }>;
type RenameTableColumnRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'rename_table_column' }
>;
type SetTableColumnPropertiesRequest = Extract<
  SheetsAdvancedInput['request'],
  { action: 'set_table_column_properties' }
>;

interface TablesDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  resolveRange: (spreadsheetId: string, range: RangeInput) => Promise<string>;
  getSheetId: (spreadsheetId: string, sheetName?: string) => Promise<number>;
  gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => GridRangeInput;
  paginateItems: <T>(
    items: T[],
    cursor: string | undefined,
    pageSize: number
  ) => { page: T[]; nextCursor: string | undefined; hasMore: boolean; totalCount: number };
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => AdvancedResponse;
  error: (error: ErrorDetail) => AdvancedResponse;
}

function rangesOverlap(
  left: sheets_v4.Schema$GridRange | undefined,
  right: sheets_v4.Schema$GridRange | undefined
): boolean {
  if (!left || !right) {
    return false;
  }
  if ((left.sheetId ?? 0) !== (right.sheetId ?? 0)) {
    return false;
  }

  const leftStartRow = left.startRowIndex ?? 0;
  const leftEndRow = left.endRowIndex ?? Number.MAX_SAFE_INTEGER;
  const leftStartCol = left.startColumnIndex ?? 0;
  const leftEndCol = left.endColumnIndex ?? Number.MAX_SAFE_INTEGER;
  const rightStartRow = right.startRowIndex ?? 0;
  const rightEndRow = right.endRowIndex ?? Number.MAX_SAFE_INTEGER;
  const rightStartCol = right.startColumnIndex ?? 0;
  const rightEndCol = right.endColumnIndex ?? Number.MAX_SAFE_INTEGER;

  return (
    leftStartRow < rightEndRow &&
    rightStartRow < leftEndRow &&
    leftStartCol < rightEndCol &&
    rightStartCol < leftEndCol
  );
}

function formatGridRange(range: sheets_v4.Schema$GridRange | undefined, sheetName: string): string {
  if (!range) {
    return sheetName;
  }

  return buildA1Notation(
    sheetName,
    range.startColumnIndex ?? 0,
    range.startRowIndex ?? 0,
    range.endColumnIndex ?? undefined,
    range.endRowIndex ?? undefined
  );
}

async function validateCreateTablePreconditions(
  spreadsheetId: string,
  targetRange: sheets_v4.Schema$GridRange,
  deps: TablesDeps
): Promise<AdvancedResponse | null> {
  const metadata = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields:
      'sheets(properties(sheetId,title),basicFilter.range,bandedRanges.range,tables(tableId,range))',
  });

  const targetSheet = (metadata.data.sheets ?? []).find(
    (sheet) => sheet.properties?.sheetId === targetRange.sheetId
  );
  const targetSheetName = targetSheet?.properties?.title ?? `Sheet ${targetRange.sheetId}`;
  const requestedRangeA1 = formatGridRange(targetRange, targetSheetName);

  if (rangesOverlap(targetRange, targetSheet?.basicFilter?.range)) {
    return deps.error({
      code: ErrorCodes.FAILED_PRECONDITION,
      message: `Cannot create table on ${requestedRangeA1} because it overlaps an existing basic filter on ${targetSheetName}.`,
      category: 'client',
      severity: 'medium',
      retryable: false,
      suggestedFix: `Clear or move the existing basic filter on ${targetSheetName}, then retry create_table.`,
      resolution:
        'Remove overlapping filters before creating a table. Use sheets_dimensions.clear_basic_filter or choose a non-overlapping range.',
      details: {
        conflictType: 'basic_filter',
        sheetId: targetRange.sheetId ?? 0,
        range: requestedRangeA1,
      },
    });
  }

  const overlappingBanding = (targetSheet?.bandedRanges ?? []).find((bandedRange) =>
    rangesOverlap(targetRange, bandedRange.range)
  );
  if (overlappingBanding) {
    return deps.error({
      code: ErrorCodes.FAILED_PRECONDITION,
      message: `Cannot create table on ${requestedRangeA1} because it overlaps an existing banded range on ${targetSheetName}.`,
      category: 'client',
      severity: 'medium',
      retryable: false,
      suggestedFix: `Remove the overlapping banding on ${targetSheetName}, then retry create_table.`,
      resolution:
        'Remove overlapping alternating colors before creating a table, or choose a different range.',
      details: {
        conflictType: 'banding',
        sheetId: targetRange.sheetId ?? 0,
        range: requestedRangeA1,
        conflictingRange: formatGridRange(overlappingBanding.range, targetSheetName),
      },
    });
  }

  const overlappingTable = (targetSheet?.tables ?? []).find((table) =>
    rangesOverlap(targetRange, table.range)
  );
  if (overlappingTable) {
    return deps.error({
      code: ErrorCodes.FAILED_PRECONDITION,
      message: `Cannot create table on ${requestedRangeA1} because it overlaps existing table ${overlappingTable.tableId ?? '(unknown table id)'}.`,
      category: 'client',
      severity: 'medium',
      retryable: false,
      suggestedFix: 'Choose a non-overlapping range or update/delete the existing table first.',
      resolution:
        'A table cannot overlap another table. Use list_tables to inspect the existing table layout before retrying.',
      details: {
        conflictType: 'table',
        sheetId: targetRange.sheetId ?? 0,
        range: requestedRangeA1,
        tableId: overlappingTable.tableId ?? '',
      },
    });
  }

  return null;
}

export async function handleCreateTableAction(
  req: CreateTableRequest,
  deps: TablesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('create_table', {}, undefined, true);
  }

  const rangeA1 = await deps.resolveRange(req.spreadsheetId!, req.range!);
  const parsed = parseA1Notation(rangeA1);
  const sheetId = await deps.getSheetId(req.spreadsheetId!, parsed.sheetName);
  const gridRange: GridRangeInput = {
    sheetId,
    startRowIndex: parsed.startRow,
    endRowIndex: parsed.endRow,
    startColumnIndex: parsed.startCol,
    endColumnIndex: parsed.endCol,
  };
  const preconditionError = await validateCreateTablePreconditions(
    req.spreadsheetId!,
    toGridRange(gridRange),
    deps
  );
  if (preconditionError) {
    return preconditionError;
  }

  let columnProperties: sheets_v4.Schema$TableColumnProperties[] | undefined;
  const hasHeaders = req.hasHeaders ?? true;
  const headerRowCount = req.headerRowCount ?? 1;

  if (hasHeaders) {
    // Read header rows (default: 1 row, configurable up to 10)
    const headerRange = buildA1Notation(
      parsed.sheetName,
      parsed.startCol,
      parsed.startRow,
      parsed.endCol,
      parsed.startRow + headerRowCount
    );
    const headerResponse = await deps.sheetsApi.spreadsheets.values.get({
      spreadsheetId: req.spreadsheetId!,
      range: headerRange,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    // Use first header row for column names
    const headerValues = headerResponse.data.values?.[0] ?? [];
    const columnCount = Math.max(parsed.endCol - parsed.startCol, headerValues.length);
    columnProperties = Array.from({ length: columnCount }, (_, index) => ({
      columnIndex: index,
      columnName: headerValues[index] ? String(headerValues[index]) : `Column ${index + 1}`,
    }));
  }

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          addTable: {
            table: {
              range: toGridRange(gridRange),
              columnProperties,
            },
          },
        },
      ],
    },
  });

  const table = response.data?.replies?.[0]?.addTable?.table;

  return deps.success('create_table', {
    table: table
      ? {
          tableId: table.tableId ?? '',
          tableName: req.tableName, // Store for client-side reference
          range: deps.gridRangeToOutput(table.range ?? { sheetId }),
          hasHeaders,
          headerRowCount,
        }
      : undefined,
  });
}

export async function handleDeleteTableAction(
  req: DeleteTableRequest,
  deps: TablesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('delete_table', {}, undefined, true);
  }

  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'delete_table',
      isDestructive: true,
      spreadsheetId: req.spreadsheetId!,
    },
    req.safety
  );

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          deleteTable: {
            tableId: req.tableId,
          },
        },
      ],
    },
  });

  return deps.success('delete_table', {
    snapshotId: snapshot?.snapshotId,
  });
}

export async function handleListTablesAction(
  req: ListTablesRequest,
  deps: TablesDeps
): Promise<AdvancedResponse> {
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    // Request full table metadata including range and column properties
    fields: 'sheets.tables(tableId,range,columnProperties),sheets.properties.sheetId',
  });

  const allItems: NonNullable<AdvancedSuccess['tables']> = [];
  for (const sheet of response.data.sheets ?? []) {
    for (const table of sheet.tables ?? []) {
      const range = table.range;
      const columnCount = table.columnProperties?.length ?? 0;
      const rowCount = range ? (range.endRowIndex ?? 0) - (range.startRowIndex ?? 0) : 0;

      allItems.push({
        tableId: table.tableId ?? '',
        tableName: undefined, // Google API doesn't provide table name yet (April 2025)
        range: deps.gridRangeToOutput(range ?? { sheetId: sheet.properties?.sheetId ?? 0 }),
        columnCount,
        rowCount,
      });
    }
  }

  const { page, nextCursor, hasMore, totalCount } = deps.paginateItems(
    allItems,
    req.cursor,
    req.pageSize ?? 100
  );
  return deps.success('list_tables', { tables: page, nextCursor, hasMore, totalCount });
}

export async function handleUpdateTableAction(
  req: UpdateTableRequest,
  deps: TablesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('update_table', {}, undefined, true);
  }

  // Build update request
  const updates: sheets_v4.Schema$Request[] = [];

  if (req.range) {
    const rangeA1 = await deps.resolveRange(req.spreadsheetId!, req.range);
    const parsed = parseA1Notation(rangeA1);
    const sheetId = await deps.getSheetId(req.spreadsheetId!, parsed.sheetName);
    const gridRange: GridRangeInput = {
      sheetId,
      startRowIndex: parsed.startRow,
      endRowIndex: parsed.endRow,
      startColumnIndex: parsed.startCol,
      endColumnIndex: parsed.endCol,
    };

    updates.push({
      updateTable: {
        table: {
          tableId: req.tableId,
          range: toGridRange(gridRange),
        },
        fields: 'range',
      },
    });
  }

  if (updates.length > 0) {
    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: req.spreadsheetId!,
      requestBody: { requests: updates },
    });
  }

  return deps.success('update_table', {});
}

export async function handleRenameTableColumnAction(
  req: RenameTableColumnRequest,
  deps: TablesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('rename_table_column', {}, undefined, true);
  }

  // Get the table to access its column properties
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    fields: 'sheets.tables',
  });

  let targetTable: sheets_v4.Schema$Table | undefined;
  for (const sheet of response.data.sheets ?? []) {
    for (const table of sheet.tables ?? []) {
      if (table.tableId === req.tableId) {
        targetTable = table;
        break;
      }
    }
    if (targetTable) break;
  }

  if (!targetTable) {
    return deps.error({
      code: ErrorCodes.NOT_FOUND,
      message: `Table with ID '${req.tableId}' not found`,
      category: 'client',
      retryable: false,
      suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      details: { tableId: req.tableId },
    });
  }

  // Update column properties
  const columnProperties = targetTable.columnProperties ?? [];
  if (req.columnIndex >= columnProperties.length) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Column index ${req.columnIndex} is out of range (table has ${columnProperties.length} columns)`,
      category: 'client',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      details: { columnIndex: req.columnIndex, columnCount: columnProperties.length },
    });
  }

  // Create updated column properties array
  const updatedColumnProperties = [...columnProperties];
  updatedColumnProperties[req.columnIndex] = {
    ...updatedColumnProperties[req.columnIndex],
    columnName: req.newName,
  };

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests: [
        {
          updateTable: {
            table: {
              tableId: req.tableId,
              columnProperties: updatedColumnProperties,
            },
            fields: 'columnProperties',
          },
        },
      ],
    },
  });

  return deps.success('rename_table_column', {});
}

export async function handleSetTableColumnPropertiesAction(
  req: SetTableColumnPropertiesRequest,
  deps: TablesDeps
): Promise<AdvancedResponse> {
  if (req.safety?.dryRun) {
    return deps.success('set_table_column_properties', {}, undefined, true);
  }

  // Get the table to access its column properties
  const response = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: req.spreadsheetId!,
    fields: 'sheets.tables',
  });

  let targetTable: sheets_v4.Schema$Table | undefined;
  for (const sheet of response.data.sheets ?? []) {
    for (const table of sheet.tables ?? []) {
      if (table.tableId === req.tableId) {
        targetTable = table;
        break;
      }
    }
    if (targetTable) break;
  }

  if (!targetTable) {
    return deps.error({
      code: ErrorCodes.NOT_FOUND,
      message: `Table with ID '${req.tableId}' not found`,
      category: 'client',
      retryable: false,
      suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      details: { tableId: req.tableId },
    });
  }

  // Update column properties
  const columnProperties = targetTable.columnProperties ?? [];
  if (req.columnIndex >= columnProperties.length) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: `Column index ${req.columnIndex} is out of range (table has ${columnProperties.length} columns)`,
      category: 'client',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      details: { columnIndex: req.columnIndex, columnCount: columnProperties.length },
    });
  }

  // Create updated column properties array
  const updatedColumnProperties = [...columnProperties];
  if (req.columnType) {
    updatedColumnProperties[req.columnIndex] = {
      ...updatedColumnProperties[req.columnIndex],
      columnType: req.columnType,
    };
  }

  const requests: sheets_v4.Schema$Request[] = [
    {
      updateTable: {
        table: {
          tableId: req.tableId,
          columnProperties: updatedColumnProperties,
        },
        fields: 'columnProperties',
      },
    },
  ];

  // If column type is DROPDOWN, add data validation
  if (req.columnType === 'DROPDOWN') {
    // Compute the column data range from table range
    const tableRange = targetTable.range;
    if (!tableRange) {
      return deps.error({
        code: ErrorCodes.FAILED_PRECONDITION,
        message: 'Table does not have a valid range',
        category: 'server',
        retryable: false,
        suggestedFix: 'Ensure all preconditions are met before retrying',
        details: { tableId: req.tableId },
      });
    }

    // Calculate the column range
    const startColumnIndex = (tableRange.startColumnIndex ?? 0) + req.columnIndex;
    const endColumnIndex = startColumnIndex + 1;

    // Build data validation rule
    const condition: sheets_v4.Schema$BooleanCondition = {
      type: req.dropdownRange ? 'ONE_OF_RANGE' : 'ONE_OF_LIST',
    };

    if (req.dropdownRange) {
      // Range-based dropdown
      condition.values = [
        {
          userEnteredValue: `=${req.dropdownRange}`,
        },
      ];
    } else if (req.dropdownValues) {
      // Static list dropdown
      condition.values = req.dropdownValues.map((value) => ({
        userEnteredValue: value,
      }));
    }

    const validationRule: sheets_v4.Schema$DataValidationRule = {
      condition,
      showCustomUi: req.dropdownShowDropdown,
      strict: !req.dropdownAllowCustom,
    };

    // Add setDataValidation request
    requests.push({
      setDataValidation: {
        range: toGridRange(
          buildGridRangeInput(
            tableRange.sheetId ?? 0,
            (tableRange.startRowIndex ?? 0) + 1, // Skip header row
            tableRange.endRowIndex ?? undefined,
            startColumnIndex,
            endColumnIndex
          )
        ),
        rule: validationRule,
      },
    });
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: req.spreadsheetId!,
    requestBody: {
      requests,
    },
  });

  return deps.success('set_table_column_properties', {});
}
