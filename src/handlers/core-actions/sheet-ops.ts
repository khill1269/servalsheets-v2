import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CoreAddSheetInput,
  CoreCopySheetToInput,
  CoreDeleteSheetInput,
  CoreDuplicateSheetInput,
  CoreGetSheetInput,
  CoreListSheetsInput,
  CoreResponse,
  CoreUpdateSheetInput,
  ResponseMeta,
  SheetInfo,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { createNotFoundError } from '../../utils/error-factory.js';
import { recordSheetName } from '../../mcp/completions.js';

type ResponseFormat = 'full' | 'compact' | 'preview';

interface SheetOpsDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  convertTabColor: (
    tabColor: sheets_v4.Schema$Color | null | undefined,
    tabColorStyle?: sheets_v4.Schema$ColorStyle | null | undefined
  ) => SheetInfo['tabColor'];
  deduplicatedApiCall: <T>(key: string, apiCall: () => Promise<T>) => Promise<T>;
  applyListSheetsResponseFormat: (
    responseData: Record<string, unknown>,
    responseFormat: ResponseFormat
  ) => Record<string, unknown>;
  buildResponseFormatMeta: (action: string, responseData: Record<string, unknown>) => ResponseMeta;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ) => CoreResponse;
  error: (error: ErrorDetail) => CoreResponse;
}

function toRgbTabColor(
  tabColor?: SheetInfo['tabColor'],
  tabColorStyle?: sheets_v4.Schema$ColorStyle | null
): sheets_v4.Schema$Color | undefined {
  if (tabColorStyle?.rgbColor) {
    return tabColorStyle.rgbColor;
  }

  if (tabColor) {
    return {
      red: tabColor.red,
      green: tabColor.green,
      blue: tabColor.blue,
      alpha: tabColor.alpha,
    };
  }

  return tabColorStyle?.rgbColor ?? undefined;
}

function toTabColorStyle(
  tabColor?: SheetInfo['tabColor'],
  tabColorStyle?: sheets_v4.Schema$ColorStyle | null
): sheets_v4.Schema$ColorStyle | undefined {
  if (tabColorStyle) {
    return tabColorStyle;
  }

  const rgbColor = toRgbTabColor(tabColor);
  return rgbColor ? { rgbColor } : undefined;
}

function toSchemaTabColorStyle(
  tabColor?: sheets_v4.Schema$Color | null,
  tabColorStyle?: sheets_v4.Schema$ColorStyle | null
): SheetInfo['tabColorStyle'] {
  if (tabColorStyle?.themeColor) {
    return {
      themeColor: tabColorStyle.themeColor as NonNullable<SheetInfo['tabColorStyle']> extends {
        themeColor: infer T;
      }
        ? T
        : never,
    };
  }

  const rgbColor = tabColorStyle?.rgbColor ?? tabColor;
  if (!rgbColor) {
    return undefined; // OK: no tab color
  }

  return {
    rgbColor: {
      red: rgbColor.red ?? 0,
      green: rgbColor.green ?? 0,
      blue: rgbColor.blue ?? 0,
      alpha: rgbColor.alpha ?? 1,
    },
  };
}

function toSheetInfo(
  properties: sheets_v4.Schema$SheetProperties | undefined,
  deps: SheetOpsDeps
): SheetInfo {
  return {
    sheetId: properties?.sheetId ?? 0,
    title: properties?.title ?? '',
    index: properties?.index ?? 0,
    rowCount: properties?.gridProperties?.rowCount ?? 0,
    columnCount: properties?.gridProperties?.columnCount ?? 0,
    hidden: properties?.hidden ?? false,
    tabColor: deps.convertTabColor(properties?.tabColor, properties?.tabColorStyle),
    tabColorStyle: toSchemaTabColorStyle(properties?.tabColor, properties?.tabColorStyle),
  };
}

async function sheetExists(
  deps: SheetOpsDeps,
  spreadsheetId: string,
  sheetId: number
): Promise<boolean> {
  try {
    const response = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.sheetId',
    });
    return response.data.sheets?.some((s) => s.properties?.sheetId === sheetId) ?? false;
  } catch (err) {
    deps.context.logger?.warn?.('Failed to check sheet existence', {
      spreadsheetId,
      sheetId,
      error: String(err),
    });
    return false;
  }
}

