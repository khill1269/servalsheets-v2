/**
 * Batch read / write / clear and find-replace handlers for sheets_data.
 */

import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { DataResponse, SheetsDataInput } from '../../schemas/data.js';
import type { ValuesArray, RangeInput } from '../../schemas/index.js';
import { getEnv } from '../../config/env.js';
import { getETagCache } from '../../services/etag-cache.js';
import { sendProgress } from '../../utils/request-context.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { withSamplingTimeout, assertSamplingConsent } from '../../mcp/sampling.js';
import { validateSamplingOutput } from '../../services/sampling-validator.js';
import { toGridRange } from '../../utils/google-sheets-helpers.js';
import type { DataHandlerAccess, ResponseFormat, MAX_BATCH_RANGES as _MAX } from './internal.js';
import { MAX_BATCH_RANGES } from './internal.js';
import {
  resolveRangeToA1,
  applyBatchReadResponseFormat,
  buildResponseFormatMeta,
  buildMultiRangePaginationPlan,
  buildPayloadWarnings,
  payloadTooLargeError,
  validateValuesBatchPayloadIfEnabled,
  a1ToGridRange,
  checkFormulaInjection,
} from './helpers.js';

type DataRequest = SheetsDataInput['request'];

// ─── handleBatchRead ──────────────────────────────────────────────────────────

