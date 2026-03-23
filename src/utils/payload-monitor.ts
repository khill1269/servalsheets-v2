/**
 * ServalSheets - Payload Size Monitoring
 *
 * Monitors request/response payload sizes for Google Sheets API calls
 */

import { logger } from './logger.js';

export interface PayloadMetrics {
  requestSize: number;
  responseSize: number;
  requestSizeMB: number;
  responseSizeMB: number;
  timestamp: string;
  operation: string;
}

// Google recommends 2MB max payload
const RECOMMENDED_MAX_MB = 2;
const WARNING_THRESHOLD_MB = 1.5;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Calculate the approximate size of a JSON object in bytes
 */
export function calculatePayloadSize(payload: unknown): number {
  if (payload === null || payload === undefined) {
    return 0;
  }

  try {
    const jsonString = JSON.stringify(payload);
    return Buffer.byteLength(jsonString, 'utf8');
  } catch (error) {
    logger.warn('Failed to calculate payload size', { error });
    return 0;
  }
}

/**
 * Monitor a Google API request/response payload
 */
export function monitorPayload(
  operation: string,
  request: unknown,
  response: unknown
): PayloadMetrics {
  const requestSize = calculatePayloadSize(request);
  const responseSize = calculatePayloadSize(response);

  const requestSizeMB = requestSize / BYTES_PER_MB;
  const responseSizeMB = responseSize / BYTES_PER_MB;

  const metrics: PayloadMetrics = {
    requestSize,
    responseSize,
    requestSizeMB: Math.round(requestSizeMB * 100) / 100,
    responseSizeMB: Math.round(responseSizeMB * 100) / 100,
    timestamp: new Date().toISOString(),
    operation,
  };

  // Log warnings for large payloads
  if (requestSizeMB > RECOMMENDED_MAX_MB) {
    logger.error('Request payload exceeds Google recommended maximum', {
      operation,
      sizeMB: metrics.requestSizeMB,
      recommendedMaxMB: RECOMMENDED_MAX_MB,
    });
  } else if (requestSizeMB > WARNING_THRESHOLD_MB) {
    logger.warn('Request payload approaching maximum', {
      operation,
      sizeMB: metrics.requestSizeMB,
      recommendedMaxMB: RECOMMENDED_MAX_MB,
    });
  }

  if (responseSizeMB > RECOMMENDED_MAX_MB) {
    logger.warn('Response payload exceeds Google recommended maximum', {
      operation,
      sizeMB: metrics.responseSizeMB,
      recommendedMaxMB: RECOMMENDED_MAX_MB,
    });
  }

  // Debug log for all payloads
  logger.debug('Payload size metrics', metrics);

  return metrics;
}

/**
 * Check if payload size is within limits
 */
export function isWithinLimits(payloadSize: number): boolean {
  const sizeMB = payloadSize / BYTES_PER_MB;
  return sizeMB <= RECOMMENDED_MAX_MB;
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}
