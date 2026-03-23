/**
 * Tests for MetricsExporter
 *
 * Tests metrics export in Prometheus, JSON, and text formats.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsExporter, type MetricsSnapshot } from '../../src/services/metrics-exporter.js';
import type { MetricsService } from '../../src/services/metrics.js';
import type { CacheManager } from '../../src/utils/cache-manager.js';

// Mock dependencies
const createMockMetricsService = (): Partial<MetricsService> => ({
  getSummary: vi.fn().mockReturnValue({
    totalOperations: 1000,
    api: {
      calls: 500,
      errors: 10,
      byMethod: {
        'spreadsheets.get': 200,
        'spreadsheets.values.update': 300,
      },
    },
    featureFlags: {
      totalBlocks: 5,
      byFlag: {
        'experimental-feature': 3,
        'beta-feature': 2,
      },
      byAction: {
        create: 2,
        update: 3,
      },
    },
    payloadWarnings: {
      warning: 10,
      critical: 2,
      exceeded: 1,
      total: 13,
      byAction: {
        large_write: {
          warning: 8,
          critical: 2,
          exceeded: 1,
          total: 11,
        },
      },
    },
  }),
});

const createMockCacheManager = (): Partial<CacheManager> => ({
  getStats: vi.fn().mockReturnValue({
    'spreadsheet-metadata': {
      hits: 150,
      misses: 50,
      evictions: 10,
      size: 1024000,
      hitRate: 0.75,
    },
    'schema-cache': {
      hits: 80,
      misses: 20,
      evictions: 5,
      size: 512000,
      hitRate: 0.8,
    },
  }),
});

describe('MetricsExporter', () => {
  let exporter: MetricsExporter;
  let mockMetricsService: ReturnType<typeof createMockMetricsService>;
  let mockCacheManager: ReturnType<typeof createMockCacheManager>;

  beforeEach(() => {
    mockMetricsService = createMockMetricsService();
    mockCacheManager = createMockCacheManager();
    exporter = new MetricsExporter(
      mockMetricsService as MetricsService,
      mockCacheManager as CacheManager
    );
  });

  describe('getSnapshot', () => {
    it('should create metrics snapshot', () => {
      const snapshot = exporter.getSnapshot();

      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.cache).toBeDefined();
      expect(snapshot.batching).toBeDefined();
      expect(snapshot.api).toBeDefined();
      expect(snapshot.featureFlags).toBeDefined();
      expect(snapshot.payloadWarnings).toBeDefined();
    });

    it('should include cache stats', () => {
      const snapshot = exporter.getSnapshot();

      expect(snapshot.cache['spreadsheet-metadata']).toEqual({
        hits: 150,
        misses: 50,
        evictions: 10,
        size: 1024000,
        hitRate: 0.75,
      });
    });

    it('should include batching stats', () => {
      const snapshot = exporter.getSnapshot();

      expect(snapshot.batching.totalRequests).toBe(1000);
      expect(snapshot.batching.currentWindowMs).toBe(0);
      expect(snapshot.batching.totalBatches).toBe(0);
      expect(snapshot.batching.averageBatchSize).toBe(0);
      expect(snapshot.batching.deduplicatedCount).toBe(0);
    });

    it('should include API stats', () => {
      const snapshot = exporter.getSnapshot();

      expect(snapshot.api.totalCalls).toBe(500);
      expect(snapshot.api.totalErrors).toBe(10);
      expect(snapshot.api.callsByMethod).toEqual({
        'spreadsheets.get': 200,
        'spreadsheets.values.update': 300,
      });
    });

    it('should handle missing cache manager', () => {
      const exporterWithoutCache = new MetricsExporter(mockMetricsService as MetricsService);
      const snapshot = exporterWithoutCache.getSnapshot();

      expect(snapshot.cache).toEqual({});
    });
  });

  describe('exportPrometheus', () => {
    it('should export in Prometheus format', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# ServalSheets MCP Server Metrics');
      expect(prometheus).toContain('# Generated:');
    });

    it('should export cache hit rate metrics', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP cache_hit_rate');
      expect(prometheus).toContain('# TYPE cache_hit_rate gauge');
      expect(prometheus).toContain('cache_hit_rate{type="spreadsheet-metadata"} 0.7500');
      expect(prometheus).toContain('cache_hit_rate{type="schema-cache"} 0.8000');
    });

    it('should export cache hits counter', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP cache_hits_total');
      expect(prometheus).toContain('# TYPE cache_hits_total counter');
      expect(prometheus).toContain('cache_hits_total{type="spreadsheet-metadata"} 150');
      expect(prometheus).toContain('cache_hits_total{type="schema-cache"} 80');
    });

    it('should export cache misses counter', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP cache_misses_total');
      expect(prometheus).toContain('# TYPE cache_misses_total counter');
      expect(prometheus).toContain('cache_misses_total{type="spreadsheet-metadata"} 50');
      expect(prometheus).toContain('cache_misses_total{type="schema-cache"} 20');
    });

    it('should export cache evictions counter', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP cache_evictions_total');
      expect(prometheus).toContain('# TYPE cache_evictions_total counter');
      expect(prometheus).toContain('cache_evictions_total{type="spreadsheet-metadata"} 10');
      expect(prometheus).toContain('cache_evictions_total{type="schema-cache"} 5');
    });

    it('should export cache size gauge', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP cache_size_bytes');
      expect(prometheus).toContain('# TYPE cache_size_bytes gauge');
      expect(prometheus).toContain('cache_size_bytes{type="spreadsheet-metadata"} 1024000');
      expect(prometheus).toContain('cache_size_bytes{type="schema-cache"} 512000');
    });

    it('should export batching metrics', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP batch_window_ms');
      expect(prometheus).toContain('# TYPE batch_window_ms gauge');
      expect(prometheus).toContain('batch_window_ms 0');

      expect(prometheus).toContain('# HELP batch_requests_total');
      expect(prometheus).toContain('batch_requests_total 1000');

      expect(prometheus).toContain('# HELP batch_size_avg');
      expect(prometheus).toContain('batch_size_avg 0.00');

      expect(prometheus).toContain('# HELP requests_deduplicated_total');
      expect(prometheus).toContain('requests_deduplicated_total 0');
    });

    it('should export API call metrics by method', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP api_calls_total Total API calls by method');
      expect(prometheus).toContain('# TYPE api_calls_total counter');
      expect(prometheus).toContain('api_calls_total{method="spreadsheets.get"} 200');
      expect(prometheus).toContain('api_calls_total{method="spreadsheets.values.update"} 300');
    });

    it('should export API summary metrics', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP api_calls_summary_total');
      expect(prometheus).toContain('api_calls_summary_total 500');

      expect(prometheus).toContain('# HELP api_errors_summary_total');
      expect(prometheus).toContain('api_errors_summary_total 10');
    });

    it('should export feature flag block metrics', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP feature_flag_blocks_total');
      expect(prometheus).toContain('# TYPE feature_flag_blocks_total counter');
      expect(prometheus).toContain('feature_flag_blocks_total{flag="experimental-feature"} 3');
      expect(prometheus).toContain('feature_flag_blocks_total{flag="beta-feature"} 2');

      expect(prometheus).toContain('# HELP feature_flag_blocks_by_action_total');
      expect(prometheus).toContain('feature_flag_blocks_by_action_total{action="create"} 2');
      expect(prometheus).toContain('feature_flag_blocks_by_action_total{action="update"} 3');
    });

    it('should export payload warning metrics', () => {
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('# HELP payload_warnings_total');
      expect(prometheus).toContain('# TYPE payload_warnings_total counter');
      expect(prometheus).toContain('payload_warnings_total{level="warning"} 10');
      expect(prometheus).toContain('payload_warnings_total{level="critical"} 2');
      expect(prometheus).toContain('payload_warnings_total{level="exceeded"} 1');

      expect(prometheus).toContain('# HELP payload_warnings_by_action_total');
      expect(prometheus).toContain(
        'payload_warnings_by_action_total{action="large_write",level="warning"} 8'
      );
      expect(prometheus).toContain(
        'payload_warnings_by_action_total{action="large_write",level="critical"} 2'
      );
      expect(prometheus).toContain(
        'payload_warnings_by_action_total{action="large_write",level="exceeded"} 1'
      );
    });

    it('should skip cache metrics if no cache manager', () => {
      const exporterWithoutCache = new MetricsExporter(mockMetricsService as MetricsService);
      const prometheus = exporterWithoutCache.exportPrometheus();

      // Should not have cache sections but should have other sections
      expect(prometheus).not.toContain('cache_hit_rate');
      expect(prometheus).toContain('batch_window_ms');
      expect(prometheus).toContain('api_calls_total');
    });
  });

  describe('exportJSON', () => {
    it('should export snapshot as JSON', () => {
      const json = exporter.exportJSON();
      const parsed = JSON.parse(json);

      expect(parsed.timestamp).toBeGreaterThan(0);
      expect(parsed.cache).toBeDefined();
      expect(parsed.batching).toBeDefined();
      expect(parsed.api).toBeDefined();
    });

    it('should be properly formatted JSON', () => {
      const json = exporter.exportJSON();

      // Should have indentation (pretty-printed)
      expect(json).toContain('\n  ');
      expect(json).toContain('{');
      expect(json).toContain('}');
    });

    it('should include all snapshot fields', () => {
      const json = exporter.exportJSON();
      const parsed: MetricsSnapshot = JSON.parse(json);

      expect(parsed.cache['spreadsheet-metadata']).toBeDefined();
      expect(parsed.batching.totalRequests).toBe(1000);
      expect(parsed.api.totalCalls).toBe(500);
      expect(parsed.featureFlags.totalBlocks).toBe(5);
      expect(parsed.payloadWarnings.total).toBe(13);
    });
  });

  describe('exportText', () => {
    it('should export in human-readable format', () => {
      const text = exporter.exportText();

      expect(text).toContain('ServalSheets MCP Server Metrics');
      expect(text).toContain('================================');
      expect(text).toContain('Timestamp:');
    });

    it('should include cache statistics section', () => {
      const text = exporter.exportText();

      expect(text).toContain('Cache Statistics:');
      expect(text).toContain('spreadsheet-metadata:');
      expect(text).toContain('Hit Rate: 75.0%');
      expect(text).toContain('Hits: 150');
      expect(text).toContain('Misses: 50');
      expect(text).toContain('Evictions: 10');
      expect(text).toContain('Size: 1024000 bytes');
    });

    it('should include batching statistics section', () => {
      const text = exporter.exportText();

      expect(text).toContain('Batching Statistics:');
      expect(text).toContain('Current Window: 0ms');
      expect(text).toContain('Total Batches: 0');
      expect(text).toContain('Total Requests: 1000');
      expect(text).toContain('Average Batch Size: 0.00');
      expect(text).toContain('Deduplicated: 0');
    });

    it('should include API statistics section', () => {
      const text = exporter.exportText();

      expect(text).toContain('API Statistics:');
      expect(text).toContain('Total Calls: 500');
      expect(text).toContain('Total Errors: 10');
      expect(text).toContain('Calls by Method:');
      expect(text).toContain('spreadsheets.get: 200');
      expect(text).toContain('spreadsheets.values.update: 300');
    });

    it('should include feature flag blocks section', () => {
      const text = exporter.exportText();

      expect(text).toContain('Feature Flag Blocks:');
      expect(text).toContain('Total Blocks: 5');
      expect(text).toContain('By Flag:');
      expect(text).toContain('experimental-feature: 3');
      expect(text).toContain('beta-feature: 2');
      expect(text).toContain('By Action:');
      expect(text).toContain('create: 2');
      expect(text).toContain('update: 3');
    });

    it('should include payload warnings section', () => {
      const text = exporter.exportText();

      expect(text).toContain('Payload Warnings:');
      expect(text).toContain('Warning: 10');
      expect(text).toContain('Critical: 2');
      expect(text).toContain('Exceeded: 1');
      expect(text).toContain('Total: 13');
      expect(text).toContain('By Action:');
      expect(text).toContain('large_write: warning=8, critical=2, exceeded=1, total=11');
    });

    it('should skip cache section if no cache manager', () => {
      const exporterWithoutCache = new MetricsExporter(mockMetricsService as MetricsService);
      const text = exporterWithoutCache.exportText();

      expect(text).not.toContain('Cache Statistics:');
      expect(text).toContain('Batching Statistics:');
      expect(text).toContain('API Statistics:');
    });
  });

  describe('edge cases', () => {
    it('should handle empty cache stats', () => {
      mockCacheManager.getStats.mockReturnValue({});
      const exporter = new MetricsExporter(
        mockMetricsService as MetricsService,
        mockCacheManager as CacheManager
      );

      const text = exporter.exportText();
      expect(text).not.toContain('Cache Statistics:');

      const prometheus = exporter.exportPrometheus();
      expect(prometheus).not.toContain('cache_hit_rate');
    });

    it('should handle empty API method stats', () => {
      mockMetricsService.getSummary.mockReturnValue({
        totalOperations: 0,
        api: {
          calls: 0,
          errors: 0,
          byMethod: {},
        },
        featureFlags: { totalBlocks: 0, byFlag: {}, byAction: {} },
        payloadWarnings: { warning: 0, critical: 0, exceeded: 0, total: 0, byAction: {} },
      });

      const exporter = new MetricsExporter(mockMetricsService as MetricsService);
      const text = exporter.exportText();

      expect(text).toContain('Total Calls: 0');
      expect(text).not.toContain('Calls by Method:');
    });

    it('should handle empty feature flag stats', () => {
      mockMetricsService.getSummary.mockReturnValue({
        totalOperations: 0,
        api: { calls: 0, errors: 0, byMethod: {} },
        featureFlags: { totalBlocks: 0, byFlag: {}, byAction: {} },
        payloadWarnings: { warning: 0, critical: 0, exceeded: 0, total: 0, byAction: {} },
      });

      const exporter = new MetricsExporter(mockMetricsService as MetricsService);
      const prometheus = exporter.exportPrometheus();

      expect(prometheus).toContain('feature_flag_blocks_total');
      // But no specific flag metrics
    });
  });
});
