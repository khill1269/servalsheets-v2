/**
 * ServalSheets - Base Logger (no request context)
 *
 * Base winston logger without request context to avoid circular dependencies.
 * This file is imported by both logger.ts and request-context.ts.
 *
 * Import hierarchy:
 * - base-logger.ts (no request context) ← lowest level
 * - request-context.ts (imports base-logger)
 * - logger.ts (imports base-logger, lazy-loads request-context)
 *
 * CloudWatch transport is lazily attached after construction to keep
 * the import graph clean and avoid blocking startup on SDK loading.
 */

import * as winston from 'winston';
import { getServiceContextFlat } from './logger-context.js';
import { redactObject } from './redact.js';

/**
 * Winston format for redacting sensitive data
 */
const redactSensitive = winston.format((info) => {
  const redacted = redactObject(info) as winston.Logform.TransformableInfo;
  return redacted;
});

/**
 * Add service context to all log entries
 */
const addServiceContext = winston.format((info) => {
  const serviceContext = getServiceContextFlat();
  Object.assign(info, serviceContext);
  return info;
});

const level =
  process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug');

// Detect STDIO mode
const isStdioMode = process.env['MCP_TRANSPORT'] === 'stdio' || !process.env['MCP_TRANSPORT'];

/**
 * Base logger without request context enrichment
 * Used as fallback in request-context.ts to avoid circular dependency
 */
export const baseLogger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    addServiceContext(),
    redactSensitive(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: isStdioMode
        ? ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']
        : ['error'],
    }),
  ],
  defaultMeta: getServiceContextFlat(),
});

/**
 * Lazily attach CloudWatch transport if enabled.
 * Uses dynamic import to avoid blocking startup and keep the SDK optional.
 * Runs asynchronously — logs before initialization completes still go to Console.
 */
(async () => {
  try {
    const { createCloudWatchTransport } = await import('./cloudwatch-transport.js');
    const cwTransport = createCloudWatchTransport();
    if (cwTransport) {
      baseLogger.add(cwTransport);
      baseLogger.info('CloudWatch Logs transport attached', {
        component: 'base-logger',
        logGroup: process.env['CLOUDWATCH_LOG_GROUP'] || '/servalsheets/mcp-server',
      });
    }
  } catch {
    // CloudWatch transport is optional — silently skip if unavailable
  }
})();
