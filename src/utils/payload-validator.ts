/**
 * ServalSheets - Payload Size Validator
 *
 * Validates Google API request payload sizes before sending.
 * Prevents exceeding Google's 10MB limit with comprehensive size estimation.
 *
 * Benefits:
 * - Early detection of oversized payloads
 * - Actionable splitting suggestions
 * - Detailed size breakdowns
 * - Prevents wasted API calls
 *
 * @see https://developers.google.com/sheets/api/limits
 * @category Utils
 */

import { logger } from './logger.js';
import type { sheets_v4 } from 'googleapis';

/**
 * Google Sheets API payload limits
 *
 * Source: https://developers.google.com/sheets/api/limits
 */
export const PAYLOAD_LIMITS = {
  /** Maximum payload size (10MB with 1MB buffer for safety) */
  MAX_SIZE: 9_000_000, // 9MB

  /** Warning threshold (70% of max) */
  WARNING_THRESHOLD: 7_000_000, // 7MB

  /** Critical threshold (90% of max) */
  CRITICAL_THRESHOLD: 8_100_000, // 8.1MB

  /** Maximum requests per batch */
  MAX_BATCH_REQUESTS: 100,
} as const;

/**
 * Payload size check result
 */
export interface PayloadSizeResult {
  /** Total payload size in bytes */
  sizeBytes: number;

  /** Size in megabytes (formatted) */
  sizeMB: string;

  /** Whether payload is within limits */
  withinLimits: boolean;

  /** Warning level: none, warning, critical, exceeded */
  level: 'none' | 'warning' | 'critical' | 'exceeded';

  /** Human-readable message */
  message: string;

  /** Suggested actions if oversized */
  suggestions?: string[];

  /** Estimated requests needed if split */
  estimatedSplitCount?: number;

  /** Size breakdown by request type */
  breakdown?: Record<string, number>;
}

/**
 * Estimate serialized JSON size for payload
 *
 * More accurate than JSON.stringify().length for large objects.
 * Accounts for Unicode characters and JSON overhead.
 *
 * @param payload - Request payload object
 * @returns Estimated size in bytes
 */
export function estimatePayloadSize(payload: unknown): number {
  // Fast path: stringify for small objects
  const jsonString = JSON.stringify(payload);
  const stringLength = jsonString.length;

  // For large objects, account for UTF-8 encoding
  if (stringLength > 100_000) {
    // Estimate UTF-8 byte count (conservative)
    // ASCII chars = 1 byte, most Unicode = 2-3 bytes
    let byteCount = 0;
    for (let i = 0; i < jsonString.length; i++) {
      const code = jsonString.charCodeAt(i);
      if (code < 0x80) {
        byteCount += 1; // ASCII
      } else if (code < 0x800) {
        byteCount += 2; // 2-byte character
      } else if (code < 0x10000) {
        byteCount += 3; // 3-byte character
      } else {
        byteCount += 4; // 4-byte character
      }
    }
    return byteCount;
  }

  // Small objects: string length is close enough
  return stringLength;
}

/**
 * Validate batchUpdate payload size
 *
 * Checks if payload exceeds Google's limits and provides actionable feedback.
 *
 * @param requests - Array of Sheet API requests
 * @param context - Additional context for better suggestions
 * @returns Validation result with suggestions
 */
