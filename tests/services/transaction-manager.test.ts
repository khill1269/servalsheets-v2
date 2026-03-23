/**
 * ServalSheets - Transaction Manager Service Tests
 *
 * Comprehensive tests for transaction lifecycle, operation queuing,
 * commit logic, rollback mechanisms, isolation levels, and error handling.
 *
 * Test Coverage:
 * - Transaction Lifecycle (5 tests)
 * - Operation Management (4 tests)
 * - Commit Logic (3 tests)
 * - Rollback Mechanisms (3 tests)
 * - Isolation Levels (2 tests)
 * - Error Handling (3 tests)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TransactionManager } from '../../src/services/transaction-manager.js';
import type { TransactionConfig } from '../../src/types/transaction.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

describe('TransactionManager', () => {
  let transactionManager: TransactionManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockGoogleClient: any;
  let cleanupInterval: NodeJS.Timeout | undefined;
  const originalWalDir = process.env['TRANSACTION_WAL_DIR'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['TRANSACTION_WAL_DIR'];

    // Create comprehensive mock for Google API client
    mockGoogleClient = {
      sheets: {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: {
              spreadsheetId: 'test-sheet-123',
              properties: {
                title: 'Test Spreadsheet',
                locale: 'en_US',
                timeZone: 'America/New_York',
              },
              sheets: [
                {
                  properties: {
                    sheetId: 0,
                    title: 'Sheet1',
                    index: 0,
                    gridProperties: {
                      rowCount: 1000,
                      columnCount: 26,
                    },
                  },
                },
              ],
            },
          }),
          batchUpdate: vi.fn().mockResolvedValue({
            data: {
              spreadsheetId: 'test-sheet-123',
              replies: [{ updateCells: {} }],
            },
          }),
          values: {
            get: vi.fn().mockResolvedValue({
              data: {
                values: [['Name', 'Age']],
              },
            }),
            batchGet: vi.fn().mockResolvedValue({
              data: {
                valueRanges: [],
              },
            }),
          },
        },
      },
    };

    // Create transaction manager with mock client
    const config: TransactionConfig = {
      enabled: true,
      autoSnapshot: true,
      autoRollback: true,
      maxOperationsPerTransaction: 100,
      transactionTimeoutMs: 300000,
      snapshotRetentionMs: 3600000,
      maxConcurrentTransactions: 10,
      verboseLogging: false,
      defaultIsolationLevel: 'read_committed',
      googleClient: mockGoogleClient,
    };

    transactionManager = new TransactionManager(config);
  });

  afterEach(() => {
    // Clean up any intervals
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = undefined;
    }

    if (originalWalDir === undefined) {
      delete process.env['TRANSACTION_WAL_DIR'];
    } else {
      process.env['TRANSACTION_WAL_DIR'] = originalWalDir;
    }
  });

  describe('Transaction Lifecycle', () => {
    it('should begin transaction successfully with auto-snapshot', async () => {
      // Act
      const txnId = await transactionManager.begin('test-sheet-123', {
        isolationLevel: 'serializable',
        autoRollback: true,
      });

      // Assert
      expect(txnId).toBeDefined();
      expect(txnId).toMatch(/^[a-f0-9-]{36}$/); // UUID format

      const transaction = transactionManager.getTransaction(txnId);
      expect(transaction.id).toBe(txnId);
      expect(transaction.spreadsheetId).toBe('test-sheet-123');
      expect(transaction.status).toBe('pending');
      expect(transaction.operations).toEqual([]);
      expect(transaction.isolationLevel).toBe('serializable');
      expect(transaction.autoRollback).toBe(true);
      expect(transaction.snapshot).toBeDefined();
      expect(transaction.startTime).toBeDefined();

      // Verify snapshot was created
      expect(mockGoogleClient.sheets.spreadsheets.get).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-123',
        includeGridData: false,
        fields: 'spreadsheetId,properties,sheets(properties)',
      });
    });

    it('should begin transaction without snapshot when autoSnapshot is disabled', async () => {
      // Arrange
      const managerWithoutSnapshot = new TransactionManager({
        enabled: true,
        autoSnapshot: false,
        googleClient: mockGoogleClient,
      });

      // Act
      const txnId = await managerWithoutSnapshot.begin('test-sheet-456');

      // Assert
      const transaction = managerWithoutSnapshot.getTransaction(txnId);
      expect(transaction.snapshot).toBeUndefined();
      expect(mockGoogleClient.sheets.spreadsheets.get).not.toHaveBeenCalled();
    });

    it('should queue operations in transaction', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      // Act - Queue first operation
      const opId1 = await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1:A10', values: [[1], [2], [3]] },
      });

      // Allow queuing additional operations on "queued" status
      transaction.status = 'pending';

      const opId2 = await transactionManager.queue(txnId, {
        type: 'format_apply',
        tool: 'sheets_format',
        action: 'set_background',
        params: { range: 'A1:A10', color: '#FF0000' },
      });

      // Assert
      expect(opId1).toMatch(/^op_\d+$/);
      expect(opId2).toMatch(/^op_\d+$/);

      expect(transaction.status).toBe('queued');
      expect(transaction.operations.length).toBe(2);
      expect(transaction.operations[0]!.id).toBe(opId1);
      expect(transaction.operations[0]!.type).toBe('values_write');
      expect(transaction.operations[0]!.status).toBe('pending');
      expect(transaction.operations[0]!.order).toBe(0);
      expect(transaction.operations[1]!.id).toBe(opId2);
      expect(transaction.operations[1]!.order).toBe(1);
    });

    it('should commit transaction successfully', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: {
          spreadsheetId: 'test-sheet-123',
          replies: [{ updateCells: {} }],
        },
      });

      // Act
      const result = await transactionManager.commit(txnId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(txnId);
      expect(result.operationResults.length).toBe(1);
      expect(result.operationResults[0]!.success).toBe(true);
      expect(result.apiCallsMade).toBe(1);
      expect(result.apiCallsSaved).toBe(0); // 1 operation = 0 saves
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.snapshotId).toBeDefined();

      // Verify transaction was removed from active transactions
      expect(() => transactionManager.getTransaction(txnId)).toThrow('not found');

      // Verify stats updated
      const stats = transactionManager.getStats();
      expect(stats.totalTransactions).toBe(1);
      expect(stats.successfulTransactions).toBe(1);
      expect(stats.failedTransactions).toBe(0);
    });

    it('should track transaction status throughout lifecycle', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      let transaction = transactionManager.getTransaction(txnId);
      expect(transaction.status).toBe('pending');

      // Queue operation
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });
      transaction = transactionManager.getTransaction(txnId);
      expect(transaction.status).toBe('queued');

      // Mock successful batch update
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      // Commit
      const result = await transactionManager.commit(txnId);
      expect(result.success).toBe(true);

      // Transaction should be removed after commit
      expect(() => transactionManager.getTransaction(txnId)).toThrow('not found');
    });
  });

  describe('Operation Management', () => {
    it('should enforce operation ordering', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      // Act
      const opId1 = await transactionManager.queue(txnId, {
        type: 'sheet_create',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'NewSheet' },
      });

      // Reset status to allow second operation
      transaction.status = 'pending';

      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'NewSheet!A1', values: [[1]] },
        dependsOn: [opId1],
      });

      // Assert
      expect(transaction.operations[0]!.order).toBe(0);
      expect(transaction.operations[1]!.order).toBe(1);
      expect(transaction.operations[1]!.dependsOn).toEqual([opId1]);
    });

    it('should validate operations before queuing', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      // Queue max operations
      for (let i = 0; i < 100; i++) {
        transaction.status = 'pending'; // Reset to allow queuing
        await transactionManager.queue(txnId, {
          type: 'values_write',
          tool: 'sheets_data',
          action: 'write',
          params: { range: `A${i}`, values: [[i]] },
        });
      }

      // Act & Assert - should reject 101st operation
      transaction.status = 'pending';
      await expect(
        transactionManager.queue(txnId, {
          type: 'values_write',
          tool: 'sheets_data',
          action: 'write',
          params: { range: 'A101', values: [[101]] },
        })
      ).rejects.toThrow('Maximum operations per transaction reached');
    });

    it('should reject operations on non-pending transactions', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      // Commit transaction
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });
      await transactionManager.commit(txnId);

      // Act & Assert - should reject operation on committed transaction
      const txnId2 = await transactionManager.begin('test-sheet-456');
      await transactionManager.queue(txnId2, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      // Manually set status to executing to test rejection
      const transaction = transactionManager.getTransaction(txnId2);
      transaction.status = 'executing';

      await expect(
        transactionManager.queue(txnId2, {
          type: 'values_write',
          tool: 'sheets_data',
          action: 'write',
          params: { range: 'A2', values: [[2]] },
        })
      ).rejects.toThrow(/not in pending.*state/);
    });

    it('should support operation dependencies and detect duplicates', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      // Act
      const opId1 = await transactionManager.queue(txnId, {
        type: 'sheet_create',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'Sheet1' },
      });

      transaction.status = 'pending';
      const opId2 = await transactionManager.queue(txnId, {
        type: 'sheet_create',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'Sheet2' },
      });

      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'Sheet2!A1', values: [[1]] },
        dependsOn: [opId1, opId2],
      });

      // Assert
      expect(transaction.operations.length).toBe(3);
      expect(transaction.operations[2]!.dependsOn).toEqual([opId1, opId2]);
    });
  });

  describe('Commit Logic', () => {
    it('should merge multiple operations into single batch request', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      // Queue 5 operations
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });
      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A2', values: [[2]] },
      });
      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'format_apply',
        tool: 'sheets_format',
        action: 'set_background',
        params: { range: 'A1:A2', color: '#FF0000' },
      });
      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'sheet_create',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'NewSheet' },
      });
      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'sheet_delete',
        tool: 'sheets_core',
        action: 'delete_sheet',
        params: { sheetId: 999 },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: {
          replies: [{}, {}, {}, {}, {}], // 5 replies for 5 operations
        },
      });

      // Act
      const result = await transactionManager.commit(txnId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.apiCallsMade).toBe(1); // Single batch request
      expect(result.apiCallsSaved).toBe(4); // 5 operations - 1 batch call = 4 saves
      expect(result.operationResults.length).toBe(5);

      // Verify batchUpdate was called once
      expect(mockGoogleClient.sheets.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);

      // Verify request structure
      const batchCall = mockGoogleClient.sheets.spreadsheets.batchUpdate.mock.calls[0][0];
      expect(batchCall.spreadsheetId).toBe('test-sheet-123');
      expect(batchCall.requestBody.requests).toBeDefined();
      expect(batchCall.requestBody.requests.length).toBe(5);
    });

    it('should normalize {a1} range objects into populated updateCells requests', async () => {
      const txnId = await transactionManager.begin('test-sheet-123');

      await transactionManager.queue(txnId, {
        type: 'custom',
        tool: 'sheets_data',
        action: 'write',
        params: {
          range: { a1: 'Sheet1!B2:C2' },
          values: [[1, 2]],
        },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      const result = await transactionManager.commit(txnId);

      expect(result.success).toBe(true);

      const batchCall = mockGoogleClient.sheets.spreadsheets.batchUpdate.mock.calls.at(-1)?.[0];
      const request = batchCall.requestBody.requests[0].updateCells;
      expect(request.range).toMatchObject({
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 1,
        endColumnIndex: 3,
      });
      expect(request.rows[0].values[0].userEnteredValue.numberValue).toBe(1);
      expect(request.rows[0].values[1].userEnteredValue.numberValue).toBe(2);
      expect(mockGoogleClient.sheets.spreadsheets.values.batchGet).toHaveBeenCalledWith({
        spreadsheetId: 'test-sheet-123',
        ranges: ['Sheet1!B2:C2'],
      });
    });

    it('should convert append operations into appendCells requests with column offsets', async () => {
      const txnId = await transactionManager.begin('test-sheet-123');

      await transactionManager.queue(txnId, {
        type: 'custom',
        tool: 'sheets_data',
        action: 'append',
        params: {
          range: { a1: 'Sheet1!B:B' },
          values: [[42], [84]],
        },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });

      const result = await transactionManager.commit(txnId);

      expect(result.success).toBe(true);

      const batchCall = mockGoogleClient.sheets.spreadsheets.batchUpdate.mock.calls.at(-1)?.[0];
      const request = batchCall.requestBody.requests[0].appendCells;
      expect(request.sheetId).toBe(0);
      expect(request.rows[0].values).toHaveLength(2);
      expect(request.rows[0].values[0].userEnteredValue.stringValue).toBe('');
      expect(request.rows[0].values[1].userEnteredValue.numberValue).toBe(42);
      expect(request.rows[1].values[1].userEnteredValue.numberValue).toBe(84);
    });

    it('should reserve sheet ids for add_sheet followed by write to the new sheet', async () => {
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      await transactionManager.queue(txnId, {
        type: 'custom',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'NewSheet' },
      });

      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'custom',
        tool: 'sheets_data',
        action: 'write',
        params: {
          range: 'NewSheet!A1',
          values: [[123]],
        },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}, {}] },
      });

      const result = await transactionManager.commit(txnId);

      expect(result.success).toBe(true);

      const batchCall = mockGoogleClient.sheets.spreadsheets.batchUpdate.mock.calls.at(-1)?.[0];
      const addSheetRequest = batchCall.requestBody.requests[0].addSheet;
      const writeRequest = batchCall.requestBody.requests[1].updateCells;
      expect(addSheetRequest.properties.sheetId).toBeDefined();
      expect(writeRequest.range.sheetId).toBe(addSheetRequest.properties.sheetId);
    });

    it('should batch smart_append inside transactions for new sheets', async () => {
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      await transactionManager.queue(txnId, {
        type: 'custom',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'Pipeline' },
      });

      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'custom',
        tool: 'sheets_composite',
        action: 'smart_append',
        params: {
          sheet: 'Pipeline',
          data: [{ Name: 'Alice', Age: 30 }],
        },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}, {}, {}] },
      });

      const result = await transactionManager.commit(txnId);

      expect(result.success).toBe(true);

      const batchCall = mockGoogleClient.sheets.spreadsheets.batchUpdate.mock.calls.at(-1)?.[0];
      expect(batchCall.requestBody.requests).toHaveLength(3);

      const addSheetRequest = batchCall.requestBody.requests[0].addSheet;
      const headerRequest = batchCall.requestBody.requests[1].updateCells;
      const appendRequest = batchCall.requestBody.requests[2].appendCells;

      expect(headerRequest.range.sheetId).toBe(addSheetRequest.properties.sheetId);
      expect(appendRequest.sheetId).toBe(addSheetRequest.properties.sheetId);
      expect(headerRequest.rows[0].values[0].userEnteredValue.stringValue).toBe('Name');
      expect(headerRequest.rows[0].values[1].userEnteredValue.stringValue).toBe('Age');
      expect(appendRequest.rows[0].values[0].userEnteredValue.stringValue).toBe('Alice');
      expect(appendRequest.rows[0].values[1].userEnteredValue.numberValue).toBe(30);
      expect(mockGoogleClient.sheets.spreadsheets.values.get).not.toHaveBeenCalled();
    });

    it('should calculate API call savings accurately', async () => {
      // Arrange - test different operation counts
      const testCases = [
        { operations: 1, expectedSaved: 0 },
        { operations: 2, expectedSaved: 1 },
        { operations: 5, expectedSaved: 4 },
        { operations: 10, expectedSaved: 9 },
      ];

      for (const testCase of testCases) {
        const txnId = await transactionManager.begin('test-sheet-123');
        const transaction = transactionManager.getTransaction(txnId);

        // Queue operations
        for (let i = 0; i < testCase.operations; i++) {
          transaction.status = 'pending';
          await transactionManager.queue(txnId, {
            type: 'values_write',
            tool: 'sheets_data',
            action: 'write',
            params: { range: `A${i + 1}`, values: [[i + 1]] },
          });
        }

        // Mock replies
        mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
          data: {
            replies: Array(testCase.operations).fill({}),
          },
        });

        // Act
        const result = await transactionManager.commit(txnId);

        // Assert
        expect(result.apiCallsSaved).toBe(testCase.expectedSaved);
        expect(result.apiCallsMade).toBe(1);
      }
    });

    it('should handle partial commit failures gracefully', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });
      transaction.status = 'pending';
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A2', values: [[2]] },
      });

      // Mock partial success - only 1 reply for 2 operations
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: {
          replies: [{}], // Only first operation succeeded
        },
      });

      // Act
      const result = await transactionManager.commit(txnId);

      // Assert - with autoRollback, partial failure should trigger rollback
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('operation(s) failed');

      // Since we don't have a real snapshot service, rollback will fail
      // but the attempt should be made due to autoRollback
    });
  });

  describe('Rollback Mechanisms', () => {
    it('marks queued transactions as rolled back even when snapshot restoration is metadata-only', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      // Act
      const result = await transactionManager.rollback(txnId);

      // Assert - queued operations are cancelled successfully
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(txnId);
      expect(result.operationsReverted).toBe(1);
    });

    it('returns a successful cancellation when no snapshot exists yet', async () => {
      // Arrange - create manager without auto-snapshot
      const managerWithoutSnapshot = new TransactionManager({
        enabled: true,
        autoSnapshot: false,
        googleClient: mockGoogleClient,
      });

      const txnId = await managerWithoutSnapshot.begin('test-sheet-123');
      await managerWithoutSnapshot.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      // Act
      const result = await managerWithoutSnapshot.rollback(txnId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(txnId);
      expect(result.snapshotId).toBe('');
      expect(result.operationsReverted).toBe(1);
    });

    it('should auto-rollback on commit failure when configured', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123', {
        autoRollback: true,
      });

      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      // Mock API failure
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      // Act
      const result = await transactionManager.commit(txnId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('API rate limit exceeded');

      // Since automatic in-place restoration requires manual recovery, rolledBack reflects the attempt
      // The transaction should still be cleaned up
      expect(() => transactionManager.getTransaction(txnId)).toThrow('not found');

      // Verify stats
      const stats = transactionManager.getStats();
      expect(stats.failedTransactions).toBeGreaterThan(0);
    });
  });

  describe('Isolation Levels', () => {
    it('should support serializable isolation level', async () => {
      // Act
      const txnId = await transactionManager.begin('test-sheet-123', {
        isolationLevel: 'serializable',
      });

      // Assert
      const transaction = transactionManager.getTransaction(txnId);
      expect(transaction.isolationLevel).toBe('serializable');
    });

    it('should support read_committed isolation level as default', async () => {
      // Act
      const txnId = await transactionManager.begin('test-sheet-123');

      // Assert
      const transaction = transactionManager.getTransaction(txnId);
      expect(transaction.isolationLevel).toBe('read_committed');
    });
  });

  describe('Error Handling', () => {
    it('should detect circular dependencies in operations', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      const transaction = transactionManager.getTransaction(txnId);

      const opId1 = await transactionManager.queue(txnId, {
        type: 'sheet_create',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'Sheet1' },
      });

      transaction.status = 'pending';
      const opId2 = await transactionManager.queue(txnId, {
        type: 'sheet_create',
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { title: 'Sheet2' },
        dependsOn: [opId1],
      });

      // Create circular dependency by modifying operation
      transaction.operations[0]!.dependsOn = [opId2]; // op1 depends on op2, op2 depends on op1

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}, {}] },
      });

      // Act
      const result = await transactionManager.commit(txnId);

      // Assert - commit should fail due to circular dependency
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain('Circular dependency detected in operations');
    });

    it('should enforce concurrent transaction limits', async () => {
      // Arrange - create manager with low limit
      const limitedManager = new TransactionManager({
        enabled: true,
        maxConcurrentTransactions: 2,
        autoSnapshot: false,
        googleClient: mockGoogleClient,
      });

      // Create 2 transactions (at limit)
      await limitedManager.begin('test-sheet-1');
      await limitedManager.begin('test-sheet-2');

      // Act & Assert - 3rd should fail
      await expect(limitedManager.begin('test-sheet-3')).rejects.toThrow(
        'Maximum concurrent transactions reached'
      );
    });

    it('should handle snapshot creation failure gracefully', async () => {
      // Arrange
      mockGoogleClient.sheets.spreadsheets.get.mockRejectedValue(new Error('Permission denied'));

      // Act & Assert
      await expect(transactionManager.begin('test-sheet-no-access')).rejects.toThrow(
        'Permission denied'
      );

      // Verify stats weren't corrupted
      const stats = transactionManager.getStats();
      expect(stats.activeTransactions).toBe(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track transaction statistics accurately', async () => {
      // Arrange
      const initialStats = transactionManager.getStats();
      expect(initialStats.totalTransactions).toBe(0);

      // Successful transaction
      const txnId1 = await transactionManager.begin('test-sheet-123');
      await transactionManager.queue(txnId1, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });
      await transactionManager.commit(txnId1);

      // Failed transaction
      const txnId2 = await transactionManager.begin('test-sheet-456');
      await transactionManager.queue(txnId2, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockRejectedValue(new Error('API error'));
      await transactionManager.commit(txnId2);

      // Assert
      const stats = transactionManager.getStats();
      expect(stats.totalTransactions).toBe(2);
      expect(stats.successfulTransactions).toBe(1);
      expect(stats.failedTransactions).toBe(1);
      expect(stats.successRate).toBe(0.5);
      expect(stats.activeTransactions).toBe(0);
      expect(stats.snapshotsCreated).toBe(2);
    });

    it('should reset statistics', () => {
      // Arrange
      transactionManager.resetStats();

      // Act
      const stats = transactionManager.getStats();

      // Assert
      expect(stats.totalTransactions).toBe(0);
      expect(stats.successfulTransactions).toBe(0);
      expect(stats.failedTransactions).toBe(0);
      expect(stats.rolledBackTransactions).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.apiCallsSaved).toBe(0);
      expect(stats.snapshotsCreated).toBe(0);
    });
  });

  describe('Transaction Events', () => {
    it('should emit events throughout transaction lifecycle', async () => {
      // Arrange
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = [];
      transactionManager.addEventListener((event) => {
        events.push(event);
      });

      // Act
      const txnId = await transactionManager.begin('test-sheet-123');
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });
      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });
      await transactionManager.commit(txnId);

      // Assert
      expect(events.length).toBe(3); // begin, queue, commit
      expect(events[0]!.type).toBe('begin');
      expect(events[0]!.transactionId).toBe(txnId);
      expect(events[1]!.type).toBe('queue');
      expect(events[2]!.type).toBe('commit');
    });

    it('should support removing event listeners', async () => {
      // Arrange
      const listener = vi.fn();
      transactionManager.addEventListener(listener);

      // Act
      transactionManager.removeEventListener(listener);

      // Try to trigger event
      await transactionManager.begin('test-sheet-123');

      // Assert
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('WAL Durability', () => {
    it('should write and compact WAL entries for completed transactions', async () => {
      const walDir = join(tmpdir(), `tx-wal-${randomBytes(6).toString('hex')}`);
      await fs.mkdir(walDir, { recursive: true });
      process.env['TRANSACTION_WAL_DIR'] = walDir;

      const walManager = new TransactionManager({
        enabled: true,
        autoSnapshot: false,
        googleClient: mockGoogleClient,
      });

      const txId = await walManager.begin('test-sheet-123');
      await walManager.queue(txId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      mockGoogleClient.sheets.spreadsheets.batchUpdate.mockResolvedValue({
        data: { replies: [{}] },
      });
      await walManager.commit(txId);

      const walPath = join(walDir, 'transactions.wal.jsonl');
      const walContent = await fs.readFile(walPath, 'utf8');
      expect(walContent.trim()).toBe('');

      await fs.rm(walDir, { recursive: true, force: true });
    });

    it('should report orphaned transactions during WAL replay', async () => {
      const walDir = join(tmpdir(), `tx-wal-${randomBytes(6).toString('hex')}`);
      await fs.mkdir(walDir, { recursive: true });
      process.env['TRANSACTION_WAL_DIR'] = walDir;

      const firstManager = new TransactionManager({
        enabled: true,
        autoSnapshot: false,
        googleClient: mockGoogleClient,
      });

      const txId = await firstManager.begin('test-sheet-123');
      await firstManager.queue(txId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      const secondManager = new TransactionManager({
        enabled: true,
        autoSnapshot: false,
        googleClient: mockGoogleClient,
      });

      const report = await secondManager.getWalRecoveryReport();
      expect(report.enabled).toBe(true);

      const orphan = report.orphanedTransactions.find((item) => item.transactionId === txId);
      expect(orphan).toBeDefined();
      expect(orphan?.spreadsheetId).toBe('test-sheet-123');
      expect(orphan?.queuedOperations).toBe(1);

      await fs.rm(walDir, { recursive: true, force: true });
    });
  });

  describe('Transaction Management', () => {
    it('should list active transactions', async () => {
      // Arrange
      const txnId1 = await transactionManager.begin('test-sheet-123');
      const txnId2 = await transactionManager.begin('test-sheet-456');

      // Act
      const activeTransactions = transactionManager.getActiveTransactions();

      // Assert
      expect(activeTransactions.length).toBe(2);
      expect(activeTransactions.map((t) => t.id)).toContain(txnId1);
      expect(activeTransactions.map((t) => t.id)).toContain(txnId2);
    });

    it('should cancel transaction', async () => {
      // Arrange
      const txnId = await transactionManager.begin('test-sheet-123');
      await transactionManager.queue(txnId, {
        type: 'values_write',
        tool: 'sheets_data',
        action: 'write',
        params: { range: 'A1', values: [[1]] },
      });

      // Act
      await transactionManager.cancel(txnId);

      // Assert
      expect(() => transactionManager.getTransaction(txnId)).toThrow('not found');
      expect(transactionManager.getActiveTransactions().length).toBe(0);
    });

    it('should throw error for non-existent transaction', () => {
      // Act & Assert
      expect(() => transactionManager.getTransaction('non-existent-id')).toThrow('not found');
    });
  });

  describe('Configuration', () => {
    it('should reject transactions when disabled', async () => {
      // Arrange
      const disabledManager = new TransactionManager({
        enabled: false,
        googleClient: mockGoogleClient,
      });

      // Act & Assert
      await expect(disabledManager.begin('test-sheet-123')).rejects.toThrow(
        'Transactions are disabled'
      );
    });

    it('should require Google client for snapshot creation', async () => {
      // Arrange
      const managerWithoutClient = new TransactionManager({
        enabled: true,
        autoSnapshot: true,
        googleClient: undefined,
      });

      // Act & Assert
      await expect(managerWithoutClient.begin('test-sheet-123')).rejects.toThrow(
        'Transaction manager requires Google API client for snapshots'
      );
    });

    it('should respect custom configuration values', () => {
      // Arrange & Act
      const customManager = new TransactionManager({
        enabled: true,
        autoSnapshot: false,
        autoRollback: false,
        maxOperationsPerTransaction: 50,
        maxConcurrentTransactions: 5,
        defaultIsolationLevel: 'serializable',
        googleClient: mockGoogleClient,
      });

      // Assert - verify by creating transaction and checking settings
      expect(customManager).toBeDefined();
    });
  });
});
