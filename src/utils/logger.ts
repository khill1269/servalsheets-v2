/**
 * ServalSheets - Logger (with request context)
 *
 * Extends base logger with request context enrichment (requestId, traceId, spanId).
 * Uses lazy loading to avoid circular dependency with request-context.ts.
 *
 * Import hierarchy:
 * - base-logger.ts (no request context) ← lowest level
 * - request-context.ts (imports base-logger)
 * - logger.ts (this file - imports base-logger, lazy-loads request-context)
 */

import * as winston from 'winston';
import { baseLogger } from './base-logger.js';

/**
 * Add request context (requestId, traceId, spanId) to all log entries
 * Enables request correlation across services and distributed tracing
 * Uses AsyncLocalStorage to automatically inject context without manual passing
 */
const addRequestContext = winston.format((info) => {
  // Use lazy import to avoid circular dependency
  try {
    const { getRequestContext } =
      require('./request-context.js') as typeof import('./request-context.js');
    const ctx = getRequestContext();
    if (ctx) {
      // Only add fields that exist (don't pollute logs with undefined)
      if (ctx.requestId) info['requestId'] = ctx.requestId;
      if (ctx.traceId) info['traceId'] = ctx.traceId;
      if (ctx.spanId) info['spanId'] = ctx.spanId;
    }
  } catch {
    // Ignore errors (module may not be available during initialization)
  }
  return info;
});

/**
 * Enhance baseLogger with request context format
 * Creates a wrapper that applies addRequestContext format to all log entries
 */
function createLoggerWithRequestContext(): winston.Logger {
  // Get base logger's config
  const baseFormat = baseLogger.format;

  // Create new logger with combined format
  return winston.createLogger({
    level: baseLogger.level,
    format: winston.format.combine(
      addRequestContext(), // Add this first so it's available for other formatters
      baseFormat
    ),
    transports: baseLogger.transports,
    defaultMeta: baseLogger.defaultMeta,
  });
}

/**
 * Logger with request context enrichment
 * Wraps baseLogger and adds requestId/traceId/spanId from AsyncLocalStorage
 */
export const logger = createLoggerWithRequestContext();

export function createChildLogger(meta: Record<string, unknown>): winston.Logger {
  return logger.child(meta);
}
