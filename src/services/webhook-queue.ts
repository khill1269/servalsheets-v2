/**
 * ServalSheets - Webhook Delivery Queue
 *
 * Redis-backed queue for reliable webhook delivery with retry logic.
 * Implements exponential backoff for failed deliveries.
 *
 * Architecture:
 * - Queue: FIFO queue of pending webhook deliveries (Redis list)
 * - Retry: Failed deliveries moved to retry queue with delay
 * - DLQ: Dead letter queue for permanently failed deliveries
 *
 * Queue Keys:
 * - webhook:queue:pending - Main delivery queue
 * - webhook:queue:retry:{timestamp} - Retry queues (scheduled)
 * - webhook:queue:dlq - Dead letter queue (failed after max retries)
 *
 * @category Services
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import type { WebhookEventType } from '../schemas/webhook.js';
import { updateWebhookQueueDepth } from '../observability/metrics.js';

// Use any for Redis client to avoid type conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisClient = any;

/** Non-blocking SCAN replacement for redis.keys() */
async function scanRedisKeys(redis: RedisClient, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = result.cursor;
    keys.push(...result.keys);
  } while (cursor !== 0);
  return keys;
}

/**
 * Webhook delivery job
 */
export interface WebhookDeliveryJob {
  deliveryId: string;
  webhookId: string;
  webhookUrl: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  secret?: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: number;
  scheduledAt: number;
}

/**
 * Webhook Queue Configuration
 */
export interface WebhookQueueConfig {
  /** Maximum retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial retry delay in ms (default: 1000 = 1 second) */
  initialRetryDelayMs: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Maximum retry delay in ms (default: 300000 = 5 minutes) */
  maxRetryDelayMs: number;
}

/**
 * Webhook Delivery Queue
 *
 * Manages webhook delivery jobs with retry logic.
 */
export class WebhookQueue {
  private redis: RedisClient | null;
  private config: WebhookQueueConfig;

  constructor(redis: RedisClient | null, config?: Partial<WebhookQueueConfig>) {
    this.redis = redis;
    this.config = {
      maxAttempts: config?.maxAttempts ?? 3,
      initialRetryDelayMs: config?.initialRetryDelayMs ?? 1000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
      maxRetryDelayMs: config?.maxRetryDelayMs ?? 300000,
    };

    logger.info('Webhook queue initialized', {
      redisAvailable: redis !== null,
      config: this.config,
    });
  }

  /**
   * Enqueue a webhook delivery job
   */
  async enqueue(
    job: Omit<WebhookDeliveryJob, 'deliveryId' | 'attemptCount' | 'createdAt'>
  ): Promise<string> {
    if (!this.redis) {
      throw new ServiceError(
        'Redis required for webhook queue',
        'SERVICE_NOT_INITIALIZED',
        'WebhookQueue'
      );
    }

    const deliveryId = `delivery_${randomUUID()}`;
    const fullJob: WebhookDeliveryJob = {
      ...job,
      deliveryId,
      attemptCount: 0,
      createdAt: Date.now(),
    };

    try {
      // Add to pending queue
      await this.redis.rPush('webhook:queue:pending', JSON.stringify(fullJob));

      // Update queue depth metrics
      await this.updateQueueMetrics();

      logger.debug('Webhook delivery enqueued', {
        deliveryId,
        webhookId: job.webhookId,
        eventType: job.eventType,
      });

      return deliveryId;
    } catch (error) {
      logger.error('Failed to enqueue webhook delivery', {
        deliveryId,
        webhookId: job.webhookId,
        error,
      });
      throw error;
    }
  }

  /**
   * Dequeue next pending job
   */
  async dequeue(): Promise<WebhookDeliveryJob | null> {
    if (!this.redis) {
      return null;
    }

    try {
      // Check retry queues first (process retries before new deliveries)
      const retryJob = await this.dequeueRetry();
      if (retryJob) {
        return retryJob;
      }

      // Pop from pending queue (blocking with 1 second timeout)
      const result = await this.redis.blPop('webhook:queue:pending', 1);
      if (!result) {
        return null;
      }

      const job: WebhookDeliveryJob = JSON.parse(result.element as string);

      // Update queue depth metrics
      await this.updateQueueMetrics();

      logger.debug('Webhook delivery dequeued', {
        deliveryId: job.deliveryId,
        webhookId: job.webhookId,
        attemptCount: job.attemptCount,
      });

      return job;
    } catch (error) {
      logger.error('Failed to dequeue webhook delivery', { error });
      return null;
    }
  }

  /**
   * Dequeue job from retry queue (if scheduled time has passed)
   */
  private async dequeueRetry(): Promise<WebhookDeliveryJob | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const now = Date.now();

      // Find retry queues with timestamps <= now
      const keys = await scanRedisKeys(this.redis, 'webhook:queue:retry:*');
      const retryKeys = (keys as string[])
        .filter((key) => {
          const timestamp = Number.parseInt(key.split(':')[3] || '0', 10);
          return timestamp <= now;
        })
        .sort();

      if (retryKeys.length === 0) {
        return null;
      }

      // Pop from earliest retry queue
      const result = await this.redis.lPop(retryKeys[0]);
      if (!result) {
        // Queue is empty, delete key
        await this.redis.del(retryKeys[0]);
        return null;
      }

      const job: WebhookDeliveryJob = JSON.parse(result as string);

      logger.debug('Webhook delivery dequeued from retry queue', {
        deliveryId: job.deliveryId,
        webhookId: job.webhookId,
        attemptCount: job.attemptCount,
        retryKey: retryKeys[0],
      });

