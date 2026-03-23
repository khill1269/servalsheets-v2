/**
 * Benchmark Harness with Statistical Analysis
 *
 * Provides consistent measurement methodology across all benchmarks.
 * Includes warm-up runs, outlier detection, and percentile calculations.
 */

export interface BenchmarkConfig {
  /** Number of warm-up runs (not measured) */
  warmupRuns: number;
  /** Number of measurement runs */
  measurementRuns: number;
  /** Remove outliers beyond N standard deviations */
  outlierStdDevThreshold: number;
  /** Wait time between runs (ms) */
  cooldownMs: number;
  /** Abort if single run exceeds this (ms) */
  timeoutMs: number;
}

export interface BenchmarkResult {
  name: string;
  category: string;
  measurements: number[];
  statistics: BenchmarkStatistics;
  metadata: Record<string, unknown>;
  timestamp: string;
  config: BenchmarkConfig;
}

export interface BenchmarkStatistics {
  count: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  outlierCount: number;
  coefficientOfVariation: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  warmupRuns: 3,
  measurementRuns: 20,
  outlierStdDevThreshold: 2.5,
  cooldownMs: 100,
  timeoutMs: 30000,
};

/**
 * Benchmark harness for consistent performance measurement
 */
export class BenchmarkHarness {
  private config: BenchmarkConfig;
  private results: BenchmarkResult[] = [];

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Measure the performance of an async function
   */
  async measure<T>(
    name: string,
    category: string,
    fn: () => Promise<T>,
    metadata: Record<string, unknown> = {}
  ): Promise<BenchmarkResult> {
    // Warm-up runs (not measured)
    for (let i = 0; i < this.config.warmupRuns; i++) {
      await this.executeWithTimeout(fn);
      await this.cooldown();
    }

    // Measurement runs
    const measurements: number[] = [];
    for (let i = 0; i < this.config.measurementRuns; i++) {
      const start = performance.now();
      await this.executeWithTimeout(fn);
      const duration = performance.now() - start;
      measurements.push(duration);
      await this.cooldown();
    }

    // Calculate statistics
    const statistics = this.calculateStatistics(measurements);

    const result: BenchmarkResult = {
      name,
      category,
      measurements,
      statistics,
      metadata,
      timestamp: new Date().toISOString(),
      config: { ...this.config },
    };

    this.results.push(result);
    return result;
  }

  /**
   * Measure a synchronous function
   */
  measureSync(
    name: string,
    category: string,
    fn: () => void,
    metadata: Record<string, unknown> = {}
  ): BenchmarkResult {
    // Warm-up runs
    for (let i = 0; i < this.config.warmupRuns; i++) {
      fn();
    }

    // Measurement runs
    const measurements: number[] = [];
    for (let i = 0; i < this.config.measurementRuns; i++) {
      const start = performance.now();
      fn();
      const duration = performance.now() - start;
      measurements.push(duration);
    }

    const statistics = this.calculateStatistics(measurements);

    const result: BenchmarkResult = {
      name,
      category,
      measurements,
      statistics,
      metadata,
      timestamp: new Date().toISOString(),
      config: { ...this.config },
    };

    this.results.push(result);
    return result;
  }

  /**
   * Execute with timeout protection
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Benchmark timeout')), this.config.timeoutMs)
      ),
    ]);
  }

  /**
   * Calculate comprehensive statistics
   */
  private calculateStatistics(measurements: number[]): BenchmarkStatistics {
    const sorted = [...measurements].sort((a, b) => a - b);
    const count = sorted.length;

    if (count === 0) {
      return {
        count: 0,
        mean: 0,
        median: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        outlierCount: 0,
        coefficientOfVariation: 0,
      };
    }

    // Calculate mean and standard deviation
    const mean = sorted.reduce((a, b) => a + b, 0) / count;
    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    // Remove outliers for refined statistics
    const filtered = sorted.filter(
      (v) => Math.abs(v - mean) <= this.config.outlierStdDevThreshold * stdDev
    );
    const outlierCount = count - filtered.length;

    // Recalculate mean on filtered data
    const filteredMean =
      filtered.length > 0 ? filtered.reduce((a, b) => a + b, 0) / filtered.length : mean;

    // Coefficient of variation (relative standard deviation)
    const coefficientOfVariation = filteredMean > 0 ? (stdDev / filteredMean) * 100 : 0;

    return {
      count,
      mean: filteredMean,
      median: this.percentile(sorted, 50),
      stdDev,
      min: sorted[0],
      max: sorted[count - 1],
      p50: this.percentile(sorted, 50),
      p75: this.percentile(sorted, 75),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      outlierCount,
      coefficientOfVariation,
    };
  }

  /**
   * Calculate percentile value
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Wait between runs to prevent resource contention
   */
  private async cooldown(): Promise<void> {
    if (this.config.cooldownMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.cooldownMs));
    }
  }

  /**
   * Get all results
   */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  /**
   * Get results by category
   */
  getResultsByCategory(category: string): BenchmarkResult[] {
    return this.results.filter((r) => r.category === category);
  }

  /**
   * Clear all results
   */
  clearResults(): void {
    this.results = [];
  }

  /**
   * Get summary of all benchmarks
   */
  getSummary(): {
    totalBenchmarks: number;
    categories: string[];
    avgP95: number;
    maxP95: number;
    minP95: number;
  } {
    if (this.results.length === 0) {
      return {
        totalBenchmarks: 0,
        categories: [],
        avgP95: 0,
        maxP95: 0,
        minP95: 0,
      };
    }

    const categories = [...new Set(this.results.map((r) => r.category))];
    const p95Values = this.results.map((r) => r.statistics.p95);

    return {
      totalBenchmarks: this.results.length,
      categories,
      avgP95: p95Values.reduce((a, b) => a + b, 0) / p95Values.length,
      maxP95: Math.max(...p95Values),
      minP95: Math.min(...p95Values),
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<BenchmarkConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): BenchmarkConfig {
    return { ...this.config };
  }
}

/**
 * Create a benchmark harness with default settings
 */
export function createBenchmarkHarness(config?: Partial<BenchmarkConfig>): BenchmarkHarness {
  return new BenchmarkHarness(config);
}

/**
 * Utility: Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Utility: Compare two benchmark results
 */
export function compareBenchmarks(
  baseline: BenchmarkResult,
  current: BenchmarkResult
): {
  name: string;
  baselineP95: number;
  currentP95: number;
  changePercent: number;
  isRegression: boolean;
  isBetter: boolean;
} {
  const changePercent =
    ((current.statistics.p95 - baseline.statistics.p95) / baseline.statistics.p95) * 100;

  return {
    name: current.name,
    baselineP95: baseline.statistics.p95,
    currentP95: current.statistics.p95,
    changePercent,
    isRegression: changePercent > 15, // 15% slower = regression
    isBetter: changePercent < -10, // 10% faster = improvement
  };
}
