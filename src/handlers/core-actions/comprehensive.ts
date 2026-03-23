import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type { CoreGetComprehensiveInput, CoreResponse } from '../../schemas/index.js';
import type { ErrorDetail } from '../../schemas/shared.js';
import { cacheManager, createCacheKey } from '../../utils/cache-manager.js';
import { CACHE_TTL_SPREADSHEET } from '../../config/constants.js';

interface ComprehensiveDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  sendProgress: (current: number, total: number, message?: string) => Promise<void>;
  success: (action: string, data: Record<string, unknown>) => CoreResponse;
  error: (error: ErrorDetail) => CoreResponse;
}

function encodeSheetPaginationCursor(state: { sheetIndex: number; maxSheets: number }): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function decodeSheetPaginationCursor(
  context: HandlerContext,
  cursor?: string
): { sheetIndex: number; maxSheets: number } | null {
  if (!cursor) return null;

  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const state = JSON.parse(decoded);
    if (typeof state.sheetIndex !== 'number' || typeof state.maxSheets !== 'number') {
      return null;
    }
    return state;
  } catch (err) {
    context.logger?.warn?.('Failed to decode pagination cursor', { error: String(err) });
    return null;
  }
}

/**
 * Decomposed action handler for `get_comprehensive`.
 * Preserves original behavior while moving logic out of the main SheetsCoreHandler class.
 */
export async function handleGetComprehensiveAction(
  input: CoreGetComprehensiveInput,
  deps: ComprehensiveDeps
): Promise<CoreResponse> {
  const startTime = Date.now();

  const paginationState = decodeSheetPaginationCursor(deps.context, input.cursor) || {
    sheetIndex: 0,
    maxSheets: input.maxSheets ?? 5,
  };

  const metaResponse = await deps.sheetsApi.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: 'spreadsheetId,properties,spreadsheetUrl,namedRanges,sheets.properties(title,sheetId)',
  });

  const allSheets = metaResponse.data.sheets ?? [];
  const totalSheets = allSheets.length;

  if (paginationState.sheetIndex < 0 || paginationState.sheetIndex > totalSheets) {
    return deps.error({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Invalid pagination cursor: sheet index out of bounds',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      details: { cursor: input.cursor, sheetIndex: paginationState.sheetIndex, totalSheets },
    });
  }

  const startIndex = paginationState.sheetIndex;
  const endIndex = Math.min(startIndex + paginationState.maxSheets, totalSheets);
  const sheetsToFetch = allSheets.slice(startIndex, endIndex);
  const hasMore = endIndex < totalSheets;
  const nextCursor = hasMore
    ? encodeSheetPaginationCursor({
        sheetIndex: endIndex,
        maxSheets: paginationState.maxSheets,
      })
    : undefined;

  const baseFields = [
    'spreadsheetId',
    'properties',
    'spreadsheetUrl',
    'namedRanges',
    'sheets(properties,conditionalFormats,protectedRanges,charts,filterViews,basicFilter,merges)',
  ];

  if (input.includeGridData) {
    baseFields.push('sheets.data.rowData.values(dataValidation,pivotTable,formattedValue)');
  }

  const fields = baseFields.join(',');

  let ranges: string[] | undefined;
  if (input.includeGridData) {
    ranges = sheetsToFetch
      .map((s) => {
        const title = s.properties?.title;
        if (!title) return null;
        const maxRows = input.maxRowsPerSheet ?? 100;
        const escapedTitle = title.replace(/'/g, "''");
        return `'${escapedTitle}'!A1:Z${maxRows}`;
      })
      .filter((r): r is string => r !== null);
  }

  const cacheKey = createCacheKey('spreadsheet:comprehensive', {
    spreadsheetId: input.spreadsheetId,
    includeGridData: input.includeGridData ?? false,
    maxRows: input.maxRowsPerSheet ?? 100,
    sheetIndex: startIndex,
    maxSheets: paginationState.maxSheets,
  });
  const cached = cacheManager.get<sheets_v4.Schema$Spreadsheet>(cacheKey, 'spreadsheet');

  const data =
    cached ??
    (await (async () => {
      const params: sheets_v4.Params$Resource$Spreadsheets$Get = {
        spreadsheetId: input.spreadsheetId,
        includeGridData: input.includeGridData ?? false,
        fields,
      };

      if (ranges && ranges.length > 0) {
        params.ranges = ranges;
      }

      const response = await deps.sheetsApi.spreadsheets.get(params);
      const result = response.data;

      cacheManager.set(cacheKey, result, {
        ttl: CACHE_TTL_SPREADSHEET,
        namespace: 'spreadsheet',
      });

      return result;
    })());

  await deps.sendProgress(
    endIndex,
    totalSheets,
    `Fetched ${endIndex - startIndex} sheets (${startIndex + 1}-${endIndex} of ${totalSheets})`
  );

  const paginatedSheets = data.sheets?.slice(startIndex, endIndex) ?? [];

  const sheetsCount = paginatedSheets.length;
  const namedRangesCount = data.namedRanges?.length ?? 0;
  const totalCharts = paginatedSheets.reduce((sum, s) => sum + (s.charts?.length ?? 0), 0);
  const totalConditionalFormats = paginatedSheets.reduce(
    (sum, s) => sum + (s.conditionalFormats?.length ?? 0),
    0
  );
  const totalProtectedRanges = paginatedSheets.reduce(
    (sum, s) => sum + (s.protectedRanges?.length ?? 0),
    0
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

  type ComprehensiveMeta = NonNullable<
    Extract<CoreResponse, { success: true }>['comprehensiveMetadata']
  >;
  type SheetEntry = NonNullable<ComprehensiveMeta['sheets']>[number];

  const comprehensiveMetadata: ComprehensiveMeta = {
    spreadsheetId: data.spreadsheetId!,
    properties: data.properties as unknown as ComprehensiveMeta['properties'],
    namedRanges: data.namedRanges as unknown as ComprehensiveMeta['namedRanges'],
    sheets: paginatedSheets.map((s) => ({
      properties: s.properties as unknown as SheetEntry['properties'],
      conditionalFormats: s.conditionalFormats as unknown as SheetEntry['conditionalFormats'],
      protectedRanges: s.protectedRanges as unknown as SheetEntry['protectedRanges'],
      charts: s.charts as unknown as SheetEntry['charts'],
      filterViews: s.filterViews as unknown as SheetEntry['filterViews'],
      basicFilter: s.basicFilter as unknown as SheetEntry['basicFilter'],
      merges: s.merges as unknown as SheetEntry['merges'],
      data: s.data as unknown as SheetEntry['data'],
    })),
    stats: {
      sheetsCount,
      namedRangesCount,
      totalCharts,
      totalConditionalFormats,
      totalProtectedRanges,
      cacheHit: !!cached,
      fetchTime: Date.now() - startTime,
    },
    pagination: {
      hasMore,
      nextCursor,
      totalSheets,
      currentPage: {
        startIndex,
        endIndex,
        count: sheetsCount,
      },
    },
  };

  return deps.success('get_comprehensive', { comprehensiveMetadata });
}
