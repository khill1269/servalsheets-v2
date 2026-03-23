/**
 * Performance Regression Tests
 *
 * Establishes baseline performance metrics and detects regressions.
 * Run with: npm run bench
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';

// Import schemas for validation benchmarks
import {
  SheetsDataInputSchema,
  SheetsCoreInputSchema,
  SheetsFormatInputSchema,
  SheetsVisualizeInputSchema,
} from '../../src/schemas/index.js';

// Import mocks for handler benchmarks
import { createMockSheetsApi, createMockContext } from '../helpers/google-api-mocks.js';

/**
 * Performance thresholds (in milliseconds)
 * These should be updated based on baseline measurements
 */
const THRESHOLDS = {
  // Schema validation should be fast
  schemaValidation: {
    simple: 5, // Simple inputs
    complex: 15, // Complex nested inputs
    batch: 50, // Batch operations
  },
  // Mock handler execution (no real API calls)
  handlerExecution: {
    simple: 10,
    complex: 30,
  },
  // Memory allocation thresholds (bytes)
  // Note: Large data validation (1000x26 arrays) requires more memory
  // 10 iterations of 1000x26 Zod validation can use ~25MB heap
  memory: {
    schemaValidation: 30 * 1024 * 1024, // 30MB for large validations
    handlerExecution: 5 * 1024 * 1024, // 5MB
  },
};

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
 * Measure memory usage around a function
 */
function measureMemory<T>(fn: () => T): { result: T; usedBytes: number } {
  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;
  const result = fn();
  const after = process.memoryUsage().heapUsed;

  return { result, usedBytes: Math.max(0, after - before) };
}

