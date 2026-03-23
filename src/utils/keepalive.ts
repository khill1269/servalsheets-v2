/**
 * ServalSheets - Keepalive & Progress Notification Utility
 *
 * Prevents Claude Desktop timeouts by sending periodic progress notifications
 * during long-running operations.
 *
 * ## Problem
 * Claude Desktop times out after ~60-90 seconds without activity.
 * Long operations (5-10s each) chained together can exceed this.
 *
 * ## Solution
 * Send MCP progress notifications every 15 seconds to keep connection alive.
 *
 * @category Utils
 * @see docs/guides/TROUBLESHOOTING.md#timeout-issues
 */

import { getRequestContext } from './request-context.js';
import { logger as baseLogger } from './logger.js';

/**
 * Keepalive configuration
 */
export interface KeepaliveOptions {
  /** Send progress notification every N ms (default: 15000 = 15s) */
  intervalMs?: number;
  /** Operation name for logging */
  operationName?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Keepalive handle - call .stop() when operation completes
 */
export interface KeepaliveHandle {
  stop: () => void;
}

/**
 * Start sending periodic keepalive notifications during a long operation.
 *
 * @param options Keepalive configuration
 * @returns Handle with stop() method - MUST call when operation completes
 *
 * @example
 * const keepalive = startKeepalive({ operationName: 'sheets_data.write' });
 * try {
 *   await longRunningOperation();
 * } finally {
 *   keepalive.stop();
 * }
 */
export function startKeepalive(options: KeepaliveOptions = {}): KeepaliveHandle {
  // OPTIMIZATION: Reduced from 15s to 10s for more aggressive timeout prevention
  const intervalMs =
    parseInt(process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'] ?? '10000', 10) ||
    options.intervalMs ||
    10000;

  const operationName = options.operationName ?? 'operation';
  const debug = options.debug ?? process.env['DEBUG_KEEPALIVE'] === 'true';
  // CRITICAL: Enable by default to prevent Claude Desktop timeouts (disabled only if explicitly set to 'false')
  const enableNotifications = process.env['ENABLE_PROGRESS_NOTIFICATIONS'] !== 'false';

  const requestContext = getRequestContext();
  if (!requestContext) {
    // No request context - cannot send notifications
    if (debug) {
      baseLogger.debug('[Keepalive] No request context - keepalive disabled', {
        operationName,
      });
    }
    return { stop: () => {} };
  }

  const { sendNotification, progressToken, logger } = requestContext;
  if (!sendNotification || !progressToken || !enableNotifications) {
    // No progress notification capability or disabled
    if (debug) {
      logger.debug('[Keepalive] Progress notifications not available or disabled', {
        operationName,
        hasNotification: !!sendNotification,
        hasProgressToken: !!progressToken,
        enabled: enableNotifications,
      });
    }
    return { stop: () => {} };
  }

  let notificationCount = 0;
  let stopped = false;

  const sendProgress = async (): Promise<void> => {
    if (stopped) return;

    try {
      notificationCount++;
      await sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: notificationCount,
          total: undefined, // Unknown total
        },
      });

      if (debug) {
        logger.debug('[Keepalive] Sent progress notification', {
          operationName,
          notificationCount,
          intervalMs,
        });
      }
    } catch (error) {
      logger.warn('[Keepalive] Failed to send progress notification', {
        operationName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Send initial notification immediately
  void sendProgress();

  // Set up periodic notifications
  const timer = setInterval(() => {
    void sendProgress();
  }, intervalMs);

  logger.debug('[Keepalive] Started', {
    operationName,
    intervalMs,
    progressToken,
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);

      if (debug) {
        logger.debug('[Keepalive] Stopped', {
          operationName,
          totalNotifications: notificationCount,
        });
      }
    },
  };
}

/**
 * Wrap an async operation with automatic keepalive.
 *
 * @param operation Async operation to wrap
 * @param options Keepalive configuration
 * @returns Result of the operation
 *
 * @example
 * const result = await withKeepalive(
 *   async () => await longRunningOperation(),
 *   { operationName: 'sheets_analyze.analyze_data' }
 * );
 */
export async function withKeepalive<T>(
  operation: () => Promise<T>,
  options: KeepaliveOptions = {}
): Promise<T> {
  const keepalive = startKeepalive(options);
  try {
    return await operation();
  } finally {
    keepalive.stop();
  }
}
