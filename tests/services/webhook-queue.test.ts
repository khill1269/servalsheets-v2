/**
 * Tests for WebhookQueue (Phase 3)
 *
 * Validates Redis-backed delivery queue with retry logic and exponential backoff.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initWebhookQueue,
  getWebhookQueue,
  resetWebhookQueue,
} from '../../src/services/webhook-queue.js';

describe('WebhookQueue', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRedis: any;

  beforeEach(() => {
    // Reset singleton
    resetWebhookQueue();

    // Mock Redis client
    mockRedis = {
      rPush: vi.fn().mockResolvedValue(1),
      blPop: vi.fn().mockResolvedValue(null),
      lPop: vi.fn().mockResolvedValue(null),
      lLen: vi.fn().mockResolvedValue(0),
      keys: vi.fn().mockResolvedValue([]),
      scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }),
      del: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
  });

  describe('Initialization', () => {
    it('should initialize with Redis', () => {
      initWebhookQueue(mockRedis);
      const queue = getWebhookQueue();

      expect(queue).toBeDefined();
    });

    it('should initialize with custom config', () => {
      initWebhookQueue(mockRedis, {
        maxAttempts: 5,
        initialRetryDelayMs: 2000,
        backoffMultiplier: 3,
        maxRetryDelayMs: 600000,
      });

      const queue = getWebhookQueue();
      expect(queue).toBeDefined();
    });

    it('should throw if not initialized', () => {
      expect(() => getWebhookQueue()).toThrow('Webhook queue not initialized');
    });
  });

  describe('Enqueue', () => {
    beforeEach(() => {
      initWebhookQueue(mockRedis);
    });

    it('should enqueue delivery job', async () => {
      const queue = getWebhookQueue();
      const deliveryId = await queue.enqueue({
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update',
        payload: { test: true },
        maxAttempts: 3,
        scheduledAt: 1704067200000,
      });

      expect(deliveryId).toMatch(/^delivery_/);
      expect(mockRedis.rPush).toHaveBeenCalledWith(
        'webhook:queue:pending',
        expect.stringContaining('delivery_')
      );
    });

    it('should throw if Redis not available', async () => {
      resetWebhookQueue();
      initWebhookQueue(null);
      const queue = getWebhookQueue();

      await expect(
        queue.enqueue({
          webhookId: 'webhook_123',
          webhookUrl: 'https://user.com/callback',
          eventType: 'sheet.update',
          payload: {},
          maxAttempts: 3,
          scheduledAt: 1704067200000,
        })
      ).rejects.toThrow('Redis required');
    });

    it('should initialize job with correct fields', async () => {
      const queue = getWebhookQueue();
      await queue.enqueue({
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update',
        payload: { spreadsheetId: '1ABC' },
        secret: 'secret123',
        maxAttempts: 3,
        scheduledAt: 1704067200000,
      });

      const enqueuedData = JSON.parse(mockRedis.rPush.mock.calls[0][1]);
      expect(enqueuedData).toMatchObject({
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update',
        payload: { spreadsheetId: '1ABC' },
        secret: 'secret123',
        attemptCount: 0,
        maxAttempts: 3,
      });
      expect(enqueuedData.deliveryId).toMatch(/^delivery_/);
      expect(enqueuedData.createdAt).toBeGreaterThan(0);
    });
  });

  describe('Dequeue', () => {
    beforeEach(() => {
      initWebhookQueue(mockRedis);
    });

    it('should dequeue pending job', async () => {
      const job = {
        deliveryId: 'delivery_123',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update',
        payload: {},
        attemptCount: 0,
        maxAttempts: 3,
        createdAt: 1704067200000,
        scheduledAt: 1704067200000,
      };

      mockRedis.blPop.mockResolvedValueOnce({
        key: 'webhook:queue:pending',
        element: JSON.stringify(job),
      });

      const queue = getWebhookQueue();
      const dequeued = await queue.dequeue();

      expect(dequeued).toEqual(job);
    });

    it('should return null if queue is empty', async () => {
      mockRedis.blPop.mockResolvedValueOnce(null);

      const queue = getWebhookQueue();
      const dequeued = await queue.dequeue();

      expect(dequeued).toBeNull();
    });

    it('should prioritize retry queue over pending queue', async () => {
      const now = 1704067200000;
      const retryJob = {
        deliveryId: 'delivery_retry',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update',
        payload: {},
        attemptCount: 1,
        maxAttempts: 3,
        createdAt: now - 10000,
        scheduledAt: now - 1000, // Retry scheduled in the past
      };

      mockRedis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: [`webhook:queue:retry:${now - 1000}`],
      });
      mockRedis.lPop.mockResolvedValueOnce(JSON.stringify(retryJob));

      const queue = getWebhookQueue();
      const dequeued = await queue.dequeue();

      expect(dequeued?.deliveryId).toBe('delivery_retry');
      expect(dequeued?.attemptCount).toBe(1);
    });
  });

  describe('Mark Success', () => {
    beforeEach(() => {
      initWebhookQueue(mockRedis);
    });

    it('should log successful delivery', async () => {
      const job = {
        deliveryId: 'delivery_123',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update' as const,
        payload: {},
        attemptCount: 0,
        maxAttempts: 3,
        createdAt: 1704067200000,
        scheduledAt: 1704067200000,
      };

      const queue = getWebhookQueue();
      await queue.markSuccess(job);

      // No-op for now, just logs
    });
  });

  describe('Mark Failure', () => {
    beforeEach(() => {
      initWebhookQueue(mockRedis);
    });

    it('should schedule retry with exponential backoff', async () => {
      const job = {
        deliveryId: 'delivery_123',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update' as const,
        payload: {},
        attemptCount: 0,
        maxAttempts: 3,
        createdAt: 1704067200000,
        scheduledAt: 1704067200000,
      };

      const queue = getWebhookQueue();
      await queue.markFailure(job, 'Connection timeout');

      expect(mockRedis.rPush).toHaveBeenCalledWith(
        expect.stringMatching(/^webhook:queue:retry:/),
        expect.any(String)
      );

      const retryData = JSON.parse(mockRedis.rPush.mock.calls[0][1]);
      expect(retryData.attemptCount).toBe(1);
      expect(retryData.scheduledAt).toBeGreaterThan(Date.now());
    });

    it('should move to DLQ after max attempts', async () => {
      const job = {
        deliveryId: 'delivery_123',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update' as const,
        payload: {},
        attemptCount: 2, // Last attempt
        maxAttempts: 3,
        createdAt: 1704067200000,
        scheduledAt: 1704067200000,
      };

      const queue = getWebhookQueue();
      await queue.markFailure(job, 'Permanent failure');

      expect(mockRedis.rPush).toHaveBeenCalledWith('webhook:queue:dlq', expect.any(String));

      const dlqData = JSON.parse(mockRedis.rPush.mock.calls[0][1]);
      expect(dlqData.attemptCount).toBe(3);
      expect(dlqData.error).toBe('Permanent failure');
      expect(dlqData.failedAt).toBeDefined();
    });

    it('should use exponential backoff for retries', async () => {
      resetWebhookQueue(); // Reset singleton
      initWebhookQueue(mockRedis, {
        maxAttempts: 5,
        initialRetryDelayMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 10000,
      });

      const queue = getWebhookQueue();

      // First retry: 1000ms
      const job1 = {
        deliveryId: 'delivery_1',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update' as const,
        payload: {},
        attemptCount: 0,
        maxAttempts: 5,
        createdAt: 1704067200000,
        scheduledAt: 1704067200000,
      };
      await queue.markFailure(job1, 'Error 1');
      const retry1 = JSON.parse(mockRedis.rPush.mock.calls[0][1]);
      expect(retry1.scheduledAt - Date.now()).toBeGreaterThanOrEqual(900);
      expect(retry1.scheduledAt - Date.now()).toBeLessThan(1100);

      // Second retry: 2000ms
      const job2 = { ...job1, attemptCount: 1 };
      await queue.markFailure(job2, 'Error 2');
      const retry2 = JSON.parse(mockRedis.rPush.mock.calls[1][1]);
      expect(retry2.scheduledAt - Date.now()).toBeGreaterThanOrEqual(1900);
      expect(retry2.scheduledAt - Date.now()).toBeLessThan(2100);
    });

    it('should cap retry delay at maxRetryDelayMs', async () => {
      resetWebhookQueue(); // Reset singleton
      initWebhookQueue(mockRedis, {
        maxAttempts: 10,
        initialRetryDelayMs: 1000,
        backoffMultiplier: 2,
        maxRetryDelayMs: 5000,
      });

      const queue = getWebhookQueue();

      // Attempt 4 -> increment to 5: Would be 16000ms, but capped at 5000ms
      const job = {
        deliveryId: 'delivery_1',
        webhookId: 'webhook_123',
        webhookUrl: 'https://user.com/callback',
        eventType: 'sheet.update' as const,
        payload: {},
        attemptCount: 4, // Will be incremented to 5 in markFailure
        maxAttempts: 10,
        createdAt: 1704067200000,
        scheduledAt: 1704067200000,
      };

      const startTime = Date.now();
      await queue.markFailure(job, 'Error');
      const retry = JSON.parse(mockRedis.rPush.mock.calls[0][1]);
      const actualDelay = retry.scheduledAt - startTime;

      expect(actualDelay).toBeLessThanOrEqual(5100);
    });
  });

  describe('Get Stats', () => {
    beforeEach(() => {
      initWebhookQueue(mockRedis);
    });

    it('should return queue statistics', async () => {
      mockRedis.lLen
        .mockResolvedValueOnce(10) // pending
        .mockResolvedValueOnce(2); // dlq

      mockRedis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['webhook:queue:retry:1000', 'webhook:queue:retry:2000'],
      });
      mockRedis.lLen
        .mockResolvedValueOnce(3) // retry queue 1
        .mockResolvedValueOnce(5); // retry queue 2

      const queue = getWebhookQueue();
      const stats = await queue.getStats();

      expect(stats).toEqual({
        pendingCount: 10,
        retryCount: 8,
        dlqCount: 2,
      });
    });

    it('should return zeros if Redis not available', async () => {
      resetWebhookQueue();
      initWebhookQueue(null);
      const queue = getWebhookQueue();

      const stats = await queue.getStats();

      expect(stats).toEqual({
        pendingCount: 0,
        retryCount: 0,
        dlqCount: 0,
      });
    });
  });

  describe('Purge DLQ', () => {
    beforeEach(() => {
      initWebhookQueue(mockRedis);
    });

    it('should purge dead letter queue', async () => {
      mockRedis.lLen.mockResolvedValueOnce(5);

      const queue = getWebhookQueue();
      const purged = await queue.purgeDLQ();

      expect(purged).toBe(5);
      expect(mockRedis.del).toHaveBeenCalledWith('webhook:queue:dlq');
    });

    it('should return 0 if DLQ is empty', async () => {
      mockRedis.lLen.mockResolvedValueOnce(0);

      const queue = getWebhookQueue();
      const purged = await queue.purgeDLQ();

      expect(purged).toBe(0);
    });
  });
});
