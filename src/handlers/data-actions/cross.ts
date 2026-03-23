/**
 * Cross-spreadsheet federation action handlers for sheets_data (F2).
 */

import type { DataResponse, SheetsDataInput } from '../../schemas/data.js';
import type { ValuesArray } from '../../schemas/index.js';
import { generateAIInsight } from '../../mcp/sampling.js';
import { recordCrossSpreadsheetOp } from '../../observability/metrics.js';
import type { DataHandlerAccess, ResponseFormat } from './internal.js';
import {
  shapeValuesByResponseFormat,
  shapeListByResponseFormat,
  buildResponseFormatMeta,
} from './helpers.js';
import { extractRangeA1 } from '../../utils/range-helpers.js';

type DataRequest = SheetsDataInput['request'];

// ─── handleCrossRead ──────────────────────────────────────────────────────────

export async function handleCrossRead(
  ha: DataHandlerAccess,
  req: DataRequest & { action: 'cross_read' }
): Promise<DataResponse> {
  const responseFormat = (req.response_format ?? 'full') as ResponseFormat;
  await ha.sendProgress(0, req.sources.length, `Reading from ${req.sources.length} spreadsheet(s)`);
  const { crossRead } = await import('../../services/cross-spreadsheet.js');

  // Extract A1 notation from RangeInput for each source
  const normalizedSources = req.sources.map((source) => ({
    spreadsheetId: source.spreadsheetId,
    range: extractRangeA1(source.range, 'sources[].range'),
    label: source.label,
  }));

  const result = await crossRead(
    ha.api,
    normalizedSources,
    req.joinKey,
    req.joinType ?? 'left',
    ha.context.cachedSheetsApi
  );

  try {
    if (ha.context.sessionContext) {
      for (const source of normalizedSources) {
        ha.context.sessionContext.trackReadOperation(source.spreadsheetId, source.range);
      }
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'cross_read',
        spreadsheetId: req.sources[0]?.spreadsheetId ?? '',
        description: `Cross-read from ${req.sources.length} spreadsheet(s): ${req.sources.map((s) => s.spreadsheetId).join(', ')}`,
        undoable: false,
      });
    }
  } catch {
    /* non-blocking */
  }

  const shapedRows = shapeValuesByResponseFormat(
    result.mergedValues as ValuesArray,
    responseFormat
  );
  const mergedHeaders = result.mergedHeaders.slice(0, shapedRows.returnedColumnCount);
  const responseData: Record<string, unknown> = {
    rows: shapedRows.values,
    mergedHeaders,
    sourcesRead: result.sourcesRead,
    crossErrors: result.errors.length > 0 ? result.errors : undefined,
    responseFormat,
    rowCount: shapedRows.originalRowCount,
    returnedRowCount: shapedRows.returnedRowCount,
    columnCount: shapedRows.originalColumnCount,
    returnedColumnCount: shapedRows.returnedColumnCount,
  };

  if (shapedRows.truncated) {
    responseData['truncated'] = true;
    responseData['_responseFormatHint'] =
      `response_format="${responseFormat}" returned ${shapedRows.returnedRowCount}x${shapedRows.returnedColumnCount} ` +
      `of ${shapedRows.originalRowCount}x${shapedRows.originalColumnCount}. Use response_format:"full" for complete rows.`;
  }

  recordCrossSpreadsheetOp('cross_read', 'success');
  return ha.makeSuccess(
    'cross_read',
    responseData,
    undefined,
    undefined,
    buildResponseFormatMeta(ha, 'cross_read', responseData)
  );
}

// ─── handleCrossQuery ─────────────────────────────────────────────────────────

export async function handleCrossQuery(
  ha: DataHandlerAccess,
  req: DataRequest & { action: 'cross_query' }
): Promise<DataResponse> {
  const responseFormat = (req.response_format ?? 'full') as ResponseFormat;
  const { crossQuery } = await import('../../services/cross-spreadsheet.js');

  // Extract A1 notation from RangeInput for each source
  const normalizedSources = req.sources.map((source) => ({
    spreadsheetId: source.spreadsheetId,
    range: extractRangeA1(source.range, 'sources[].range'),
    label: source.label,
  }));

  const result = await crossQuery(
    ha.api,
    normalizedSources,
    req.query,
    req.maxResults ?? 100,
    ha.context.cachedSheetsApi
  );
  const shapedMatches = shapeListByResponseFormat(result.queryMatches, responseFormat);
  const responseData: Record<string, unknown> = {
    queryMatches: shapedMatches.items,
    totalSearched: result.totalSearched,
    responseFormat,
    totalMatches: shapedMatches.originalCount,
    returnedMatches: shapedMatches.returnedCount,
  };

  if (shapedMatches.truncated) {
    responseData['truncated'] = true;
    responseData['_responseFormatHint'] =
      `response_format="${responseFormat}" returned ${shapedMatches.returnedCount} of ${shapedMatches.originalCount} matches. ` +
      'Use response_format:"full" for complete queryMatches.';
  }

  let interpretation: string | undefined;
  try {
    if (ha.context.samplingServer) {
      interpretation = await generateAIInsight(
        ha.context.samplingServer,
        'queryInterpretation',
        'Interpret this natural language query and explain how it was translated to data operations',
        {
          query: req.query,
          sourcesCount: req.sources.length,
          matchesFound: shapedMatches.originalCount,
          summary: `Query found ${shapedMatches.originalCount} matches across ${req.sources.length} sources`,
        }
      );
    }
  } catch {
    /* non-blocking */
  }

  if (interpretation) {
    responseData['interpretation'] = interpretation;
  }

  recordCrossSpreadsheetOp('cross_query', 'success');

  return ha.makeSuccess(
    'cross_query',
    responseData,
    undefined,
    undefined,
    buildResponseFormatMeta(ha, 'cross_query', responseData)
  );
}

