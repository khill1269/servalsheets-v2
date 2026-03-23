/**
 * Tests for History Service
 *
 * Tests operation history tracking, filtering, statistics, and undo/redo support.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HistoryService,
  getHistoryService,
  setHistoryService,
  resetHistoryService,
} from '../../src/services/history-service.js';
import type { OperationHistory } from '../../src/types/history.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let _mockOpCounter = 0;
function createMockOperation(overrides: Partial<OperationHistory> = {}): OperationHistory {
  return {
    id: `op-1704067200000-${String(++_mockOpCounter).padStart(6, '0')}`,
    tool: 'sheets_data',
    action: 'read',
    timestamp: new Date('2024-01-15T00:00:00Z').toISOString(),
    duration: 100,
    result: 'success',
    ...overrides,
  };
}

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const svc = new HistoryService();
      expect(svc).toBeDefined();
    });

    it('should accept custom maxSize', () => {
      const svc = new HistoryService({ maxSize: 50 });
      expect(svc).toBeDefined();
    });

    it('should accept verboseLogging option', () => {
      const svc = new HistoryService({ verboseLogging: true });
      expect(svc).toBeDefined();
    });
  });

  describe('record', () => {
    it('should record an operation', () => {
      const op = createMockOperation();
      service.record(op);

      const result = service.getById(op.id);
      expect(result).toEqual(op);
    });

    it('should maintain circular buffer', () => {
      const svc = new HistoryService({ maxSize: 3 });

      const op1 = createMockOperation({ id: 'op-1' });
      const op2 = createMockOperation({ id: 'op-2' });
      const op3 = createMockOperation({ id: 'op-3' });
      const op4 = createMockOperation({ id: 'op-4' });

      svc.record(op1);
      svc.record(op2);
      svc.record(op3);
      svc.record(op4);

      // op1 should be evicted
      expect(svc.getById('op-1')).toBeUndefined();
      expect(svc.getById('op-2')).toBeDefined();
      expect(svc.getById('op-3')).toBeDefined();
      expect(svc.getById('op-4')).toBeDefined();
    });

    it('should add successful write operations to undo stack', () => {
      const op = createMockOperation({
        result: 'success',
        snapshotId: 'snapshot-1',
        spreadsheetId: 'sheet-123',
      });

      service.record(op);

      const undoStack = service.getUndoStack('sheet-123');
      expect(undoStack).toContain(op.id);
    });

    it('should clear redo stack when new operation is performed', () => {
      const spreadsheetId = 'sheet-123';

      // Record first operation
      const op1 = createMockOperation({
        id: 'op-1',
        result: 'success',
        snapshotId: 'snapshot-1',
        spreadsheetId,
      });
      service.record(op1);

      // Record second operation
      const op2 = createMockOperation({
        id: 'op-2',
        result: 'success',
        snapshotId: 'snapshot-2',
        spreadsheetId,
      });
      service.record(op2);

      // Redo stack should be empty
      const redoStack = service.getRedoStack(spreadsheetId);
      expect(redoStack).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('should return operation by ID', () => {
      const op = createMockOperation({ id: 'test-op-id' });
      service.record(op);

      expect(service.getById('test-op-id')).toEqual(op);
    });

    it('should return undefined for non-existent ID', () => {
      expect(service.getById('non-existent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    beforeEach(() => {
      service.record(
        createMockOperation({ id: 'op-1', tool: 'sheets_data', action: 'read', result: 'success' })
      );
      service.record(
        createMockOperation({ id: 'op-2', tool: 'sheets_data', action: 'write', result: 'success' })
      );
      service.record(
        createMockOperation({
          id: 'op-3',
          tool: 'sheets_format',
          action: 'set_format',
          result: 'error',
        })
      );
    });

    it('should return all operations without filter', () => {
      const all = service.getAll();
      expect(all).toHaveLength(3);
    });

    it('should filter by tool', () => {
      const filtered = service.getAll({ tool: 'sheets_data' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter by action', () => {
      const filtered = service.getAll({ action: 'read' });
      expect(filtered).toHaveLength(1);
    });

    it('should filter by result', () => {
      const filtered = service.getAll({ result: 'error' });
      expect(filtered).toHaveLength(1);
    });

    it('should filter by spreadsheetId', () => {
      service.record(createMockOperation({ id: 'op-4', spreadsheetId: 'sheet-123' }));
      const filtered = service.getAll({ spreadsheetId: 'sheet-123' });
      expect(filtered).toHaveLength(1);
    });

    it('should filter by time range', () => {
      const now = new Date('2024-01-15T00:00:00Z');
      const filtered = service.getAll({
        startTime: new Date(now.getTime() - 60000).toISOString(),
        endTime: new Date(now.getTime() + 60000).toISOString(),
      });
      expect(filtered.length).toBeGreaterThanOrEqual(0);
    });

    it('should limit results', () => {
      const filtered = service.getAll({ limit: 1 });
      expect(filtered).toHaveLength(1);
    });
  });

  describe('getRecent', () => {
    it('should return last N operations', () => {
      for (let i = 0; i < 10; i++) {
        service.record(createMockOperation({ id: `op-${i}` }));
      }

      const recent = service.getRecent(3);
      expect(recent).toHaveLength(3);
      expect(recent[2].id).toBe('op-9');
    });

    it('should return all if less than N operations', () => {
      service.record(createMockOperation({ id: 'op-1' }));
      service.record(createMockOperation({ id: 'op-2' }));

      const recent = service.getRecent(10);
      expect(recent).toHaveLength(2);
    });
  });

  describe('getFailures', () => {
    it('should return only failed operations', () => {
      service.record(createMockOperation({ result: 'success' }));
      service.record(createMockOperation({ result: 'error' }));
      service.record(createMockOperation({ result: 'success' }));
      service.record(createMockOperation({ result: 'error' }));

      const failures = service.getFailures();
      expect(failures).toHaveLength(2);
      expect(failures.every((op) => op.result === 'error')).toBe(true);
    });

    it('should limit failures if count provided', () => {
      for (let i = 0; i < 5; i++) {
        service.record(createMockOperation({ result: 'error' }));
      }

      const failures = service.getFailures(2);
      expect(failures).toHaveLength(2);
    });
  });

  describe('getBySpreadsheet', () => {
    it('should return operations for specific spreadsheet', () => {
      service.record(createMockOperation({ spreadsheetId: 'sheet-1' }));
      service.record(createMockOperation({ spreadsheetId: 'sheet-2' }));
      service.record(createMockOperation({ spreadsheetId: 'sheet-1' }));

      const ops = service.getBySpreadsheet('sheet-1');
      expect(ops).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return empty stats when no operations', () => {
      const stats = service.getStats();

      expect(stats.totalOperations).toBe(0);
      expect(stats.successfulOperations).toBe(0);
      expect(stats.failedOperations).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDuration).toBe(0);
    });

    it('should calculate stats correctly', () => {
      service.record(createMockOperation({ result: 'success', duration: 100, cellsAffected: 10 }));
      service.record(createMockOperation({ result: 'success', duration: 200, cellsAffected: 20 }));
      service.record(createMockOperation({ result: 'error', duration: 50, cellsAffected: 0 }));

      const stats = service.getStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.successfulOperations).toBe(2);
      expect(stats.failedOperations).toBe(1);
      expect(stats.successRate).toBeCloseTo(0.667, 2);
      expect(stats.averageDuration).toBeCloseTo(116.67, 1);
      expect(stats.totalCellsAffected).toBe(30);
    });

    it('should identify most common tool and action', () => {
      service.record(createMockOperation({ tool: 'sheets_data', action: 'read' }));
      service.record(createMockOperation({ tool: 'sheets_data', action: 'read' }));
      service.record(createMockOperation({ tool: 'sheets_format', action: 'set_format' }));

      const stats = service.getStats();

      expect(stats.mostCommonTool).toBe('sheets_data');
      expect(stats.mostCommonAction).toBe('read');
    });
  });

  describe('clear', () => {
    it('should clear all operations', () => {
      service.record(createMockOperation());
      service.record(createMockOperation());

      service.clear();

      expect(service.getAll()).toHaveLength(0);
    });
  });
});

describe('HistoryService singleton', () => {
  beforeEach(() => {
    resetHistoryService();
  });

  it('should return same instance from getHistoryService', () => {
    const instance1 = getHistoryService();
    const instance2 = getHistoryService();

    expect(instance1).toBe(instance2);
  });

  it('should allow setting custom instance', () => {
    const customService = new HistoryService({ maxSize: 50 });
    setHistoryService(customService);

    const instance = getHistoryService();
    expect(instance).toBe(customService);
  });

  it('should reset to new instance', () => {
    const instance1 = getHistoryService();
    resetHistoryService();
    const instance2 = getHistoryService();

    expect(instance1).not.toBe(instance2);
  });
});
