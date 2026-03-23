/**
 * ServalSheets - Streaming Export Utilities
 *
 * Memory-efficient export for large datasets (100K+ rows).
 * Uses chunked reading with progress updates to prevent OOM errors.
 *
 * @module utils/streaming-export
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from './logger.js';
import { sendProgress } from './request-context.js';
import { DataError, ServiceError } from '../core/errors.js';

/**
 * Configuration for streaming exports
 */
export interface StreamingExportConfig {
  /** Chunk size in rows (default: 1000) */
  chunkSize?: number;
  /** Maximum memory usage in bytes (default: 500MB) */
  maxMemoryBytes?: number;
  /** Enable progress reporting (default: true) */
  enableProgress?: boolean;
  /** Threshold for using streaming (default: 10000 rows) */
  streamingThreshold?: number;
}

/**
 * Export statistics
 */
export interface ExportStats {
  totalRows: number;
  totalColumns: number;
  chunksProcessed: number;
  bytesProcessed: number;
  durationMs: number;
}

/**
 * Streaming export result
 */
export interface StreamingExportResult {
  /** Exported data as array of rows */
  data: unknown[][];
  /** Export statistics */
  stats: ExportStats;
  /** Whether streaming was used */
  streamed: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<StreamingExportConfig> = {
  chunkSize: 1000,
  maxMemoryBytes: 500 * 1024 * 1024, // 500MB
  enableProgress: true,
  streamingThreshold: 10000,
};

/**
 * Estimate row count for a range
 * Uses spreadsheet metadata to determine approximate row count
 */
export async function estimateRowCount(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<number> {
  try {
    // Try to get metadata first (fast)
    const metadata = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title,gridProperties(rowCount)))',
    });

    // Parse range to extract sheet name
    const sheetName = range.split('!')[0]?.replace(/^'|'$/g, '') || range;
    const sheet = metadata.data.sheets?.find((s) => s.properties?.title === sheetName);

    if (sheet?.properties?.gridProperties?.rowCount) {
      return sheet.properties.gridProperties.rowCount;
    }

    // Fallback: get actual data to count
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    return response.data.values?.length ?? 0;
  } catch (error) {
    // Propagate not-found errors instead of silently assuming large dataset
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.toLowerCase().includes('not found')) {
      throw error;
    }
    logger.warn('Failed to estimate row count, assuming large dataset', { error });
    return DEFAULT_CONFIG.streamingThreshold + 1; // Assume large
  }
}

/**
 * Read data in chunks
 * Memory-efficient reading for large ranges
 */
