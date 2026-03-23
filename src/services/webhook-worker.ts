/**
 * ServalSheets - Webhook Delivery Worker
 *
 * Background worker that processes webhook delivery jobs from the queue.
 * Handles HTTP delivery with retry logic and HMAC signature verification.
 *
 * Features:
 * - Concurrent delivery processing (configurable workers)
 * - HMAC-SHA256 signature for webhook security
 * - Timeout handling (default: 10 seconds)
 * - Graceful shutdown
 *
 * @category Services
 */

import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import { getWebhookQueue, type WebhookDeliveryJob } from './webhook-queue.js';
import { getWebhookManager } from './webhook-manager.js';
import { recordWebhookDelivery } from '../observability/metrics.js';
import { signWebhookPayload } from '../security/webhook-signature.js';
import { resourceNotifications } from '../resources/notifications.js';
import { getCostTracker } from './cost-tracker.js';
import { CircuitBreaker, CircuitBreakerError } from '../utils/circuit-breaker.js';
import { getApiSpecificCircuitBreakerConfig } from '../config/env.js';

/**
 * Webhook worker configuration
 */
export interface WebhookWorkerConfig {
  /** Number of concurrent workers (default: 2) */
  concurrency: number;
  /** Request timeout in ms (default: 10000 = 10 seconds) */
  timeoutMs: number;
  /** Poll interval when queue is empty (default: 1000 = 1 second) */
  pollIntervalMs: number;
}

/**
 * Webhook Delivery Worker
 *
 * Processes webhook deliveries from the queue.
 */
export class WebhookWorker {
  private config: WebhookWorkerConfig;
  private running: boolean = false;
  private workers: Promise<void>[] = [];
  /** Per-URL circuit breakers — prevent hammering consistently-failing endpoints */
  private readonly urlBreakers = new Map<string, CircuitBreaker>();

