/**
 * ServalSheets - Request Timeout Utility
 *
 * Prevents hanging operations by adding timeouts to all requests.
 * Essential for Claude Desktop to prevent UI freezes.
 *
 * @category Utils
 */

import { getEnv } from '../config/env.js';
import { logger as baseLogger } from './logger.js';

/**
 * Timeout error with operation details
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly operationName: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Wrap an async operation with a timeout
 *
 * @param operation Async operation to wrap
 * @param timeoutMs Timeout in milliseconds (default: REQUEST_TIMEOUT_MS from env, 60s)
 * @param operationName Operation name for logging
 * @returns Result of the operation
 * @throws TimeoutError if operation exceeds timeout
 *
 * @example
 * const result = await withTimeout(
 *   async () => await sheetsApi.get(...),
 *   30000,
 *   'sheets_data.read'
 * );
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = getEnv().REQUEST_TIMEOUT_MS,
  operationName: string = 'operation'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new TimeoutError(`Operation timed out after ${timeoutMs}ms`, operationName, timeoutMs)
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } catch (error) {
    if (error instanceof TimeoutError) {
      baseLogger.error('Operation timeout', {
        operationName,
        timeoutMs,
      });
    }
    throw error;
  } finally {
    // Always clear the timer to prevent memory leaks
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Wrap an operation with both timeout and keepalive
 *
 * For long-running operations that need both:
 * - Timeout protection (hard limit)
 * - Keepalive notifications (prevent client timeout)
 *
 * @param operation Async operation to wrap
 * @param timeoutMs Timeout in milliseconds
 * @param operationName Operation name for logging
 * @returns Result of the operation
 *
 * @example
 * const result = await withTimeoutAndKeepalive(
 *   async () => await analyzeLargeSheet(),
 *   60000, // 1 minute timeout
 *   'sheets_analyze.comprehensive'
 * );
 */
export async function withTimeoutAndKeepalive<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  const { startKeepalive } = await import('./keepalive.js');

  const keepalive = startKeepalive({ operationName });
  try {
    return await withTimeout(operation, timeoutMs, operationName);
  } finally {
    keepalive.stop();
  }
}
