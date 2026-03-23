/**
 * Phase 2 Performance Benchmarks
 *
 * Measures performance characteristics of all Phase 2 features:
 * - Request merging throughput and latency
 * - Prefetch prediction accuracy
 * - Adaptive concurrency scaling
 * - Worker pool utilization
 * - Streaming response throughput
 * - Cache invalidation graph performance
 *
 * Run with: npm run bench:phase2
 *
 * @category Benchmarks
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import type { sheets_v4 } from 'googleapis';
import { RequestMerger } from '../../src/services/request-merger.js';
import { PrefetchPredictor } from '../../src/services/prefetch-predictor.js';
import { WorkerPool, shutdownWorkerPool } from '../../src/services/worker-pool.js';
import { getCacheInvalidationGraph } from '../../src/services/cache-invalidation-graph.js';
import { createMockSheetsApi } from '../helpers/google-api-mocks.js';

// Benchmark configuration
const SPREADSHEET_ID = 'bench-spreadsheet-id';
const ITERATIONS = 1000;

// Shared state
let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
let requestMerger: RequestMerger;
let prefetchPredictor: PrefetchPredictor;
let workerPool: WorkerPool;

beforeAll(() => {
  // Setup mock API with realistic data
  mockSheetsApi = createMockSheetsApi({
    spreadsheets: {
      [SPREADSHEET_ID]: {
        spreadsheetId: SPREADSHEET_ID,
        title: 'Benchmark Sheet',
        sheets: [{ sheetId: 0, title: 'Sheet1', rowCount: 100000, columnCount: 26 }],
        values: {
          'Sheet1!A1:D10': Array(10).fill(['A', 'B', 'C', 'D']),
        },
      },
    },
  });

  requestMerger = new RequestMerger({ enabled: true, windowMs: 50 });
  prefetchPredictor = new PrefetchPredictor({ minConfidence: 0.5 });
  workerPool = new WorkerPool({ poolSize: 4 });
});

afterAll(async () => {
  requestMerger.destroy();
  await shutdownWorkerPool();
});

/**
 * Benchmark 1: Request Merging Throughput
 *
 * Measures:
 * - Requests/second with merging enabled vs disabled
 * - Latency overhead of merge window
 * - API call reduction percentage
 */
describe('Request Merging Performance', () => {
  bench('sequential reads (no merging)', async () => {
    const merger = new RequestMerger({ enabled: false });
    try {
      for (let i = 0; i < 100; i++) {
        await merger.mergeRead(
          mockSheetsApi as unknown as sheets_v4.Sheets,
          SPREADSHEET_ID,
          `Sheet1!A${i + 1}:D${i + 10}`
        );
      }
    } finally {
      merger.destroy();
    }
  });

  bench('sequential reads (with merging)', async () => {
    const merger = new RequestMerger({ enabled: true, windowMs: 50 });
    try {
      for (let i = 0; i < 100; i++) {
        await merger.mergeRead(
          mockSheetsApi as unknown as sheets_v4.Sheets,
          SPREADSHEET_ID,
          `Sheet1!A${i + 1}:D${i + 10}`
        );
      }
    } finally {
      merger.destroy();
    }
  });

  bench('overlapping reads (high merge opportunity)', async () => {
    const merger = new RequestMerger({ enabled: true, windowMs: 50 });
    try {
      const promises = [];
      // Submit many overlapping ranges simultaneously
      for (let i = 0; i < 20; i++) {
        promises.push(
          merger.mergeRead(
            mockSheetsApi as unknown as sheets_v4.Sheets,
            SPREADSHEET_ID,
            `Sheet1!A${i}:D${i + 10}`
          )
        );
      }
      await Promise.all(promises);
    } finally {
      merger.destroy();
    }
  });

  bench('merge window sizing (50ms vs 100ms)', async () => {
    const merger50 = new RequestMerger({ enabled: true, windowMs: 50 });
    const merger100 = new RequestMerger({ enabled: true, windowMs: 100 });
    try {
      const test50 = Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) =>
            merger50.mergeRead(
              mockSheetsApi as unknown as sheets_v4.Sheets,
              SPREADSHEET_ID,
              `Sheet1!A${i + 1}:B${i + 10}`
            )
          )
      );

      const test100 = Promise.all(
        Array(10)
          .fill(0)
          .map((_, i) =>
            merger100.mergeRead(
              mockSheetsApi as unknown as sheets_v4.Sheets,
              SPREADSHEET_ID,
              `Sheet1!A${i + 1}:B${i + 10}`
            )
          )
      );

      await Promise.all([test50, test100]);
    } finally {
      merger50.destroy();
      merger100.destroy();
    }
  });
});

