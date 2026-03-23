/**
 * ServalSheets - Heap Health Check Plugin
 *
 * Monitors Node.js heap usage and alerts on memory pressure.
 * Integrates HeapMonitor with the unified health monitoring system.
 *
 * Features:
 * - Automatic heap usage tracking
 * - Configurable thresholds (70% warning, 85% critical)
 * - Optional heap snapshot capture at critical threshold
 * - Memory leak detection
 *
 * Usage:
 * ```typescript
 * import { createHealthMonitor } from './health-monitor.js';
 * import { createHeapHealthCheck } from './heap-health-check.js';
 *
 * const monitor = createHealthMonitor({
 *   checks: [createHeapHealthCheck({ enableSnapshots: true })],
 * });
 * ```
 *
 * @category Server
 */

import v8 from 'node:v8';
import type { HealthCheck, HealthCheckResult, HealthStatus } from './health-monitor.js';
import { HealthStatus as Status } from './health-monitor.js';
import { logger } from '../utils/logger.js';

export interface HeapHealthCheckOptions {
  /** Heap utilization warning threshold (0-1, default: 0.7) */
  warningThreshold?: number;
  /** Heap utilization critical threshold (0-1, default: 0.85) */
  criticalThreshold?: number;
  /** Enable heap snapshots at critical threshold (default: false) */
  enableSnapshots?: boolean;
  /** Path for heap snapshots (default: ./heap-snapshots) */
  snapshotPath?: string;
}

export interface HeapStats {
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  utilizationPercent: number;
  externalMB: number;
  rssMB: number;
}

/**
 * Heap health check plugin
 */
class HeapHealthCheckPlugin implements HealthCheck {
  name = 'heap';
  description = 'Monitors Node.js heap usage for memory leaks';
  intervalMs = 30 * 60 * 1000; // 30 minutes
  critical = true; // Heap exhaustion is critical

  private warningThreshold: number;
  private criticalThreshold: number;
  private enableSnapshots: boolean;
  private snapshotPath: string;
  private consecutiveWarnings: number = 0;
  private consecutiveCritical: number = 0;
  private lastSnapshotTime: number = 0;

  constructor(options: HeapHealthCheckOptions = {}) {
    this.warningThreshold = options.warningThreshold ?? 0.7;
    this.criticalThreshold = options.criticalThreshold ?? 0.85;
    this.enableSnapshots = options.enableSnapshots ?? false;
    this.snapshotPath = options.snapshotPath ?? './heap-snapshots';
  }

  async onStart(): Promise<void> {
    logger.info('Heap health check started', {
      warningThreshold: `${(this.warningThreshold * 100).toFixed(0)}%`,
      criticalThreshold: `${(this.criticalThreshold * 100).toFixed(0)}%`,
      snapshotsEnabled: this.enableSnapshots,
      intervalMinutes: Math.round(this.intervalMs / 60000),
    });
  }

  async check(): Promise<HealthCheckResult> {
    const stats = this.getHeapStats();
    const utilization = stats.utilizationPercent / 100;

    // Determine status
    let status: HealthStatus;
    let message: string;
    let recommendation: string | undefined;

    if (utilization >= this.criticalThreshold) {
      status = Status.CRITICAL;
      message = `High heap usage: ${stats.utilizationPercent.toFixed(1)}% of ${stats.heapLimitMB.toFixed(0)}MB`;
      recommendation = this.getRecommendation(utilization);
      this.consecutiveCritical++;
      this.consecutiveWarnings = 0;

      // Take heap snapshot if enabled and not taken recently (max once per 5 minutes)
      if (this.enableSnapshots && Date.now() - this.lastSnapshotTime > 5 * 60 * 1000) {
        this.takeHeapSnapshot();
        this.lastSnapshotTime = Date.now();
      }
    } else if (utilization >= this.warningThreshold) {
      status = Status.WARNING;
      message = `Elevated heap usage: ${stats.utilizationPercent.toFixed(1)}% of ${stats.heapLimitMB.toFixed(0)}MB`;
      recommendation = this.getRecommendation(utilization);
      this.consecutiveWarnings++;
      this.consecutiveCritical = 0;
    } else {
      status = Status.HEALTHY;
      message = `Heap usage normal: ${stats.utilizationPercent.toFixed(1)}% of ${stats.heapLimitMB.toFixed(0)}MB`;

      // Reset counters
      if (this.consecutiveWarnings > 0 || this.consecutiveCritical > 0) {
        logger.info('Heap usage returned to normal', {
          utilizationPercent: stats.utilizationPercent,
          previousWarnings: this.consecutiveWarnings,
          previousCritical: this.consecutiveCritical,
        });
      }

      this.consecutiveWarnings = 0;
      this.consecutiveCritical = 0;
    }

    return {
      name: this.name,
      status,
      message,
      timestamp: Date.now(),
      metadata: {
        heapUsedMB: stats.heapUsedMB,
        heapTotalMB: stats.heapTotalMB,
        heapLimitMB: stats.heapLimitMB,
        utilizationPercent: stats.utilizationPercent,
        externalMB: stats.externalMB,
        rssMB: stats.rssMB,
        consecutiveWarnings: this.consecutiveWarnings,
        consecutiveCritical: this.consecutiveCritical,
      },
      recommendation,
    };
  }

