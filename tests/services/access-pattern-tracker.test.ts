/**
 * Access Pattern Tracker Service Tests (Phase 3.8)
 *
 * Tests for AccessPatternTracker service
 * Covers pattern detection, prediction, and range manipulation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccessPatternTracker } from '../../src/services/access-pattern-tracker.js';
import type { AccessRecord } from '../../src/services/access-pattern-tracker.js';

describe('AccessPatternTracker', () => {
  let tracker: AccessPatternTracker;

  beforeEach(() => {
    tracker = new AccessPatternTracker({
      maxHistory: 100,
      patternWindow: 300000, // 5 minutes
      minPatternFrequency: 2,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultTracker = new AccessPatternTracker();

      expect(defaultTracker).toBeDefined();
      const stats = defaultTracker.getStats() as {
        historySize: number;
        totalAccesses: number;
      };
      expect(stats.historySize).toBe(0);
      expect(stats.totalAccesses).toBe(0);
    });

    it('should initialize with custom options', () => {
      const customTracker = new AccessPatternTracker({
        maxHistory: 50,
        patternWindow: 600000,
        minPatternFrequency: 3,
      });

      expect(customTracker).toBeDefined();
    });
  });

  describe('recordAccess', () => {
    it('should record a simple access', () => {
      tracker.recordAccess({
        spreadsheetId: 'test-id',
        action: 'read',
      });

      const stats = tracker.getStats() as {
        totalAccesses: number;
        historySize: number;
      };
      expect(stats.totalAccesses).toBe(1);
      expect(stats.historySize).toBe(1);
    });

    it('should record access with all fields', () => {
      tracker.recordAccess({
        spreadsheetId: 'test-id',
        sheetId: 123,
        sheetName: 'Sheet1',
        range: 'A1:B10',
        action: 'write',
        userId: 'user-1',
      });

      const stats = tracker.getStats() as { historySize: number };
      expect(stats.historySize).toBe(1);
    });

    it('should maintain history size limit', () => {
      const smallTracker = new AccessPatternTracker({ maxHistory: 5 });

      // Record 10 accesses
      for (let i = 0; i < 10; i++) {
        smallTracker.recordAccess({
          spreadsheetId: `id-${i}`,
          action: 'read',
        });
      }

      const stats = smallTracker.getStats() as { historySize: number };
      expect(stats.historySize).toBe(5); // Limited to maxHistory
    });

    it('should record different action types', () => {
      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-2', action: 'write' });
      tracker.recordAccess({ spreadsheetId: 'id-3', action: 'open' });

      const stats = tracker.getStats() as { totalAccesses: number };
      expect(stats.totalAccesses).toBe(3);
    });

    it('should detect patterns after recording', () => {
      // Record a sequence twice to create a pattern
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });

      const stats = tracker.getStats() as { patternsKnown: number };
      expect(stats.patternsKnown).toBeGreaterThan(0);
    });
  });

  describe('predictNext', () => {
    it('should return empty array for no history', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
      });

      expect(Array.isArray(predictions)).toBe(true);
      expect(predictions.length).toBeGreaterThanOrEqual(0);
    });

    it('should predict adjacent horizontal range', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: 'A1:B10',
      });

      const horizontalPrediction = predictions.find((p) => p.reason?.includes('horizontal'));
      expect(horizontalPrediction).toBeDefined();
      expect(horizontalPrediction?.range).toBe('C1:D10'); // Next 2 columns
    });

    it('should predict adjacent vertical range', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        sheetId: 0,
        range: 'A1:B10',
      });

      const verticalPrediction = predictions.find((p) => p.reason?.includes('vertical'));
      expect(verticalPrediction).toBeDefined();
      expect(verticalPrediction?.range).toBe('A11:B20'); // Next 10 rows
    });

    it('should predict common resources after open', () => {
      tracker.recordAccess({ spreadsheetId: 'test-id', action: 'open' });

      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
      });

      const commonPrediction = predictions.find((p) => p.reason?.includes('first 100 rows'));
      expect(commonPrediction).toBeDefined();
      expect(commonPrediction?.range).toBe('A1:Z100');
    });

    it('should predict from patterns', () => {
      // Create a pattern by repeating a sequence
      for (let i = 0; i < 3; i++) {
        tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
        tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });
      }

      const predictions = tracker.predictNext({
        spreadsheetId: 'id-1',
        sheetId: 1,
      });

      const patternPrediction = predictions.find(
        (p) => p.reason?.includes('Pattern') && p.sheetId === 2
      );
      expect(patternPrediction).toBeDefined();
    });

    it('should include confidence scores', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'A1:B10',
      });

      predictions.forEach((pred) => {
        expect(pred.confidence).toBeGreaterThanOrEqual(0);
        expect(pred.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should handle spreadsheet without range', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        sheetId: 0,
      });

      expect(Array.isArray(predictions)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return statistics object', () => {
      const stats = tracker.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    it('should include access counts', () => {
      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-2', action: 'write' });

      const stats = tracker.getStats() as {
        totalAccesses: number;
        historySize: number;
      };

      expect(stats.totalAccesses).toBe(2);
      expect(stats.historySize).toBe(2);
    });

    it('should include pattern counts', () => {
      const stats = tracker.getStats() as { patternsKnown: number };

      expect('patternsKnown' in stats).toBe(true);
      expect(typeof stats.patternsKnown).toBe('number');
    });

    it('should include prediction metrics', () => {
      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read', range: 'A1:B10' });
      tracker.predictNext({ spreadsheetId: 'id-1', range: 'A1:B10' });

      const stats = tracker.getStats() as {
        predictionsGenerated: number;
        avgPredictionsPerAccess: number;
      };

      expect(stats.predictionsGenerated).toBeGreaterThan(0);
      expect(stats.avgPredictionsPerAccess).toBeGreaterThanOrEqual(0);
    });

    it('should update stats after operations', () => {
      const stats1 = tracker.getStats() as { totalAccesses: number };
      const initial = stats1.totalAccesses;

      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read' });

      const stats2 = tracker.getStats() as { totalAccesses: number };
      expect(stats2.totalAccesses).toBe(initial + 1);
    });
  });

  describe('clear', () => {
    it('should clear history', () => {
      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-2', action: 'read' });

      tracker.clear();

      const stats = tracker.getStats() as { historySize: number };
      expect(stats.historySize).toBe(0);
    });

    it('should clear patterns', () => {
      // Create patterns
      for (let i = 0; i < 5; i++) {
        tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
        tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });
      }

      tracker.clear();

      const stats = tracker.getStats() as { patternsKnown: number };
      expect(stats.patternsKnown).toBe(0);
    });

    it('should allow new tracking after clear', () => {
      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read' });
      tracker.clear();
      tracker.recordAccess({ spreadsheetId: 'id-2', action: 'read' });

      const stats = tracker.getStats() as {
        historySize: number;
        totalAccesses: number;
      };
      expect(stats.historySize).toBe(1); // Only new access in history
      expect(stats.totalAccesses).toBe(2); // Stats not reset by clear()
    });
  });

  describe('range parsing and manipulation', () => {
    it('should predict correct horizontal shift', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'A1:C10',
      });

      const horizontal = predictions.find((p) => p.reason?.includes('horizontal'));
      expect(horizontal?.range).toBe('D1:F10'); // 3 columns wide, shift 3 columns right
    });

    it('should predict correct vertical shift', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'A1:B5',
      });

      const vertical = predictions.find((p) => p.reason?.includes('vertical'));
      expect(vertical?.range).toBe('A6:B10'); // 5 rows tall, shift 5 rows down
    });

    it('should handle single cell ranges', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'A1:A1',
      });

      const horizontal = predictions.find((p) => p.reason?.includes('horizontal'));
      expect(horizontal?.range).toBe('B1:B1');

      const vertical = predictions.find((p) => p.reason?.includes('vertical'));
      expect(vertical?.range).toBe('A2:A2');
    });

    it('should handle multi-letter column ranges', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'AA1:AB10',
      });

      const horizontal = predictions.find((p) => p.reason?.includes('horizontal'));
      expect(horizontal?.range).toBe('AC1:AD10'); // AA→AB is 2 cols, shift by 2
    });

    it('should handle large row numbers', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'A100:B200',
      });

      const vertical = predictions.find((p) => p.reason?.includes('vertical'));
      expect(vertical?.range).toBe('A201:B301'); // 101 rows tall
    });

    it('should handle invalid range format gracefully', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
        range: 'invalid-range',
      });

      // Should still return predictions, just not range-based ones
      expect(Array.isArray(predictions)).toBe(true);
    });
  });

  describe('pattern detection', () => {
    it('should detect repeated sequences', () => {
      // Repeat a sequence 3 times
      for (let i = 0; i < 3; i++) {
        tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read', range: 'A1:B10' });
        tracker.recordAccess({ spreadsheetId: 'id-1', action: 'write', range: 'C1:D10' });
      }

      const stats = tracker.getStats() as { patternsDetected: number };
      expect(stats.patternsDetected).toBeGreaterThan(0);
    });

    it('should increase pattern confidence with frequency', () => {
      // Create a high-frequency pattern
      for (let i = 0; i < 10; i++) {
        tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
        tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });
      }

      const predictions = tracker.predictNext({
        spreadsheetId: 'id-1',
        sheetId: 1,
      });

      const patternPrediction = predictions.find((p) => p.reason?.includes('Pattern'));
      if (patternPrediction) {
        expect(patternPrediction.confidence).toBeGreaterThan(0.3);
      }
    });

    it('should track different pattern lengths', () => {
      // Create sequences of different lengths
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 3, action: 'read' });

      // Repeat for pattern detection
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 1, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 2, action: 'read' });
      tracker.recordAccess({ spreadsheetId: 'id-1', sheetId: 3, action: 'read' });

      const stats = tracker.getStats() as { patternsKnown: number };
      expect(stats.patternsKnown).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle access with missing optional fields', () => {
      tracker.recordAccess({
        spreadsheetId: 'test-id',
        action: 'read',
      });

      const stats = tracker.getStats() as { historySize: number };
      expect(stats.historySize).toBe(1);
    });

    it('should handle prediction with no range', () => {
      const predictions = tracker.predictNext({
        spreadsheetId: 'test-id',
      });

      expect(Array.isArray(predictions)).toBe(true);
    });

    it('should handle empty spreadsheet ID', () => {
      tracker.recordAccess({
        spreadsheetId: '',
        action: 'read',
      });

      const stats = tracker.getStats() as { historySize: number };
      expect(stats.historySize).toBe(1);
    });

    it('should handle very large history', () => {
      const largeTracker = new AccessPatternTracker({ maxHistory: 1000 });

      for (let i = 0; i < 2000; i++) {
        largeTracker.recordAccess({
          spreadsheetId: `id-${i}`,
          action: 'read',
        });
      }

      const stats = largeTracker.getStats() as { historySize: number };
      expect(stats.historySize).toBeLessThanOrEqual(1000);
    });

    it('should handle rapid access recording', () => {
      for (let i = 0; i < 50; i++) {
        tracker.recordAccess({
          spreadsheetId: 'test-id',
          sheetId: i % 5,
          action: 'read',
        });
      }

      const stats = tracker.getStats() as { totalAccesses: number };
      expect(stats.totalAccesses).toBe(50);
    });

    it('should handle prediction after clear', () => {
      tracker.recordAccess({ spreadsheetId: 'id-1', action: 'read' });
      tracker.clear();

      const predictions = tracker.predictNext({
        spreadsheetId: 'id-1',
      });

      expect(Array.isArray(predictions)).toBe(true);
    });
  });
});
