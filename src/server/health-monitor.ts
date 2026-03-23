/**
 * ServalSheets - Unified Health Monitor
 *
 * Plugin-based health monitoring system for production observability.
 * Consolidates heap monitoring, connection health, and other system checks
 * into a single extensible framework.
 *
 * Architecture:
 * - HealthMonitor: Central coordinator that manages multiple health checks
 * - HealthCheck: Plugin interface for implementing custom checks
 * - HealthCheckResult: Standardized result format for all checks
 *
 * Usage:
 * ```typescript
 * import { createHealthMonitor, HeapHealthCheck, ConnectionHealthCheck } from './health-monitor.js';
 *
 * const monitor = createHealthMonitor({
 *   checks: [HeapHealthCheck, ConnectionHealthCheck],
 *   globalInterval: 30000, // 30 seconds
 * });
 *
 * monitor.start();
 *
 * // Get aggregated health status
 * const status = await monitor.checkAll();
 * // status: { healthy: true, checks: [...] }
 * ```
 *
 * @category Server
 * @see src/utils/heap-monitor.ts - Original heap monitoring implementation
 * @see src/utils/connection-health.ts - Original connection monitoring implementation
 */

import { logger } from '../utils/logger.js';
import { registerCleanup } from '../utils/resource-cleanup.js';

/**
 * Health check severity levels
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  CRITICAL = 'critical',
  UNKNOWN = 'unknown',
}

/**
 * Result from a health check
 */
export interface HealthCheckResult {
  /** Name of the health check */
  name: string;
  /** Overall status */
  status: HealthStatus;
  /** Human-readable message */
  message: string;
  /** Check timestamp */
  timestamp: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Recommended action if unhealthy */
  recommendation?: string;
}

/**
 * Health check plugin interface
 *
 * Implement this interface to create custom health checks that integrate
 * with the unified health monitoring system.
 */
export interface HealthCheck {
  /** Unique name for this check */
  name: string;
  /** Optional description */
  description?: string;
  /** Check interval in milliseconds (undefined = use global interval) */
  intervalMs?: number;
  /** Whether this check is critical (failure indicates severe issue) */
  critical?: boolean;
  /** Perform the health check */
  check: () => Promise<HealthCheckResult> | HealthCheckResult;
  /** Optional startup hook */
  onStart?: () => void | Promise<void>;
  /** Optional shutdown hook */
  onStop?: () => void | Promise<void>;
}

/**
 * Aggregated health monitor response
 */
export interface HealthMonitorStatus {
  /** Overall system health */
  healthy: boolean;
  /** Number of checks performed */
  totalChecks: number;
  /** Number of healthy checks */
  healthyChecks: number;
  /** Number of warning-level checks */
  warningChecks: number;
  /** Number of critical checks */
  criticalChecks: number;
  /** Individual check results */
  checks: HealthCheckResult[];
  /** When the check was performed */
  timestamp: number;
}

/**
 * Configuration for health monitor
 */
export interface HealthMonitorConfig {
  /** Health checks to register */
  checks: HealthCheck[];
  /** Global check interval in milliseconds (default: 30000 = 30 seconds) */
  globalInterval?: number;
  /** Enable automatic monitoring on start (default: true) */
  autoStart?: boolean;
}

/**
 * Unified Health Monitor
 *
 * Central coordinator for all system health checks. Manages multiple
 * health check plugins, runs them on schedule, and aggregates results.
 */
export class HealthMonitor {
  private checks: Map<string, HealthCheck> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();
  private globalInterval: number;
  private isRunning: boolean = false;

  constructor(config: HealthMonitorConfig) {
    this.globalInterval = config.globalInterval ?? 30000; // 30 seconds default

    // Register all checks
    for (const check of config.checks) {
      this.registerCheck(check);
    }

    logger.info('Health monitor initialized', {
      checks: config.checks.map((c) => c.name),
      globalInterval: this.globalInterval,
    });
  }

  /**
   * Register a health check plugin
   */
  registerCheck(check: HealthCheck): void {
    if (this.checks.has(check.name)) {
      logger.warn('Health check already registered', { name: check.name });
      return;
    }

    this.checks.set(check.name, check);

    logger.debug('Health check registered', {
      name: check.name,
      description: check.description,
      intervalMs: check.intervalMs ?? this.globalInterval,
      critical: check.critical ?? false,
    });
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): void {
    const check = this.checks.get(name);
    if (!check) {
      return;
    }

    // Stop interval if running
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }

