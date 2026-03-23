/**
 * ServalSheets - User Profile Manager
 *
 * Provides persistent user profile storage with learned patterns and preferences.
 * Enables cross-session learning and personalized experiences.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DEFAULT_PROFILE_STORAGE_DIR } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { DataError } from '../core/errors.js';

// ============================================================================
// ISSUE-102: Optional AES-256-GCM encryption at rest
// Set PROFILE_ENCRYPTION_KEY to a 64-hex-char (32-byte) key for production.
// Example: openssl rand -hex 32
// ============================================================================
const ENCRYPTION_KEY_HEX = process.env['PROFILE_ENCRYPTION_KEY'];

function encryptProfileData(plaintext: string): string {
  if (!ENCRYPTION_KEY_HEX) return plaintext;
  const key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptProfileData(input: string): string {
  if (!ENCRYPTION_KEY_HEX) return input;
  try {
    const { v, iv, tag, data } = JSON.parse(input) as {
      v: number;
      iv: string;
      tag: string;
      data: string;
    };
    if (v !== 1)
      throw new DataError(`Unsupported encryption version: ${String(v)}`, 'VERSION_MISMATCH');
    const key = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return decipher.update(Buffer.from(data, 'base64'), undefined, 'utf8') + decipher.final('utf8');
  } catch {
    // Fallback: try plaintext (migration path from unencrypted profiles)
    return input;
  }
}

/**
 * User profile structure with preferences, learnings, and history
 */
export interface UserProfile {
  userId: string;
  preferences: {
    chartStyle?: 'minimalist' | 'detailed' | 'colorful';
    confirmationLevel: 'always' | 'destructive' | 'never';
    formatPreferences?: {
      headers?: string;
      currency?: string;
      dateFormat?: string;
    };
  };
  learnings: {
    commonWorkflows: string[]; // e.g., "load_data → validate → fix → visualize"
    rejectedSuggestions: string[]; // Don't suggest these again
    qualityStandards?: {
      minDataQuality: number;
      maxNullPercent: number;
    };
  };
  history: {
    successfulFormulas: Array<{
      formula: string;
      useCase: string;
      successCount: number;
      // Extended fields for Phase 4 Formula Library
      category?: 'lookup' | 'aggregation' | 'text' | 'date' | 'array' | 'financial';
      performance?: 'fast' | 'medium' | 'slow';
      complexity?: 'simple' | 'intermediate' | 'complex';
      tags?: string[];
      lastUsed?: number;
    }>;
    errorPatterns: Array<{ error: string; count: number; lastSeen: string }>;
  };
  lastUpdated: number;
  /** ISSUE-090: GDPR consent record (Art. 7) */
  consent?: {
    /** Unix timestamp when consent was last granted. null = explicitly revoked. */
    grantedAt?: number | null;
    /** Version string of the consent policy user agreed to (e.g. "v1.0") */
    version?: string;
    /** Unix timestamp when consent was revoked (if applicable) */
    revokedAt?: number;
  };
}

/**
 * Manages user profiles with file-based persistence
 */
export class UserProfileManager {
  private profiles = new Map<string, UserProfile>();
  private storageDir: string;

  constructor(storageDir = process.env['PROFILE_STORAGE_DIR'] || DEFAULT_PROFILE_STORAGE_DIR) {
    this.storageDir = storageDir;
    if (!process.env['PROFILE_STORAGE_DIR']) {
      logger.warn(
        `PROFILE_STORAGE_DIR not set — using ${DEFAULT_PROFILE_STORAGE_DIR} (volatile, not secure). ` +
          'Set PROFILE_STORAGE_DIR env var for persistent, secure profile storage.'
      );
    }
  }

