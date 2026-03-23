/**
 * Serval Core - Logger
 *
 * Platform-agnostic structured logging with redaction support.
 * Wraps Winston with automatic sensitive data redaction.
 */

import winston from 'winston';
import { redactObject } from './redact.js';

export type ServalLogger = winston.Logger;

export interface LoggerConfig {
  /** Service name for log context */
  serviceName?: string;
  /** Service version for log context */
  serviceVersion?: string;
  /** Log level (default: 'info' in production, 'debug' otherwise) */
  level?: string;
  /** Whether to log to stderr (useful for STDIO transports) */
  stderrAll?: boolean;
}

/**
 * Winston format for redacting sensitive data from all log entries
 */
const redactSensitive = winston.format((info) => {
  return redactObject(info) as winston.Logform.TransformableInfo;
});

/**
 * Create a logger instance for a Serval service
 */
export function createLogger(config: LoggerConfig = {}): ServalLogger {
  const level = config.level
    ?? process.env['LOG_LEVEL']
    ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug');

  const stderrAll = config.stderrAll ?? true;

  const defaultMeta: Record<string, string> = {};
  if (config.serviceName) defaultMeta['service'] = config.serviceName;
  if (config.serviceVersion) defaultMeta['version'] = config.serviceVersion;

  return winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.errors({ stack: true }),
      winston.format.timestamp(),
      redactSensitive(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        stderrLevels: stderrAll
          ? ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']
          : ['error'],
      }),
    ],
    defaultMeta,
  });
}

/**
 * Create a child logger with additional metadata
 */
export function createChildLogger(parent: ServalLogger, meta: Record<string, unknown>): ServalLogger {
  return parent.child(meta);
}

/**
 * Default logger instance for serval-core internals
 */
export const defaultLogger = createLogger({ serviceName: 'serval-core' });
