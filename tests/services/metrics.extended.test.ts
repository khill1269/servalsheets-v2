/**
 * Extended tests for Metrics Service
 *
 * Tests metrics collection, aggregation, and dashboard generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  MetricsService,
  getMetricsService,
  initMetricsService,
  resetMetricsService,
} from '../../src/services/metrics.js';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    resetMetricsService();
    service = new MetricsService();
  });

  afterEach(() => {
    resetMetricsService();
  });

  describe('recordApiCall', () => {
    it('should record a successful API call', () => {
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'read',
        duration: 150,
        success: true,
      });

      const metrics = service.getToolMetrics('sheets_data');
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.successCalls).toBe(1);
      expect(metrics.failedCalls).toBe(0);
    });

    it('should record a failed API call', () => {
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'write',
        duration: 200,
        success: false,
        errorType: 'PERMISSION_DENIED',
      });

      const metrics = service.getToolMetrics('sheets_data');
      expect(metrics.failedCalls).toBe(1);
    });

    it('should track duration statistics', () => {
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 200, success: true });
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 300, success: true });

      const metrics = service.getToolMetrics('sheets_data');
      expect(metrics.avgDuration).toBe(200);
      expect(metrics.minDuration).toBe(100);
      expect(metrics.maxDuration).toBe(300);
    });

    it('should track action-specific metrics', () => {
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 150, success: true });
      service.recordApiCall({ tool: 'sheets_data', action: 'write', duration: 200, success: true });

      const actionMetrics = service.getActionMetrics('sheets_data', 'read');
      expect(actionMetrics.totalCalls).toBe(2);
    });
  });

  describe('recordCacheHit', () => {
    it('should track cache hits', () => {
      service.recordCacheHit('values', true);
      service.recordCacheHit('values', true);
      service.recordCacheHit('values', false);

      const cacheMetrics = service.getCacheMetrics('values');
      expect(cacheMetrics.hits).toBe(2);
      expect(cacheMetrics.misses).toBe(1);
      expect(cacheMetrics.hitRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('recordBatchOperation', () => {
    it('should track batch operations', () => {
      service.recordBatchOperation({
        requestCount: 5,
        executedCount: 5,
        savedApiCalls: 4,
        duration: 500,
      });

      const batchMetrics = service.getBatchMetrics();
      expect(batchMetrics.totalBatches).toBe(1);
      expect(batchMetrics.totalSavedCalls).toBe(4);
    });

    it('should calculate batch efficiency', () => {
      service.recordBatchOperation({
        requestCount: 10,
        executedCount: 10,
        savedApiCalls: 9,
        duration: 200,
      });
      service.recordBatchOperation({
        requestCount: 5,
        executedCount: 5,
        savedApiCalls: 4,
        duration: 100,
      });

      const batchMetrics = service.getBatchMetrics();
      expect(batchMetrics.avgEfficiency).toBeGreaterThan(0.8);
    });
  });

  describe('recordRateLimitHit', () => {
    it('should track rate limit hits', () => {
      service.recordRateLimitHit('read');
      service.recordRateLimitHit('read');
      service.recordRateLimitHit('write');

      const rateLimitMetrics = service.getRateLimitMetrics();
      expect(rateLimitMetrics.readLimits).toBe(2);
      expect(rateLimitMetrics.writeLimits).toBe(1);
    });
  });

  describe('recordCircuitBreakerEvent', () => {
    it('should track circuit breaker state changes', () => {
      service.recordCircuitBreakerEvent('open');
      service.recordCircuitBreakerEvent('half-open');
      service.recordCircuitBreakerEvent('closed');

      const cbMetrics = service.getCircuitBreakerMetrics();
      expect(cbMetrics.openEvents).toBe(1);
      expect(cbMetrics.halfOpenEvents).toBe(1);
      expect(cbMetrics.closedEvents).toBe(1);
    });
  });

  describe('recordFeatureFlagBlock', () => {
    it('should track feature flag blocks by flag and action', () => {
      service.recordFeatureFlagBlock({
        flag: 'dataFilterBatch',
        tool: 'sheets_data',
        action: 'batch_read',
      });
      service.recordFeatureFlagBlock({
        flag: 'dataFilterBatch',
        tool: 'sheets_data',
        action: 'batch_read',
      });
      service.recordFeatureFlagBlock({
        flag: 'tableAppends',
        tool: 'sheets_data',
        action: 'append',
      });

      const summary = service.getSummary();
      expect(summary.featureFlags.totalBlocks).toBe(3);
      expect(summary.featureFlags.byFlag['dataFilterBatch']).toBe(2);
      expect(summary.featureFlags.byFlag['tableAppends']).toBe(1);
      expect(summary.featureFlags.byAction['sheets_data.batch_read']).toBe(2);
      expect(summary.featureFlags.byAction['sheets_data.append']).toBe(1);
    });
  });

  describe('recordPayloadWarning', () => {
    it('should track payload warnings by level and action', () => {
      service.recordPayloadWarning({ level: 'warning', tool: 'sheets_data', action: 'write' });
      service.recordPayloadWarning({ level: 'critical', tool: 'sheets_data', action: 'write' });
      service.recordPayloadWarning({
        level: 'exceeded',
        tool: 'sheets_data',
        action: 'batch_write',
      });

      const summary = service.getSummary();
      expect(summary.payloadWarnings.total).toBe(3);
      expect(summary.payloadWarnings.warning).toBe(1);
      expect(summary.payloadWarnings.critical).toBe(1);
      expect(summary.payloadWarnings.exceeded).toBe(1);
      expect(summary.payloadWarnings.byAction['sheets_data.write']).toEqual({
        warning: 1,
        critical: 1,
        exceeded: 0,
        total: 2,
      });
      expect(summary.payloadWarnings.byAction['sheets_data.batch_write']).toEqual({
        warning: 0,
        critical: 0,
        exceeded: 1,
        total: 1,
      });
    });
  });

  describe('getOverallMetrics', () => {
    it('should aggregate all metrics', () => {
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
      service.recordApiCall({
        tool: 'sheets_format',
        action: 'set_format',
        duration: 150,
        success: true,
      });
      service.recordCacheHit('values', true);
      service.recordBatchOperation({
        requestCount: 5,
        executedCount: 5,
        savedApiCalls: 4,
        duration: 200,
      });

      const overall = service.getOverallMetrics();
      expect(overall.totalApiCalls).toBe(2);
      expect(overall.totalCacheRequests).toBe(1);
      expect(overall.totalBatches).toBe(1);
    });

    it('should calculate success rate', () => {
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'write',
        duration: 100,
        success: false,
      });

      const overall = service.getOverallMetrics();
      expect(overall.successRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
      service.recordCacheHit('values', true);

      service.reset();

      const overall = service.getOverallMetrics();
      expect(overall.totalApiCalls).toBe(0);
      expect(overall.totalCacheRequests).toBe(0);
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getMetricsService', () => {
      const instance1 = getMetricsService();
      const instance2 = getMetricsService();
      expect(instance1).toBe(instance2);
    });

    it('should initialize with options', () => {
      resetMetricsService();
      const service = initMetricsService({ retentionPeriodMs: 60000 });
      expect(service).toBeDefined();
    });

    it('should reset singleton with resetMetricsService', () => {
      const instance1 = getMetricsService();
      instance1.recordApiCall({ tool: 'test', action: 'test', duration: 100, success: true });

      resetMetricsService();

      const instance2 = getMetricsService();
      expect(instance2.getOverallMetrics().totalApiCalls).toBe(0);
    });
  });

  describe('time-based metrics', () => {
    it('should track metrics per time window', () => {
      const now = Date.now();

      service.recordApiCall({
        tool: 'sheets_data',
        action: 'read',
        duration: 100,
        success: true,
        timestamp: now - 30000,
      });
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'read',
        duration: 100,
        success: true,
        timestamp: now - 20000,
      });
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'read',
        duration: 100,
        success: true,
        timestamp: now,
      });

      const recentMetrics = service.getMetricsInWindow(60000); // Last minute
      expect(recentMetrics.totalApiCalls).toBe(3);
    });
  });

  describe('error tracking', () => {
    it('should categorize errors by type', () => {
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'write',
        duration: 100,
        success: false,
        errorType: 'PERMISSION_DENIED',
      });
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'write',
        duration: 100,
        success: false,
        errorType: 'PERMISSION_DENIED',
      });
      service.recordApiCall({
        tool: 'sheets_data',
        action: 'write',
        duration: 100,
        success: false,
        errorType: 'NOT_FOUND',
      });

      const errorMetrics = service.getErrorMetrics();
      expect(errorMetrics['PERMISSION_DENIED']).toBe(2);
      expect(errorMetrics['NOT_FOUND']).toBe(1);
    });
  });
});

describe('MetricsService Dashboard', () => {
  let service: MetricsService;

  beforeEach(() => {
    resetMetricsService();
    service = new MetricsService();

    // Seed some data
    service.recordApiCall({ tool: 'sheets_data', action: 'read', duration: 100, success: true });
    service.recordApiCall({ tool: 'sheets_data', action: 'write', duration: 200, success: true });
    service.recordApiCall({
      tool: 'sheets_format',
      action: 'set_format',
      duration: 150,
      success: false,
      errorType: 'INVALID_REQUEST',
    });
    service.recordCacheHit('values', true);
    service.recordCacheHit('values', false);
    service.recordBatchOperation({
      requestCount: 5,
      executedCount: 5,
      savedApiCalls: 4,
      duration: 300,
    });
  });

  it('should generate dashboard data', () => {
    const dashboard = service.getDashboardData();

    expect(dashboard).toBeDefined();
    expect(dashboard.overview).toBeDefined();
    expect(dashboard.toolBreakdown).toBeDefined();
    expect(dashboard.cacheStats).toBeDefined();
    expect(dashboard.batchStats).toBeDefined();
  });

  it('should include tool breakdown in dashboard', () => {
    const dashboard = service.getDashboardData();

    expect(dashboard.toolBreakdown).toHaveProperty('sheets_data');
    expect(dashboard.toolBreakdown).toHaveProperty('sheets_format');
  });
});
