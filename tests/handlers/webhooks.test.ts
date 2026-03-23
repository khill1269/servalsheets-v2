/**
 * Webhook Handler Tests (Phase 2.4)
 *
 * Comprehensive tests for sheets_webhook handler (7 actions)
 * Tests webhook registration, management, and statistics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookHandler, createWebhookHandler } from '../../src/handlers/webhooks.js';
import type { WebhookEventType } from '../../src/schemas/webhook.js';
import { isWebhookRedisConfigured } from '../../src/services/webhook-manager.js';

// Mock webhook manager
const mockWebhookManager = {
  register: vi.fn(),
  unregister: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  recordDelivery: vi.fn(),
  getEventStats: vi.fn(),
  storeWatchChannel: vi.fn(),
};

// Mock webhook queue
const mockWebhookQueue = {
  enqueue: vi.fn(),
  getStats: vi.fn(),
};

// Mock getWebhookManager and getWebhookQueue
vi.mock('../../src/services/webhook-manager.js', () => ({
  getWebhookManager: vi.fn(() => mockWebhookManager),
  isWebhookRedisConfigured: vi.fn(() => true),
  initWebhookManager: vi.fn(),
  resetWebhookManager: vi.fn(),
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
  WEBHOOK_DURABILITY_MODE: 'redis_required',
}));

vi.mock('../../src/services/webhook-queue.js', () => ({
  getWebhookQueue: vi.fn(() => mockWebhookQueue),
  initWebhookQueue: vi.fn(),
  resetWebhookQueue: vi.fn(),
}));

describe('WebhookHandler', () => {
  let handler: WebhookHandler;
  const mockedIsWebhookRedisConfigured = vi.mocked(isWebhookRedisConfigured);

  beforeEach(() => {
    handler = createWebhookHandler();
    mockedIsWebhookRedisConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register action', () => {
    it('should register new webhook', async () => {
      const mockWebhook = {
        webhookId: 'webhook-123',
        webhookUrl: 'https://example.com/webhook',
        eventTypes: ['spreadsheet.updated' as WebhookEventType],
        active: true,
        secret: 'test-secret',
        createdAt: new Date('2024-01-15T00:00:00Z').toISOString(),
      };

      mockWebhookManager.register.mockResolvedValue(mockWebhook);

      const result = await handler.handle({
        request: {
          action: 'register',
          webhookUrl: 'https://example.com/webhook',
          eventTypes: ['spreadsheet.updated'],
          spreadsheetId: 'sheet-123',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'data' in result.response) {
        expect(result.response.data).toEqual(mockWebhook);
      }
      expect(mockWebhookManager.register).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookUrl: 'https://example.com/webhook',
          eventTypes: ['spreadsheet.updated'],
          spreadsheetId: 'sheet-123',
        })
      );
    });

    it('should register webhook with optional secret', async () => {
      const mockWebhook = {
        webhookId: 'webhook-456',
        webhookUrl: 'https://example.com/hook',
        eventTypes: ['all' as WebhookEventType],
        active: true,
        secret: 'custom-secret',
        createdAt: new Date('2024-01-15T00:00:00Z').toISOString(),
      };

      mockWebhookManager.register.mockResolvedValue(mockWebhook);

      const result = await handler.handle({
        request: {
          action: 'register',
          webhookUrl: 'https://example.com/hook',
          eventTypes: ['all'],
          secret: 'custom-secret',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockWebhookManager.register).toHaveBeenCalledWith(
        expect.objectContaining({
          secret: 'custom-secret',
        })
      );
    });

    it('should handle registration errors', async () => {
      mockWebhookManager.register.mockRejectedValue(new Error('Invalid webhook URL'));

      const result = await handler.handle({
        request: {
          action: 'register',
          webhookUrl: 'invalid-url',
          eventTypes: ['all'],
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('Invalid webhook URL');
    });

    it('should handle manager initialization errors', async () => {
      mockWebhookManager.register.mockRejectedValue(new Error('Webhook manager not initialized'));

      const result = await handler.handle({
        request: {
          action: 'register',
          webhookUrl: 'https://example.com/webhook',
          eventTypes: ['all'],
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.message).toContain('not initialized');
    });

    it('returns CONFIG_ERROR before register when Redis-backed webhook storage is unavailable', async () => {
      mockedIsWebhookRedisConfigured.mockReturnValue(false);

      const result = await handler.handle({
        request: {
          action: 'register',
          webhookUrl: 'https://example.com/webhook',
          eventTypes: ['all'],
          spreadsheetId: 'sheet-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('CONFIG_ERROR');
      expect(result.response.error?.message).toContain('Redis required');
      expect(mockWebhookManager.list).not.toHaveBeenCalled();
      expect(mockWebhookManager.register).not.toHaveBeenCalled();
    });
  });

  describe('watch_changes action', () => {
    it('creates a Drive watch channel with echoed token and persists it', async () => {
      const mockDriveApi = {
        files: {
          watch: vi.fn().mockResolvedValue({
            data: {
              resourceId: 'resource_123',
            },
          }),
        },
      };
      handler = createWebhookHandler({ driveApi: mockDriveApi as never });

      const result = await handler.handle({
        request: {
          action: 'watch_changes',
          spreadsheetId: 'sheet-123',
          webhookUrl: 'https://example.com/watch',
        },
      });

      expect(result.response.success).toBe(true);

      const watchCall = mockDriveApi.files.watch.mock.calls[0]?.[0];
      expect(watchCall.fileId).toBe('sheet-123');
      expect(watchCall.requestBody).toEqual(
        expect.objectContaining({
          type: 'web_hook',
          address: 'https://example.com/watch',
          expiration: expect.any(String),
          id: expect.any(String),
          token: expect.any(String),
        })
      );
      expect(watchCall.requestBody.token).toBe(watchCall.requestBody.id);

      expect(mockWebhookManager.storeWatchChannel).toHaveBeenCalledWith(
        watchCall.requestBody.id,
        'resource_123',
        'sheet-123',
        'https://example.com/watch',
        expect.any(Number)
      );
    });

    it('returns config error when Drive API is unavailable', async () => {
      const result = await handler.handle({
        request: {
          action: 'watch_changes',
          spreadsheetId: 'sheet-123',
          webhookUrl: 'https://example.com/watch',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('CONFIG_ERROR');
    });
  });

  describe('unregister action', () => {
    it('should unregister webhook', async () => {
      mockWebhookManager.unregister.mockResolvedValue({
        webhookId: 'webhook-123',
        deleted: true,
      });

      const result = await handler.handle({
        request: {
          action: 'unregister',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'data' in result.response) {
        expect(result.response.data.deleted).toBe(true);
      }
      expect(mockWebhookManager.unregister).toHaveBeenCalledWith('webhook-123');
    });

    it('should handle webhook not found', async () => {
      mockWebhookManager.unregister.mockRejectedValue(new Error('Webhook not found'));

      const result = await handler.handle({
        request: {
          action: 'unregister',
          webhookId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.message).toContain('Webhook not found');
    });

    it('should handle unregister errors', async () => {
      mockWebhookManager.unregister.mockRejectedValue(new Error('Database error'));

      const result = await handler.handle({
        request: {
          action: 'unregister',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('list action', () => {
    it('should list all webhooks', async () => {
      const mockWebhooks = [
        {
          webhookId: 'webhook-1',
          webhookUrl: 'https://example.com/webhook1',
          eventTypes: ['spreadsheet.updated' as WebhookEventType],
          active: true,
          deliveryCount: 10,
          failureCount: 1,
        },
        {
          webhookId: 'webhook-2',
          webhookUrl: 'https://example.com/webhook2',
          eventTypes: ['all' as WebhookEventType],
          active: false,
          deliveryCount: 5,
          failureCount: 0,
        },
      ];

      mockWebhookManager.list.mockResolvedValue(mockWebhooks);

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'webhooks' in result.response.data
      ) {
        expect(result.response.data.webhooks).toHaveLength(2);
        expect(result.response.data.webhooks[0]?.webhookId).toBe('webhook-1');
      }
      expect(mockWebhookManager.list).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should filter by spreadsheet ID', async () => {
      mockWebhookManager.list.mockResolvedValue([]);

      const result = await handler.handle({
        request: {
          action: 'list',
          spreadsheetId: 'sheet-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockWebhookManager.list).toHaveBeenCalledWith('sheet-123', undefined);
    });

    it('should filter by active status', async () => {
      mockWebhookManager.list.mockResolvedValue([]);

      const result = await handler.handle({
        request: {
          action: 'list',
          active: true,
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockWebhookManager.list).toHaveBeenCalledWith(undefined, true);
    });

    it('should handle empty webhook list', async () => {
      mockWebhookManager.list.mockResolvedValue([]);

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'webhooks' in result.response.data
      ) {
        expect(result.response.data.webhooks).toEqual([]);
      }
    });

    it('should handle list errors', async () => {
      mockWebhookManager.list.mockRejectedValue(new Error('Database connection failed'));

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('get action', () => {
    it('should get webhook details', async () => {
      const mockWebhook = {
        webhookId: 'webhook-123',
        webhookUrl: 'https://example.com/webhook',
        eventTypes: ['spreadsheet.updated' as WebhookEventType],
        active: true,
        secret: 'test-secret',
        spreadsheetId: 'sheet-123',
        deliveryCount: 15,
        failureCount: 2,
        lastDelivery: new Date('2024-01-15T00:00:00Z').toISOString(),
        createdAt: new Date('2024-01-15T00:00:00Z').toISOString(),
      };

      mockWebhookManager.get.mockResolvedValue(mockWebhook);

      const result = await handler.handle({
        request: {
          action: 'get',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'webhook' in result.response.data
      ) {
        expect(result.response.data.webhook.webhookId).toBe('webhook-123');
        expect(result.response.data.webhook.deliveryCount).toBe(15);
        expect(result.response.data.webhook.failureCount).toBe(2);
      }
      expect(mockWebhookManager.get).toHaveBeenCalledWith('webhook-123');
    });

    it('should handle webhook not found', async () => {
      mockWebhookManager.get.mockResolvedValue(null);

      const result = await handler.handle({
        request: {
          action: 'get',
          webhookId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('NOT_FOUND');
      expect(result.response.error?.message).toContain('nonexistent');
    });

    it('should handle get errors', async () => {
      mockWebhookManager.get.mockRejectedValue(new Error('Database error'));

      const result = await handler.handle({
        request: {
          action: 'get',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('test action', () => {
    it('should send test webhook delivery', async () => {
      const mockWebhook = {
        webhookId: 'webhook-123',
        webhookUrl: 'https://example.com/webhook',
        eventTypes: ['all' as WebhookEventType],
        active: true,
      };

      mockWebhookManager.get.mockResolvedValue(mockWebhook);
      mockWebhookQueue.enqueue.mockResolvedValue('delivery-123');

      const result = await handler.handle({
        request: {
          action: 'test',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'delivery' in result.response.data
      ) {
        expect(result.response.data.delivery.deliveryId).toBe('delivery-123');
        expect(result.response.data.delivery.webhookId).toBe('webhook-123');
        expect(result.response.data.delivery.status).toBe('pending');
      }
      expect(mockWebhookQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: 'webhook-123',
          webhookUrl: 'https://example.com/webhook',
          eventType: 'all',
          maxAttempts: 1, // Test deliveries don't retry
        })
      );
    });

    it('should include test payload', async () => {
      mockWebhookManager.get.mockResolvedValue({
        webhookId: 'webhook-123',
        webhookUrl: 'https://example.com/webhook',
        eventTypes: ['all'],
        active: true,
      });
      mockWebhookQueue.enqueue.mockResolvedValue('delivery-456');

      const result = await handler.handle({
        request: {
          action: 'test',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockWebhookQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            test: true,
            message: 'Test webhook delivery',
          }),
        })
      );
    });

    it('should handle webhook not found for test', async () => {
      mockWebhookManager.get.mockResolvedValue(null);

      const result = await handler.handle({
        request: {
          action: 'test',
          webhookId: 'nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('NOT_FOUND');
      expect(result.response.error?.message).toContain('nonexistent');
    });

    it('should handle queue enqueue errors', async () => {
      mockWebhookManager.get.mockResolvedValue({
        webhookId: 'webhook-123',
        webhookUrl: 'https://example.com/webhook',
        eventTypes: ['all'],
        active: true,
      });
      mockWebhookQueue.enqueue.mockRejectedValue(new Error('Queue full'));

      const result = await handler.handle({
        request: {
          action: 'test',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.message).toContain('Queue full');
    });
  });

  describe('get_stats action', () => {
    it('should get overall webhook statistics', async () => {
      const mockWebhooks = [
        {
          webhookId: 'webhook-1',
          active: true,
          deliveryCount: 100,
          failureCount: 5,
        },
        {
          webhookId: 'webhook-2',
          active: false,
          deliveryCount: 50,
          failureCount: 10,
        },
      ];

      mockWebhookManager.list.mockResolvedValue(mockWebhooks);
      mockWebhookQueue.getStats.mockResolvedValue({
        pendingCount: 3,
        failedCount: 2,
        completedCount: 145,
      });

      const result = await handler.handle({
        request: {
          action: 'get_stats',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'data' in result.response) {
        const stats = result.response.data;
        expect(stats.totalWebhooks).toBe(2);
        expect(stats.activeWebhooks).toBe(1);
        expect(stats.totalDeliveries).toBe(150); // 100 + 50
        expect(stats.failedDeliveries).toBe(15); // 5 + 10
        expect(stats.successfulDeliveries).toBe(135); // 150 - 15
        expect(stats.pendingDeliveries).toBe(3);
      }
    });

    it('should get stats for specific webhook', async () => {
      const mockWebhook = {
        webhookId: 'webhook-123',
        active: true,
        deliveryCount: 25,
        failureCount: 3,
      };

      mockWebhookManager.get.mockResolvedValue(mockWebhook);
      mockWebhookManager.getEventStats.mockResolvedValue(null); // No event stats yet
      mockWebhookQueue.getStats.mockResolvedValue({
        pendingCount: 1,
        failedCount: 0,
        completedCount: 24,
      });

      const result = await handler.handle({
        request: {
          action: 'get_stats',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'data' in result.response) {
        const stats = result.response.data;
        expect(stats.totalWebhooks).toBe(1);
        expect(stats.totalDeliveries).toBe(25);
        expect(stats.failedDeliveries).toBe(3);
      }
    });

    it('should include per-webhook stats when no specific webhook requested', async () => {
      const mockWebhooks = [
        {
          webhookId: 'webhook-1',
          active: true,
          deliveryCount: 100,
          failureCount: 5,
        },
        {
          webhookId: 'webhook-2',
          active: true,
          deliveryCount: 50,
          failureCount: 0,
        },
      ];

      mockWebhookManager.list.mockResolvedValue(mockWebhooks);
      mockWebhookQueue.getStats.mockResolvedValue({ pendingCount: 0 });

      const result = await handler.handle({
        request: {
          action: 'get_stats',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'webhookStats' in result.response.data
      ) {
        expect(result.response.data.webhookStats).toBeDefined();
        expect(result.response.data.webhookStats).toHaveLength(2);
      }
    });

    it('should calculate success rates correctly', async () => {
      const mockWebhooks = [
        {
          webhookId: 'webhook-1',
          active: true,
          deliveryCount: 100,
          failureCount: 10, // 90% success rate
        },
      ];

      mockWebhookManager.list.mockResolvedValue(mockWebhooks);
      mockWebhookQueue.getStats.mockResolvedValue({ pendingCount: 0 });

      const result = await handler.handle({
        request: {
          action: 'get_stats',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'webhookStats' in result.response.data &&
        result.response.data.webhookStats
      ) {
        const webhook1Stats = result.response.data.webhookStats[0];
        expect(webhook1Stats?.successRate).toBeCloseTo(0.9, 2);
      }
    });

    it('should handle zero deliveries gracefully', async () => {
      mockWebhookManager.list.mockResolvedValue([
        {
          webhookId: 'webhook-1',
          active: true,
          deliveryCount: 0,
          failureCount: 0,
        },
      ]);
      mockWebhookQueue.getStats.mockResolvedValue({ pendingCount: 0 });

      const result = await handler.handle({
        request: {
          action: 'get_stats',
        },
      });

      expect(result.response.success).toBe(true);
      if (
        result.response.success &&
        'data' in result.response &&
        'webhookStats' in result.response.data &&
        result.response.data.webhookStats
      ) {
        const webhook1Stats = result.response.data.webhookStats[0];
        expect(webhook1Stats?.successRate).toBe(0);
      }
    });

    it('should handle get_stats errors', async () => {
      mockWebhookManager.list.mockRejectedValue(new Error('Database connection lost'));

      const result = await handler.handle({
        request: {
          action: 'get_stats',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle unknown action', async () => {
      const result = await handler.handle({
        request: {
          // @ts-expect-error - Testing invalid action
          action: 'invalid_action',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error).toBeDefined();
      expect(result.response.error?.code).toBe('INVALID_PARAMS');
      expect(result.response.error?.message).toContain('Unknown action');
    });

    it('should catch and handle unexpected errors', async () => {
      mockWebhookManager.list.mockImplementation(() => {
        throw new Error('Unexpected internal error');
      });

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INTERNAL_ERROR');
    });

    it('should handle non-Error exceptions', async () => {
      mockWebhookManager.get.mockImplementation(() => {
        throw 'String error';
      });

      const result = await handler.handle({
        request: {
          action: 'get',
          webhookId: 'webhook-123',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('INTERNAL_ERROR');
    });

    it('maps Redis dependency failures to CONFIG_ERROR with guidance', async () => {
      mockWebhookManager.list.mockRejectedValue(
        new Error('Redis required for webhook functionality')
      );

      const result = await handler.handle({
        request: {
          action: 'list',
        },
      });

      expect(result.response.success).toBe(false);
      expect(result.response.error?.code).toBe('CONFIG_ERROR');
      expect(result.response.error?.message).toContain('Redis backend is required');
      expect(result.response.error?.resolutionSteps?.join(' ')).toContain('REDIS_URL');
      expect((result.response.error?.details as { durabilityMode?: string } | undefined)?.durabilityMode).toBe(
        'redis_required'
      );
    });
  });

  describe('handler factory', () => {
    it('should create handler instance', () => {
      const handler = createWebhookHandler();
      expect(handler).toBeInstanceOf(WebhookHandler);
    });

    it('should create independent handler instances', () => {
      const handler1 = createWebhookHandler();
      const handler2 = createWebhookHandler();
      expect(handler1).not.toBe(handler2);
    });
  });
});
