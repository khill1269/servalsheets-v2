/**
 * ServalSheets - Task Store Factory
 *
 * Factory function for creating task stores with environment-based configuration
 * Supports both in-memory (development) and Redis (production) backends
 *
 * MCP Protocol: 2025-11-25 (SEP-1686)
 */

import { TaskStoreAdapter } from './task-store-adapter.js';
import { InMemoryTaskStore, RedisTaskStore } from './task-store.js';
import { logger as baseLogger } from '../utils/logger.js';
import { ConfigError } from './errors.js';

export interface TaskStoreConfig {
  /**
   * Force a specific store type (useful for testing)
   * If not specified, determined by environment variables
   */
  type?: 'memory' | 'redis';

  /**
   * Redis connection URL (overrides REDIS_URL env var)
   */
  redisUrl?: string;

  /**
   * Default TTL for tasks in milliseconds
   */
  defaultTtl?: number;
}

/**
 * Create a task store based on environment configuration
 *
 * Decision Logic:
 * 1. If config.type is specified, use that
 * 2. If REDIS_URL is set, use Redis
 * 3. Otherwise, use in-memory store
 *
 * Production Considerations:
 * - In-memory store: Single-process only, data lost on restart
 * - Redis store: Multi-process safe, persistent, requires Redis server
 *
 * @param config Optional configuration overrides
 * @returns TaskStoreAdapter wrapping the appropriate store implementation
 */
export async function createTaskStore(config: TaskStoreConfig = {}): Promise<TaskStoreAdapter> {
  const logger = baseLogger.child({ component: 'TaskStoreFactory' });

  // Determine store type
  let storeType: 'memory' | 'redis';

  if (config.type) {
    storeType = config.type;
    logger.info(`Task store type forced: ${storeType}`);
  } else {
    const redisUrl = config.redisUrl ?? process.env['REDIS_URL'];
    storeType = redisUrl ? 'redis' : 'memory';
    logger.info(`Task store type determined from environment: ${storeType}`);
  }

  // Create appropriate store
  if (storeType === 'redis') {
    const redisUrl = config.redisUrl ?? process.env['REDIS_URL'];

    if (!redisUrl) {
      throw new ConfigError(
        'Redis task store requested but REDIS_URL not configured. ' +
          'Set REDIS_URL environment variable or use in-memory store for development.',
        'REDIS_URL'
      );
    }

    // Create Redis-backed task store
    const redisStore = new RedisTaskStore(redisUrl);

    logger.info('Task store created', {
      type: 'redis',
      url: redisUrl.replace(/:[^:]*@/, ':***@'), // Mask password in logs
    });

    return new TaskStoreAdapter(redisStore);
  } else {
    // In-memory store
    const memoryStore = new InMemoryTaskStore();

    logger.info('Task store created', {
      type: 'memory',
      warning:
        process.env['NODE_ENV'] === 'production'
          ? 'In-memory store in production - data will be lost on restart'
          : undefined,
    });

    return new TaskStoreAdapter(memoryStore);
  }
}

/**
 * Get recommended task store type for current environment
 *
 * @returns Recommended store type based on environment
 */
export function getRecommendedTaskStoreType(): 'memory' | 'redis' {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const hasRedis = Boolean(process.env['REDIS_URL']);

  if (isProduction && !hasRedis) {
    baseLogger.warn(
      'Production environment detected without Redis. ' +
        'Task store will use in-memory storage (not recommended for production). ' +
        'Set REDIS_URL to enable persistent, multi-instance task storage.'
    );
  }

  return hasRedis ? 'redis' : 'memory';
}
