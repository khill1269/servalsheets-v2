/**
 * Per-User Rate Limiting Middleware
 *
 * Enforces RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX from env config using a
 * token-bucket algorithm. Each principalId (user/session) gets an independent
 * bucket. Buckets are cleaned up when idle for 2x the window period.
 *
 * This prevents a single user from exhausting the Google API quota.
 */

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

/**
 * Check if a request from the given principal is allowed under the rate limit.
 * Returns { allowed: true } if the request can proceed, or
 * { allowed: false, retryAfterMs } if the limit is exceeded.
 */
export function checkRateLimit(principalId: string): {
  allowed: boolean;
  retryAfterMs?: number;
} {
  const windowMs = env.RATE_LIMIT_WINDOW_MS;
  const maxTokens = env.RATE_LIMIT_MAX;
  const now = Date.now();

  let bucket = buckets.get(principalId);

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    buckets.set(principalId, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor((elapsed / windowMs) * maxTokens);
  if (refill > 0) {
    bucket.tokens = Math.min(maxTokens, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens > 0) {
    bucket.tokens--;
    return { allowed: true };
  }

  // Calculate when next token will be available
  const msPerToken = windowMs / maxTokens;
  const retryAfterMs = Math.ceil(msPerToken);

  logger.warn('Rate limit exceeded', { principalId, retryAfterMs, windowMs, maxTokens });

  return { allowed: false, retryAfterMs };
}

/**
 * Clean up idle buckets (no activity for 2x the rate limit window).
 */
function cleanupIdleBuckets(): void {
  const cutoff = Date.now() - env.RATE_LIMIT_WINDOW_MS * 2;
  let cleaned = 0;
  for (const [id, bucket] of buckets.entries()) {
    if (bucket.lastRefill < cutoff) {
      buckets.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug('Cleaned up idle rate limit buckets', { cleaned, remaining: buckets.size });
  }
}

// Run cleanup every 10 minutes (unref so it doesn't keep the process alive)
const cleanupInterval = setInterval(cleanupIdleBuckets, 10 * 60 * 1000);
cleanupInterval.unref();

/**
 * Get current rate limit statistics (for diagnostics).
 */
export function getRateLimitStats(): {
  activePrincipals: number;
  buckets: Array<{ principalId: string; remainingTokens: number }>;
} {
  const stats: Array<{ principalId: string; remainingTokens: number }> = [];
  for (const [id, bucket] of buckets.entries()) {
    stats.push({ principalId: id, remainingTokens: bucket.tokens });
  }
  return { activePrincipals: buckets.size, buckets: stats };
}
