import type { TaskStoreAdapter } from '../core/index.js';
import { getDistributedCacheConfig } from '../config/env.js';
import { warnIfDefaultCredentialsInHttpMode } from '../config/embedded-oauth.js';
import { registerSamplingConsentChecker } from '../mcp/sampling.js';
import { ConfigError } from '../core/errors.js';
import { logger as baseLogger } from '../utils/logger.js';

export interface ServerBootstrapOptions {
  taskStore?: TaskStoreAdapter;
}

function registerSamplingConsentGuard(): void {
  // ISSUE-232: Wire GDPR sampling consent checker. When ENABLE_SAMPLING_CONSENT=strict, sampling
  // calls that lack explicit user consent will be blocked. Default: permissive (logs warning only).
  registerSamplingConsentChecker(async () => {
    if (process.env['ENABLE_SAMPLING_CONSENT'] === 'strict') {
      throw new ConfigError(
        'GDPR consent required before AI sampling. Set ENABLE_SAMPLING_CONSENT=strict to enforce.',
        'ENABLE_SAMPLING_CONSENT'
      );
    }
    // Non-strict: sampling is allowed; operators can override with a stricter checker.
  });
}

async function ensureTaskStoreConfigured(options: ServerBootstrapOptions): Promise<void> {
  // Create task store if not provided - uses createTaskStore() for Redis support.
  if (!options.taskStore) {
    const { createTaskStore } = await import('../core/task-store-factory.js');
    options.taskStore = await createTaskStore();
  }
}

function enforceRedisProductionRequirements(params: {
  redisUrl: string | undefined;
  isProduction: boolean;
  allowMemorySessions: boolean;
}): void {
  const { redisUrl, isProduction, allowMemorySessions } = params;

  // Enforce Redis in production for distributed cache and session persistence
  // unless ALLOW_MEMORY_SESSIONS=true for local testing.
  if (isProduction && !redisUrl && !allowMemorySessions) {
    throw new ConfigError(
      'Redis is required in production mode. Set REDIS_URL environment variable.\n' +
        'Example: REDIS_URL=redis://localhost:6379\n' +
        'For development/testing, set NODE_ENV=development\n' +
        'For local production testing, set ALLOW_MEMORY_SESSIONS=true',
      'REDIS_URL'
    );
  }

  if (isProduction && allowMemorySessions && !redisUrl) {
    baseLogger.warn(
      'Running production without Redis (ALLOW_MEMORY_SESSIONS=true). ' +
        'Cache and sessions are memory-only. Not recommended for real production.'
    );
  }
}

async function initializeRedisBackedCaches(redisUrl: string): Promise<void> {
  const { createClient } = await import('redis');
  const { initCapabilityCacheService } = await import('../services/capability-cache.js');
  const { initETagCache } = await import('../services/etag-cache.js');

  const redis = createClient({ url: redisUrl });
  await redis.connect();

  // Initialize capability cache with Redis.
  initCapabilityCacheService(redis);
  baseLogger.info('Capability cache service initialized with Redis');

  // Initialize ETag cache with Redis (if enabled).
  const cacheConfig = getDistributedCacheConfig();
  if (cacheConfig.enabled) {
    initETagCache(redis);
    baseLogger.info('ETag cache initialized with Redis L2 (distributed caching enabled)');
  } else {
    initETagCache();
    baseLogger.info('ETag cache initialized (L1 memory-only)');
  }

  // SCALE-01: Wire Redis-backed session store when SESSION_STORE_TYPE=redis.
  if (process.env['SESSION_STORE_TYPE'] === 'redis') {
    const { initSessionRedis } = await import('../services/session-context.js');
    initSessionRedis(redis);
    baseLogger.info('Session store initialized with Redis backend');
  }
}

async function initializeMemoryOnlyCaches(): Promise<void> {
  const { initCapabilityCacheService } = await import('../services/capability-cache.js');
  const { initETagCache } = await import('../services/etag-cache.js');

  initCapabilityCacheService();
  baseLogger.info('Capability cache service initialized (memory-only)');

  initETagCache();
  baseLogger.info('ETag cache initialized (L1 memory-only)');
}

async function initializeCacheInfrastructure(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'];
  const isProduction = process.env['NODE_ENV'] === 'production';
  const allowMemorySessions = process.env['ALLOW_MEMORY_SESSIONS'] === 'true';

  enforceRedisProductionRequirements({ redisUrl, isProduction, allowMemorySessions });

  if (redisUrl) {
    await initializeRedisBackedCaches(redisUrl);
    return;
  }

  await initializeMemoryOnlyCaches();
}

export async function prepareServerBootstrap(options: ServerBootstrapOptions): Promise<void> {
  // Warn when the current installation lacks a usable bundled OAuth client.
  warnIfDefaultCredentialsInHttpMode();
  registerSamplingConsentGuard();
  await ensureTaskStoreConfigured(options);
  await initializeCacheInfrastructure();
}