export async function handleBatchRead(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'batch_read' }
): Promise<DataResponse> {
  const responseFormat = (input.response_format ?? 'full') as ResponseFormat;
  const wantsPagination = Boolean(input.cursor || input.pageSize);

  if (wantsPagination) {
    if (input.dataFilters && input.dataFilters.length > 0) {
      return ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Pagination is not supported with dataFilters in batch_read',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }
    if (!input.ranges || input.ranges.length === 0) {
      return ha.makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Pagination in batch_read requires at least one range',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }

    const paginationPlan = await buildMultiRangePaginationPlan(ha, {
      spreadsheetId: input.spreadsheetId,
      ranges: input.ranges,
      cursor: input.cursor,
      pageSize: input.pageSize,
    });

    if ('error' in paginationPlan) {
      return paginationPlan.error;
    }

    const valueRanges: Array<{ range: string; values: ValuesArray }> = [];

    for (let i = 0; i < paginationPlan.rangesToFetch.length; i++) {
      const range = paginationPlan.rangesToFetch[i]!;

      await ha.sendProgress(
        i + 1,
        paginationPlan.totalRanges,
        `Reading range ${i + 1}/${paginationPlan.rangesToFetch.length} in current page`
      );

      const resolvedRange = await resolveRangeToA1(ha, input.spreadsheetId, range);
      const dedupKey = `values:get:${input.spreadsheetId}:${resolvedRange}:${input.valueRenderOption ?? 'FORMATTED_VALUE'}:${input.majorDimension ?? 'ROWS'}`;

      const response = await ha.deduplicatedApiCall(dedupKey, () =>
        ha.api.spreadsheets.values.get({
          spreadsheetId: input.spreadsheetId,
          range: resolvedRange,
          valueRenderOption: input.valueRenderOption,
          majorDimension: input.majorDimension,
          dateTimeRenderOption:
            ((input as Record<string, unknown>)['dateTimeRenderOption'] as string) ??
            (input.valueRenderOption === 'UNFORMATTED_VALUE' ? 'SERIAL_NUMBER' : undefined),
          fields: 'range,majorDimension,values',
        })
      );

      valueRanges.push({
        range: response.data.range ?? resolvedRange,
        values: (response.data.values ?? []) as ValuesArray,
      });
    }

    const responseData: Record<string, unknown> = {
      valueRanges,
      nextCursor: paginationPlan.nextCursor,
      hasMore: paginationPlan.hasMore,
      totalRanges: paginationPlan.totalRanges,
      currentPage: {
        rangeIndices: paginationPlan.rangeIndices,
        rangeCount: paginationPlan.rangesToFetch.length,
      },
    };

    if (paginationPlan.hasMore && paginationPlan.nextCursor) {
      responseData['_paginationHint'] =
        `Showing ${paginationPlan.rangesToFetch.length} of ${paginationPlan.totalRanges} ranges. ` +
        `To fetch next page, repeat this call with cursor:"${paginationPlan.nextCursor}"`;
    }

    const formattedResponse = applyBatchReadResponseFormat(responseData, responseFormat);
    return ha.makeSuccess(
      'batch_read',
      formattedResponse,
      undefined,
      undefined,
      buildResponseFormatMeta(ha, 'batch_read', formattedResponse)
    );
  }

  if (input.dataFilters && input.dataFilters.length > 0) {
    if (!ha.featureFlags.enableDataFilterBatch) {
      ha.context.metrics?.recordFeatureFlagBlock({
        flag: 'dataFilterBatch',
        tool: ha.toolName,
        action: 'batch_read',
      });
      return ha.makeError({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message: 'DataFilter batch reads are disabled. Set ENABLE_DATAFILTER_BATCH=true.',
        retryable: false,
        suggestedFix:
          'Enable the feature by setting the appropriate environment variable, or contact your administrator',
      });
    }

    const response = await ha.api.spreadsheets.values.batchGetByDataFilter({
      spreadsheetId: input.spreadsheetId,
      fields: 'valueRanges(valueRange(range,values))',
      requestBody: {
        dataFilters: input.dataFilters,
        valueRenderOption: input.valueRenderOption,
        majorDimension: input.majorDimension,
      },
    });

    const formattedResponse = applyBatchReadResponseFormat(
      {
        valueRanges: (response.data.valueRanges ?? []).map(
          (mvr: sheets_v4.Schema$MatchedValueRange) => ({
            range: mvr.valueRange?.range ?? '',
            values: (mvr.valueRange?.values ?? []) as ValuesArray,
          })
        ),
      },
      responseFormat
    );
    return ha.makeSuccess(
      'batch_read',
      formattedResponse,
      undefined,
      undefined,
      buildResponseFormatMeta(ha, 'batch_read', formattedResponse)
    );
  }

  const ranges = await Promise.all(
    (input.ranges ?? []).map((r: RangeInput) => resolveRangeToA1(ha, input.spreadsheetId, r))
  );

  if (ha.context.sessionContext) {
    for (const range of ranges) {
      ha.context.sessionContext.trackReadOperation(input.spreadsheetId, range);
    }
  }

  const { mergeOverlappingRanges, splitMergedResponse, calculateReductionPercentage } =
    await import('../../utils/range-merger.js');
  const mergeResult = mergeOverlappingRanges(ranges);

  if (mergeResult.apiCallReduction > 0) {
    const reductionPercentage = calculateReductionPercentage(mergeResult);
    ha.context.logger?.info('Range merging optimization applied', {
      originalRanges: mergeResult.originalCount,
      mergedRanges: mergeResult.mergedCount,
      apiCallsSaved: mergeResult.apiCallReduction,
      reductionPercentage: `${reductionPercentage.toFixed(1)}%`,
    });

    const { recordRangeMerging } = await import('../../observability/metrics.js');
    recordRangeMerging('batch_read', mergeResult.apiCallReduction, reductionPercentage);
  }

  if (ranges.length > MAX_BATCH_RANGES) {
    const logger = ha.context.logger;
    const chunks: string[][] = [];
    for (let i = 0; i < ranges.length; i += MAX_BATCH_RANGES) {
      chunks.push(ranges.slice(i, i + MAX_BATCH_RANGES));
    }

    logger?.info(`Auto-chunking ${ranges.length} ranges into ${chunks.length} batches`, {
      totalRanges: ranges.length,
      maxPerBatch: MAX_BATCH_RANGES,
      chunkCount: chunks.length,
    });

    const allValueRanges: Array<{ range: string; values: ValuesArray }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      logger?.info(`Processing chunk ${i + 1}/${chunks.length}`, {
        chunkSize: chunk.length,
      });

      const response = await ha.api.spreadsheets.values.batchGet({
        spreadsheetId: input.spreadsheetId,
        ranges: chunk,
        valueRenderOption: input.valueRenderOption,
        majorDimension: input.majorDimension,
        dateTimeRenderOption:
          ((input as Record<string, unknown>)['dateTimeRenderOption'] as string) ??
          (input.valueRenderOption === 'UNFORMATTED_VALUE' ? 'SERIAL_NUMBER' : undefined),
        fields: 'valueRanges(range,values)',
      });

      const chunkValueRanges = (response.data.valueRanges ?? []).map(
        (vr: sheets_v4.Schema$ValueRange) => ({
          range: vr.range ?? '',
          values: (vr.values ?? []) as ValuesArray,
        })
      );

      allValueRanges.push(...chunkValueRanges);
    }

    logger?.info(`Batch chunking complete`, {
      totalRanges: ranges.length,
      chunksProcessed: chunks.length,
      rangesRetrieved: allValueRanges.length,
    });

    const formattedResponse = applyBatchReadResponseFormat(
      {
        valueRanges: allValueRanges,
        _chunked: true,
        _chunkCount: chunks.length,
      },
      responseFormat
    );
    return ha.makeSuccess(
      'batch_read',
      formattedResponse,
      undefined,
      undefined,
      buildResponseFormatMeta(ha, 'batch_read', formattedResponse)
    );
  }

  const cachedApi = ha.context.cachedSheetsApi;
  if (cachedApi) {
    try {
      const cachedResult = await cachedApi.batchGetValues(input.spreadsheetId, ranges, {
        valueRenderOption: input.valueRenderOption,
        majorDimension: input.majorDimension,
      });

      if (cachedResult && cachedResult.valueRanges) {
        const formattedResponse = applyBatchReadResponseFormat(
          {
            valueRanges: cachedResult.valueRanges.map((vr: sheets_v4.Schema$ValueRange) => ({
              range: vr.range ?? '',
              values: (vr.values ?? []) as ValuesArray,
            })),
            _cached: true,
          },
          responseFormat
        );
        return ha.makeSuccess(
          'batch_read',
          formattedResponse,
          undefined,
          undefined,
          buildResponseFormatMeta(ha, 'batch_read', formattedResponse)
        );
      }
    } catch (_cacheError) {
      // Fall through to direct API call on cache error
    }
  }

  const env = getEnv();
  const useParallel =
    ha.context.parallelExecutor &&
    env.ENABLE_PARALLEL_EXECUTOR &&
    ranges.length > env.PARALLEL_EXECUTOR_THRESHOLD;

  let valueRanges: sheets_v4.Schema$ValueRange[];

  if (useParallel) {
    const tasks = mergeResult.mergedRanges.map((merged, i) => ({
      id: `batch-read-merged-${i}`,
      fn: async () => {
        const dedupKey = `values:get:${input.spreadsheetId}:${merged.mergedRange}:${input.valueRenderOption ?? 'FORMATTED_VALUE'}:${input.majorDimension ?? 'ROWS'}`;
        const res = await ha.deduplicatedApiCall(dedupKey, () =>
          ha.api.spreadsheets.values.get({
            spreadsheetId: input.spreadsheetId,
            range: merged.mergedRange,
            valueRenderOption: input.valueRenderOption,
            majorDimension: (input as DataRequest & { majorDimension?: string }).majorDimension,
            dateTimeRenderOption:
              ((input as Record<string, unknown>)['dateTimeRenderOption'] as string) ??
              (input.valueRenderOption === 'UNFORMATTED_VALUE' ? 'SERIAL_NUMBER' : undefined),
            fields: 'range,values',
          })
        );
        return { mergedData: res.data, merged };
      },
      priority: 1,
    }));

    const onProgress = env.ENABLE_GRANULAR_PROGRESS
      ? async (progress: { completed: number; total: number }) => {
          await sendProgress(
            progress.completed,
            progress.total,
            `Reading ${progress.completed}/${mergeResult.mergedCount} merged ranges`
          );
        }
      : undefined;

    const results = await ha.context.parallelExecutor!.executeAllSuccessful(tasks, onProgress);

    valueRanges = new Array(ranges.length);
    for (const result of results) {
      const { mergedData, merged } = result as {
        mergedData: sheets_v4.Schema$ValueRange;
        merged: { rangeInfo: unknown; originalIndices: number[] };
      };
      const mergedValues = (mergedData.values || []) as unknown[][];

      for (const originalIndex of merged.originalIndices) {
        const originalRange = ranges[originalIndex]!;
        const { parseA1Range } = await import('../../services/request-merger.js');
        const targetRangeInfo = parseA1Range(originalRange);

        const splitValues = splitMergedResponse(
          mergedValues,
          merged.rangeInfo as Parameters<typeof splitMergedResponse>[1],
          targetRangeInfo
        );

        valueRanges[originalIndex] = {
          range: originalRange,
          values: splitValues,
          majorDimension: mergedData.majorDimension,
        };
      }
    }
  } else {
    const mergedRangeStrings = mergeResult.mergedRanges.map((m) => m.mergedRange);
    const response = await ha.api.spreadsheets.values.batchGet({
      spreadsheetId: input.spreadsheetId,
      ranges: mergedRangeStrings,
      valueRenderOption: input.valueRenderOption,
      majorDimension: input.majorDimension,
      dateTimeRenderOption:
        ((input as Record<string, unknown>)['dateTimeRenderOption'] as string) ??
        (input.valueRenderOption === 'UNFORMATTED_VALUE' ? 'SERIAL_NUMBER' : undefined),
      fields: 'valueRanges(range,values)',
    });
    const mergedResults = response.data.valueRanges ?? [];

    valueRanges = new Array(ranges.length);
    for (let i = 0; i < mergeResult.mergedRanges.length; i++) {
      const merged = mergeResult.mergedRanges[i]!;
      const mergedData = mergedResults[i];
      if (!mergedData) continue;

      const mergedValues = (mergedData.values || []) as unknown[][];

      for (const originalIndex of merged.originalIndices) {
        const originalRange = ranges[originalIndex]!;
        const { parseA1Range } = await import('../../services/request-merger.js');
        const targetRangeInfo = parseA1Range(originalRange);

        const splitValues = splitMergedResponse(mergedValues, merged.rangeInfo, targetRangeInfo);

        valueRanges[originalIndex] = {
          range: originalRange,
          values: splitValues,
          majorDimension: mergedData.majorDimension,
        };
      }
    }
  }

  for (const range of ranges) {
    ha.recordAccessAndPrefetch({
      spreadsheetId: input.spreadsheetId,
      range,
      action: 'read',
    });
  }

  const formattedResponse = applyBatchReadResponseFormat(
    {
      valueRanges: valueRanges.map((vr: sheets_v4.Schema$ValueRange) => ({
        range: vr.range ?? '',
        values: (vr.values ?? []) as ValuesArray,
      })),
    },
    responseFormat
  );
  return ha.makeSuccess(
    'batch_read',
    formattedResponse,
    undefined,
    undefined,
    buildResponseFormatMeta(ha, 'batch_read', formattedResponse)
  );
}

// ─── handleBatchWrite ─────────────────────────────────────────────────────────

export async function handleBatchWrite(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'batch_write' }
): Promise<DataResponse> {
  const payloadValidation = validateValuesBatchPayloadIfEnabled(ha, input.data);
  if (!payloadValidation.withinLimits) {
    return payloadTooLargeError(ha, 'batch_write', payloadValidation);
  }

  const totalCells = input.data.reduce(
    (sum: number, d: { values: ValuesArray }) =>
      sum + d.values.reduce((s: number, row: unknown[]) => s + row.length, 0),
    0
  );

  if (totalCells > 1000 && ha.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'batch_write',
      `Batch write will overwrite ${totalCells} cells across ${input.data.length} ranges in spreadsheet ${input.spreadsheetId}. This action cannot be undone without a snapshot.`
    );
    if (!confirmation.confirmed) {
      return ha.makeError({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  const hasDataFilters = input.data.some((d) => (d as { dataFilter?: unknown }).dataFilter);
  const hasRanges = input.data.some((d) => (d as { range?: unknown }).range);

  if (hasDataFilters && !ha.featureFlags.enableDataFilterBatch) {
    ha.context.metrics?.recordFeatureFlagBlock({
      flag: 'dataFilterBatch',
      tool: ha.toolName,
      action: 'batch_write',
    });
    return ha.makeError({
      code: ErrorCodes.FEATURE_UNAVAILABLE,
      message: 'DataFilter batch writes are disabled. Set ENABLE_DATAFILTER_BATCH=true.',
      retryable: false,
      suggestedFix:
        'Enable the feature by setting the appropriate environment variable, or contact your administrator',
    });
  }

  if (hasDataFilters && !hasRanges) {
    const data = input.data.map((d) => ({
      dataFilter: (d as { dataFilter: sheets_v4.Schema$DataFilter }).dataFilter,
      values: d.values as ValuesArray,
      majorDimension: (d as { majorDimension?: string }).majorDimension,
    }));

    if (input.safety?.dryRun) {
      const warnings = buildPayloadWarnings(ha, 'batch_write', payloadValidation);
      const meta = warnings
        ? {
            ...ha.generateMeta('batch_write', input as Record<string, unknown>, {
              updatedCells: totalCells,
            }),
            warnings,
          }
        : undefined;

      return ha.makeSuccess('batch_write', { updatedCells: totalCells }, undefined, true, meta);
    }

    const response = await ha.api.spreadsheets.values.batchUpdateByDataFilter({
      spreadsheetId: input.spreadsheetId,
      fields: 'totalUpdatedCells,totalUpdatedRows,totalUpdatedColumns',
      requestBody: {
        valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
        includeValuesInResponse: input.includeValuesInResponse ?? false,
        data,
      },
    });

    getETagCache().invalidateSpreadsheet(input.spreadsheetId);

    const responseData: Record<string, unknown> = {
      updatedCells: response.data.totalUpdatedCells ?? 0,
      updatedRows: response.data.totalUpdatedRows ?? 0,
      updatedColumns: response.data.totalUpdatedColumns ?? 0,
    };

    const warnings = buildPayloadWarnings(ha, 'batch_write', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('batch_write', input as Record<string, unknown>, responseData, {
            cellsAffected: response.data.totalUpdatedCells ?? undefined,
          }),
          warnings,
        }
      : undefined;

    return ha.makeSuccess('batch_write', responseData, undefined, undefined, meta);
  }

  if (hasDataFilters && hasRanges) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Do not mix range-based and dataFilter-based entries in batch_write',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const rangeEntries = input.data as Array<{ range?: RangeInput; values: ValuesArray }>;
  if (rangeEntries.some((entry) => !entry.range)) {
    return ha.makeError({
      code: ErrorCodes.INVALID_PARAMS,
      message: 'Missing range for batch_write entry',
      retryable: false,
      suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
    });
  }

  const data = await Promise.all(
    rangeEntries.map(async (d) => ({
      range: await resolveRangeToA1(ha, input.spreadsheetId, d.range!),
      values: d.values,
    }))
  );

  if (data.length > MAX_BATCH_RANGES) {
    const logger = ha.context.logger;
    const chunks: Array<typeof data> = [];
    for (let i = 0; i < data.length; i += MAX_BATCH_RANGES) {
      chunks.push(data.slice(i, i + MAX_BATCH_RANGES));
    }

    logger?.info(`Auto-chunking ${data.length} write ranges into ${chunks.length} batches`, {
      totalRanges: data.length,
      maxPerBatch: MAX_BATCH_RANGES,
      chunkCount: chunks.length,
    });

    if (input.safety?.dryRun) {
      const warnings = buildPayloadWarnings(ha, 'batch_write', payloadValidation);
      const meta = warnings
        ? {
            ...ha.generateMeta('batch_write', input as Record<string, unknown>, {
              updatedCells: totalCells,
            }),
            warnings,
          }
        : undefined;

      return ha.makeSuccess('batch_write', { updatedCells: totalCells }, undefined, true, meta);
    }

    let totalUpdatedCells = 0;
    let totalUpdatedRows = 0;
    let totalUpdatedColumns = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      logger?.info(`Processing write chunk ${i + 1}/${chunks.length}`, {
        chunkSize: chunk.length,
      });
      await ha.sendProgress(
        i + 1,
        chunks.length,
        `Writing chunk ${i + 1}/${chunks.length} (${chunk.length} ranges)`
      );

      const response = await ha.withCircuitBreaker('values.batchUpdate', () =>
        ha.api.spreadsheets.values.batchUpdate({
          spreadsheetId: input.spreadsheetId,
          fields: 'totalUpdatedCells,totalUpdatedRows,totalUpdatedColumns',
          requestBody: {
            valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
            includeValuesInResponse: input.includeValuesInResponse ?? false,
            data: chunk,
          },
        })
      );

      totalUpdatedCells += response.data.totalUpdatedCells ?? 0;
      totalUpdatedRows += response.data.totalUpdatedRows ?? 0;
      totalUpdatedColumns += response.data.totalUpdatedColumns ?? 0;
    }

    getETagCache().invalidateSpreadsheet(input.spreadsheetId);

    logger?.info(`Batch write chunking complete`, {
      totalRanges: data.length,
      chunksProcessed: chunks.length,
      totalUpdatedCells,
    });

    const responseData: Record<string, unknown> = {
      updatedCells: totalUpdatedCells,
      updatedRows: totalUpdatedRows,
      updatedColumns: totalUpdatedColumns,
      _chunked: true,
      _chunkCount: chunks.length,
    };

    const warnings = buildPayloadWarnings(ha, 'batch_write', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('batch_write', input as Record<string, unknown>, responseData, {
            cellsAffected: totalUpdatedCells,
          }),
          warnings,
        }
      : undefined;

    try {
      if (ha.context.sessionContext) {
        ha.context.sessionContext.recordOperation({
          tool: 'sheets_data',
          action: 'batch_write',
          spreadsheetId: input.spreadsheetId,
          description: `Batch write to ${input.data.length} range(s), ${totalUpdatedCells} cells`,
          undoable: false,
        });
      }
    } catch {
      /* non-blocking */
    }

    return ha.makeSuccess('batch_write', responseData, undefined, undefined, meta);
  }

  if (input.safety?.dryRun) {
    const warnings = buildPayloadWarnings(ha, 'batch_write', payloadValidation);
    const meta = warnings
      ? {
          ...ha.generateMeta('batch_write', input as Record<string, unknown>, {
            updatedCells: totalCells,
          }),
          warnings,
        }
      : undefined;

    return ha.makeSuccess('batch_write', { updatedCells: totalCells }, undefined, true, meta);
  }

  const includeValues = input.includeValuesInResponse ?? false;
  const response = await ha.withCircuitBreaker('values.batchUpdate', () =>
    ha.api.spreadsheets.values.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      fields: includeValues
        ? 'totalUpdatedCells,totalUpdatedRows,totalUpdatedColumns,responses(updatedData)'
        : 'totalUpdatedCells,totalUpdatedRows,totalUpdatedColumns',
      requestBody: {
        valueInputOption: input.valueInputOption ?? 'USER_ENTERED',
        includeValuesInResponse: includeValues,
        data,
      },
    })
  );

  getETagCache().invalidateSpreadsheet(input.spreadsheetId);

  const responseData: Record<string, unknown> = {
    updatedCells: response.data.totalUpdatedCells ?? 0,
    updatedRows: response.data.totalUpdatedRows ?? 0,
    updatedColumns: response.data.totalUpdatedColumns ?? 0,
  };

  if (includeValues && response.data.responses) {
    responseData['updatedData'] = response.data.responses
      .map((r) => r.updatedData?.values)
      .filter(Boolean);
  }

  const warnings = buildPayloadWarnings(ha, 'batch_write', payloadValidation);
  const meta = warnings
    ? {
        ...ha.generateMeta('batch_write', input as Record<string, unknown>, responseData, {
          cellsAffected: response.data.totalUpdatedCells ?? undefined,
        }),
        warnings,
      }
    : undefined;

  try {
    if (ha.context.sessionContext) {
      const cellsWritten = response.data.totalUpdatedCells ?? 0;
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'batch_write',
        spreadsheetId: input.spreadsheetId,
        description: `Batch write to ${data.length} range(s), ${cellsWritten} cells`,
        undoable: false,
      });
    }
  } catch {
    /* non-blocking */
  }

  return ha.makeSuccess('batch_write', responseData, undefined, undefined, meta);
}

