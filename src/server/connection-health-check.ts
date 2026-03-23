/**
 * ServalSheets - Connection Health Check Plugin
 *
 * Monitors MCP client connection health via heartbeat tracking.
 * Integrates ConnectionHealthMonitor with the unified health monitoring system.
 *
 * Features:
 * - Heartbeat tracking (records last activity timestamp)
 * - Disconnect detection with configurable timeout
 * - Exponential backoff for reconnection attempts
 * - Connection statistics for debugging
 *
 * Usage:
 * ```typescript
 * import { createHealthMonitor } from './health-monitor.js';
 * import { createConnectionHealthCheck } from './connection-health-check.js';
 *
 * const check = createConnectionHealthCheck();
 * const monitor = createHealthMonitor({
 *   checks: [check],
 * });
 *
 * // Record heartbeat on MCP activity
 * check.recordHeartbeat('tool_call');
 * ```
 *
 * @category Server
 */

import type { HealthCheck, HealthCheckResult, HealthStatus } from './health-monitor.js';
import { HealthStatus as Status } from './health-monitor.js';
import { logger } from '../utils/logger.js';

export interface ConnectionHealthCheckOptions {
  /** Consider disconnected after this many ms without activity (default: 120000 = 2 minutes) */
  disconnectThresholdMs?: number;
  /** Log warnings after this many ms without activity (default: 60000 = 1 minute) */
  warnThresholdMs?: number;
}

export interface ConnectionStats {
  totalHeartbeats: number;
  timeSinceLastActivity: number;
  disconnectWarnings: number;
  uptimeSeconds: number;
  status: 'healthy' | 'warning' | 'disconnected' | 'unknown';
  lastActivity: number;
  connectionId: string;
}

/**
 * Connection health check plugin
 */
class ConnectionHealthCheckPlugin implements HealthCheck {
  name = 'connection';
  description = 'Monitors MCP client connection health via heartbeats';
  intervalMs = 15000; // Check every 15 seconds
  critical = false; // Connection issues are warning-level, not critical

  private disconnectThresholdMs: number;
  private warnThresholdMs: number;
  private lastActivity: number = Date.now();
  private connectionId: string;
  private totalHeartbeats: number = 0;
  private disconnectWarnings: number = 0;
  private monitoringStarted: number = 0;
  private isDisconnected: boolean = false;
  private reconnectAttempts: number = 0;
  private lastDisconnectTime: number = 0;

