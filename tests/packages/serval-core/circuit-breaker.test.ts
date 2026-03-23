/**
 * @serval/core — CircuitBreaker
 *
 * Verifies state transitions (closed → open → half_open → closed) and
 * fallback strategy execution.
 *
 * ISSUE-075 (#38): Required for v0.2.0 npm publish readiness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Prevent prom-client double-registration errors when running alongside other tests
vi.mock('../../../packages/serval-core/src/observability/metrics.js', () => ({
  recordCircuitBreakerTransition: vi.fn(),
  updateCircuitBreakerMetric: vi.fn(),
  recordRateLimitHit: vi.fn(),
  recordRetryAttempt: vi.fn(),
  recordHttp2Error: vi.fn(),
}));

import {
  CircuitBreaker,
  CircuitBreakerError,
} from '../../../packages/serval-core/src/safety/circuit-breaker.js';

function makeBreaker(overrides?: { failureThreshold?: number; timeout?: number }) {
  return new CircuitBreaker({
    failureThreshold: overrides?.failureThreshold ?? 3,
    successThreshold: 2,
    timeout: overrides?.timeout ?? 100, // 100ms for fast tests
    name: 'test-breaker',
  });
}

describe('@serval/core — CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = makeBreaker();
    vi.useFakeTimers();
  });

  it('starts in closed state', () => {
    expect(cb.getStats().state).toBe('closed');
  });

  it('passes through successful operations in closed state', async () => {
    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getStats().state).toBe('closed');
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const fail = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }

    expect(cb.getStats().state).toBe('open');
    expect(cb.getStats().failureCount).toBe(3);
  });

  it('throws CircuitBreakerError when open', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }

    await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitBreakerError);
  });

  it('transitions to half_open after timeout (lazy — triggered by execute)', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }
    expect(cb.getStats().state).toBe('open');

    // Advance past the timeout (including jitter headroom: timeout * 1.5)
    vi.advanceTimersByTime(200);

    // The half_open transition is lazy — triggered on next execute() call
    await cb.execute(async () => 'probe').catch(() => {});
    // After a successful probe, state moves toward closed (successThreshold=2)
    // but after one success in half_open state should be half_open or closed
    const state = cb.getStats().state;
    expect(['half_open', 'closed']).toContain(state);
  });

  it('recovers to closed after successThreshold successes in half_open', async () => {
    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }
    vi.advanceTimersByTime(200);

    // First execute() triggers half_open + first success
    await cb.execute(async () => 'ok1');
    // Second success closes the breaker (successThreshold=2)
    await cb.execute(async () => 'ok2');

    expect(cb.getStats().state).toBe('closed');
    expect(cb.getStats().failureCount).toBe(0);
  });

  it('returns to open after failureThreshold failures in half_open', async () => {
    const fail = async () => { throw new Error('fail'); };
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }
    vi.advanceTimersByTime(200);

    // First execute() transitions to half_open (failureCount reset to 0)
    // Then failureThreshold more failures go back to open
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
      vi.advanceTimersByTime(200); // advance timeout between probes
    }
    expect(cb.getStats().state).toBe('open');
  });

  it('tracks totalRequests correctly', async () => {
    await cb.execute(async () => 'a');
    await cb.execute(async () => 'b');
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});

    expect(cb.getStats().totalRequests).toBe(3);
  });

  it('executes fallback strategy when circuit is open', async () => {
    cb.registerFallback({
      name: 'cached-fallback',
      execute: async () => 'cached',
      shouldUse: () => true,
    });

    const fail = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await cb.execute(fail).catch(() => {});
    }

    const result = await cb.execute(async () => 'live');
    expect(result).toBe('cached');
  });
});
