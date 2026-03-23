/**
 * Test Optimizer - Improve test execution and coverage
 * Adds parallel execution, retry logic, and performance benchmarking
 */

export interface OptimizationConfig {
  enableParallelExecution: boolean;
  maxConcurrency: number;
  enableRetry: boolean;
  maxRetries: number;
  retryDelay: number;
  enablePerformanceBenchmark: boolean;
  performanceThresholds: {
    slow: number;
    verySlow: number;
  };
}

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  enableParallelExecution: false, // Safe default
  maxConcurrency: 5,
  enableRetry: true,
  maxRetries: 2,
  retryDelay: 1000,
  enablePerformanceBenchmark: true,
  performanceThresholds: {
    slow: 2000, // 2 seconds
    verySlow: 5000, // 5 seconds
  },
};

export interface TestCategory {
  name: string;
  tools: string[];
  actions: string[];
  canRunInParallel: boolean;
  requiresAuth: boolean;
  isReadOnly: boolean;
}

/**
 * Categorize tests for optimized execution
 */
export function categorizeTests(): Map<string, TestCategory> {
  const categories = new Map<string, TestCategory>();

  // Read-only tests (safe to parallelize)
  categories.set('read-only', {
    name: 'Read-Only Operations',
    tools: ['sheets_auth', 'sheets_core', 'sheets_data', 'sheets_analyze', 'sheets_history'],
    actions: ['status', 'get', 'list', 'read', 'find_replace', 'stats'],
    canRunInParallel: true,
    requiresAuth: false,
    isReadOnly: true,
  });

  // Write operations (sequential, requires auth)
  categories.set('write', {
    name: 'Write Operations',
    tools: ['sheets_data', 'sheets_format', 'sheets_dimensions'],
    actions: [
      'write',
      'append',
      'batch_write',
      'clear',
      'set_format',
      'insert_rows',
      'delete_rows',
    ],
    canRunInParallel: false,
    requiresAuth: true,
    isReadOnly: false,
  });

  // Admin operations (sequential, requires auth)
  categories.set('admin', {
    name: 'Administrative Operations',
    tools: ['sheets_core', 'sheets_collaborate'],
    actions: ['create', 'delete_sheet', 'copy', 'share_add', 'share_transfer_ownership'],
    canRunInParallel: false,
    requiresAuth: true,
    isReadOnly: false,
  });

  // Analysis operations (can parallelize, may require auth)
  categories.set('analysis', {
    name: 'Analysis Operations',
    tools: ['sheets_analyze', 'sheets_confirm', 'sheets_quality', 'sheets_fix'],
    actions: ['comprehensive', 'get_stats', 'validate', 'fix'],
    canRunInParallel: true,
    requiresAuth: true,
    isReadOnly: true,
  });

  return categories;
}

/**
 * Determine if a test should be retried based on error
 */
export function shouldRetry(error: any, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) return false;

  // Retry on network/timeout errors
  const retryableErrors = ['Request timeout', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'Rate limit'];

  const errorMessage = error?.message || String(error);
  return retryableErrors.some((err) => errorMessage.includes(err));
}

/**
 * Categorize performance based on duration
 */
export function categorizePerformance(
  duration: number,
  thresholds: OptimizationConfig['performanceThresholds']
): 'fast' | 'normal' | 'slow' | 'very-slow' {
  if (duration < 100) return 'fast';
  if (duration < thresholds.slow) return 'normal';
  if (duration < thresholds.verySlow) return 'slow';
  return 'very-slow';
}

/**
 * Calculate test execution strategy
 */
export function calculateExecutionStrategy(
  tests: Array<{ tool: string; action: string }>,
  config: OptimizationConfig
): {
  parallelBatches: Array<Array<{ tool: string; action: string }>>;
  sequentialTests: Array<{ tool: string; action: string }>;
} {
  const categories = categorizeTests();
  const parallelBatches: Array<Array<{ tool: string; action: string }>> = [];
  const sequentialTests: Array<{ tool: string; action: string }> = [];

  if (!config.enableParallelExecution) {
    return { parallelBatches: [], sequentialTests: tests };
  }

  // Group tests by category
  const readOnlyTests: Array<{ tool: string; action: string }> = [];
  const writeTests: Array<{ tool: string; action: string }> = [];

  for (const test of tests) {
    const isReadOnly = isReadOnlyTest(test.tool, test.action, categories);
    if (isReadOnly) {
      readOnlyTests.push(test);
    } else {
      writeTests.push(test);
    }
  }

  // Create parallel batches for read-only tests
  for (let i = 0; i < readOnlyTests.length; i += config.maxConcurrency) {
    const batch = readOnlyTests.slice(i, i + config.maxConcurrency);
    parallelBatches.push(batch);
  }

  // Write tests run sequentially
  sequentialTests.push(...writeTests);

  return { parallelBatches, sequentialTests };
}

/**
 * Check if a test is read-only
 */
function isReadOnlyTest(
  tool: string,
  action: string,
  categories: Map<string, TestCategory>
): boolean {
  const readOnlyCategory = categories.get('read-only');
  if (!readOnlyCategory) return false;

  return (
    readOnlyCategory.tools.includes(tool) ||
    readOnlyCategory.actions.includes(action) ||
    action.startsWith('get') ||
    action.startsWith('list') ||
    action === 'read' ||
    action === 'status' ||
    action === 'stats'
  );
}

/**
 * Generate performance report
 */
export interface PerformanceReport {
  totalTests: number;
  averageDuration: number;
  medianDuration: number;
  p95Duration: number;
  p99Duration: number;
  slowTests: Array<{ tool: string; action: string; duration: number }>;
  fastTests: Array<{ tool: string; action: string; duration: number }>;
  performanceByCategory: Map<string, { count: number; avgDuration: number; category: string }>;
}

export function generatePerformanceReport(
  tests: Array<{
    tool: string;
    action: string;
    duration: number;
    status: string;
  }>,
  config: OptimizationConfig
): PerformanceReport {
  const durations = tests.map((t) => t.duration).filter((d) => d > 0);
  durations.sort((a, b) => a - b);

  const average = durations.reduce((a, b) => a + b, 0) / durations.length;
  const median = durations[Math.floor(durations.length / 2)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];

  // Find slow and fast tests
  const sortedTests = [...tests].sort((a, b) => b.duration - a.duration);
  const slowTests = sortedTests
    .filter((t) => t.duration > config.performanceThresholds.slow)
    .slice(0, 10);
  const fastTests = sortedTests
    .filter((t) => t.duration > 0)
    .slice(-10)
    .reverse();

  // Performance by tool
  const byTool = new Map<string, { count: number; totalDuration: number }>();
  for (const test of tests) {
    if (!byTool.has(test.tool)) {
      byTool.set(test.tool, { count: 0, totalDuration: 0 });
    }
    const entry = byTool.get(test.tool)!;
    entry.count++;
    entry.totalDuration += test.duration;
  }

  const performanceByCategory = new Map<
    string,
    { count: number; avgDuration: number; category: string }
  >();
  for (const [tool, data] of byTool) {
    performanceByCategory.set(tool, {
      count: data.count,
      avgDuration: data.totalDuration / data.count,
      category: tool,
    });
  }

  return {
    totalTests: tests.length,
    averageDuration: average,
    medianDuration: median,
    p95Duration: p95,
    p99Duration: p99,
    slowTests,
    fastTests,
    performanceByCategory,
  };
}
