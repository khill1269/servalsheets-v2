/**
 * ServalSheets - History Handler Tests
 *
 * Tests for operation history tracking, undo/redo functionality, and debugging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryHandler } from '../../src/handlers/history.js';
import type { HistoryService } from '../../src/services/history-service.js';
import type { SnapshotService } from '../../src/services/snapshot.js';
import type { OperationHistory, OperationHistoryStats } from '../../src/types/history.js';
import { SheetsHistoryOutputSchema } from '../../src/schemas/history.js';
import { SessionContextManager } from '../../src/services/session-context.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// Mock HistoryService
const createMockHistoryService = (): HistoryService =>
  ({
    record: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn(),
    getRecent: vi.fn(),
    getFailures: vi.fn(),
    getBySpreadsheet: vi.fn(),
    getStats: vi.fn(),
    clear: vi.fn(),
    size: vi.fn(),
    isFull: vi.fn(),
    getLastUndoable: vi.fn(),
    getLastRedoable: vi.fn(),
    markAsUndone: vi.fn(),
    markAsRedone: vi.fn(),
    clearForSpreadsheet: vi.fn(),
    getUndoStackSize: vi.fn(),
    getRedoStackSize: vi.fn(),
  }) as any;

// Mock SnapshotService
const createMockSnapshotService = (): SnapshotService =>
  ({
    create: vi.fn(),
    restore: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    clear: vi.fn(),
  }) as any;

// Helper to create mock operations
const createMockOperation = (overrides?: Partial<OperationHistory>): OperationHistory => ({
  id: 'op-123',
  timestamp: '2025-01-09T10:00:00Z',
  tool: 'sheets_data',
  action: 'write',
  params: { spreadsheetId: 'test-sheet', range: 'A1' },
  result: 'success',
  duration: 250,
  cellsAffected: 10,
  spreadsheetId: 'test-sheet',
  snapshotId: 'snap-123',
  ...overrides,
});

// Mock the getHistoryService function
vi.mock('../../src/services/history-service.js', () => {
  let mockService: HistoryService | null = null;

  return {
    getHistoryService: vi.fn(() => mockService),
    setHistoryService: vi.fn((service: HistoryService | null) => {
      mockService = service;
    }),
  };
});

// Mock revision-timeline for timeline progress tests
const mockGetTimeline = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/revision-timeline.js', () => ({
  getTimeline: mockGetTimeline,
  diffRevisions: vi.fn(),
  restoreCells: vi.fn(),
}));

describe('HistoryHandler', () => {
  let handler: HistoryHandler;
  let mockHistoryService: HistoryService;
  let mockSnapshotService: SnapshotService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import to get the mock
    const { getHistoryService, setHistoryService } =
      await import('../../src/services/history-service.js');

    // Create fresh mocks
    mockHistoryService = createMockHistoryService();
    mockSnapshotService = createMockSnapshotService();

    // Set the mock
    setHistoryService(mockHistoryService);

    // Create handler with snapshot service
    handler = new HistoryHandler({ snapshotService: mockSnapshotService });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('list action', () => {
    it('should list recent operations with default count', async () => {
      const mockOperations = [
        createMockOperation({ id: 'op-1', tool: 'sheets_data', action: 'write' }),
        createMockOperation({ id: 'op-2', tool: 'sheets_format', action: 'set_background' }),
      ];

      mockHistoryService.getRecent = vi.fn().mockReturnValue(mockOperations);

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operations).toHaveLength(2);
        expect(result.response.operations![0].id).toBe('op-1');
        expect(result.response.operations![1].id).toBe('op-2');
        expect(result.response.message).toContain('Retrieved 2 operation(s)');
      }
      expect(mockHistoryService.getRecent).toHaveBeenCalledWith(10);

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should list operations with custom count', async () => {
      const mockOperations = [
        createMockOperation({ id: 'op-1' }),
        createMockOperation({ id: 'op-2' }),
        createMockOperation({ id: 'op-3' }),
      ];

      mockHistoryService.getRecent = vi.fn().mockReturnValue(mockOperations);

      const result = await handler.handle({
        action: 'list',
        count: 25,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operations).toHaveLength(3);
      }
      expect(mockHistoryService.getRecent).toHaveBeenCalledWith(25);
    });

    it('should filter operations by spreadsheet ID', async () => {
      const mockOperations = [
        createMockOperation({ id: 'op-1', spreadsheetId: 'sheet-123' }),
        createMockOperation({ id: 'op-2', spreadsheetId: 'sheet-123' }),
      ];

      mockHistoryService.getBySpreadsheet = vi.fn().mockReturnValue(mockOperations);

      const result = await handler.handle({
        action: 'list',
        spreadsheetId: 'sheet-123',
        count: 20,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operations).toHaveLength(2);
        expect(result.response.operations![0].spreadsheetId).toBe('sheet-123');
      }
      expect(mockHistoryService.getBySpreadsheet).toHaveBeenCalledWith('sheet-123', 20);
    });

    it('should list only failed operations when failuresOnly is true', async () => {
      const mockFailures = [
        createMockOperation({
          id: 'op-fail-1',
          result: 'error',
          errorMessage: 'Permission denied',
        }),
        createMockOperation({
          id: 'op-fail-2',
          result: 'error',
          errorMessage: 'Invalid range',
        }),
      ];

      mockHistoryService.getFailures = vi.fn().mockReturnValue(mockFailures);

      const result = await handler.handle({
        action: 'list',
        failuresOnly: true,
        count: 5,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operations).toHaveLength(2);
        expect(result.response.operations![0].success).toBe(false);
        expect(result.response.operations![0].error).toBe('Permission denied');
      }
      expect(mockHistoryService.getFailures).toHaveBeenCalledWith(5);
    });

    it('should convert operation timestamps to milliseconds', async () => {
      const mockOperations = [
        createMockOperation({
          id: 'op-1',
          timestamp: '2025-01-09T10:00:00.000Z',
        }),
      ];

      mockHistoryService.getRecent = vi.fn().mockReturnValue(mockOperations);

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(typeof result.response.operations![0].timestamp).toBe('number');
        expect(result.response.operations![0].timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('timeline action', () => {
    it('stores pending revision context on the injected session manager', async () => {
      const sessionContext = new SessionContextManager();
      const timelineHandler = new HistoryHandler({
        driveApi: {} as any,
        sessionContext,
      });

      mockGetTimeline.mockResolvedValue({
        items: [
          { revisionId: 'rev-new', timestamp: '2026-03-16T10:00:00Z' },
          { revisionId: 'rev-old', timestamp: '2026-03-15T10:00:00Z' },
        ],
      });

      const result = await timelineHandler.handle({
        action: 'timeline',
        spreadsheetId: 'sheet-123',
      });

      expect(result.response.success).toBe(true);
      expect(sessionContext.getPendingOperation()).toMatchObject({
        type: 'timeline',
        context: expect.objectContaining({
          spreadsheetId: 'sheet-123',
          latestRevisionId: 'rev-new',
          previousRevisionId: 'rev-old',
        }),
      });
    });
  });

  describe('get action', () => {
    it('should retrieve specific operation by ID', async () => {
      const mockOperation = createMockOperation({
        id: 'op-456',
        tool: 'sheets_format',
        action: 'set_background',
        params: { spreadsheetId: 'test-sheet', range: 'A1:B2' },
        duration: 150,
      });

      mockHistoryService.getById = vi.fn().mockReturnValue(mockOperation);

      const result = await handler.handle({
        action: 'get',
        operationId: 'op-456',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operation).toBeDefined();
        expect(result.response.operation!.id).toBe('op-456');
        expect(result.response.operation!.tool).toBe('sheets_format');
        expect(result.response.operation!.action).toBe('set_background');
        expect(result.response.operation!.params).toEqual({
          spreadsheetId: 'test-sheet',
          range: 'A1:B2',
        });
        expect(result.response.message).toBe('Operation retrieved');
      }
      expect(mockHistoryService.getById).toHaveBeenCalledWith('op-456');
    });

    it('should return error when operation not found', async () => {
      mockHistoryService.getById = vi.fn().mockReturnValue(undefined);

      const result = await handler.handle({
        action: 'get',
        operationId: 'nonexistent-op',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toContain('nonexistent-op');
        expect(result.response.error.retryable).toBe(false);
      }

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should include error details for failed operations', async () => {
      const mockOperation = createMockOperation({
        id: 'op-fail',
        result: 'error',
        errorMessage: 'Quota exceeded',
      });

      mockHistoryService.getById = vi.fn().mockReturnValue(mockOperation);

      const result = await handler.handle({
        action: 'get',
        operationId: 'op-fail',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operation!.success).toBe(false);
        expect(result.response.operation!.error).toBe('Quota exceeded');
      }
    });
  });

  describe('stats action', () => {
    it('should retrieve operation statistics', async () => {
      const mockStats: OperationHistoryStats = {
        totalOperations: 100,
        successfulOperations: 85,
        failedOperations: 15,
        successRate: 0.85,
        averageDuration: 275.5,
        totalCellsAffected: 5000,
        mostCommonTool: 'sheets_data',
        mostCommonAction: 'write',
        oldestOperation: '2025-01-08T10:00:00Z',
        newestOperation: '2025-01-09T10:00:00Z',
      };

      mockHistoryService.getStats = vi.fn().mockReturnValue(mockStats);

      const result = await handler.handle({
        action: 'stats',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.stats).toBeDefined();
        expect(result.response.stats!.totalOperations).toBe(100);
        expect(result.response.stats!.successfulOperations).toBe(85);
        expect(result.response.stats!.failedOperations).toBe(15);
        expect(result.response.stats!.successRate).toBe(0.85);
        expect(result.response.stats!.avgDuration).toBe(275.5);
        expect(result.response.message).toContain('100 operation(s) tracked');
        // Handler uses .toFixed(1) on decimal value (0.85 -> "0.8")
        expect(result.response.message).toContain('0.8% success rate');
      }
      expect(mockHistoryService.getStats).toHaveBeenCalled();

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should format success rate correctly in message', async () => {
      const mockStats: OperationHistoryStats = {
        totalOperations: 50,
        successfulOperations: 47,
        failedOperations: 3,
        successRate: 0.94,
        averageDuration: 200,
        totalCellsAffected: 1000,
      };

      mockHistoryService.getStats = vi.fn().mockReturnValue(mockStats);

      const result = await handler.handle({
        action: 'stats',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        // Handler uses .toFixed(1) on decimal value (0.94 -> "0.9")
        expect(result.response.message).toContain('0.9% success rate');
      }
    });
  });

  describe('undo action', () => {
    it('should undo last operation for spreadsheet', async () => {
      const mockOperation = createMockOperation({
        id: 'op-to-undo',
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: 'sheet-123',
        snapshotId: 'snap-before-write',
        timestamp: '2025-01-09T09:00:00Z',
      });

      mockHistoryService.getLastUndoable = vi.fn().mockReturnValue(mockOperation);
      mockSnapshotService.restore = vi.fn().mockResolvedValue('sheet-123');
      mockHistoryService.markAsUndone = vi.fn();

      const result = await handler.handle({
        action: 'undo',
        spreadsheetId: 'sheet-123',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.restoredSpreadsheetId).toBe('sheet-123');
        expect(result.response.operationRestored).toBeDefined();
        expect(result.response.operationRestored!.id).toBe('op-to-undo');
        expect(result.response.operationRestored!.tool).toBe('sheets_data');
        expect(result.response.operationRestored!.action).toBe('write');
        expect(result.response.message).toContain('Undid sheets_data.write operation');
      }

      expect(mockHistoryService.getLastUndoable).toHaveBeenCalledWith('sheet-123');
      expect(mockSnapshotService.restore).toHaveBeenCalledWith('snap-before-write');
      expect(mockHistoryService.markAsUndone).toHaveBeenCalledWith('op-to-undo', 'sheet-123');

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return error when no undoable operations exist', async () => {
      mockHistoryService.getLastUndoable = vi.fn().mockReturnValue(undefined);

      const result = await handler.handle({
        action: 'undo',
        spreadsheetId: 'sheet-456',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toMatch(/Operation.*not found/i);
      }
      expect(mockSnapshotService.restore).not.toHaveBeenCalled();
    });

    it('should return error when operation has no snapshot', async () => {
      const mockOperation = createMockOperation({
        id: 'op-no-snapshot',
        spreadsheetId: 'sheet-123',
        snapshotId: undefined,
      });

      mockHistoryService.getLastUndoable = vi.fn().mockReturnValue(mockOperation);

      const result = await handler.handle({
        action: 'undo',
        spreadsheetId: 'sheet-123',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toMatch(/Snapshot.*not found/i);
      }
      expect(mockSnapshotService.restore).not.toHaveBeenCalled();
    });

    it('should return error when snapshot service not available', async () => {
      const mockOperation = createMockOperation({
        spreadsheetId: 'sheet-123',
        snapshotId: 'snap-123',
      });

      mockHistoryService.getLastUndoable = vi.fn().mockReturnValue(mockOperation);

      // Create handler without snapshot service
      const handlerWithoutSnapshot = new HistoryHandler({});

      const result = await handlerWithoutSnapshot.handle({
        action: 'undo',
        spreadsheetId: 'sheet-123',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('SERVICE_NOT_INITIALIZED');
        expect(result.response.error.message).toContain('Snapshot service not available');
      }
    });

    it('should handle snapshot restore failures', async () => {
      const mockOperation = createMockOperation({
        spreadsheetId: 'sheet-123',
        snapshotId: 'snap-corrupt',
      });

      mockHistoryService.getLastUndoable = vi.fn().mockReturnValue(mockOperation);
      mockSnapshotService.restore = vi.fn().mockRejectedValue(new Error('Snapshot corrupted'));

      const result = await handler.handle({
        action: 'undo',
        spreadsheetId: 'sheet-123',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('SNAPSHOT_RESTORE_FAILED');
        expect(result.response.error.message).toContain('Snapshot corrupted');
        expect(result.response.error.retryable).toBe(true);
      }
    });
  });

  describe('redo action', () => {
    it('should redo a previously undone operation', async () => {
      const mockOperation = createMockOperation({
        spreadsheetId: 'sheet-123',
      });

      mockHistoryService.getLastRedoable = vi.fn().mockReturnValue(mockOperation);
      mockSnapshotService.restore = vi.fn().mockResolvedValue('sheet-restored');

      const result = await handler.handle({
        action: 'redo',
        spreadsheetId: 'sheet-123',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.restoredSpreadsheetId).toBe('sheet-restored');
        expect(result.response.operationRestored).toBeDefined();
        expect(result.response.operationRestored!.id).toBe('op-123');
        expect(result.response.message).toContain('Redid');
      }

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return error when no redoable operations exist', async () => {
      mockHistoryService.getLastRedoable = vi.fn().mockReturnValue(undefined);

      const result = await handler.handle({
        action: 'redo',
        spreadsheetId: 'sheet-789',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toMatch(/Operation.*not found/i);
      }
    });
  });

  describe('revert_to action', () => {
    it('should revert to state before specific operation', async () => {
      const mockOperation = createMockOperation({
        id: 'op-revert-target',
        tool: 'sheets_format',
        action: 'set_background',
        snapshotId: 'snap-before-format',
        timestamp: '2025-01-09T08:00:00Z',
      });

      mockHistoryService.getById = vi.fn().mockReturnValue(mockOperation);
      mockSnapshotService.restore = vi.fn().mockResolvedValue('sheet-restored');

      const result = await handler.handle({
        action: 'revert_to',
        operationId: 'op-revert-target',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.restoredSpreadsheetId).toBe('sheet-restored');
        expect(result.response.operationRestored).toBeDefined();
        expect(result.response.operationRestored!.id).toBe('op-revert-target');
        expect(result.response.message).toContain(
          'Reverted to state before sheets_format.set_background'
        );
      }

      expect(mockHistoryService.getById).toHaveBeenCalledWith('op-revert-target');
      expect(mockSnapshotService.restore).toHaveBeenCalledWith('snap-before-format');

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return error when operation not found', async () => {
      mockHistoryService.getById = vi.fn().mockReturnValue(undefined);

      const result = await handler.handle({
        action: 'revert_to',
        operationId: 'nonexistent',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toMatch(/Operation.*not found/i);
        expect(result.response.error.message).toContain('nonexistent');
      }
    });

    it('should return error when operation has no snapshot', async () => {
      const mockOperation = createMockOperation({
        id: 'op-no-snap',
        snapshotId: undefined,
      });

      mockHistoryService.getById = vi.fn().mockReturnValue(mockOperation);

      const result = await handler.handle({
        action: 'revert_to',
        operationId: 'op-no-snap',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toMatch(/Snapshot.*not found/i);
      }
    });

    it('should return error when snapshot service not available', async () => {
      const mockOperation = createMockOperation({
        snapshotId: 'snap-123',
      });

      mockHistoryService.getById = vi.fn().mockReturnValue(mockOperation);

      const handlerWithoutSnapshot = new HistoryHandler({});

      const result = await handlerWithoutSnapshot.handle({
        action: 'revert_to',
        operationId: 'op-123',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('SERVICE_NOT_INITIALIZED');
      }
    });

    it('should handle snapshot restore failures for revert', async () => {
      const mockOperation = createMockOperation({
        snapshotId: 'snap-invalid',
      });

      mockHistoryService.getById = vi.fn().mockReturnValue(mockOperation);
      mockSnapshotService.restore = vi.fn().mockRejectedValue(new Error('Snapshot not found'));

      const result = await handler.handle({
        action: 'revert_to',
        operationId: 'op-123',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('SNAPSHOT_RESTORE_FAILED');
        expect(result.response.error.message).toContain('Snapshot not found');
        expect(result.response.error.retryable).toBe(true);
      }
    });
  });

  describe('clear action', () => {
    it('should clear history for specific spreadsheet', async () => {
      mockHistoryService.clearForSpreadsheet = vi.fn().mockReturnValue(15);

      const result = await handler.handle({
        action: 'clear',
        spreadsheetId: 'sheet-clear-me',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operationsCleared).toBe(15);
        expect(result.response.message).toContain('Cleared 15 operation(s)');
        expect(result.response.message).toContain('sheet-clear-me');
      }

      expect(mockHistoryService.clearForSpreadsheet).toHaveBeenCalledWith('sheet-clear-me');

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should clear all history when no spreadsheet specified', async () => {
      mockHistoryService.clear = vi.fn();
      mockHistoryService.size = vi.fn().mockReturnValue(50);

      const result = await handler.handle({
        action: 'clear',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operationsCleared).toBe(50);
        expect(result.response.message).toContain('Cleared all 50 operation(s)');
      }

      expect(mockHistoryService.clear).toHaveBeenCalled();
      expect(mockHistoryService.size).toHaveBeenCalled();
    });

    it('should handle clearing empty history', async () => {
      mockHistoryService.clearForSpreadsheet = vi.fn().mockReturnValue(0);

      const result = await handler.handle({
        action: 'clear',
        spreadsheetId: 'empty-sheet',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.operationsCleared).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('should handle unknown action', async () => {
      const result = await handler.handle({
        action: 'invalid_action',
      } as any);

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INVALID_PARAMS');
        expect(result.response.error.message).toContain('Unknown action: invalid_action');
        expect(result.response.error.retryable).toBe(false);
      }

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should catch unexpected errors in handler', async () => {
      mockHistoryService.getRecent = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected database error');
      });

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('Unexpected database error');
      }

      // Validate schema
      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle non-Error exceptions', async () => {
      mockHistoryService.getStats = vi.fn().mockImplementation(() => {
        throw 'String error';
      });

      const result = await handler.handle({
        action: 'stats',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toBe('String error');
      }
    });
  });

  describe('schema validation', () => {
    it('should validate all success responses against schema', async () => {
      const mockOperations = [createMockOperation()];
      mockHistoryService.getRecent = vi.fn().mockReturnValue(mockOperations);

      const result = await handler.handle({
        action: 'list',
      });

      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) {
        console.error('Schema validation errors:', parseResult.error.errors);
      }
    });

    it('should validate error responses against schema', async () => {
      mockHistoryService.getById = vi.fn().mockReturnValue(undefined);

      const result = await handler.handle({
        action: 'get',
        operationId: 'missing',
      });

      const parseResult = SheetsHistoryOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  // ============================================================================
  // timeline progress notifications (Tranche E)
  // ============================================================================

  describe('timeline progress notifications', () => {
    it('should emit progress notifications while scanning revision history', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'history-timeline-progress',
        progressToken: 'history-timeline-progress',
        sendNotification: notification,
      });

      mockGetTimeline.mockResolvedValue({
        items: [
          { revisionId: 'rev-2', timestamp: '2024-01-15T10:00:00Z', author: 'Alice' },
          { revisionId: 'rev-1', timestamp: '2024-01-14T10:00:00Z', author: 'Bob' },
        ],
        activityAvailable: false,
        totalFetched: 2,
        truncated: false,
        nextPageToken: undefined,
      });

      const mockDriveApi = {} as any;
      const handlerWithDrive = new HistoryHandler({
        snapshotService: mockSnapshotService,
        driveApi: mockDriveApi,
      });

      const result = await runWithRequestContext(requestContext, () =>
        handlerWithDrive.handle({
          action: 'timeline',
          spreadsheetId: 'test-sheet',
        })
      );

      expect(result.response.success).toBe(true);
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({
          progress: 0,
        }),
      });
    });
  });
});
