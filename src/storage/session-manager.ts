/**
 * Session Manager
 *
 * Manages user sessions with limits and TTL enforcement.
 * Prevents session exhaustion attacks by limiting sessions per user.
 */

import { SessionStore } from './session-store.js';
import { logger } from '../utils/logger.js';

export interface SessionInfo {
  sessionId: string;
  userId: string;
  created: number;
  expires: number;
  metadata?: Record<string, unknown>;
}

export interface SessionManagerConfig {
  sessionStore: SessionStore;
  maxSessionsPerUser: number;
  defaultTtlSeconds: number;
}

/**
 * Session Manager with per-user limits
 *
 * Features:
 * - Enforces max sessions per user
 * - Automatic cleanup of oldest sessions when limit exceeded
 * - TTL enforcement via SessionStore
 * - Session listing and statistics
 */
export class SessionManager {
  private readonly store: SessionStore;
  private readonly maxSessionsPerUser: number;
  private readonly defaultTtlSeconds: number;

  constructor(config: SessionManagerConfig) {
    this.store = config.sessionStore;
    this.maxSessionsPerUser = config.maxSessionsPerUser;
    this.defaultTtlSeconds = config.defaultTtlSeconds;
  }

  /**
   * Create a new session for a user
   * Enforces max sessions per user by removing oldest sessions
   */
  async createSession(
    sessionId: string,
    userId: string,
    metadata?: Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const now = Date.now();

    const sessionInfo: SessionInfo = {
      sessionId,
      userId,
      created: now,
      expires: now + ttl * 1000,
      metadata,
    };

    // Check current session count for this user
    const existingSessions = await this.getUserSessions(userId);

    if (existingSessions.length >= this.maxSessionsPerUser) {
      // Remove oldest sessions to make room
      const toRemove = existingSessions
        .sort((a, b) => a.created - b.created)
        .slice(0, existingSessions.length - this.maxSessionsPerUser + 1);

      for (const session of toRemove) {
        await this.deleteSession(session.sessionId);
        logger.info('Removed old session due to limit', {
          userId,
          sessionId: session.sessionId,
          limit: this.maxSessionsPerUser,
        });
      }
    }

    // Store the new session
    await this.store.set(this.getSessionKey(sessionId), sessionInfo, ttl);

    // Add to user's session index
    await this.addToUserIndex(userId, sessionId, ttl);

    logger.info('Session created', {
      userId,
      sessionId,
      ttlSeconds: ttl,
      totalSessions: existingSessions.length + 1,
    });
  }

  /**
   * Get session info by session ID
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const data = await this.store.get(this.getSessionKey(sessionId));

    if (!data) {
      return null;
    }

    return data as SessionInfo;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);

    if (session) {
      // Remove from session store
      await this.store.delete(this.getSessionKey(sessionId));

      // Remove from user index
      await this.removeFromUserIndex(session.userId, sessionId);

      logger.debug('Session deleted', { sessionId, userId: session.userId });
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionInfo[]> {
    const sessionIds = await this.getUserSessionIds(userId);
    const sessions: SessionInfo[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Delete all sessions for a user
   */
  async deleteUserSessions(userId: string): Promise<number> {
    const sessionIds = await this.getUserSessionIds(userId);
    let deleted = 0;

    for (const sessionId of sessionIds) {
      await this.deleteSession(sessionId);
      deleted++;
    }

    logger.info('User sessions deleted', { userId, count: deleted });
    return deleted;
  }

  /**
   * Check if a session exists and is valid
   */
  async hasSession(sessionId: string): Promise<boolean> {
    return await this.store.has(this.getSessionKey(sessionId));
  }

  /**
   * Update session TTL (refresh session)
   */
  async refreshSession(sessionId: string, ttlSeconds?: number): Promise<boolean> {
    const session = await this.getSession(sessionId);

    if (!session) {
      return false;
    }

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const now = Date.now();

    // Update expires time
    session.expires = now + ttl * 1000;

    // Re-store with new TTL
    await this.store.set(this.getSessionKey(sessionId), session, ttl);

    // Refresh user index TTL
    await this.addToUserIndex(session.userId, sessionId, ttl);

    logger.debug('Session refreshed', { sessionId, ttlSeconds: ttl });
    return true;
  }

  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    totalSessions: number;
    storeStats?: { totalKeys: number; memoryUsage?: number };
  }> {
    const keys = this.store.keys ? await this.store.keys('session:*') : [];

    const storeStats = this.store.stats ? await this.store.stats() : undefined;

    return {
      totalSessions: keys.length,
      storeStats,
    };
  }

  /**
   * Cleanup expired sessions
   */
  async cleanup(): Promise<void> {
    await this.store.cleanup();
  }

  // Private helper methods

  private getSessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private getUserIndexKey(userId: string): string {
    return `user:${userId}:sessions`;
  }

  private async getUserSessionIds(userId: string): Promise<string[]> {
    const data = await this.store.get(this.getUserIndexKey(userId));

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data as string[];
  }

  private async addToUserIndex(
    userId: string,
    sessionId: string,
    ttlSeconds: number
  ): Promise<void> {
    const sessionIds = await this.getUserSessionIds(userId);

    // Add session ID if not already present
    if (!sessionIds.includes(sessionId)) {
      sessionIds.push(sessionId);
    }

    // Store updated index with same TTL as session
    await this.store.set(this.getUserIndexKey(userId), sessionIds, ttlSeconds);
  }

  private async removeFromUserIndex(userId: string, sessionId: string): Promise<void> {
    const sessionIds = await this.getUserSessionIds(userId);
    const filtered = sessionIds.filter((id) => id !== sessionId);

    if (filtered.length > 0) {
      // Re-store with original TTL (we don't know it, so use default)
      await this.store.set(this.getUserIndexKey(userId), filtered, this.defaultTtlSeconds);
    } else {
      // No more sessions, delete the index
      await this.store.delete(this.getUserIndexKey(userId));
    }
  }
}

/**
 * Factory function to create SessionManager
 */
export function createSessionManager(
  sessionStore: SessionStore,
  options?: {
    maxSessionsPerUser?: number;
    defaultTtlSeconds?: number;
  }
): SessionManager {
  return new SessionManager({
    sessionStore,
    maxSessionsPerUser: options?.maxSessionsPerUser ?? 5,
    defaultTtlSeconds: options?.defaultTtlSeconds ?? 3600, // 1 hour default
  });
}
