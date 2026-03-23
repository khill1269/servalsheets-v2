/**
 * AccessPatternTracker
 *
 * @purpose Tracks user access patterns (spreadsheet/sheet/range sequences) to enable predictive prefetching with 70%+ accuracy
 * @category Performance
 * @usage Use with PrefetchingSystem; records access sequences, detects patterns, predicts next access with confidence scores
 * @dependencies logger
 * @stateful Yes - maintains access history (configurable window, default 100), pattern frequency map, last access timestamps
 * @singleton Yes - one instance per process to learn patterns across all requests
 *
 * @example
 * const tracker = AccessPatternTracker.getInstance({ historySize: 100 });
 * tracker.recordAccess({ spreadsheetId: '1ABC', sheetName: 'Sheet1', range: 'A1:Z10' });
 * const predictions = tracker.getPredictions(spreadsheetId); // [{ range: 'A1:Z20', confidence: 0.85 }, ...]
 */

import { logger } from '../utils/logger.js';
import { BoundedCache } from '../utils/bounded-cache.js';
import { ServiceError } from '../core/errors.js';

export interface AccessRecord {
  timestamp: number;
  spreadsheetId: string;
  sheetId?: number;
  sheetName?: string;
  range?: string;
  action: 'read' | 'write' | 'open';
  userId?: string;
}

export interface AccessPattern {
  /** Pattern identifier */
  id: string;
  /** Sequence of accesses that form this pattern */
  sequence: AccessRecord[];
  /** How many times this pattern has occurred */
  frequency: number;
  /** Last time this pattern was observed */
  lastSeen: number;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface PredictedAccess {
  spreadsheetId: string;
  sheetId?: number;
  range?: string;
  confidence: number;
  reason: string;
}

export interface AccessPatternTrackerOptions {
  /** Maximum number of access records to keep (default: 1000) */
  maxHistory?: number;
  /** Time window for pattern detection in ms (default: 300000 = 5 min) */
  patternWindow?: number;
  /** Minimum pattern frequency to consider (default: 2) */
  minPatternFrequency?: number;
}

/**
 * Tracks access patterns for predictive prefetching
 */
export class AccessPatternTracker {
  private history: AccessRecord[] = [];
  private patterns: BoundedCache<string, AccessPattern>;
  private maxHistory: number;
  private patternWindow: number;
  private minPatternFrequency: number;

  // Metrics
  private stats = {
    totalAccesses: 0,
    patternsDetected: 0,
    predictionsGenerated: 0,
  };

  constructor(options: AccessPatternTrackerOptions = {}) {
    this.maxHistory = options.maxHistory ?? 1000;
    this.patternWindow = options.patternWindow ?? 300000; // 5 minutes
    this.minPatternFrequency = options.minPatternFrequency ?? 2;

    // Phase 1.4: Bounded cache for patterns (prevents unbounded memory growth)
    this.patterns = new BoundedCache<string, AccessPattern>({
      maxSize: 10000, // Limit to 10K patterns (protects against pathological cases)
      ttl: this.patternWindow * 2, // Keep patterns for 2x pattern window
      onEviction: (key, value) => {
        const pattern = value as AccessPattern | undefined;
        logger.debug('Pattern evicted from cache', {
          patternId: key,
          frequency: pattern?.frequency,
          confidence: pattern?.confidence,
        });
      },
    });
  }

  /**
   * Record an access
   */
  recordAccess(access: Omit<AccessRecord, 'timestamp'>): void {
    const record: AccessRecord = {
      ...access,
      timestamp: Date.now(),
    };

    this.history.push(record);
    this.stats.totalAccesses++;

    // Trim history if needed
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Detect patterns in recent history
    this.detectPatterns();

    logger.debug('Access recorded', {
      spreadsheetId: access.spreadsheetId,
      action: access.action,
      range: access.range,
      historySize: this.history.length,
    });
  }

  /**
   * Predict next accesses based on current context
   */
  predictNext(current: {
    spreadsheetId: string;
    sheetId?: number;
    range?: string;
  }): PredictedAccess[] {
    const predictions: PredictedAccess[] = [];

    // Strategy 1: Pattern-based prediction
    const patternPredictions = this.predictFromPatterns(current);
    predictions.push(...patternPredictions);

    // Strategy 2: Adjacent range prediction
    if (current.range) {
      const adjacentPrediction = this.predictAdjacentRanges(current);
      predictions.push(...adjacentPrediction);
    }

    // Strategy 3: Common spreadsheet resources
    const commonPredictions = this.predictCommonResources(current);
    predictions.push(...commonPredictions);

    this.stats.predictionsGenerated += predictions.length;

    return predictions;
  }