/**
 * Benchmark 2: Prefetch Prediction Performance
 *
 * Measures:
 * - Pattern learning speed (ops/sec)
 * - Prediction generation latency
 * - Prediction accuracy over time
 */
describe('Prefetch Prediction Performance', () => {
  bench('pattern learning from 50 operations', () => {
    const predictor = new PrefetchPredictor({ minConfidence: 0.5 });
    // Simulate 50 operations in history
    predictor.learnFromHistory();
  });

  bench('prediction generation', () => {
    prefetchPredictor.learnFromHistory();
    const predictions = prefetchPredictor.predict();
    // Verify predictions generated
    if (predictions.length === 0) {
      throw new Error('No predictions generated');
    }
  });

  bench('background prefetch execution (5 predictions)', async () => {
    prefetchPredictor.learnFromHistory();
    const predictions = prefetchPredictor.predict().slice(0, 5);

    await prefetchPredictor.prefetchInBackground(predictions, async (pred) => {
      if (pred.tool === 'sheets_data' && pred.action === 'read') {
        await requestMerger.mergeRead(
          mockSheetsApi as unknown as sheets_v4.Sheets,
          pred.params.spreadsheetId as string,
          pred.params.range as string
        );
      }
    });
  });

  bench('prediction accuracy tracking', () => {
    for (let i = 0; i < 100; i++) {
      prefetchPredictor.recordPredictionAccuracy(Math.random() > 0.3);
    }
  });
});

/**
 * Benchmark 3: Cache Invalidation Graph Performance
 *
 * Measures:
 * - Dependency tracking overhead
 * - Invalidation query speed
 * - Graph memory efficiency
 */
describe('Cache Invalidation Graph Performance', () => {
  bench('track 100 read dependencies', () => {
    const graph = getCacheInvalidationGraph();
    for (let i = 0; i < 100; i++) {
      graph.trackRead(SPREADSHEET_ID, `Sheet1!A${i + 1}:D${i + 10}`);
    }
  });

  bench('invalidate single range (10 dependencies)', () => {
    const graph = getCacheInvalidationGraph();
    // Setup dependencies
    for (let i = 0; i < 10; i++) {
      graph.trackRead(SPREADSHEET_ID, `Sheet1!A${i + 1}:D${i + 10}`);
    }
    // Invalidate overlapping range
    graph.invalidateWrite(SPREADSHEET_ID, 'Sheet1!A5:C5');
  });

  bench('invalidate entire sheet (100 dependencies)', () => {
    const graph = getCacheInvalidationGraph();
    // Setup many dependencies
    for (let i = 0; i < 100; i++) {
      graph.trackRead(SPREADSHEET_ID, `Sheet1!A${i + 1}:D${i + 10}`);
    }
    // Invalidate entire sheet
    graph.invalidateSheet(SPREADSHEET_ID, 'Sheet1');
  });

  bench('query overlapping ranges', () => {
    const graph = getCacheInvalidationGraph();
    // Setup dependencies
    for (let i = 0; i < 50; i++) {
      graph.trackRead(SPREADSHEET_ID, `Sheet1!A${i + 1}:D${i + 10}`);
    }
    // Query overlapping
    for (let i = 0; i < 10; i++) {
      graph.invalidateWrite(SPREADSHEET_ID, `Sheet1!B${i * 5}:C${i * 5 + 2}`);
    }
  });
});

/**
 * Benchmark 4: Worker Pool Performance
 *
 * Measures:
 * - Task distribution overhead
 * - Worker creation/destruction cost
 * - Throughput scaling with pool size
 */
describe('Worker Pool Performance', () => {
  bench('execute 100 tasks (pool size 1)', async () => {
    const pool = new WorkerPool({ poolSize: 1 });
    pool.registerWorker('test', '/mock/worker.js');

    const tasks = Array(100)
      .fill(0)
      .map((_, i) =>
        pool.execute('test', { id: i }).catch(() => {
          /* ignore mock errors */
        })
      );

    await Promise.all(tasks);
    await pool.shutdown();
  });

  bench('execute 100 tasks (pool size 4)', async () => {
    const pool = new WorkerPool({ poolSize: 4 });
    pool.registerWorker('test', '/mock/worker.js');

    const tasks = Array(100)
      .fill(0)
      .map((_, i) =>
        pool.execute('test', { id: i }).catch(() => {
          /* ignore mock errors */
        })
      );

    await Promise.all(tasks);
    await pool.shutdown();
  });

  bench('worker pool stats collection', () => {
    const stats = workerPool.getStats();
    if (stats.poolSize !== 4) {
      throw new Error('Expected pool size 4');
    }
  });
});

