/**
 * ContextManager Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from '../../src/services/context-manager.js';

type TestParams = {
  action?: string;
  spreadsheetId?: string;
  sheetId?: number;
  range?: string;
};

type StatsSnapshot = {
  totalInferences: number;
  spreadsheetIdInferences: number;
  sheetIdInferences: number;
  rangeInferences: number;
  contextUpdates: number;
  inferenceRate: number;
};

describe('ContextManager', () => {
  let contextManager: ContextManager;

  beforeEach(() => {
    contextManager = new ContextManager({
      verboseLogging: false,
      contextTTL: 60000, // 1 minute for testing
    });
  });

  describe('updateContext', () => {
    it('should update context with new values', () => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        sheetId: 0,
        range: 'A1:B10',
      });

      const context = contextManager.getContext();

      expect(context.spreadsheetId).toBe('sheet123');
      expect(context.sheetId).toBe(0);
      expect(context.range).toBe('A1:B10');
      expect(context.lastUpdated).toBeDefined();
    });

    it('should update only provided values', () => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
      });

      contextManager.updateContext({
        sheetId: 5,
      });

      const context = contextManager.getContext();

      expect(context.spreadsheetId).toBe('sheet123');
      expect(context.sheetId).toBe(5);
    });

    it('should track request ID', () => {
      contextManager.updateContext({ spreadsheetId: 'sheet123' }, 'req_123');

      const context = contextManager.getContext();

      expect(context.requestId).toBe('req_123');
    });
  });

  describe('inferParameters', () => {
    beforeEach(() => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        sheetId: 0,
        range: 'A1:B10',
      });
    });

    it('should infer missing spreadsheetId', () => {
      const params: TestParams = { action: 'read' };
      const inferred = contextManager.inferParameters(params);

      expect(inferred.spreadsheetId).toBe('sheet123');
      expect(inferred.action).toBe('read');
    });

    it('should infer missing sheetId', () => {
      const params: TestParams = { action: 'update_sheet', spreadsheetId: 'sheet123' };
      const inferred = contextManager.inferParameters(params);

      expect(inferred.sheetId).toBe(0);
    });

    it('should infer missing range', () => {
      const params: TestParams = { action: 'write', spreadsheetId: 'sheet123' };
      const inferred = contextManager.inferParameters(params);

      expect(inferred.range).toBe('A1:B10');
    });

    it('should not override provided values', () => {
      const params: TestParams = {
        spreadsheetId: 'different123',
        sheetId: 5,
        range: 'C1:D20',
      };

      const inferred = contextManager.inferParameters(params);

      expect(inferred.spreadsheetId).toBe('different123');
      expect(inferred.sheetId).toBe(5);
      expect(inferred.range).toBe('C1:D20');
    });

    it('should infer multiple missing parameters', () => {
      const params: TestParams = { action: 'read' };
      const inferred = contextManager.inferParameters(params);

      expect(inferred.spreadsheetId).toBe('sheet123');
      expect(inferred.sheetId).toBe(0);
      expect(inferred.range).toBe('A1:B10');
    });

    it('should not infer when context is stale', () => {
      // Create manager with very short TTL
      const shortTTL = new ContextManager({ contextTTL: 1 });
      shortTTL.updateContext({ spreadsheetId: 'sheet123' });

      // Wait for context to become stale
      return new Promise((resolve) => {
        setTimeout(() => {
          const params: TestParams = { action: 'read' };
          const inferred = shortTTL.inferParameters(params);

          expect(inferred.spreadsheetId).toBeUndefined();
          resolve(undefined);
        }, 5);
      });
    });
  });

  describe('getContext', () => {
    it('should return current context', () => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        sheetId: 0,
      });

      const context = contextManager.getContext();

      expect(context.spreadsheetId).toBe('sheet123');
      expect(context.sheetId).toBe(0);
    });

    it('should return a copy of context', () => {
      contextManager.updateContext({ spreadsheetId: 'sheet123' });

      const context1 = contextManager.getContext();
      const context2 = contextManager.getContext();

      expect(context1).not.toBe(context2); // Different objects
      expect(context1).toEqual(context2); // Same values
    });
  });

  describe('isContextStale', () => {
    it('should return true when no context exists', () => {
      expect(contextManager.isContextStale()).toBe(true);
    });

    it('should return false for fresh context', () => {
      contextManager.updateContext({ spreadsheetId: 'sheet123' });

      expect(contextManager.isContextStale()).toBe(false);
    });

    it('should return true for stale context', () => {
      const shortTTL = new ContextManager({ contextTTL: 1 });
      shortTTL.updateContext({ spreadsheetId: 'sheet123' });

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(shortTTL.isContextStale()).toBe(true);
          resolve(undefined);
        }, 5);
      });
    });
  });

  describe('reset', () => {
    it('should clear all context', () => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        sheetId: 0,
        range: 'A1:B10',
      });

      contextManager.reset();

      const context = contextManager.getContext();

      expect(context.spreadsheetId).toBeUndefined();
      expect(context.sheetId).toBeUndefined();
      expect(context.range).toBeUndefined();
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        sheetId: 0,
        range: 'A1:B10',
      });
    });

    it('should track inference counts', () => {
      contextManager.inferParameters({ action: 'read' });
      contextManager.inferParameters({ action: 'write', spreadsheetId: 'sheet123' });

      const stats = contextManager.getStats() as StatsSnapshot;

      expect(stats.totalInferences).toBe(5); // 3 from first, 2 from second
      expect(stats.spreadsheetIdInferences).toBe(1);
      expect(stats.sheetIdInferences).toBe(2);
      expect(stats.rangeInferences).toBe(2);
    });

    it('should track context updates', () => {
      contextManager.updateContext({ spreadsheetId: 'new123' });
      contextManager.updateContext({ sheetId: 5 });

      const stats = contextManager.getStats() as StatsSnapshot;

      expect(stats.contextUpdates).toBe(3); // 1 in beforeEach + 2 here
    });

    it('should calculate inference rate', () => {
      contextManager.inferParameters({ action: 'read' });

      const stats = contextManager.getStats() as StatsSnapshot;

      expect(stats.inferenceRate).toBeGreaterThan(0);
    });

    it('should reset statistics', () => {
      contextManager.inferParameters({ action: 'read' });

      contextManager.resetStats();

      const stats = contextManager.getStats() as StatsSnapshot;

      expect(stats.totalInferences).toBe(0);
      expect(stats.contextUpdates).toBe(0);
    });
  });

  describe('canInfer', () => {
    beforeEach(() => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        range: 'A1:B10',
      });
    });

    it('should return true for available parameters', () => {
      expect(contextManager.canInfer('spreadsheetId')).toBe(true);
      expect(contextManager.canInfer('range')).toBe(true);
    });

    it('should return false for unavailable parameters', () => {
      expect(contextManager.canInfer('sheetId')).toBe(false);
    });

    it('should return false when context is stale', () => {
      const shortTTL = new ContextManager({ contextTTL: 1 });
      shortTTL.updateContext({ spreadsheetId: 'sheet123' });

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(shortTTL.canInfer('spreadsheetId')).toBe(false);
          resolve(undefined);
        }, 5);
      });
    });
  });

  describe('getInferredValue', () => {
    beforeEach(() => {
      contextManager.updateContext({
        spreadsheetId: 'sheet123',
        sheetId: 0,
      });
    });

    it('should return inferred value', () => {
      expect(contextManager.getInferredValue('spreadsheetId')).toBe('sheet123');
      expect(contextManager.getInferredValue('sheetId')).toBe(0);
    });

    it('should return undefined for unavailable value', () => {
      expect(contextManager.getInferredValue('range')).toBeUndefined();
    });

    it('should return undefined when context is stale', () => {
      const shortTTL = new ContextManager({ contextTTL: 1 });
      shortTTL.updateContext({ spreadsheetId: 'sheet123' });

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(shortTTL.getInferredValue('spreadsheetId')).toBeUndefined();
          resolve(undefined);
        }, 5);
      });
    });
  });
});