      return job;
    } catch (error) {
      logger.error('Failed to dequeue from retry queue', { error });
      return null;
    }
  }

  /**
   * Mark delivery as successful
   */
  async markSuccess(job: WebhookDeliveryJob): Promise<void> {
    logger.info('Webhook delivery successful', {
      deliveryId: job.deliveryId,
      webhookId: job.webhookId,
      attemptCount: job.attemptCount + 1,
    });
  }

  /**
   * Mark delivery as failed and retry (or move to DLQ)
   */
  async markFailure(job: WebhookDeliveryJob, error: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      job.attemptCount++;

      if (job.attemptCount >= job.maxAttempts) {
        // Max attempts reached - move to dead letter queue
        await this.redis.rPush(
          'webhook:queue:dlq',
          JSON.stringify({
            ...job,
            error,
            failedAt: Date.now(),
          })
        );

        // Update queue depth metrics
        await this.updateQueueMetrics();

        logger.warn('Webhook delivery moved to DLQ after max attempts', {
          deliveryId: job.deliveryId,
          webhookId: job.webhookId,
          attemptCount: job.attemptCount,
          error,
        });
      } else {
        // Schedule retry with exponential backoff
        const retryDelay = Math.min(
          this.config.initialRetryDelayMs *
            Math.pow(this.config.backoffMultiplier, job.attemptCount - 1),
          this.config.maxRetryDelayMs
        );

        const retryAt = Date.now() + retryDelay;
        job.scheduledAt = retryAt;

        const retryKey = `webhook:queue:retry:${retryAt}`;
        await this.redis.rPush(retryKey, JSON.stringify(job));

        // Set TTL on retry queue (2x the retry delay to handle clock skew)
        await this.redis.expire(retryKey, Math.ceil((retryDelay * 2) / 1000));

        // Update queue depth metrics
        await this.updateQueueMetrics();

        logger.info('Webhook delivery scheduled for retry', {
          deliveryId: job.deliveryId,
          webhookId: job.webhookId,
          attemptCount: job.attemptCount,
          retryDelay,
          retryAt: new Date(retryAt).toISOString(),
          error,
        });
      }
    } catch (err) {
      logger.error('Failed to mark webhook delivery as failed', {
        deliveryId: job.deliveryId,
        error: err,
      });
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    pendingCount: number;
    retryCount: number;
    dlqCount: number;
  }> {
    if (!this.redis) {
      return { pendingCount: 0, retryCount: 0, dlqCount: 0 };
    }

    try {
      const [pendingCount, dlqCount] = await Promise.all([
        this.redis.lLen('webhook:queue:pending'),
        this.redis.lLen('webhook:queue:dlq'),
      ]);

      // Count retry queue entries
      const retryKeys = await scanRedisKeys(this.redis, 'webhook:queue:retry:*');
      let retryCount = 0;
      for (const key of retryKeys as string[]) {
        const count = await this.redis.lLen(key);
        retryCount += count as number;
      }

      return {
        pendingCount: pendingCount as number,
        retryCount,
        dlqCount: dlqCount as number,
      };
    } catch (error) {
      logger.error('Failed to get queue stats', { error });
      return { pendingCount: 0, retryCount: 0, dlqCount: 0 };
    }
  }

  /**
   * Update queue depth metrics
   */
  private async updateQueueMetrics(): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const pendingCount = (await this.redis.lLen('webhook:queue:pending')) as number;
      const dlqCount = (await this.redis.lLen('webhook:queue:dlq')) as number;

      // Count retry queue entries
      const retryKeys = await scanRedisKeys(this.redis, 'webhook:queue:retry:*');
      let retryCount = 0;
      for (const key of retryKeys as string[]) {
        const count = await this.redis.lLen(key);
        retryCount += count as number;
      }

      updateWebhookQueueDepth('pending', pendingCount);
      updateWebhookQueueDepth('retry', retryCount);
      updateWebhookQueueDepth('dlq', dlqCount);
    } catch (error) {
      logger.error('Failed to update queue metrics', { error });
    }
  }

  /**
   * Purge dead letter queue
   */
  async purgeDLQ(): Promise<number> {
    if (!this.redis) {
      return 0;
    }

    try {
      const count = await this.redis.lLen('webhook:queue:dlq');
      await this.redis.del('webhook:queue:dlq');

      logger.info('Dead letter queue purged', { count });

      return count as number;
    } catch (error) {
      logger.error('Failed to purge DLQ', { error });
      return 0;
    }
  }
}

/**
 * Singleton webhook queue instance
 */
let webhookQueue: WebhookQueue | null = null;

/**
 * Initialize webhook queue
 */
export function initWebhookQueue(
  redis: RedisClient | null,
  config?: Partial<WebhookQueueConfig>
): void {
  if (webhookQueue) {
    logger.warn('Webhook queue already initialized');
    return;
  }

  webhookQueue = new WebhookQueue(redis, config);
  logger.info('Webhook queue singleton initialized');
}

/**
 * Get webhook queue instance
 */
export function getWebhookQueue(): WebhookQueue {
  if (!webhookQueue) {
    throw new ServiceError(
      'Webhook queue not initialized',
      'SERVICE_NOT_INITIALIZED',
      'WebhookQueue'
    );
  }
  return webhookQueue;
}

/**
 * Reset webhook queue (for testing)
 */
export function resetWebhookQueue(): void {
  webhookQueue = null;
  logger.debug('Webhook queue reset');
}
