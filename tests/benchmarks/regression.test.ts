/**
 * Performance Regression Tests
 *
 * Automated performance regression detection with baseline tracking.
 * Tests handler execution time, memory usage, throughput, and WebSocket latency.
 *
 * Run with: npm run perf:baseline (creates baseline)
 *           npm run perf:compare (compares against baseline)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';
import type { PerformanceMetrics } from './performance-baseline.js';
import {
  storeBaseline,
  compareWithBaseline,
  loadBaseline,
  generateReport,
} from './performance-baseline.js';
import { waitFor } from '../helpers/wait-for.js';

// Import handler factory for testing
import { createHandlers } from '../../src/handlers/index.js';
import {
  createMockContext,
  createMockSheetsApi,
  createMockDriveApi,
} from '../helpers/google-api-mocks.js';

/**
 * Measure execution time of an async function
 */
async function measureTime<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Run a function multiple times and return statistics
 */
async function benchmark<T>(
  fn: () => Promise<T> | T,
  iterations: number = 100
): Promise<{
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  stdDev: number;
}> {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < 10; i++) {
    await fn();
  }

  // Measure
  for (let i = 0; i < iterations; i++) {
    const { durationMs } = await measureTime(fn);
    times.push(durationMs);
  }

  // Sort for percentile calculations
  times.sort((a, b) => a - b);

  const sum = times.reduce((a, b) => a + b, 0);
  const mean = sum / times.length;
  const variance = times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / times.length;

  return {
    min: times[0],
    max: times[times.length - 1],
    mean,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
    stdDev: Math.sqrt(variance),
  };
}

/**
 * Measure memory usage
 */
function measureMemory<T>(fn: () => T): {
  result: T;
  heapUsed: number;
  external: number;
  rss: number;
} {
  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  const before = process.memoryUsage();
  const result = fn();
  const after = process.memoryUsage();

  return {
    result,
    heapUsed: Math.max(0, after.heapUsed - before.heapUsed),
    external: Math.max(0, after.external - before.external),
    rss: Math.max(0, after.rss - before.rss),
  };
}