describe('Performance Regression Tests', () => {
  describe('Schema Validation Performance', () => {
    describe('Simple Inputs', () => {
      it('sheets_core get validation should be fast', async () => {
        const input = {
          request: {
            action: 'get' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
          },
        };

        const stats = await benchmark(() => SheetsCoreInputSchema.safeParse(input));

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.simple);
        console.log(
          `sheets_core get validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });

      it('sheets_data read validation should be fast', async () => {
        const input = {
          request: {
            action: 'read' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
            range: { a1: 'Sheet1!A1:B10' },
          },
        };

        const stats = await benchmark(() => SheetsDataInputSchema.safeParse(input));

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.simple);
        console.log(
          `sheets_data read validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });
    });

    describe('Complex Inputs', () => {
      it('sheets_data write with large values should be acceptable', async () => {
        const largeValues = Array(100)
          .fill(null)
          .map((_, i) => Array(20).fill(`value-${i}`));

        const input = {
          request: {
            action: 'write' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
            range: { a1: 'Sheet1!A1:T100' },
            values: largeValues,
            valueInputOption: 'USER_ENTERED',
          },
        };

        const stats = await benchmark(() => SheetsDataInputSchema.safeParse(input), 50);

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.complex);
        console.log(
          `sheets_data write (100x20) validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });

      it('sheets_visualize chart_create should be acceptable', async () => {
        const input = {
          request: {
            action: 'chart_create' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
            sheetId: 0,
            chartType: 'LINE' as const,
            data: {
              sourceRange: { a1: 'Sheet1!A1:D100' },
            },
            position: {
              anchorCell: 'F1',
              offsetX: 10,
              offsetY: 10,
            },
            options: {
              title: 'Sales Trend',
              legend: { position: 'BOTTOM' },
              hAxis: { title: 'Month' },
              vAxis: { title: 'Sales ($)' },
            },
          },
        };

        const stats = await benchmark(() => SheetsVisualizeInputSchema.safeParse(input));

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.complex);
        console.log(
          `sheets_visualize chart_create validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });

      it('sheets_format with nested format options should be acceptable', async () => {
        const input = {
          request: {
            action: 'set_format' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
            range: { a1: 'Sheet1!A1:Z100' },
            format: {
              backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
              textFormat: {
                bold: true,
                italic: false,
                fontSize: 12,
                fontFamily: 'Arial',
                foregroundColor: { red: 0, green: 0, blue: 0.5 },
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'WRAP',
              padding: { top: 2, right: 4, bottom: 2, left: 4 },
            },
          },
        };

        const stats = await benchmark(() => SheetsFormatInputSchema.safeParse(input));

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.complex);
        console.log(
          `sheets_format set_format validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });
    });

    describe('Batch Inputs', () => {
      it('sheets_data batch_read with many ranges should be acceptable', async () => {
        const ranges = Array(50)
          .fill(null)
          .map((_, i) => ({ a1: `Sheet${(i % 5) + 1}!A${i * 10 + 1}:Z${(i + 1) * 10}` }));

        const input = {
          request: {
            action: 'batch_read' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
            ranges,
          },
        };

        const stats = await benchmark(() => SheetsDataInputSchema.safeParse(input), 50);

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.batch);
        console.log(
          `sheets_data batch_read (50 ranges) validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });

      it('sheets_data batch_write with many data entries should be acceptable', async () => {
        const data = Array(20)
          .fill(null)
          .map((_, i) => ({
            range: { a1: `Sheet1!A${i * 5 + 1}:E${(i + 1) * 5}` },
            values: Array(5)
              .fill(null)
              .map(() => ['A', 'B', 'C', 'D', 'E']),
          }));

        const input = {
          request: {
            action: 'batch_write' as const,
            spreadsheetId: 'test-spreadsheet-id-12345',
            data,
            valueInputOption: 'USER_ENTERED',
          },
        };

        const stats = await benchmark(() => SheetsDataInputSchema.safeParse(input), 50);

        expect(stats.p95).toBeLessThan(THRESHOLDS.schemaValidation.batch);
        console.log(
          `sheets_data batch_write (20 entries) validation: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
        );
      });
    });
  });

  describe('Memory Usage', () => {
    it.skipIf(typeof global.gc !== 'function')(
      'schema validation should not allocate excessive memory',
      () => {
        const largeValues = Array(1000)
          .fill(null)
          .map((_, i) => Array(26).fill(`value-${i}`));

        const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test-spreadsheet-id-12345',
          range: { a1: 'Sheet1!A1:Z1000' },
          values: largeValues,
        },
      };

        const { usedBytes } = measureMemory(() => {
          for (let i = 0; i < 10; i++) {
            SheetsDataInputSchema.safeParse(input);
          }
        });

        expect(usedBytes).toBeLessThan(THRESHOLDS.memory.schemaValidation);
        console.log(`Memory for 10 large validations: ${(usedBytes / 1024).toFixed(2)}KB`);
      }
    );
  });

  describe('Mock Handler Performance', () => {
    let mockApi: ReturnType<typeof createMockSheetsApi>;

    beforeAll(() => {
      mockApi = createMockSheetsApi();
    });

    it('spreadsheets.get mock should respond quickly', async () => {
      const stats = await benchmark(
        () =>
          mockApi.spreadsheets.get({
            spreadsheetId: 'test-spreadsheet-id',
          }),
        100
      );

      expect(stats.p95).toBeLessThan(THRESHOLDS.handlerExecution.simple);
      console.log(
        `Mock spreadsheets.get: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
      );
    });

    it('spreadsheets.values.get mock should respond quickly', async () => {
      const stats = await benchmark(
        () =>
          mockApi.spreadsheets.values.get({
            spreadsheetId: 'test-spreadsheet-id',
            range: 'Sheet1!A1:D10',
          }),
        100
      );

      expect(stats.p95).toBeLessThan(THRESHOLDS.handlerExecution.simple);
      console.log(
        `Mock values.get: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
      );
    });

    it('spreadsheets.batchUpdate mock should respond quickly', async () => {
      const stats = await benchmark(
        () =>
          mockApi.spreadsheets.batchUpdate({
            spreadsheetId: 'test-spreadsheet-id',
            requestBody: {
              requests: [
                { repeatCell: { range: { sheetId: 0 }, cell: {}, fields: 'userEnteredFormat' } },
              ],
            },
          }),
        100
      );

      expect(stats.p95).toBeLessThan(THRESHOLDS.handlerExecution.simple);
      console.log(
        `Mock batchUpdate: p95=${stats.p95.toFixed(2)}ms, mean=${stats.mean.toFixed(2)}ms`
      );
    });
  });

  describe('Throughput Benchmarks', () => {
    it('should handle high validation throughput', async () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: 'test-spreadsheet-id-12345',
          range: { a1: 'Sheet1!A1:B10' },
        },
      };

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        SheetsDataInputSchema.safeParse(input);
      }

      const duration = performance.now() - start;
      const throughput = (iterations / duration) * 1000;

      expect(throughput).toBeGreaterThan(1000); // At least 1000 validations/second
      console.log(
        `Validation throughput: ${throughput.toFixed(0)} ops/sec (${(duration / iterations).toFixed(3)}ms/op)`
      );
    });

    it('should handle concurrent validations efficiently', async () => {
      const inputs = Array(100)
        .fill(null)
        .map((_, i) => ({
          request: {
            action: 'read' as const,
            spreadsheetId: `spreadsheet-${i}`,
            range: { a1: `Sheet1!A${i + 1}:B${i + 10}` },
          },
        }));

      const start = performance.now();

      await Promise.all(
        inputs.map((input) => Promise.resolve(SheetsDataInputSchema.safeParse(input)))
      );

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100); // 100 concurrent validations under 100ms
      console.log(`100 concurrent validations: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Regression Baselines (P2-6)', () => {
    /**
     * P2-6: Load baselines from performance-baselines.json
     * Tests fail if performance regresses >10% from baseline
     */
    let baselines: any;

    beforeAll(async () => {
      try {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const baselinesPath = join(process.cwd(), 'performance-baselines.json');
        baselines = JSON.parse(readFileSync(baselinesPath, 'utf-8'));
      } catch (error) {
        // Fall back to hardcoded baselines if file not found
        baselines = {
          baselines: {
            schemaValidation: {
              coreGet: { p95ms: 3 },
              dataRead: { p95ms: 3 },
              dataWriteLarge: { p95ms: 10 },
              formatComplex: { p95ms: 5 },
            },
          },
          regressionThreshold: 0.1,
        };
      }
    });

    it('core get validation should not regress', async () => {
      const input = {
        request: { action: 'get' as const, spreadsheetId: 'test' },
      };

      const stats = await benchmark(() => SheetsCoreInputSchema.safeParse(input), 200);
      const baseline = baselines.baselines.schemaValidation.coreGet.p95ms;
      const threshold = baseline * (1 + baselines.regressionThreshold);

      expect(stats.p95).toBeLessThan(threshold);

      if (stats.p95 > baseline) {
        const regressionPct = (((stats.p95 - baseline) / baseline) * 100).toFixed(1);
        console.warn(
          `⚠️  Performance regression: ${regressionPct}% slower (${stats.p95.toFixed(2)}ms vs ${baseline}ms baseline)`
        );
      }
    });

    it('data read validation should not regress', async () => {
      const input = {
        request: {
          action: 'read' as const,
          spreadsheetId: 'test',
          range: { a1: 'Sheet1!A1:Z100' },
        },
      };

      const stats = await benchmark(() => SheetsDataInputSchema.safeParse(input), 200);
      const baseline = baselines.baselines.schemaValidation.dataRead.p95ms;
      const threshold = baseline * (1 + baselines.regressionThreshold);

      expect(stats.p95).toBeLessThan(threshold);

      if (stats.p95 > baseline) {
        const regressionPct = (((stats.p95 - baseline) / baseline) * 100).toFixed(1);
        console.warn(
          `⚠️  Performance regression: ${regressionPct}% slower (${stats.p95.toFixed(2)}ms vs ${baseline}ms baseline)`
        );
      }
    });

    it('data write large validation should not regress', async () => {
      const input = {
        request: {
          action: 'write' as const,
          spreadsheetId: 'test',
          range: { a1: 'Sheet1!A1:Z100' },
          values: Array(100)
            .fill(null)
            .map(() => Array(26).fill('x')),
        },
      };

      const stats = await benchmark(() => SheetsDataInputSchema.safeParse(input), 100);
      const baseline = baselines.baselines.schemaValidation.dataWriteLarge.p95ms;
      const threshold = baseline * (1 + baselines.regressionThreshold);

      expect(stats.p95).toBeLessThan(threshold);

      if (stats.p95 > baseline) {
        const regressionPct = (((stats.p95 - baseline) / baseline) * 100).toFixed(1);
        console.warn(
          `⚠️  Performance regression: ${regressionPct}% slower (${stats.p95.toFixed(2)}ms vs ${baseline}ms baseline)`
        );
      }
    });

    it('format complex validation should not regress', async () => {
      const input = {
        request: {
          action: 'set_format' as const,
          spreadsheetId: 'test',
          range: { a1: 'Sheet1!A1:Z100' },
          format: {
            backgroundColor: { red: 1, green: 1, blue: 1 },
            textFormat: { bold: true, fontSize: 12 },
            horizontalAlignment: 'CENTER',
          },
        },
      };

      const stats = await benchmark(() => SheetsFormatInputSchema.safeParse(input), 200);
      const baseline = baselines.baselines.schemaValidation.formatComplex.p95ms;
      const threshold = baseline * (1 + baselines.regressionThreshold);

      expect(stats.p95).toBeLessThan(threshold);

      if (stats.p95 > baseline) {
        const regressionPct = (((stats.p95 - baseline) / baseline) * 100).toFixed(1);
        console.warn(
          `⚠️  Performance regression: ${regressionPct}% slower (${stats.p95.toFixed(2)}ms vs ${baseline}ms baseline)`
        );
      }
    });
  });
});
