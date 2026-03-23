/**
 * ServalSheets - Health Check Service
 *
 * Production-ready health checks for deployment orchestration.
 * Supports Kubernetes liveness/readiness probes and Docker healthchecks.
 *
 * MCP Protocol: 2025-11-25
 */

import type { GoogleApiClient } from '../services/google-api.js';
import { cacheManager } from '../utils/cache-manager.js';
import { requestDeduplicator } from '../utils/request-deduplication.js';
import { getWriteLockStats } from '../middleware/write-lock-middleware.js';

export interface HealthCheck {
  name: string;
  status: 'ok' | 'degraded' | 'error';
  message?: string;
  latency?: number;
  metadata?: Record<string, unknown>;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: HealthCheck[];
}

/**
 * Health Check Service
 *
 * Provides health endpoints for monitoring and orchestration:
 * - Liveness: Is the process running?
 * - Readiness: Is the server ready to handle requests?
 */
export class HealthService {
  private startTime: number;
  private googleClient: GoogleApiClient | null;

  constructor(googleClient: GoogleApiClient | null) {
    this.startTime = Date.now();
    this.googleClient = googleClient;
  }

  /**
   * Liveness probe - Is the server running?
   *
   * This check always succeeds if the process is running.
   * Used by Kubernetes to restart crashed containers.
   *
   * @returns Always returns healthy status
   */
  async checkLiveness(): Promise<HealthResponse> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env['npm_package_version'] || '1.4.0',
      checks: [
        {
          name: 'process',
          status: 'ok',
          message: 'Server process is running',
          metadata: {
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          },
        },
      ],
    };
  }

  /**
   * Readiness probe - Is the server ready to handle requests?
   *
   * Checks all critical dependencies and services.
   * Returns:
   * - healthy: All checks passed, ready for traffic
   * - degraded: Some non-critical issues, but can serve requests
   * - unhealthy: Critical failures, not ready for traffic
   *
   * Used by Kubernetes/load balancers to route traffic.
   */
  async checkReadiness(): Promise<HealthResponse> {
    const checks: HealthCheck[] = [];
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check 1: Authentication (skip when no client configured — e.g. HTTP server without session)
    if (this.googleClient) {
      const authCheck = await this.checkAuth();
      checks.push(authCheck);
      if (authCheck.status === 'error') overallStatus = 'unhealthy';
      else if (authCheck.status === 'degraded' && overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }

      // Check 2: Google API connectivity
      const apiCheck = await this.checkGoogleApi();
      checks.push(apiCheck);
      if (apiCheck.status === 'error') overallStatus = 'unhealthy';
      else if (apiCheck.status === 'degraded' && overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
    }

    // Check 3: Cache health
    const cacheCheck = this.checkCache();
    checks.push(cacheCheck);
    // Cache issues are not critical, don't change overall status

    // Check 4: Request deduplication
    const dedupCheck = this.checkRequestDeduplication();
    checks.push(dedupCheck);
    // Deduplication issues are not critical, don't change overall status

    // Check 5: Write lock contention
    const writeLockCheck = this.checkWriteLocks();
    checks.push(writeLockCheck);
    // Write lock stats are informational

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env['npm_package_version'] || '1.4.0',
      checks,
    };
  }

  /**
   * Check authentication status
   */
  private async checkAuth(): Promise<HealthCheck> {
    const start = Date.now();

    if (!this.googleClient) {
      return {
        name: 'auth',
        status: 'degraded',
        message: 'No Google API client configured',
        latency: Date.now() - start,
        metadata: {
          configured: false,
        },
      };
    }

    try {
      // Check if we have valid credentials
      const hasAuth = this.googleClient.isAuthenticated();

      return {
        name: 'auth',
        status: hasAuth ? 'ok' : 'degraded',
        message: hasAuth ? 'Authenticated' : 'Not authenticated',
        latency: Date.now() - start,
        metadata: {
          hasAuth,
          hasElevatedAccess: this.googleClient.hasElevatedAccess,
        },
      };
    } catch (error) {
      return {
        name: 'auth',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check Google API connectivity
   */
  private async checkGoogleApi(): Promise<HealthCheck> {
    const start = Date.now();

    if (!this.googleClient) {
      return {
        name: 'google_api',
        status: 'degraded',
        message: 'No Google API client configured',
        latency: Date.now() - start,
        metadata: {
          configured: false,
        },
      };
    }

    try {
      // Lightweight API check - verify we can make requests
      // Don't use actual spreadsheet calls to avoid quota usage
      const hasAuth = this.googleClient.isAuthenticated();

      return {
        name: 'google_api',
        status: hasAuth ? 'ok' : 'degraded',
        message: hasAuth ? 'API client ready' : 'API client not authenticated',
        latency: Date.now() - start,
        metadata: {
          hasAuth,
          scopes: this.googleClient.scopes,
          hasElevatedAccess: this.googleClient.hasElevatedAccess,
        },
      };
    } catch (error) {
      return {
        name: 'google_api',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check cache health
   */
  private checkCache(): HealthCheck {
    const start = Date.now();

    try {
      const stats = cacheManager.getStats();
      const hitRate =
        stats.hits + stats.misses > 0 ? (stats.hits / (stats.hits + stats.misses)) * 100 : 0;

      // Cache is healthy if hit rate is reasonable or no requests yet
      const status = stats.hits + stats.misses === 0 ? 'ok' : hitRate > 30 ? 'ok' : 'degraded';

      return {
        name: 'cache',
        status,
        message: `Cache operational, hit rate: ${hitRate.toFixed(1)}%`,
        latency: Date.now() - start,
        metadata: {
          entries: stats.totalEntries,
          hitRate: hitRate.toFixed(1),
          hits: stats.hits,
          misses: stats.misses,
          totalRequests: stats.hits + stats.misses,
        },
      };
    } catch (error) {
      return {
        name: 'cache',
        status: 'degraded', // Cache failures are non-critical
        message: error instanceof Error ? error.message : String(error),
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check request deduplication
   */
  private checkRequestDeduplication(): HealthCheck {
    const start = Date.now();

    try {
      const stats = requestDeduplicator.getStats();

      return {
        name: 'request_deduplication',
        status: stats.enabled ? 'ok' : 'degraded',
        message: stats.enabled
          ? `Deduplication active, ${stats.totalSavingsRate.toFixed(1)}% savings`
          : 'Deduplication disabled',
        latency: Date.now() - start,
        metadata: {
          enabled: stats.enabled,
          totalRequests: stats.totalRequests,
          savedRequests: stats.totalSavedRequests,
          savingsRate: `${stats.totalSavingsRate.toFixed(1)}%`,
          cacheHitRate: `${stats.cacheHitRate.toFixed(1)}%`,
        },
      };
    } catch (error) {
      return {
        name: 'request_deduplication',
        status: 'degraded', // Dedup failures are non-critical
        message: error instanceof Error ? error.message : String(error),
        latency: Date.now() - start,
      };
    }
  }

  /**
   * Check write lock contention (informational)
   */
  private checkWriteLocks(): HealthCheck {
    try {
      const stats = getWriteLockStats();
      const totalPending = stats.locks.reduce((sum, l) => sum + l.pending, 0);
      const contested = stats.locks.filter((l) => l.pending > 0).length;
      const status = contested > 5 ? 'degraded' : 'ok';
      return {
        name: 'write_locks',
        status,
        message:
          stats.activeSpreadsheets === 0
            ? 'No active write locks'
            : `${stats.activeSpreadsheets} spreadsheet(s) with active locks, ${totalPending} pending`,
        metadata: {
          activeSpreadsheets: stats.activeSpreadsheets,
          contested,
          totalPending,
        },
      };
    } catch (error) {
      return {
        name: 'write_locks',
        status: 'ok', // Write lock stats failure is non-critical
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get service uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get service uptime as human-readable string
   */
  getUptimeFormatted(): string {
    const uptime = this.getUptime();
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
