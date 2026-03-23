/**
 * Read / Write / Append / Clear action handlers for sheets_data.
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { DataResponse, SheetsDataInput } from '../../schemas/data.js';
import type { ValuesArray } from '../../schemas/index.js';
import { getEnv, getBackgroundAnalysisConfig } from '../../config/env.js';
import { getETagCache } from '../../services/etag-cache.js';
import { v4 as uuidv4 } from 'uuid';
import { getBackgroundAnalyzer } from '../../services/background-analyzer.js';
import { getRequestLogger } from '../../utils/request-context.js';
import type { DataHandlerAccess, ResponseFormat } from './internal.js';
import {
  a1ToGridRange,
  resolveRangeToA1,
  applyReadResponseFormat,
  buildResponseFormatMeta,
  buildPaginationPlan,
  buildPayloadWarnings,
  payloadTooLargeError,
  validateValuesPayloadIfEnabled,
  checkFormulaInjection,
} from './helpers.js';
import {
  buildA1Notation,
  parseA1Notation,
  toGridRange,
} from '../../utils/google-sheets-helpers.js';

type DataRequest = SheetsDataInput['request'];

const FULL_COLUMN_A1_RE = /^(?:'([^']+)'!|([^!]+)!)?[A-Z]+:[A-Z]+$/i;

function expandWriteRangeToFitValues(range: string, values: ValuesArray): string {
  if (range === '(dynamic)' || FULL_COLUMN_A1_RE.test(range)) {
    return range;
  }

  if (values.length === 0) {
    return range;
  }

  const payloadColumnCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  if (payloadColumnCount === 0) {
    return range;
  }

  try {
    const parsed = parseA1Notation(range);
    const requiredEndRow = Math.max(parsed.endRow, parsed.startRow + values.length);
    const requiredEndCol = Math.max(parsed.endCol, parsed.startCol + payloadColumnCount);

    if (requiredEndRow === parsed.endRow && requiredEndCol === parsed.endCol) {
      return range;
    }

    return buildA1Notation(
      parsed.sheetName,
      parsed.startCol,
      parsed.startRow,
      requiredEndCol,
      requiredEndRow
    );
  } catch {
    return range;
  }
}

// ─── handleRead ───────────────────────────────────────────────────────────────

export async function handleRead(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'read' }
): Promise<DataResponse> {
  const responseFormat = (input.response_format ?? 'full') as ResponseFormat;

  if (input.dataFilter) {
    if (!ha.featureFlags.enableDataFilterBatch) {
      ha.context.metrics?.recordFeatureFlagBlock({
        flag: 'dataFilterBatch',
        tool: ha.toolName,
        action: 'read',
      });
      return ha.makeError({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message: 'DataFilter reads are disabled. Set ENABLE_DATAFILTER_BATCH=true.',
        retryable: false,
        suggestedFix: 'Enable the feature by setting the appropriate environment variable',
      });
    }

    const response = await ha.api.spreadsheets.values.batchGetByDataFilter({
      spreadsheetId: input.spreadsheetId,
      fields: 'valueRanges(valueRange(range,values))',
      requestBody: {
        dataFilters: [input.dataFilter],
        valueRenderOption: input.valueRenderOption,
        majorDimension: input.majorDimension,
      },
    });

    const valueRanges = response.data.valueRanges ?? [];
    if (valueRanges.length === 0) {
      return ha.makeError({
        code: ErrorCodes.NOT_FOUND,
        message: 'No data matched the provided DataFilter',
        retryable: false,
        suggestedFix:
          'Check that developer metadata exists for the given lookup criteria. Use sheets_advanced.set_metadata to tag ranges first.',
      });
    }

    const matchedValueRange = valueRanges[0];
    if (!matchedValueRange) {
      return ha.makeError({
        code: ErrorCodes.NO_DATA,
        message: 'No data found matching the filter',
        retryable: false,
      });
    }
    const range = matchedValueRange.valueRange?.range ?? '';
    const values = (matchedValueRange.valueRange?.values ?? []) as ValuesArray;

    try {
      if (ha.context.sessionContext && range) {
        ha.context.sessionContext.setLastRange(range);
      }
    } catch {
      /* non-blocking */
    }

    const responseData = applyReadResponseFormat(
      {
        range,
        values,
        rowCount: values.length,
        columnCount: values.length > 0 ? Math.max(...values.map((row) => row.length)) : 0,
      },
      responseFormat
    );
    return ha.makeSuccess(
      'read',
      responseData,
      undefined,
      undefined,
      buildResponseFormatMeta(ha, 'read', responseData)
    );
  }

  // Traditional range-based path
  const range = await resolveRangeToA1(ha, input.spreadsheetId, input.range!);

  if (ha.context.sessionContext) {
    const redundantTimestamp = ha.context.sessionContext.checkRedundantRead(
      input.spreadsheetId,
      range
    );
    if (redundantTimestamp !== null) {
      const logger = ha.context.logger;
      logger?.info('Redundant read operation detected - consider caching or batch_read', {
        spreadsheetId: input.spreadsheetId,
        range,
        timeSinceLastRead: Date.now() - redundantTimestamp,
      });
    }
    ha.context.sessionContext.trackReadOperation(input.spreadsheetId, range);
  }

  const paginationPlan = buildPaginationPlan(ha, {
    range,
    cursor: input.cursor,
    pageSize: input.pageSize,
    chunkSize: input.chunkSize,
    streaming: input.streaming,
  });
  if (paginationPlan && 'error' in paginationPlan) {
    return paginationPlan.error;
  }
  const readRange = paginationPlan?.range ?? range;
  const etagCache = getETagCache();

  const cacheKey = {
    spreadsheetId: input.spreadsheetId,
    endpoint: 'values' as const,
    range: readRange,
    params: {
      valueRenderOption: input.valueRenderOption,
      majorDimension: input.majorDimension,
    },
  };

  const cachedData = (await etagCache.getCachedData(
    cacheKey
  )) as sheets_v4.Schema$ValueRange | null;
  if (cachedData && etagCache.getETag(cacheKey)) {
    ha.context.logger?.info('Cache hit for values read', {
      spreadsheetId: input.spreadsheetId,
      range: readRange,
      savedApiCall: true,
    });

    const values = (cachedData.values ?? []) as ValuesArray;
    const result: Record<string, unknown> = {
      values,
      range: cachedData.range ?? readRange,
      _cached: true,
    };
    if (cachedData.majorDimension) {
      result['majorDimension'] = cachedData.majorDimension;
    }
    if (paginationPlan) {
      result['nextCursor'] = paginationPlan.nextCursor;
      result['hasMore'] = paginationPlan.hasMore;
      result['totalRows'] = paginationPlan.totalRows;
      if (paginationPlan.hasMore && paginationPlan.nextCursor) {
        result['_paginationHint'] =
          `Showing page of ${paginationPlan.totalRows} total rows. ` +
          `To fetch next page, repeat this call with cursor:"${paginationPlan.nextCursor}"`;
      }
    }
    try {
      if (ha.context.sessionContext && (cachedData.range ?? readRange)) {
        ha.context.sessionContext.setLastRange(cachedData.range ?? readRange);
      }
    } catch {
      /* non-blocking */
    }
    const responseData = applyReadResponseFormat(result, responseFormat);
    return ha.makeSuccess(
      'read',
      responseData,
      undefined,
      undefined,
      buildResponseFormatMeta(ha, 'read', responseData)
    );
  }

  const env = getEnv();
  let responseData: sheets_v4.Schema$ValueRange;

  if (ha.context.requestMerger && env.ENABLE_REQUEST_MERGING) {
    responseData = await ha.context.requestMerger.mergeRead(
      ha.api,
      input.spreadsheetId,
      readRange,
      {
        valueRenderOption: input.valueRenderOption,
        majorDimension: input.majorDimension,
      }
    );
  } else {
    const dedupKey = `values:get:${input.spreadsheetId}:${readRange}:${input.valueRenderOption ?? 'FORMATTED_VALUE'}:${input.majorDimension ?? 'ROWS'}`;
    const response = await ha.deduplicatedApiCall(dedupKey, () =>
      ha.api.spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range: readRange,
        valueRenderOption: input.valueRenderOption,
        majorDimension: input.majorDimension,
        dateTimeRenderOption:
          ((input as Record<string, unknown>)['dateTimeRenderOption'] as string) ??
          (input.valueRenderOption === 'UNFORMATTED_VALUE' ? 'SERIAL_NUMBER' : undefined),
        fields: 'range,values,majorDimension',
      })
    );
    responseData = response.data;
  }

  etagCache.setETag(cacheKey, `cached-${Date.now()}`, responseData);

  ha.recordAccessAndPrefetch({
    spreadsheetId: input.spreadsheetId,
    range: readRange,
    action: 'read',
  });

  const values = (responseData.values ?? []) as ValuesArray;
  const resolvedRange = responseData.range ?? readRange;
  const result: Record<string, unknown> = {
    values,
    range: resolvedRange,
  };

  if (responseData.majorDimension) {
    result['majorDimension'] = responseData.majorDimension;
  }
  if (paginationPlan) {
    result['nextCursor'] = paginationPlan.nextCursor;
    result['hasMore'] = paginationPlan.hasMore;
    result['totalRows'] = paginationPlan.totalRows;
    if (paginationPlan.hasMore && paginationPlan.nextCursor) {
      result['_paginationHint'] =
        `Showing page of ${paginationPlan.totalRows} total rows. ` +
        `To fetch next page, repeat this call with cursor:"${paginationPlan.nextCursor}"`;
    }
  }

  try {
    if (ha.context.sessionContext && resolvedRange) {
      ha.context.sessionContext.setLastRange(resolvedRange);
    }
  } catch {
    /* non-blocking */
  }

  const responseDataWithFormat = applyReadResponseFormat(result, responseFormat);
  return ha.makeSuccess(
    'read',
    responseDataWithFormat,
    undefined,
    undefined,
    buildResponseFormatMeta(ha, 'read', responseDataWithFormat)
  );
}

