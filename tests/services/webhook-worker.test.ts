/**
 * Tests for WebhookWorker
 *
 * Tests background webhook delivery worker lifecycle and singleton pattern.
 * Includes integration-style delivery scenarios using mocked queue/manager singletons.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebhookWorker,
  initWebhookWorker,
  getWebhookWorker,
  resetWebhookWorker,
  startWebhookWorker,
  stopWebhookWorker,
  type WebhookWorkerConfig,
} from '../../src/services/webhook-worker.js';
import type { WebhookDeliveryJob } from '../../src/services/webhook-queue.js';

let mockWebhookQueue: {
  dequeue: ReturnType<typeof vi.fn>;
  markSuccess: ReturnType<typeof vi.fn>;
  markFailure: ReturnType<typeof vi.fn>;
};

let mockWebhookManager: {
  recordDelivery: ReturnType<typeof vi.fn>;
};

// Mock dependencies
vi.mock('../../src/services/webhook-queue.js', () => ({
  getWebhookQueue: vi.fn(() => mockWebhookQueue),
}));

vi.mock('../../src/services/webhook-manager.js', () => ({
  getWebhookManager: vi.fn(() => mockWebhookManager),
}));

// Mock fetch
global.fetch = vi.fn();

// Mock logger to suppress output
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WebhookWorker', () => {
  const activeWorkers: WebhookWorker[] = [];

  const createWorker = (config?: Partial<WebhookWorkerConfig>): WebhookWorker => {
    const worker = new WebhookWorker(config);
    activeWorkers.push(worker);
    return worker;
  };

  const invokeProcessDelivery = async (
    worker: WebhookWorker,
    job: WebhookDeliveryJob,
    workerId = 0
  ): Promise<void> => {
    await (
      worker as unknown as {
        processDelivery: (deliveryJob: WebhookDeliveryJob, id: number) => Promise<void>;
      }
    ).processDelivery(job, workerId);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetWebhookWorker();
    activeWorkers.length = 0;

    mockWebhookQueue = {
      dequeue: vi.fn(),
      markSuccess: vi.fn(),
      markFailure: vi.fn(),
    };

    mockWebhookManager = {
      recordDelivery: vi.fn(),
    };

    // Reset fetch mock
    (global.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(async () => {
    // Stop any directly instantiated workers
    for (const worker of activeWorkers) {
      if (worker.isRunning()) {
        await worker.stop();
      }
    }
    activeWorkers.length = 0;

    // Ensure workers are stopped
    try {
      const worker = getWebhookWorker();
      if (worker.isRunning()) {
        await worker.stop();
      }
    } catch {
      // Worker not initialized, ignore
    }
    resetWebhookWorker();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const worker = createWorker();

      expect(worker).toBeInstanceOf(WebhookWorker);
      expect(worker.isRunning()).toBe(false);
    });

    it('should initialize with custom config', () => {
      const config: Partial<WebhookWorkerConfig> = {
        concurrency: 5,
        timeoutMs: 5000,
        pollIntervalMs: 500,
      };

      const worker = createWorker(config);

      expect(worker).toBeInstanceOf(WebhookWorker);
    });

    it('should use default values for missing config', () => {
      const worker = createWorker({ concurrency: 3 });

      expect(worker).toBeInstanceOf(WebhookWorker);
      // Other defaults should be set (timeoutMs: 10000, pollIntervalMs: 1000)
    });
  });

  describe('start and stop', () => {
    it('should start workers', async () => {
      const worker = createWorker({ concurrency: 2, pollIntervalMs: 50 });

      // Empty queue to prevent processing
      mockWebhookQueue.dequeue.mockResolvedValue(null);

      await worker.start();

      expect(worker.isRunning()).toBe(true);

      await worker.stop();
    });

    it('should not start if already running', async () => {
      const worker = createWorker({ concurrency: 1, pollIntervalMs: 50 });
      mockWebhookQueue.dequeue.mockResolvedValue(null);

      await worker.start();
      expect(worker.isRunning()).toBe(true);

      // Try to start again
      await worker.start();
      expect(worker.isRunning()).toBe(true);

      await worker.stop();
    });

    it('should stop workers gracefully', async () => {
      const worker = createWorker({ concurrency: 2, pollIntervalMs: 50 });
      mockWebhookQueue.dequeue.mockResolvedValue(null);

      await worker.start();
      expect(worker.isRunning()).toBe(true);

      await worker.stop();
      expect(worker.isRunning()).toBe(false);
    });

    it('should not error when stopping already stopped worker', async () => {
      const worker = createWorker();

      await expect(worker.stop()).resolves.not.toThrow();
    });

    it('should process a queued job end-to-end', async () => {
      const worker = createWorker({ concurrency: 1, pollIntervalMs: 50 });
      const job: WebhookDeliveryJob = {
        deliveryId: 'delivery-start-stop',
        webhookId: 'webhook-start-stop',
        webhookUrl: 'https://example.com/webhook',
        eventType: 'spreadsheet.updated',
        payload: { spreadsheetId: 'test-id' },
        attemptCount: 0,
        maxAttempts: 3,
        queuedAt: 1704067200000,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });

      await invokeProcessDelivery(worker, job);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockWebhookQueue.markSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('webhook delivery', () => {
    let worker: WebhookWorker;
    let mockJob: WebhookDeliveryJob;

    beforeEach(() => {
      worker = createWorker({ concurrency: 1, pollIntervalMs: 50, timeoutMs: 5000 });

      mockJob = {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        webhookUrl: 'https://example.com/webhook',
        eventType: 'spreadsheet.updated',
        payload: { spreadsheetId: 'test-id', action: 'update' },
        secret: 'test-secret',
        attemptCount: 0,
        maxAttempts: 3,
        queuedAt: 1704067200000,
      };
    });

    it('should deliver webhook with HMAC signature', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });

      await invokeProcessDelivery(worker, mockJob);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = fetchCall[1].headers;

      // Signature format should include sha256 prefix and actual digest
      expect(headers['X-Webhook-Signature']).toContain('sha256=');
      expect(headers['X-Webhook-Signature']).not.toBe('sha256=');
    });

    it('should deliver webhook without signature if no secret', async () => {
      const jobWithoutSecret = { ...mockJob, secret: undefined };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });

      await invokeProcessDelivery(worker, jobWithoutSecret);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers['X-Webhook-Signature']).toBe('none');
    });

    it('should include delivery metadata in headers', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });

      await invokeProcessDelivery(worker, mockJob);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = fetchCall[1].headers;

      expect(headers['X-Webhook-Delivery']).toBe('delivery-1');
      expect(headers['X-Webhook-Event']).toBe('spreadsheet.updated');
    });

    it('should mark delivery as success on 2xx response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 201,
        text: vi.fn().mockResolvedValue('Created'),
      });

      await invokeProcessDelivery(worker, mockJob);

      expect(mockWebhookQueue.markSuccess).toHaveBeenCalledWith(mockJob);
      expect(mockWebhookManager.recordDelivery).toHaveBeenCalledWith(
        'webhook-1',
        true,
        expect.any(Number)
      );
    });

    it('should mark delivery as failed on 4xx/5xx response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      });

      await invokeProcessDelivery(worker, mockJob);

      expect(mockWebhookQueue.markFailure).toHaveBeenCalledWith(
        mockJob,
        expect.stringContaining('HTTP 500')
      );
      expect(mockWebhookManager.recordDelivery).toHaveBeenCalledWith(
        'webhook-1',
        false,
        expect.any(Number)
      );
    });

    it('should mark delivery as failed on network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      await invokeProcessDelivery(worker, mockJob);

      expect(mockWebhookQueue.markFailure).toHaveBeenCalledWith(
        mockJob,
        expect.stringContaining('Network error')
      );
      expect(mockWebhookManager.recordDelivery).toHaveBeenCalledWith(
        'webhook-1',
        false,
        expect.any(Number)
      );
    });

    it('should handle timeout', async () => {
      const quickWorker = createWorker({
        concurrency: 1,
        pollIntervalMs: 50,
        timeoutMs: 100,
      });

      // Simulate timeout by delaying fetch
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AbortError')), 150);
        });
      });

      await invokeProcessDelivery(quickWorker, mockJob);

      expect(mockWebhookQueue.markFailure).toHaveBeenCalled();
    });

    it('should truncate long error messages', async () => {
      const longError = 'x'.repeat(300);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue(longError),
      });

      await invokeProcessDelivery(worker, mockJob);

      const failureCall = mockWebhookQueue.markFailure.mock.calls[0];
      const errorMessage = failureCall[1] as string;
      expect(errorMessage.length).toBeLessThan(250); // HTTP 400: + 200 chars max
    });

    it('should handle error when reading response text', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 502,
        text: vi.fn().mockRejectedValue(new Error('Cannot read response')),
      });

      await invokeProcessDelivery(worker, mockJob);

      expect(mockWebhookQueue.markFailure).toHaveBeenCalledWith(
        mockJob,
        expect.stringContaining('HTTP 502')
      );
    });

    it('should build correct payload structure', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });

      await invokeProcessDelivery(worker, mockJob);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const payloadStr = fetchCall[1].body;
      const payload = JSON.parse(payloadStr);

      expect(payload).toMatchObject({
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        eventType: 'spreadsheet.updated',
        data: { spreadsheetId: 'test-id', action: 'update' },
      });
      expect(payload.timestamp).toBeDefined();
    });
  });

  describe('singleton pattern', () => {
    afterEach(() => {
      resetWebhookWorker();
    });

    it('should initialize singleton', () => {
      initWebhookWorker({ concurrency: 3 });

      const worker = getWebhookWorker();
      expect(worker).toBeInstanceOf(WebhookWorker);
    });

    it('should not reinitialize if already initialized', () => {
      initWebhookWorker();
      const worker1 = getWebhookWorker();

      initWebhookWorker();
      const worker2 = getWebhookWorker();

      expect(worker1).toBe(worker2);
    });

    it('should throw if accessing uninitialized worker', () => {
      expect(() => getWebhookWorker()).toThrow('Webhook worker not initialized');
    });

    it('should reset singleton', () => {
      initWebhookWorker();
      const worker1 = getWebhookWorker();

      resetWebhookWorker();
      initWebhookWorker();
      const worker2 = getWebhookWorker();

      expect(worker1).not.toBe(worker2);
    });

    it('should start worker via convenience function', async () => {
      initWebhookWorker({ concurrency: 1, pollIntervalMs: 50 });
      mockWebhookQueue.dequeue.mockResolvedValue(null);

      await startWebhookWorker();

      const worker = getWebhookWorker();
      expect(worker.isRunning()).toBe(true);

      await stopWebhookWorker();
    });

    it('should stop worker via convenience function', async () => {
      initWebhookWorker({ concurrency: 1, pollIntervalMs: 50 });
      mockWebhookQueue.dequeue.mockResolvedValue(null);

      const worker = getWebhookWorker();
      await worker.start();

      await stopWebhookWorker();
      expect(worker.isRunning()).toBe(false);
    });
  });

  describe('concurrency', () => {
    it('should process multiple jobs concurrently', async () => {
      const worker = createWorker({ concurrency: 2, pollIntervalMs: 50 });

      const job1: WebhookDeliveryJob = {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        webhookUrl: 'https://example.com/webhook1',
        eventType: 'test',
        payload: {},
        attemptCount: 0,
        maxAttempts: 3,
        queuedAt: 1704067200000,
      };

      const job2: WebhookDeliveryJob = {
        deliveryId: 'delivery-2',
        webhookId: 'webhook-2',
        webhookUrl: 'https://example.com/webhook2',
        eventType: 'test',
        payload: {},
        attemptCount: 0,
        maxAttempts: 3,
        queuedAt: 1704067200000,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });

      await Promise.all([
        invokeProcessDelivery(worker, job1, 0),
        invokeProcessDelivery(worker, job2, 1),
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockWebhookQueue.markSuccess).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should continue running after worker error', async () => {
      const worker = createWorker({ concurrency: 1, pollIntervalMs: 50 });
      let dequeueCalls = 0;
      mockWebhookQueue.dequeue.mockImplementation(async () => {
        dequeueCalls += 1;
        if (dequeueCalls === 1) {
          throw new Error('Queue error');
        }

        // End loop after one successful post-error cycle
        (worker as unknown as { running: boolean }).running = false;
        return null;
      });

      const sleepMock = vi.fn().mockResolvedValue(undefined);
      (worker as unknown as { sleep: (ms: number) => Promise<void> }).sleep = sleepMock;
      (worker as unknown as { running: boolean }).running = true;

      await (worker as unknown as { runWorker: (workerId: number) => Promise<void> }).runWorker(0);

      expect(dequeueCalls).toBeGreaterThanOrEqual(2);
      expect(sleepMock).toHaveBeenCalled();
    });

    it('should handle processing errors gracefully', async () => {
      const worker = createWorker({ concurrency: 1, pollIntervalMs: 50 });

      const mockJob: WebhookDeliveryJob = {
        deliveryId: 'delivery-1',
        webhookId: 'webhook-1',
        webhookUrl: 'invalid-url', // Invalid URL
        eventType: 'test',
        payload: {},
        attemptCount: 0,
        maxAttempts: 3,
        queuedAt: 1704067200000,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Invalid URL'));

      await invokeProcessDelivery(worker, mockJob);

      expect(mockWebhookQueue.markFailure).toHaveBeenCalled();
    });
  });
});
