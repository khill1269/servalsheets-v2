/**
 * Extended tests for History Service
 *
 * Tests history tracking, operation logging, and rollback functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestContext: vi.fn().mockReturnValue({ requestId: 'test-req-id' }),
}));

import {
  HistoryService,
  getHistoryService,
  resetHistoryService,
} from '../../src/services/history-service.js';

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(() => {
    resetHistoryService();
    service = new HistoryService();
  });

  afterEach(() => {
    resetHistoryService();
  });

  describe('recordOperation', () => {
    it('should record a successful operation', () => {
      const operationId = service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1:B2' },
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(operationId).toBeDefined();
      expect(typeof operationId).toBe('string');
    });

    it('should record a failed operation', () => {
      const operationId = service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1:B2' },
        error: new Error('Write failed'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      expect(operationId).toBeDefined();
    });

    it('should record operation with snapshot reference', () => {
      const operationId = service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_dimensions',
        action: 'delete_rows',
        params: { startIndex: 5, count: 10 },
        result: { success: true },
        snapshotId: 'snapshot-123',
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      const history = service.getHistory('test-spreadsheet');
      const operation = history.find((op) => op.id === operationId);
      expect(operation?.snapshotId).toBe('snapshot-123');
    });
  });

  describe('getHistory', () => {
    it('should return empty array for unknown spreadsheet', () => {
      const history = service.getHistory('unknown-spreadsheet');
      expect(history).toEqual([]);
    });

    it('should return operations in reverse chronological order', () => {
      const now = new Date('2024-01-15T00:00:00Z');

      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'write',
        params: {},
        result: { success: true },
        timestamp: new Date(now.getTime() - 2000),
      });

      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'read',
        params: {},
        result: { success: true },
        timestamp: new Date(now.getTime() - 1000),
      });

      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_format',
        action: 'set_format',
        params: {},
        result: { success: true },
        timestamp: now,
      });

      const history = service.getHistory('test-spreadsheet');

      expect(history.length).toBe(3);
      expect(history[0]?.tool).toBe('sheets_format');
      expect(history[2]?.tool).toBe('sheets_data');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        service.recordOperation({
          spreadsheetId: 'test-spreadsheet',
          tool: 'sheets_data',
          action: 'write',
          params: { index: i },
          result: { success: true },
          timestamp: new Date('2024-01-15T00:00:00Z'),
        });
      }

      const history = service.getHistory('test-spreadsheet', { limit: 5 });
      expect(history.length).toBe(5);
    });
  });

  describe('getOperation', () => {
    it('should retrieve operation by ID', () => {
      const operationId = service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1' },
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      const operation = service.getOperation('test-spreadsheet', operationId);

      expect(operation).toBeDefined();
      expect(operation?.tool).toBe('sheets_data');
      expect(operation?.action).toBe('write');
    });

    it('should return undefined for unknown operation ID', () => {
      const operation = service.getOperation('test-spreadsheet', 'unknown-id');
      expect(operation).toBeUndefined();
    });
  });

  describe('searchHistory', () => {
    beforeEach(() => {
      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'write',
        params: {},
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_format',
        action: 'set_background',
        params: {},
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'read',
        params: {},
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });
    });

    it('should search by tool name', () => {
      const results = service.searchHistory('test-spreadsheet', {
        tool: 'sheets_data',
      });

      expect(results.length).toBe(2);
      results.forEach((op) => {
        expect(op.tool).toBe('sheets_data');
      });
    });

    it('should search by action', () => {
      const results = service.searchHistory('test-spreadsheet', {
        action: 'write',
      });

      expect(results.length).toBe(1);
      expect(results[0]?.action).toBe('write');
    });

    it('should search by time range', () => {
      const now = new Date('2024-01-15T00:00:00Z');
      const hourAgo = new Date(now.getTime() - 3600000);

      const results = service.searchHistory('test-spreadsheet', {
        startTime: hourAgo,
        endTime: now,
      });

      expect(results.length).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return operation statistics', () => {
      for (let i = 0; i < 5; i++) {
        service.recordOperation({
          spreadsheetId: 'test-spreadsheet',
          tool: 'sheets_data',
          action: 'write',
          params: {},
          result: { success: true },
          timestamp: new Date('2024-01-15T00:00:00Z'),
        });
      }

      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'read',
        params: {},
        error: new Error('Failed'),
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      const stats = service.getStats('test-spreadsheet');

      expect(stats.totalOperations).toBe(6);
      expect(stats.successfulOperations).toBe(5);
      expect(stats.failedOperations).toBe(1);
    });
  });

  describe('clearHistory', () => {
    it('should clear history for a spreadsheet', () => {
      service.recordOperation({
        spreadsheetId: 'test-spreadsheet',
        tool: 'sheets_data',
        action: 'write',
        params: {},
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      service.clearHistory('test-spreadsheet');

      const history = service.getHistory('test-spreadsheet');
      expect(history.length).toBe(0);
    });

    it('should not affect other spreadsheets', () => {
      service.recordOperation({
        spreadsheetId: 'spreadsheet-1',
        tool: 'sheets_data',
        action: 'write',
        params: {},
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      service.recordOperation({
        spreadsheetId: 'spreadsheet-2',
        tool: 'sheets_data',
        action: 'write',
        params: {},
        result: { success: true },
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      service.clearHistory('spreadsheet-1');

      expect(service.getHistory('spreadsheet-1').length).toBe(0);
      expect(service.getHistory('spreadsheet-2').length).toBe(1);
    });
  });

  describe('singleton management', () => {
    it('should return same instance from getHistoryService', () => {
      const instance1 = getHistoryService();
      const instance2 = getHistoryService();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton with resetHistoryService', () => {
      const instance1 = getHistoryService();
      instance1.recordOperation({
        spreadsheetId: 'test',
        tool: 'test',
        action: 'test',
        params: {},
        result: {},
        timestamp: new Date('2024-01-15T00:00:00Z'),
      });

      resetHistoryService();

      const instance2 = getHistoryService();
      expect(instance2.getHistory('test').length).toBe(0);
    });
  });
});