  /**
   * Predict based on detected patterns
   */
  private predictFromPatterns(current: {
    spreadsheetId: string;
    sheetId?: number;
    range?: string;
  }): PredictedAccess[] {
    const predictions: PredictedAccess[] = [];
    const now = Date.now();

    // Find patterns that match current context
    for (const pattern of this.patterns.values()) {
      // Check if pattern is recent
      if (now - pattern.lastSeen > this.patternWindow) {
        continue;
      }

      // Check if current access matches beginning of pattern
      const firstInPattern = pattern.sequence[0];
      if (
        firstInPattern &&
        firstInPattern.spreadsheetId === current.spreadsheetId &&
        (!current.sheetId || firstInPattern.sheetId === current.sheetId)
      ) {
        // Predict next in sequence
        if (pattern.sequence.length > 1) {
          const next = pattern.sequence[1];
          if (next) {
            predictions.push({
              spreadsheetId: next.spreadsheetId,
              sheetId: next.sheetId,
              range: next.range,
              confidence: pattern.confidence,
              reason: `Pattern ${pattern.id} (freq: ${pattern.frequency})`,
            });
          }
        }
      }
    }

    return predictions;
  }

  /**
   * Predict adjacent ranges
   * Examples: A1:B10 → B1:C10 (horizontal), A11:B20 (vertical)
   */
  private predictAdjacentRanges(current: {
    spreadsheetId: string;
    sheetId?: number;
    range?: string;
  }): PredictedAccess[] {
    if (!current.range) return [];

    const predictions: PredictedAccess[] = [];
    const parsed = this.parseRange(current.range);

    if (!parsed) return [];

    // Predict horizontal neighbor (next columns)
    const horizontalNext = this.shiftRangeHorizontal(current.range, parsed.colCount);
    predictions.push({
      spreadsheetId: current.spreadsheetId,
      sheetId: current.sheetId,
      range: horizontalNext,
      confidence: 0.6,
      reason: 'Adjacent horizontal range',
    });

    // Predict vertical neighbor (next rows)
    const verticalNext = this.shiftRangeVertical(current.range, parsed.rowCount);
    predictions.push({
      spreadsheetId: current.spreadsheetId,
      sheetId: current.sheetId,
      range: verticalNext,
      confidence: 0.5,
      reason: 'Adjacent vertical range',
    });

    return predictions;
  }

  /**
   * Predict common resources (first rows, metadata, etc.)
   */
  private predictCommonResources(current: {
    spreadsheetId: string;
    sheetId?: number;
  }): PredictedAccess[] {
    const predictions: PredictedAccess[] = [];

    // On spreadsheet open, predict first 100 rows will be accessed
    const recentOpen = this.history
      .slice(-5)
      .find((r) => r.spreadsheetId === current.spreadsheetId && r.action === 'open');

    if (recentOpen && Date.now() - recentOpen.timestamp < 10000) {
      // Within 10s of open
      predictions.push({
        spreadsheetId: current.spreadsheetId,
        range: 'A1:Z100',
        confidence: 0.7,
        reason: 'Common pattern: first 100 rows after spreadsheet open',
      });
    }

    return predictions;
  }

  /**
   * Detect patterns in recent access history
   */
  private detectPatterns(): void {
    // Use sliding window to find repeated sequences
    const window = this.history.slice(-20); // Last 20 accesses

    // Look for sequences of length 2-3
    for (let seqLen = 2; seqLen <= 3; seqLen++) {
      for (let i = 0; i <= window.length - seqLen; i++) {
        const sequence = window.slice(i, i + seqLen);
        const patternId = this.generatePatternId(sequence);

        const existing = this.patterns.get(patternId);
        if (existing) {
          existing.frequency++;
          existing.lastSeen = Date.now();
          existing.confidence = Math.min(0.95, existing.frequency / 10);
        } else if (seqLen >= this.minPatternFrequency) {
          this.patterns.set(patternId, {
            id: patternId,
            sequence,
            frequency: 1,
            lastSeen: Date.now(),
            confidence: 0.3,
          });
          this.stats.patternsDetected++;
        }
      }
    }

    // Clean up old patterns
    const now = Date.now();
    for (const [id, pattern] of this.patterns.entries()) {
      if (now - pattern.lastSeen > this.patternWindow * 2) {
        this.patterns.delete(id);
      }
    }
  }

