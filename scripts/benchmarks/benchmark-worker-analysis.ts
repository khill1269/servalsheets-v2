/**
 * Benchmark: Worker Pool Analysis Performance
 *
 * Compares main thread vs worker thread performance for large dataset analysis.
 * Target: 75% performance improvement for 100K+ rows
 */

import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { WorkerPool } from '../../src/services/worker-pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate synthetic dataset
function generateDataset(rows: number, cols: number): number[][] {
  const data: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      // Create realistic patterns
      row.push(i * (j + 1) + Math.random() * 10);
    }
    data.push(row);
  }
  return data;
}

// Main thread analysis (using helpers)
async function analyzeInMainThread(data: unknown[][]): Promise<number> {
  const { analyzeTrends, detectAnomalies, analyzeCorrelationsData } =
    await import('../../dist/analysis/helpers.js');

  const startTime = performance.now();

  analyzeTrends(data);
  detectAnomalies(data);
  analyzeCorrelationsData(data);

  return performance.now() - startTime;
}

// Worker thread analysis
async function analyzeInWorker(pool: WorkerPool, data: unknown[][]): Promise<number> {
  const startTime = performance.now();

  await pool.execute('analysis', {
    operation: 'fullAnalysis',
    data,
  });

  return performance.now() - startTime;
}

async function main() {
  console.log('🔬 Worker Pool Analysis Benchmark\n');
  console.log('═'.repeat(60));

  const workerScriptPath = resolve(__dirname, '../../dist/workers/analysis-worker.js');
  const pool = new WorkerPool({
    poolSize: 4,
    taskTimeout: 60000,
  });
  pool.registerWorker('analysis', workerScriptPath);

  const testCases = [
    { rows: 1000, cols: 5, name: '1K rows (baseline)' },
    { rows: 10000, cols: 5, name: '10K rows (threshold)' },
    { rows: 50000, cols: 5, name: '50K rows (medium)' },
    { rows: 100000, cols: 5, name: '100K rows (target)' },
  ];

  for (const testCase of testCases) {
    console.log(`\n📊 ${testCase.name}`);
    console.log('─'.repeat(60));

    const data = generateDataset(testCase.rows, testCase.cols);

    // Warmup
    if (testCase.rows === 1000) {
      await analyzeInMainThread(data);
      await analyzeInWorker(pool, data);
    }

    // Main thread benchmark
    const mainThreadTime = await analyzeInMainThread(data);
    console.log(`  Main Thread:  ${mainThreadTime.toFixed(2)}ms`);

    // Worker thread benchmark
    const workerTime = await analyzeInWorker(pool, data);
    console.log(`  Worker Pool:  ${workerTime.toFixed(2)}ms`);

    // Calculate improvement
    const improvement = ((mainThreadTime - workerTime) / mainThreadTime) * 100;
    const speedup = mainThreadTime / workerTime;

    console.log(`  Improvement:  ${improvement.toFixed(1)}%`);
    console.log(`  Speedup:      ${speedup.toFixed(2)}x`);

    if (improvement >= 75) {
      console.log('  ✅ Target achieved (75%+ improvement)');
    } else if (improvement >= 50) {
      console.log('  ⚠️  Significant improvement but below target');
    } else {
      console.log('  ❌ Below expectations');
    }
  }

  console.log('\n' + '═'.repeat(60));

  // Pool statistics
  const stats = pool.getStats();
  console.log('\n📈 Worker Pool Statistics:');
  console.log(`  Pool Size:       ${stats.poolSize}`);
  console.log(`  Active Workers:  ${stats.activeWorkers}`);
  console.log(`  Total Tasks:     ${stats.totalTasks}`);
  console.log(`  Total Errors:    ${stats.totalErrors}`);

  await pool.shutdown();
  console.log('\n✅ Benchmark complete\n');
}

main().catch((error) => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});
