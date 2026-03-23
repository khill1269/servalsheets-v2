/**
 * DI Container Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Container, type ServiceLifecycle } from '../../src/di/container.js';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register', () => {
    it('should register a service', () => {
      container.register('test', {
        lifecycle: 'singleton',
        factory: () => ({ value: 42 }),
      });
      expect(container.has('test')).toBe(true);
    });

    it('should throw if service already registered', () => {
      container.register('test', {
        lifecycle: 'singleton',
        factory: () => ({ value: 42 }),
      });
      expect(() =>
        container.register('test', {
          lifecycle: 'singleton',
          factory: () => ({ value: 43 }),
        })
      ).toThrow('Service "test" is already registered');
    });

    it('should register service with dependencies', () => {
      container.register('dep', {
        lifecycle: 'singleton',
        factory: () => ({ value: 1 }),
      });
      container.register('service', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 2 }),
        dependencies: ['dep'],
      });
      expect(container.has('service')).toBe(true);
    });
  });

  describe('resolve', () => {
    it('should resolve a service', async () => {
      container.register('test', {
        lifecycle: 'singleton',
        factory: () => ({ value: 42 }),
      });
      const service = await container.resolve<{ value: number }>('test');
      expect(service.value).toBe(42);
    });

    it('should throw if service not registered', async () => {
      await expect(container.resolve('unknown')).rejects.toThrow(
        'service not found: unknown'
      );
    });

    it('should resolve dependencies', async () => {
      container.register('dep', {
        lifecycle: 'singleton',
        factory: () => ({ value: 1 }),
      });
      container.register('service', {
        lifecycle: 'singleton',
        factory: async (c) => {
          const dep = await c.resolve<{ value: number }>('dep');
          return { value: dep.value * 2 };
        },
        dependencies: ['dep'],
      });

      const service = await container.resolve<{ value: number }>('service');
      expect(service.value).toBe(2);
    });

    it('should cache singleton instances', async () => {
      let callCount = 0;
      container.register('test', {
        lifecycle: 'singleton',
        factory: () => {
          callCount++;
          return { value: 42 };
        },
      });

      await container.resolve('test');
      await container.resolve('test');

      expect(callCount).toBe(1);
    });

    it('should not cache transient instances', async () => {
      let callCount = 0;
      container.register('test', {
        lifecycle: 'transient',
        factory: () => {
          callCount++;
          return { value: 42 };
        },
      });

      await container.resolve('test');
      await container.resolve('test');

      expect(callCount).toBe(2);
    });

    it('should detect circular dependencies', async () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: (c) => c.resolve('b'),
        dependencies: ['b'],
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: (c) => c.resolve('a'),
        dependencies: ['a'],
      });

      await expect(container.resolve('a')).rejects.toThrow('Circular dependency detected');
    });

    it('should handle async factories', async () => {
      container.register('test', {
        lifecycle: 'singleton',
        factory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { value: 42 };
        },
      });

      const service = await container.resolve<{ value: number }>('test');
      expect(service.value).toBe(42);
    });
  });

  describe('validateDependencies', () => {
    it('should validate valid dependencies', () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: () => ({ value: 1 }),
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 2 }),
        dependencies: ['a'],
      });

      const result = container.validateDependencies();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect circular dependencies', () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 1 }),
        dependencies: ['b'],
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 2 }),
        dependencies: ['a'],
      });

      const result = container.validateDependencies();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Circular dependency');
    });

    it('should detect missing dependencies', () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 1 }),
        dependencies: ['missing'],
      });

      const result = container.validateDependencies();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('unregistered service');
    });
  });

  describe('getMetrics', () => {
    it('should track metrics', async () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: () => ({ value: 1 }),
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: () => ({ value: 2 }),
      });

      await container.resolve('a');
      await container.resolve('b');

      const metrics = container.getMetrics();
      expect(metrics.totalRegistered).toBe(2);
      expect(metrics.singletonsCached).toBe(2);
      expect(metrics.resolutionCount).toBe(2);
      expect(metrics.failedResolutions).toBe(0);
      expect(metrics.avgResolutionTimeMs).toBeGreaterThan(0);
    });

    it('should track failed resolutions', async () => {
      container.register('failing', {
        lifecycle: 'singleton',
        factory: () => {
          throw new Error('Init failed');
        },
      });

      await expect(container.resolve('failing')).rejects.toThrow();

      const metrics = container.getMetrics();
      expect(metrics.failedResolutions).toBe(1);
    });
  });

  describe('initializeAll', () => {
    it('should initialize all singletons', async () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: () => ({ value: 1 }),
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: () => ({ value: 2 }),
      });
      container.register('c', {
        lifecycle: 'transient',
        factory: () => ({ value: 3 }),
      });

      await container.initializeAll();

      const metrics = container.getMetrics();
      expect(metrics.singletonsCached).toBe(2); // Only singletons
    });

    it('should fail if validation fails', async () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 1 }),
        dependencies: ['b'],
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: (c) => ({ value: 2 }),
        dependencies: ['a'],
      });

      await expect(container.initializeAll()).rejects.toThrow('validation failed');
    });
  });

  describe('clear', () => {
    it('should clear all services', () => {
      container.register('a', {
        lifecycle: 'singleton',
        factory: () => ({ value: 1 }),
      });
      container.register('b', {
        lifecycle: 'singleton',
        factory: () => ({ value: 2 }),
      });

      container.clear();

      expect(container.getServiceNames()).toHaveLength(0);
      const metrics = container.getMetrics();
      expect(metrics.totalRegistered).toBe(0);
    });
  });

  describe('lifecycle behaviors', () => {
    it('should support singleton lifecycle', async () => {
      const instances: unknown[] = [];
      container.register('singleton', {
        lifecycle: 'singleton',
        factory: () => {
          const instance = { id: Math.random() };
          instances.push(instance);
          return instance;
        },
      });

      const first = await container.resolve('singleton');
      const second = await container.resolve('singleton');

      expect(first).toBe(second);
      expect(instances).toHaveLength(1);
    });

    it('should support transient lifecycle', async () => {
      const instances: unknown[] = [];
      container.register('transient', {
        lifecycle: 'transient',
        factory: () => {
          const instance = { id: Math.random() };
          instances.push(instance);
          return instance;
        },
      });

      const first = await container.resolve('transient');
      const second = await container.resolve('transient');

      expect(first).not.toBe(second);
      expect(instances).toHaveLength(2);
    });
  });
});
