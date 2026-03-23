import { ErrorCodes } from '../error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CoreBatchGetInput,
  CoreGetUrlInput,
  CoreListInput,
  CoreResponse,
  ResponseMeta,
  SheetInfo,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { cacheManager, createCacheKey } from '../../utils/cache-manager.js';
import { CACHE_TTL_SPREADSHEET } from '../../config/constants.js';

type ResponseFormat = 'full' | 'compact' | 'preview';

interface SpreadsheetReadDeps {
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  context: HandlerContext;
  sendProgress?: (completed: number, total: number, message?: string) => Promise<void>;
  resolveSpreadsheetShortcutId: (spreadsheetId: string) => Promise<string>;
  applyBatchGetResponseFormat: (
    responseData: Record<string, unknown>,
    responseFormat: ResponseFormat
  ) => Record<string, unknown>;
  applyListResponseFormat: (
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

/**
 * Decomposed action handler for `get_url`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleGetUrlAction(
  input: CoreGetUrlInput,
  deps: SpreadsheetReadDeps
): Promise<CoreResponse> {
  let url = `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`;
  if (input.sheetId !== undefined) {
    url += `#gid=${input.sheetId}`;
  }

  return deps.success('get_url', { url });
}

/**
 * Decomposed action handler for `batch_get`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleBatchGetAction(
  input: CoreBatchGetInput,
  deps: SpreadsheetReadDeps
): Promise<CoreResponse> {
  const totalSpreadsheets = input.spreadsheetIds.length;
  const shouldReportProgress = totalSpreadsheets >= 20 && typeof deps.sendProgress === 'function';
  let completed = 0;

  if (shouldReportProgress) {
    try {
      await deps.sendProgress!(
        0,
        totalSpreadsheets,
        `Fetching ${totalSpreadsheets} spreadsheets...`
      );
    } catch {
      // Best-effort progress reporting.
    }
  }

  const responseFormat = input.response_format ?? 'full';
  const results = await Promise.all(
    input.spreadsheetIds.map(async (id) => {
      let result: {
        spreadsheetId: string;
        title: string;
        url?: string;
        locale?: string;
        timeZone?: string;
        sheets?: SheetInfo[];
      };

      try {
        const resolvedSpreadsheetId = await deps.resolveSpreadsheetShortcutId(id);

        const cacheKey = createCacheKey('spreadsheet:batch_get', {
          spreadsheetId: resolvedSpreadsheetId,
        });
        const cached = cacheManager.get<sheets_v4.Schema$Spreadsheet>(cacheKey, 'spreadsheet');

        const data =
          cached ??
          (await (async () => {
            const response = await deps.sheetsApi.spreadsheets.get({
              spreadsheetId: resolvedSpreadsheetId,
              fields: 'spreadsheetId,properties,spreadsheetUrl,sheets.properties',
            });
            const result = response.data;
            cacheManager.set(cacheKey, result, {
              ttl: CACHE_TTL_SPREADSHEET,
              namespace: 'spreadsheet',
            });
            return result;
          })());

        const sheets: SheetInfo[] = (data.sheets ?? []).map((s: sheets_v4.Schema$Sheet) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? '',
          index: s.properties?.index ?? 0,
          rowCount: s.properties?.gridProperties?.rowCount ?? 0,
          columnCount: s.properties?.gridProperties?.columnCount ?? 0,
          hidden: s.properties?.hidden ?? false,
        }));

        result = {
          spreadsheetId: data.spreadsheetId ?? resolvedSpreadsheetId,
          title: data.properties?.title ?? '',
          url: data.spreadsheetUrl ?? undefined,
          locale: data.properties?.locale ?? undefined,
          timeZone: data.properties?.timeZone ?? undefined,
          sheets,
        };
      } catch (err) {
        deps.context.logger?.warn?.('Batch get: failed to fetch spreadsheet', {
          spreadsheetId: id,
          error: String(err),
        });
        result = {
          spreadsheetId: id,
          title: '(error)',
        };
      } finally {
        completed += 1;

        if (shouldReportProgress && (completed % 20 === 0 || completed === totalSpreadsheets)) {
          try {
            await deps.sendProgress!(
              completed,
              totalSpreadsheets,
              completed === totalSpreadsheets
                ? `Batch get complete: ${completed}/${totalSpreadsheets}`
                : `Fetched ${completed}/${totalSpreadsheets} spreadsheets...`
            );
          } catch {
            // Best-effort progress reporting.
          }
        }
      }

      return result;
    })
  );

  const responseData = deps.applyBatchGetResponseFormat({ spreadsheets: results }, responseFormat);

  return deps.success(
    'batch_get',
    responseData,
    undefined,
    undefined,
    deps.buildResponseFormatMeta('batch_get', responseData)
  );
}

/**
 * Decomposed action handler for `list`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleListAction(
  input: CoreListInput,
  deps: SpreadsheetReadDeps
): Promise<CoreResponse> {
  const responseFormat = input.response_format ?? 'full';

  if (!deps.driveApi) {
    return deps.error({
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Drive API not available - required for listing spreadsheets',
      details: {
        action: 'list',
        requiredScope: 'https://www.googleapis.com/auth/drive.readonly',
      },
      retryable: false,
      suggestedFix: 'Please try again. If the issue persists, contact support',
      resolution:
        'Ensure Drive API client is initialized. Check Google API credentials configuration.',
      resolutionSteps: [
        '1. Verify GOOGLE_APPLICATION_CREDENTIALS or service account setup',
        '2. Ensure drive.readonly scope is included in OAuth scopes',
        '3. Re-authenticate if using OAuth',
      ],
    });
  }

  // Drive files.list max pageSize is 1000; keep caller's maxResults as a result-count limit only
  const pageSize = Math.min(1000, 100);
  const orderBy = input.orderBy || 'modifiedTime desc';

  let q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  if (input.query) {
    q += ` and ${input.query}`;
  }

  try {
    const allFiles: drive_v3.Schema$File[] = [];
    // Use caller-supplied pageToken (for cursor-based pagination) as the starting token
    let pageToken: string | undefined = input.pageToken ?? undefined;
    const maxPages = 20;
    let pageCount = 0;
    const limit = input.maxResults || 0; // 0 = no limit
    let truncated = false;
    let driveNextPageToken: string | undefined = undefined;

    do {
      const listParams: drive_v3.Params$Resource$Files$List = {
        q,
        pageSize,
        orderBy,
        fields:
          'nextPageToken,files(id,name,createdTime,modifiedTime,webViewLink,owners,lastModifyingUser)',
        spaces: 'drive',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };
      if (pageToken) listParams.pageToken = pageToken;
      const pageResponse = await deps.driveApi.files.list(listParams);

      const files = pageResponse.data.files || [];
      allFiles.push(...files);
      driveNextPageToken = pageResponse.data.nextPageToken ?? undefined;
      pageToken = driveNextPageToken;
      pageCount++;

      if (pageCount >= maxPages && pageToken) {
        deps.context.logger?.warn?.(
          'core.list: pagination cap reached (20 pages / 2000 spreadsheets)',
          {
            totalFetched: allFiles.length,
          }
        );
        truncated = true;
        break;
      }

      if (limit > 0 && allFiles.length >= limit) {
        break;
      }
    } while (pageToken);

    // Surface a nextPageToken when there are more results available
    const returnNextPageToken = truncated ? pageToken : driveNextPageToken;

    const sliced = limit > 0 ? allFiles.slice(0, limit) : allFiles;

    const spreadsheets = sliced
      .filter((file) => file.id && file.name)
      .map((file) => ({
        spreadsheetId: file.id as string,
        title: file.name as string,
        url: file.webViewLink ?? undefined,
        createdTime: file.createdTime ?? undefined,
        modifiedTime: file.modifiedTime ?? undefined,
        owners: file.owners?.map((o) => ({
          email: o.emailAddress ?? undefined,
          displayName: o.displayName ?? undefined,
        })),
        lastModifiedBy: file.lastModifyingUser?.emailAddress ?? undefined,
      }));

    const responseData = deps.applyListResponseFormat({ spreadsheets }, responseFormat);
    // Merge pagination truncation with preview-mode truncation
    const mergedTruncated = (responseData['truncated'] as boolean | undefined) || truncated;
    const mergedResponseData = { ...responseData, truncated: mergedTruncated };

    return deps.success(
      'list',
      {
        ...mergedResponseData,
        ...(returnNextPageToken ? { nextPageToken: returnNextPageToken } : {}),
      },
      undefined,
      undefined,
      deps.buildResponseFormatMeta('list', mergedResponseData)
    );
  } catch (err) {
    return deps.mapError(err);
  }
}
