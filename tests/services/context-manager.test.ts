/**
 * Context Manager Service Tests (Phase 3.7)
 *
 * Tests for ContextManager service
 * Covers parameter inference, context tracking, and TTL expiry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../../src/services/context-manager.js';

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager({
      verboseLogging: false,
      contextTTL: 3600000, // 1 hour
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultManager = new ContextManager();

      expect(defaultManager).toBeDefined();
      const stats = defaultManager.getStats() as {
        totalInferences: number;
        contextUpdates: number;
      };
      expect(stats.totalInferences).toBe(0);
      expect(stats.contextUpdates).toBe(0);
    });

    it('should initialize with custom options', () => {
      const customManager = new ContextManager({
        verboseLogging: true,
        contextTTL: 1800000, // 30 minutes
      });

      expect(customManager).toBeDefined();
    });
  });

  describe('updateContext', () => {
    it('should update spreadsheetId', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const context = manager.getContext();
      expect(context.spreadsheetId).toBe('test-id');
      expect(context.lastUpdated).toBeDefined();
    });

    it('should update sheetId', () => {
      manager.updateContext({ sheetId: 123 });

      const context = manager.getContext();
      expect(context.sheetId).toBe(123);
    });

    it('should update range', () => {
      manager.updateContext({ range: 'Sheet1!A1:Z10' });

      const context = manager.getContext();
      expect(context.range).toBe('Sheet1!A1:Z10');
    });

    it('should update sheetName', () => {
      manager.updateContext({ sheetName: 'DataSheet' });

      const context = manager.getContext();
      expect(context.sheetName).toBe('DataSheet');
    });

    it('should update multiple values at once', () => {
      manager.updateContext({
        spreadsheetId: 'test-id',
        sheetId: 456,
        range: 'Sheet1!A1:B10',
        sheetName: 'Sheet1',
      });

      const context = manager.getContext();
      expect(context.spreadsheetId).toBe('test-id');
      expect(context.sheetId).toBe(456);
      expect(context.range).toBe('Sheet1!A1:B10');
      expect(context.sheetName).toBe('Sheet1');
    });

    it('should track requestId', () => {
      manager.updateContext({ spreadsheetId: 'test-id' }, 'req-123');

      const context = manager.getContext();
      expect(context.requestId).toBe('req-123');
    });

    it('should increment context update counter', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });
      manager.updateContext({ sheetId: 123 });

      const stats = manager.getStats() as { contextUpdates: number };
      expect(stats.contextUpdates).toBe(2);
    });

    it('should preserve existing values when updating partial context', () => {
      manager.updateContext({ spreadsheetId: 'test-id', sheetId: 123 });
      manager.updateContext({ range: 'Sheet1!A1:B10' });

      const context = manager.getContext();
      expect(context.spreadsheetId).toBe('test-id');
      expect(context.sheetId).toBe(123);
      expect(context.range).toBe('Sheet1!A1:B10');
    });
  });

  describe('inferParameters', () => {
    it('should infer spreadsheetId', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const params = manager.inferParameters({ action: 'read' });

      expect(params.spreadsheetId).toBe('test-id');
      const stats = manager.getStats() as { spreadsheetIdInferences: number };
      expect(stats.spreadsheetIdInferences).toBe(1);
    });

    it('should infer sheetId', () => {
      manager.updateContext({ sheetId: 456 });

      const params = manager.inferParameters({ action: 'write' });

      expect(params.sheetId).toBe(456);
      const stats = manager.getStats() as { sheetIdInferences: number };
      expect(stats.sheetIdInferences).toBe(1);
    });

    it('should infer range', () => {
      manager.updateContext({ range: 'Sheet1!A1:Z10' });

      const params = manager.inferParameters({ action: 'read' });

      expect(params.range).toBe('Sheet1!A1:Z10');
      const stats = manager.getStats() as { rangeInferences: number };
      expect(stats.rangeInferences).toBe(1);
    });

    it('should not override provided parameters', () => {
      manager.updateContext({ spreadsheetId: 'old-id', sheetId: 123 });

      const params = manager.inferParameters({
        spreadsheetId: 'new-id',
        action: 'read',
      });

      expect(params.spreadsheetId).toBe('new-id');
      expect(params.sheetId).toBe(123); // Inferred
    });

    it('should infer multiple parameters', () => {
      manager.updateContext({
        spreadsheetId: 'test-id',
        sheetId: 789,
        range: 'Sheet1!A1:B10',
      });

      const params = manager.inferParameters({ action: 'write' });

      expect(params.spreadsheetId).toBe('test-id');
      expect(params.sheetId).toBe(789);
      expect(params.range).toBe('Sheet1!A1:B10');

      const stats = manager.getStats() as { totalInferences: number };
      expect(stats.totalInferences).toBe(3);
    });

    it('should not infer from stale context', () => {
      // Create manager with very short TTL
      const shortTTL = new ContextManager({ contextTTL: 100 }); // 100ms

      shortTTL.updateContext({ spreadsheetId: 'test-id' });

      // Wait for context to become stale
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const params = shortTTL.inferParameters({ action: 'read' });
          expect(params.spreadsheetId).toBeUndefined();
          resolve();
        }, 150);
      });
    });

    it('should preserve original parameter types', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const params = manager.inferParameters({
        action: 'write',
        values: [[1, 2, 3]],
      });

      expect(Array.isArray(params.values)).toBe(true);
      expect(params.values[0]).toEqual([1, 2, 3]);
    });
  });

  describe('getContext', () => {
    it('should return empty context initially', () => {
      const context = manager.getContext();

      expect(context.spreadsheetId).toBeUndefined();
      expect(context.sheetId).toBeUndefined();
      expect(context.range).toBeUndefined();
    });

    it('should return copy of context', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const context1 = manager.getContext();
      const context2 = manager.getContext();

      expect(context1).not.toBe(context2); // Different objects
      expect(context1).toEqual(context2); // Same content
    });

    it('should not allow external modification', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const context = manager.getContext();
      context.spreadsheetId = 'modified-id';

      const freshContext = manager.getContext();
      expect(freshContext.spreadsheetId).toBe('test-id'); // Unchanged
    });
  });

  describe('isContextStale', () => {
    it('should return true for empty context', () => {
      expect(manager.isContextStale()).toBe(true);
    });

    it('should return false for fresh context', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      expect(manager.isContextStale()).toBe(false);
    });

    it('should return true after TTL expiry', () => {
      const shortTTL = new ContextManager({ contextTTL: 100 }); // 100ms

      shortTTL.updateContext({ spreadsheetId: 'test-id' });

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(shortTTL.isContextStale()).toBe(true);
          resolve();
        }, 150);
      });
    });
  });

  describe('reset', () => {
    it('should clear all context values', () => {
      manager.updateContext({
        spreadsheetId: 'test-id',
        sheetId: 123,
        range: 'Sheet1!A1:B10',
      });

      manager.reset();

      const context = manager.getContext();
      expect(context.spreadsheetId).toBeUndefined();
      expect(context.sheetId).toBeUndefined();
      expect(context.range).toBeUndefined();
    });

    it('should allow new context after reset', () => {
      manager.updateContext({ spreadsheetId: 'old-id' });
      manager.reset();
      manager.updateContext({ spreadsheetId: 'new-id' });

      const context = manager.getContext();
      expect(context.spreadsheetId).toBe('new-id');
    });
  });

  describe('getStats', () => {
    it('should return statistics object', () => {
      const stats = manager.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    it('should include inference counts', () => {
      manager.updateContext({ spreadsheetId: 'test-id', sheetId: 123 });
      manager.inferParameters({ action: 'read' });

      const stats = manager.getStats() as {
        totalInferences: number;
        spreadsheetIdInferences: number;
        sheetIdInferences: number;
      };

      expect(stats.totalInferences).toBe(2);
      expect(stats.spreadsheetIdInferences).toBe(1);
      expect(stats.sheetIdInferences).toBe(1);
    });

    it('should include context age', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const stats = manager.getStats() as { contextAge: number };

      expect(stats.contextAge).toBeDefined();
      expect(typeof stats.contextAge).toBe('number');
      expect(stats.contextAge).toBeGreaterThanOrEqual(0);
    });

    it('should include current context', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const stats = manager.getStats() as {
        currentContext: { spreadsheetId?: string };
      };

      expect(stats.currentContext).toBeDefined();
      expect(stats.currentContext.spreadsheetId).toBe('test-id');
    });

    it('should include inference rate', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });
      manager.inferParameters({ action: 'read' });

      const stats = manager.getStats() as { inferenceRate: number };

      expect(stats.inferenceRate).toBeDefined();
      expect(typeof stats.inferenceRate).toBe('number');
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });
      manager.inferParameters({ action: 'read' });

      manager.resetStats();

      const stats = manager.getStats() as {
        totalInferences: number;
        contextUpdates: number;
      };
      expect(stats.totalInferences).toBe(0);
      expect(stats.contextUpdates).toBe(0);
    });

    it('should not affect context', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });
      manager.resetStats();

      const context = manager.getContext();
      expect(context.spreadsheetId).toBe('test-id');
    });
  });

  describe('canInfer', () => {
    it('should return true for available parameter', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      expect(manager.canInfer('spreadsheetId')).toBe(true);
    });

    it('should return false for unavailable parameter', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      expect(manager.canInfer('sheetId')).toBe(false);
    });

    it('should return false for stale context', () => {
      const shortTTL = new ContextManager({ contextTTL: 100 }); // 100ms

      shortTTL.updateContext({ spreadsheetId: 'test-id' });

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(shortTTL.canInfer('spreadsheetId')).toBe(false);
          resolve();
        }, 150);
      });
    });
  });

  describe('getInferredValue', () => {
    it('should return value for available parameter', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      expect(manager.getInferredValue('spreadsheetId')).toBe('test-id');
    });

    it('should return undefined for unavailable parameter', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      expect(manager.getInferredValue('sheetId')).toBeUndefined();
    });

    it('should return undefined for stale context', () => {
      const shortTTL = new ContextManager({ contextTTL: 100 }); // 100ms

      shortTTL.updateContext({ spreadsheetId: 'test-id' });

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(shortTTL.getInferredValue('spreadsheetId')).toBeUndefined();
          resolve();
        }, 150);
      });
    });

    it('should return numeric values correctly', () => {
      manager.updateContext({ sheetId: 789 });

      expect(manager.getInferredValue('sheetId')).toBe(789);
      expect(typeof manager.getInferredValue('sheetId')).toBe('number');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined values in updateContext', () => {
      manager.updateContext({ spreadsheetId: undefined });

      const context = manager.getContext();
      expect('spreadsheetId' in context).toBe(false);
    });

    it('should handle empty object in updateContext', () => {
      manager.updateContext({});

      const stats = manager.getStats() as { contextUpdates: number };
      expect(stats.contextUpdates).toBe(1);
    });

    it('should handle inferParameters with empty object', () => {
      manager.updateContext({ spreadsheetId: 'test-id' });

      const params = manager.inferParameters({});

      expect(params.spreadsheetId).toBe('test-id');
    });

    it('should handle multiple updates to same parameter', () => {
      manager.updateContext({ spreadsheetId: 'id-1' });
      manager.updateContext({ spreadsheetId: 'id-2' });
      manager.updateContext({ spreadsheetId: 'id-3' });

      const context = manager.getContext();
      expect(context.spreadsheetId).toBe('id-3');
    });

    it('should handle sheetId value of 0', () => {
      manager.updateContext({ sheetId: 0 });

      const params = manager.inferParameters({ action: 'read' });
      expect(params.sheetId).toBe(0);
    });
  });
});
