/**
 * Benchmark: Adaptive vs Fixed Batch Window
 *
 * Compares batching efficiency between fixed window and adaptive window
 * under various traffic patterns.
 */

import { sheets_v4 } from 'googleapis';
import { BatchingSystem, type BatchingStats } from '../src/services/batching-system.js';

// Mock Google Sheets API
const createMockSheetsApi = (): sheets_v4.Sheets => {
  return {
    spreadsheets: {
      values: {
        batchUpdate: async () => ({
          data: {
            responses: Array(100)
              .fill(null)
              .map(() => ({ updatedCells: 1 })),
          },
        }),
      },
      get: async () => ({
        data: {
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
              },
            },
          ],
        },
      }),
    },
  } as unknown as sheets_v4.Sheets;
};

interface BenchmarkResult {
  scenario: string;
  fixed: BatchingStats;
  adaptive: BatchingStats;
  improvement: {
    batchSizeIncrease: number;
    apiCallReduction: number;
    avgWindowChange?: number;
  };
}

/**
 * Traffic pattern generators
 */
const trafficPatterns = {
  /**
   * Steady low traffic - 1 operation every 100ms
   */
  steadyLow: async (system: BatchingSystem, duration: number): Promise<void> => {
    const count = duration / 100;
    for (let i = 0; i < count; i++) {
      void system.execute({
        id: `op-${i}`,
        type: 'values:update',
        spreadsheetId: 'test-sheet',
        params: {
          range: `Sheet1!A${i + 1}`,
          values: [['test']],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },

  /**
   * Steady high traffic - 10 operations every 50ms
   */
  steadyHigh: async (system: BatchingSystem, duration: number): Promise<void> => {
    const count = duration / 50;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 10; j++) {
        void system.execute({
          id: `op-${i}-${j}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${i * 10 + j + 1}`,
            values: [['test']],
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  },

  /**
   * Bursty traffic - alternating high and idle periods
   */
  bursty: async (system: BatchingSystem, duration: number): Promise<void> => {
    const cycles = duration / 500;
    for (let i = 0; i < cycles; i++) {
      // Burst: 30 operations quickly
      for (let j = 0; j < 30; j++) {
        void system.execute({
          id: `op-${i}-${j}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${i * 30 + j + 1}`,
            values: [['test']],
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Idle: 400ms pause
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  },

  /**
   * Gradual ramp up - increasing traffic over time
   */
  rampUp: async (system: BatchingSystem, duration: number): Promise<void> => {
    const steps = 10;
    const stepDuration = duration / steps;

    for (let step = 0; step < steps; step++) {
      const opsPerStep = (step + 1) * 5; // 5, 10, 15, ... 50
      for (let i = 0; i < opsPerStep; i++) {
        void system.execute({
          id: `op-${step}-${i}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${step * 100 + i + 1}`,
            values: [['test']],
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, stepDuration));
    }
  },

  /**
   * Variable traffic - random patterns
   */
  variable: async (system: BatchingSystem, duration: number): Promise<void> => {
    const interval = 100;
    const count = duration / interval;

    for (let i = 0; i < count; i++) {
      // Random number of operations (0-20)
      const ops = Math.floor(Math.random() * 20);
      for (let j = 0; j < ops; j++) {
        void system.execute({
          id: `op-${i}-${j}`,
          type: 'values:update',
          spreadsheetId: 'test-sheet',
          params: {
            range: `Sheet1!A${i * 20 + j + 1}`,
            values: [['test']],
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  },
};

/**
 * Run a single benchmark scenario
 */
async function runScenario(
  scenario: string,
  pattern: (system: BatchingSystem, duration: number) => Promise<void>,
  duration: number
): Promise<BenchmarkResult> {
  console.log(`\nRunning scenario: ${scenario}`);

  // Test with fixed window
  console.log('  Testing fixed window...');
  const sheetsApi1 = createMockSheetsApi();
  const fixedSystem = new BatchingSystem(sheetsApi1, {
    adaptiveWindow: false,
    windowMs: 50,
    verboseLogging: false,
  });

  await pattern(fixedSystem, duration);
  await fixedSystem.flush();
  const fixedStats = fixedSystem.getStats();
  fixedSystem.destroy();

  // Test with adaptive window
  console.log('  Testing adaptive window...');
  const sheetsApi2 = createMockSheetsApi();
  const adaptiveSystem = new BatchingSystem(sheetsApi2, {
    adaptiveWindow: true,
    adaptiveConfig: {
      minWindowMs: 20,
      maxWindowMs: 200,
      initialWindowMs: 50,
      lowThreshold: 3,
      highThreshold: 50,
    },
    verboseLogging: false,
  });

  await pattern(adaptiveSystem, duration);
  await adaptiveSystem.flush();
  const adaptiveStats = adaptiveSystem.getStats();
  adaptiveSystem.destroy();

  // Calculate improvements
  const batchSizeIncrease =
    fixedStats.avgBatchSize > 0
      ? ((adaptiveStats.avgBatchSize - fixedStats.avgBatchSize) / fixedStats.avgBatchSize) * 100
      : 0;

  const apiCallReduction =
    fixedStats.totalApiCalls > 0
      ? ((fixedStats.totalApiCalls - adaptiveStats.totalApiCalls) / fixedStats.totalApiCalls) * 100
      : 0;

  const avgWindowChange = adaptiveStats.avgWindowMs ? adaptiveStats.avgWindowMs - 50 : undefined;

  return {
    scenario,
    fixed: fixedStats,
    adaptive: adaptiveStats,
    improvement: {
      batchSizeIncrease,
      apiCallReduction,
      avgWindowChange,
    },
  };
}

/**
 * Format stats for display
 */
function formatStats(stats: BatchingStats): string {
  return [
    `Total Operations: ${stats.totalOperations}`,
    `Total Batches: ${stats.totalBatches}`,
    `Total API Calls: ${stats.totalApiCalls}`,
    `Avg Batch Size: ${stats.avgBatchSize.toFixed(2)}`,
    `API Call Reduction: ${stats.reductionPercentage.toFixed(1)}%`,
    stats.currentWindowMs ? `Current Window: ${stats.currentWindowMs}ms` : null,
    stats.avgWindowMs ? `Avg Window: ${stats.avgWindowMs}ms` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Main benchmark execution
 */
async function main() {
  console.log('='.repeat(70));
  console.log('Adaptive vs Fixed Batch Window Benchmark');
  console.log('='.repeat(70));

  const results: BenchmarkResult[] = [];

  // Run all scenarios
  results.push(await runScenario('Steady Low Traffic', trafficPatterns.steadyLow, 2000));
  results.push(await runScenario('Steady High Traffic', trafficPatterns.steadyHigh, 2000));
  results.push(await runScenario('Bursty Traffic', trafficPatterns.bursty, 3000));
  results.push(await runScenario('Ramp Up', trafficPatterns.rampUp, 2000));
  results.push(await runScenario('Variable Traffic', trafficPatterns.variable, 2000));

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(70));

  for (const result of results) {
    console.log(`\n${result.scenario}`);
    console.log('-'.repeat(70));
    console.log('Fixed Window:');
    console.log('  ' + formatStats(result.fixed));
    console.log('Adaptive Window:');
    console.log('  ' + formatStats(result.adaptive));
    console.log('Improvement:');
    console.log(
      `  Batch Size: ${result.improvement.batchSizeIncrease >= 0 ? '+' : ''}${result.improvement.batchSizeIncrease.toFixed(1)}%`
    );
    console.log(
      `  API Calls: ${result.improvement.apiCallReduction >= 0 ? '-' : '+'}${Math.abs(result.improvement.apiCallReduction).toFixed(1)}%`
    );
    if (result.improvement.avgWindowChange !== undefined) {
      console.log(
        `  Window Size: ${result.improvement.avgWindowChange >= 0 ? '+' : ''}${result.improvement.avgWindowChange.toFixed(0)}ms`
      );
    }
  }

  // Overall statistics
  console.log('\n' + '='.repeat(70));
  console.log('OVERALL PERFORMANCE');
  console.log('='.repeat(70));

  const avgBatchSizeImprovement =
    results.reduce((sum, r) => sum + r.improvement.batchSizeIncrease, 0) / results.length;
  const avgApiCallReduction =
    results.reduce((sum, r) => sum + r.improvement.apiCallReduction, 0) / results.length;

  console.log(
    `Average Batch Size Improvement: ${avgBatchSizeImprovement >= 0 ? '+' : ''}${avgBatchSizeImprovement.toFixed(1)}%`
  );
  console.log(
    `Average API Call Reduction: ${avgApiCallReduction >= 0 ? '-' : '+'}${Math.abs(avgApiCallReduction).toFixed(1)}%`
  );

  // Determine winner
  const adaptiveWins = results.filter(
    (r) => r.improvement.batchSizeIncrease > 0 || r.improvement.apiCallReduction > 0
  ).length;

  console.log(`\nAdaptive window wins in ${adaptiveWins}/${results.length} scenarios`);

  if (adaptiveWins > results.length / 2) {
    console.log('\n✓ ADAPTIVE WINDOW RECOMMENDED: Better performance in most scenarios');
  } else {
    console.log('\n⚠ FIXED WINDOW ACCEPTABLE: Similar performance overall');
  }

  console.log('\n' + '='.repeat(70));
}

// Run benchmark
main().catch(console.error);