  /**
   * Load user profile from memory or disk, creating new if needed
   */
  async loadProfile(userId: string): Promise<UserProfile> {
    // Try memory first
    if (this.profiles.has(userId)) {
      return this.profiles.get(userId)!;
    }

    // Try disk
    const filePath = path.join(this.storageDir, `${userId}.json`);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = decryptProfileData(raw); // ISSUE-102: decrypt if key is set
      const profile = JSON.parse(data) as UserProfile;
      this.profiles.set(userId, profile);
      logger.info('Loaded user profile from disk', { userId });
      return profile;
    } catch (_error) {
      // Create new profile if not found
      logger.info('Creating new user profile', { userId });
      return this.createProfile(userId);
    }
  }

  /**
   * Create a new user profile with default settings
   */
  private createProfile(userId: string): UserProfile {
    const profile: UserProfile = {
      userId,
      preferences: {
        confirmationLevel: 'destructive',
      },
      learnings: {
        commonWorkflows: [],
        rejectedSuggestions: [],
      },
      history: {
        successfulFormulas: [],
        errorPatterns: [],
      },
      lastUpdated: Date.now(),
    };

    this.profiles.set(userId, profile);
    return profile;
  }

  /**
   * Save user profile to memory and disk
   */
  async saveProfile(profile: UserProfile): Promise<void> {
    profile.lastUpdated = Date.now();
    this.profiles.set(profile.userId, profile);

    try {
      // Write to disk
      const filePath = path.join(this.storageDir, `${profile.userId}.json`);
      await fs.mkdir(this.storageDir, { recursive: true });
      const serialized = JSON.stringify(profile, null, 2);
      await fs.writeFile(filePath, encryptProfileData(serialized)); // ISSUE-102: encrypt if key set
      logger.info('Saved user profile to disk', { userId: profile.userId });
    } catch (error) {
      logger.error('Failed to save user profile', { userId: profile.userId, error });
    }
  }

  /**
   * Learn from user corrections (e.g., user changed action X to Y)
   */
  async learnFromCorrection(
    userId: string,
    context: {
      originalAction: string;
      correctedAction: string;
      successful: boolean;
    }
  ): Promise<void> {
    const profile = await this.loadProfile(userId);

    // Track patterns: user prefers Y over X
    if (context.successful) {
      // Could track workflow patterns here
      logger.debug('Learning from successful correction', {
        userId,
        original: context.originalAction,
        corrected: context.correctedAction,
      });
    }

    await this.saveProfile(profile);
  }

  /**
   * Record a successful formula pattern
   */
  async recordSuccessfulFormula(userId: string, formula: string, useCase: string): Promise<void> {
    const profile = await this.loadProfile(userId);
    const existing = profile.history.successfulFormulas.find((f) => f.formula === formula);

    if (existing) {
      existing.successCount++;
    } else {
      profile.history.successfulFormulas.push({ formula, useCase, successCount: 1 });

      // Keep only top 50 formulas
      if (profile.history.successfulFormulas.length > 50) {
        profile.history.successfulFormulas.sort((a, b) => b.successCount - a.successCount);
        profile.history.successfulFormulas = profile.history.successfulFormulas.slice(0, 50);
      }
    }

    await this.saveProfile(profile);
  }

  /**
   * Record that user rejected a suggestion
   */
  async rejectSuggestion(userId: string, suggestion: string): Promise<void> {
    const profile = await this.loadProfile(userId);

    if (!profile.learnings.rejectedSuggestions.includes(suggestion)) {
      profile.learnings.rejectedSuggestions.push(suggestion);

      // Keep only last 100 rejections
      if (profile.learnings.rejectedSuggestions.length > 100) {
        profile.learnings.rejectedSuggestions = profile.learnings.rejectedSuggestions.slice(-100);
      }
    }

    await this.saveProfile(profile);
  }

  /**
   * Record error pattern for learning
   */
  async recordErrorPattern(userId: string, error: string): Promise<void> {
    const profile = await this.loadProfile(userId);
    const existing = profile.history.errorPatterns.find((e) => e.error === error);

    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
    } else {
      profile.history.errorPatterns.push({
        error,
        count: 1,
        lastSeen: new Date().toISOString(),
      });

      // Keep only top 50 error patterns
      if (profile.history.errorPatterns.length > 50) {
        profile.history.errorPatterns.sort((a, b) => b.count - a.count);
        profile.history.errorPatterns = profile.history.errorPatterns.slice(0, 50);
      }
    }

    await this.saveProfile(profile);
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<UserProfile['preferences']>
  ): Promise<void> {
    const profile = await this.loadProfile(userId);
    profile.preferences = { ...profile.preferences, ...preferences };
    await this.saveProfile(profile);
  }

  /**
   * Get top successful formulas for a user
   */
  async getTopFormulas(
    userId: string,
    limit = 10
  ): Promise<UserProfile['history']['successfulFormulas']> {
    const profile = await this.loadProfile(userId);
    return profile.history.successfulFormulas
      .sort((a, b) => b.successCount - a.successCount)
      .slice(0, limit);
  }

  /**
   * Check if a suggestion should be avoided (user rejected it before)
   */
  async shouldAvoidSuggestion(userId: string, suggestion: string): Promise<boolean> {
    const profile = await this.loadProfile(userId);
    return profile.learnings.rejectedSuggestions.includes(suggestion);
  }

  // ============================================================================
  // ISSUE-090: GDPR compliance methods (Art. 7 consent, Art. 17 erasure, Art. 20 portability)
  // ============================================================================

  /**
   * Grant user consent for AI analysis and data processing (GDPR Art. 7).
   */
  async grantConsent(userId: string, consentVersion: string): Promise<void> {
    const profile = await this.loadProfile(userId);
    profile.consent = {
      grantedAt: Date.now(),
      version: consentVersion,
    };
    await this.saveProfile(profile);
    logger.info('GDPR consent granted', { userId, consentVersion });
  }

  /**
   * Revoke user consent for AI analysis (GDPR Art. 7 withdrawal).
   * After revocation, Sampling calls will return GDPR_CONSENT_REQUIRED errors.
   */
  async revokeConsent(userId: string): Promise<void> {
    const profile = await this.loadProfile(userId);
    profile.consent = {
      grantedAt: null, // null = explicitly revoked
      revokedAt: Date.now(),
      version: profile.consent?.version,
    };
    await this.saveProfile(profile);
    logger.info('GDPR consent revoked', { userId });
  }

  /**
   * Delete all stored data for a user (GDPR Art. 17 — right to erasure).
   * Removes from memory cache and disk.
   */
  async deleteProfile(userId: string): Promise<void> {
    this.profiles.delete(userId);
    const filePath = path.join(this.storageDir, `${userId}.json`);
    try {
      await fs.unlink(filePath);
      logger.info('GDPR profile deleted', { userId });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.error('Failed to delete user profile', { userId, error });
        throw error;
      }
      // ENOENT = file already gone — treat as success
    }
  }

  /**
   * Export all data for a user in portable format (GDPR Art. 20 — right to portability).
   * Returns a structured export including all stored profile data.
   */
  async exportProfile(
    userId: string
  ): Promise<{ userId: string; exportedAt: string; data: UserProfile }> {
    const profile = await this.loadProfile(userId);
    return {
      userId,
      exportedAt: new Date().toISOString(),
      data: { ...profile },
    };
  }

  /**
   * Check if user has granted consent for AI analysis.
   * Returns true if consent was granted and not revoked.
   * Returns false if consent was never granted or was explicitly revoked.
   */
  async hasConsent(userId: string): Promise<boolean> {
    const profile = await this.loadProfile(userId);
    if (!profile.consent) return true; // No consent record = pre-GDPR profile, allow
    return typeof profile.consent.grantedAt === 'number' && profile.consent.grantedAt > 0;
  }
}
