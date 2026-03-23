import { logger } from '../utils/logger.js';
import {
  LoggingSetLevelRequest,
  LoggingSetLevelResponse,
  MCP_TO_WINSTON_LEVEL,
  WINSTON_TO_MCP_LEVEL,
} from '../schemas/logging.js';

/**
 * Handle logging/setLevel requests
 */
export async function handleLoggingSetLevel(
  request: LoggingSetLevelRequest
): Promise<LoggingSetLevelResponse> {
  const previousLevel = logger.level;
  const newWinstonLevel = MCP_TO_WINSTON_LEVEL[request.level];

  // Update Winston logger level
  logger.level = newWinstonLevel;

  // Log the change at info level (will be visible if new level allows it)
  logger.info('Log level changed via MCP logging/setLevel', {
    previousLevel,
    newLevel: newWinstonLevel,
    mcpLevel: request.level,
  });

  return {
    success: true,
    previousLevel,
    newLevel: newWinstonLevel,
  };
}

/**
 * Get current log level in MCP format
 */
export function getCurrentLogLevel(): string {
  return WINSTON_TO_MCP_LEVEL[logger.level] || 'info';
}