    this.checks.delete(name);
    this.lastResults.delete(name);

    logger.debug('Health check unregistered', { name });
  }

  /**
   * Start all health checks
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Health monitor already running');
      return;
    }

    this.isRunning = true;

    // Call onStart hooks
    for (const [name, check] of this.checks.entries()) {
      if (check.onStart) {
        try {
          await check.onStart();
        } catch (error) {
          logger.error('Health check onStart hook failed', { name, error });
        }
      }
    }

    // Start periodic checks
    for (const [name, check] of this.checks.entries()) {
      const intervalMs = check.intervalMs ?? this.globalInterval;

      // Run immediately
      this.runCheck(name, check);

      // Schedule periodic runs
      const interval = setInterval(() => {
        this.runCheck(name, check);
      }, intervalMs);

      this.intervals.set(name, interval);
    }

    // Register cleanup for all intervals
    registerCleanup(
      'HealthMonitor',
      () => {
        for (const interval of this.intervals.values()) {
          clearInterval(interval);
        }
        this.intervals.clear();
      },
      'health-check-intervals'
    );

    logger.info('Health monitor started', {
      checks: Array.from(this.checks.keys()),
    });
  }

  /**
   * Stop all health checks
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Clear all intervals
    for (const [_name, interval] of this.intervals.entries()) {
      clearInterval(interval);
    }
    this.intervals.clear();

    // Call onStop hooks
    for (const [name, check] of this.checks.entries()) {
      if (check.onStop) {
        try {
          await check.onStop();
        } catch (error) {
          logger.error('Health check onStop hook failed', { name, error });
        }
      }
    }

    logger.info('Health monitor stopped');
  }

  /**
   * Run a single health check
   */
  private async runCheck(name: string, check: HealthCheck): Promise<void> {
    try {
      const result = await check.check();
      this.lastResults.set(name, result);

      // Log based on severity
      if (result.status === HealthStatus.CRITICAL) {
        logger.error(`Health check CRITICAL: ${name}`, {
          message: result.message,
          metadata: result.metadata,
          recommendation: result.recommendation,
        });
      } else if (result.status === HealthStatus.WARNING) {
        logger.warn(`Health check WARNING: ${name}`, {
          message: result.message,
          metadata: result.metadata,
          recommendation: result.recommendation,
        });
      } else {
        logger.debug(`Health check passed: ${name}`, {
          status: result.status,
        });
      }
    } catch (error) {
      logger.error('Health check failed with exception', { name, error });

      // Store error result
      this.lastResults.set(name, {
        name,
        status: HealthStatus.UNKNOWN,
        message: `Check threw exception: ${error}`,
        timestamp: Date.now(),
        metadata: { error: String(error) },
      });
    }
  }

  /**
   * Check all registered health checks and return aggregated status
   */
  async checkAll(): Promise<HealthMonitorStatus> {
    const results: HealthCheckResult[] = [];
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;

    // Run all checks in parallel
    await Promise.all(
      Array.from(this.checks.entries()).map(async ([name, check]) => {
        await this.runCheck(name, check);
      })
    );

    // Aggregate results
    for (const result of this.lastResults.values()) {
      results.push(result);

      if (result.status === HealthStatus.HEALTHY) {
        healthyCount++;
      } else if (result.status === HealthStatus.WARNING) {
        warningCount++;
      } else if (result.status === HealthStatus.CRITICAL) {
        criticalCount++;
      }
    }

    // System is healthy if no critical checks and at least 50% checks are healthy
    const healthy = criticalCount === 0 && healthyCount >= results.length / 2;

    return {
      healthy,
      totalChecks: results.length,
      healthyChecks: healthyCount,
      warningChecks: warningCount,
      criticalChecks: criticalCount,
      checks: results,
      timestamp: Date.now(),
    };
  }

  /**
   * Get last result for a specific check
   */
  getCheckResult(name: string): HealthCheckResult | undefined {
    return this.lastResults.get(name);
  }

  /**
   * Get all last results
   */
  getAllResults(): HealthCheckResult[] {
    return Array.from(this.lastResults.values());
  }

  /**
   * Check if monitor is running
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }
}

/**
 * Create and optionally start a health monitor
 */
export function createHealthMonitor(config: HealthMonitorConfig): HealthMonitor {
  const monitor = new HealthMonitor(config);

  if (config.autoStart !== false) {
    monitor.start();
  }

  return monitor;
}
