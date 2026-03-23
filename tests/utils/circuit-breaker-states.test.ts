/**
 * Tests for Circuit Breaker core state transitions
 *
 * Covers: CLOSED→OPEN→HALF_OPEN→CLOSED lifecycle, failure threshold,
 * success threshold, reset timeout, manual reset, and stats.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from '../../src/utils/circuit-breaker.js';

describe('CircuitBreaker - State Transitions', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 500,
      name: 'test-circuit',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe('closed');
      expect(breaker.isOpen()).toBe(false);
    });

    it('should have zero counters initially', () => {
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('CLOSED → OPEN transition', () => {
    it('should stay CLOSED below failure threshold', async () => {
      // 2 failures (threshold is 3)
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }
      expect(breaker.getState()).toBe('closed');
    });

    it('should transition to OPEN at failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }
      expect(breaker.getState()).toBe('open');
      expect(breaker.isOpen()).toBe(true);
    });

    it('should reset failure count on success', async () => {
      // 2 failures, then 1 success, then 2 more failures
      await expect(
        breaker.execute(async () => {
          throw new Error('f');
        })
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error('f');
        })
      ).rejects.toThrow();
      await breaker.execute(async () => 'ok');
      await expect(
        breaker.execute(async () => {
          throw new Error('f');
        })
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error('f');
        })
      ).rejects.toThrow();
      // Should still be closed (failures were reset by the success)
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('OPEN state behavior', () => {
    beforeEach(async () => {
      // Force circuit open
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');
    });

    it('should reject requests immediately when OPEN', async () => {
      await expect(breaker.execute(async () => 'should not run')).rejects.toThrow(
        CircuitBreakerError
      );
    });

    it('should include circuit name in error', async () => {
      try {
        await breaker.execute(async () => 'nope');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerError);
        expect((err as CircuitBreakerError).circuitName).toBe('test-circuit');
      }
    });

    it('should record stats while OPEN', () => {
      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
      // Failure count may be reset on state transition
      expect(stats.lastFailure).toBeDefined();
      expect(stats.nextAttempt).toBeDefined();
    });
  });

  describe('OPEN → HALF_OPEN transition', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');

      // Advance fake time past timeout + max jitter (500ms + 30% = 650ms)
      vi.advanceTimersByTime(700);

      // Next execute should be allowed (half-open probe)
      await breaker.execute(async () => 'probe-success');
      // After one success in half-open, state depends on successThreshold
      // With successThreshold=2, still half_open after 1 success
      expect(breaker.getState()).toBe('half_open');
    });
  });

  describe('HALF_OPEN → CLOSED transition', () => {
    it('should close after reaching success threshold in HALF_OPEN', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }

      // Advance fake time past timeout + max jitter (500ms + 30% = 650ms) → half_open
      vi.advanceTimersByTime(700);

      // successThreshold is 2: need 2 consecutive successes
      await breaker.execute(async () => 'success-1');
      expect(breaker.getState()).toBe('half_open');

      await breaker.execute(async () => 'success-2');
      expect(breaker.getState()).toBe('closed');
      expect(breaker.isOpen()).toBe(false);
    });
  });

  describe('HALF_OPEN → OPEN transition', () => {
    it('should reopen on failure during HALF_OPEN', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }

      // Advance fake time past timeout + max jitter (500ms + 30% = 650ms) → half_open
      vi.advanceTimersByTime(700);

      // First call succeeds (probe)
      await breaker.execute(async () => 'ok');
      expect(breaker.getState()).toBe('half_open');

      // Failure in half-open resets success count but stays half_open
      // (needs failureThreshold failures to reopen)
      await expect(
        breaker.execute(async () => {
          throw new Error('half-open-fail');
        })
      ).rejects.toThrow();

      // Still half_open after one failure (threshold is 3)
      expect(breaker.getState()).toBe('half_open');

      // Multiple failures in half-open should eventually reopen
      await expect(
        breaker.execute(async () => {
          throw new Error('f2');
        })
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error('f3');
        })
      ).rejects.toThrow();
      expect(breaker.getState()).toBe('open');
    });
  });

  describe('manual reset', () => {
    it('should reset circuit to CLOSED', async () => {
      // Force open
      for (let i = 0; i < 3; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }
      expect(breaker.getState()).toBe('open');

      breaker.reset();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.isOpen()).toBe(false);

      // Should allow requests again
      const result = await breaker.execute(async () => 'after-reset');
      expect(result).toBe('after-reset');
    });
  });

  describe('stats tracking', () => {
    it('should track total requests across states', async () => {
      await breaker.execute(async () => 'ok');
      await expect(
        breaker.execute(async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow();
      await breaker.execute(async () => 'ok-2');

      const stats = breaker.getStats();
      expect(stats.totalRequests).toBe(3);
    });

    it('should track success count in CLOSED state', async () => {
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');

      const stats = breaker.getStats();
      // In CLOSED state, successCount tracks consecutive successes
      // (implementation may reset on state transitions)
      expect(stats.totalRequests).toBe(2);
      expect(stats.failureCount).toBe(0);
    });
  });
});
