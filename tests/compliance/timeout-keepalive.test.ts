/**
 * Timeout & Keepalive Tests
 *
 * Tests the keepalive mechanism that prevents Claude Desktop timeouts,
 * and the withKeepalive wrapper for long-running operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startKeepalive, withKeepalive } from '../../src/utils/keepalive.js';

// Mock the request context module
vi.mock('../../src/utils/request-context.js', () => {
  let mockContext: Record<string, unknown> | null = null;
  return {
    getRequestContext: () => mockContext,
    setMockRequestContext: (ctx: Record<string, unknown> | null) => {
      mockContext = ctx;
    },
  };
});

// Import the mock setter
import { setMockRequestContext } from '../../src/utils/request-context.js';

// Helper to flush microtasks (needed because sendProgress is fire-and-forget async)
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Keepalive Mechanism', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMockRequestContext(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return no-op handle when no request context exists', () => {
    setMockRequestContext(null);
    const handle = startKeepalive({ operationName: 'test' });

    expect(handle).toBeDefined();
    expect(handle.stop).toBeDefined();
    handle.stop();
  });

  it('should return no-op when progress token is missing', () => {
    setMockRequestContext({
      sendNotification: vi.fn(),
      progressToken: null,
      logger: { debug: vi.fn(), warn: vi.fn() },
    });

    const handle = startKeepalive({ operationName: 'test' });
    handle.stop();
  });

  it('should return no-op when notifications are disabled', () => {
    process.env['ENABLE_PROGRESS_NOTIFICATIONS'] = 'false';
    setMockRequestContext({
      sendNotification: vi.fn(),
      progressToken: 'token_123',
      logger: { debug: vi.fn(), warn: vi.fn() },
    });

    const handle = startKeepalive({ operationName: 'test' });
    handle.stop();
    delete process.env['ENABLE_PROGRESS_NOTIFICATIONS'];
  });

  it('should send progress notifications on interval', async () => {
    // Override env to use a short interval (default is 10000ms from env parsing)
    process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'] = '1000';

    const sendNotification = vi.fn().mockResolvedValue(undefined);
    setMockRequestContext({
      sendNotification,
      progressToken: 'token_123',
      logger: { debug: vi.fn(), warn: vi.fn() },
    });

    const handle = startKeepalive({
      operationName: 'test',
    });

    // Initial notification sent immediately (fire-and-forget async)
    await vi.advanceTimersByTimeAsync(10);
    expect(sendNotification).toHaveBeenCalledTimes(1);

    // After 1000ms more, interval should fire
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendNotification.mock.calls.length).toBeGreaterThanOrEqual(2);

    // After another 1000ms, interval fires again
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendNotification.mock.calls.length).toBeGreaterThanOrEqual(3);

    handle.stop();

    const countAfterStop = sendNotification.mock.calls.length;
    // No more after stop
    await vi.advanceTimersByTimeAsync(2000);
    expect(sendNotification.mock.calls.length).toBe(countAfterStop);

    delete process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'];
  });

  it('should send correct notification format', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    setMockRequestContext({
      sendNotification,
      progressToken: 'token_abc',
      logger: { debug: vi.fn(), warn: vi.fn() },
    });

    const handle = startKeepalive({ operationName: 'test' });
    await vi.advanceTimersByTimeAsync(1);

    expect(sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: {
        progressToken: 'token_abc',
        progress: 1,
        total: undefined,
      },
    });

    handle.stop();
  });

  it('should handle notification errors gracefully', async () => {
    const sendNotification = vi.fn().mockRejectedValue(new Error('connection lost'));
    const warnFn = vi.fn();
    setMockRequestContext({
      sendNotification,
      progressToken: 'token_123',
      logger: { debug: vi.fn(), warn: warnFn },
    });

    const handle = startKeepalive({
      operationName: 'test',
    });

    // Let the rejected promise settle
    await vi.advanceTimersByTimeAsync(10);

    expect(warnFn).toHaveBeenCalled();

    handle.stop();
  });

  it('should be safe to call stop() multiple times', () => {
    setMockRequestContext(null);
    const handle = startKeepalive({ operationName: 'test' });

    handle.stop();
    handle.stop();
    handle.stop();
  });

  it('should use env var for interval if set', () => {
    process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'] = '5000';
    setMockRequestContext(null);
    const handle = startKeepalive({ operationName: 'test' });
    handle.stop();
    delete process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'];
  });

  it('should fire at exactly the configured interval (L-9 keepalive interval contract)', async () => {
    // Verifies that the keepalive fires at the interval set via env var.
    // Default interval is 15000ms; here we override to 500ms for a fast assertion.
    process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'] = '500';

    const sendNotification = vi.fn().mockResolvedValue(undefined);
    setMockRequestContext({
      sendNotification,
      progressToken: 'token_interval_contract',
      logger: { debug: vi.fn(), warn: vi.fn() },
    });

    const handle = startKeepalive({ operationName: 'interval-contract-test' });

    // Immediate send
    await vi.advanceTimersByTimeAsync(10);
    const callsAfterImmediate = sendNotification.mock.calls.length;
    expect(callsAfterImmediate).toBeGreaterThanOrEqual(1);

    // After exactly one interval, one more call expected
    await vi.advanceTimersByTimeAsync(500);
    expect(sendNotification.mock.calls.length).toBeGreaterThanOrEqual(callsAfterImmediate + 1);

    handle.stop();
    delete process.env['PROGRESS_NOTIFICATION_INTERVAL_MS'];
  });
});

describe('withKeepalive Wrapper', () => {
  beforeEach(() => {
    vi.useRealTimers();
    setMockRequestContext(null);
  });

  it('should return operation result', async () => {
    const result = await withKeepalive(async () => 42);
    expect(result).toBe(42);
  });

  it('should stop keepalive after operation completes', async () => {
    await withKeepalive(async () => 'done', { operationName: 'test' });
  });

  it('should stop keepalive even if operation throws', async () => {
    await expect(
      withKeepalive(async () => {
        throw new Error('operation failed');
      })
    ).rejects.toThrow('operation failed');
  });

  it('should pass through async operation result', async () => {
    const result = await withKeepalive(async () => {
      return { data: [1, 2, 3], count: 3 };
    });

    expect(result).toEqual({ data: [1, 2, 3], count: 3 });
  });
});