/**
 * Decomposed action handler for `add_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleAddSheetAction(
  input: CoreAddSheetInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  // Idempotency guard: check if a sheet with the same title already exists
  try {
    const existing = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties',
    });
    const duplicate = (existing.data.sheets ?? []).find(
      (s) => s.properties?.title === input.title
    );
    if (duplicate && duplicate.properties) {
      return deps.success('add_sheet', {
        sheet: toSheetInfo(duplicate.properties, deps),
        _idempotent: true,
        _hint: `Sheet "${input.title}" already exists. Returning existing sheet instead of creating a duplicate.`,
      });
    }
  } catch {
    // Non-blocking: proceed with creation if lookup fails
  }

  const sheetProperties: sheets_v4.Schema$SheetProperties = {
    title: input.title,
    hidden: input.hidden ?? false,
    gridProperties: {
      rowCount: input.rowCount ?? 1000,
      columnCount: input.columnCount ?? 26,
    },
  };

  if (input.index !== undefined) {
    sheetProperties.index = input.index;
  }
  const tabColor = toRgbTabColor(input.tabColor, input.tabColorStyle);
  const tabColorStyle = toTabColorStyle(input.tabColor, input.tabColorStyle);
  if (tabColor) {
    sheetProperties.tabColor = tabColor;
  }
  if (tabColorStyle) {
    sheetProperties.tabColorStyle = tabColorStyle;
  }

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: { properties: sheetProperties },
        },
      ],
    },
  });

  const newSheet = response.data?.replies?.[0]?.addSheet?.properties;
  const sheet: SheetInfo = {
    ...toSheetInfo(newSheet, deps),
    title: newSheet?.title ?? input.title,
    rowCount: newSheet?.gridProperties?.rowCount ?? input.rowCount ?? 1000,
    columnCount: newSheet?.gridProperties?.columnCount ?? input.columnCount ?? 26,
  };

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'add_sheet',
        spreadsheetId: input.spreadsheetId,
        description: `Added sheet "${sheet.title}" (sheetId: ${sheet.sheetId})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('add_sheet', { sheet });
}

/**
 * Decomposed action handler for `delete_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleDeleteSheetAction(
  input: CoreDeleteSheetInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  if (input.allowMissing) {
    const exists = await sheetExists(deps, input.spreadsheetId, input.sheetId);
    if (!exists) {
      return deps.success('delete_sheet', { alreadyDeleted: true });
    }
  }

  if (input.safety?.dryRun) {
    return deps.success('delete_sheet', {}, undefined, true);
  }

  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'delete_sheet',
      `Delete sheet with ID ${input.sheetId} from spreadsheet ${input.spreadsheetId}. This will permanently remove the entire sheet and all its data. This action cannot be undone.`
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

  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'delete_sheet',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [{ deleteSheet: { sheetId: input.sheetId } }],
    },
  });

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'delete_sheet',
        spreadsheetId: input.spreadsheetId,
        description: `Deleted sheet (sheetId: ${input.sheetId})`,
        undoable: true,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('delete_sheet', {
    snapshotId: snapshot?.snapshotId,
  });
}

/**
 * Decomposed action handler for `duplicate_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleDuplicateSheetAction(
  input: CoreDuplicateSheetInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  const duplicateRequest: sheets_v4.Schema$DuplicateSheetRequest = {
    sourceSheetId: input.sheetId,
  };

  if (input.insertIndex !== undefined) {
    duplicateRequest.insertSheetIndex = input.insertIndex;
  }
  if (input.newTitle !== undefined) {
    duplicateRequest.newSheetName = input.newTitle;
  }

  const response = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    requestBody: {
      requests: [{ duplicateSheet: duplicateRequest }],
    },
  });

  const newSheet = response.data?.replies?.[0]?.duplicateSheet?.properties;
  const sheet: SheetInfo = toSheetInfo(newSheet, deps);

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'duplicate_sheet',
        spreadsheetId: input.spreadsheetId,
        description: `Duplicated sheet ${input.sheetId} as "${sheet.title}"`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('duplicate_sheet', { sheet });
}

/**
 * Decomposed action handler for `update_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleUpdateSheetAction(
  input: CoreUpdateSheetInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  const inputAny = input as Record<string, unknown>;
  const nestedProps = inputAny['properties'] as Record<string, unknown> | undefined;

  const title =
    input.title ??
    ((input as Record<string, unknown>)['newTitle'] as string | undefined) ??
    (nestedProps?.['title'] as string | undefined);
  const index = input.index ?? (nestedProps?.['index'] as number | undefined);
  const hidden = input.hidden ?? (nestedProps?.['hidden'] as boolean | undefined);
  const tabColor = input.tabColor ?? (nestedProps?.['tabColor'] as typeof input.tabColor);
  const tabColorStyle =
    input.tabColorStyle ??
    (nestedProps?.['tabColorStyle'] as sheets_v4.Schema$ColorStyle | undefined);
  const rightToLeft = input.rightToLeft ?? (nestedProps?.['rightToLeft'] as boolean | undefined);

  let resolvedSheetId = input.sheetId;
  const sheetName = inputAny['sheetName'] as string | undefined;

  if (resolvedSheetId === undefined && sheetName) {
    const lookupResponse = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });

    const matchingSheet = lookupResponse.data.sheets?.find(
      (s) => s.properties?.title?.toLowerCase() === sheetName.toLowerCase()
    );

    const matchingSheetId = matchingSheet?.properties?.sheetId;
    if (matchingSheetId === undefined || matchingSheetId === null) {
      return deps.error(
        createNotFoundError({
          resourceType: 'sheet',
          resourceId: `sheetName: "${sheetName}"`,
          searchSuggestion: `Available sheets: ${lookupResponse.data.sheets?.map((s) => s.properties?.title).join(', ')}`,
          parentResourceId: input.spreadsheetId,
        })
      );
    }

    resolvedSheetId = matchingSheetId;
  }

  if (resolvedSheetId === undefined) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Either sheetId (number) or sheetName (string) is required',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const properties: sheets_v4.Schema$SheetProperties = {
    sheetId: resolvedSheetId,
  };
  const fields: string[] = [];

  if (title !== undefined) {
    properties.title = title;
    fields.push('title');
  }
  if (index !== undefined) {
    properties.index = index;
    fields.push('index');
  }
  if (hidden !== undefined) {
    properties.hidden = hidden;
    fields.push('hidden');
  }
  const nextTabColor = toRgbTabColor(tabColor, tabColorStyle);
  const nextTabColorStyle = toTabColorStyle(tabColor, tabColorStyle);
  if (nextTabColor) {
    properties.tabColor = nextTabColor;
  }
  if (nextTabColorStyle) {
    properties.tabColorStyle = nextTabColorStyle;
    fields.push('tabColorStyle');
  }
  if (rightToLeft !== undefined) {
    properties.rightToLeft = rightToLeft;
    fields.push('rightToLeft');
  }

  if (fields.length === 0) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message:
        'No properties to update. Provide at least one of: title, index, hidden, tabColor, tabColorStyle, rightToLeft',
      details: {
        receivedParams: Object.keys(inputAny).filter(
          (k) => k !== 'action' && k !== 'spreadsheetId'
        ),
        hint: 'Properties can be at root level or nested in a "properties" object',
      },
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const batchResponse = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'updatedSpreadsheet(sheets(properties))',
    requestBody: {
      includeSpreadsheetInResponse: true,
      requests: [
        {
          updateSheetProperties: {
            properties,
            fields: fields.join(','),
          },
        },
      ],
    },
  });

  const sheetData = batchResponse.data.updatedSpreadsheet?.sheets?.find(
    (s) => s.properties?.sheetId === resolvedSheetId
  );
  if (!sheetData?.properties) {
    return deps.error(
      createNotFoundError({
        resourceType: 'sheet',
        resourceId: String(resolvedSheetId),
        searchSuggestion: 'Sheet not found after update. Verify the sheet ID is correct.',
        parentResourceId: input.spreadsheetId,
      })
    );
  }

  const sheet: SheetInfo = toSheetInfo(sheetData.properties, deps);

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'update_sheet',
        spreadsheetId: input.spreadsheetId,
        description: `Updated sheet ${resolvedSheetId} properties (${fields.join(', ')})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('update_sheet', { sheet });
}

/**
 * Decomposed action handler for `copy_sheet_to`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleCopySheetToAction(
  input: CoreCopySheetToInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  const response = await deps.sheetsApi.spreadsheets.sheets.copyTo({
    spreadsheetId: input.spreadsheetId,
    sheetId: input.sheetId,
    requestBody: {
      destinationSpreadsheetId: input.destinationSpreadsheetId,
    },
  });

  const sheet: SheetInfo = {
    ...toSheetInfo(response.data as sheets_v4.Schema$SheetProperties, deps),
    title: response.data.title ?? '',
    rowCount: response.data.gridProperties?.rowCount ?? 0,
    columnCount: response.data.gridProperties?.columnCount ?? 0,
    hidden: response.data.hidden ?? false,
  };

  deps.context.sheetResolver?.invalidate(input.spreadsheetId);
  deps.context.sheetResolver?.invalidate(input.destinationSpreadsheetId);

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'copy_sheet_to',
        spreadsheetId: input.spreadsheetId,
        description: `Copied sheet ${input.sheetId} to spreadsheet ${input.destinationSpreadsheetId}`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('copy_sheet_to', {
    sheet,
    copiedSheetId: response.data.sheetId ?? 0,
  });
}

/**
 * Decomposed action handler for `list_sheets`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleListSheetsAction(
  input: CoreListSheetsInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  const responseFormat = input.response_format ?? 'full';
  const dedupKey = `spreadsheet:get:${input.spreadsheetId}:sheets.properties`;
  const response = await deps.deduplicatedApiCall(dedupKey, () =>
    deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties',
    })
  );

  const sheets: SheetInfo[] = (response.data.sheets ?? []).map((s) =>
    toSheetInfo(s.properties, deps)
  );

  for (const sheet of sheets) {
    if (sheet.title) recordSheetName(sheet.title);
  }

  const responseData = deps.applyListSheetsResponseFormat({ sheets }, responseFormat);

  return deps.success(
    'list_sheets',
    responseData,
    undefined,
    undefined,
    deps.buildResponseFormatMeta('list_sheets', responseData)
  );
}

/**
 * Decomposed action handler for `get_sheet`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleGetSheetAction(
  input: CoreGetSheetInput,
  deps: SheetOpsDeps
): Promise<CoreResponse> {
  const dedupKey = `spreadsheet:get:${input.spreadsheetId}:sheets.properties`;
  const response = await deps.deduplicatedApiCall(dedupKey, () =>
    deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties',
    })
  );

  let sheetData: sheets_v4.Schema$Sheet | undefined;

  if (input.sheetId !== undefined) {
    sheetData = response.data.sheets?.find((s) => s.properties?.sheetId === input.sheetId);
  } else if (input.sheetName !== undefined) {
    const nameLower = input.sheetName.toLowerCase();
    sheetData = response.data.sheets?.find((s) => s.properties?.title?.toLowerCase() === nameLower);
  }

  if (!sheetData?.properties) {
    const resourceId =
      input.sheetId !== undefined ? `sheetId: ${input.sheetId}` : `sheetName: "${input.sheetName}"`;
    const available =
      response.data.sheets?.map((s) => `${s.properties?.title} (id: ${s.properties?.sheetId})`) ??
      [];
    return deps.error(
      createNotFoundError({
        resourceType: 'sheet',
        resourceId,
        searchSuggestion: `Available sheets: ${available.join(', ')}`,
        parentResourceId: input.spreadsheetId,
      })
    );
  }

  const sheet: SheetInfo = toSheetInfo(sheetData.properties, deps);

  return deps.success('get_sheet', { sheet });
}
