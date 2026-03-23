import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { logger as baseLogger } from '../utils/logger.js';
import {
  buildMcpLoggingMessage,
  consumeMcpLogRateLimit,
  createMcpLogRateLimitState,
  extractMcpLogEntry,
  type McpLogRateLimitState,
  shouldForwardMcpLog,
} from '../server-utils/logging-bridge-utils.js';

interface ForwardLogMessageParams {
  levelOrEntry: unknown;
  message: unknown;
  meta: unknown[];
  requestedMcpLogLevel: LoggingLevel | null;
  forwardingMcpLog: boolean;
  setForwardingMcpLog: (value: boolean) => void;
  rateLimitState: McpLogRateLimitState;
  server: McpServer;
}

export function forwardServerLogMessage(params: ForwardLogMessageParams): void {
  const {
    levelOrEntry,
    message,
    meta,
    requestedMcpLogLevel,
    forwardingMcpLog,
    setForwardingMcpLog,
    rateLimitState,
    server,
  } = params;
  if (!requestedMcpLogLevel || forwardingMcpLog) {
    return;
  }

  const extracted = extractMcpLogEntry(levelOrEntry, message, meta);
  if (!extracted) {
    return;
  }

  if (!shouldForwardMcpLog(extracted.level, requestedMcpLogLevel)) {
    return;
  }

  if (!consumeMcpLogRateLimit(rateLimitState)) {
    return;
  }

  setForwardingMcpLog(true);
  void server.server
    .sendLoggingMessage(buildMcpLoggingMessage(extracted.level, extracted.text, extracted.data))
    .catch(() => {
      // Best-effort bridge: avoid recursive logging on notification failure.
    })
    .finally(() => {
      setForwardingMcpLog(false);
    });
}

export function installServerLoggingBridge(params: {
  loggingBridgeInstalled: boolean;
  setLoggingBridgeInstalled: (value: boolean) => void;
  getRequestedMcpLogLevel: () => LoggingLevel | null;
  getForwardingMcpLog: () => boolean;
  setForwardingMcpLog: (value: boolean) => void;
  getRateLimitState?: () => McpLogRateLimitState;
  server: McpServer;
}): void {
  const {
    loggingBridgeInstalled,
    setLoggingBridgeInstalled,
    getRequestedMcpLogLevel,
    getForwardingMcpLog,
    setForwardingMcpLog,
    getRateLimitState,
    server,
  } = params;

  if (loggingBridgeInstalled) {
    return;
  }

  setLoggingBridgeInstalled(true);
  const originalLog = baseLogger.log.bind(baseLogger);

  baseLogger.log = ((levelOrEntry: unknown, message?: unknown, ...meta: unknown[]) => {
    const result = (originalLog as (...args: unknown[]) => unknown)(levelOrEntry, message, ...meta);
    forwardServerLogMessage({
      levelOrEntry,
      message,
      meta,
      requestedMcpLogLevel: getRequestedMcpLogLevel(),
      forwardingMcpLog: getForwardingMcpLog(),
      setForwardingMcpLog,
      rateLimitState: getRateLimitState ? getRateLimitState() : createMcpLogRateLimitState(),
      server,
    });
    return result;
  }) as typeof baseLogger.log;
}
