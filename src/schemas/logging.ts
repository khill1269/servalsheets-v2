import { z } from 'zod';

/**
 * MCP LoggingLevel enum
 * Spec: "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"
 */
export const McpLoggingLevelSchema = z.enum([
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
]);

export type McpLoggingLevel = z.infer<typeof McpLoggingLevelSchema>;

/**
 * Map MCP log levels to Winston levels
 */
export const MCP_TO_WINSTON_LEVEL: Record<McpLoggingLevel, string> = {
  emergency: 'error',
  alert: 'error',
  critical: 'error',
  error: 'error',
  warning: 'warn',
  notice: 'info',
  info: 'info',
  debug: 'debug',
};

/**
 * Map Winston levels to MCP levels
 */
export const WINSTON_TO_MCP_LEVEL: Record<string, McpLoggingLevel> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  http: 'info',
  verbose: 'debug',
  debug: 'debug',
  silly: 'debug',
};

/**
 * logging/setLevel request schema
 */
export const LoggingSetLevelRequestSchema = z.object({
  level: McpLoggingLevelSchema.describe('The log level to set'),
});

export type LoggingSetLevelRequest = z.infer<typeof LoggingSetLevelRequestSchema>;

/**
 * logging/setLevel response schema
 */
export const LoggingSetLevelResponseSchema = z.object({
  success: z.boolean(),
  previousLevel: z.string().optional(),
  newLevel: z.string(),
});

export type LoggingSetLevelResponse = z.infer<typeof LoggingSetLevelResponseSchema>;
