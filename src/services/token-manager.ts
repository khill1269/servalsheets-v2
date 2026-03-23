/**
 * TokenManager
 *
 * @purpose Proactively refreshes OAuth tokens before expiry to prevent interruptions (default: refresh at 80% of token lifetime)
 * @category Infrastructure
 * @usage Use for long-running sessions with OAuth; checks token status every 5min, automatically refreshes when threshold reached
 * @dependencies OAuth2Client, logger
 * @stateful Yes - maintains check interval timer, last refresh timestamp, token status
 * @singleton Yes - one instance per OAuth client to coordinate refresh timing
 *
 * @example
 * const manager = new TokenManager({ oauthClient, refreshThreshold: 0.8, checkIntervalMs: 300000 });
 * manager.start(); // Begins automatic refresh checks
 * const status = manager.getTokenStatus(); // { hasAccessToken: true, needsRefresh: false, timeUntilExpiry: 3540000 }
 */

import type { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger.js';
import { registerCleanup } from '../utils/resource-cleanup.js';
import { ConfigError, ServiceError } from '../core/errors.js';

export interface TokenStatus {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiryDate?: number;
  timeUntilExpiry?: number;
  needsRefresh: boolean;
}

export interface TokenManagerOptions {
  /** OAuth client for token refresh */
  oauthClient?: OAuth2Client;
  /** Refresh tokens when they reach this percentage of their lifetime (default: 0.8 = 80%) */
  refreshThreshold?: number;
  /** Check interval in milliseconds (default: 5 minutes) */
  checkIntervalMs?: number;
  /** Callback when token is refreshed */
  onTokenRefreshed?: (tokens: import('google-auth-library').Credentials) => void | Promise<void>;
  /** Callback when refresh fails */
  onRefreshError?: (error: Error) => void | Promise<void>;
}

/**
 * Token Manager
 *
 * Monitors OAuth token expiry and proactively refreshes tokens
 * before they expire to prevent authentication interruptions.
 *
 * Features:
 * - Background monitoring with configurable interval
 * - Proactive refresh at 80% of token lifetime
 * - Metrics collection for refresh operations
 * - Error handling with callbacks
 * - Graceful shutdown support
 */
export class TokenManager {
  private oauthClient?: OAuth2Client;
  private refreshThreshold: number;
  private checkIntervalMs: number;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private onTokenRefreshed?: (
    tokens: import('google-auth-library').Credentials
  ) => void | Promise<void>;
  private onRefreshError?: (error: Error) => void | Promise<void>;

  // Metrics
  private metrics = {
    totalRefreshes: 0,
    successfulRefreshes: 0,
    failedRefreshes: 0,
    lastRefreshTime: 0,
    lastRefreshSuccess: false,
    averageRefreshDuration: 0,
  };

  // Security monitoring (Phase 1, Task 1.1 enhancement)
  private refreshHistory: Array<{ timestamp: number; success: boolean }> = [];
  private readonly maxHistorySize = 100;
  private readonly anomalyThreshold = 10; // refreshes per hour

  constructor(options: TokenManagerOptions = {}) {
    this.oauthClient = options.oauthClient;
    this.refreshThreshold = options.refreshThreshold ?? 0.8; // 80% of lifetime
    this.checkIntervalMs = options.checkIntervalMs ?? 60000; // 1 minute (reduced from 5min for faster token recovery)
    this.onTokenRefreshed = options.onTokenRefreshed;
    this.onRefreshError = options.onRefreshError;
  }

  /**
   * Set the OAuth client (allows updating after initialization)
   */
  setOAuthClient(client: OAuth2Client): void {
    this.oauthClient = client;
  }

  /**
   * Get current token status
   */
  getTokenStatus(): TokenStatus {
    if (!this.oauthClient) {
      return {
        hasAccessToken: false,
        hasRefreshToken: false,
        needsRefresh: false,
      };
    }

    const credentials = this.oauthClient.credentials;
    const hasAccessToken = Boolean(credentials.access_token);
    const hasRefreshToken = Boolean(credentials.refresh_token);
    const expiryDate = credentials.expiry_date;

    if (!expiryDate) {
      return {
        hasAccessToken,
        hasRefreshToken,
        needsRefresh: false,
      };
    }

    const now = Date.now();
    const timeUntilExpiry = expiryDate - now;
    const tokenLifetime = this.estimateTokenLifetime(expiryDate, now);
    const needsRefresh = timeUntilExpiry < tokenLifetime * (1 - this.refreshThreshold);

    return {
      hasAccessToken,
      hasRefreshToken,
      expiryDate,
      timeUntilExpiry,
      needsRefresh,
    };
  }

  /**
   * Estimate token lifetime based on current expiry
   * Assumes standard OAuth token lifetime of 1 hour
   */
  private estimateTokenLifetime(expiryDate: number, now: number): number {
    const timeUntilExpiry = expiryDate - now;

    // If token is already expired or about to expire, assume 1 hour lifetime
    if (timeUntilExpiry < 60000) {
      // Less than 1 minute
      return 3600000; // 1 hour
    }

    // Otherwise, estimate based on remaining time
    // Assuming we're checking regularly, we can estimate total lifetime
    return 3600000; // Default to 1 hour (standard OAuth token lifetime)
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  async checkAndRefresh(): Promise<boolean> {
    if (!this.oauthClient) {
      return false;
    }

    const status = this.getTokenStatus();

    // No refresh token available
    if (!status.hasRefreshToken) {
      logger.debug('No refresh token available for proactive refresh');
      return false;
    }

    // Token doesn't need refresh yet
    if (!status.needsRefresh) {
      logger.debug('Token does not need refresh yet', {
        timeUntilExpiry: status.timeUntilExpiry,
        expiryDate: status.expiryDate,
      });
      return false;
    }

    // Refresh the token
    logger.info('Proactively refreshing OAuth token', {
      timeUntilExpiry: status.timeUntilExpiry,
      threshold: this.refreshThreshold,
    });

    return await this.refreshToken();
  }

  /**
   * Reactively refresh token on 401 errors (called by retry logic)
   * Skips if last refresh was within the cooldown window to prevent refresh storms
   */
  async refreshTokenOnAuthError(): Promise<boolean> {
    const cooldownMs = 5000; // 5 second cooldown between reactive refreshes
    const timeSinceLastRefresh = Date.now() - this.metrics.lastRefreshTime;
    if (timeSinceLastRefresh < cooldownMs) {
      logger.debug('Skipping reactive token refresh (cooldown active)', {
        timeSinceLastRefresh,
        cooldownMs,
      });
      return false;
    }
    logger.info('Reactive token refresh triggered by auth error');
    return await this.refreshToken();
  }

  /**
   * Force refresh the token
   */
  async refreshToken(): Promise<boolean> {
    if (!this.oauthClient) {
      throw new ConfigError('OAuth client not configured', 'GOOGLE_CLIENT_ID');
    }

    const startTime = Date.now();
    this.metrics.totalRefreshes++;

    try {
      const { credentials } = await this.oauthClient.refreshAccessToken();
      this.oauthClient.setCredentials(credentials);

      const duration = Date.now() - startTime;
      this.metrics.successfulRefreshes++;
      this.metrics.lastRefreshTime = Date.now();
      this.metrics.lastRefreshSuccess = true;

      // Update rolling average
      this.metrics.averageRefreshDuration =
        (this.metrics.averageRefreshDuration * (this.metrics.successfulRefreshes - 1) + duration) /
        this.metrics.successfulRefreshes;

      logger.info('Token refreshed successfully', {
        duration,
        newExpiry: credentials.expiry_date,
      });

      // Record successful refresh for security monitoring
      this.recordRefreshAttempt(true);

      // Call callback if provided
      if (this.onTokenRefreshed) {
        await this.onTokenRefreshed(credentials);
      }

      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.failedRefreshes++;
      this.metrics.lastRefreshTime = Date.now();
      this.metrics.lastRefreshSuccess = false;

      logger.error('Failed to refresh token', {
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      // Record failed refresh for security monitoring
      this.recordRefreshAttempt(false);

      // Call error callback if provided
      if (this.onRefreshError && error instanceof Error) {
        await this.onRefreshError(error);
      }

      return false;
    }
  }

  /**
   * Record refresh attempt for security monitoring
   * Phase 1, Task 1.1 enhancement
   */
  private recordRefreshAttempt(success: boolean): void {
    const now = Date.now();

    // Add to history
    this.refreshHistory.push({ timestamp: now, success });

    // Maintain history size limit
    if (this.refreshHistory.length > this.maxHistorySize) {
      this.refreshHistory.shift();
    }

    // Check for anomalies
    this.detectRefreshAnomalies();
  }

  /**
   * Detect unusual refresh patterns that might indicate compromised tokens
   * Phase 1, Task 1.1 enhancement
   */
  private detectRefreshAnomalies(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 hour in ms

    // Count refreshes in the last hour
    const recentRefreshes = this.refreshHistory.filter((entry) => entry.timestamp > oneHourAgo);

    if (recentRefreshes.length > this.anomalyThreshold) {
      logger.warn('Unusual token refresh pattern detected - possible compromised token', {
        refreshesInLastHour: recentRefreshes.length,
        threshold: this.anomalyThreshold,
        recommendation: 'Review token usage and consider rotating OAuth credentials',
      });
    }

    // Check for rapid refresh failures (potential attack)
    const recentFailures = recentRefreshes.filter((entry) => !entry.success);
    if (recentFailures.length >= 3) {
      logger.error('Multiple token refresh failures detected', {
        failuresInLastHour: recentFailures.length,
        recommendation: 'Check OAuth credentials and refresh token validity',
      });
    }
  }

  /**
   * Get refresh pattern statistics for security monitoring
   * Phase 1, Task 1.1 enhancement
   */
  getRefreshPatternStats(): {
    refreshesLastHour: number;
    refreshesLastDay: number;
    failureRate: number;
    isAnomalous: boolean;
  } {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    const lastHour = this.refreshHistory.filter((entry) => entry.timestamp > oneHourAgo);
    const lastDay = this.refreshHistory.filter((entry) => entry.timestamp > oneDayAgo);

    const totalInHistory = this.refreshHistory.length;
    const failures = this.refreshHistory.filter((entry) => !entry.success).length;

    return {
      refreshesLastHour: lastHour.length,
      refreshesLastDay: lastDay.length,
      failureRate: totalInHistory > 0 ? failures / totalInHistory : 0,
      isAnomalous: lastHour.length > this.anomalyThreshold,
    };
  }

  /**
   * Start background monitoring
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Token manager already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting token manager', {
      checkIntervalMs: this.checkIntervalMs,
      refreshThreshold: this.refreshThreshold,
    });

    // Initial check
    this.checkAndRefresh().catch((error) => {
      logger.error('Error in initial token check', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Set up periodic checks
    this.intervalId = setInterval(() => {
      this.checkAndRefresh().catch((error) => {
        logger.error('Error in token refresh check', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.checkIntervalMs);

    // Register cleanup to prevent memory leak
    registerCleanup(
      'TokenManager',
      () => {
        if (this.intervalId) {
          clearInterval(this.intervalId);
        }
      },
      'token-check-interval'
    );
  }

  /**
   * Stop background monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    logger.info('Token manager stopped', {
      metrics: this.getMetrics(),
    });
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): unknown {
    return {
      ...this.metrics,
      successRate:
        this.metrics.totalRefreshes > 0
          ? this.metrics.successfulRefreshes / this.metrics.totalRefreshes
          : 0,
      isRunning: this.isRunning,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRefreshes: 0,
      successfulRefreshes: 0,
      failedRefreshes: 0,
      lastRefreshTime: 0,
      lastRefreshSuccess: false,
      averageRefreshDuration: 0,
    };
  }
}

/**
 * Global token manager instance (optional singleton usage)
 */
let globalTokenManager: TokenManager | null = null;

/**
 * Get or create global token manager
 */
export function getTokenManager(options?: TokenManagerOptions): TokenManager {
  if (!globalTokenManager) {
    globalTokenManager = new TokenManager(options);
  }
  return globalTokenManager;
}

/**
 * Set global token manager
 */
export function setTokenManager(manager: TokenManager): void {
  globalTokenManager = manager;
}

/**
 * Reset global token manager (for testing only)
 * @internal
 */
export function resetTokenManager(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetTokenManager() can only be called in test environment',
      'INTERNAL_ERROR',
      'TokenManager'
    );
  }
  if (globalTokenManager) {
    globalTokenManager.stop();
  }
  globalTokenManager = null;
}