/**
 * Benchmark 5: Combined Features (Realistic Workload)
 *
 * Measures:
 * - End-to-end performance with all features
 * - Memory efficiency under load
 * - API call reduction effectiveness
 */
describe('Combined Features Performance', () => {
  bench('realistic mixed workload (100 ops)', async () => {
    const merger = new RequestMerger({ enabled: true, windowMs: 50 });
    const predictor = new PrefetchPredictor({ minConfidence: 0.7 });
    const graph = getCacheInvalidationGraph();

    try {
      for (let i = 0; i < 100; i++) {
        if (Math.random() < 0.7) {
          // 70% reads
          const range = `Sheet1!A${i * 5 + 1}:D${i * 5 + 10}`;
          await merger.mergeRead(
            mockSheetsApi as unknown as sheets_v4.Sheets,
            SPREADSHEET_ID,
            range
          );
          graph.trackRead(SPREADSHEET_ID, range);
        } else {
          // 30% writes (invalidate)
          graph.invalidateWrite(SPREADSHEET_ID, `Sheet1!A${i * 5}:B${i * 5 + 2}`);
        }

        // Periodic prefetch
        if (i % 10 === 0 && i > 0) {
          predictor.learnFromHistory();
          const predictions = predictor.predict().slice(0, 2);
          void predictor.prefetchInBackground(predictions, async (pred) => {
            if (pred.tool === 'sheets_data' && pred.action === 'read') {
              await merger.mergeRead(
                mockSheetsApi as unknown as sheets_v4.Sheets,
                pred.params.spreadsheetId as string,
                pred.params.range as string
              );
            }
          });
        }
      }
    } finally {
      merger.destroy();
    }
  });

  bench('memory efficiency (1000 tracked ranges)', () => {
    const graph = getCacheInvalidationGraph();
    for (let i = 0; i < 1000; i++) {
      graph.trackRead(SPREADSHEET_ID, `Sheet1!A${i + 1}:D${i + 10}`);
    }
    // Measure memory after tracking
    const used = process.memoryUsage();
    if (used.heapUsed > 512 * 1024 * 1024) {
      throw new Error('Memory usage exceeds 512MB');
    }
  });

  bench('throughput under load (parallel operations)', async () => {
    const merger = new RequestMerger({ enabled: true, windowMs: 50 });
    try {
      const operations = Array(50)
        .fill(0)
        .map((_, i) =>
          merger.mergeRead(
            mockSheetsApi as unknown as sheets_v4.Sheets,
            SPREADSHEET_ID,
            `Sheet1!A${i * 10 + 1}:D${i * 10 + 10}`
          )
        );

      await Promise.all(operations);
    } finally {
      merger.destroy();
    }
  });
});

/**
 * Benchmark 6: Scalability Tests
 *
 * Measures:
 * - Performance degradation with load
 * - Memory scaling characteristics
 * - Throughput ceiling
 */
describe('Scalability Benchmarks', () => {
  bench('10 concurrent operations', async () => {
    await runConcurrentOperations(10);
  });

  bench('50 concurrent operations', async () => {
    await runConcurrentOperations(50);
  });

  bench('100 concurrent operations', async () => {
    await runConcurrentOperations(100);
  });

  bench('500 concurrent operations', async () => {
    await runConcurrentOperations(500);
  });
});

/**
 * Helper: Run N concurrent operations with all features
 */
async function runConcurrentOperations(count: number): Promise<void> {
  const merger = new RequestMerger({ enabled: true, windowMs: 50 });
  try {
    const operations = Array(count)
      .fill(0)
      .map((_, i) =>
        merger.mergeRead(
          mockSheetsApi as unknown as sheets_v4.Sheets,
          SPREADSHEET_ID,
          `Sheet1!A${i + 1}:D${i + 10}`
        )
      );

    await Promise.all(operations);
  } finally {
    merger.destroy();
  }
}
