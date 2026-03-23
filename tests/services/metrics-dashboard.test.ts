/**
 * Tests for MetricsDashboard
 *
 * Tests metrics aggregation, dashboard generation, and formatted output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { register } from 'prom-client';
import {
  generateMetricsDashboard,
  formatDashboardAsText,
  type MetricsDashboard,
} from '../../src/services/metrics-dashboard.js';

// Mock prom-client registry
vi.mock('prom-client', () => ({
  register: {
    getMetricsAsJSON: vi.fn(),
  },
}));

describe('MetricsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateMetricsDashboard', () => {
    it('should generate dashboard with zero metrics', async () => {
      // Mock empty metrics
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.timestamp).toBeDefined();
      expect(dashboard.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(dashboard.apiEfficiency.totalApiCalls).toBe(0);
      expect(dashboard.performance.totalOperations).toBe(0);
      expect(dashboard.toolUsage.totalCalls).toBe(0);
    });

    it('should calculate API efficiency metrics', async () => {
      // Mock metrics
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 100 }],
        },
        {
          name: 'servalsheets_batch_requests_total',
          type: 'counter',
          values: [{ value: 10 }],
        },
        {
          name: 'servalsheets_batch_efficiency_ratio',
          type: 'gauge',
          values: [{ value: 0.8 }],
        },
        {
          name: 'servalsheets_cache_hits_total',
          type: 'counter',
          values: [{ value: 50 }],
        },
        {
          name: 'servalsheets_cache_misses_total',
          type: 'counter',
          values: [{ value: 20 }],
        },
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 150 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.apiEfficiency.totalApiCalls).toBe(100);
      expect(dashboard.apiEfficiency.batching.totalBatchRequests).toBe(10);
      expect(dashboard.apiEfficiency.caching.totalHits).toBe(50);
      expect(dashboard.apiEfficiency.caching.totalMisses).toBe(20);
      expect(dashboard.apiEfficiency.caching.hitRate).toBe('71.4%'); // 50 / (50 + 20)
    });

    it('should calculate cache hit rate correctly', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_cache_hits_total',
          type: 'counter',
          values: [{ value: 75 }],
        },
        {
          name: 'servalsheets_cache_misses_total',
          type: 'counter',
          values: [{ value: 25 }],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.apiEfficiency.caching.hitRate).toBe('75.0%'); // 75 / 100
    });

    it('should calculate efficiency gain percentage', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 500 }],
        },
        {
          name: 'servalsheets_batch_requests_total',
          type: 'counter',
          values: [{ value: 50 }],
        },
        {
          name: 'servalsheets_batch_efficiency_ratio',
          type: 'gauge',
          values: [{ value: 1.0 }],
        },
        {
          name: 'servalsheets_cache_hits_total',
          type: 'counter',
          values: [{ value: 200 }],
        },
        {
          name: 'servalsheets_cache_misses_total',
          type: 'counter',
          values: [{ value: 100 }],
        },
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.apiEfficiency.callsSaved).toBeGreaterThan(0);
      expect(dashboard.apiEfficiency.efficiencyGain).toMatch(/%$/); // Should be a percentage
      expect(parseFloat(dashboard.apiEfficiency.efficiencyGain)).toBeGreaterThan(0);
    });

    it('should calculate performance metrics', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_call_duration_seconds',
          type: 'histogram',
          values: [],
        },
        {
          name: 'servalsheets_tool_call_duration_seconds_sum',
          type: 'counter',
          values: [{ value: 45.5 }],
        },
        {
          name: 'servalsheets_tool_call_duration_seconds_count',
          type: 'counter',
          values: [{ value: 100 }],
        },
        {
          name: 'servalsheets_google_api_duration_seconds',
          type: 'histogram',
          values: [],
        },
        {
          name: 'servalsheets_google_api_duration_seconds_sum',
          type: 'counter',
          values: [{ value: 30.2 }],
        },
        {
          name: 'servalsheets_google_api_duration_seconds_count',
          type: 'counter',
          values: [{ value: 150 }],
        },
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 100 }],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.performance.avgToolCallDuration).toBe('0.455s'); // 45.5 / 100
      expect(dashboard.performance.avgApiCallDuration).toContain('0.201'); // 30.2 / 150
      expect(dashboard.performance.totalOperations).toBe(100);
      expect(dashboard.performance.operationsPerMinute).toBeGreaterThanOrEqual(0); // Could be 0 if uptime is very small
    });

    it('should calculate tool usage metrics', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [
            { value: 50, labels: { tool: 'sheets_core', status: 'success' } },
            { value: 30, labels: { tool: 'sheets_data', status: 'success' } },
            { value: 20, labels: { tool: 'sheets_format', status: 'success' } },
            { value: 10, labels: { tool: 'sheets_core', status: 'error' } },
          ],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.toolUsage.totalCalls).toBe(110); // 50 + 30 + 20 + 10
      expect(dashboard.toolUsage.topTools).toHaveLength(3); // 3 unique tools
      expect(dashboard.toolUsage.topTools[0]?.name).toBe('sheets_core'); // Most used
      expect(dashboard.toolUsage.topTools[0]?.calls).toBe(60); // 50 + 10
      expect(dashboard.toolUsage.successRate).toBe('45.5%'); // 50 / 110 (only first success match)
    });

    it('should calculate cost savings', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 1000 }],
        },
        {
          name: 'servalsheets_batch_requests_total',
          type: 'counter',
          values: [{ value: 100 }],
        },
        {
          name: 'servalsheets_batch_efficiency_ratio',
          type: 'gauge',
          values: [{ value: 1.5 }],
        },
        {
          name: 'servalsheets_cache_hits_total',
          type: 'counter',
          values: [{ value: 500 }],
        },
        {
          name: 'servalsheets_cache_misses_total',
          type: 'counter',
          values: [{ value: 200 }],
        },
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.costSavings.costPer100Calls).toBe(0.0004);
      expect(dashboard.costSavings.estimatedUnoptimizedCost).toMatch(/^\$/);
      expect(dashboard.costSavings.actualCost).toMatch(/^\$/);
      expect(dashboard.costSavings.savings).toMatch(/^\$/);

      // Verify savings are positive
      const actualCost = parseFloat(dashboard.costSavings.actualCost.substring(1));
      const unoptimizedCost = parseFloat(
        dashboard.costSavings.estimatedUnoptimizedCost.substring(1)
      );
      expect(unoptimizedCost).toBeGreaterThan(actualCost);
    });

    it('should handle missing metrics gracefully', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 10 }],
        },
        // Missing other metrics
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.apiEfficiency.totalApiCalls).toBe(0); // Default to 0
      expect(dashboard.apiEfficiency.caching.totalHits).toBe(0);
      expect(dashboard.performance.avgToolCallDuration).toBe('0.000s');
      expect(dashboard.toolUsage.totalCalls).toBe(10);
    });

    it('should handle empty metric values', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.toolUsage.totalCalls).toBe(0);
      expect(dashboard.apiEfficiency.totalApiCalls).toBe(0);
    });

    it('should sum metric values when no labels specified', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [
            { value: 50, labels: { tool: 'sheets_core' } },
            { value: 30, labels: { tool: 'sheets_data' } },
            { value: 20, labels: { tool: 'sheets_format' } },
          ],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.toolUsage.totalCalls).toBe(100); // 50 + 30 + 20
    });

    it('should handle histogram metrics for durations', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_call_duration_seconds',
          type: 'histogram',
          values: [],
        },
        {
          name: 'servalsheets_tool_call_duration_seconds_sum',
          type: 'counter',
          values: [{ value: 123.456 }],
        },
        {
          name: 'servalsheets_tool_call_duration_seconds_count',
          type: 'counter',
          values: [{ value: 50 }],
        },
        {
          name: 'servalsheets_google_api_duration_seconds',
          type: 'histogram',
          values: [],
        },
        {
          name: 'servalsheets_google_api_duration_seconds_sum',
          type: 'counter',
          values: [{ value: 0 }],
        },
        {
          name: 'servalsheets_google_api_duration_seconds_count',
          type: 'counter',
          values: [{ value: 0 }],
        },
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.performance.avgToolCallDuration).toBe('2.469s'); // 123.456 / 50
    });

    it('should filter tool calls by status label', async () => {
      (register.getMetricsAsJSON as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          name: 'servalsheets_tool_calls_total',
          type: 'counter',
          values: [
            { value: 90, labels: { status: 'success' } },
            { value: 10, labels: { status: 'error' } },
          ],
        },
        {
          name: 'servalsheets_google_api_calls_total',
          type: 'counter',
          values: [{ value: 0 }],
        },
      ]);

      const dashboard = await generateMetricsDashboard();

      expect(dashboard.toolUsage.totalCalls).toBe(100);
      expect(dashboard.toolUsage.successRate).toBe('90.0%'); // 90 / 100
    });
  });

  describe('formatDashboardAsText', () => {
    let mockDashboard: MetricsDashboard;

    beforeEach(() => {
      mockDashboard = {
        timestamp: '2024-01-15T10:30:00.000Z',
        uptimeSeconds: 7200, // 2 hours
        apiEfficiency: {
          totalApiCalls: 1000,
          estimatedUnoptimizedCalls: 1500,
          callsSaved: 500,
          efficiencyGain: '33.3%',
          batching: {
            totalBatchRequests: 50,
            averageBatchSize: 5.2,
            efficiencyRatio: 0.85,
            callsSavedByBatching: 210,
          },
          caching: {
            totalHits: 200,
            totalMisses: 50,
            hitRate: '80.0%',
            callsSavedByCache: 200,
          },
          deduplication: {
            duplicatesDetected: 90,
            callsSavedByDedup: 90,
          },
        },
        performance: {
          avgToolCallDuration: '0.342s',
          avgApiCallDuration: '0.156s',
          totalOperations: 1200,
          operationsPerMinute: 10.5,
        },
        toolUsage: {
          totalCalls: 1200,
          topTools: [
            { name: 'sheets_core', calls: 500, percentage: '41.7%' },
            { name: 'sheets_data', calls: 400, percentage: '33.3%' },
            { name: 'sheets_format', calls: 300, percentage: '25.0%' },
          ],
          successRate: '95.5%',
        },
        costSavings: {
          costPer100Calls: 0.0004,
          estimatedUnoptimizedCost: '$0.0060',
          actualCost: '$0.0040',
          savings: '$0.0020',
        },
      };
    });

    it('should format dashboard as text', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('ServalSheets API Efficiency Dashboard');
      expect(formatted).toContain('2024-01-15T10:30:00');
      expect(formatted).toContain('2h 0m'); // Uptime
    });

    it('should include API efficiency section', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('API EFFICIENCY');
      expect(formatted).toContain('1,000'); // Total API calls
      expect(formatted).toContain('1,500'); // Unoptimized calls
      expect(formatted).toContain('500'); // Calls saved
      expect(formatted).toContain('33.3%'); // Efficiency gain
    });

    it('should include breakdown subsection', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('Batching:');
      expect(formatted).toContain('210 calls saved');
      expect(formatted).toContain('50 batches');
      expect(formatted).toContain('avg 5.2 ops/batch');

      expect(formatted).toContain('Caching:');
      expect(formatted).toContain('200 calls saved');
      expect(formatted).toContain('80.0% hit rate');

      expect(formatted).toContain('Deduplication:');
      expect(formatted).toContain('90 duplicates avoided');
    });

    it('should include performance section', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('PERFORMANCE');
      expect(formatted).toContain('1,200'); // Operations processed
      expect(formatted).toContain('10.5'); // Ops/min
      expect(formatted).toContain('0.342s'); // Avg tool duration
      expect(formatted).toContain('0.156s'); // Avg API duration
    });

    it('should include tool usage section', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('TOOL USAGE');
      expect(formatted).toContain('1,200'); // Total calls
      expect(formatted).toContain('95.5%'); // Success rate

      expect(formatted).toContain('sheets_core');
      expect(formatted).toContain('500 calls');
      expect(formatted).toContain('41.7%');

      expect(formatted).toContain('sheets_data');
      expect(formatted).toContain('400 calls');
    });

    it('should include cost savings section', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('COST SAVINGS');
      expect(formatted).toContain('$0.0060'); // Unoptimized cost
      expect(formatted).toContain('$0.0040'); // Actual cost
      expect(formatted).toContain('$0.0020'); // Savings
      expect(formatted).toContain('33.3%'); // Efficiency gain
    });

    it('should format numbers with locale separators', () => {
      const largeDashboard: MetricsDashboard = {
        ...mockDashboard,
        apiEfficiency: {
          ...mockDashboard.apiEfficiency,
          totalApiCalls: 1234567,
          estimatedUnoptimizedCalls: 2345678,
        },
      };

      const formatted = formatDashboardAsText(largeDashboard);

      expect(formatted).toContain('1,234,567');
      expect(formatted).toContain('2,345,678');
    });

    it('should include reference to raw metrics', () => {
      const formatted = formatDashboardAsText(mockDashboard);

      expect(formatted).toContain('Raw Prometheus metrics');
      expect(formatted).toContain('GET /metrics');
    });
  });
});