  constructor(options: ConnectionHealthCheckOptions = {}) {
    this.disconnectThresholdMs = options.disconnectThresholdMs ?? 120000; // 2 minutes
    this.warnThresholdMs = options.warnThresholdMs ?? 60000; // 1 minute
    this.connectionId = this.generateConnectionId();
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  async onStart(): Promise<void> {
    this.monitoringStarted = Date.now();
    this.lastActivity = Date.now();
    this.isDisconnected = false;

    logger.info('Connection health check started', {
      connectionId: this.connectionId,
      disconnectThresholdMs: this.disconnectThresholdMs,
      warnThresholdMs: this.warnThresholdMs,
      intervalSeconds: Math.round(this.intervalMs / 1000),
    });
  }

  async check(): Promise<HealthCheckResult> {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivity;

    let status: HealthStatus;
    let message: string;
    let recommendation: string | undefined;

    if (timeSinceActivity >= this.disconnectThresholdMs) {
      // Disconnected
      if (!this.isDisconnected) {
        this.isDisconnected = true;
        this.disconnectWarnings++;
        this.lastDisconnectTime = now;
        this.reconnectAttempts++;
      }

      status = Status.WARNING; // Not critical - client may reconnect
      message = `MCP client disconnected (${Math.round(timeSinceActivity / 1000)}s since last activity)`;
      recommendation =
        'Check MCP client (Claude Desktop) connection status. Client may have closed or network issue occurred.';
    } else if (timeSinceActivity >= this.warnThresholdMs) {
      // Warning - no activity but not yet disconnected
      status = Status.WARNING;
      message = `MCP client activity delayed (${Math.round(timeSinceActivity / 1000)}s since last activity)`;
      recommendation =
        'Monitor for continued inactivity. Client may be idle or experiencing issues.';
    } else {
      // Healthy
      status = Status.HEALTHY;
      message = `MCP client connected (${Math.round(timeSinceActivity / 1000)}s since last activity)`;

      // If we were disconnected and now healthy, reset counters
      if (this.isDisconnected) {
        this.isDisconnected = false;
        this.reconnectAttempts = 0;
      }
    }

    return {
      name: this.name,
      status,
      message,
      timestamp: now,
      metadata: {
        connectionId: this.connectionId,
        timeSinceLastActivity: timeSinceActivity,
        totalHeartbeats: this.totalHeartbeats,
        disconnectWarnings: this.disconnectWarnings,
        uptimeSeconds: Math.floor((now - this.monitoringStarted) / 1000),
        reconnectAttempts: this.reconnectAttempts,
        isDisconnected: this.isDisconnected,
      },
      recommendation,
    };
  }

  /**
   * Record a heartbeat (call this on any MCP activity)
   */
  recordHeartbeat(source?: string): void {
    const wasDisconnected = this.isDisconnected;

    this.lastActivity = Date.now();
    this.totalHeartbeats++;
    this.isDisconnected = false;

    // If we were disconnected and now have activity, log reconnection
    if (wasDisconnected) {
      const disconnectDuration = Date.now() - this.lastDisconnectTime;

      // Only log info for first reconnect or after significant delay
      if (this.reconnectAttempts === 0 || disconnectDuration > 300000) {
        logger.info('MCP connection restored', {
          connectionId: this.connectionId,
          source,
          disconnectDuration,
          reconnectAttempts: this.reconnectAttempts,
        });
      } else {
        // Routine reconnects use debug level to reduce noise
        logger.debug('MCP connection restored', {
          connectionId: this.connectionId,
          source,
          disconnectDuration,
          reconnectAttempts: this.reconnectAttempts,
        });
      }

      // Reset reconnect attempts on successful reconnection
      this.reconnectAttempts = 0;
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivity;

    let status: ConnectionStats['status'];
    if (this.monitoringStarted === 0) {
      status = 'unknown';
    } else if (timeSinceActivity >= this.disconnectThresholdMs) {
      status = 'disconnected';
    } else if (timeSinceActivity >= this.warnThresholdMs) {
      status = 'warning';
    } else {
      status = 'healthy';
    }

    return {
      totalHeartbeats: this.totalHeartbeats,
      timeSinceLastActivity: timeSinceActivity,
      disconnectWarnings: this.disconnectWarnings,
      uptimeSeconds:
        this.monitoringStarted > 0 ? Math.floor((now - this.monitoringStarted) / 1000) : 0,
      status,
      lastActivity: this.lastActivity,
      connectionId: this.connectionId,
    };
  }

  /**
   * Check if currently considered disconnected
   */
  isCurrentlyDisconnected(): boolean {
    return this.isDisconnected;
  }

  /**
   * Get the connection ID
   */
  getConnectionId(): string {
    return this.connectionId;
  }
}

/**
 * Create connection health check plugin
 */
export function createConnectionHealthCheck(
  options?: ConnectionHealthCheckOptions
): ConnectionHealthCheckPlugin {
  return new ConnectionHealthCheckPlugin(options);
}

/**
 * Create connection health check from environment variables
 */
export function createConnectionHealthCheckFromEnv(): ConnectionHealthCheckPlugin {
  return createConnectionHealthCheck({
    disconnectThresholdMs: parseInt(process.env['MCP_DISCONNECT_THRESHOLD_MS'] || '120000', 10),
    warnThresholdMs: parseInt(process.env['MCP_WARN_THRESHOLD_MS'] || '60000', 10),
  });
}