  private getOrCreateBreaker(url: string): CircuitBreaker {
    // Key on origin (scheme+host+port) to share breaker across multiple webhooks on same host
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      origin = url; // fallback for non-standard URLs
    }
    if (!this.urlBreakers.has(origin)) {
      const workerConfig = getApiSpecificCircuitBreakerConfig('webhook_worker');
      this.urlBreakers.set(
        origin,
        new CircuitBreaker({
          name: `webhook:${origin}`,
          failureThreshold: workerConfig.failureThreshold,
          successThreshold: workerConfig.successThreshold,
          timeout: workerConfig.timeout,
        })
      );
    }
    return this.urlBreakers.get(origin)!;
  }

  constructor(config?: Partial<WebhookWorkerConfig>) {
    this.config = {
      concurrency: config?.concurrency ?? 2,
      timeoutMs: config?.timeoutMs ?? 10000,
      pollIntervalMs: config?.pollIntervalMs ?? 1000,
    };

    logger.info('Webhook worker initialized', {
      config: this.config,
    });
  }

  /**
   * Start webhook workers
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Webhook worker already running');
      return;
    }

    this.running = true;

    // Start concurrent workers
    for (let i = 0; i < this.config.concurrency; i++) {
      const workerPromise = this.runWorker(i);
      this.workers.push(workerPromise);
    }

    logger.info('Webhook workers started', {
      concurrency: this.config.concurrency,
    });
  }

  /**
   * Stop webhook workers
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping webhook workers...');
    this.running = false;

    // Wait for all workers to finish
    await Promise.all(this.workers);
    this.workers = [];

    logger.info('Webhook workers stopped');
  }

  /**
   * Worker loop
   */
  private async runWorker(workerId: number): Promise<void> {
    logger.debug('Webhook worker started', { workerId });

    while (this.running) {
      try {
        // Dequeue next job
        const queue = getWebhookQueue();
        const job = await queue.dequeue();

        if (!job) {
          // Queue empty, wait before polling again
          await this.sleep(this.config.pollIntervalMs);
          continue;
        }

        // Process delivery
        await this.processDelivery(job, workerId);
      } catch (error) {
        logger.error('Worker error', { workerId, error });
        await this.sleep(1000); // Backoff on error
      }
    }

    logger.debug('Webhook worker stopped', { workerId });
  }

  /**
   * Process a webhook delivery
   */
  private async processDelivery(job: WebhookDeliveryJob, workerId: number): Promise<void> {
    const startTime = Date.now();

    logger.debug('Processing webhook delivery', {
      workerId,
      deliveryId: job.deliveryId,
      webhookId: job.webhookId,
      attemptCount: job.attemptCount + 1,
      maxAttempts: job.maxAttempts,
    });

    try {
      // Build payload
      const payload = {
        deliveryId: job.deliveryId,
        webhookId: job.webhookId,
        eventType: job.eventType,
        timestamp: new Date().toISOString(),
        data: job.payload,
      };

      // Calculate HMAC signature (if secret provided)
      const payloadStr = JSON.stringify(payload);
      let signature: string | undefined;
      if (job.secret) {
        try {
          signature = signWebhookPayload(payloadStr, job.secret);
        } catch (error) {
          logger.warn('Failed to sign webhook payload', {
            deliveryId: job.deliveryId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue without signature if signing fails
        }
      }

      // Send HTTP POST request (with per-URL circuit breaker to prevent hammering dead endpoints)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const breaker = this.getOrCreateBreaker(job.webhookUrl);
        const response = await breaker.execute(() =>
          fetch(job.webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'ServalSheets-Webhook/1.0',
              'X-Webhook-Signature': signature || 'none',
              'X-Webhook-Delivery': job.deliveryId,
              'X-Webhook-Event': job.eventType,
            },
            body: payloadStr,
            signal: controller.signal,
            redirect: 'error', // SSRF protection: prevent redirect-based attacks
          })
        );

        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        const durationSeconds = duration / 1000;

        // Extract spreadsheetId from payload
        const spreadsheetId = (job.payload['spreadsheetId'] as string) ?? 'unknown';

        if (response.ok) {
          // Success
          const queue = getWebhookQueue();
          await queue.markSuccess(job);

          // Update webhook stats
          const manager = getWebhookManager();
          await manager.recordDelivery(job.webhookId, true, duration);

          // Notify MCP clients of webhook delivery (Feature 1: Real-Time Notifications)
          resourceNotifications.notifyResourceListChanged(
            `webhook delivered: ${job.eventType} for ${job.webhookId.slice(0, 8)}`
          );

          // Record metrics
          recordWebhookDelivery(
            job.webhookId,
            spreadsheetId,
            job.eventType,
            'success',
            durationSeconds
          );

          // COST-01: Track webhook delivery for billing/usage
          try {
            getCostTracker().trackFeatureUsage('system', 'webhooksDelivered');
          } catch {
            // Cost tracking is non-critical
          }

          logger.info('Webhook delivered successfully', {
            workerId,
            deliveryId: job.deliveryId,
            webhookId: job.webhookId,
            statusCode: response.status,
            durationMs: duration,
            attemptCount: job.attemptCount + 1,
          });
        } else {
          // HTTP error
          const errorText = await response.text().catch(() => 'Unknown error');
          const error = `HTTP ${response.status}: ${errorText.substring(0, 200)}`;

          const queue = getWebhookQueue();
          await queue.markFailure(job, error);

          // Update webhook stats
          const manager = getWebhookManager();
          await manager.recordDelivery(job.webhookId, false, duration);

          // Record metrics
          recordWebhookDelivery(
            job.webhookId,
            spreadsheetId,
            job.eventType,
            'failure',
            durationSeconds
          );

          logger.warn('Webhook delivery failed', {
            workerId,
            deliveryId: job.deliveryId,
            webhookId: job.webhookId,
            statusCode: response.status,
            error,
            attemptCount: job.attemptCount + 1,
            willRetry: job.attemptCount + 1 < job.maxAttempts,
          });
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Circuit open — endpoint consistently failing, skip and let queue retry later
        if (fetchError instanceof CircuitBreakerError) {
          const queue = getWebhookQueue();
          await queue.markFailure(job, `Circuit open: ${fetchError.message}`);
          logger.warn('Webhook delivery skipped (circuit open)', {
            workerId,
            deliveryId: job.deliveryId,
            webhookId: job.webhookId,
            webhookUrl: job.webhookUrl,
            attemptCount: job.attemptCount + 1,
          });
          return;
        }

        // Network or timeout error
        const error = fetchError instanceof Error ? fetchError.message : 'Unknown fetch error';
        const duration = Date.now() - startTime;
        const durationSeconds = duration / 1000;

        // Extract spreadsheetId from payload
        const spreadsheetId = (job.payload['spreadsheetId'] as string) ?? 'unknown';

        const queue = getWebhookQueue();
        await queue.markFailure(job, error);

        // Update webhook stats
        const manager = getWebhookManager();
        await manager.recordDelivery(job.webhookId, false, duration);

        // Record metrics
        recordWebhookDelivery(
          job.webhookId,
          spreadsheetId,
          job.eventType,
          'failure',
          durationSeconds
        );

        logger.warn('Webhook delivery failed (network error)', {
          workerId,
          deliveryId: job.deliveryId,
          webhookId: job.webhookId,
          error,
          attemptCount: job.attemptCount + 1,
          willRetry: job.attemptCount + 1 < job.maxAttempts,
        });
      }
    } catch (error) {
      logger.error('Failed to process webhook delivery', {
        workerId,
        deliveryId: job.deliveryId,
        webhookId: job.webhookId,
        error,
      });

      // Mark as failed
      const queue = getWebhookQueue();
      await queue.markFailure(job, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if worker is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Singleton webhook worker instance
 */
let webhookWorker: WebhookWorker | null = null;

/**
 * Initialize webhook worker
 */
export function initWebhookWorker(config?: Partial<WebhookWorkerConfig>): void {
  if (webhookWorker) {
    logger.warn('Webhook worker already initialized');
    return;
  }

  webhookWorker = new WebhookWorker(config);
  logger.info('Webhook worker singleton initialized');
}

/**
 * Get webhook worker instance
 */
export function getWebhookWorker(): WebhookWorker {
  if (!webhookWorker) {
    throw new ServiceError(
      'Webhook worker not initialized',
      'SERVICE_NOT_INITIALIZED',
      'WebhookWorker'
    );
  }
  return webhookWorker;
}

/**
 * Reset webhook worker (for testing)
 */
export function resetWebhookWorker(): void {
  webhookWorker = null;
  logger.debug('Webhook worker reset');
}

/**
 * Start webhook worker (convenience function)
 */
export async function startWebhookWorker(): Promise<void> {
  const worker = getWebhookWorker();
  await worker.start();
}

/**
 * Stop webhook worker (convenience function)
 */
export async function stopWebhookWorker(): Promise<void> {
  const worker = getWebhookWorker();
  await worker.stop();
}