// ─── handleWrite ─────────────────────────────────────────────────────────────

export async function handleWrite(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'write' }
): Promise<DataResponse> {
  if (input.safety?.sanitizeFormulas !== false) {
    const injected = checkFormulaInjection(input.values as unknown[][]);
    if (injected) {
      return ha.makeError({
        code: ErrorCodes.FORMULA_INJECTION_BLOCKED,
        message: `Dangerous formula detected at ${injected}. Set safety.sanitizeFormulas=false to allow, or remove the formula.`,
        retryable: false,
        suggestedFix:
          'Remove formulas containing IMPORTDATA, IMPORTRANGE, IMPORTFEED, IMPORTHTML, IMPORTXML, GOOGLEFINANCE, or QUERY from the values array.',
      });
    }
  }

  const range = input.range
    ? await resolveRangeToA1(ha, input.spreadsheetId, input.range)
    : '(dynamic)';
  const writeRange = expandWriteRangeToFitValues(range, input.values);
  if (writeRange !== range) {
    ha.context.logger?.info('Expanded bounded write range to fit payload', {
      originalRange: range,
      expandedRange: writeRange,
      payloadRows: input.values.length,
      payloadColumns: input.values.reduce((max, row) => Math.max(max, row.length), 0),
    });
  }
  const payloadValidation = validateValuesPayloadIfEnabled(ha, input.values, writeRange);
  if (!payloadValidation.withinLimits) {
    return payloadTooLargeError(ha, 'write', payloadValidation);
  }
  const cellCount = input.values.reduce((sum: number, row: unknown[]) => sum + row.length, 0);

  if (input.dataFilter) {
    if (!ha.featureFlags.enableDataFilterBatch) {
      return ha.makeError({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message: 'DataFilter writes are disabled. Set ENABLE_DATAFILTER_BATCH=true.',
        retryable: false,
        suggestedFix: 'Enable the feature by setting the appropriate environment variable',
      });
    }

    if (input.safety?.dryRun) {
      const warnings = buildPayloadWarnings(ha, 'write', payloadValidation);
      const meta = warnings
        ? {
            ...ha.generateMeta('write', input as Record<string, unknown>, {
              updatedCells: cellCount,
            }),
            warnings,
          }
        : undefined;
      return ha.makeSuccess(
        'write',
        {
          updatedCells: cellCount,
          updatedRows: input.values.length,
          updatedColumns:
            input.values.length > 0
              ? Math.max(...input.values.map((row: unknown[]) => row.length))
              : 0,
        },
        undefined,
        true,
        meta
      );
    }

    const response = await ha.api.spreadsheets.values.batchUpdateByDataFilter({
      spreadsheetId: input.spreadsheetId,
      fields: 'totalUpdatedCells,totalUpdatedRows,totalUpdatedColumns,responses',
      requestBody: {
        valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
        includeValuesInResponse: input.includeValuesInResponse ?? false,
        data: [
          {
            dataFilter: input.dataFilter,
            values: input.values,
            majorDimension: (input as DataRequest & { majorDimension?: string }).majorDimension,
          },
        ],
      },
    });

    getETagCache().invalidateSpreadsheet(input.spreadsheetId);

    const responseData: Record<string, unknown> = {
      updatedCells: response.data.totalUpdatedCells ?? 0,
      updatedRows: response.data.totalUpdatedRows ?? 0,
      updatedColumns: response.data.totalUpdatedColumns ?? 0,
    };

    if (response.data.responses && response.data.responses.length > 0) {
      responseData['updatedRange'] = response.data.responses[0]?.['updatedRange'] ?? '(dataFilter)';
    }

    const warnings = buildPayloadWarnings(ha, 'write', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('write', input as Record<string, unknown>, responseData, {
            cellsAffected: response.data.totalUpdatedCells ?? undefined,
          }),
          warnings,
        }
      : undefined;

    return ha.makeSuccess('write', responseData, undefined, undefined, meta);
  }

  // Traditional range-based path
  if (input.safety?.dryRun) {
    const warnings = buildPayloadWarnings(ha, 'write', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('write', input as Record<string, unknown>, {
            updatedCells: cellCount,
            updatedRows: input.values.length,
            updatedColumns:
              input.values.length > 0
                ? Math.max(...input.values.map((row: unknown[]) => row.length))
                : 0,
            updatedRange: writeRange,
          }),
          warnings,
        }
      : undefined;

    return ha.makeSuccess(
      'write',
      {
        updatedCells: cellCount,
        updatedRows: input.values.length,
        updatedColumns:
          input.values.length > 0
            ? Math.max(...input.values.map((row: unknown[]) => row.length))
            : 0,
        updatedRange: writeRange,
      },
      undefined,
      true,
      meta
    );
  }

  if (ha.context.batchingSystem) {
    try {
      const result = await ha.context.batchingSystem.execute<sheets_v4.Schema$UpdateValuesResponse>(
        {
          id: uuidv4(),
          type: 'values:update',
          spreadsheetId: input.spreadsheetId,
          params: {
            range: writeRange,
            values: input.values,
            valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
          },
        }
      );

      getETagCache().invalidateSpreadsheet(input.spreadsheetId);

      const responseData: Record<string, unknown> = {
        updatedCells: result?.updatedCells ?? cellCount,
        updatedRows: result?.updatedRows ?? input.values.length,
        updatedColumns: result?.updatedColumns ?? 0,
        updatedRange: result?.updatedRange ?? writeRange,
        _batched: true,
      };

      const analysisConfig = getBackgroundAnalysisConfig();
      const cellsAffected = (responseData['updatedCells'] as number | undefined) ?? cellCount;
      if (analysisConfig.enabled && cellsAffected >= analysisConfig.minCells) {
        const analyzer = getBackgroundAnalyzer();
        analyzer.analyzeInBackground(input.spreadsheetId, writeRange, cellsAffected, ha.api, {
          qualityThreshold: 70,
          minCellsChanged: analysisConfig.minCells,
          debounceMs: analysisConfig.debounceMs,
        });
      }

      const warnings = buildPayloadWarnings(ha, 'write', payloadValidation);
      const meta = warnings
        ? {
            ...ha.generateMeta('write', input as Record<string, unknown>, responseData, {
              cellsAffected: (responseData['updatedCells'] as number | undefined) ?? undefined,
            }),
            warnings,
          }
        : undefined;

      // Record operation in session context for LLM follow-up references
      try {
        if (ha.context.sessionContext) {
          ha.context.sessionContext.recordOperation({
            tool: 'sheets_data',
            action: 'write',
            spreadsheetId: input.spreadsheetId,
            range: (responseData['updatedRange'] as string) ?? writeRange,
            description: `Wrote ${(responseData['updatedCells'] as number) ?? 0} cell(s) to ${(responseData['updatedRange'] as string) ?? writeRange}`,
            undoable: false,
            cellsAffected: (responseData['updatedCells'] as number) ?? 0,
          });
        }
      } catch {
        // Non-blocking: session context recording is best-effort
      }

      return ha.makeSuccess('write', responseData, undefined, undefined, meta);
    } catch (err) {
      ha.context.logger?.warn('Batching failed, falling back to direct API call', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // preserveDataValidation path: use batchUpdate/updateCells with fields=userEnteredValue
  // so existing data validation rules on target cells are not cleared.
  if (input.preserveDataValidation && writeRange !== '(dynamic)') {
    const { buildRowData } = await import('./helpers.js');
    const gridRange = await a1ToGridRange(ha, input.spreadsheetId, writeRange);
    const rows = buildRowData(input.values, input.valueInputOption ?? 'USER_ENTERED');
    await ha.withCircuitBreaker('batchUpdate.updateCells', () =>
      ha.api.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [
            { updateCells: { range: toGridRange(gridRange), rows, fields: 'userEnteredValue' } },
          ],
          includeSpreadsheetInResponse: false,
        },
      })
    );
    getETagCache().invalidateSpreadsheet(input.spreadsheetId);
    const responseData: Record<string, unknown> = {
      updatedCells: cellCount,
      updatedRows: input.values.length,
      updatedColumns:
        input.values.length > 0 ? Math.max(...input.values.map((row: unknown[]) => row.length)) : 0,
      updatedRange: writeRange,
    };
    try {
      if (ha.context.sessionContext) {
        ha.context.sessionContext.recordOperation({
          tool: 'sheets_data',
          action: 'write',
          spreadsheetId: input.spreadsheetId,
          range: writeRange,
          description: `Wrote ${cellCount} cell(s) to ${writeRange} (validation preserved)`,
          undoable: false,
          cellsAffected: cellCount,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }
    const warnings = buildPayloadWarnings(ha, 'write', payloadValidation);
    const meta = warnings
      ? { ...ha.generateMeta('write', input as Record<string, unknown>, responseData), warnings }
      : undefined;
    return ha.makeSuccess('write', responseData, undefined, undefined, meta);
  }

  const response = await ha.withCircuitBreaker('values.update', () =>
    ha.api.spreadsheets.values.update({
      spreadsheetId: input.spreadsheetId,
      range: writeRange,
      valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
      includeValuesInResponse: input.includeValuesInResponse ?? false,
      requestBody: { values: input.values },
      fields: 'spreadsheetId,updatedCells,updatedRows,updatedColumns,updatedRange',
    })
  );

  getETagCache().invalidateSpreadsheet(input.spreadsheetId);

  const responseData: Record<string, unknown> = {
    updatedCells: response.data.updatedCells ?? 0,
    updatedRows: response.data.updatedRows ?? 0,
    updatedColumns: response.data.updatedColumns ?? 0,
    updatedRange: response.data.updatedRange ?? writeRange,
  };

  const analysisConfig = getBackgroundAnalysisConfig();
  const cellsAffected = response.data.updatedCells ?? 0;
  if (analysisConfig.enabled && cellsAffected >= analysisConfig.minCells) {
    const analyzer = getBackgroundAnalyzer();
    analyzer.analyzeInBackground(input.spreadsheetId, writeRange, cellsAffected, ha.api, {
      qualityThreshold: 70,
      minCellsChanged: analysisConfig.minCells,
      debounceMs: analysisConfig.debounceMs,
    });
  }

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: input.spreadsheetId,
        range: response.data.updatedRange ?? writeRange,
        description: `Wrote ${response.data.updatedCells ?? 0} cell(s) to ${response.data.updatedRange ?? writeRange}`,
        undoable: false,
        cellsAffected: response.data.updatedCells ?? 0,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  const warnings = buildPayloadWarnings(ha, 'write', payloadValidation);
  const meta = warnings
    ? {
        ...ha.generateMeta('write', input as Record<string, unknown>, responseData, {
          cellsAffected: response.data.updatedCells ?? undefined,
        }),
        warnings,
      }
    : undefined;

  return ha.makeSuccess('write', responseData, undefined, undefined, meta);
}

// ─── handleAppend ─────────────────────────────────────────────────────────────

export async function handleAppend(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'append' }
): Promise<DataResponse> {
  if (input.safety?.sanitizeFormulas !== false) {
    const injected = checkFormulaInjection(input.values as unknown[][]);
    if (injected) {
      return ha.makeError({
        code: ErrorCodes.FORMULA_INJECTION_BLOCKED,
        message: `Dangerous formula detected at ${injected}. Set safety.sanitizeFormulas=false to allow, or remove the formula.`,
        retryable: false,
        suggestedFix:
          'Remove formulas containing IMPORTDATA, IMPORTRANGE, IMPORTFEED, IMPORTHTML, IMPORTXML, GOOGLEFINANCE, or QUERY from the values array.',
      });
    }
  }
  const range = input.range
    ? await resolveRangeToA1(ha, input.spreadsheetId, input.range)
    : undefined;
  const payloadValidation = validateValuesPayloadIfEnabled(ha, input.values, range);
  if (!payloadValidation.withinLimits) {
    return payloadTooLargeError(ha, 'append', payloadValidation);
  }
  const cellCount = input.values.reduce((sum: number, row: unknown[]) => sum + row.length, 0);

  if (input.safety?.dryRun) {
    const warnings = buildPayloadWarnings(ha, 'append', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('append', input as Record<string, unknown>, {
            updatedCells: cellCount,
            updatedRows: input.values.length,
            updatedColumns:
              input.values.length > 0
                ? Math.max(...input.values.map((row: unknown[]) => row.length))
                : 0,
            ...(range ? { updatedRange: range } : {}),
          }),
          warnings,
        }
      : undefined;

    return ha.makeSuccess(
      'append',
      {
        updatedCells: cellCount,
        updatedRows: input.values.length,
        updatedColumns:
          input.values.length > 0
            ? Math.max(...input.values.map((row: unknown[]) => row.length))
            : 0,
        ...(range ? { updatedRange: range } : {}),
      },
      undefined,
      true,
      meta
    );
  }

  if (input.tableId) {
    if (!ha.featureFlags.enableTableAppends) {
      ha.context.metrics?.recordFeatureFlagBlock({
        flag: 'tableAppends',
        tool: ha.toolName,
        action: 'append',
      });
      return ha.makeError({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message: 'Table appends are disabled. Set ENABLE_TABLE_APPENDS=true to enable.',
        retryable: false,
        suggestedFix:
          'Enable the feature by setting the appropriate environment variable, or contact your administrator',
      });
    }

    if (ha.context.batchingSystem) {
      try {
        await ha.context.batchingSystem.execute({
          id: uuidv4(),
          type: 'values:append',
          spreadsheetId: input.spreadsheetId,
          params: {
            tableId: input.tableId,
            range,
            values: input.values,
            valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
          },
        });

        getETagCache().invalidateSpreadsheet(input.spreadsheetId);

        const responseData: Record<string, unknown> = {
          updatedCells: cellCount,
          updatedRows: input.values.length,
          updatedColumns:
            input.values.length > 0
              ? Math.max(...input.values.map((row: unknown[]) => row.length))
              : 0,
          ...(range ? { updatedRange: range } : {}),
          _batched: true,
        };

        const analysisConfig = getBackgroundAnalysisConfig();
        if (analysisConfig.enabled && cellCount >= analysisConfig.minCells) {
          const analyzer = getBackgroundAnalyzer();
          analyzer.analyzeInBackground(input.spreadsheetId, range ?? 'A1', cellCount, ha.api, {
            qualityThreshold: 70,
            minCellsChanged: analysisConfig.minCells,
            debounceMs: analysisConfig.debounceMs,
          });
        }

        const warnings = buildPayloadWarnings(ha, 'append', payloadValidation);
        const meta = warnings
          ? {
              ...ha.generateMeta('append', input as Record<string, unknown>, responseData, {
                cellsAffected: cellCount,
              }),
              warnings,
            }
          : undefined;

        return ha.makeSuccess('append', responseData, undefined, undefined, meta);
      } catch (err) {
        ha.context.logger?.warn('Batching failed for table append, falling back to direct API', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const { buildRowData } = await import('./helpers.js');
    const rows = buildRowData(input.values, input.valueInputOption ?? 'USER_ENTERED');

    await ha.api.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            appendCells: {
              tableId: input.tableId,
              rows,
              fields: 'userEnteredValue',
            },
          },
        ],
        includeSpreadsheetInResponse: false,
      },
    });

    getETagCache().invalidateSpreadsheet(input.spreadsheetId);

    const responseData: Record<string, unknown> = {
      updatedCells: cellCount,
      updatedRows: input.values.length,
      updatedColumns:
        input.values.length > 0 ? Math.max(...input.values.map((row: unknown[]) => row.length)) : 0,
      ...(range ? { updatedRange: range } : {}),
    };

    const analysisConfig = getBackgroundAnalysisConfig();
    if (analysisConfig.enabled && cellCount >= analysisConfig.minCells) {
      const analyzer = getBackgroundAnalyzer();
      analyzer.analyzeInBackground(input.spreadsheetId, range ?? 'A1', cellCount, ha.api, {
        qualityThreshold: 70,
        minCellsChanged: analysisConfig.minCells,
        debounceMs: analysisConfig.debounceMs,
      });
    }

    const warnings = buildPayloadWarnings(ha, 'append', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('append', input as Record<string, unknown>, responseData, {
            cellsAffected: cellCount,
          }),
          warnings,
        }
      : undefined;

    return ha.makeSuccess('append', responseData, undefined, undefined, meta);
  }

  if (!range) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Range is required when tableId is not provided for append',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  if (ha.context.batchingSystem) {
    try {
      const result = await ha.context.batchingSystem.execute<sheets_v4.Schema$AppendValuesResponse>(
        {
          id: uuidv4(),
          type: 'values:append',
          spreadsheetId: input.spreadsheetId,
          params: {
            range,
            values: input.values,
            valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
            insertDataOption: input.insertDataOption ?? 'INSERT_ROWS',
          },
        }
      );

      getETagCache().invalidateSpreadsheet(input.spreadsheetId);

      const updates = result?.updates;
      const responseData: Record<string, unknown> = {
        updatedCells: updates?.updatedCells ?? cellCount,
        updatedRows: updates?.updatedRows ?? input.values.length,
        updatedColumns: updates?.updatedColumns ?? 0,
        updatedRange: updates?.updatedRange ?? range,
        _batched: true,
      };

      const analysisConfig = getBackgroundAnalysisConfig();
      const affectedCells = (updates?.updatedCells as number | undefined) ?? cellCount;
      if (analysisConfig.enabled && affectedCells >= analysisConfig.minCells) {
        const analyzer = getBackgroundAnalyzer();
        analyzer.analyzeInBackground(input.spreadsheetId, range, affectedCells, ha.api, {
          qualityThreshold: 70,
          minCellsChanged: analysisConfig.minCells,
          debounceMs: analysisConfig.debounceMs,
        });
      }

      const warnings = buildPayloadWarnings(ha, 'append', payloadValidation);
      const meta = warnings
        ? {
            ...ha.generateMeta('append', input as Record<string, unknown>, responseData, {
              cellsAffected: updates?.updatedCells ?? cellCount,
            }),
            warnings,
          }
        : undefined;

      return ha.makeSuccess('append', responseData, undefined, undefined, meta);
    } catch (err) {
      ha.context.logger?.warn('Batching failed for append, falling back to direct API', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const response = await ha.withCircuitBreaker('values.append', () =>
    ha.api.spreadsheets.values.append({
      spreadsheetId: input.spreadsheetId,
      range,
      valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
      insertDataOption: input.insertDataOption ?? 'INSERT_ROWS',
      requestBody: { values: input.values },
      fields:
        'spreadsheetId,updates(spreadsheetId,updatedCells,updatedRows,updatedColumns,updatedRange)',
    })
  );

  getETagCache().invalidateSpreadsheet(input.spreadsheetId);

  const updates = response.data.updates;

  const responseData: Record<string, unknown> = {
    updatedCells: updates?.updatedCells ?? 0,
    updatedRows: updates?.updatedRows ?? 0,
    updatedColumns: updates?.updatedColumns ?? 0,
    updatedRange: updates?.updatedRange ?? range,
  };

  const analysisConfig = getBackgroundAnalysisConfig();
  const affectedCells = updates?.updatedCells ?? 0;
  if (analysisConfig.enabled && affectedCells >= analysisConfig.minCells) {
    const analyzer = getBackgroundAnalyzer();
    analyzer.analyzeInBackground(input.spreadsheetId, range, affectedCells, ha.api, {
      qualityThreshold: 70,
      minCellsChanged: analysisConfig.minCells,
      debounceMs: analysisConfig.debounceMs,
    });
  }

  // Record operation in session context for LLM follow-up references
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'append',
        spreadsheetId: input.spreadsheetId,
        range: (updates?.updatedRange as string) ?? range,
        description: `Appended ${updates?.updatedRows ?? input.values.length} row(s) to ${(updates?.updatedRange as string) ?? range}`,
        undoable: false,
        cellsAffected: updates?.updatedCells ?? 0,
      });
    }
  } catch {
    // Non-blocking: session context recording is best-effort
  }

  const warnings = buildPayloadWarnings(ha, 'append', payloadValidation);
  const meta = warnings
    ? {
        ...ha.generateMeta('append', input as Record<string, unknown>, responseData, {
          cellsAffected: updates?.updatedCells ?? undefined,
        }),
        warnings,
      }
    : undefined;

  return ha.makeSuccess('append', responseData, undefined, undefined, meta);
}

