import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { redact } from '../utils/redact.js';

const MCP_LOG_SEVERITY: Record<LoggingLevel, number> = {
  emergency: 0,
  alert: 1,
  critical: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
};

const WINSTON_TO_MCP_LOG_LEVEL: Record<string, LoggingLevel> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  http: 'info',
  verbose: 'debug',
  debug: 'debug',
  silly: 'debug',
};

export function normalizeMcpLogLevel(winstonLevel: string): LoggingLevel {
  return WINSTON_TO_MCP_LOG_LEVEL[winstonLevel] ?? 'info';
}

export function shouldForwardMcpLog(winstonLevel: string, requestedLevel: LoggingLevel): boolean {
  const messageLevel = normalizeMcpLogLevel(winstonLevel);
  return MCP_LOG_SEVERITY[messageLevel] <= MCP_LOG_SEVERITY[requestedLevel];
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface ExtractedMcpLogEntry {
  level: string;
  text: string;
  data: unknown;
}

export interface McpLogRateLimitState {
  windowStartedAt: number;
  messagesInWindow: number;
  droppedInWindow: number;
}

export function createMcpLogRateLimitState(): McpLogRateLimitState {
  return {
    windowStartedAt: 0,
    messagesInWindow: 0,
    droppedInWindow: 0,
  };
}

export function extractMcpLogEntry(
  levelOrEntry: unknown,
  message: unknown,
  meta: unknown[]
): ExtractedMcpLogEntry | null {
  let level = 'info';
  let text = '';
  let data: unknown = message;

  if (typeof levelOrEntry === 'string') {
    level = levelOrEntry;
    if (typeof message === 'string') {
      text = message;
    } else if (message !== undefined) {
      text = safeStringify(message);
    }
    data = meta.length === 0 ? message : meta.length === 1 ? meta[0] : meta;
    return { level, text, data };
  }

  if (typeof levelOrEntry === 'object' && levelOrEntry !== null) {
    const entry = levelOrEntry as Record<string, unknown>;
    if (typeof entry['level'] !== 'string') {
      return null;
    }
    level = entry['level'];
    if (typeof entry['message'] === 'string') {
      text = entry['message'];
    } else if (entry['message'] !== undefined) {
      text = safeStringify(entry['message']);
    }
    data = entry;
    return { level, text, data };
  }

  return null;
}

function sanitizeMcpLogData(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const sanitizeValue = (current: unknown): unknown => {
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'number' ||
      typeof current === 'boolean'
    ) {
      return current;
    }

    if (typeof current === 'bigint') {
      return current.toString();
    }

    if (typeof current === 'undefined') {
      return null;
    }

    if (typeof current === 'function') {
      return `[Function ${current.name || 'anonymous'}]`;
    }

    if (typeof current === 'symbol') {
      return String(current);
    }

    if (current instanceof Error) {
      return {
        name: current.name,
        message: current.message,
        ...(current.stack ? { stack: current.stack } : {}),
      };
    }

    if (Array.isArray(current)) {
      return current.map((item) => sanitizeValue(item));
    }

    if (typeof current === 'object') {
      if (seen.has(current)) {
        return '[Circular]';
      }
      seen.add(current);

      const output: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(current)) {
        output[key] = sanitizeValue(nestedValue);
      }
      return output;
    }

    return safeStringify(current);
  };

  return sanitizeValue(redact(value));
}

export function buildMcpLoggingMessage(
  level: string,
  text: string,
  data: unknown
): {
  level: LoggingLevel;
  logger: string;
  data: unknown;
} {
  return {
    level: normalizeMcpLogLevel(level),
    logger: 'servalsheets',
    data: sanitizeMcpLogData({
      message: text,
      meta: data,
    }),
  };
}

export function consumeMcpLogRateLimit(
  state: McpLogRateLimitState,
  options?: { now?: number; windowMs?: number; maxMessages?: number }
): boolean {
  const now = options?.now ?? Date.now();
  const windowMs = options?.windowMs ?? 1000;
  const maxMessages = options?.maxMessages ?? 100;

  if (state.windowStartedAt === 0 || now - state.windowStartedAt >= windowMs) {
    state.windowStartedAt = now;
    state.messagesInWindow = 0;
    state.droppedInWindow = 0;
  }

  if (state.messagesInWindow >= maxMessages) {
    state.droppedInWindow += 1;
    return false;
  }

  state.messagesInWindow += 1;
  return true;
}