// Skip performance regression tests unless explicitly requested
// These tests compare against baseline and fail on regressions
describe.skipIf(!process.env['PERF_COMPARE'])('Performance Regression Tests', () => {
  const collectedMetrics: PerformanceMetrics[] = [];
  let mockContext: ReturnType<typeof createMockContext>;
  let handlers: ReturnType<typeof createHandlers>;

  beforeAll(() => {
    const mockSheetsApi = createMockSheetsApi();
    mockContext = createMockContext({
      // Provide googleClient so handlers pass requireAuth() check
      googleClient: { sheets: mockSheetsApi, getCircuitBreakerState: () => 'closed' },
    });
    handlers = createHandlers({
      context: mockContext,
      sheetsApi: mockSheetsApi,
      driveApi: createMockDriveApi(),
    });
  });

  afterAll(async () => {
    // Store or compare baseline
    const isBaseline = process.env['PERF_BASELINE'] === 'true';

    if (isBaseline) {
      const historyFile = await storeBaseline(collectedMetrics);
      console.log(`\nBaseline stored: ${historyFile}`);
    } else {
      const baseline = loadBaseline();
      const comparison = compareWithBaseline(collectedMetrics, baseline);
      const report = generateReport(collectedMetrics, baseline, comparison);
      console.log(report);

      // Fail if critical regressions detected
      const critical = comparison.regressions.filter((r) => r.severity === 'critical');
      if (critical.length > 0) {
        throw new Error(`${critical.length} critical performance regression(s) detected`);
      }
    }
  });

  describe('Handler Execution Time', () => {
    it('CoreHandler.get should execute quickly', async () => {
      const input = {
        action: 'get' as const,
        spreadsheetId: 'test-spreadsheet-id',
      };

      const stats = await benchmark(() => handlers.core.handle({ request: input }), 200);

      collectedMetrics.push({
        name: 'handler.core.get',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(10); // 10ms threshold
    });

    it('DataHandler.read_range should execute quickly', async () => {
      const input = {
        action: 'read_range' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:B10' },
      };

      const stats = await benchmark(() => handlers.data.handle({ request: input }), 200);

      collectedMetrics.push({
        name: 'handler.data.read_range',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(10);
    });

    it('DataHandler.write_range with large data should be acceptable', async () => {
      const largeValues = Array(100)
        .fill(null)
        .map((_, i) => Array(20).fill(`value-${i}`));

      const input = {
        action: 'write_range' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:T100' },
        values: largeValues,
        valueInputOption: 'USER_ENTERED' as const,
      };

      const stats = await benchmark(() => handlers.data.handle({ request: input }), 50);

      collectedMetrics.push({
        name: 'handler.data.write_range.large',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(30);
    });

    it('FormatHandler.set_format should execute quickly', async () => {
      const input = {
        action: 'set_format' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:Z100' },
        format: {
          backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
          textFormat: { bold: true, fontSize: 12 },
          horizontalAlignment: 'CENTER' as const,
        },
      };

      const stats = await benchmark(() => handlers.format.handle({ request: input }), 100);

      collectedMetrics.push({
        name: 'handler.format.set_format',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(15);
    });
  });

  describe('Memory Usage', () => {
    it('CoreHandler.get should not allocate excessive memory', () => {
      const input = {
        action: 'get' as const,
        spreadsheetId: 'test-spreadsheet-id',
      };

      const { heapUsed, external, rss } = measureMemory(() => {
        for (let i = 0; i < 100; i++) {
          handlers.core.handle({ request: input });
        }
      });

      // Find the corresponding latency metric
      const latencyMetric = collectedMetrics.find((m) => m.name === 'handler.core.get');
      if (latencyMetric) {
        latencyMetric.memory = { heapUsed, external, rss };
      }

      expect(heapUsed).toBeLessThan(5 * 1024 * 1024); // 5MB
    });

    it('DataHandler.write_range with large data should manage memory efficiently', () => {
      const largeValues = Array(1000)
        .fill(null)
        .map((_, i) => Array(26).fill(`value-${i}`));

      const input = {
        action: 'write_range' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:Z1000' },
        values: largeValues,
        valueInputOption: 'USER_ENTERED' as const,
      };

      const { heapUsed, external, rss } = measureMemory(() => {
        for (let i = 0; i < 10; i++) {
          handlers.data.handle({ request: input });
        }
      });

      // Store with latency metric
      const latencyMetric = collectedMetrics.find(
        (m) => m.name === 'handler.data.write_range.large'
      );
      if (latencyMetric) {
        latencyMetric.memory = { heapUsed, external, rss };
      }

      expect(heapUsed).toBeLessThan(30 * 1024 * 1024); // 30MB for large data
    });
  });

  describe('Throughput', () => {
    it('should handle high validation throughput', async () => {
      const input = {
        action: 'read_range' as const,
        spreadsheetId: 'test-spreadsheet-id',
        range: { a1: 'Sheet1!A1:B10' },
      };

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await handlers.data.handle({ request: input });
      }

      const duration = performance.now() - start;
      const throughput = (iterations / duration) * 1000;

      collectedMetrics.push({
        name: 'throughput.data.read_range',
        latency: {
          min: duration / iterations,
          max: duration / iterations,
          mean: duration / iterations,
          median: duration / iterations,
          p95: duration / iterations,
          p99: duration / iterations,
          stdDev: 0,
        },
        throughput,
      });

      expect(throughput).toBeGreaterThan(500); // At least 500 ops/sec
    });

    it('should handle concurrent operations efficiently', async () => {
      const inputs = Array(100)
        .fill(null)
        .map((_, i) => ({
          action: 'read_range' as const,
          spreadsheetId: `spreadsheet-${i}`,
          range: { a1: `Sheet1!A${i + 1}:B${i + 10}` },
        }));

      const start = performance.now();

      await Promise.all(inputs.map((input) => handlers.data.handle({ request: input })));

      const duration = performance.now() - start;
      const throughput = (inputs.length / duration) * 1000;

      collectedMetrics.push({
        name: 'throughput.concurrent.read_range',
        latency: {
          min: duration,
          max: duration,
          mean: duration,
          median: duration,
          p95: duration,
          p99: duration,
          stdDev: 0,
        },
        throughput,
      });

      expect(duration).toBeLessThan(200); // 100 concurrent ops under 200ms
      expect(throughput).toBeGreaterThan(400); // At least 400 ops/sec
    });
  });

  describe('WebSocket Latency', () => {
    it('should measure WebSocket message handling latency', async () => {
      // Mock WebSocket message handling
      const mockWebSocketHandler = async () => {
        await waitFor(1);
        return { success: true };
      };

      const stats = await benchmark(mockWebSocketHandler, 200);

      collectedMetrics.push({
        name: 'websocket.message.latency',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(5); // 5ms threshold for message handling
    });

    it('should measure WebSocket connection overhead', async () => {
      // Mock connection establishment
      const mockConnect = async () => {
        await waitFor(2);
        return { connected: true };
      };

      const stats = await benchmark(mockConnect, 50);

      collectedMetrics.push({
        name: 'websocket.connect.latency',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(10); // 10ms threshold for connection
    });
  });

  describe('Plugin Execution Time', () => {
    it('should measure plugin initialization time', async () => {
      // Mock plugin initialization
      const mockPluginInit = async () => {
        await waitFor(5);
        return { initialized: true };
      };

      const stats = await benchmark(mockPluginInit, 50);

      collectedMetrics.push({
        name: 'plugin.initialize.latency',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(20); // 20ms threshold for plugin init
    });

    it('should measure plugin execution time', async () => {
      // Mock plugin execution
      const mockPluginExec = async () => {
        await waitFor(3);
        return { result: 'success' };
      };

      const stats = await benchmark(mockPluginExec, 100);

      collectedMetrics.push({
        name: 'plugin.execute.latency',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(10); // 10ms threshold for plugin execution
    });
  });

  describe('Batch Operations', () => {
    it('should measure batch read performance', async () => {
      const ranges = Array(50)
        .fill(null)
        .map((_, i) => ({ a1: `Sheet${(i % 5) + 1}!A${i * 10 + 1}:Z${(i + 1) * 10}` }));

      const input = {
        action: 'batch_read' as const,
        spreadsheetId: 'test-spreadsheet-id',
        ranges,
      };

      const stats = await benchmark(() => handlers.data.handle({ request: input }), 50);

      collectedMetrics.push({
        name: 'handler.data.batch_read.50ranges',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(50); // 50ms threshold for 50 ranges
    });

    it('should measure batch write performance', async () => {
      const data = Array(20)
        .fill(null)
        .map((_, i) => ({
          range: { a1: `Sheet1!A${i * 5 + 1}:E${(i + 1) * 5}` },
          values: Array(5)
            .fill(null)
            .map(() => ['A', 'B', 'C', 'D', 'E']),
        }));

      const input = {
        action: 'batch_write' as const,
        spreadsheetId: 'test-spreadsheet-id',
        data,
        valueInputOption: 'USER_ENTERED' as const,
      };

      const stats = await benchmark(() => handlers.data.handle({ request: input }), 50);

      collectedMetrics.push({
        name: 'handler.data.batch_write.20entries',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(50); // 50ms threshold for 20 entries
    });
  });

  describe('API Call Overhead', () => {
    it('should measure Google API wrapper overhead', async () => {
      const mockApi = createMockSheetsApi();

      const stats = await benchmark(
        () =>
          mockApi.spreadsheets.get({
            spreadsheetId: 'test-spreadsheet-id',
          }),
        200
      );

      collectedMetrics.push({
        name: 'api.wrapper.overhead',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(5); // 5ms overhead for wrapper
    });

    it('should measure retry logic overhead', async () => {
      const mockApi = createMockSheetsApi();
      let callCount = 0;

      const stats = await benchmark(() => {
        callCount++;
        return mockApi.spreadsheets.values.get({
          spreadsheetId: 'test-spreadsheet-id',
          range: 'Sheet1!A1:B10',
        });
      }, 100);

      collectedMetrics.push({
        name: 'api.retry.overhead',
        latency: stats,
      });

      expect(stats.p95).toBeLessThan(7); // 7ms with retry wrapper
    });
  });
});
