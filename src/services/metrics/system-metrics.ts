/**
 * System Metrics
 *
 * Tracks system resources: memory, CPU, active requests, uptime.
 *
 * @category Metrics
 */

import * as os from 'os';

// ==================== Types ====================

export interface SystemMetrics {
  /** Active requests */
  activeRequests: number;
  /** Total memory usage (bytes) */
  memoryUsage: number;
  /** Memory usage percentage (0-1) */
  memoryUsagePercent: number;
  /** CPU usage percentage (0-1) */
  cpuUsage: number;
  /** Uptime (seconds) */
  uptime: number;
}

// ==================== System Metrics Service ====================

export class SystemMetricsService {
  private activeRequests = 0;
  private enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Increment active requests counter
   */
  incrementActiveRequests(): void {
    if (!this.enabled) return;
    this.activeRequests++;
  }

  /**
   * Decrement active requests counter
   */
  decrementActiveRequests(): void {
    if (!this.enabled) return;
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const uptime = process.uptime();

    return {
      activeRequests: this.activeRequests,
      memoryUsage: mem.heapUsed,
      memoryUsagePercent: mem.heapUsed / totalMem,
      cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
      uptime,
    };
  }

  /**
   * Get active requests count
   */
  getActiveRequests(): number {
    return this.activeRequests;
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.activeRequests = 0;
  }
}
