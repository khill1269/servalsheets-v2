/**
 * Tests for Resource Cleanup Registry (Phase 1: Memory Leak Detection)
 *
 * Validates that timers and resources are properly cleaned up to prevent memory leaks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerCleanup,
  unregisterCleanup,
  cleanupAllResources,
  getCleanupStats,
  resetCleanupRegistry,
} from '../../src/utils/resource-cleanup.js';

describe('Resource Cleanup Registry', () => {
  beforeEach(() => {
    resetCleanupRegistry();
  });

  afterEach(() => {
    resetCleanupRegistry();
  });

  describe('registerCleanup', () => {
    it('should register a cleanup function', () => {
      registerCleanup('TestService', () => {});

      const stats = getCleanupStats();
      expect(stats.services).toBe(1);
      expect(stats.totalResources).toBe(1);
      expect(stats.resourcesByService['TestService']).toBe(1);
    });

    it('should register multiple cleanup functions for same service', () => {
      registerCleanup('TestService', () => {}, 'resource1');
      registerCleanup('TestService', () => {}, 'resource2');

      const stats = getCleanupStats();
      expect(stats.services).toBe(1);
      expect(stats.totalResources).toBe(2);
      expect(stats.resourcesByService['TestService']).toBe(2);
    });

    it('should register cleanup functions for different services', () => {
      registerCleanup('Service1', () => {});
      registerCleanup('Service2', () => {});
      registerCleanup('Service3', () => {});

      const stats = getCleanupStats();
      expect(stats.services).toBe(3);
      expect(stats.totalResources).toBe(3);
    });

    it('should support optional resource names', () => {
      registerCleanup('TestService', () => {}); // No name
      registerCleanup('TestService', () => {}, 'named-resource');

      const stats = getCleanupStats();
      expect(stats.totalResources).toBe(2);
    });
  });

  describe('unregisterCleanup', () => {
    it('should unregister all cleanup functions for a service', () => {
      registerCleanup('TestService', () => {});
      registerCleanup('TestService', () => {});

      unregisterCleanup('TestService');

      const stats = getCleanupStats();
      expect(stats.services).toBe(0);
      expect(stats.totalResources).toBe(0);
    });

    it('should not affect other services', () => {
      registerCleanup('Service1', () => {});
      registerCleanup('Service2', () => {});

      unregisterCleanup('Service1');

      const stats = getCleanupStats();
      expect(stats.services).toBe(1);
      expect(stats.resourcesByService['Service2']).toBe(1);
    });
  });

  describe('cleanupAllResources', () => {
    it('should call all registered cleanup functions', async () => {
      const cleanedUp: string[] = [];

      registerCleanup('Service1', () => {
        cleanedUp.push('service1-cleanup1');
      });
      registerCleanup('Service1', () => {
        cleanedUp.push('service1-cleanup2');
      });
      registerCleanup('Service2', () => {
        cleanedUp.push('service2-cleanup');
      });

      const result = await cleanupAllResources();

      expect(result.total).toBe(3);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(cleanedUp).toHaveLength(3);
      expect(cleanedUp).toContain('service1-cleanup1');
      expect(cleanedUp).toContain('service1-cleanup2');
      expect(cleanedUp).toContain('service2-cleanup');
    });

    it('should handle async cleanup functions', async () => {
      const cleanedUp: string[] = [];

      registerCleanup('Service1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        cleanedUp.push('async-cleanup');
      });

      const result = await cleanupAllResources();

      expect(result.successful).toBe(1);
      expect(cleanedUp).toEqual(['async-cleanup']);
    });

    it('should clean up in LIFO order (reverse registration)', async () => {
      const order: string[] = [];

      registerCleanup('Service1', () => order.push('first'));
      registerCleanup('Service1', () => order.push('second'));
      registerCleanup('Service1', () => order.push('third'));

      await cleanupAllResources();

      // Should clean up in reverse order: third, second, first
      expect(order).toEqual(['third', 'second', 'first']);
    });

    it('should handle cleanup errors gracefully', async () => {
      registerCleanup('Service1', () => {
        throw new Error('Cleanup failed');
      });
      registerCleanup('Service2', () => {
        // This should still run despite Service1 failing
      });

      const result = await cleanupAllResources();

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].service).toBe('Service1');
      expect(result.errors[0].error).toBe('Cleanup failed');
    });

    it('should report all errors when multiple cleanups fail', async () => {
      registerCleanup('Service1', () => {
        throw new Error('Error 1');
      });
      registerCleanup('Service2', () => {
        throw new Error('Error 2');
      });
      registerCleanup('Service3', () => {
        // This should succeed
      });

      const result = await cleanupAllResources();

      expect(result.total).toBe(3);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('getCleanupStats', () => {
    it('should return empty stats initially', () => {
      const stats = getCleanupStats();

      expect(stats.services).toBe(0);
      expect(stats.totalResources).toBe(0);
      expect(stats.resourcesByService).toEqual({});
    });

    it('should track resources per service', () => {
      registerCleanup('ServiceA', () => {});
      registerCleanup('ServiceA', () => {});
      registerCleanup('ServiceB', () => {});

      const stats = getCleanupStats();

      expect(stats.services).toBe(2);
      expect(stats.totalResources).toBe(3);
      expect(stats.resourcesByService['ServiceA']).toBe(2);
      expect(stats.resourcesByService['ServiceB']).toBe(1);
    });
  });

  describe('resetCleanupRegistry', () => {
    it('should clear all registered cleanups', () => {
      registerCleanup('Service1', () => {});
      registerCleanup('Service2', () => {});

      resetCleanupRegistry();

      const stats = getCleanupStats();
      expect(stats.services).toBe(0);
      expect(stats.totalResources).toBe(0);
    });
  });

  describe('Real-world timer cleanup', () => {
    it('should clean up setInterval timers', async () => {
      let counter = 0;
      const interval = setInterval(() => {
        counter++;
      }, 10);

      registerCleanup('TimerTest', () => clearInterval(interval));

      // Let timer run a bit
      await new Promise((resolve) => setTimeout(resolve, 50));
      const countBeforeCleanup = counter;
      expect(countBeforeCleanup).toBeGreaterThan(0);

      // Clean up
      await cleanupAllResources();

      // Wait and verify timer stopped
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(counter).toBe(countBeforeCleanup); // Should not have incremented
    });

    it('should clean up multiple timers', async () => {
      const timers: NodeJS.Timeout[] = [];

      for (let i = 0; i < 5; i++) {
        const interval = setInterval(() => {}, 100);
        timers.push(interval);
        registerCleanup('MultiTimer', () => clearInterval(interval), `timer-${i}`);
      }

      const result = await cleanupAllResources();

      expect(result.total).toBe(5);
      expect(result.successful).toBe(5);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle cleanup of service with multiple resource types', async () => {
      const cleanedResources: string[] = [];

      // Simulate service with cache, connection, and timer
      registerCleanup(
        'ComplexService',
        () => {
          cleanedResources.push('cache');
        },
        'cache-cleanup'
      );

      registerCleanup(
        'ComplexService',
        () => {
          cleanedResources.push('connection');
        },
        'connection-cleanup'
      );

      registerCleanup(
        'ComplexService',
        () => {
          cleanedResources.push('timer');
        },
        'timer-cleanup'
      );

      const result = await cleanupAllResources();

      expect(result.successful).toBe(3);
      expect(cleanedResources).toHaveLength(3);
      expect(cleanedResources).toContain('cache');
      expect(cleanedResources).toContain('connection');
      expect(cleanedResources).toContain('timer');
    });

    it('should cleanup services in reverse dependency order', async () => {
      const order: string[] = [];

      // Service B depends on Service A
      registerCleanup('ServiceA', () => order.push('A'));
      registerCleanup('ServiceB', () => order.push('B'));

      await cleanupAllResources();

      // Last registered (B) should clean up first
      expect(order[0]).toBe('B');
      expect(order[1]).toBe('A');
    });
  });
});
