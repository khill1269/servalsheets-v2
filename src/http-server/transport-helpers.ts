import { createHash } from 'crypto';
import type { Request } from 'express';
import { InMemoryEventStore, RedisEventStore } from '../mcp/event-store.js';
import { logger } from '../utils/logger.js';
import { extractTrustedClientIp } from './client-ip.js';

export interface SessionSecurityContext {
  ipAddress: string;
  userAgent: string;
  tokenHash: string; // First 16 chars of token hash for validation
}

/**
 * Create security context for session binding.
 */
export function createSessionSecurityContext(req: Request, token: string): SessionSecurityContext {
  const ipAddress = extractTrustedClientIp(req, 'unknown');
  const userAgent = (req.headers['user-agent'] as string) || 'unknown';
  const tokenHash = createHash('sha256').update(token).digest('hex').substring(0, 16);

  return { ipAddress, userAgent, tokenHash };
}

/**
 * Verify security context matches for reconnection.
 */
export function verifySessionSecurityContext(
  stored: SessionSecurityContext,
  current: SessionSecurityContext
): { valid: boolean; reason?: string } {
  if (stored.tokenHash !== current.tokenHash) {
    return { valid: false, reason: 'Token mismatch' };
  }
  if (stored.userAgent !== current.userAgent) {
    return { valid: false, reason: 'User-agent mismatch' };
  }
  if (stored.ipAddress !== current.ipAddress) {
    // IP mismatch is a warning but not blocking (mobile networks can change IPs).
    logger.warn('Session IP address changed', {
      stored: stored.ipAddress,
      current: current.ipAddress,
    });
  }
  return { valid: true };
}

export function createSessionEventStore(params: {
  sessionId: string;
  eventStoreRedisUrl: string | undefined;
  eventStoreTtlMs: number;
  eventStoreMaxEvents: number;
}): InMemoryEventStore | RedisEventStore {
  const { sessionId, eventStoreRedisUrl, eventStoreTtlMs, eventStoreMaxEvents } = params;
  const options = {
    ttlMs: eventStoreTtlMs,
    maxEvents: eventStoreMaxEvents,
    streamId: sessionId,
  };
  if (eventStoreRedisUrl) {
    return new RedisEventStore(eventStoreRedisUrl, options);
  }
  return new InMemoryEventStore(options);
}

export function clearSessionEventStore(eventStore?: { clear: () => void | Promise<void> }): void {
  if (!eventStore) {
    return;
  }
  void Promise.resolve(eventStore.clear()).catch((error) => {
    logger.warn('Failed to clear event store', { error });
  });
}

export function normalizeMcpSessionHeader(req: Request): string | undefined {
  const existing = coerceHeaderValue(req.headers['mcp-session-id']);
  if (existing) {
    return existing;
  }

  const legacy = coerceHeaderValue(req.headers['x-session-id']);
  if (legacy) {
    (req.headers as Record<string, string | string[] | undefined>)['mcp-session-id'] = legacy;
  }
  return legacy;
}

const coerceHeaderValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;