export function validateBatchUpdatePayload(
  requests: sheets_v4.Schema$Request[],
  context?: {
    spreadsheetId?: string;
    operationType?: string;
  }
): PayloadSizeResult {
  const payload = { requests };
  const sizeBytes = estimatePayloadSize(payload);
  const sizeMB = (sizeBytes / 1_000_000).toFixed(2);

  // Determine level
  let level: PayloadSizeResult['level'] = 'none';
  let withinLimits = true;
  let message = `Payload size: ${sizeMB}MB`;
  const suggestions: string[] = [];

  if (sizeBytes > PAYLOAD_LIMITS.MAX_SIZE) {
    level = 'exceeded';
    withinLimits = false;
    message = `Payload (${sizeMB}MB) exceeds Google's 9MB limit`;
    suggestions.push(
      `Split operation into ${Math.ceil(sizeBytes / PAYLOAD_LIMITS.MAX_SIZE)} or more batches`,
      'Reduce cell value sizes or formatting complexity',
      'Consider using appendDimension for large data sets'
    );
  } else if (sizeBytes > PAYLOAD_LIMITS.CRITICAL_THRESHOLD) {
    level = 'critical';
    message = `Payload (${sizeMB}MB) approaching 9MB limit - consider splitting`;
    suggestions.push(
      'Split into smaller batches for safety',
      'Monitor payload sizes in production'
    );
  } else if (sizeBytes > PAYLOAD_LIMITS.WARNING_THRESHOLD) {
    level = 'warning';
    message = `Payload (${sizeMB}MB) above 7MB threshold - monitor closely`;
    suggestions.push('Consider splitting if adding more operations');
  }

  // Calculate estimated split count if needed
  let estimatedSplitCount: number | undefined;
  if (!withinLimits) {
    // Estimate based on request distribution
    const avgRequestSize = sizeBytes / requests.length;
    const requestsPerBatch = Math.floor(PAYLOAD_LIMITS.MAX_SIZE / avgRequestSize);
    estimatedSplitCount = Math.ceil(requests.length / requestsPerBatch);
  }

  // Build size breakdown by request type
  const breakdown: Record<string, number> = {};
  for (const request of requests) {
    const requestType = Object.keys(request)[0] || 'unknown';
    const requestSize = estimatePayloadSize(request);
    breakdown[requestType] = (breakdown[requestType] || 0) + requestSize;
  }

  // Log based on level
  if (level === 'exceeded') {
    logger.error('Payload size limit exceeded', {
      spreadsheetId: context?.spreadsheetId,
      operationType: context?.operationType,
      sizeMB,
      requestCount: requests.length,
      breakdown,
    });
  } else if (level === 'critical') {
    logger.warn('Payload size critical', {
      spreadsheetId: context?.spreadsheetId,
      operationType: context?.operationType,
      sizeMB,
      requestCount: requests.length,
    });
  } else if (level === 'warning') {
    logger.info('Payload size warning', {
      spreadsheetId: context?.spreadsheetId,
      operationType: context?.operationType,
      sizeMB,
      requestCount: requests.length,
    });
  }

  return {
    sizeBytes,
    sizeMB,
    withinLimits,
    level,
    message,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    estimatedSplitCount,
    breakdown,
  };
}

/**
 * Validate values API payload size
 *
 * Specialized validator for values.update and values.batchUpdate operations.
 *
 * @param values - 2D array of cell values
 * @param range - Target range (for context)
 * @returns Validation result
 */
