/**
 * Tests for Prometheus metrics
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { register } from 'prom-client';
import {
  errorsByType,
  toolCallLatencySummary,
  batchEfficiencyRatio,
  requestQueueDepth,
  cacheEvictions,
  errorCodeCompatTotal,
  recordError,
  recordErrorCodeCompatibility,
  recordToolCallLatency,
  updateBatchEfficiency,
  updateRequestQueueDepth,
  recordCacheEviction,
  metricsHandler,
} from '../../src/observability/metrics.js';

describe('Prometheus Metrics', () => {
  beforeEach(() => {
    // Reset metrics between tests
    register.clear();
    register.registerMetric(errorsByType);
    register.registerMetric(toolCallLatencySummary);
    register.registerMetric(batchEfficiencyRatio);
    register.registerMetric(requestQueueDepth);
    register.registerMetric(cacheEvictions);
    register.registerMetric(errorCodeCompatTotal);
  });

  describe('New Metrics - errorsByType', () => {
    it('should record errors by type', async () => {
      recordError('ValidationError', 'sheets', 'update');
      recordError('AuthenticationError', 'auth', 'login');

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_errors_by_type_total');
      expect(metrics).toContain('error_type="ValidationError"');
      expect(metrics).toContain('error_type="AuthenticationError"');
    });

    it('should track errors with tool and action labels', async () => {
      recordError('RateLimitError', 'sheets', 'batchUpdate');

      const metrics = await register.metrics();
      expect(metrics).toContain('tool="sheets"');
      expect(metrics).toContain('action="batchUpdate"');
    });
  });

  describe('New Metrics - errorCodeCompatTotal', () => {
    it('should record known alias mappings with canonical/family labels', async () => {
      recordErrorCodeCompatibility({
        reportedCode: 'VALIDATION_ERROR',
        canonicalCode: 'INVALID_REQUEST',
        family: 'validation',
        isAlias: true,
        isKnown: true,
      });

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_error_code_compat_total');
      expect(metrics).toContain('reported_code="VALIDATION_ERROR"');
      expect(metrics).toContain('canonical_code="INVALID_REQUEST"');
      expect(metrics).toContain('family="validation"');
      expect(metrics).toContain('is_alias="true"');
      expect(metrics).toContain('is_known="true"');
    });

    it('should collapse unknown reported codes to prevent label cardinality growth', async () => {
      recordErrorCodeCompatibility({
        reportedCode: 'CUSTOM_RUNTIME_ERROR_123',
        canonicalCode: 'UNKNOWN_ERROR',
        family: 'unknown',
        isAlias: false,
        isKnown: false,
      });

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_error_code_compat_total');
      expect(metrics).toContain('reported_code="UNKNOWN_UNRECOGNIZED"');
      expect(metrics).toContain('canonical_code="UNKNOWN_ERROR"');
      expect(metrics).toContain('family="unknown"');
      expect(metrics).toContain('is_known="false"');
    });
  });

  describe('New Metrics - toolCallLatencySummary', () => {
    it('should record tool call latencies for percentile calculation', async () => {
      recordToolCallLatency('sheets', 'read', 0.123);
      recordToolCallLatency('sheets', 'read', 0.456);
      recordToolCallLatency('sheets', 'read', 0.789);

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_tool_call_latency_summary');
      expect(metrics).toContain('tool="sheets"');
      expect(metrics).toContain('action="read"');
      // Summary metrics should include count and sum
      expect(metrics).toContain('_count');
      expect(metrics).toContain('_sum');
    });

    it('should support multiple tools and actions', async () => {
      recordToolCallLatency('sheets', 'write', 0.5);
      recordToolCallLatency('auth', 'validate', 0.1);

      const metrics = await register.metrics();
      expect(metrics).toContain('tool="sheets"');
      expect(metrics).toContain('tool="auth"');
      expect(metrics).toContain('action="write"');
      expect(metrics).toContain('action="validate"');
    });
  });

  describe('New Metrics - batchEfficiencyRatio', () => {
    it('should track batch efficiency ratios', async () => {
      updateBatchEfficiency('spreadsheets.batchUpdate', 0.85);

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_batch_efficiency_ratio');
      expect(metrics).toContain('operation_type="spreadsheets.batchUpdate"');
      expect(metrics).toContain('0.85');
    });

    it('should support multiple operation types', async () => {
      updateBatchEfficiency('spreadsheets.batchUpdate', 0.85);
      updateBatchEfficiency('sheets.values.batchGet', 0.92);

      const metrics = await register.metrics();
      expect(metrics).toContain('operation_type="spreadsheets.batchUpdate"');
      expect(metrics).toContain('operation_type="sheets.values.batchGet"');
    });

    it('should accept ratios between 0 and 1', async () => {
      updateBatchEfficiency('test', 0.0);
      updateBatchEfficiency('test', 1.0);
      updateBatchEfficiency('test', 0.5);

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_batch_efficiency_ratio');
    });
  });

  describe('New Metrics - requestQueueDepth', () => {
    it('should track current queue depth', async () => {
      updateRequestQueueDepth(5);

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_request_queue_depth');
      expect(metrics).toContain('5');
    });

    it('should update to latest value', async () => {
      updateRequestQueueDepth(10);
      updateRequestQueueDepth(3);

      const metrics = await register.metrics();
      expect(metrics).toContain('3');
      expect(metrics).not.toContain('10');
    });

    it('should handle zero depth', async () => {
      updateRequestQueueDepth(0);

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_request_queue_depth');
      expect(metrics).toContain('0');
    });
  });

  describe('New Metrics - cacheEvictions', () => {
    it('should count cache evictions by reason', async () => {
      recordCacheEviction('size_limit');
      recordCacheEviction('ttl_expired');
      recordCacheEviction('size_limit');

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_cache_evictions_total');
      expect(metrics).toContain('reason="size_limit"');
      expect(metrics).toContain('reason="ttl_expired"');
    });

    it('should increment counters correctly', async () => {
      for (let i = 0; i < 5; i++) {
        recordCacheEviction('manual');
      }

      const metrics = await register.metrics();
      expect(metrics).toContain('servalsheets_cache_evictions_total');
      expect(metrics).toContain('reason="manual"');
    });
  });

  describe('Metrics Handler', () => {
    it('should return metrics in Prometheus format', async () => {
      // Add some sample data
      recordError('TestError', 'test', 'action');
      updateRequestQueueDepth(3);

      let contentType = '';
      let responseBody = '';

      const mockResponse = {
        set: (key: string, value: string) => {
          if (key === 'Content-Type') contentType = value;
        },
        send: () => {},
        end: (body?: string) => {
          if (body) responseBody = body;
        },
        status: () => mockResponse,
      };

      await metricsHandler({}, mockResponse);

      expect(contentType).toContain('text/plain');
      expect(responseBody).toContain('servalsheets_');
    });

    it('should handle errors gracefully', async () => {
      let statusCode = 0;
      let errorMessage = '';

      const mockResponse = {
        set: () => {
          throw new Error('Test error');
        },
        send: () => {},
        end: (body?: string) => {
          if (body) errorMessage = body;
        },
        status: (code: number) => {
          statusCode = code;
          return mockResponse;
        },
      };

      await metricsHandler({}, mockResponse);

      expect(statusCode).toBe(500);
      expect(errorMessage).toContain('Test error');
    });
  });

  describe('Prometheus Naming Conventions', () => {
    it('should follow counter naming convention (_total suffix)', async () => {
      const metrics = await register.metrics();

      // Counters should end with _total
      expect(errorsByType.name).toContain('_total');
      expect(cacheEvictions.name).toContain('_total');
    });

    it('should follow gauge naming convention (no _total)', async () => {
      // Gauges should NOT end with _total
      expect(batchEfficiencyRatio.name).not.toContain('_total');
      expect(requestQueueDepth.name).not.toContain('_total');
    });

    it('should use snake_case for metric names', async () => {
      expect(errorsByType.name).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(toolCallLatencySummary.name).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(batchEfficiencyRatio.name).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(requestQueueDepth.name).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(cacheEvictions.name).toMatch(/^[a-z_][a-z0-9_]*$/);
    });

    it('should use consistent namespace prefix', async () => {
      expect(errorsByType.name).toContain('servalsheets_');
      expect(toolCallLatencySummary.name).toContain('servalsheets_');
      expect(batchEfficiencyRatio.name).toContain('servalsheets_');
      expect(requestQueueDepth.name).toContain('servalsheets_');
      expect(cacheEvictions.name).toContain('servalsheets_');
    });
  });

  describe('Metric Registration', () => {
    it('should register all new metrics in the default registry', async () => {
      const metrics = await register.metrics();

      expect(metrics).toContain('servalsheets_errors_by_type_total');
      expect(metrics).toContain('servalsheets_tool_call_latency_summary');
      expect(metrics).toContain('servalsheets_batch_efficiency_ratio');
      expect(metrics).toContain('servalsheets_request_queue_depth');
      expect(metrics).toContain('servalsheets_cache_evictions_total');
    });

    it('should export metrics with proper HELP text', async () => {
      const metrics = await register.metrics();

      expect(metrics).toContain('HELP servalsheets_errors_by_type_total');
      expect(metrics).toContain('HELP servalsheets_tool_call_latency_summary');
      expect(metrics).toContain('HELP servalsheets_batch_efficiency_ratio');
      expect(metrics).toContain('HELP servalsheets_request_queue_depth');
      expect(metrics).toContain('HELP servalsheets_cache_evictions_total');
    });

    it('should export metrics with proper TYPE declarations', async () => {
      const metrics = await register.metrics();

      expect(metrics).toContain('TYPE servalsheets_errors_by_type_total counter');
      expect(metrics).toContain('TYPE servalsheets_tool_call_latency_summary summary');
      expect(metrics).toContain('TYPE servalsheets_batch_efficiency_ratio gauge');
      expect(metrics).toContain('TYPE servalsheets_request_queue_depth gauge');
      expect(metrics).toContain('TYPE servalsheets_cache_evictions_total counter');
    });
  });
});