export async function readDataInChunks(
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  config: StreamingExportConfig = {}
): Promise<StreamingExportResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  // Estimate total rows
  const estimatedRows = await estimateRowCount(sheetsApi, spreadsheetId, range);

  // Decide whether to use streaming
  const useStreaming = estimatedRows >= cfg.streamingThreshold;

  if (!useStreaming) {
    // Small dataset - use direct read
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    if (!response?.data) {
      throw new DataError('Invalid API response: missing data');
    }

    const data = response.data.values ?? [];
    const stats: ExportStats = {
      totalRows: data.length,
      totalColumns: data[0]?.length ?? 0,
      chunksProcessed: 1,
      bytesProcessed: JSON.stringify(data).length,
      durationMs: Math.max(1, Date.now() - startTime),
    };

    return { data, stats, streamed: false };
  }

  // Large dataset - use chunked reading
  logger.info('Using streaming export for large dataset', {
    estimatedRows,
    chunkSize: cfg.chunkSize,
  });

  // Parse range to extract sheet name and column bounds
  const { sheetName, startColumn, endColumn } = parseRange(range);

  const allData: unknown[][] = [];
  let currentRow = 1; // Start from row 1 (0-indexed in arrays, 1-indexed in ranges)
  let chunksProcessed = 0;
  let bytesProcessed = 0;
  let totalColumns = 0;

  while (currentRow <= estimatedRows) {
    const chunkEnd = Math.min(currentRow + cfg.chunkSize - 1, estimatedRows);
    const chunkRange = buildChunkRange(sheetName, startColumn, endColumn, currentRow, chunkEnd);

    // Progress update
    if (cfg.enableProgress) {
      await sendProgress(
        chunksProcessed,
        Math.ceil(estimatedRows / cfg.chunkSize),
        `Reading rows ${currentRow}-${chunkEnd} of ${estimatedRows}`
      );
    }

    // Read chunk
    try {
      const response = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: chunkRange,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      if (!response?.data) {
        throw new DataError('Invalid API response: missing data');
      }

      const chunkData = response.data.values ?? [];
      if (chunkData.length === 0) {
        // No more data
        break;
      }

      // Track column count
      if (totalColumns === 0 && chunkData.length > 0 && chunkData[0]) {
        totalColumns = chunkData[0].length;
      }

      // Append to result
      allData.push(...chunkData);

      // Track memory usage
      const chunkBytes = JSON.stringify(chunkData).length;
      bytesProcessed += chunkBytes;

      // Check memory limit
      if (bytesProcessed > cfg.maxMemoryBytes) {
        throw new ServiceError(
          `Export exceeds memory limit: ${(bytesProcessed / 1024 / 1024).toFixed(2)}MB > ${(cfg.maxMemoryBytes / 1024 / 1024).toFixed(2)}MB. ` +
            `Try reducing the range or exporting in multiple parts.`,
          'INTERNAL_ERROR',
          'streaming-export'
        );
      }

      chunksProcessed++;
      currentRow = chunkEnd + 1;

      // Break if we got fewer rows than expected (end of data)
      if (chunkData.length < cfg.chunkSize) {
        break;
      }
    } catch (error) {
      logger.error('Failed to read chunk', {
        chunkRange,
        currentRow,
        chunkEnd,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // Final progress update
  if (cfg.enableProgress) {
    await sendProgress(chunksProcessed, chunksProcessed, `Export complete: ${allData.length} rows`);
  }

  const stats: ExportStats = {
    totalRows: allData.length,
    totalColumns,
    chunksProcessed,
    bytesProcessed,
    durationMs: Math.max(1, Date.now() - startTime),
  };

  logger.info('Streaming export complete', stats);

  return { data: allData, stats, streamed: true };
}

/**
 * Parse range string into components
 */
function parseRange(range: string): {
  sheetName: string;
  startColumn: string;
  endColumn: string;
} {
  // Handle formats:
  // - "Sheet1!A:Z"
  // - "Sheet1!A1:Z100"
  // - "Sheet1"
  // - "A:Z"

  const parts = range.split('!');
  let sheetName = '';
  let columnRange = '';

  if (parts.length === 2 && parts[0] && parts[1]) {
    sheetName = parts[0].replace(/^'|'$/g, ''); // Remove quotes
    columnRange = parts[1];
  } else if (parts[0]) {
    columnRange = parts[0];
  }

  // Extract column bounds
  const columnMatch = columnRange.match(/^([A-Z]+)(?:\d+)?:([A-Z]+)(?:\d+)?$/);
  if (columnMatch && columnMatch[1] && columnMatch[2]) {
    return {
      sheetName,
      startColumn: columnMatch[1],
      endColumn: columnMatch[2],
    };
  }

  // Default to full row
  return {
    sheetName,
    startColumn: 'A',
    endColumn: 'ZZ', // Reasonable default
  };
}

/**
 * Build chunk range string
 */
function buildChunkRange(
  sheetName: string,
  startColumn: string,
  endColumn: string,
  startRow: number,
  endRow: number
): string {
  const colRange = `${startColumn}${startRow}:${endColumn}${endRow}`;

  if (sheetName) {
    // Quote sheet name if it contains spaces or special chars
    const quotedName =
      sheetName.includes(' ') || sheetName.includes("'")
        ? `'${sheetName.replace(/'/g, "''")}'`
        : sheetName;
    return `${quotedName}!${colRange}`;
  }

  return colRange;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