// ─── handleBatchClear ─────────────────────────────────────────────────────────

export async function handleBatchClear(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'batch_clear' }
): Promise<DataResponse> {
  if (ha.context.elicitationServer) {
    const rangeCount = Array.isArray(input.ranges) ? input.ranges.length : 0;
    const confirmation = await confirmDestructiveAction(
      ha.context.elicitationServer,
      'batch_clear',
      `Clear ${rangeCount} range(s) in spreadsheet ${input.spreadsheetId}. All cell values in the specified ranges will be permanently erased. This action cannot be undone.`
    );
    if (!confirmation.confirmed) {
      return ha.makeError({
        code: ErrorCodes.OPERATION_CANCELLED,
        message: confirmation.reason ?? 'Operation cancelled by user',
        retryable: false,
      });
    }
  } else {
    ha.context.metrics?.recordConfirmationSkip({
      action: 'sheets_data.batch_clear',
      reason: 'elicitation_disabled',
      timestamp: Date.now(),
      spreadsheetId: input.spreadsheetId,
      destructive: true,
    });
  }

  if (input.dataFilters && input.dataFilters.length > 0) {
    if (!ha.featureFlags.enableDataFilterBatch) {
      ha.context.metrics?.recordFeatureFlagBlock({
        flag: 'dataFilterBatch',
        tool: ha.toolName,
        action: 'batch_clear',
      });
      return ha.makeError({
        code: ErrorCodes.FEATURE_UNAVAILABLE,
        message: 'DataFilter batch clears are disabled. Set ENABLE_DATAFILTER_BATCH=true.',
        retryable: false,
        suggestedFix:
          'Enable the feature by setting the appropriate environment variable, or contact your administrator',
      });
    }

    if (input.safety?.dryRun) {
      return ha.makeSuccess(
        'batch_clear',
        {
          clearedRanges: [],
        },
        undefined,
        true
      );
    }

    const response = await ha.api.spreadsheets.values.batchClearByDataFilter({
      spreadsheetId: input.spreadsheetId,
      fields: 'clearedRanges',
      requestBody: { dataFilters: input.dataFilters },
    });

    getETagCache().invalidateSpreadsheet(input.spreadsheetId);

    return ha.makeSuccess('batch_clear', {
      clearedRanges: response.data.clearedRanges ?? [],
    });
  }

  const ranges = await Promise.all(
    (input.ranges ?? []).map((range: RangeInput) =>
      resolveRangeToA1(ha, input.spreadsheetId, range)
    )
  );

  if (input.safety?.dryRun) {
    return ha.makeSuccess(
      'batch_clear',
      {
        clearedCells: 0,
        updatedRange: ranges.join(','),
      },
      undefined,
      true
    );
  }

  await ha.sendProgress(0, 1, `Clearing ${ranges.length} range(s)`);
  const response = await ha.withCircuitBreaker('values.batchClear', () =>
    ha.api.spreadsheets.values.batchClear({
      spreadsheetId: input.spreadsheetId,
      fields: 'clearedRanges',
      requestBody: { ranges },
    })
  );

  getETagCache().invalidateSpreadsheet(input.spreadsheetId);

  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'batch_clear',
        spreadsheetId: input.spreadsheetId,
        description: `Batch cleared ${ranges.length} range(s)`,
        undoable: false,
      });
    }
  } catch {
    /* non-blocking */
  }

  return ha.makeSuccess('batch_clear', {
    clearedRanges: response.data.clearedRanges ?? ranges,
  });
}

