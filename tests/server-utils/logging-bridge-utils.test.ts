import { describe, expect, it } from 'vitest';
import {
  buildMcpLoggingMessage,
  consumeMcpLogRateLimit,
  createMcpLogRateLimitState,
  extractMcpLogEntry,
} from '../../src/server-utils/logging-bridge-utils.js';

describe('logging-bridge-utils', () => {
  it('extracts structured log entries from level/message/meta arguments', () => {
    const extracted = extractMcpLogEntry('info', 'test message', [{ ok: true }]);

    expect(extracted).toEqual({
      level: 'info',
      text: 'test message',
      data: { ok: true },
    });
  });

  it('builds redacted, JSON-safe MCP logging payloads', () => {
    const circular: Record<string, unknown> = { access_token: 'secret-token' };
    circular['self'] = circular;

    const payload = buildMcpLoggingMessage('info', 'bridge test', {
      token: 'secret-token',
      circular,
      nested: { apiKey: 'top-secret' },
      bigint: BigInt(42),
      fn: () => 'hello',
    });

    expect(payload.level).toBe('info');
    expect(payload.logger).toBe('servalsheets');

    const serialized = JSON.stringify(payload.data);
    expect(serialized).toContain('bridge test');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[Circular]');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('top-secret');
  });

  it('rate limits notifications within a rolling window', () => {
    const state = createMcpLogRateLimitState();

    expect(consumeMcpLogRateLimit(state, { now: 1000, maxMessages: 2, windowMs: 1000 })).toBe(
      true
    );
    expect(consumeMcpLogRateLimit(state, { now: 1100, maxMessages: 2, windowMs: 1000 })).toBe(
      true
    );
    expect(consumeMcpLogRateLimit(state, { now: 1200, maxMessages: 2, windowMs: 1000 })).toBe(
      false
    );
    expect(state.droppedInWindow).toBe(1);

    expect(consumeMcpLogRateLimit(state, { now: 2501, maxMessages: 2, windowMs: 1000 })).toBe(
      true
    );
    expect(state.messagesInWindow).toBe(1);
  });
});
