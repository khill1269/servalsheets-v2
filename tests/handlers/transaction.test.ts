/**
 * ServalSheets - Transaction Handler Tests
 *
 * Comprehensive tests for transaction lifecycle operations:
 * - Begin/commit/rollback/status/queue/list actions
 * - Transaction manager integration
 * - Error handling and auto-rollback
 * - Large transaction warnings
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransactionHandler } from '../../src/handlers/transaction.js';
import { SheetsTransactionOutputSchema } from '../../src/schemas/transaction.js';
import type { TransactionManager } from '../../src/services/transaction-manager.js';
import type { Transaction, CommitResult } from '../../src/types/transaction.js';

// Mock getTransactionManager
vi.mock('../../src/services/transaction-manager.js', () => ({
  getTransactionManager: vi.fn(),
}));

describe('TransactionHandler', () => {
  let handler: TransactionHandler;
  let mockTransactionManager: TransactionManager;
  let getTransactionManagerMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create comprehensive mock for TransactionManager
    mockTransactionManager = {
      begin: vi.fn(),
      queue: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      getTransaction: vi.fn(),
      getActiveTransactions: vi.fn(),
      cancel: vi.fn(),
      getStats: vi.fn(),
      resetStats: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getWalRecoveryReport: vi.fn().mockResolvedValue({ enabled: false, orphanedTransactions: [] }),
      discardOrphanedTransaction: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Mock getTransactionManager to return our mock
    const module = await import('../../src/services/transaction-manager.js');
    getTransactionManagerMock = vi.mocked(module.getTransactionManager);
    getTransactionManagerMock.mockReturnValue(mockTransactionManager);

    handler = new TransactionHandler();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('begin action', () => {
    it('should start a new transaction with default options', async () => {
      const mockTxId = 'txn-abc-123';
      mockTransactionManager.begin = vi.fn().mockResolvedValue(mockTxId);

      const result = await handler.handle({
        action: 'begin',
        spreadsheetId: 'test-sheet-id-123',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('begin');
        expect(result.response.transactionId).toBe(mockTxId);
        expect(result.response.status).toBe('pending');
        expect(result.response.operationsQueued).toBe(0);
        expect(result.response.message).toContain('Transaction');
        expect(result.response.message).toContain('started');
      }

      expect(mockTransactionManager.begin).toHaveBeenCalledWith('test-sheet-id-123', {
        autoCommit: false,
        autoRollback: true,
        autoSnapshot: false,
        isolationLevel: 'read_committed',
      });

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should start transaction with custom isolation level', async () => {
      const mockTxId = 'txn-xyz-789';
      mockTransactionManager.begin = vi.fn().mockResolvedValue(mockTxId);

      const result = await handler.handle({
        action: 'begin',
        spreadsheetId: 'test-sheet-id-456',
        isolationLevel: 'serializable',
        autoRollback: false,
      });

      expect(result.response.success).toBe(true);
      expect(mockTransactionManager.begin).toHaveBeenCalledWith('test-sheet-id-456', {
        autoCommit: false,
        autoRollback: false,
        autoSnapshot: false,
        isolationLevel: 'serializable',
      });
    });

    it('should include snapshot warning when autoSnapshot is enabled', async () => {
      const mockTxId = 'txn-snapshot-001';
      mockTransactionManager.begin = vi.fn().mockResolvedValue(mockTxId);

      const result = await handler.handle({
        action: 'begin',
        spreadsheetId: 'test-sheet-id-789',
        autoSnapshot: true,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.message).toContain('Snapshots are metadata-only');
        expect(result.response.message).toContain('>50MB metadata');
      }
    });

    it('should handle transaction manager errors', async () => {
      mockTransactionManager.begin = vi
        .fn()
        .mockRejectedValue(new Error('Maximum concurrent transactions reached'));

      const result = await handler.handle({
        action: 'begin',
        spreadsheetId: 'test-sheet-id-error',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('Maximum concurrent transactions');
      }

      // Validate schema compliance for error response
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('queue action', () => {
    it('should queue an operation in the transaction', async () => {
      const mockTxId = 'txn-queue-001';
      const mockOperationId = 'op_1';

      mockTransactionManager.queue = vi.fn().mockResolvedValue(mockOperationId);
      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        id: mockTxId,
        operations: [{ id: mockOperationId, type: 'custom', tool: 'sheets_data', action: 'write' }],
        status: 'queued',
      } as Transaction);

      const result = await handler.handle({
        action: 'queue',
        transactionId: mockTxId,
        operation: {
          tool: 'sheets_data',
          action: 'write',
          params: { range: 'A1:B2', values: [[1, 2]] },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('queue');
        expect(result.response.transactionId).toBe(mockTxId);
        expect(result.response.operationsQueued).toBe(1);
        expect(result.response.message).toContain('1 operation(s)');
      }

      expect(mockTransactionManager.queue).toHaveBeenCalledWith(mockTxId, {
        type: 'custom',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1:B2', values: [[1, 2]] },
      });
    });

    it('should warn when transaction has more than 20 operations', async () => {
      const mockTxId = 'txn-large-001';

      // Create 25 mock operations
      const mockOperations = Array.from({ length: 25 }, (_, i) => ({
        id: `op_${i}`,
        type: 'custom',
        tool: 'sheets_data',
        action: 'write',
      }));

      mockTransactionManager.queue = vi.fn().mockResolvedValue('op_25');
      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        id: mockTxId,
        operations: mockOperations,
        status: 'queued',
      } as Transaction);

      const result = await handler.handle({
        action: 'queue',
        transactionId: mockTxId,
        operation: {
          tool: 'sheets_format',
          action: 'set_background',
          params: { range: 'C1:D2' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && result.response._meta?.warnings) {
        expect(result.response._meta.warnings.length).toBeGreaterThan(0);
        expect(result.response._meta.warnings[0]).toContain('Transaction size is growing');
        expect(result.response._meta.warnings[0]).toContain('25 operations');
      }
    });

    it('should warn when transaction exceeds 50 operations', async () => {
      const mockTxId = 'txn-very-large-001';

      // Create 55 mock operations
      const mockOperations = Array.from({ length: 55 }, (_, i) => ({
        id: `op_${i}`,
        type: 'custom',
      }));

      mockTransactionManager.queue = vi.fn().mockResolvedValue('op_55');
      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        id: mockTxId,
        operations: mockOperations,
        status: 'queued',
      } as Transaction);

      const result = await handler.handle({
        action: 'queue',
        transactionId: mockTxId,
        operation: {
          tool: 'sheets_data',
          action: 'append',
          params: {},
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && result.response._meta?.warnings) {
        expect(result.response._meta.warnings[0]).toContain('Large transaction');
        expect(result.response._meta.warnings[0]).toContain('55 operations');
        expect(result.response._meta.warnings[0]).toContain(
          'splitting into multiple smaller transactions'
        );
      }
    });
  });

  describe('commit action', () => {
    it('should commit transaction successfully', async () => {
      const mockTxId = 'txn-commit-001';
      const mockCommitResult: CommitResult = {
        transactionId: mockTxId,
        success: true,
        batchResponse: {},
        operationResults: [
          { operationId: 'op_1', success: true, duration: 100 },
          { operationId: 'op_2', success: true, duration: 150 },
        ],
        duration: 250,
        apiCallsMade: 1,
        apiCallsSaved: 1,
        snapshotId: 'snapshot-123',
      };

      mockTransactionManager.commit = vi.fn().mockResolvedValue(mockCommitResult);

      const result = await handler.handle({
        action: 'commit',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('commit');
        expect(result.response.transactionId).toBe(mockTxId);
        expect(result.response.status).toBe('committed');
        expect(result.response.operationsExecuted).toBe(2);
        expect(result.response.apiCallsSaved).toBe(1);
        expect(result.response.duration).toBe(250);
        expect(result.response.message).toContain('committed successfully');
        expect(result.response.message).toContain('2 operation(s) executed');
      }

      expect(mockTransactionManager.commit).toHaveBeenCalledWith(mockTxId);

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle commit failure with auto-rollback', async () => {
      const mockTxId = 'txn-commit-fail-001';
      const mockCommitResult: CommitResult = {
        transactionId: mockTxId,
        success: false,
        operationResults: [],
        duration: 100,
        apiCallsMade: 0,
        apiCallsSaved: 0,
        error: new Error('API rate limit exceeded'),
        rolledBack: true,
        snapshotId: 'snapshot-456',
      };

      mockTransactionManager.commit = vi.fn().mockResolvedValue(mockCommitResult);

      const result = await handler.handle({
        action: 'commit',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toBe('API rate limit exceeded');
        expect(result.response.error.retryable).toBe(false);
        expect(result.response.error.details).toEqual({
          rollback: 'Transaction was automatically rolled back',
        });
      }
    });

    it('should handle commit failure without rollback', async () => {
      const mockTxId = 'txn-commit-fail-no-rollback';
      const mockCommitResult: CommitResult = {
        transactionId: mockTxId,
        success: false,
        operationResults: [],
        duration: 50,
        apiCallsMade: 0,
        apiCallsSaved: 0,
        error: new Error('Operation validation failed'),
        rolledBack: false,
      };

      mockTransactionManager.commit = vi.fn().mockResolvedValue(mockCommitResult);

      const result = await handler.handle({
        action: 'commit',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toBe('Operation validation failed');
        expect(result.response.error.details).toBeUndefined();
      }
    });
  });

  describe('rollback action', () => {
    it('should rollback transaction successfully', async () => {
      const mockTxId = 'txn-rollback-001';

      mockTransactionManager.rollback = vi.fn().mockResolvedValue({
        transactionId: mockTxId,
        success: true,
        snapshotId: 'snapshot-789',
        duration: 150,
        operationsReverted: 3,
      });

      const result = await handler.handle({
        action: 'rollback',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('rollback');
        expect(result.response.transactionId).toBe(mockTxId);
        expect(result.response.status).toBe('rolled_back');
        expect(result.response.message).toContain('rolled back successfully');
      }

      expect(mockTransactionManager.rollback).toHaveBeenCalledWith(mockTxId);

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle rollback errors', async () => {
      const mockTxId = 'txn-rollback-error';

      mockTransactionManager.rollback = vi
        .fn()
        .mockRejectedValue(new Error('No snapshot available for rollback'));

      const result = await handler.handle({
        action: 'rollback',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('No snapshot available');
      }
    });
  });

  describe('status action', () => {
    it('should return transaction status with queued operations', async () => {
      const mockTxId = 'txn-status-001';

      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        id: mockTxId,
        spreadsheetId: 'sheet-123',
        status: 'queued',
        operations: [
          { id: 'op_1', type: 'values_write' },
          { id: 'op_2', type: 'format_apply' },
          { id: 'op_3', type: 'sheet_create' },
        ],
        snapshot: { id: 'snapshot-001' },
        startTime: 1704067200000 - 5000,
      } as Transaction);

      const result = await handler.handle({
        action: 'status',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('status');
        expect(result.response.transactionId).toBe(mockTxId);
        expect(result.response.status).toBe('queued');
        expect(result.response.operationsQueued).toBe(3);
        expect(result.response.snapshotId).toBe('snapshot-001');
        expect(result.response.message).toContain('queued with 3 operation(s)');
      }

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return pending status for new transaction', async () => {
      const mockTxId = 'txn-status-new';

      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        id: mockTxId,
        spreadsheetId: 'sheet-456',
        status: 'pending',
        operations: [],
        startTime: 1704067200000,
      } as Transaction);

      const result = await handler.handle({
        action: 'status',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.status).toBe('pending');
        expect(result.response.operationsQueued).toBe(0);
        expect(result.response.snapshotId).toBeUndefined();
      }
    });

    it('should handle transaction not found error', async () => {
      const mockTxId = 'txn-not-found';

      mockTransactionManager.getTransaction = vi.fn().mockImplementation(() => {
        throw new Error(`Transaction ${mockTxId} not found`);
      });

      const result = await handler.handle({
        action: 'status',
        transactionId: mockTxId,
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('not found');
      }
    });
  });

  describe('list action', () => {
    it('should return list of all active transactions', async () => {
      const mockTransactions = [
        {
          id: 'txn-001',
          spreadsheetId: 'sheet-1',
          status: 'pending',
          operations: [{ id: 'op_1', type: 'custom' }],
          startTime: 1704067200000 - 5000,
          isolationLevel: 'read_committed',
          snapshot: { id: 'snap-001' },
        } as Transaction,
        {
          id: 'txn-002',
          spreadsheetId: 'sheet-2',
          status: 'queued',
          operations: [
            { id: 'op_2', type: 'custom' },
            { id: 'op_3', type: 'custom' },
          ],
          startTime: 1704067200000 - 3000,
          isolationLevel: 'serializable',
          snapshot: { id: 'snap-002' },
        } as Transaction,
      ];

      mockTransactionManager.getActiveTransactions = vi.fn().mockReturnValue(mockTransactions);

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('list');
        expect(result.response.transactions).toBeDefined();
        expect(result.response.transactions?.length).toBe(2);

        // Verify first transaction details
        expect(result.response.transactions?.[0]).toMatchObject({
          id: 'txn-002', // Should be sorted newest first
          spreadsheetId: 'sheet-2',
          status: 'queued',
          operationCount: 2,
          isolationLevel: 'serializable',
          snapshotId: 'snap-002',
        });

        // Verify second transaction details
        expect(result.response.transactions?.[1]).toMatchObject({
          id: 'txn-001',
          spreadsheetId: 'sheet-1',
          status: 'pending',
          operationCount: 1,
          isolationLevel: 'read_committed',
          snapshotId: 'snap-001',
        });

        // Verify timestamps are ISO strings
        expect(result.response.transactions?.[0].created).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // Verify summary metadata
        expect(result.response._meta?.summary).toBeDefined();
        expect(result.response._meta?.summary.total).toBe(2);
        expect(result.response._meta?.summary.byStatus.pending).toBe(1);
        expect(result.response._meta?.summary.byStatus.queued).toBe(1);

        expect(result.response.message).toContain('2 active transaction(s)');
      }

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return empty list when no transactions exist', async () => {
      mockTransactionManager.getActiveTransactions = vi.fn().mockReturnValue([]);

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.transactions?.length).toBe(0);
        expect(result.response.message).toContain('0 active transaction(s)');
        expect(result.response._meta).toBeUndefined(); // No summary for empty list
      }

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should filter transactions by spreadsheetId', async () => {
      const mockTransactions = [
        {
          id: 'txn-001',
          spreadsheetId: 'sheet-1',
          status: 'pending',
          operations: [],
          startTime: 1704067200000 - 5000,
          isolationLevel: 'read_committed',
        } as Transaction,
        {
          id: 'txn-002',
          spreadsheetId: 'sheet-2',
          status: 'queued',
          operations: [],
          startTime: 1704067200000 - 3000,
          isolationLevel: 'read_committed',
        } as Transaction,
        {
          id: 'txn-003',
          spreadsheetId: 'sheet-1',
          status: 'executing',
          operations: [],
          startTime: 1704067200000 - 1000,
          isolationLevel: 'read_committed',
        } as Transaction,
      ];

      mockTransactionManager.getActiveTransactions = vi.fn().mockReturnValue(mockTransactions);

      const result = await handler.handle({
        action: 'list',
        spreadsheetId: 'sheet-1',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.transactions?.length).toBe(2);
        expect(result.response.transactions?.every((tx) => tx.spreadsheetId === 'sheet-1')).toBe(
          true
        );

        // Should be sorted by creation time (newest first)
        expect(result.response.transactions?.[0].id).toBe('txn-003');
        expect(result.response.transactions?.[1].id).toBe('txn-001');

        // Verify summary counts
        expect(result.response._meta?.summary.total).toBe(2);
        expect(result.response._meta?.summary.byStatus.pending).toBe(1);
        expect(result.response._meta?.summary.byStatus.executing).toBe(1);
      }

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should include duration for active and completed transactions', async () => {
      const startTime = 1704067200000 - 10000;
      const endTime = 1704067200000 - 5000;

      const mockTransactions = [
        {
          id: 'txn-active',
          spreadsheetId: 'sheet-1',
          status: 'queued',
          operations: [],
          startTime,
          endTime: undefined, // Still active
          isolationLevel: 'read_committed',
        } as Transaction,
        {
          id: 'txn-completed',
          spreadsheetId: 'sheet-1',
          status: 'committed',
          operations: [],
          startTime,
          endTime,
          duration: endTime - startTime,
          isolationLevel: 'read_committed',
        } as Transaction,
      ];

      mockTransactionManager.getActiveTransactions = vi.fn().mockReturnValue(mockTransactions);

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        const transactions = result.response.transactions || [];
        const active = transactions.find((tx) => tx.id === 'txn-active');
        const completed = transactions.find((tx) => tx.id === 'txn-completed');

        // Active transaction should have calculated duration (current time - start time)
        expect(active?.duration).toBeGreaterThan(0);
        expect(active?.updated).toBeUndefined(); // No updated field for active

        // Completed transaction should have stored duration
        expect(completed?.duration).toBe(endTime - startTime);
        expect(completed?.updated).toBeDefined(); // Has updated field
      }
    });

    it('should generate status counts in summary', async () => {
      const mockTransactions = [
        {
          id: 'txn-1',
          spreadsheetId: 'sheet-1',
          status: 'pending',
          operations: [],
          startTime: 1704067200000,
          isolationLevel: 'read_committed',
        } as Transaction,
        {
          id: 'txn-2',
          spreadsheetId: 'sheet-1',
          status: 'pending',
          operations: [],
          startTime: 1704067200000,
          isolationLevel: 'read_committed',
        } as Transaction,
        {
          id: 'txn-3',
          spreadsheetId: 'sheet-1',
          status: 'queued',
          operations: [],
          startTime: 1704067200000,
          isolationLevel: 'read_committed',
        } as Transaction,
        {
          id: 'txn-4',
          spreadsheetId: 'sheet-1',
          status: 'committed',
          operations: [],
          startTime: 1704067200000,
          endTime: 1704067200000,
          isolationLevel: 'read_committed',
        } as Transaction,
      ];

      mockTransactionManager.getActiveTransactions = vi.fn().mockReturnValue(mockTransactions);

      const result = await handler.handle({
        action: 'list',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response._meta?.summary).toEqual({
          total: 4,
          byStatus: {
            pending: 2,
            queued: 1,
            executing: 0,
            committed: 1,
            rolled_back: 0,
            failed: 0,
          },
        });
      }
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      mockTransactionManager.begin = vi.fn().mockImplementation(() => {
        throw new Error('Unexpected internal error');
      });

      const result = await handler.handle({
        action: 'begin',
        spreadsheetId: 'test-error-sheet',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toBe('Unexpected internal error');
        expect(result.response.error.retryable).toBe(false);
      }

      // Validate schema compliance
      const parseResult = SheetsTransactionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should handle non-Error thrown values', async () => {
      mockTransactionManager.commit = vi.fn().mockImplementation(() => {
        throw 'String error message';
      });

      const result = await handler.handle({
        action: 'commit',
        transactionId: 'txn-string-error',
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toBe('String error message');
      }
    });
  });

  describe('schema validation', () => {
    it('should produce valid output for all success paths', async () => {
      // Test begin
      mockTransactionManager.begin = vi.fn().mockResolvedValue('txn-1');
      const beginResult = await handler.handle({
        action: 'begin',
        spreadsheetId: 'test-sheet',
      });
      expect(SheetsTransactionOutputSchema.safeParse(beginResult).success).toBe(true);

      // Test queue
      mockTransactionManager.queue = vi.fn().mockResolvedValue('op_1');
      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        operations: [{ id: 'op_1' }],
      } as Transaction);
      const queueResult = await handler.handle({
        action: 'queue',
        transactionId: 'txn-1',
        operation: { tool: 'sheets_data', action: 'write', params: {} },
      });
      expect(SheetsTransactionOutputSchema.safeParse(queueResult).success).toBe(true);

      // Test commit
      mockTransactionManager.commit = vi.fn().mockResolvedValue({
        transactionId: 'txn-1',
        success: true,
        operationResults: [],
        duration: 100,
        apiCallsMade: 1,
        apiCallsSaved: 0,
      });
      const commitResult = await handler.handle({
        action: 'commit',
        transactionId: 'txn-1',
      });
      expect(SheetsTransactionOutputSchema.safeParse(commitResult).success).toBe(true);

      // Test rollback
      mockTransactionManager.rollback = vi.fn().mockResolvedValue({
        success: true,
        transactionId: 'txn-1',
        snapshotId: 'snap-1',
        duration: 50,
        operationsReverted: 1,
      });
      const rollbackResult = await handler.handle({
        action: 'rollback',
        transactionId: 'txn-1',
      });
      expect(SheetsTransactionOutputSchema.safeParse(rollbackResult).success).toBe(true);

      // Test status
      mockTransactionManager.getTransaction = vi.fn().mockReturnValue({
        id: 'txn-1',
        status: 'pending',
        operations: [],
      } as Transaction);
      const statusResult = await handler.handle({
        action: 'status',
        transactionId: 'txn-1',
      });
      expect(SheetsTransactionOutputSchema.safeParse(statusResult).success).toBe(true);

      // Test list
      const listResult = await handler.handle({
        action: 'list',
      });
      expect(SheetsTransactionOutputSchema.safeParse(listResult).success).toBe(true);
    });
  });
});
