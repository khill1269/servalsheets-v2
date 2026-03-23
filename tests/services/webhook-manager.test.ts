/**
 * Tests for WebhookManager (Phase 3)
 *
 * Validates webhook registration, lifecycle management, and Redis integration.
 */

import dns from 'node:dns';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetEnvForTest } from '../../src/config/env.js';
import {
  initWebhookManager,
  getWebhookManager,
  resetWebhookManager,
} from '../../src/services/webhook-manager.js';

describe('WebhookManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRedis: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGoogleApi: any;

  beforeEach(() => {
    // Reset singleton
    resetWebhookManager();
    resetEnvForTest();
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    // Mock Redis client
    mockRedis = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }),
      sAdd: vi.fn().mockResolvedValue(1),
      sRem: vi.fn().mockResolvedValue(1),
      sMembers: vi.fn().mockResolvedValue([]),
    };

    // Mock Google API client (Drive API v3 for watch)
    mockGoogleApi = {
      drive: {
        files: {
          watch: vi.fn().mockResolvedValue({
            data: {
              resourceId: 'resource_123',
              expiration: String(1704067200000 + 7 * 24 * 60 * 60 * 1000),
            },
          }),
        },
        channels: {
          stop: vi.fn().mockResolvedValue({}),
        },
      },
    };
  });

  afterEach(() => {
    resetEnvForTest();
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with Redis and Google API', () => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
      const manager = getWebhookManager();

      expect(manager).toBeDefined();
    });

    it('should throw if not initialized', () => {
      expect(() => getWebhookManager()).toThrow('Webhook manager not initialized');
    });

    it('should warn if already initialized', () => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
      // Should not throw, just warn
    });
  });

  describe('Register Webhook', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    it('should register webhook with Google Sheets API', async () => {
      const manager = getWebhookManager();
      const result = await manager.register({
        action: 'register',
        spreadsheetId: '1ABC',
        webhookUrl: 'https://user.com/callback',
        eventTypes: ['sheet.update'],
        expirationMs: 7 * 24 * 60 * 60 * 1000,
      });

      expect(result).toMatchObject({
        spreadsheetId: '1ABC',
        webhookUrl: 'https://user.com/callback',
        eventTypes: ['sheet.update'],
        active: true,
      });

      expect(result.webhookId).toMatch(/^webhook_/);
      expect(result.resourceId).toMatch(/^resource_/); // Generated UUID
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockRedis.sAdd).toHaveBeenCalled();
    });

    it('should throw if Redis not available', async () => {
      resetWebhookManager();
      initWebhookManager(null, mockGoogleApi, 'https://example.com/webhook');
      const manager = getWebhookManager();

      await expect(
        manager.register({
          action: 'register',
          spreadsheetId: '1ABC',
          webhookUrl: 'https://user.com/callback',
          eventTypes: ['sheet.update'],
          expirationMs: 7 * 24 * 60 * 60 * 1000,
        })
      ).rejects.toThrow('Redis required');
    });

    it('should generate webhook ID and channel ID', async () => {
      const manager = getWebhookManager();
      const result = await manager.register({
        action: 'register',
        spreadsheetId: '1ABC',
        webhookUrl: 'https://user.com/callback',
        eventTypes: ['all'],
        expirationMs: 7 * 24 * 60 * 60 * 1000,
      });

      expect(result.webhookId).toMatch(/^webhook_[a-f0-9-]+$/);
      expect(result.channelId).toMatch(/^channel_[a-f0-9-]+$/);
    });

    it('should store webhook in Redis with TTL', async () => {
      const manager = getWebhookManager();
      await manager.register({
        action: 'register',
        spreadsheetId: '1ABC',
        webhookUrl: 'https://user.com/callback',
        eventTypes: ['sheet.update'],
        expirationMs: 7 * 24 * 60 * 60 * 1000,
      });

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^webhook:/),
        expect.any(String),
        expect.objectContaining({ EXAT: expect.any(Number) })
      );
    });
  });

  describe('Unregister Webhook', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    it('should unregister webhook and remove from Redis', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          webhookId: 'webhook_123',
          spreadsheetId: '1ABC',
          channelId: 'channel_123',
          resourceId: 'resource_123',
        })
      );

      const manager = getWebhookManager();
      const result = await manager.unregister('webhook_123');

      expect(result.success).toBe(true);
      expect(mockGoogleApi.drive.channels.stop).toHaveBeenCalledWith({
        requestBody: {
          id: 'channel_123',
          resourceId: 'resource_123',
        },
      });
      expect(mockRedis.del).toHaveBeenCalledWith('webhook:webhook_123');
      expect(mockRedis.sRem).toHaveBeenCalledWith('webhooks:spreadsheet:1ABC', 'webhook_123');
    });

    it('should return error if webhook not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const manager = getWebhookManager();
      const result = await manager.unregister('webhook_999');

      expect(result.success).toBe(false);
    });
  });

  describe('List Webhooks', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    it('should list all webhooks', async () => {
      mockRedis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['webhook:webhook_1', 'webhook:webhook_2'],
      });
      mockRedis.get
        .mockResolvedValueOnce(
          JSON.stringify({
            webhookId: 'webhook_1',
            spreadsheetId: '1ABC',
            webhookUrl: 'https://user.com/callback1',
            eventTypes: ['sheet.update'],
            resourceId: 'resource_1',
            channelId: 'channel_1',
            createdAt: 1704067200000,
            expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
            active: true,
            deliveryCount: 5,
            failureCount: 0,
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            webhookId: 'webhook_2',
            spreadsheetId: '2DEF',
            webhookUrl: 'https://user.com/callback2',
            eventTypes: ['all'],
            resourceId: 'resource_2',
            channelId: 'channel_2',
            createdAt: 1704067200000,
            expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
            active: true,
            deliveryCount: 10,
            failureCount: 2,
          })
        );

      const manager = getWebhookManager();
      const webhooks = await manager.list();

      expect(webhooks).toHaveLength(2);
      expect(webhooks[0]?.webhookId).toBe('webhook_1');
      expect(webhooks[1]?.webhookId).toBe('webhook_2');
    });

    it('should filter by spreadsheetId', async () => {
      mockRedis.sMembers.mockResolvedValueOnce(['webhook_1']);
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          webhookId: 'webhook_1',
          spreadsheetId: '1ABC',
          webhookUrl: 'https://user.com/callback',
          eventTypes: ['sheet.update'],
          resourceId: 'resource_1',
          channelId: 'channel_1',
          createdAt: 1704067200000,
          expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
          active: true,
          deliveryCount: 0,
          failureCount: 0,
        })
      );

      const manager = getWebhookManager();
      const webhooks = await manager.list('1ABC');

      expect(webhooks).toHaveLength(1);
      expect(webhooks[0]?.spreadsheetId).toBe('1ABC');
    });

    it('should filter by active status', async () => {
      mockRedis.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: ['webhook:webhook_1', 'webhook:webhook_2'],
      });
      mockRedis.get
        .mockResolvedValueOnce(
          JSON.stringify({
            webhookId: 'webhook_1',
            spreadsheetId: '1ABC',
            active: true,
            webhookUrl: 'https://user.com/callback',
            eventTypes: ['all'],
            resourceId: 'r1',
            channelId: 'c1',
            createdAt: 1704067200000,
            expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
            deliveryCount: 0,
            failureCount: 0,
          })
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            webhookId: 'webhook_2',
            spreadsheetId: '2DEF',
            active: false,
            webhookUrl: 'https://user.com/callback',
            eventTypes: ['all'],
            resourceId: 'r2',
            channelId: 'c2',
            createdAt: 1704067200000,
            expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
            deliveryCount: 0,
            failureCount: 0,
          })
        );

      const manager = getWebhookManager();
      const webhooks = await manager.list(undefined, true);

      expect(webhooks).toHaveLength(1);
      expect(webhooks[0]?.active).toBe(true);
    });
  });

  describe('Get Webhook', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    it('should get webhook by ID', async () => {
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({
          webhookId: 'webhook_123',
          spreadsheetId: '1ABC',
          webhookUrl: 'https://user.com/callback',
          eventTypes: ['sheet.update'],
          resourceId: 'resource_123',
          channelId: 'channel_123',
          createdAt: 1704067200000,
          expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
          active: true,
          deliveryCount: 5,
          failureCount: 1,
        })
      );

      const manager = getWebhookManager();
      const webhook = await manager.get('webhook_123');

      expect(webhook).toBeDefined();
      expect(webhook?.webhookId).toBe('webhook_123');
      expect(webhook?.deliveryCount).toBe(5);
      expect(webhook?.failureCount).toBe(1);
    });

    it('should return null if webhook not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const manager = getWebhookManager();
      const webhook = await manager.get('webhook_999');

      expect(webhook).toBeNull();
    });
  });

  describe('Record Delivery', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    it('should increment delivery count on success', async () => {
      const webhookData = {
        webhookId: 'webhook_123',
        spreadsheetId: '1ABC',
        webhookUrl: 'https://user.com/callback',
        eventTypes: ['sheet.update' as const],
        resourceId: 'resource_123',
        channelId: 'channel_123',
        createdAt: 1704067200000,
        expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
        active: true,
        deliveryCount: 5,
        failureCount: 1,
      };

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(webhookData)) // For get()
        .mockResolvedValueOnce(JSON.stringify(webhookData)); // For recordDelivery()

      const manager = getWebhookManager();
      await manager.recordDelivery('webhook_123', true);

      expect(mockRedis.set).toHaveBeenCalled();
      const savedData = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(savedData.deliveryCount).toBe(6);
      expect(savedData.lastDelivery).toBeDefined();
    });

    it('should increment failure count on error', async () => {
      const webhookData = {
        webhookId: 'webhook_123',
        spreadsheetId: '1ABC',
        webhookUrl: 'https://user.com/callback',
        eventTypes: ['sheet.update' as const],
        resourceId: 'resource_123',
        channelId: 'channel_123',
        createdAt: 1704067200000,
        expiresAt: 1704067200000 + 7 * 24 * 60 * 60 * 1000,
        active: true,
        deliveryCount: 5,
        failureCount: 1,
      };

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(webhookData)) // For get()
        .mockResolvedValueOnce(JSON.stringify(webhookData)); // For recordDelivery()

      const manager = getWebhookManager();
      await manager.recordDelivery('webhook_123', false);

      expect(mockRedis.set).toHaveBeenCalled();
      const savedData = JSON.parse(mockRedis.set.mock.calls[0][1]);
      expect(savedData.failureCount).toBe(2);
      expect(savedData.lastFailure).toBeDefined();
    });
  });

  describe('Cleanup Expired', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    it('should clean up expired webhooks', async () => {
      const now = 1704067200000;
      const expiredWebhook = JSON.stringify({
        webhookId: 'webhook_old',
        spreadsheetId: '1ABC',
        channelId: 'channel_old',
        resourceId: 'resource_old',
        expiresAt: now - 1000, // Expired 1 second ago
      });

      mockRedis.scan.mockResolvedValueOnce({ cursor: 0, keys: ['webhook:webhook_old'] });
      mockRedis.get
        .mockResolvedValueOnce(expiredWebhook) // First call in cleanupExpired loop
        .mockResolvedValueOnce(expiredWebhook); // Second call in unregister

      const manager = getWebhookManager();
      const cleaned = await manager.cleanupExpired();

      expect(cleaned).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith('webhook:webhook_old');
    });

    it('should not clean up active webhooks', async () => {
      const now = Date.now();
      const activeWebhook = JSON.stringify({
        webhookId: 'webhook_active',
        spreadsheetId: '1ABC',
        expiresAt: now + 7 * 24 * 60 * 60 * 1000, // Expires in 7 days
      });

      mockRedis.scan.mockResolvedValueOnce({ cursor: 0, keys: ['webhook:webhook_active'] });
      mockRedis.get.mockResolvedValueOnce(activeWebhook);

      const manager = getWebhookManager();
      const cleaned = await manager.cleanupExpired();

      expect(cleaned).toBe(0);
    });
  });

  describe('SSRF Prevention', () => {
    beforeEach(() => {
      initWebhookManager(mockRedis, mockGoogleApi, 'https://example.com/webhook');
    });

    const registerWith = (webhookUrl: string) => {
      const manager = getWebhookManager();
      return manager.register({
        action: 'register',
        spreadsheetId: '1ABC',
        webhookUrl,
        eventTypes: ['sheet.update'],
        expirationMs: 7 * 24 * 60 * 60 * 1000,
      });
    };

    it('should reject HTTP (non-HTTPS) webhook URLs', async () => {
      await expect(registerWith('http://example.com/callback')).rejects.toThrow(
        'Webhook URL must use HTTPS'
      );
    });

    it('should reject localhost webhook URLs', async () => {
      await expect(registerWith('https://localhost/callback')).rejects.toThrow(
        'Webhook URL cannot target localhost'
      );
    });

    it('should reject 127.0.0.1 webhook URLs', async () => {
      await expect(registerWith('https://127.0.0.1/callback')).rejects.toThrow(
        'Webhook URL cannot target localhost'
      );
    });

    it('should reject private IPv4 range 10.x.x.x', async () => {
      await expect(registerWith('https://10.0.0.1/callback')).rejects.toThrow(
        'Webhook URL cannot target private/internal IP addresses'
      );
    });

    it('should reject private IPv4 range 192.168.x.x', async () => {
      await expect(registerWith('https://192.168.1.100/callback')).rejects.toThrow(
        'Webhook URL cannot target private/internal IP addresses'
      );
    });

    it('should reject private IPv4 range 172.16.x.x', async () => {
      await expect(registerWith('https://172.16.0.1/callback')).rejects.toThrow(
        'Webhook URL cannot target private/internal IP addresses'
      );
    });

    it('should reject link-local address 169.254.x.x', async () => {
      await expect(registerWith('https://169.254.169.254/callback')).rejects.toThrow(
        'Webhook URL cannot target private/internal IP addresses'
      );
    });

    it('should reject IPv6 loopback ::1', async () => {
      await expect(registerWith('https://[::1]/callback')).rejects.toThrow(
        'Webhook URL cannot target private/internal IPv6 addresses'
      );
    });

    it('should reject decimal IP encoding (obfuscated 127.0.0.1)', async () => {
      // 2130706433 = 127.0.0.1 in decimal; Node URL parser normalizes before our check
      // so either the decimal check or the localhost check fires
      await expect(registerWith('https://2130706433/callback')).rejects.toThrow(
        /decimal IP|localhost|private/i
      );
    });

    it('should reject hex IP encoding (obfuscated 127.0.0.1)', async () => {
      // 0x7f000001 = 127.0.0.1 in hex; Node URL parser normalizes before our check
      // so either the hex check or the localhost check fires
      await expect(registerWith('https://0x7f000001/callback')).rejects.toThrow(
        /hex IP|localhost|private/i
      );
    });

    it('should reject invalid URLs', async () => {
      await expect(registerWith('not-a-url')).rejects.toThrow('Invalid webhook URL');
    });

    it('should allow HTTPS URLs with public hostnames', async () => {
      // DNS resolution may fail in CI/test envs. Set WEBHOOK_DNS_STRICT=false to skip DNS check.
      const orig = process.env['WEBHOOK_DNS_STRICT'];
      process.env['WEBHOOK_DNS_STRICT'] = 'false';
      resetEnvForTest();
      try {
        const result = await registerWith('https://user.example.com/callback');
        expect(result.webhookUrl).toBe('https://user.example.com/callback');
      } finally {
        if (orig === undefined) {
          delete process.env['WEBHOOK_DNS_STRICT'];
        } else {
          process.env['WEBHOOK_DNS_STRICT'] = orig;
        }
        resetEnvForTest();
      }
    });
  });
});