// ─── handleFindReplace ────────────────────────────────────────────────────────

export async function handleFindReplace(
  ha: DataHandlerAccess,
  input: DataRequest & { action: 'find_replace' }
): Promise<DataResponse> {
  let resolvedInput = input;

  if (
    resolvedInput.find &&
    (resolvedInput.replacement === undefined || resolvedInput.replacement === null) &&
    ha.context?.server?.elicitInput
  ) {
    try {
      const wizard = await ha.context.server.elicitInput({
        message: `Search term "${resolvedInput.find}" found. What should replacements be?`,
        requestedSchema: {
          type: 'object',
          properties: {
            replacement: {
              type: 'string',
              title: 'Replacement text',
              description: 'Text to replace matches with (leave empty for delete)',
            },
          },
        },
      });
      const wizardContent = wizard?.content as Record<string, unknown> | undefined;
      if (wizard?.action === 'accept' && wizardContent?.['replacement'] !== undefined) {
        resolvedInput = {
          ...resolvedInput,
          replacement: String(wizardContent['replacement']),
        };
      }
    } catch {
      // Elicitation not available — continue without replacement (find-only mode)
    }
  }

  const resolvedRange = resolvedInput.range
    ? await resolveRangeToA1(ha, resolvedInput.spreadsheetId, resolvedInput.range)
    : undefined;

  if (resolvedInput.replacement === undefined || resolvedInput.replacement === null) {
    const searchRange = resolvedRange ?? 'A1:ZZ10000';
    const renderOption = input.includeFormulas ? 'FORMULA' : 'FORMATTED_VALUE';
    const dedupKey = `values:get:${input.spreadsheetId}:${searchRange}:${renderOption}:ROWS`;
    const response = await ha.deduplicatedApiCall(dedupKey, () =>
      ha.api.spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range: searchRange,
        valueRenderOption: renderOption,
        fields: 'range,values',
      })
    );

    const values = response.data.values ?? [];
    const matches: Array<{
      cell: string;
      value: string;
      row: number;
      column: number;
    }> = [];
    const query = resolvedInput.matchCase ? resolvedInput.find : resolvedInput.find.toLowerCase();
    const limit = input.limit ?? 100;

    for (let row = 0; row < values.length && matches.length < limit; row++) {
      const rowData = values[row];
      if (!rowData) continue;

      for (let col = 0; col < rowData.length && matches.length < limit; col++) {
        const cellValue = String(rowData[col] ?? '');
        const compareValue = resolvedInput.matchCase ? cellValue : cellValue.toLowerCase();

        const isMatch = resolvedInput.matchEntireCell
          ? compareValue === query
          : compareValue.includes(query);

        if (isMatch) {
          matches.push({
            cell: `${ha.columnToLetter(col)}${row + 1}`,
            value: cellValue,
            row: row + 1,
            column: col + 1,
          });
        }
      }
    }

    return ha.makeSuccess('find_replace', { matches, mode: 'find' });
  }

  // REPLACE MODE
  if (resolvedInput.safety?.dryRun) {
    let aiEstimate: { matchCount: number; confidence: string } | undefined;
    if (ha.context.samplingServer) {
      try {
        await assertSamplingConsent();
        const samplingResult = await withSamplingTimeout(() =>
          ha.context.samplingServer!.createMessage({
            messages: [
              {
                role: 'user' as const,
                content: {
                  type: 'text' as const,
                  text: `Estimate how many cells in the spreadsheet '${resolvedInput.spreadsheetId}' would match the search term "${resolvedInput.find}". Reply with JSON: {"matchCount": <number>, "confidence": "low"|"medium"|"high"}`,
                },
              },
            ],
            maxTokens: 128,
          })
        );
        const text = Array.isArray(samplingResult.content)
          ? ((samplingResult.content.find((c) => c.type === 'text') as { text: string } | undefined)
              ?.text ?? '')
          : ((samplingResult.content as { text?: string }).text ?? '');
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const validated = validateSamplingOutput('find_replace_estimate', jsonMatch[0]);
          if (validated !== null) {
            aiEstimate = {
              matchCount: validated.estimatedReplacements,
              confidence: String(validated.confidence ?? 'low'),
            };
          } else {
            const numMatch = text.match(/\d+/);
            aiEstimate = {
              matchCount: numMatch ? parseInt(numMatch[0], 10) : 0,
              confidence: 'low',
            };
          }
        } else {
          const numMatch = text.match(/\d+/);
          aiEstimate = {
            matchCount: numMatch ? parseInt(numMatch[0], 10) : 0,
            confidence: 'low',
          };
        }
      } catch {
        // Non-blocking
      }
    }

    return ha.makeSuccess(
      'find_replace',
      {
        replacementsCount: 0,
        mode: 'replace',
        ...(aiEstimate !== undefined ? { aiEstimate } : {}),
      },
      undefined,
      true
    );
  }

  // SECURITY: Check replacement value for formula injection (IMPORTXML, IMPORTRANGE, etc.)
  // Same check used in write/append — see checkFormulaInjection in helpers.ts:173
  if (resolvedInput.replacement && resolvedInput.safety?.sanitizeFormulas !== false) {
    const injected = checkFormulaInjection([[resolvedInput.replacement]]);
    if (injected) {
      return ha.makeError({
        code: ErrorCodes.FORMULA_INJECTION_BLOCKED,
        message: `Replacement value contains dangerous formula: ${injected}. Set safety.sanitizeFormulas=false to allow.`,
        retryable: false,
        suggestedFix:
          'Remove the dangerous formula from the replacement value, or set safety.sanitizeFormulas=false if this is intentional',
      });
    }
  }

  // Request confirmation for destructive find-replace operations
  const { requestDestructiveConfirmation } = await import('./helpers.js');
  const frConfirmation = await requestDestructiveConfirmation(
    ha,
    'find_replace',
    `Replace "${resolvedInput.find}" with "${resolvedInput.replacement}" across ${resolvedRange ?? 'all sheets'}`,
    1000, // find_replace can affect many cells
    100
  );
  if (!frConfirmation.proceed) {
    return ha.makeSuccess('find_replace', {
      _cancelled: true,
      reason: frConfirmation.reason ?? 'User cancelled the find/replace operation',
    });
  }

  const findReplaceRequest: sheets_v4.Schema$FindReplaceRequest = {
    find: resolvedInput.find,
    replacement: resolvedInput.replacement,
    matchCase: resolvedInput.matchCase,
    matchEntireCell: resolvedInput.matchEntireCell,
    searchByRegex: resolvedInput.searchByRegex,
    includeFormulas: resolvedInput.includeFormulas,
  };

  if (resolvedRange) {
    const gridRange = await a1ToGridRange(ha, resolvedInput.spreadsheetId, resolvedRange);
    findReplaceRequest.range = toGridRange(gridRange);
  } else {
    findReplaceRequest.allSheets = true;
  }

  let aiImpactPrediction: string | undefined;
  if (ha.context.samplingServer) {
    try {
      await assertSamplingConsent();
      const predictionResult = await withSamplingTimeout(() =>
        ha.context.samplingServer!.createMessage({
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `Predict the impact of this find-and-replace operation:\n- Find: "${resolvedInput.find}"\n- Replace with: "${resolvedInput.replacement}"\n- Match case: ${resolvedInput.matchCase}\n- Entire cell: ${resolvedInput.matchEntireCell}\n- Search by regex: ${resolvedInput.searchByRegex}\n\nWhat could go wrong? Identify risks (e.g., partial matches breaking formulas, unintended replacements).`,
              },
            },
          ],
          maxTokens: 256,
        })
      );
      const text = Array.isArray(predictionResult.content)
        ? ((predictionResult.content.find((c) => c.type === 'text') as { text: string } | undefined)
            ?.text ?? '')
        : ((predictionResult.content as { text?: string }).text ?? '');
      aiImpactPrediction = text.trim();
    } catch {
      // Non-blocking
    }
  }

  const response = await ha.withCircuitBreaker('batchUpdate.findReplace', () =>
    ha.api.spreadsheets.batchUpdate({
      spreadsheetId: resolvedInput.spreadsheetId,
      requestBody: {
        requests: [
          {
            findReplace: findReplaceRequest,
          },
        ],
      },
    })
  );

  const reply = response.data?.replies?.[0]?.findReplace;
  const replacementsCount = reply?.occurrencesChanged ?? 0;

  return ha.makeSuccess('find_replace', {
    replacementsCount,
    mode: 'replace',
    ...(aiImpactPrediction !== undefined ? { aiImpactPrediction } : {}),
  });
}
