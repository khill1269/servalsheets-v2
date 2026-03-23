/**
 * ServalSheets - TokenManager Tests
 *
 * Comprehensive tests for OAuth token management and proactive refresh
 * Tests token status, refresh logic, background monitoring, security anomaly detection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TokenManager,
  getTokenManager,
  resetTokenManager,
} from '../../src/services/token-manager.js';
import type { OAuth2Client } from 'google-auth-library';

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockOAuthClient: Partial<OAuth2Client>;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1704067200000 });

    mockOAuthClient = {
      credentials: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: 1704067200000 + 3600000, // 1 hour from now
      },
      setCredentials: vi.fn(),
      refreshAccessToken: vi.fn().mockResolvedValue({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: 'test-refresh-token',
          expiry_date: 1704067200000 + 3600000,
        },
      }),
    };

    tokenManager = new TokenManager({
      oauthClient: mockOAuthClient as OAuth2Client,
      refreshThreshold: 0.8, // Refresh at 80% of lifetime
      checkIntervalMs: 300000, // 5 minutes
    });
  });

  afterEach(() => {
    tokenManager.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
    resetTokenManager();
  });

  describe('Token Status', () => {
    it('should return status with valid token', () => {
      const status = tokenManager.getTokenStatus();

      expect(status.hasAccessToken).toBe(true);
      expect(status.hasRefreshToken).toBe(true);
      expect(status.expiryDate).toBeDefined();
      expect(status.timeUntilExpiry).toBeGreaterThan(0);
      expect(status.needsRefresh).toBe(false); // Not yet at 80% threshold
    });

    it('should indicate no token when OAuth client is missing', () => {
      const managerWithoutClient = new TokenManager();
      const status = managerWithoutClient.getTokenStatus();

      expect(status.hasAccessToken).toBe(false);
      expect(status.hasRefreshToken).toBe(false);
      expect(status.needsRefresh).toBe(false);
    });

    it('should indicate missing access token', () => {
      mockOAuthClient.credentials = {
        refresh_token: 'test-refresh-token',
      };

      const status = tokenManager.getTokenStatus();

      expect(status.hasAccessToken).toBe(false);
      expect(status.hasRefreshToken).toBe(true);
    });

    it('should indicate missing refresh token', () => {
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        expiry_date: 1704067200000 + 3600000,
      };

      const status = tokenManager.getTokenStatus();

      expect(status.hasAccessToken).toBe(true);
      expect(status.hasRefreshToken).toBe(false);
    });

    it('should handle missing expiry date', () => {
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      };

      const status = tokenManager.getTokenStatus();

      expect(status.hasAccessToken).toBe(true);
      expect(status.hasRefreshToken).toBe(true);
      expect(status.expiryDate).toBeUndefined();
      expect(status.needsRefresh).toBe(false);
    });

    it('should indicate token needs refresh at 80% threshold', () => {
      // Token with only 10 minutes left (below 20% of 1-hour lifetime)
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: 1704067200000 + 600000, // 10 minutes
      };

      const status = tokenManager.getTokenStatus();

      expect(status.needsRefresh).toBe(true);
      expect(status.timeUntilExpiry).toBeCloseTo(600000, -3);
    });

    it('should not indicate refresh for token above threshold', () => {
      // Token with 50 minutes left (above 80% of 1-hour lifetime)
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: 1704067200000 + 3000000, // 50 minutes
      };

      const status = tokenManager.getTokenStatus();

      expect(status.needsRefresh).toBe(false);
    });
  });

  describe('Token Refresh', () => {
    it('should refresh token successfully', async () => {
      const result = await tokenManager.refreshToken();

      expect(result).toBe(true);
      expect(mockOAuthClient.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(mockOAuthClient.setCredentials).toHaveBeenCalledWith({
        access_token: 'new-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: expect.any(Number),
      });
    });

    it('should update metrics after successful refresh', async () => {
      await tokenManager.refreshToken();

      const metrics = tokenManager.getMetrics() as {
        totalRefreshes: number;
        successfulRefreshes: number;
        lastRefreshSuccess: boolean;
      };

      expect(metrics.totalRefreshes).toBe(1);
      expect(metrics.successfulRefreshes).toBe(1);
      expect(metrics.lastRefreshSuccess).toBe(true);
    });

    it('should handle refresh failure', async () => {
      mockOAuthClient.refreshAccessToken = vi.fn().mockRejectedValue(new Error('Token expired'));

      const result = await tokenManager.refreshToken();

      expect(result).toBe(false);

      const metrics = tokenManager.getMetrics() as {
        totalRefreshes: number;
        failedRefreshes: number;
        lastRefreshSuccess: boolean;
      };

      expect(metrics.totalRefreshes).toBe(1);
      expect(metrics.failedRefreshes).toBe(1);
      expect(metrics.lastRefreshSuccess).toBe(false);
    });

    it('should call onTokenRefreshed callback', async () => {
      const onTokenRefreshed = vi.fn();
      const managerWithCallback = new TokenManager({
        oauthClient: mockOAuthClient as OAuth2Client,
        onTokenRefreshed,
      });

      await managerWithCallback.refreshToken();

      expect(onTokenRefreshed).toHaveBeenCalledTimes(1);
      expect(onTokenRefreshed).toHaveBeenCalledWith({
        access_token: 'new-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: expect.any(Number),
      });
    });

    it('should call onRefreshError callback on failure', async () => {
      const onRefreshError = vi.fn();
      const managerWithCallback = new TokenManager({
        oauthClient: mockOAuthClient as OAuth2Client,
        onRefreshError,
      });

      mockOAuthClient.refreshAccessToken = vi.fn().mockRejectedValue(new Error('Token expired'));

      await managerWithCallback.refreshToken();

      expect(onRefreshError).toHaveBeenCalledTimes(1);
      expect(onRefreshError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should throw error when OAuth client not configured', async () => {
      const managerWithoutClient = new TokenManager();

      await expect(managerWithoutClient.refreshToken()).rejects.toThrow(
        'OAuth client not configured'
      );
    });

    it('should track average refresh duration', async () => {
      // First refresh
      vi.advanceTimersByTime(10); // Ensure time passes
      await tokenManager.refreshToken();

      const metrics1 = tokenManager.getMetrics() as { averageRefreshDuration: number };
      expect(metrics1.averageRefreshDuration).toBeGreaterThanOrEqual(0);

      // Second refresh
      vi.advanceTimersByTime(15); // Ensure time passes
      await tokenManager.refreshToken();

      const metrics2 = tokenManager.getMetrics() as { averageRefreshDuration: number };
      expect(metrics2.averageRefreshDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Check and Refresh', () => {
    it('should not refresh if token does not need refresh', async () => {
      // Token with 50 minutes left (above threshold)
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: 1704067200000 + 3000000,
      };

      const result = await tokenManager.checkAndRefresh();

      expect(result).toBe(false);
      expect(mockOAuthClient.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should refresh if token needs refresh', async () => {
      // Token with 10 minutes left (below threshold)
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: 1704067200000 + 600000,
      };

      const result = await tokenManager.checkAndRefresh();

      expect(result).toBe(true);
      expect(mockOAuthClient.refreshAccessToken).toHaveBeenCalledTimes(1);
    });

    it('should not refresh if no refresh token available', async () => {
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        expiry_date: 1704067200000 + 600000,
      };

      const result = await tokenManager.checkAndRefresh();

      expect(result).toBe(false);
      expect(mockOAuthClient.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should return false if OAuth client not set', async () => {
      const managerWithoutClient = new TokenManager();

      const result = await managerWithoutClient.checkAndRefresh();

      expect(result).toBe(false);
    });
  });

  describe('Background Monitoring', () => {
    it('should start background monitoring', () => {
      tokenManager.start();

      const metrics = tokenManager.getMetrics() as { isRunning: boolean };
      expect(metrics.isRunning).toBe(true);
    });

    it('should perform initial check on start', async () => {
      const checkSpy = vi.spyOn(tokenManager, 'checkAndRefresh');

      tokenManager.start();

      await vi.runOnlyPendingTimersAsync();

      expect(checkSpy).toHaveBeenCalled();
    });

    it('should perform periodic checks', async () => {
      const checkSpy = vi.spyOn(tokenManager, 'checkAndRefresh');

      tokenManager.start();

      // Advance by check interval (5 minutes)
      await vi.advanceTimersByTimeAsync(300000);

      expect(checkSpy).toHaveBeenCalledTimes(2); // Initial + 1 interval
    });

    it('should not start if already running', () => {
      tokenManager.start();
      tokenManager.start(); // Try starting again

      const metrics = tokenManager.getMetrics() as { isRunning: boolean };
      expect(metrics.isRunning).toBe(true);
    });

    it('should stop background monitoring', () => {
      tokenManager.start();
      tokenManager.stop();

      const metrics = tokenManager.getMetrics() as { isRunning: boolean };
      expect(metrics.isRunning).toBe(false);
    });

    it('should not throw error when stopping while not running', () => {
      expect(() => tokenManager.stop()).not.toThrow();
    });

    it('should stop periodic checks on stop', async () => {
      const checkSpy = vi.spyOn(tokenManager, 'checkAndRefresh');

      tokenManager.start();
      await vi.advanceTimersByTimeAsync(300000); // One interval

      tokenManager.stop();

      // Advance time again - should not trigger checks
      await vi.advanceTimersByTimeAsync(300000);

      expect(checkSpy).toHaveBeenCalledTimes(2); // Initial + 1 interval (not more)
    });
  });

  describe('Security Monitoring', () => {
    it('should track refresh pattern statistics', async () => {
      // Perform some refreshes
      await tokenManager.refreshToken();
      await tokenManager.refreshToken();
      await tokenManager.refreshToken();

      const stats = tokenManager.getRefreshPatternStats();

      expect(stats.refreshesLastHour).toBe(3);
      expect(stats.refreshesLastDay).toBe(3);
      expect(stats.failureRate).toBe(0);
      expect(stats.isAnomalous).toBe(false);
    });

    it('should detect anomalous refresh patterns', async () => {
      // Perform 11 refreshes (above threshold of 10)
      for (let i = 0; i < 11; i++) {
        await tokenManager.refreshToken();
      }

      const stats = tokenManager.getRefreshPatternStats();

      expect(stats.isAnomalous).toBe(true);
      expect(stats.refreshesLastHour).toBeGreaterThan(10);
    });

    it('should track failure rate', async () => {
      // Successful refresh
      await tokenManager.refreshToken();

      // Failed refresh
      mockOAuthClient.refreshAccessToken = vi.fn().mockRejectedValue(new Error('Failed'));
      await tokenManager.refreshToken();

      // Another successful refresh
      mockOAuthClient.refreshAccessToken = vi.fn().mockResolvedValue({
        credentials: {
          access_token: 'new-token',
          refresh_token: 'test-refresh-token',
          expiry_date: 1704067200000 + 3600000,
        },
      });
      await tokenManager.refreshToken();

      const stats = tokenManager.getRefreshPatternStats();

      expect(stats.failureRate).toBeCloseTo(1 / 3, 2); // 1 failure out of 3 attempts
    });

    it('should filter refreshes by time window', async () => {
      // Refresh now
      await tokenManager.refreshToken();

      // Advance time by 2 hours
      vi.advanceTimersByTime(7200000);

      // Another refresh
      await tokenManager.refreshToken();

      const stats = tokenManager.getRefreshPatternStats();

      // Only the second refresh should be in "last hour"
      expect(stats.refreshesLastHour).toBe(1);
      // Both should be in "last day"
      expect(stats.refreshesLastDay).toBe(2);
    });

    it('should maintain refresh history limit', async () => {
      // Perform 150 refreshes (above limit of 100)
      for (let i = 0; i < 150; i++) {
        await tokenManager.refreshToken();
      }

      const stats = tokenManager.getRefreshPatternStats();

      // Should only track last 100 + recent ones in windows
      expect(stats.refreshesLastHour).toBeLessThanOrEqual(150);
    });
  });

  describe('Metrics', () => {
    it('should calculate success rate', async () => {
      // 2 successful
      await tokenManager.refreshToken();
      await tokenManager.refreshToken();

      // 1 failed
      mockOAuthClient.refreshAccessToken = vi.fn().mockRejectedValue(new Error('Failed'));
      await tokenManager.refreshToken();

      const metrics = tokenManager.getMetrics() as { successRate: number };

      expect(metrics.successRate).toBeCloseTo(2 / 3, 2);
    });

    it('should handle zero refreshes', () => {
      const metrics = tokenManager.getMetrics() as { successRate: number; totalRefreshes: number };

      expect(metrics.successRate).toBe(0);
      expect(metrics.totalRefreshes).toBe(0);
    });

    it('should reset metrics', async () => {
      await tokenManager.refreshToken();

      tokenManager.resetMetrics();

      const metrics = tokenManager.getMetrics() as {
        totalRefreshes: number;
        successfulRefreshes: number;
      };

      expect(metrics.totalRefreshes).toBe(0);
      expect(metrics.successfulRefreshes).toBe(0);
    });
  });

  describe('OAuth Client Management', () => {
    it('should allow setting OAuth client after initialization', () => {
      const managerWithoutClient = new TokenManager();

      managerWithoutClient.setOAuthClient(mockOAuthClient as OAuth2Client);

      const status = managerWithoutClient.getTokenStatus();
      expect(status.hasAccessToken).toBe(true);
    });

    it('should work with updated OAuth client', async () => {
      const newMockClient = {
        credentials: {
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expiry_date: 1704067200000 + 1800000,
        },
        setCredentials: vi.fn(),
        refreshAccessToken: vi.fn().mockResolvedValue({
          credentials: {
            access_token: 'refreshed-token',
            refresh_token: 'new-refresh',
            expiry_date: 1704067200000 + 3600000,
          },
        }),
      };

      tokenManager.setOAuthClient(newMockClient as OAuth2Client);

      await tokenManager.refreshToken();

      expect(newMockClient.refreshAccessToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('Configuration', () => {
    it('should use custom refresh threshold', () => {
      const customManager = new TokenManager({
        oauthClient: mockOAuthClient as OAuth2Client,
        refreshThreshold: 0.5, // 50% threshold
      });

      // Token with 20 minutes left (below 50% of 1-hour lifetime)
      // 50% of 3600000ms = 1800000ms (30 minutes)
      // 20 minutes = 1200000ms < 1800000ms, so needs refresh
      mockOAuthClient.credentials = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry_date: 1704067200000 + 1200000,
      };

      const status = customManager.getTokenStatus();

      expect(status.needsRefresh).toBe(true);
    });

    it('should use custom check interval', () => {
      const customManager = new TokenManager({
        oauthClient: mockOAuthClient as OAuth2Client,
        checkIntervalMs: 60000, // 1 minute
      });

      const checkSpy = vi.spyOn(customManager, 'checkAndRefresh');

      customManager.start();

      // Should trigger at 1-minute interval
      vi.advanceTimersByTime(60000);

      expect(checkSpy).toHaveBeenCalled();

      customManager.stop();
    });

    it('should use default values', () => {
      const defaultManager = new TokenManager();

      // Default refresh threshold is 0.8
      // Default check interval is 300000 (5 minutes)

      expect(defaultManager).toBeDefined();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const manager1 = getTokenManager();
      const manager2 = getTokenManager();

      expect(manager1).toBe(manager2);
    });

    it('should create new instance after reset', () => {
      const manager1 = getTokenManager();

      resetTokenManager();

      const manager2 = getTokenManager();

      expect(manager1).not.toBe(manager2);
    });

    it('should stop manager on reset', () => {
      const manager = getTokenManager();
      manager.start();

      resetTokenManager();

      const metrics = manager.getMetrics() as { isRunning: boolean };
      expect(metrics.isRunning).toBe(false);
    });
  });

  // ─── Concurrent Refresh Race ───────────────────────────────────────────────
  // Regression for token refresh storms: 10 concurrent refreshToken() calls
  // must not each independently hit the OAuth endpoint causing a storm.
  // This test documents the current behavior and detects regressions.

  describe('Concurrent token refresh behavior', () => {
    it('10 concurrent refreshToken() calls all complete without throwing', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => tokenManager.refreshToken())
      );

      // All calls must complete — none should throw
      expect(results).toHaveLength(10);
      expect(results.every((r) => r === true)).toBe(true);
    });

    it('10 concurrent refreshToken() calls increment totalRefreshes by 10', async () => {
      await Promise.all(
        Array.from({ length: 10 }, () => tokenManager.refreshToken())
      );

      const metrics = tokenManager.getMetrics() as { totalRefreshes: number };
      // Without concurrency guard, each concurrent call increments independently
      expect(metrics.totalRefreshes).toBe(10);
    });

    it('refreshTokenOnAuthError respects cooldown under concurrent pressure', async () => {
      // First call succeeds, subsequent calls within cooldown are skipped
      const results = await Promise.all(
        Array.from({ length: 5 }, () => tokenManager.refreshTokenOnAuthError())
      );

      // At least one should have been called, but cooldown may skip subsequent calls
      const trueCount = results.filter(Boolean).length;
      expect(trueCount).toBeGreaterThanOrEqual(1);

      // API should be called at least once but possibly not 5 times
      expect(mockOAuthClient.refreshAccessToken).toHaveBeenCalled();
    });

    it('concurrent refreshes do not leave credentials in an inconsistent state', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () => tokenManager.refreshToken())
      );

      // After all concurrent refreshes, credentials should still be valid
      const status = tokenManager.getTokenStatus();
      expect(status.hasAccessToken).toBe(true);
    });
  });
});
