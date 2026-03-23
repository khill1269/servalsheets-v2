/**
 * Session Limiter
 *
 * Prevents DoS attacks by limiting the number of concurrent sessions per user/token
 */

import { logger } from './logger.js';
import { MAX_SESSIONS_PER_USER, MAX_TOTAL_SESSIONS } from '../config/constants.js';

export interface SessionLimiterOptions {
  maxSessionsPerUser: number;
  maxTotalSessions: number;
}

const DEFAULT_OPTIONS: SessionLimiterOptions = {
  maxSessionsPerUser: MAX_SESSIONS_PER_USER,
  maxTotalSessions: MAX_TOTAL_SESSIONS,
};

export class SessionLimiter {
  private options: SessionLimiterOptions;
  private sessionsByUser = new Map<string, Set<string>>();
  private sessionToUser = new Map<string, string>();

  constructor(options: Partial<SessionLimiterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if a new session can be created for this user
   */
  canCreateSession(userId: string): { allowed: boolean; reason?: string } {
    // Check total sessions limit
    const totalSessions = this.sessionToUser.size;
    if (totalSessions >= this.options.maxTotalSessions) {
      return {
        allowed: false,
        reason: `Maximum total sessions (${this.options.maxTotalSessions}) reached. Please try again later.`,
      };
    }

    // Check per-user sessions limit
    const userSessions = this.sessionsByUser.get(userId);
    if (userSessions && userSessions.size >= this.options.maxSessionsPerUser) {
      return {
        allowed: false,
        reason: `Maximum sessions per user (${this.options.maxSessionsPerUser}) reached. Close an existing session first.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Register a new session
   */
  registerSession(sessionId: string, userId: string): void {
    // Add to user's sessions
    let userSessions = this.sessionsByUser.get(userId);
    if (!userSessions) {
      userSessions = new Set();
      this.sessionsByUser.set(userId, userSessions);
    }
    userSessions.add(sessionId);

    // Track session to user mapping
    this.sessionToUser.set(sessionId, userId);

    logger.debug('Session registered', {
      sessionId,
      userId,
      userSessionCount: userSessions.size,
      totalSessions: this.sessionToUser.size,
    });
  }

  /**
   * Unregister a session (on disconnect)
   */
  unregisterSession(sessionId: string): void {
    const userId = this.sessionToUser.get(sessionId);
    if (!userId) {
      return;
    }

    // Remove from user's sessions
    const userSessions = this.sessionsByUser.get(userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.sessionsByUser.delete(userId);
      }
    }

    // Remove session to user mapping
    this.sessionToUser.delete(sessionId);

    logger.debug('Session unregistered', {
      sessionId,
      userId,
      remainingUserSessions: userSessions?.size ?? 0,
      totalSessions: this.sessionToUser.size,
    });
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    totalUsers: number;
    sessionsPerUser: Record<string, number>;
    maxSessionsPerUser: number;
    maxTotalSessions: number;
  } {
    const sessionsPerUser: Record<string, number> = {};
    for (const [userId, sessions] of this.sessionsByUser.entries()) {
      sessionsPerUser[userId] = sessions.size;
    }

    return {
      totalSessions: this.sessionToUser.size,
      totalUsers: this.sessionsByUser.size,
      sessionsPerUser,
      maxSessionsPerUser: this.options.maxSessionsPerUser,
      maxTotalSessions: this.options.maxTotalSessions,
    };
  }

  /**
   * Get sessions for a specific user
   */
  getUserSessions(userId: string): string[] {
    const sessions = this.sessionsByUser.get(userId);
    return sessions ? Array.from(sessions) : [];
  }

  /**
   * Force close all sessions for a user (admin function)
   */
  closeUserSessions(userId: string): string[] {
    const sessions = this.getUserSessions(userId);
    for (const sessionId of sessions) {
      this.unregisterSession(sessionId);
    }
    return sessions;
  }
}

/**
 * Global session limiter instance
 */
export const sessionLimiter = new SessionLimiter();
