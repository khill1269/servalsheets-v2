/**
 * TokenManager Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenManager } from '../../src/services/token-manager.js';

type TokenMetrics = {
  totalRefreshes: number;
  successfulRefreshes: number;
  failedRefreshes: number;
  successRate: number;
  lastRefreshSuccess: boolean;
  isRunning: boolean;
};

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockOAuthClient: any;

  beforeEach(() => {
    // Mock OAuth2Client
    mockOAuthClient = {
      credentials: {
        access_token: 'mock_access_token',
        refresh_token: 'mock_refresh_token',
        expiry_date: Date.now() + 3600000, // 1 hour from now
      },
      refreshAccessToken: vi.fn().mockResolvedValue({
        credentials: {
          access_token: 'new_access_token',
          refresh_token: 'mock_refresh_token',
          expiry_date: Date.now() + 3600000,
        },
      }),
      setCredentials: vi.fn(),
    };

    tokenManager = new TokenManager({
      oauthClient: mockOAuthClient,
      refreshThreshold: 0.8,
      checkIntervalMs: 100, // Short interval for testing
    });
  });

  afterEach(() => {
    tokenManager.stop();
  });

  describe('getTokenStatus', () => {
    it('should return correct token status', () => {
      const status = tokenManager.getTokenStatus();

      expect(status.hasAccessToken).toBe(true);
      expect(status.hasRefreshToken).toBe(true);
      expect(status.expiryDate).toBeDefined();
      expect(status.timeUntilExpiry).toBeGreaterThan(0);
      expect(status.needsRefresh).toBe(false); // Fresh token
    });

    it('should indicate token needs refresh when near expiry', () => {
      // Set token to expire soon (10% of lifetime remaining)
      mockOAuthClient.credentials.expiry_date = Date.now() + 360000; // 6 minutes (10% of 1 hour)

      const status = tokenManager.getTokenStatus();

      expect(status.needsRefresh).toBe(true);
    });

    it('should handle missing OAuth client', () => {
      const tm = new TokenManager();
      const status = tm.getTokenStatus();

      expect(status.hasAccessToken).toBe(false);
      expect(status.hasRefreshToken).toBe(false);
      expect(status.needsRefresh).toBe(false);
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh token', async () => {
      const result = await tokenManager.refreshToken();

      expect(result).toBe(true);
      expect(mockOAuthClient.refreshAccessToken).toHaveBeenCalled();
      expect(mockOAuthClient.setCredentials).toHaveBeenCalled();
    });

    it('should handle refresh failure', async () => {
      mockOAuthClient.refreshAccessToken.mockRejectedValue(new Error('Refresh failed'));

      const result = await tokenManager.refreshToken();

      expect(result).toBe(false);
    });

    it('should call onTokenRefreshed callback', async () => {
      const onRefreshed = vi.fn();
      const tm = new TokenManager({
        oauthClient: mockOAuthClient,
        onTokenRefreshed: onRefreshed,
      });

      await tm.refreshToken();

      expect(onRefreshed).toHaveBeenCalled();
    });

    it('should call onRefreshError callback on failure', async () => {
      const onError = vi.fn();
      const error = new Error('Refresh failed');
      mockOAuthClient.refreshAccessToken.mockRejectedValue(error);

      const tm = new TokenManager({
        oauthClient: mockOAuthClient,
        onRefreshError: onError,
      });

      await tm.refreshToken();

      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  describe('checkAndRefresh', () => {
    it('should not refresh when token is fresh', async () => {
      const result = await tokenManager.checkAndRefresh();

      expect(result).toBe(false);
      expect(mockOAuthClient.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('should refresh when token needs refresh', async () => {
      // Set token to expire soon
      mockOAuthClient.credentials.expiry_date = Date.now() + 360000; // 6 minutes

      const result = await tokenManager.checkAndRefresh();

      expect(result).toBe(true);
      expect(mockOAuthClient.refreshAccessToken).toHaveBeenCalled();
    });

    it('should not refresh when no refresh token available', async () => {
      mockOAuthClient.credentials.refresh_token = undefined;

      const result = await tokenManager.checkAndRefresh();

      expect(result).toBe(false);
      expect(mockOAuthClient.refreshAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('start and stop', () => {
    it('should start and stop monitoring', async () => {
      tokenManager.start();

      const runningMetrics = tokenManager.getMetrics() as TokenMetrics;
      expect(runningMetrics.isRunning).toBe(true);

      tokenManager.stop();

      const stoppedMetrics = tokenManager.getMetrics() as TokenMetrics;
      expect(stoppedMetrics.isRunning).toBe(false);
    });

    it('should not start twice', () => {
      tokenManager.start();
      tokenManager.start(); // Second call should be ignored

      const metrics = tokenManager.getMetrics() as TokenMetrics;
      expect(metrics.isRunning).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should track refresh metrics', async () => {
      await tokenManager.refreshToken();
      await tokenManager.refreshToken();

      const metrics = tokenManager.getMetrics() as TokenMetrics;

      expect(metrics.totalRefreshes).toBe(2);
      expect(metrics.successfulRefreshes).toBe(2);
      expect(metrics.failedRefreshes).toBe(0);
      expect(metrics.successRate).toBe(1.0);
      expect(metrics.lastRefreshSuccess).toBe(true);
    });

    it('should track failed refreshes', async () => {
      mockOAuthClient.refreshAccessToken.mockRejectedValue(new Error('Failed'));

      await tokenManager.refreshToken();

      const metrics = tokenManager.getMetrics() as TokenMetrics;

      expect(metrics.totalRefreshes).toBe(1);
      expect(metrics.successfulRefreshes).toBe(0);
      expect(metrics.failedRefreshes).toBe(1);
      expect(metrics.successRate).toBe(0);
      expect(metrics.lastRefreshSuccess).toBe(false);
    });

    it('should reset metrics', async () => {
      await tokenManager.refreshToken();

      tokenManager.resetMetrics();

      const metrics = tokenManager.getMetrics() as TokenMetrics;

      expect(metrics.totalRefreshes).toBe(0);
      expect(metrics.successfulRefreshes).toBe(0);
      expect(metrics.failedRefreshes).toBe(0);
    });
  });
});
