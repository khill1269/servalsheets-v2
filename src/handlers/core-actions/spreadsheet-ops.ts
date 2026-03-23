import { ErrorCodes } from '../error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CoreCopyInput,
  CoreCreateInput,
  CoreGetInput,
  CoreResponse,
  CoreUpdatePropertiesInput,
  ResponseMeta,
  SheetInfo,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { cacheManager, createCacheKey } from '../../utils/cache-manager.js';
import { CACHE_TTL_SPREADSHEET } from '../../config/constants.js';
import { ScopeValidator } from '../../security/incremental-scope.js';
import { elicitSpreadsheetCreation } from '../../mcp/elicitation.js';
import { withTimeout } from '../../utils/timeout.js';
import { getEnv } from '../../config/env.js';

type ResponseFormat = 'full' | 'compact' | 'preview';

interface SpreadsheetOpsDeps {
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  context: HandlerContext;
  deduplicatedApiCall: <T>(key: string, apiCall: () => Promise<T>) => Promise<T>;
  convertTabColor: (
    tabColor: sheets_v4.Schema$Color | null | undefined,
    tabColorStyle?: sheets_v4.Schema$ColorStyle | null | undefined
  ) => SheetInfo['tabColor'];
  applyGetResponseFormat: (
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
  mapError: (error: unknown) => CoreResponse;
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
    return undefined; // OK: no color specified
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
  deps: SpreadsheetOpsDeps
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

/**
 * Decomposed action handler for `get`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleGetAction(
  input: CoreGetInput,
  deps: SpreadsheetOpsDeps
): Promise<CoreResponse> {
  const responseFormat = input.response_format ?? 'full';
  const params: sheets_v4.Params$Resource$Spreadsheets$Get = {
    spreadsheetId: input.spreadsheetId,
    includeGridData: input.includeGridData ?? false,
    fields:
      'spreadsheetId,properties,spreadsheetUrl,sheets(properties(sheetId,title,index,hidden,tabColor,tabColorStyle,gridProperties(rowCount,columnCount)))',
  };
  if (input.ranges && input.ranges.length > 0) {
    params.ranges = input.ranges;
  }

  const cacheKey = createCacheKey('spreadsheet:get', params as unknown as Record<string, unknown>);
  const cached = cacheManager.get<sheets_v4.Schema$Spreadsheet>(cacheKey, 'spreadsheet');

  const data =
    cached ??
    (await (async () => {
      const dedupKey = `spreadsheet:get:${input.spreadsheetId}:${params.fields ?? 'all'}`;
      const response = await deps.deduplicatedApiCall(dedupKey, () =>
        deps.sheetsApi.spreadsheets.get(params)
      );
      const result = response.data;
      cacheManager.set(cacheKey, result, {
        ttl: CACHE_TTL_SPREADSHEET,
        namespace: 'spreadsheet',
      });
      return result;
    })());

  const sheets: SheetInfo[] = (data.sheets ?? []).map((s: sheets_v4.Schema$Sheet) =>
    toSheetInfo(s.properties, deps)
  );

  if (!data.spreadsheetId) {
    return deps.error({
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Sheets API returned incomplete data - missing spreadsheetId',
      details: { inputSpreadsheetId: input.spreadsheetId },
      retryable: true,
      suggestedFix: 'Please try again. If the issue persists, contact support',
      resolution: 'Retry the operation. If the issue persists, check Google Sheets API status.',
    });
  }

  if (deps.context.sessionContext) {
    const current = deps.context.sessionContext.getActiveSpreadsheet();
    if (current?.spreadsheetId === data.spreadsheetId) {
      deps.context.sessionContext.setActiveSpreadsheet({
        ...current,
        locale: data.properties?.locale ?? current.locale,
        timeZone: data.properties?.timeZone ?? current.timeZone,
      });
    } else if (!current) {
      deps.context.sessionContext.setActiveSpreadsheet({
        spreadsheetId: data.spreadsheetId,
        title: data.properties?.title ?? '',
        sheetNames: sheets.map((s) => s.title),
        activatedAt: Date.now(),
        locale: data.properties?.locale ?? undefined,
        timeZone: data.properties?.timeZone ?? undefined,
      });
    }
  }

  const responseData = deps.applyGetResponseFormat(
    {
      spreadsheet: {
        spreadsheetId: data.spreadsheetId,
        title: data.properties?.title ?? '',
        url: data.spreadsheetUrl ?? undefined,
        locale: data.properties?.locale ?? undefined,
        timeZone: data.properties?.timeZone ?? undefined,
        sheets,
      },
    },
    responseFormat
  );

  return deps.success(
    'get',
    responseData,
    undefined,
    undefined,
    deps.buildResponseFormatMeta('get', responseData)
  );
}

/**
 * Decomposed action handler for `create`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleCreateAction(
  input: CoreCreateInput,
  deps: SpreadsheetOpsDeps
): Promise<CoreResponse> {
  const validator = new ScopeValidator({
    scopes: deps.context.auth?.scopes ?? [],
  });

  const operation = 'sheets_core.create';
  const requirements = validator.getOperationRequirements(operation);

  if (requirements && !requirements.satisfied) {
    const authUrl = validator.generateIncrementalAuthUrl(requirements.missing);

    return deps.error({
      code: ErrorCodes.PERMISSION_DENIED,
      message: requirements.description,
      category: 'auth',
      severity: 'high',
      retryable: false,
      suggestedFix:
        'Check that the spreadsheet is shared with the right account, or verify sharing settings',
      retryStrategy: 'manual',
      details: {
        operation,
        requiredScopes: requirements.required,
        currentScopes: deps.context.auth?.scopes ?? [],
        missingScopes: requirements.missing,
        authorizationUrl: authUrl,
        scopeCategory: requirements.category,
      },
      resolution: 'Grant additional permissions to create new spreadsheets.',
      resolutionSteps: [
        '1. Visit the authorization URL to approve required scopes',
        `2. Authorization URL: ${authUrl}`,
        '3. After approving, retry the create operation',
      ],
    });
  }

  let resolvedTitle: string = input.title;
  let resolvedLocale: string | undefined = input.locale;
  let resolvedTimeZone: string | undefined = input.timeZone;
  if (!resolvedTitle && deps.context.server) {
    try {
      const wizardResult = await elicitSpreadsheetCreation(deps.context.server);
      if (wizardResult) {
        resolvedTitle = wizardResult.title;
        resolvedLocale = wizardResult.locale;
        resolvedTimeZone = wizardResult.timeZone;
      }
    } catch {
      // non-blocking - proceed with default
    }
    if (!resolvedTitle) {
      resolvedTitle = 'Untitled Spreadsheet';
    }
  }

  const sheetsConfig: sheets_v4.Schema$Sheet[] | undefined = input.sheets?.map((s) => {
    const sheetProps: sheets_v4.Schema$SheetProperties = {
      title: s.title,
      gridProperties: {
        rowCount: s.rowCount ?? 1000,
        columnCount: s.columnCount ?? 26,
      },
    };
    const tabColor = toRgbTabColor(s.tabColor, s.tabColorStyle);
    const tabColorStyle = toTabColorStyle(s.tabColor, s.tabColorStyle);
    if (tabColor) {
      sheetProps.tabColor = tabColor;
    }
    if (tabColorStyle) {
      sheetProps.tabColorStyle = tabColorStyle;
    }
    return { properties: sheetProps };
  });

  const spreadsheetProps: sheets_v4.Schema$SpreadsheetProperties = {
    title: resolvedTitle,
    locale: resolvedLocale ?? 'en_US',
  };
  if (resolvedTimeZone) {
    spreadsheetProps.timeZone = resolvedTimeZone;
  }

  const requestBody: sheets_v4.Schema$Spreadsheet = {
    properties: spreadsheetProps,
  };
  if (sheetsConfig && sheetsConfig.length > 0) {
    requestBody.sheets = sheetsConfig;
  }

  const response = await deps.sheetsApi.spreadsheets.create({
    requestBody,
    fields:
      'spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,hidden,tabColor,tabColorStyle,gridProperties(rowCount,columnCount)))',
  });

  const data = response.data;
  const sheets: SheetInfo[] = (data.sheets ?? []).map((s: sheets_v4.Schema$Sheet) =>
    toSheetInfo(s.properties, deps)
  );

  if (!data.spreadsheetId) {
    return deps.error({
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Sheets API returned incomplete data after creating spreadsheet',
      details: { title: input.title },
      retryable: true,
      suggestedFix: 'Please try again. If the issue persists, contact support',
      resolution: 'Retry the operation. If the issue persists, check Google Sheets API status.',
    });
  }

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'create',
        spreadsheetId: data.spreadsheetId ?? '',
        description: `Created spreadsheet "${data.properties?.title ?? 'Untitled'}"`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('create', {
    spreadsheet: {
      spreadsheetId: data.spreadsheetId,
      title: data.properties?.title ?? '',
      url: data.spreadsheetUrl ?? undefined,
      locale: data.properties?.locale ?? undefined,
      timeZone: data.properties?.timeZone ?? undefined,
      sheets,
    },
    newSpreadsheetId: data.spreadsheetId,
  });
}

/**
 * Decomposed action handler for `copy`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleCopyAction(
  input: CoreCopyInput,
  deps: SpreadsheetOpsDeps
): Promise<CoreResponse> {
  if (!deps.driveApi) {
    return deps.error({
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Drive API not available - required for spreadsheet copy operation',
      details: {
        spreadsheetId: input.spreadsheetId,
        destinationFolder: input.destinationFolderId,
        requiredScope: 'https://www.googleapis.com/auth/drive.file',
      },
      retryable: false,
      suggestedFix: 'Please try again. If the issue persists, contact support',
      resolution:
        'Ensure Drive API client is initialized with drive.file scope. Check Google API credentials configuration.',
      resolutionSteps: [
        '1. Verify GOOGLE_APPLICATION_CREDENTIALS or service account setup',
        '2. Ensure drive.file scope is included in OAuth scopes',
        '3. Restart the server after fixing credentials',
      ],
    });
  }

  // Accept both 'newTitle' (canonical) and 'title' (LLM-friendly alias)
  let title = input.newTitle ?? ((input as Record<string, unknown>)['title'] as string | undefined);
  if (!title) {
    const current = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'properties.title',
    });
    title = `Copy of ${current.data.properties?.title ?? 'Untitled'}`;
  }

  const copyParams: drive_v3.Params$Resource$Files$Copy = {
    fileId: input.spreadsheetId,
    requestBody: {
      name: title,
      ...(input.destinationFolderId ? { parents: [input.destinationFolderId] } : {}),
    },
    fields: 'id,name,mimeType,webViewLink',
    supportsAllDrives: true,
  };

  try {
    const env = getEnv();
    const response = await withTimeout(
      () => deps.driveApi!.files.copy(copyParams),
      env.COMPOSITE_TIMEOUT_MS,
      'copy_spreadsheet'
    );

    if (!response.data.id) {
      return deps.error({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Drive API returned no file ID after copy operation',
        details: {
          spreadsheetId: input.spreadsheetId,
          copyParams,
        },
        retryable: true,
        suggestedFix: 'Please try again. If the issue persists, contact support',
        resolution:
          'Retry the copy operation. If the issue persists, check Google Drive API status.',
      });
    }

    const newId = response.data.id;

    // Record operation in session context for LLM follow-up references
    try {
      if (deps.context.sessionContext) {
        deps.context.sessionContext.recordOperation({
          tool: 'sheets_core',
          action: 'copy',
          spreadsheetId: input.spreadsheetId,
          description: `Copied spreadsheet to new spreadsheet ${newId}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return deps.success('copy', {
      spreadsheet: {
        spreadsheetId: newId,
        title: response.data.name ?? title,
        url: `https://docs.google.com/spreadsheets/d/${newId}`,
      },
      newSpreadsheetId: newId,
    });
  } catch (err) {
    return deps.mapError(err);
  }
}

/**
 * Decomposed action handler for `update_properties`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleUpdatePropertiesAction(
  input: CoreUpdatePropertiesInput,
  deps: SpreadsheetOpsDeps
): Promise<CoreResponse> {
  const fields: string[] = [];
  const properties: sheets_v4.Schema$SpreadsheetProperties = {};

  if (input.title !== undefined) {
    properties.title = input.title;
    fields.push('title');
  }
  if (input.locale !== undefined) {
    properties.locale = input.locale;
    fields.push('locale');
  }
  if (input.timeZone !== undefined) {
    properties.timeZone = input.timeZone;
    fields.push('timeZone');
  }
  if (input.autoRecalc !== undefined) {
    properties.autoRecalc = input.autoRecalc;
    fields.push('autoRecalc');
  }
  if (input.iterativeCalculationSettings !== undefined) {
    (properties as Record<string, unknown>)['iterativeCalculationSettings'] = {
      enableIterativeCalculation: true,
      maxIterations: input.iterativeCalculationSettings.maxIterations,
      convergenceThreshold: input.iterativeCalculationSettings.convergenceThreshold,
    };
    fields.push('iterativeCalculationSettings');
  }
  if (input.spreadsheetTheme !== undefined) {
    (properties as Record<string, unknown>)['spreadsheetTheme'] = input.spreadsheetTheme;
    fields.push('spreadsheetTheme');
  }

  if (fields.length === 0) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'No properties to update',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const batchResponse = await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: input.spreadsheetId,
    fields: 'updatedSpreadsheet(spreadsheetId,properties,spreadsheetUrl)',
    requestBody: {
      includeSpreadsheetInResponse: true,
      requests: [
        {
          updateSpreadsheetProperties: {
            properties,
            fields: fields.join(','),
          },
        },
      ],
    },
  });

  const updated = batchResponse.data.updatedSpreadsheet;

  if (!updated?.spreadsheetId) {
    return deps.error({
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Sheets API returned incomplete data after update',
      details: { spreadsheetId: input.spreadsheetId },
      retryable: true,
      suggestedFix: 'Please try again. If the issue persists, contact support',
      resolution: 'Retry the operation. If the issue persists, check Google Sheets API status.',
    });
  }

  // Record operation in session context for LLM follow-up references
  try {
    if (deps.context.sessionContext) {
      deps.context.sessionContext.recordOperation({
        tool: 'sheets_core',
        action: 'update_properties',
        spreadsheetId: input.spreadsheetId,
        description: `Updated spreadsheet properties (${fields.join(', ')})`,
        undoable: false,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  return deps.success('update_properties', {
    spreadsheet: {
      spreadsheetId: updated.spreadsheetId,
      title: updated.properties?.title ?? '',
      url: updated.spreadsheetUrl ?? undefined,
      locale: updated.properties?.locale ?? undefined,
      timeZone: updated.properties?.timeZone ?? undefined,
      iterativeCalculationSettings: (updated.properties as Record<string, unknown>)?.[
        'iterativeCalculationSettings'
      ] as
        | {
            enableIterativeCalculation?: boolean;
            maxIterations?: number;
            convergenceThreshold?: number;
          }
        | undefined,
    },
  });
}
