/**
 * Error Pattern Learning Service
 *
 * Tracks error patterns across sessions and suggests prevention strategies
 * Uses unified LRU cache for automatic cleanup
 *
 * Phase 4: Optional Enhancements - Error Pattern Learning
 */

import { logger } from '../utils/logger.js';
import { LRUCache } from '../utils/cache.js';

interface ErrorPattern {
  errorCode: string;
  errorMessage: string;
  context: {
    tool?: string;
    action?: string;
    spreadsheetId?: string;
  };
  count: number;
  firstSeen: number;
  lastSeen: number;
  resolutions: ErrorResolution[];
}

interface ErrorResolution {
  fix: string;
  successRate: number;
  avgTimeToFix: number;
}

interface PreventionSuggestion {
  message: string;
  preventionSteps: string[];
  relatedPatterns: string[];
  confidence: number;
}

export interface PatternResult {
  topResolution: {
    fix: string;
    successRate: number;
    occurrenceCount: number;
  } | null;
}

export class ErrorPatternLearner {
  // Use unified LRU cache (max 10K patterns, auto-evicts oldest)
  private patterns: LRUCache<string, ErrorPattern>;

  constructor() {
    this.patterns = new LRUCache<string, ErrorPattern>({ maxSize: 10000 });
  }

  /**
   * Record an error occurrence
   */
  recordError(errorCode: string, errorMessage: string, context: ErrorPattern['context']): void {
    const key = this.generateKey(errorCode, context);
    const existing = this.patterns.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
      this.patterns.set(key, existing);
    } else {
      this.patterns.set(key, {
        errorCode,
        errorMessage,
        context,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        resolutions: [],
      });
    }

