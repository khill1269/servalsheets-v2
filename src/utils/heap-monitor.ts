/**
 * ServalSheets - Heap Monitor
 *
 * Monitors Node.js heap usage to detect memory leaks
 * Provides automatic alerting at configurable thresholds
 */

import v8 from 'node:v8';
import { logger } from './logger.js';

export interface HeapStats {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  utilizationPercent: number;
  externalMB: number;
  rss: number;
}

export interface HeapMonitorOptions {
  /** Monitoring interval in milliseconds (default: 30 minutes) */
  intervalMs?: number;
  /** Heap utilization warning threshold (0-1, default: 0.7) */
  warningThreshold?: number;
  /** Heap utilization critical threshold (0-1, default: 0.85) */
  criticalThreshold?: number;
  /** Enable heap snapshots at critical threshold (default: false) */
  enableSnapshots?: boolean;
  /** Path for heap snapshots (default: ./heap-snapshots) */
  snapshotPath?: string;
}

/**
 * Heap monitor for detecting memory leaks in production
 */
export class HeapMonitor {
  private interval?: NodeJS.Timeout;
  private intervalMs: number;
  private warningThreshold: number;
  private criticalThreshold: number;
  private enableSnapshots: boolean;
  private snapshotPath: string;
  private lastWarningTime: number = 0;
  private lastCriticalTime: number = 0;
  private consecutiveWarnings: number = 0;
  private consecutiveCritical: number = 0;

  constructor(options: HeapMonitorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 30 * 60 * 1000; // 30 minutes
    this.warningThreshold = options.warningThreshold ?? 0.7; // 70%
    this.criticalThreshold = options.criticalThreshold ?? 0.85; // 85%
    this.enableSnapshots = options.enableSnapshots ?? false;
    this.snapshotPath = options.snapshotPath ?? './heap-snapshots';
  }

  /**
   * Start monitoring heap usage
   */
  start(): void {
    if (this.interval) {
      logger.warn('Heap monitor already started');
      return;
    }

    logger.info('Heap monitor started', {
      intervalMs: this.intervalMs,
      intervalMin: Math.round(this.intervalMs / 60000),
      warningThreshold: `${(this.warningThreshold * 100).toFixed(0)}%`,
      criticalThreshold: `${(this.criticalThreshold * 100).toFixed(0)}%`,
      snapshotsEnabled: this.enableSnapshots,
    });

    // Take initial snapshot
    this.checkHeap();

    // Set up periodic monitoring
    this.interval = setInterval(() => {
      this.checkHeap();
    }, this.intervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      logger.info('Heap monitor stopped');
    }
  }

  /**
   * Get current heap statistics
   */
  getHeapStats(): HeapStats {
    const heapStats = v8.getHeapStatistics();
    const memoryUsage = process.memoryUsage();

    const heapUsedMB = heapStats.used_heap_size / 1024 / 1024;
    const heapTotalMB = heapStats.total_heap_size / 1024 / 1024;
    const heapLimitMB = heapStats.heap_size_limit / 1024 / 1024;
    const utilizationPercent = (heapUsedMB / heapLimitMB) * 100;

    return {
      timestamp: Date.now(),
      heapUsedMB: parseFloat(heapUsedMB.toFixed(2)),
      heapTotalMB: parseFloat(heapTotalMB.toFixed(2)),
      heapLimitMB: parseFloat(heapLimitMB.toFixed(2)),
      utilizationPercent: parseFloat(utilizationPercent.toFixed(2)),
      externalMB: parseFloat((memoryUsage.external / 1024 / 1024).toFixed(2)),
      rss: memoryUsage.rss,
    };
  }

  /**
   * Check heap and alert if thresholds exceeded
   */
  private checkHeap(): void {
    const stats = this.getHeapStats();
    const utilization = stats.utilizationPercent / 100;

    // Log normal statistics
    logger.info('Heap statistics', {
      heapUsedMB: stats.heapUsedMB,
      heapTotalMB: stats.heapTotalMB,
      heapLimitMB: stats.heapLimitMB,
      utilizationPercent: stats.utilizationPercent,
      externalMB: stats.externalMB,
      rssMB: (stats.rss / 1024 / 1024).toFixed(2),
    });

    // Check critical threshold
    if (utilization >= this.criticalThreshold) {
      this.consecutiveCritical++;
      this.consecutiveWarnings = 0;

      // Only alert once every 5 minutes to avoid spam
      const now = Date.now();
      if (now - this.lastCriticalTime > 5 * 60 * 1000) {
        logger.error('CRITICAL: High heap usage detected - potential memory leak', {
          utilizationPercent: stats.utilizationPercent,
          threshold: `${(this.criticalThreshold * 100).toFixed(0)}%`,
          heapUsedMB: stats.heapUsedMB,
          heapLimitMB: stats.heapLimitMB,
          consecutiveOccurrences: this.consecutiveCritical,
          recommendation: this.getRecommendation(utilization),
        });

        this.lastCriticalTime = now;

        // Take heap snapshot if enabled
        if (this.enableSnapshots) {
          this.takeHeapSnapshot();
        }
      }
    }
    // Check warning threshold
    else if (utilization >= this.warningThreshold) {
      this.consecutiveWarnings++;
      this.consecutiveCritical = 0;

      // Only alert once every 15 minutes to avoid spam
      const now = Date.now();
      if (now - this.lastWarningTime > 15 * 60 * 1000) {
        logger.warn('WARNING: Elevated heap usage detected', {
          utilizationPercent: stats.utilizationPercent,
          threshold: `${(this.warningThreshold * 100).toFixed(0)}%`,
          heapUsedMB: stats.heapUsedMB,
          heapLimitMB: stats.heapLimitMB,
          consecutiveOccurrences: this.consecutiveWarnings,
          recommendation: this.getRecommendation(utilization),
        });

        this.lastWarningTime = now;
      }
    }
    // Normal usage - reset counters
    else {
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
        filesize: 'unknown', // Node.js doesn't return size
        analysisTools: ['Chrome DevTools Memory Profiler', 'clinic.js heapprofiler'],
      });
    } catch (error) {
      logger.error('Failed to capture heap snapshot', { error });
    }
  }

  /**
   * Force garbage collection (if --expose-gc flag enabled)
   */
  forceGC(): void {
    if (global.gc) {
      logger.info('Forcing garbage collection');
      global.gc();
      logger.info('Garbage collection completed');
    } else {
      logger.warn('Garbage collection not available. Run with --expose-gc flag to enable.');
    }
  }
}

/**
 * Create and start heap monitor if enabled via environment variables
 */
export function startHeapMonitorIfEnabled(): HeapMonitor | null {
  const enabled = process.env['ENABLE_HEAP_MONITORING'] === 'true';

  if (!enabled) {
    return null;
  }

  const intervalMs = parseInt(
    process.env['HEAP_MONITOR_INTERVAL_MS'] || '1800000', // 30 minutes
    10
  );
  const warningThreshold = parseFloat(process.env['HEAP_WARNING_THRESHOLD'] || '0.7');
  const criticalThreshold = parseFloat(process.env['HEAP_CRITICAL_THRESHOLD'] || '0.85');
  const enableSnapshots = process.env['ENABLE_HEAP_SNAPSHOTS'] === 'true';
  const snapshotPath = process.env['HEAP_SNAPSHOT_PATH'] || './heap-snapshots';

  const monitor = new HeapMonitor({
    intervalMs,
    warningThreshold,
    criticalThreshold,
    enableSnapshots,
    snapshotPath,
  });

  monitor.start();

  return monitor;
}