// ─── handleCrossWrite ─────────────────────────────────────────────────────────

export async function handleCrossWrite(
  ha: DataHandlerAccess,
  req: DataRequest & { action: 'cross_write' }
): Promise<DataResponse> {
  await ha.sendProgress(0, 1, `Copying data between spreadsheets`);
  const { crossWrite } = await import('../../services/cross-spreadsheet.js');

  // Extract A1 notation from RangeInput for source and destination
  const normalizedSource = {
    spreadsheetId: req.source.spreadsheetId,
    range: extractRangeA1(req.source.range, 'source.range'),
    label: req.source.label,
  };
  const normalizedDestination = {
    spreadsheetId: req.destination.spreadsheetId,
    range: req.destination.range, // Already a plain string in cross_write schema
  };

  const result = await crossWrite(
    ha.api,
    normalizedSource,
    normalizedDestination,
    req.valueInputOption ?? 'USER_ENTERED',
    ha.context.cachedSheetsApi
  );
  try {
    if (ha.context.sessionContext) {
      ha.context.sessionContext.recordOperation({
        tool: 'sheets_data',
        action: 'cross_write',
        spreadsheetId: req.destination.spreadsheetId,
        description: `Cross-write: copied ${result.cellsCopied} cells from ${req.source.spreadsheetId}`,
        undoable: false,
      });
    }
  } catch {
    /* non-blocking */
  }

  recordCrossSpreadsheetOp('cross_write', 'success');
  return ha.makeSuccess('cross_write', {
    cellsCopied: result.cellsCopied,
    updatedRange: result.updatedRange,
  });
}

// ─── handleCrossCompare ───────────────────────────────────────────────────────

export async function handleCrossCompare(
  ha: DataHandlerAccess,
  req: DataRequest & { action: 'cross_compare' }
): Promise<DataResponse> {
  const responseFormat = (req.response_format ?? 'full') as ResponseFormat;
  const compareColumns = req.compareColumns;
  await ha.sendProgress(0, 1, `Comparing data between spreadsheets`);
  const { crossCompare } = await import('../../services/cross-spreadsheet.js');

  // Extract A1 notation from RangeInput for both sources
  const normalizedSource1 = {
    spreadsheetId: req.source1.spreadsheetId,
    range: extractRangeA1(req.source1.range, 'source1.range'),
    label: req.source1.label,
  };
  const normalizedSource2 = {
    spreadsheetId: req.source2.spreadsheetId,
    range: extractRangeA1(req.source2.range, 'source2.range'),
    label: req.source2.label,
  };

  const result = await crossCompare(
    ha.api,
    normalizedSource1,
    normalizedSource2,
    compareColumns,
    req.keyColumn,
    ha.context.cachedSheetsApi
  );
  const shapedAdded = shapeValuesByResponseFormat(result.added as ValuesArray, responseFormat);
  const shapedRemoved = shapeValuesByResponseFormat(result.removed as ValuesArray, responseFormat);
  const shapedChanged = shapeListByResponseFormat(result.changed, responseFormat);
  const isTruncated = shapedAdded.truncated || shapedRemoved.truncated || shapedChanged.truncated;

  const responseData: Record<string, unknown> = {
    diff: {
      ...result,
      added: shapedAdded.values,
      removed: shapedRemoved.values,
      changed: shapedChanged.items,
      returnedAddedRows: shapedAdded.returnedRowCount,
      returnedRemovedRows: shapedRemoved.returnedRowCount,
      returnedChangedCells: shapedChanged.returnedCount,
    },
    responseFormat,
  };

  if (isTruncated) {
    responseData['truncated'] = true;
    responseData['_responseFormatHint'] =
      `response_format="${responseFormat}" returned diff subsets ` +
      `(added ${shapedAdded.returnedRowCount}/${result.summary.addedRows}, ` +
      `removed ${shapedRemoved.returnedRowCount}/${result.summary.removedRows}, ` +
      `changed ${shapedChanged.returnedCount}/${result.summary.changedCells}). ` +
      'Use response_format:"full" for complete diff payloads.';
  }

  let narrative: string | undefined;
  try {
    if (ha.context.samplingServer) {
      const summaryText = `Added: ${result.summary.addedRows} rows, Removed: ${result.summary.removedRows} rows, Changed: ${result.summary.changedCells} cells`;
      narrative = await generateAIInsight(
        ha.context.samplingServer,
        'dataAnalysis',
        'Summarize the key differences found in this cross-spreadsheet comparison',
        {
          summary: summaryText,
          compareColumns: compareColumns?.length ?? 0,
          comparedChanges: result.summary.changedCells,
        }
      );
    }
  } catch {
    /* non-blocking */
  }

  if (narrative) {
    responseData['narrative'] = narrative;
  }

  recordCrossSpreadsheetOp('cross_compare', 'success');

  return ha.makeSuccess(
    'cross_compare',
    responseData,
    undefined,
    undefined,
    buildResponseFormatMeta(ha, 'cross_compare', responseData)
  );
}