    logger.info('Recorded error pattern', { errorCode, key, count: existing?.count || 1 });
  }

  /**
   * Record a successful error resolution
   */
  recordResolution(
    errorCode: string,
    context: ErrorPattern['context'],
    fix: string,
    timeToFix: number
  ): void {
    const key = this.generateKey(errorCode, context);
    const pattern = this.patterns.get(key);

    if (!pattern) {
      logger.warn('Cannot record resolution - pattern not found', { key });
      return;
    }

    // Find existing resolution or create new
    const existingResolution = pattern.resolutions.find((r) => r.fix === fix);
    if (existingResolution) {
      // Update success rate (weighted average)
      const totalAttempts = pattern.count;
      existingResolution.successRate =
        (existingResolution.successRate * (totalAttempts - 1) + 1) / totalAttempts;
      existingResolution.avgTimeToFix =
        (existingResolution.avgTimeToFix * (totalAttempts - 1) + timeToFix) / totalAttempts;
    } else {
      pattern.resolutions.push({
        fix,
        successRate: 1.0,
        avgTimeToFix: timeToFix,
      });
    }

    this.patterns.set(key, pattern);
    logger.info('Recorded error resolution', { errorCode, fix });
  }

  /**
   * Get prevention suggestions based on recent errors
   */
  suggestPrevention(recentContext?: {
    tool?: string;
    spreadsheetId?: string;
  }): PreventionSuggestion[] {
    const allPatterns = Array.from(this.patterns.values());

    // Filter by context if provided
    let relevantPatterns = recentContext
      ? allPatterns.filter(
          (p) =>
            (!recentContext.tool || p.context.tool === recentContext.tool) &&
            (!recentContext.spreadsheetId ||
              p.context.spreadsheetId === recentContext.spreadsheetId)
        )
      : allPatterns;

    // Find patterns with >3 occurrences in last 7 days
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const frequentErrors = relevantPatterns.filter(
      (p) => p.count >= 3 && p.lastSeen > sevenDaysAgo
    );

    // Sort by count descending
    frequentErrors.sort((a, b) => b.count - a.count);

    // Generate suggestions for top 5
    return frequentErrors.slice(0, 5).map((pattern) => this.generatePreventionSuggestion(pattern));
  }

  /**
   * Get pattern result for an error code in a given context.
   * Returns null if fewer than 3 occurrences exist (insufficient data).
   */
  getPatterns(
    errorCode: string,
    context: { tool?: string; action?: string }
  ): PatternResult | null {
    const key = this.generateKey(errorCode, context);
    const pattern = this.patterns.get(key);

    if (!pattern || pattern.count < 3) {
      return null;
    }

    if (pattern.resolutions.length === 0) {
      return { topResolution: null };
    }

    const best = pattern.resolutions.reduce((prev, curr) =>
      curr.successRate > prev.successRate ? curr : prev
    );

    return {
      topResolution: {
        fix: best.fix,
        successRate: best.successRate,
        occurrenceCount: pattern.count,
      },
    };
  }

  /**
   * Get suggested fix for an error
   */
  suggestFix(errorCode: string, context: ErrorPattern['context']): ErrorResolution | null {
    const key = this.generateKey(errorCode, context);
    const pattern = this.patterns.get(key);

    if (!pattern || pattern.resolutions.length === 0) {
      return null;
    }

    // Return resolution with highest success rate
    return pattern.resolutions.reduce((best, current) =>
      current.successRate > best.successRate ? current : best
    );
  }

  /**
   * Generate prevention suggestion from pattern
   */
  private generatePreventionSuggestion(pattern: ErrorPattern): PreventionSuggestion {
    const steps: string[] = [];
    let confidence = 0.5;

    // Analyze error type
    if (pattern.errorCode === 'MODULE_NOT_FOUND') {
      steps.push('Run: npm run build (compiles TypeScript to dist/)');
      steps.push('Ensure dist/cli.js and dist/server.js exist');
      steps.push('Check package.json has "prestart" hook configured');
      steps.push('Avoid deleting dist/ directory manually');
      confidence = 0.95;
    } else if (pattern.errorCode === 'SPREADSHEET_NOT_FOUND') {
      steps.push('Verify spreadsheet ID exists before operations');
      steps.push('Use sheets_info get_metadata to check access');
      confidence = 0.9;
    } else if (pattern.errorCode === 'SHEET_NOT_FOUND') {
      steps.push('List available sheets with sheets_info list_sheets first');
      steps.push('Handle sheet name changes gracefully');
      confidence = 0.85;
    } else if (pattern.errorCode === 'INSUFFICIENT_PERMISSIONS') {
      steps.push('Check permissions with sheets_info get_permissions');
      steps.push('Request access before attempting write operations');
      confidence = 0.8;
    } else if (pattern.errorCode === 'RANGE_INVALID') {
      steps.push('Validate range format (e.g., A1:B10)');
      steps.push('Ensure range exists in target sheet');
      confidence = 0.75;
    }

    // Add resolution-based steps
    if (pattern.resolutions.length > 0) {
      const bestResolution = pattern.resolutions.reduce((best, current) =>
        current.successRate > best.successRate ? current : best
      );
      steps.push(`When this occurs: ${bestResolution.fix}`);
      confidence = Math.max(confidence, bestResolution.successRate);
    }

    // Find related patterns
    const relatedPatterns = Array.from(this.patterns.values())
      .filter(
        (p) =>
          p.errorCode !== pattern.errorCode &&
          p.context.tool === pattern.context.tool &&
          p.count > 2
      )
      .slice(0, 3)
      .map((p) => p.errorCode);

    return {
      message: `You've encountered "${pattern.errorCode}" ${pattern.count} times. Here's how to prevent it:`,
      preventionSteps: steps,
      relatedPatterns,
      confidence,
    };
  }

  /**
   * Generate cache key
   */
  private generateKey(errorCode: string, context: ErrorPattern['context']): string {
    return `${errorCode}:${context.tool || '*'}:${context.action || '*'}`;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPatterns: number;
    totalErrors: number;
    topErrors: Array<{ code: string; count: number }>;
  } {
    const patterns = Array.from(this.patterns.values());
    const totalErrors = patterns.reduce((sum, p) => sum + p.count, 0);
    const topErrors = patterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((p) => ({ code: p.errorCode, count: p.count }));

    return {
      totalPatterns: patterns.length,
      totalErrors,
      topErrors,
    };
  }

  /**
   * Clear all patterns (for testing)
   */
  clear(): void {
    this.patterns.clear();
  }
}

// Singleton
let errorPatternLearner: ErrorPatternLearner | undefined;

export function getErrorPatternLearner(): ErrorPatternLearner {
  if (!errorPatternLearner) {
    errorPatternLearner = new ErrorPatternLearner();
  }
  return errorPatternLearner;
}
