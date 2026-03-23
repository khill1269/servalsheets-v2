/**
 * Tests for Metrics Service
 *
 * Tests operation metrics, cache metrics, API metrics, and system metrics.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MetricsService,
  getMetricsService,
  setMetricsService,
  resetMetricsService,
} from '../../src/services/metrics.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const svc = new MetricsService();
      expect(svc).toBeDefined();
    });

    it('should accept windowSize option', () => {
      const svc = new MetricsService({ windowSize: 500 });
      expect(svc).toBeDefined();
    });
  });

  describe('recordOperation', () => {
    it('should record successful operation', () => {
      service.recordOperation('sheets_data.read', 100, true);

      const metrics = service.getOperationMetrics('sheets_data.read');
      expect(metrics).toBeDefined();
      expect(metrics?.count).toBe(1);
      expect(metrics?.successCount).toBe(1);
      expect(metrics?.failureCount).toBe(0);
    });

    it('should record failed operation', () => {
      service.recordOperation('sheets_data.read', 50, false);

      const metrics = service.getOperationMetrics('sheets_data.read');
      expect(metrics?.failureCount).toBe(1);
      expect(metrics?.successCount).toBe(0);
    });

    it('should track duration statistics', () => {
      service.recordOperation('sheets_data.read', 100, true);
      service.recordOperation('sheets_data.read', 200, true);
      service.recordOperation('sheets_data.read', 150, true);

      const metrics = service.getOperationMetrics('sheets_data.read');
      expect(metrics?.duration.min).toBe(100);
      expect(metrics?.duration.max).toBe(200);
      expect(metrics?.duration.avg).toBeCloseTo(150, 1);
    });

    it('should calculate success rate', () => {
      service.recordOperation('test.op', 100, true);
      service.recordOperation('test.op', 100, true);
      service.recordOperation('test.op', 100, false);

      const metrics = service.getOperationMetrics('test.op');
      expect(metrics?.successRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('recordCacheAccess', () => {
    it('should record cache hit', () => {
      service.recordCacheAccess(true);

      const metrics = service.getCacheMetrics();
      expect(metrics.hits).toBe(1);
      expect(metrics.misses).toBe(0);
    });

    it('should record cache miss', () => {
      service.recordCacheAccess(false);

      const metrics = service.getCacheMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(1);
    });

    it('should calculate hit rate', () => {
      service.recordCacheAccess(true);
      service.recordCacheAccess(true);
      service.recordCacheAccess(false);

      const metrics = service.getCacheMetrics();
      expect(metrics.hitRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('recordApiCall', () => {
    it('should record API call', () => {
      service.recordApiCall('spreadsheets.get', true);

      const metrics = service.getApiMetrics();
      expect(metrics.calls).toBe(1);
      expect(metrics.byMethod['spreadsheets.get']).toBe(1);
    });

    it('should track errors', () => {
      service.recordApiCall('spreadsheets.get', false);

      const metrics = service.getApiMetrics();
      expect(metrics.errors).toBe(1);
    });

    it('should calculate error rate', () => {
      service.recordApiCall('test', true);
      service.recordApiCall('test', true);
      service.recordApiCall('test', false);

      const metrics = service.getApiMetrics();
      expect(metrics.errorRate).toBeCloseTo(0.333, 2);
    });
  });

  describe('incrementActiveRequests / decrementActiveRequests', () => {
    it('should track active requests', () => {
      service.incrementActiveRequests();
      service.incrementActiveRequests();

      const metrics = service.getSystemMetrics();
      expect(metrics.activeRequests).toBe(2);

      service.decrementActiveRequests();
      const updated = service.getSystemMetrics();
      expect(updated.activeRequests).toBe(1);
    });

    it('should not go below zero', () => {
      service.decrementActiveRequests();
      service.decrementActiveRequests();

      const metrics = service.getSystemMetrics();
      expect(metrics.activeRequests).toBe(0);
    });
  });

  describe('getOperationMetrics', () => {
    it('should return undefined for non-existent operation', () => {
      const metrics = service.getOperationMetrics('nonexistent');
      expect(metrics).toBeUndefined();
    });

    it('should calculate percentiles correctly', () => {
      // Record operations with various durations
      for (let i = 1; i <= 100; i++) {
        service.recordOperation('test.op', i, true);
      }

      const metrics = service.getOperationMetrics('test.op');
      expect(metrics?.duration.p50).toBeCloseTo(50, 5);
      expect(metrics?.duration.p95).toBeCloseTo(95, 5);
      expect(metrics?.duration.p99).toBeCloseTo(99, 5);
    });
  });

  describe('getAllOperationMetrics', () => {
    it('should return all operation metrics', () => {
      service.recordOperation('op1', 100, true);
      service.recordOperation('op2', 200, true);
      service.recordOperation('op3', 300, false);

      const all = service.getAllOperationMetrics();
      expect(all).toHaveLength(3);
    });
  });

  describe('getCacheMetrics', () => {
    it('should return zero hit rate when no requests', () => {
      const metrics = service.getCacheMetrics();
      expect(metrics.hitRate).toBe(0);
      expect(metrics.requests).toBe(0);
    });
  });

  describe('getApiMetrics', () => {
    it('should return zero error rate when no calls', () => {
      const metrics = service.getApiMetrics();
      expect(metrics.errorRate).toBe(0);
      expect(metrics.calls).toBe(0);
    });
  });

  describe('getSystemMetrics', () => {
    it('should return system metrics', () => {
      const metrics = service.getSystemMetrics();

      expect(metrics.activeRequests).toBe(0);
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSummary', () => {
    it('should return complete metrics summary', () => {
      service.recordOperation('test', 100, true);
      service.recordCacheAccess(true);
      service.recordApiCall('test', true);

      const summary = service.getSummary();

      expect(summary.operations).toBeDefined();
      expect(summary.cache).toBeDefined();
      expect(summary.api).toBeDefined();
      expect(summary.system).toBeDefined();
      expect(summary.startTime).toBeDefined();
      expect(summary.currentTime).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      service.recordOperation('test', 100, true);
      service.recordCacheAccess(true);
      service.recordApiCall('test', true);

      service.reset();

      expect(service.getAllOperationMetrics()).toEqual([]);
      expect(service.getCacheMetrics().requests).toBe(0);
      expect(service.getApiMetrics().calls).toBe(0);
    });
  });
});

describe('MetricsService singleton', () => {
  beforeEach(() => {
    resetMetricsService();
  });

  it('should return same instance from getMetricsService', () => {
    const instance1 = getMetricsService();
    const instance2 = getMetricsService();

    expect(instance1).toBe(instance2);
  });

  it('should allow setting custom instance', () => {
    const customService = new MetricsService({ windowSize: 500 });
    setMetricsService(customService);

    const instance = getMetricsService();
    expect(instance).toBe(customService);
  });

  it('should reset to new instance', () => {
    const instance1 = getMetricsService();
    resetMetricsService();
    const instance2 = getMetricsService();

    expect(instance1).not.toBe(instance2);
  });
});

describe('MetricsService percentile calculations', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('should handle single value correctly', () => {
    service.recordOperation('test', 100, true);

    const metrics = service.getOperationMetrics('test');
    expect(metrics?.duration.p50).toBe(100);
    expect(metrics?.duration.p95).toBe(100);
    expect(metrics?.duration.p99).toBe(100);
  });

  it('should handle two values correctly', () => {
    service.recordOperation('test', 100, true);
    service.recordOperation('test', 200, true);

    const metrics = service.getOperationMetrics('test');
    expect(metrics?.duration.min).toBe(100);
    expect(metrics?.duration.max).toBe(200);
    expect(metrics?.duration.avg).toBe(150);
  });
});