// ─── handleClear ─────────────────────────────────────────────────────────────

export async function handleClear(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'clear' }
): Promise<DataResponse> {
  // Request confirmation for destructive clear operations
  const { requestDestructiveConfirmation } = await import('./helpers.js');
  const confirmation = await requestDestructiveConfirmation(
    ha,
    'clear',
    `Clear all values in range${input.range ? ` ${input.range}` : ' (dataFilter)'}`,
    1000, // Assume large impact — clear is always destructive
    100
  );
  if (!confirmation.proceed) {
    return ha.makeSuccess('clear', {
      _cancelled: true,
      reason: confirmation.reason ?? 'User cancelled the clear operation',
    });
  }

  if (input.dataFilter) {
    if (!ha.featureFlags.enableDataFilterBatch) {
      ha.context.metrics?.recordFeatureFlagBlock({
        flag: 'dataFilterBatch',
        tool: ha.toolName,
        action: 'clear',
      });
      return ha.makeError({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message: 'DataFilter clears are disabled. Set ENABLE_DATAFILTER_BATCH=true.',
        retryable: false,
        suggestedFix: 'Enable the feature by setting the appropriate environment variable',
      });
    }

    if (input.safety?.dryRun) {
      return ha.makeSuccess(
        'clear',
        {
          clearedRanges: ['(dataFilter - dry run)'],
          _dryRun: true,
        },
        undefined,
        true
      );
    }

    const logger = ha.context.logger || getRequestLogger();
    const startTime = Date.now();
    logger.info('Clear operation starting (dataFilter)', {
      dataFilter: input.dataFilter,
      spreadsheetId: input.spreadsheetId,
    });

    try {
      const response = await Promise.race([
        ha.withCircuitBreaker('values.batchClearByDataFilter', () =>
          ha.api.spreadsheets.values.batchClearByDataFilter({
            spreadsheetId: input.spreadsheetId,
            fields: 'clearedRanges',
            requestBody: {
              dataFilters: [input.dataFilter!],
            },
          })
        ),
        new Promise<never>((_, reject) => {
          const timeoutMs = parseInt(process.env['GOOGLE_API_TIMEOUT_MS'] ?? '60000', 10);
          setTimeout(
            () => reject(new Error(`Clear operation timed out after ${timeoutMs / 1000} seconds`)),
            timeoutMs
          );
        }),
      ]);

      const duration = Date.now() - startTime;
      logger.info('Clear operation completed (dataFilter)', { duration });

      getETagCache().invalidateSpreadsheet(input.spreadsheetId);

      const clearedRanges = response.data.clearedRanges ?? [];
      if (clearedRanges.length === 0) {
        return ha.makeError({
          code: ErrorCodes.NOT_FOUND,
          message: 'No data matched the provided DataFilter for clear',
          retryable: false,
          suggestedFix:
            'Check that developer metadata exists for the given lookup criteria. Use sheets_advanced.set_metadata to tag ranges first.',
        });
      }

      const analysisConfig = getBackgroundAnalysisConfig();
      if (analysisConfig.enabled && clearedRanges.length > 0) {
        const analyzer = getBackgroundAnalyzer();
        analyzer.analyzeInBackground(input.spreadsheetId, clearedRanges[0]!, 100, ha.api, {
          qualityThreshold: 70,
          minCellsChanged: analysisConfig.minCells,
          debounceMs: analysisConfig.debounceMs,
        });
      }

      // Record operation in session context for LLM follow-up references
      try {
        if (ha.context.sessionContext) {
          ha.context.sessionContext.recordOperation({
            tool: 'sheets_data',
            action: 'clear',
            spreadsheetId: input.spreadsheetId,
            range: clearedRanges[0] ?? '(dataFilter)',
            description: `Cleared ${clearedRanges.length} range(s) via dataFilter`,
            undoable: false,
          });
        }
      } catch {
        // Non-blocking: session context recording is best-effort
      }

      return ha.makeSuccess('clear', {
        clearedRanges,
        updatedRange: clearedRanges[0] ?? '(dataFilter)',
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Clear operation failed (dataFilter)', {
        error: error instanceof Error ? error.message : String(error),
        duration,
        spreadsheetId: input.spreadsheetId,
      });

      const isTimeoutError =
        error instanceof Error &&
        (error.message.includes('timed out') ||
          (error as { code?: string }).code === 'DEADLINE_EXCEEDED');
      if (isTimeoutError) {
        return ha.makeError({
          code: ErrorCodes.DEADLINE_EXCEEDED,
          message: `Clear operation (dataFilter) timed out after ${duration}ms. Consider using a more specific filter.`,
          retryable: false,
          suggestedFix: 'Try using a more specific dataFilter or clearing by A1 range instead',
          details: {
            duration,
            workaround: 'Use A1 range-based clear if possible',
          },
        });
      }

      throw error;
    }
  }

  // Traditional range-based path
  if (!input.range) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Range is required for clear operation',
      retryable: false,
    });
  }
  const range = await resolveRangeToA1(ha, input.spreadsheetId, input.range);

  if (input.safety?.dryRun) {
    return ha.makeSuccess('clear', { updatedRange: range }, undefined, true);
  }

  const logger = ha.context.logger || getRequestLogger();
  const startTime = Date.now();
  logger.info('Clear operation starting', {
    range,
    spreadsheetId: input.spreadsheetId,
  });

  try {
    const timeoutMs = parseInt(process.env['GOOGLE_API_TIMEOUT_MS'] ?? '60000', 10);
    const gridRange = await a1ToGridRange(ha, input.spreadsheetId, range);
    await Promise.race([
      ha.withCircuitBreaker('values.clear', () =>
        ha.api.spreadsheets.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateCells: {
                  range: toGridRange(gridRange),
                  fields: 'userEnteredValue',
                },
              },
            ],
          },
        })
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Clear operation timed out after ${timeoutMs / 1000} seconds`)),
          timeoutMs
        )
      ),
    ]);

    const duration = Date.now() - startTime;
    logger.info('Clear operation completed', { duration, range });

    getETagCache().invalidateSpreadsheet(input.spreadsheetId);

    const analysisConfig = getBackgroundAnalysisConfig();
    if (analysisConfig.enabled) {
      const analyzer = getBackgroundAnalyzer();
      analyzer.analyzeInBackground(input.spreadsheetId, range, 100, ha.api, {
        qualityThreshold: 70,
        minCellsChanged: analysisConfig.minCells,
        debounceMs: analysisConfig.debounceMs,
      });
    }

    // Record operation in session context for LLM follow-up references
    try {
      if (ha.context.sessionContext) {
        ha.context.sessionContext.recordOperation({
          tool: 'sheets_data',
          action: 'clear',
          spreadsheetId: input.spreadsheetId,
          range,
          description: `Cleared range ${range}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return ha.makeSuccess('clear', {
      updatedRange: range,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Clear operation failed', {
      error: error instanceof Error ? error.message : String(error),
      range,
      duration,
      spreadsheetId: input.spreadsheetId,
    });

    const isTimeoutError =
      error instanceof Error &&
      (error.message.includes('timed out') ||
        (error as { code?: string }).code === 'DEADLINE_EXCEEDED');
    if (isTimeoutError) {
      return ha.makeError({
        code: ErrorCodes.DEADLINE_EXCEEDED,
        message: `Clear operation timed out after ${duration}ms.`,
        retryable: false,
        suggestedFix:
          `Workaround: Use sheets_data.write with empty values instead:\n` +
          `{"action":"write","spreadsheetId":"${input.spreadsheetId}","range":"${range}","values":[[]]}`,
        details: {
          range,
          duration,
          workaround: 'Use write action with empty values array',
        },
      });
    }

    throw error;
  }
}
