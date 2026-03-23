/**
 * Circuit Breaker Registry Service Tests (Phase 3.10)
 *
 * Tests for CircuitBreakerRegistry service
 * Covers circuit breaker registration, retrieval, and statistics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  circuitBreakerRegistry,
  type CircuitBreakerEntry,
} from '../../src/services/circuit-breaker-registry.js';
import { CircuitBreaker } from '../../src/utils/circuit-breaker.js';

describe('CircuitBreakerRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    circuitBreakerRegistry.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    circuitBreakerRegistry.clear();
  });

  describe('register', () => {
    it('should register a circuit breaker', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
        name: 'test-breaker',
      });

      circuitBreakerRegistry.register('test-breaker', breaker);

      const registered = circuitBreakerRegistry.get('test-breaker');
      expect(registered).toBeDefined();
      expect(registered?.name).toBe('test-breaker');
      expect(registered?.breaker).toBe(breaker);
    });

    it('should register circuit breaker with description', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('api-breaker', breaker, 'Protects Google Sheets API calls');

      const registered = circuitBreakerRegistry.get('api-breaker');
      expect(registered?.description).toBe('Protects Google Sheets API calls');
    });

    it('should overwrite existing circuit breaker with same name', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('test', breaker1, 'First');
      circuitBreakerRegistry.register('test', breaker2, 'Second');

      const registered = circuitBreakerRegistry.get('test');
      expect(registered?.breaker).toBe(breaker2);
      expect(registered?.description).toBe('Second');
    });

    it('should register multiple circuit breakers', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.register('breaker-2', breaker2);

      const all = circuitBreakerRegistry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.name)).toContain('breaker-1');
      expect(all.map((e) => e.name)).toContain('breaker-2');
    });
  });

  describe('unregister', () => {
    it('should unregister a circuit breaker', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      circuitBreakerRegistry.register('test-breaker', breaker);
      expect(circuitBreakerRegistry.get('test-breaker')).toBeDefined();

      circuitBreakerRegistry.unregister('test-breaker');
      expect(circuitBreakerRegistry.get('test-breaker')).toBeUndefined();
    });

    it('should handle unregistering non-existent circuit breaker', () => {
      expect(() => {
        circuitBreakerRegistry.unregister('nonexistent');
      }).not.toThrow();

      expect(circuitBreakerRegistry.get('nonexistent')).toBeUndefined();
    });

    it('should not affect other circuit breakers when unregistering', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.register('breaker-2', breaker2);

      circuitBreakerRegistry.unregister('breaker-1');

      expect(circuitBreakerRegistry.get('breaker-1')).toBeUndefined();
      expect(circuitBreakerRegistry.get('breaker-2')).toBeDefined();
    });
  });

  describe('get', () => {
    it('should get registered circuit breaker by name', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
        name: 'api-breaker',
      });

      circuitBreakerRegistry.register('api-breaker', breaker, 'API protection');

      const entry = circuitBreakerRegistry.get('api-breaker');

      expect(entry).toBeDefined();
      expect(entry?.name).toBe('api-breaker');
      expect(entry?.breaker).toBe(breaker);
      expect(entry?.description).toBe('API protection');
    });

    it('should return undefined for non-existent circuit breaker', () => {
      const entry = circuitBreakerRegistry.get('nonexistent');

      expect(entry).toBeUndefined();
    });

    it('should return correct breaker after multiple operations', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('test', breaker1);
      circuitBreakerRegistry.register('test', breaker2);

      const entry = circuitBreakerRegistry.get('test');
      expect(entry?.breaker).toBe(breaker2);
    });
  });

  describe('getAll', () => {
    it('should return empty array when no circuit breakers registered', () => {
      const all = circuitBreakerRegistry.getAll();

      expect(Array.isArray(all)).toBe(true);
      expect(all).toHaveLength(0);
    });

    it('should return all registered circuit breakers', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      const breaker3 = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 20000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1, 'First');
      circuitBreakerRegistry.register('breaker-2', breaker2, 'Second');
      circuitBreakerRegistry.register('breaker-3', breaker3, 'Third');

      const all = circuitBreakerRegistry.getAll();

      expect(all).toHaveLength(3);
      expect(all.map((e) => e.name)).toContain('breaker-1');
      expect(all.map((e) => e.name)).toContain('breaker-2');
      expect(all.map((e) => e.name)).toContain('breaker-3');
    });

    it('should return entries with all properties', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
        name: 'test',
      });

      circuitBreakerRegistry.register('test-breaker', breaker, 'Test description');

      const all = circuitBreakerRegistry.getAll();

      expect(all[0]).toMatchObject({
        name: 'test-breaker',
        breaker: expect.any(Object),
        description: 'Test description',
      });
    });

    it('should not include unregistered circuit breakers', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.register('breaker-2', breaker2);
      circuitBreakerRegistry.unregister('breaker-1');

      const all = circuitBreakerRegistry.getAll();

      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('breaker-2');
    });
  });

  describe('getAllStats', () => {
    it('should return empty object when no circuit breakers registered', () => {
      const stats = circuitBreakerRegistry.getAllStats();

      expect(typeof stats).toBe('object');
      expect(Object.keys(stats)).toHaveLength(0);
    });

    it('should return statistics for all registered circuit breakers', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
        name: 'breaker-1',
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
        name: 'breaker-2',
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.register('breaker-2', breaker2);

      const stats = circuitBreakerRegistry.getAllStats();

      expect(Object.keys(stats)).toHaveLength(2);
      expect(stats['breaker-1']).toBeDefined();
      expect(stats['breaker-2']).toBeDefined();
    });

    it('should include circuit breaker state in statistics', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      circuitBreakerRegistry.register('test-breaker', breaker);

      const stats = circuitBreakerRegistry.getAllStats();

      expect(stats['test-breaker']).toMatchObject({
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        totalRequests: 0,
      });
    });

    it('should reflect circuit breaker state changes', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 1000,
      });

      circuitBreakerRegistry.register('test-breaker', breaker);

      // Trigger failures to open circuit
      const failingOperation = async () => {
        throw new Error('Test failure');
      };

      try {
        await breaker.execute(failingOperation);
      } catch {
        // Expected
      }
      try {
        await breaker.execute(failingOperation);
      } catch {
        // Expected
      }

      const stats = circuitBreakerRegistry.getAllStats();
      const breakerStats = stats['test-breaker'] as { state: string; totalRequests: number };

      expect(breakerStats.state).toBe('open');
      expect(breakerStats.totalRequests).toBe(2);
    });

    it('should not include unregistered circuit breakers in stats', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.register('breaker-2', breaker2);
      circuitBreakerRegistry.unregister('breaker-1');

      const stats = circuitBreakerRegistry.getAllStats();

      expect(Object.keys(stats)).toHaveLength(1);
      expect(stats['breaker-1']).toBeUndefined();
      expect(stats['breaker-2']).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all registered circuit breakers', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.register('breaker-2', breaker2);

      circuitBreakerRegistry.clear();

      const all = circuitBreakerRegistry.getAll();
      expect(all).toHaveLength(0);
    });

    it('should handle clearing empty registry', () => {
      expect(() => {
        circuitBreakerRegistry.clear();
      }).not.toThrow();

      const all = circuitBreakerRegistry.getAll();
      expect(all).toHaveLength(0);
    });

    it('should allow new registrations after clear', () => {
      const breaker1 = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      circuitBreakerRegistry.register('breaker-1', breaker1);
      circuitBreakerRegistry.clear();

      const breaker2 = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 30000,
      });

      circuitBreakerRegistry.register('breaker-2', breaker2);

      const all = circuitBreakerRegistry.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('breaker-2');
    });

    it('should clear statistics after clear', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      circuitBreakerRegistry.register('test-breaker', breaker);
      circuitBreakerRegistry.clear();

      const stats = circuitBreakerRegistry.getAllStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });
  });

  describe('integration scenarios', () => {
    it('should manage multiple circuit breakers independently', async () => {
      const apiBreaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 1000,
        name: 'api',
      });

      const dbBreaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 2000,
        name: 'database',
      });

      circuitBreakerRegistry.register('api', apiBreaker, 'API circuit breaker');
      circuitBreakerRegistry.register('db', dbBreaker, 'Database circuit breaker');

      // Fail API breaker
      const failOp = async () => {
        throw new Error('Fail');
      };
      try {
        await apiBreaker.execute(failOp);
      } catch {
        // Expected
      }
      try {
        await apiBreaker.execute(failOp);
      } catch {
        // Expected
      }

      const stats = circuitBreakerRegistry.getAllStats();

      const apiStats = stats['api'] as { state: string };
      const dbStats = stats['db'] as { state: string };

      expect(apiStats.state).toBe('open');
      expect(dbStats.state).toBe('closed');
    });

    it('should support lifecycle of register, use, unregister', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      // Register
      circuitBreakerRegistry.register('lifecycle-test', breaker);
      expect(circuitBreakerRegistry.get('lifecycle-test')).toBeDefined();

      // Use
      const successOp = async () => 'success';
      const result = await breaker.execute(successOp);
      expect(result).toBe('success');

      const stats = circuitBreakerRegistry.getAllStats();
      const breakerStats = stats['lifecycle-test'] as { totalRequests: number };
      expect(breakerStats.totalRequests).toBe(1);

      // Unregister
      circuitBreakerRegistry.unregister('lifecycle-test');
      expect(circuitBreakerRegistry.get('lifecycle-test')).toBeUndefined();
    });

    it('should handle rapid registration and unregistration', () => {
      for (let i = 0; i < 10; i++) {
        const breaker = new CircuitBreaker({
          failureThreshold: 5,
          successThreshold: 2,
          timeout: 60000,
        });

        circuitBreakerRegistry.register(`breaker-${i}`, breaker);
      }

      expect(circuitBreakerRegistry.getAll()).toHaveLength(10);

      for (let i = 0; i < 10; i++) {
        circuitBreakerRegistry.unregister(`breaker-${i}`);
      }

      expect(circuitBreakerRegistry.getAll()).toHaveLength(0);
    });

    it('should aggregate statistics from multiple circuit breakers', async () => {
      const breakers = Array.from(
        { length: 5 },
        (_, i) =>
          new CircuitBreaker({
            failureThreshold: 5,
            successThreshold: 2,
            timeout: 60000,
            name: `breaker-${i}`,
          })
      );

      breakers.forEach((breaker, i) => {
        circuitBreakerRegistry.register(`breaker-${i}`, breaker);
      });

      // Execute operations on some breakers
      const successOp = async () => 'success';
      await breakers[0].execute(successOp);
      await breakers[2].execute(successOp);
      await breakers[4].execute(successOp);

      const stats = circuitBreakerRegistry.getAllStats();

      expect(Object.keys(stats)).toHaveLength(5);

      const stats0 = stats['breaker-0'] as { totalRequests: number };
      const stats1 = stats['breaker-1'] as { totalRequests: number };
      const stats2 = stats['breaker-2'] as { totalRequests: number };

      expect(stats0.totalRequests).toBe(1);
      expect(stats1.totalRequests).toBe(0);
      expect(stats2.totalRequests).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle circuit breaker without name in config', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      circuitBreakerRegistry.register('custom-name', breaker);

      const entry = circuitBreakerRegistry.get('custom-name');
      expect(entry).toBeDefined();
      expect(entry?.name).toBe('custom-name');
    });

    it('should handle circuit breaker with empty description', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      circuitBreakerRegistry.register('test', breaker, '');

      const entry = circuitBreakerRegistry.get('test');
      expect(entry?.description).toBe('');
    });

    it('should handle special characters in circuit breaker name', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const specialName = 'test-breaker:api/v1#main';
      circuitBreakerRegistry.register(specialName, breaker);

      const entry = circuitBreakerRegistry.get(specialName);
      expect(entry).toBeDefined();
      expect(entry?.name).toBe(specialName);
    });

    it('should handle very long circuit breaker names', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
      });

      const longName = 'a'.repeat(1000);
      circuitBreakerRegistry.register(longName, breaker);

      const entry = circuitBreakerRegistry.get(longName);
      expect(entry).toBeDefined();
    });

    it('should handle registry with many circuit breakers', () => {
      const count = 100;

      for (let i = 0; i < count; i++) {
        const breaker = new CircuitBreaker({
          failureThreshold: 5,
          successThreshold: 2,
          timeout: 60000,
        });
        circuitBreakerRegistry.register(`breaker-${i}`, breaker);
      }

      const all = circuitBreakerRegistry.getAll();
      expect(all).toHaveLength(count);

      const stats = circuitBreakerRegistry.getAllStats();
      expect(Object.keys(stats)).toHaveLength(count);
    });
  });
});
