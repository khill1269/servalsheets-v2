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