export function validateValuesPayload(values: unknown[][], range?: string): PayloadSizeResult {
  const payload = { values };
  const sizeBytes = estimatePayloadSize(payload);
  const sizeMB = (sizeBytes / 1_000_000).toFixed(2);

  let level: PayloadSizeResult['level'] = 'none';
  let withinLimits = true;
  let message = `Values payload size: ${sizeMB}MB`;
  const suggestions: string[] = [];

  if (sizeBytes > PAYLOAD_LIMITS.MAX_SIZE) {
    level = 'exceeded';
    withinLimits = false;
    message = `Values payload (${sizeMB}MB) exceeds 9MB limit`;

    const rowCount = values.length;
    const colCount = values[0]?.length || 0;
    const totalCells = rowCount * colCount;
    const avgCellSize = sizeBytes / totalCells;
    const maxCellsPerBatch = Math.floor(PAYLOAD_LIMITS.MAX_SIZE / avgCellSize);
    const estimatedBatches = Math.ceil(totalCells / maxCellsPerBatch);

    suggestions.push(
      `Split ${rowCount}x${colCount} range into ${estimatedBatches} smaller ranges`,
      `Process ${Math.floor(maxCellsPerBatch / colCount)} rows per batch`,
      'Use appendDimension for bulk appends instead of values.update'
    );
  } else if (sizeBytes > PAYLOAD_LIMITS.CRITICAL_THRESHOLD) {
    level = 'critical';
    message = `Values payload (${sizeMB}MB) approaching limit`;
    suggestions.push('Consider splitting into multiple updates');
  } else if (sizeBytes > PAYLOAD_LIMITS.WARNING_THRESHOLD) {
    level = 'warning';
    message = `Values payload (${sizeMB}MB) above 7MB threshold`;
  }

  logger.debug('Values payload size check', {
    range,
    sizeMB,
    rowCount: values.length,
    colCount: values[0]?.length || 0,
    level,
  });

  return {
    sizeBytes,
    sizeMB,
    withinLimits,
    level,
    message,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Validate values batch payload size
 *
 * Specialized validator for values.batchUpdate and values.batchUpdateByDataFilter operations.
 *
 * @param data - Batch entries containing values (and ranges/filters)
 * @param context - Additional context for logging
 * @returns Validation result
 */
export function validateValuesBatchPayload(
  data: Array<{ values: unknown[][] }>,
  context?: {
    spreadsheetId?: string;
    operationType?: string;
  }
): PayloadSizeResult {
  const payload = { data };
  const sizeBytes = estimatePayloadSize(payload);
  const sizeMB = (sizeBytes / 1_000_000).toFixed(2);

  let level: PayloadSizeResult['level'] = 'none';
  let withinLimits = true;
  let message = `Values batch payload size: ${sizeMB}MB`;
  const suggestions: string[] = [];

  if (sizeBytes > PAYLOAD_LIMITS.MAX_SIZE) {
    level = 'exceeded';
    withinLimits = false;
    message = `Values batch payload (${sizeMB}MB) exceeds 9MB limit`;
    suggestions.push(
      'Split batch into smaller requests',
      'Reduce value sizes or number of ranges per batch'
    );
  } else if (sizeBytes > PAYLOAD_LIMITS.CRITICAL_THRESHOLD) {
    level = 'critical';
    message = `Values batch payload (${sizeMB}MB) approaching limit`;
    suggestions.push('Consider splitting into multiple smaller batches');
  } else if (sizeBytes > PAYLOAD_LIMITS.WARNING_THRESHOLD) {
    level = 'warning';
    message = `Values batch payload (${sizeMB}MB) above 7MB threshold`;
  }

  let estimatedSplitCount: number | undefined;
  if (!withinLimits) {
    const perBatch = calculateOptimalBatchSize(data.length, sizeBytes);
    estimatedSplitCount = perBatch > 0 ? Math.ceil(data.length / perBatch) : undefined;
  }

  if (level === 'exceeded') {
    logger.error('Values batch payload size limit exceeded', {
      spreadsheetId: context?.spreadsheetId,
      operationType: context?.operationType,
      sizeMB,
      entryCount: data.length,
    });
  } else if (level === 'critical') {
    logger.warn('Values batch payload size critical', {
      spreadsheetId: context?.spreadsheetId,
      operationType: context?.operationType,
      sizeMB,
      entryCount: data.length,
    });
  } else if (level === 'warning') {
    logger.info('Values batch payload size warning', {
      spreadsheetId: context?.spreadsheetId,
      operationType: context?.operationType,
      sizeMB,
      entryCount: data.length,
    });
  }

  return {
    sizeBytes,
    sizeMB,
    withinLimits,
    level,
    message,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    estimatedSplitCount,
  };
}

/**
 * Check if payload should be split proactively
 *
 * Returns true if payload is above warning threshold and would benefit from splitting.
 *
 * @param sizeBytes - Payload size in bytes
 * @returns Whether to recommend splitting
 */
export function shouldSplitPayload(sizeBytes: number): boolean {
  return sizeBytes > PAYLOAD_LIMITS.WARNING_THRESHOLD;
}

/**
 * Calculate optimal batch size for splitting
 *
 * Returns recommended number of requests per batch to stay under limits.
 *
 * @param totalRequests - Total number of requests to split
 * @param estimatedSize - Estimated total size in bytes
 * @returns Recommended requests per batch
 */
export function calculateOptimalBatchSize(totalRequests: number, estimatedSize: number): number {
  if (totalRequests === 0) return 0;

  const avgRequestSize = estimatedSize / totalRequests;

  // Target 80% of max size for safety margin
  const targetBatchSize = PAYLOAD_LIMITS.MAX_SIZE * 0.8;
  const requestsPerBatch = Math.floor(targetBatchSize / avgRequestSize);

  // Ensure at least 1 request per batch
  return Math.max(1, Math.min(requestsPerBatch, PAYLOAD_LIMITS.MAX_BATCH_REQUESTS));
}

/**
 * Get payload size statistics
 *
 * Returns summary statistics for monitoring/debugging.
 *
 * @param results - Array of validation results
 * @returns Summary statistics
 */
export function getPayloadStats(results: PayloadSizeResult[]): {
  totalPayloads: number;
  avgSizeMB: string;
  maxSizeMB: string;
  warningCount: number;
  criticalCount: number;
  exceededCount: number;
} {
  if (results.length === 0) {
    return {
      totalPayloads: 0,
      avgSizeMB: '0.00',
      maxSizeMB: '0.00',
      warningCount: 0,
      criticalCount: 0,
      exceededCount: 0,
    };
  }

  const totalSize = results.reduce((sum, r) => sum + r.sizeBytes, 0);
  const maxSize = Math.max(...results.map((r) => r.sizeBytes));
  const avgSize = totalSize / results.length;

  const warningCount = results.filter((r) => r.level === 'warning').length;
  const criticalCount = results.filter((r) => r.level === 'critical').length;
  const exceededCount = results.filter((r) => r.level === 'exceeded').length;

  return {
    totalPayloads: results.length,
    avgSizeMB: (avgSize / 1_000_000).toFixed(2),
    maxSizeMB: (maxSize / 1_000_000).toFixed(2),
    warningCount,
    criticalCount,
    exceededCount,
  };
}