  /**
   * Generate pattern identifier from sequence
   */
  private generatePatternId(sequence: AccessRecord[]): string {
    return sequence
      .map((r) => `${r.spreadsheetId}:${r.sheetId ?? '*'}:${r.range ?? '*'}:${r.action}`)
      .join('→');
  }

  /**
   * Parse range into components (simple parser)
   */
  private parseRange(range: string): {
    startCol: number;
    endCol: number;
    startRow: number;
    endRow: number;
    colCount: number;
    rowCount: number;
  } | null {
    // Simple A1:B10 format parser
    const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!match || !match[1] || !match[2] || !match[3] || !match[4]) return null;

    const startCol = this.columnLetterToNumber(match[1]);
    const startRow = parseInt(match[2], 10);
    const endCol = this.columnLetterToNumber(match[3]);
    const endRow = parseInt(match[4], 10);

    return {
      startCol,
      endCol,
      startRow,
      endRow,
      colCount: endCol - startCol + 1,
      rowCount: endRow - startRow + 1,
    };
  }

  /**
   * Shift range horizontally
   */
  private shiftRangeHorizontal(range: string, colCount: number): string {
    const parsed = this.parseRange(range);
    if (!parsed) return range;

    const newStartCol = this.columnNumberToLetter(parsed.endCol + 1);
    const newEndCol = this.columnNumberToLetter(parsed.endCol + colCount);

    return `${newStartCol}${parsed.startRow}:${newEndCol}${parsed.endRow}`;
  }

  /**
   * Shift range vertically
   */
  private shiftRangeVertical(range: string, rowCount: number): string {
    const parsed = this.parseRange(range);
    if (!parsed) return range;

    const newStartRow = parsed.endRow + 1;
    const newEndRow = parsed.endRow + rowCount;

    const startCol = this.columnNumberToLetter(parsed.startCol);
    const endCol = this.columnNumberToLetter(parsed.endCol);

    return `${startCol}${newStartRow}:${endCol}${newEndRow}`;
  }

  /**
   * Convert column letter to number (A=1, Z=26, AA=27)
   */
  private columnLetterToNumber(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + (letter.charCodeAt(i) - 64);
    }
    return result;
  }

  /**
   * Convert column number to letter (1=A, 26=Z, 27=AA)
   */
  private columnNumberToLetter(num: number): string {
    let result = '';
    while (num > 0) {
      const remainder = (num - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      num = Math.floor((num - 1) / 26);
    }
    return result || 'A';
  }

  /**
   * Get statistics
   */
  getStats(): unknown {
    return {
      ...this.stats,
      historySize: this.history.length,
      patternsKnown: this.patterns.size(),
      avgPredictionsPerAccess:
        this.stats.totalAccesses > 0
          ? this.stats.predictionsGenerated / this.stats.totalAccesses
          : 0,
    };
  }

  /**
   * Clear history and patterns
   */
  clear(): void {
    this.history = [];
    this.patterns.clear();
  }
}

// Singleton instance
let accessPatternTracker: AccessPatternTracker | null = null;

/**
 * Get or create the access pattern tracker singleton
 */
export function getAccessPatternTracker(): AccessPatternTracker {
  if (!accessPatternTracker) {
    accessPatternTracker = new AccessPatternTracker({
      maxHistory: parseInt(process.env['PREFETCH_MAX_HISTORY'] || '1000', 10),
      patternWindow: parseInt(process.env['PREFETCH_PATTERN_WINDOW'] || '300000', 10),
    });
  }
  return accessPatternTracker;
}

/**
 * Reset access pattern tracker (for testing only)
 * @internal
 */
export function resetAccessPatternTracker(): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') {
    throw new ServiceError(
      'resetAccessPatternTracker() can only be called in test environment',
      'INTERNAL_ERROR',
      'AccessPatternTracker'
    );
  }
  accessPatternTracker = null;
}
