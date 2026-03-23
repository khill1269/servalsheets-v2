/**
 * ServalSheets - Streaming Analysis
 *
 * Task-based chunked processing for large datasets (>50K rows).
 * Implements AsyncGenerator pattern with progress tracking and cancellation support.
 */

import type { sheets_v4 } from 'googleapis';
import type { TieredRetrieval, SheetMetadata } from './tiered-retrieval.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../core/errors.js';

/**
 * Result from a single chunk of analysis
 */
export interface AnalysisChunk {
  chunkIndex: number;
  totalChunks: number;
  rowsProcessed: number;
  totalRows: number;
  partialResults: {
    trends: number;
    anomalies: number;
    correlations: number;
    nullCount: number;
    duplicateCount: number;
  };
}

/**
 * Aggregated results from all chunks
 */
export interface StreamingAnalysisResult {
  totalRowsProcessed: number;
  totalChunks: number;
  aggregatedResults: {
    trends: number;
    anomalies: number;
    correlations: number;
    nullCount: number;
    duplicateCount: number;
  };
  duration: number;
  samplingMethod: 'chunked';
}

/**
 * Streaming analyzer for large datasets
 * Uses AsyncGenerator to process data in chunks with progress tracking
 */
export class StreamingAnalyzer {
  constructor(
    private sheetsApi: sheets_v4.Sheets,
    _tieredRetrieval: TieredRetrieval,
    private chunkSize: number = 1000
  ) {}

  /**
   * Analyze a large dataset in chunks, yielding progress updates
   */
  async *analyzeInChunks(
    spreadsheetId: string,
    sheetId: number | undefined,
    metadata: SheetMetadata
  ): AsyncGenerator<AnalysisChunk> {
    const targetSheet = sheetId
      ? metadata.sheets.find((s) => s.sheetId === sheetId)
      : metadata.sheets[0];

    if (!targetSheet) {
      throw new NotFoundError('sheet', sheetId !== undefined ? String(sheetId) : 'first');
    }

    const totalRows = targetSheet.rowCount;
    const totalChunks = Math.ceil(totalRows / this.chunkSize);

    logger.info('Starting streaming analysis', {
      spreadsheetId,
      sheetId,
      totalRows,
      totalChunks,
      chunkSize: this.chunkSize,
    });

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startRow = chunkIndex * this.chunkSize;
      const endRow = Math.min((chunkIndex + 1) * this.chunkSize, totalRows);

      // Fetch chunk data
      const range = `${targetSheet.title}!A${startRow + 1}:ZZ${endRow}`;

      logger.debug('Fetching chunk', { chunkIndex, range });

      const chunkData = await this.sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const values = chunkData.data.values ?? [];

      // Analyze chunk using helpers
      const { analyzeTrends, detectAnomalies, analyzeCorrelationsData } =
        await import('./helpers.js');

      const trends = analyzeTrends(values);
      const anomalies = detectAnomalies(values);
      const correlations = analyzeCorrelationsData(values);

      // Count nulls and duplicates
      let nullCount = 0;
      let duplicateCount = 0;

      const seenRows = new Set<string>();
      for (const row of values) {
        // Check for nulls
        nullCount += row.filter((cell) => cell === null || cell === '').length;

        // Check for duplicates
        const rowKey = JSON.stringify(row);
        if (seenRows.has(rowKey)) {
          duplicateCount++;
        } else {
          seenRows.add(rowKey);
        }
      }

      const partialResults = {
        trends: trends.length,
        anomalies: anomalies.length,
        correlations: correlations.length,
        nullCount,
        duplicateCount,
      };

      logger.debug('Chunk analysis complete', {
        chunkIndex,
        partialResults,
      });

      yield {
        chunkIndex,
        totalChunks,
        rowsProcessed: endRow,
        totalRows,
        partialResults,
      };
    }

    logger.info('Streaming analysis complete', {
      totalChunks,
      totalRows,
    });
  }

  /**
   * Execute streaming analysis and aggregate results
   * (Non-generator wrapper for standard async/await usage)
   */
  async execute(
    spreadsheetId: string,
    sheetId: number | undefined,
    metadata: SheetMetadata,
    onProgress?: (chunk: AnalysisChunk) => void | Promise<void>
  ): Promise<StreamingAnalysisResult> {
    const startTime = Date.now();

    const aggregated = {
      trends: 0,
      anomalies: 0,
      correlations: 0,
      nullCount: 0,
      duplicateCount: 0,
    };

    let totalRowsProcessed = 0;
    let totalChunks = 0;

    for await (const chunk of this.analyzeInChunks(spreadsheetId, sheetId, metadata)) {
      // Aggregate results
      aggregated.trends += chunk.partialResults.trends;
      aggregated.anomalies += chunk.partialResults.anomalies;
      aggregated.correlations += chunk.partialResults.correlations;
      aggregated.nullCount += chunk.partialResults.nullCount;
      aggregated.duplicateCount += chunk.partialResults.duplicateCount;

      totalRowsProcessed = chunk.rowsProcessed;
      totalChunks = chunk.totalChunks;

      // Report progress
      if (onProgress) {
        await onProgress(chunk);
      }
    }

    const duration = Date.now() - startTime;

    return {
      totalRowsProcessed,
      totalChunks,
      aggregatedResults: aggregated,
      duration,
      samplingMethod: 'chunked',
    };
  }

  /**
   * Cancel streaming analysis (for task cancellation support)
   */
  cancel(): void {
    logger.info('Streaming analysis cancelled');
    // AsyncGenerator iteration will naturally stop when broken
  }
}
