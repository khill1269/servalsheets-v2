/**
 * Tests for ErrorPatternLearner
 * Covers: recordError, recordResolution, getPatterns, suggestPrevention, suggestFix
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorPatternLearner } from '../../src/services/error-pattern-learner.js';

describe('ErrorPatternLearner', () => {
  let learner: ErrorPatternLearner;

  beforeEach(() => {
    learner = new ErrorPatternLearner();
  });

  // ============================================================
  // getPatterns() — new method
  // ============================================================

  describe('getPatterns()', () => {
    it('returns null when no patterns exist for the error code', () => {
      const result = learner.getPatterns('SHEET_NOT_FOUND', {});
      expect(result).toBeNull();
    });

    it('returns null when fewer than 3 occurrences exist', () => {
      learner.recordError('SHEET_NOT_FOUND', 'Sheet not found', { tool: 'sheets_core' });
      learner.recordError('SHEET_NOT_FOUND', 'Sheet not found', { tool: 'sheets_core' });

      const result = learner.getPatterns('SHEET_NOT_FOUND', { tool: 'sheets_core' });
      expect(result).toBeNull();
    });

    it('returns topResolution: null when >= 3 occurrences but no resolutions recorded', () => {
      learner.recordError('SHEET_NOT_FOUND', 'Sheet not found', { tool: 'sheets_core' });
      learner.recordError('SHEET_NOT_FOUND', 'Sheet not found', { tool: 'sheets_core' });
      learner.recordError('SHEET_NOT_FOUND', 'Sheet not found', { tool: 'sheets_core' });

      const result = learner.getPatterns('SHEET_NOT_FOUND', { tool: 'sheets_core' });
      expect(result).not.toBeNull();
      expect(result!.topResolution).toBeNull();
    });

    it('returns topResolution when >= 3 occurrences and a resolution is recorded', () => {
      learner.recordError('RATE_LIMITED', 'Rate limit exceeded', { tool: 'sheets_data' });
      learner.recordError('RATE_LIMITED', 'Rate limit exceeded', { tool: 'sheets_data' });
      learner.recordError('RATE_LIMITED', 'Rate limit exceeded', { tool: 'sheets_data' });
      learner.recordResolution('RATE_LIMITED', { tool: 'sheets_data' }, 'Wait 60 seconds and retry', 5000);

      const result = learner.getPatterns('RATE_LIMITED', { tool: 'sheets_data' });
      expect(result).not.toBeNull();
      expect(result!.topResolution).not.toBeNull();
      expect(result!.topResolution!.fix).toBe('Wait 60 seconds and retry');
      expect(result!.topResolution!.successRate).toBeGreaterThan(0);
      expect(result!.topResolution!.occurrenceCount).toBe(3);
    });

    it('returns the resolution with highest success rate as topResolution', () => {
      const ctx = { tool: 'sheets_core', action: 'write' };
      for (let i = 0; i < 3; i++) {
        learner.recordError('PERMISSION_DENIED', 'No access', ctx);
      }
      learner.recordResolution('PERMISSION_DENIED', ctx, 'Check OAuth scopes', 2000);
      learner.recordResolution('PERMISSION_DENIED', ctx, 'Request access from owner', 1000);
      // Record second resolution multiple times to increase its rate
      learner.recordResolution('PERMISSION_DENIED', ctx, 'Request access from owner', 1000);

      const result = learner.getPatterns('PERMISSION_DENIED', ctx);
      expect(result).not.toBeNull();
      // topResolution should be the one with highest successRate
      expect(result!.topResolution).not.toBeNull();
      expect(typeof result!.topResolution!.fix).toBe('string');
    });

    it('filters by tool context — different tools have separate patterns', () => {
      // Record 3 errors for tool A
      learner.recordError('INVALID_RANGE', 'Bad range', { tool: 'sheets_data', action: 'read' });
      learner.recordError('INVALID_RANGE', 'Bad range', { tool: 'sheets_data', action: 'read' });
      learner.recordError('INVALID_RANGE', 'Bad range', { tool: 'sheets_data', action: 'read' });

      // Only 2 errors for tool B (different context key)
      learner.recordError('INVALID_RANGE', 'Bad range', { tool: 'sheets_format', action: 'set_format' });
      learner.recordError('INVALID_RANGE', 'Bad range', { tool: 'sheets_format', action: 'set_format' });

      const resultA = learner.getPatterns('INVALID_RANGE', { tool: 'sheets_data', action: 'read' });
      const resultB = learner.getPatterns('INVALID_RANGE', { tool: 'sheets_format', action: 'set_format' });

      expect(resultA).not.toBeNull();
      expect(resultB).toBeNull(); // only 2 occurrences
    });

    it('context uses wildcard when action is omitted — key matches tool only', () => {
      // Key: RATE_LIMITED:sheets_data:*
      learner.recordError('RATE_LIMITED', 'Rate exceeded', { tool: 'sheets_data' });
      learner.recordError('RATE_LIMITED', 'Rate exceeded', { tool: 'sheets_data' });
      learner.recordError('RATE_LIMITED', 'Rate exceeded', { tool: 'sheets_data' });

      // Looking up without action should match
      const result = learner.getPatterns('RATE_LIMITED', { tool: 'sheets_data' });
      expect(result).not.toBeNull();
      expect(result!.topResolution).toBeNull(); // no resolution recorded
    });
  });

  // ============================================================
  // Existing methods (regression tests)
  // ============================================================

  describe('recordError()', () => {
    it('increments count on duplicate errors', () => {
      learner.recordError('SHEET_NOT_FOUND', 'Not found', { tool: 'sheets_core' });
      learner.recordError('SHEET_NOT_FOUND', 'Not found', { tool: 'sheets_core' });
      const stats = learner.getStats();
      expect(stats.totalErrors).toBe(2);
    });
  });

  describe('suggestFix()', () => {
    it('returns null when no pattern exists', () => {
      const result = learner.suggestFix('UNKNOWN_CODE', {});
      expect(result).toBeNull();
    });

    it('returns best resolution when resolutions exist', () => {
      learner.recordError('RATE_LIMITED', 'Rate exceeded', { tool: 'sheets_data' });
      learner.recordResolution('RATE_LIMITED', { tool: 'sheets_data' }, 'Wait and retry', 3000);

      const result = learner.suggestFix('RATE_LIMITED', { tool: 'sheets_data' });
      expect(result).not.toBeNull();
      expect(result!.fix).toBe('Wait and retry');
    });
  });

  describe('suggestPrevention()', () => {
    it('returns empty array when no patterns', () => {
      const results = learner.suggestPrevention();
      expect(results).toEqual([]);
    });

    it('returns suggestions for frequent errors', () => {
      for (let i = 0; i < 5; i++) {
        learner.recordError('SPREADSHEET_NOT_FOUND', 'Not found', { tool: 'sheets_core' });
      }
      const results = learner.suggestPrevention({ tool: 'sheets_core' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].message).toContain('SPREADSHEET_NOT_FOUND');
    });
  });

  describe('clear()', () => {
    it('removes all patterns', () => {
      learner.recordError('RATE_LIMITED', 'Rate exceeded', { tool: 'sheets_data' });
      learner.clear();
      const stats = learner.getStats();
      expect(stats.totalPatterns).toBe(0);
    });
  });
});
