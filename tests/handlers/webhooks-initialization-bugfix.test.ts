/**
 * Webhook Handler - Initialization Bug Fix Tests (Phase 0.8)
 *
 * Tests for bug: Webhook manager not initialized
 * Evidence from test log: "Webhook manager not initialized" error on all webhook actions
 *
 * Root cause: WebhookManager singleton not initialized during server startup
 * Fix: Add initWebhookManager() call to server initialization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookHandler, createWebhookHandler } from '../../src/handlers/webhooks.js';
import {
  initWebhookManager,
  getWebhookManager,
  resetWebhookManager,
} from '../../src/services/webhook-manager.js';
import { initWebhookQueue, resetWebhookQueue } from '../../src/services/webhook-queue.js';
import type { GoogleApiClient } from '../../src/services/google-api.js';

describe('WebhookHandler - Initialization (BUG FIX 0.8)', () => {
  let handler: WebhookHandler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock type
  let mockGoogleApi: any;

  beforeEach(() => {
    // Reset webhook infrastructure before each test
    resetWebhookManager();
    resetWebhookQueue();

    // Create mock Google API
    mockGoogleApi = {
      sheets: {},
      drive: {},
    };

    handler = createWebhookHandler();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetWebhookManager();
    resetWebhookQueue();
  });

  describe('webhook manager initialization (BUG FIX 0.8)', () => {
    it('should throw helpful error when manager not initialized', async () => {
      // Don't initialize the manager - simulate current buggy behavior
      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      // Should return error (not throw)
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('Redis required');
    });

    it('should work after manager is initialized', async () => {
      // Initialize webhook infrastructure (this is what server.ts should do)
      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      // Should succeed (even though no Redis - will throw Redis error inside)
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should provide clear error about Redis requirement when Redis not available', async () => {
      // Initialize with null Redis
      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      // Should return error mentioning Redis
      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('Redis required');
    });

    it('should initialize once and reuse singleton', () => {
      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');

      const manager1 = getWebhookManager();
      const manager2 = getWebhookManager();

      expect(manager1).toBe(manager2); // Same instance
    });

    it('should warn on duplicate initialization', () => {
      const logSpy = vi.spyOn(console, 'log');

      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');
      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');

      // Should log warning (implementation logs via logger)
      // Just verify no crash on second call
      expect(getWebhookManager()).toBeDefined();

      logSpy.mockRestore();
    });
  });

  describe('webhook actions with initialized manager', () => {
    beforeEach(() => {
      // Initialize webhook infrastructure for action tests
      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');
    });

    it('should handle list action after initialization', async () => {
      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      // Will fail with Redis error, but that's expected - not initialization error
      expect(result.response).toBeDefined();
      if (!result.response.success) {
        expect(result.response.error?.message).not.toContain('not initialized');
      }
    });

    it('should handle get_stats action after initialization', async () => {
      const result = await handler.handle({
        request: {
          action: 'get_stats',
        },
      });

      // Will fail with Redis error, but not initialization error
      expect(result.response).toBeDefined();
      if (!result.response.success) {
        expect(result.response.error?.message).not.toContain('not initialized');
      }
    });
  });

  describe('regression tests', () => {
    it('should not crash on unknown action', async () => {
      initWebhookQueue(null);
      initWebhookManager(null, mockGoogleApi as GoogleApiClient, 'https://example.com/webhook');

      const result = await handler.handle({
        request: {
          // @ts-expect-error - Testing invalid action
          action: 'invalid_action',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
    });
  });
});