  /**
   * Get current heap statistics
   */
  private getHeapStats(): HeapStats {
    const heapStats = v8.getHeapStatistics();
    const memoryUsage = process.memoryUsage();

    const heapUsedMB = heapStats.used_heap_size / 1024 / 1024;
    const heapTotalMB = heapStats.total_heap_size / 1024 / 1024;
    const heapLimitMB = heapStats.heap_size_limit / 1024 / 1024;
    const utilizationPercent = (heapUsedMB / heapLimitMB) * 100;

    return {
      heapUsedMB: parseFloat(heapUsedMB.toFixed(2)),
      heapTotalMB: parseFloat(heapTotalMB.toFixed(2)),
      heapLimitMB: parseFloat(heapLimitMB.toFixed(2)),
      utilizationPercent: parseFloat(utilizationPercent.toFixed(2)),
      externalMB: parseFloat((memoryUsage.external / 1024 / 1024).toFixed(2)),
      rssMB: parseFloat((memoryUsage.rss / 1024 / 1024).toFixed(2)),
    };
  }

  /**
   * Get recommendation based on heap utilization
   */
  private getRecommendation(utilization: number): string {
    if (utilization >= 0.95) {
      return 'IMMEDIATE ACTION REQUIRED: Restart server to prevent OOM crash. Investigate memory leak.';
    } else if (utilization >= 0.85) {
      return 'Monitor closely. Consider restarting during maintenance window. Profile with heap snapshots.';
    } else if (utilization >= 0.7) {
      return 'Monitor for sustained growth. Review caching policies and connection pool sizes.';
    }
    return 'Normal operation';
  }

  /**
   * Take heap snapshot for analysis
   */
  private takeHeapSnapshot(): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.snapshotPath}/heap-${timestamp}.heapsnapshot`;

      const snapshot = v8.writeHeapSnapshot(filename);

      logger.info('Heap snapshot captured', {
        filename: snapshot,
        analysisTools: ['Chrome DevTools Memory Profiler', 'clinic.js heapprofiler'],
      });
    } catch (error) {
      logger.error('Failed to capture heap snapshot', { error });
    }
  }
}

/**
 * Create heap health check plugin
 */
export function createHeapHealthCheck(options?: HeapHealthCheckOptions): HealthCheck {
  return new HeapHealthCheckPlugin(options);
}

/**
 * Create heap health check from environment variables
 */
export function createHeapHealthCheckFromEnv(): HealthCheck | null {
  const enabled = process.env['ENABLE_HEAP_MONITORING'] === 'true';

  if (!enabled) {
    return null;
  }

  return createHeapHealthCheck({
    warningThreshold: parseFloat(process.env['HEAP_WARNING_THRESHOLD'] || '0.7'),
    criticalThreshold: parseFloat(process.env['HEAP_CRITICAL_THRESHOLD'] || '0.85'),
    enableSnapshots: process.env['ENABLE_HEAP_SNAPSHOTS'] === 'true',
    snapshotPath: process.env['HEAP_SNAPSHOT_PATH'] || './heap-snapshots',
  });
}
