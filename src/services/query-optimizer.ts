/**
 * ServalSheets - Adaptive Query Optimizer
 *
 * ML-based optimization of batch windows, prefetching, and parallelization
 * based on spreadsheet characteristics and access patterns.
 *
 * Target: -25% average latency improvement
 *
 * Optimization strategies:
 * 1. Spreadsheet profiling (cell count, formula density, access patterns)
 * 2. Dynamic batch window adjustment (50-200ms based on workload)
 * 3. Adaptive prefetch aggression (based on cache hit rates)
 * 4. Intelligent parallelization (based on operation dependencies)
 *
 * @module services/query-optimizer
 */

import { LRUCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

/**
 * Spreadsheet profile characteristics
 */
export interface SpreadsheetProfile {
  /** Spreadsheet ID */
  spreadsheetId: string;
  /** Total cell count */
  cellCount: number;
  /** Number of sheets */
  sheetCount: number;
  /** Formula density (0-1) */
  formulaDensity: number;
  /** Average formula complexity (number of references) */
  avgFormulaComplexity: number;
  /** Read/write ratio */
  readWriteRatio: number;
  /** Average operation size (cells per operation) */
  avgOperationSize: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Access pattern for a spreadsheet
 */
export interface AccessPattern {
  /** Recent operations (last 100) */
  recentOps: Array<{
    type: 'read' | 'write' | 'batch';
    timestamp: number;
    cellCount: number;
    duration: number;
  }>;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  /** Average operation duration */
  avgDuration: number;
  /** Peak operations per second */
  peakOpsPerSec: number;
}

/**
 * Optimization strategy for a spreadsheet
 */
export interface OptimizationStrategy {
  /** Batch window size (ms) */
  batchWindowMs: number;
  /** Prefetch aggression level (0-1) */
  prefetchAggression: number;
  /** Parallel execution threshold (number of operations) */
  parallelThreshold: number;
  /** Use request merging */
  useRequestMerging: boolean;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Performance metrics for tracking optimization effectiveness
 */
interface PerformanceMetrics {
  /** Average latency (ms) */
  avgLatency: number;
  /** P95 latency (ms) */
  p95Latency: number;
  /** Throughput (ops/sec) */
  throughput: number;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  /** API call reduction (0-1) */
  apiCallReduction: number;
}

/**
 * Adaptive Query Optimizer
 *
 * Learns optimal query strategies per spreadsheet based on:
 * - Spreadsheet size and structure
 * - Access patterns and frequency
 * - Cache effectiveness
 * - Operation latencies
 *
 * Adjusts:
 * - Batch window sizes (50-200ms)
 * - Prefetch aggression (0-100%)
 * - Parallel execution thresholds
 * - Request merging strategies
 *
 * @example
 * ```typescript
 * const optimizer = new AdaptiveQueryOptimizer();
 *
 * // Profile spreadsheet
 * await optimizer.profileSpreadsheet(spreadsheetId, metadata);
 *
 * // Get optimized strategy
 * const strategy = optimizer.getStrategy(spreadsheetId);
 *
 * // Apply strategy
 * batchingSystem.setWindowSize(strategy.batchWindowMs);
 * prefetchPredictor.setAggression(strategy.prefetchAggression);
 *
 * // Record results for learning
 * optimizer.recordOperation(spreadsheetId, {
 *   type: 'read',
 *   cellCount: 100,
 *   duration: 150,
 *   cacheHit: true
 * });
 * ```
 */
export class AdaptiveQueryOptimizer {
  private profiles: LRUCache<string, SpreadsheetProfile>;
  private patterns: LRUCache<string, AccessPattern>;
  private strategies: LRUCache<string, OptimizationStrategy>;
  private metrics: LRUCache<string, PerformanceMetrics>;

  // Default strategy values
  private readonly DEFAULT_BATCH_WINDOW = 100;
  private readonly MIN_BATCH_WINDOW = 50;
  private readonly MAX_BATCH_WINDOW = 200;
  private readonly DEFAULT_PREFETCH_AGGRESSION = 0.6;
  private readonly DEFAULT_PARALLEL_THRESHOLD = 5;

  constructor() {
    // Cache profiles and strategies (1 hour TTL)
    this.profiles = new LRUCache({
      maxSize: 1000,
      ttl: 3600000, // 1 hour
    });

    this.patterns = new LRUCache({
      maxSize: 1000,
      ttl: 3600000,
    });

    this.strategies = new LRUCache({
      maxSize: 1000,
      ttl: 1800000, // 30 minutes (refresh strategies more frequently)
    });

    this.metrics = new LRUCache({
      maxSize: 1000,
      ttl: 600000, // 10 minutes
    });

    logger.info('Adaptive Query Optimizer initialized');
  }

  /**
   * Profile a spreadsheet based on metadata
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param metadata - Spreadsheet metadata from API
   */
  async profileSpreadsheet(
    spreadsheetId: string,
    metadata: {
      sheets: Array<{
        properties: {
          gridProperties?: {
            rowCount?: number;
            columnCount?: number;
          };
        };
        data?: Array<{
          rowData?: Array<{
            values?: Array<{ userEnteredValue?: unknown; formulaValue?: string }>;
          }>;
        }>;
      }>;
    }
  ): Promise<SpreadsheetProfile> {
    // Calculate cell count
    let totalCells = 0;
    let formulaCount = 0;
    let totalReferences = 0;

    for (const sheet of metadata.sheets) {
      const rows = sheet.properties.gridProperties?.rowCount ?? 0;
      const cols = sheet.properties.gridProperties?.columnCount ?? 0;
      totalCells += rows * cols;

      // Sample formulas if data available
      if (sheet.data) {
        for (const data of sheet.data) {
          if (data.rowData) {
            for (const row of data.rowData) {
              if (row.values) {
                for (const cell of row.values) {
                  if (cell.formulaValue) {
                    formulaCount++;
                    // Estimate complexity by counting references (rough heuristic)
                    const refMatches = cell.formulaValue.match(/[A-Z]+\d+/g);
                    totalReferences += refMatches?.length ?? 0;
                  }
                }
              }
            }
          }
        }
      }
    }

    const profile: SpreadsheetProfile = {
      spreadsheetId,
      cellCount: totalCells,
      sheetCount: metadata.sheets.length,
      formulaDensity: totalCells > 0 ? formulaCount / totalCells : 0,
      avgFormulaComplexity: formulaCount > 0 ? totalReferences / formulaCount : 0,
      readWriteRatio: 1.0, // Will be updated based on observed operations
      avgOperationSize: 100, // Default, will be learned
      lastUpdated: Date.now(),
    };

    this.profiles.set(spreadsheetId, profile);

    logger.debug('Spreadsheet profiled', {
      spreadsheetId,
      cellCount: profile.cellCount,
      sheetCount: profile.sheetCount,
      formulaDensity: profile.formulaDensity.toFixed(3),
    });

    return profile;
  }

  /**
   * Record an operation for pattern learning
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param operation - Operation details
   */
  recordOperation(
    spreadsheetId: string,
    operation: {
      type: 'read' | 'write' | 'batch';
      cellCount: number;
      duration: number;
      cacheHit?: boolean;
    }
  ): void {
    // Get or create pattern
    let pattern = this.patterns.get(spreadsheetId);
    if (!pattern) {
      pattern = {
        recentOps: [],
        cacheHitRate: 0.5,
        avgDuration: 0,
        peakOpsPerSec: 0,
      };
    }

    // Add operation to recent history (keep last 100)
    pattern.recentOps.push({
      type: operation.type,
      timestamp: Date.now(),
      cellCount: operation.cellCount,
      duration: operation.duration,
    });

    if (pattern.recentOps.length > 100) {
      pattern.recentOps.shift();
    }

    // Update cache hit rate (exponential moving average)
    if (operation.cacheHit !== undefined) {
      const alpha = 0.1; // Smoothing factor
      pattern.cacheHitRate =
        alpha * (operation.cacheHit ? 1 : 0) + (1 - alpha) * pattern.cacheHitRate;
    }

    // Update average duration
    pattern.avgDuration =
      pattern.recentOps.reduce((sum, op) => sum + op.duration, 0) / pattern.recentOps.length;

    // Calculate peak ops/sec (last 10 seconds)
    const tenSecondsAgo = Date.now() - 10000;
    const recentOpsCount = pattern.recentOps.filter((op) => op.timestamp > tenSecondsAgo).length;
    pattern.peakOpsPerSec = Math.max(pattern.peakOpsPerSec, recentOpsCount / 10);

    this.patterns.set(spreadsheetId, pattern);

    // Trigger strategy recomputation if pattern has changed significantly
    this.recomputeStrategy(spreadsheetId);
  }

  /**
   * Get optimized strategy for a spreadsheet
   *
   * @param spreadsheetId - Spreadsheet ID
   * @returns Optimization strategy
   */
  getStrategy(spreadsheetId: string): OptimizationStrategy {
    // Check cache first
    const cached = this.strategies.get(spreadsheetId);
    if (cached) {
      return cached;
    }

    // Compute new strategy
    return this.computeStrategy(spreadsheetId);
  }

  /**
   * Compute optimization strategy based on profile and patterns
   */
  private computeStrategy(spreadsheetId: string): OptimizationStrategy {
    const profile = this.profiles.get(spreadsheetId);
    const pattern = this.patterns.get(spreadsheetId);

    // Default strategy for unknown spreadsheets
    if (!profile && !pattern) {
      return {
        batchWindowMs: this.DEFAULT_BATCH_WINDOW,
        prefetchAggression: this.DEFAULT_PREFETCH_AGGRESSION,
        parallelThreshold: this.DEFAULT_PARALLEL_THRESHOLD,
        useRequestMerging: true,
        confidence: 0.0,
      };
    }

    let batchWindowMs = this.DEFAULT_BATCH_WINDOW;
    let prefetchAggression = this.DEFAULT_PREFETCH_AGGRESSION;
    let parallelThreshold = this.DEFAULT_PARALLEL_THRESHOLD;
    let confidence = 0.5;

    // Adjust based on spreadsheet size
    if (profile) {
      if (profile.cellCount < 10000) {
        // Small sheet: faster response, less batching
        batchWindowMs = this.MIN_BATCH_WINDOW;
        prefetchAggression = 0.4;
        parallelThreshold = 3;
      } else if (profile.cellCount > 100000) {
        // Large sheet: more batching, aggressive prefetch
        batchWindowMs = this.MAX_BATCH_WINDOW;
        prefetchAggression = 0.8;
        parallelThreshold = 10;
      }

      // High formula density: increase batch window (formulas are expensive)
      if (profile.formulaDensity > 0.1) {
        batchWindowMs = Math.min(batchWindowMs * 1.5, this.MAX_BATCH_WINDOW);
      }

      confidence += 0.3;
    }

    // Adjust based on access patterns
    if (pattern) {
      // High cache hit rate: reduce prefetch aggression (already efficient)
      if (pattern.cacheHitRate > 0.8) {
        prefetchAggression *= 0.7;
      } else if (pattern.cacheHitRate < 0.4) {
        // Low cache hit rate: increase prefetch
        prefetchAggression *= 1.3;
      }

      // High throughput: optimize for batching
      if (pattern.peakOpsPerSec > 10) {
        batchWindowMs = Math.min(batchWindowMs * 1.3, this.MAX_BATCH_WINDOW);
      }

      // Fast operations: reduce batch window (don't wait unnecessarily)
      if (pattern.avgDuration < 100) {
        batchWindowMs = Math.max(batchWindowMs * 0.8, this.MIN_BATCH_WINDOW);
      }

      confidence += 0.2;
    }

    // Clamp values
    batchWindowMs = Math.max(this.MIN_BATCH_WINDOW, Math.min(this.MAX_BATCH_WINDOW, batchWindowMs));
    prefetchAggression = Math.max(0.2, Math.min(1.0, prefetchAggression));
    parallelThreshold = Math.max(2, Math.min(20, parallelThreshold));

    const strategy: OptimizationStrategy = {
      batchWindowMs: Math.round(batchWindowMs),
      prefetchAggression: Math.round(prefetchAggression * 100) / 100,
      parallelThreshold: Math.round(parallelThreshold),
      useRequestMerging: true,
      confidence: Math.min(1.0, confidence),
    };

    this.strategies.set(spreadsheetId, strategy);

    logger.debug('Strategy computed', {
      spreadsheetId,
      strategy,
    });

    return strategy;
  }

  /**
   * Recompute strategy if pattern has changed significantly
   */
  private recomputeStrategy(spreadsheetId: string): void {
    const currentStrategy = this.strategies.get(spreadsheetId);
    if (!currentStrategy) {
      return; // No strategy to recompute
    }

    const newStrategy = this.computeStrategy(spreadsheetId);

    // Check if strategy changed significantly
    const batchWindowDiff = Math.abs(newStrategy.batchWindowMs - currentStrategy.batchWindowMs);
    const prefetchDiff = Math.abs(
      newStrategy.prefetchAggression - currentStrategy.prefetchAggression
    );

    if (batchWindowDiff > 20 || prefetchDiff > 0.15) {
      logger.info('Strategy updated', {
        spreadsheetId,
        oldBatchWindow: currentStrategy.batchWindowMs,
        newBatchWindow: newStrategy.batchWindowMs,
        oldPrefetch: currentStrategy.prefetchAggression,
        newPrefetch: newStrategy.prefetchAggression,
      });

      this.strategies.set(spreadsheetId, newStrategy);
    }
  }

  /**
   * Record performance metrics for a spreadsheet
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param metrics - Performance metrics
   */
  recordMetrics(spreadsheetId: string, metrics: PerformanceMetrics): void {
    this.metrics.set(spreadsheetId, metrics);
  }

  /**
   * Get performance metrics for a spreadsheet
   *
   * @param spreadsheetId - Spreadsheet ID
   * @returns Performance metrics or null if not available
   */
  getMetrics(spreadsheetId: string): PerformanceMetrics | null {
    return this.metrics.get(spreadsheetId) ?? null;
  }

  /**
   * Get optimizer statistics
   */
  getStats(): {
    profileCount: number;
    patternCount: number;
    strategyCount: number;
    metricsCount: number;
  } {
    return {
      profileCount: this.profiles.size,
      patternCount: this.patterns.size,
      strategyCount: this.strategies.size,
      metricsCount: this.metrics.size,
    };
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.profiles.clear();
    this.patterns.clear();
    this.strategies.clear();
    this.metrics.clear();
    logger.info('Query optimizer cache cleared');
  }
}

/**
 * Global optimizer instance
 */
let globalOptimizer: AdaptiveQueryOptimizer | null = null;

/**
 * Get or create global query optimizer
 */
export function getQueryOptimizer(): AdaptiveQueryOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = new AdaptiveQueryOptimizer();
  }
  return globalOptimizer;
}

/**
 * Reset global optimizer (for testing)
 */
export function resetQueryOptimizer(): void {
  if (globalOptimizer) {
    globalOptimizer.clear();
  }
  globalOptimizer = null;
}
