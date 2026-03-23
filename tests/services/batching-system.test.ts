/**
 * Tests for BatchingSystem
 *
 * Comprehensive test suite for the batch request time windows system.
 * Tests batching logic, operation aggregation, efficiency metrics, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BatchingSystem,
  AdaptiveBatchWindow,
  type BatchableOperationType,
} from '../../src/services/batching-system.js';
import type { sheets_v4 } from 'googleapis';

describe('BatchingSystem', () => {
  let batchingSystem: BatchingSystem;
  let mockSheetsApi: sheets_v4.Sheets;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock Google Sheets API
    mockSheetsApi = {
      spreadsheets: {
        get: vi.fn(),
        batchUpdate: vi.fn(),
        values: {
          update: vi.fn(),
          append: vi.fn(),
          clear: vi.fn(),
          batchUpdate: vi.fn(),
          batchClear: vi.fn(),
          get: vi.fn(),
          batchGet: vi.fn(),
        },
      },
    } as any;

    // Default: disable adaptive window for predictable tests
    batchingSystem = new BatchingSystem(mockSheetsApi, {
      enabled: true,
      windowMs: 50,
      maxBatchSize: 100,
      adaptiveWindow: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    batchingSystem.destroy();
  });

  describe('Batch Aggregation and Time Windows', () => {
    it('should collect operations within time window and execute as single batch', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-1';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          responses: [{ updatedCells: 1 }, { updatedCells: 1 }, { updatedCells: 1 }],
        },
      });

      // Act - queue 3 update operations within time window
      const promises = [
        batchingSystem.execute({
          id: 'op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'Sheet1!A1', values: [[1]] },
        }),
        batchingSystem.execute({
          id: 'op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'Sheet1!A2', values: [[2]] },
        }),
        batchingSystem.execute({
          id: 'op3',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'Sheet1!A3', values: [[3]] },
        }),
      ];

      // Advance timer to trigger batch execution
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(promises);

      // Assert - should make single batched call
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId,
        requestBody: {
          data: [
            { range: 'Sheet1!A1', values: [[1]] },
            { range: 'Sheet1!A2', values: [[2]] },
            { range: 'Sheet1!A3', values: [[3]] },
          ],
          valueInputOption: 'USER_ENTERED',
        },
      });
    });

    it('should execute batch immediately when maxBatchSize is reached', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-2';
      const smallBatchSystem = new BatchingSystem(mockSheetsApi, {
        enabled: true,
        windowMs: 1000,
        maxBatchSize: 3,
        adaptiveWindow: false,
      });

      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          responses: [{ updatedCells: 1 }, { updatedCells: 1 }, { updatedCells: 1 }],
        },
      });

      // Act - queue exactly 3 operations (maxBatchSize)
      const promises = [
        smallBatchSystem.execute({
          id: 'op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'Sheet1!A1', values: [[1]] },
        }),
        smallBatchSystem.execute({
          id: 'op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'Sheet1!A2', values: [[2]] },
        }),
        smallBatchSystem.execute({
          id: 'op3',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'Sheet1!A3', values: [[3]] },
        }),
      ];

      // Don't advance timer - should execute immediately
      await Promise.all(promises);

      // Assert - should have executed without waiting for timer
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);

      smallBatchSystem.destroy();
    });

    it('should batch operations by spreadsheet and operation type', async () => {
      // Arrange
      const spreadsheet1 = 'sheet-1';
      const spreadsheet2 = 'sheet-2';

      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{ updatedCells: 1 }, { updatedCells: 1 }] },
      });

      mockSheetsApi.spreadsheets.values.batchClear = vi.fn().mockResolvedValue({
        data: { clearedRanges: ['A1', 'A2'] },
      });

      // Act - queue operations for different spreadsheets and types
      const updatePromises = [
        batchingSystem.execute({
          id: 'update1',
          type: 'values:update',
          spreadsheetId: spreadsheet1,
          params: { range: 'Sheet1!A1', values: [[1]] },
        }),
        batchingSystem.execute({
          id: 'update2',
          type: 'values:update',
          spreadsheetId: spreadsheet1,
          params: { range: 'Sheet1!A2', values: [[2]] },
        }),
      ];

      const clearPromises = [
        batchingSystem.execute({
          id: 'clear1',
          type: 'values:clear',
          spreadsheetId: spreadsheet1,
          params: { range: 'Sheet2!A1' },
        }),
        batchingSystem.execute({
          id: 'clear2',
          type: 'values:clear',
          spreadsheetId: spreadsheet1,
          params: { range: 'Sheet2!A2' },
        }),
      ];

      const spreadsheet2Promises = [
        batchingSystem.execute({
          id: 'update3',
          type: 'values:update',
          spreadsheetId: spreadsheet2,
          params: { range: 'Sheet1!A1', values: [[3]] },
        }),
      ];

      // Advance timer to trigger all batches
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([...updatePromises, ...clearPromises, ...spreadsheet2Promises]);

      // Assert - should create separate batches for different spreadsheet+type combinations
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(2); // sheet-1 and sheet-2
      expect(mockSheetsApi.spreadsheets.values.batchClear).toHaveBeenCalledTimes(1);
    });

    it('should handle empty batches gracefully', async () => {
      // Arrange - create batch but don't add any operations
      const batchKey = 'test-sheet-1:values:update';

      // Act - try to execute empty batch
      await (batchingSystem as any).executeBatch(batchKey);

      // Assert - should not throw or make API calls
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });

    it('should cancel timer and clear batch after execution', async () => {
      // Arrange
      const spreadsheetId = 'test-sheet-3';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{ updatedCells: 1 }] },
      });

      // Act
      const promise = batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'Sheet1!A1', values: [[1]] },
      });

      await vi.advanceTimersByTimeAsync(50);
      await promise;

      // Assert - batch should be cleared after execution
      const pendingBatches = (batchingSystem as any).pendingBatches;
      const batchTimers = (batchingSystem as any).batchTimers;
      expect(pendingBatches.size).toBe(0);
      expect(batchTimers.size).toBe(0);
    });
  });

  describe('Values Append Batching', () => {
    it('should batch multiple appends into single batchUpdate with appendCells', async () => {
      // Arrange
      const spreadsheetId = 'append-test';
      mockSheetsApi.spreadsheets.get = vi.fn().mockResolvedValue({
        data: {
          sheets: [
            { properties: { sheetId: 0, title: 'Sheet1' } },
            { properties: { sheetId: 1, title: 'Sheet2' } },
          ],
        },
      });

      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [{ appendCells: {} }, { appendCells: {} }, { appendCells: {} }],
        },
      });

      // Act - queue 3 append operations
      const promises = [
        batchingSystem.execute({
          id: 'append1',
          type: 'values:append',
          spreadsheetId,
          params: { range: 'Sheet1!A1', values: [[1, 2]] },
        }),
        batchingSystem.execute({
          id: 'append2',
          type: 'values:append',
          spreadsheetId,
          params: { range: 'Sheet1!A2', values: [[3, 4]] },
        }),
        batchingSystem.execute({
          id: 'append3',
          type: 'values:append',
          spreadsheetId,
          params: { range: 'Sheet2!A1', values: [[5, 6]] },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      const results = await Promise.all(promises);

      // Assert - should fetch metadata and use batchUpdate with appendCells
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledWith({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))',
      });

      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
      const batchCall = (mockSheetsApi.spreadsheets.batchUpdate as any).mock.calls[0][0];
      expect(batchCall.requestBody.requests).toHaveLength(3);
      expect(batchCall.requestBody.requests[0]).toHaveProperty('appendCells');
      expect(batchCall.requestBody.requests[0].appendCells.sheetId).toBe(0);
      expect(batchCall.requestBody.requests[2].appendCells.sheetId).toBe(1);

      // Assert - results should be in UpdateValuesResponse format
      expect(results[0]).toHaveProperty('updates');
      expect(results[0].updates.updatedRows).toBe(1);
      expect(results[0].updates.updatedColumns).toBe(2);
    });

    it('should batch tableId appends without metadata lookup', async () => {
      const spreadsheetId = 'append-table';
      mockSheetsApi.spreadsheets.get = vi.fn();
      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [{ appendCells: {} }, { appendCells: {} }],
        },
      });

      const promises = [
        batchingSystem.execute({
          id: 'table-append-1',
          type: 'values:append',
          spreadsheetId,
          params: { tableId: 'table-1', values: [[1, 2]] },
        }),
        batchingSystem.execute({
          id: 'table-append-2',
          type: 'values:append',
          spreadsheetId,
          params: { tableId: 'table-2', values: [[3, 4]] },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(promises);

      expect(mockSheetsApi.spreadsheets.get).not.toHaveBeenCalled();
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
      const batchCall = (mockSheetsApi.spreadsheets.batchUpdate as any).mock.calls[0][0];
      expect(batchCall.requestBody.requests[0].appendCells.tableId).toBe('table-1');
      expect(batchCall.requestBody.requests[1].appendCells.tableId).toBe('table-2');
    });

    it('should distribute append responses correctly to callers', async () => {
      // Arrange
      const spreadsheetId = 'append-test-2';
      mockSheetsApi.spreadsheets.get = vi.fn().mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [{ appendCells: {} }, { appendCells: {} }],
        },
      });

      // Act
      const promise1 = batchingSystem.execute({
        id: 'append1',
        type: 'values:append',
        spreadsheetId,
        params: { range: 'Sheet1!A1', values: [[1, 2, 3]] },
      });

      const promise2 = batchingSystem.execute({
        id: 'append2',
        type: 'values:append',
        spreadsheetId,
        params: { range: 'Sheet1!B1', values: [[4], [5]] },
      });

      await vi.advanceTimersByTimeAsync(50);
      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Assert - each result should reflect its own operation
      expect(result1.updates.updatedRows).toBe(1);
      expect(result1.updates.updatedColumns).toBe(3);
      expect(result1.updates.updatedCells).toBe(3);

      expect(result2.updates.updatedRows).toBe(2);
      expect(result2.updates.updatedColumns).toBe(1);
      expect(result2.updates.updatedCells).toBe(2);
    });

    it('should handle formulas and different value types in appends', async () => {
      // Arrange
      const spreadsheetId = 'append-formulas';
      mockSheetsApi.spreadsheets.get = vi.fn().mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: { replies: [{ appendCells: {} }] },
      });

      // Act - append with mixed types including formula
      const promise = batchingSystem.execute({
        id: 'append-mixed',
        type: 'values:append',
        spreadsheetId,
        params: {
          range: 'Sheet1!A1',
          values: [[123, 'text', true, '=SUM(A1:A2)']],
          valueInputOption: 'USER_ENTERED',
        },
      });

      await vi.advanceTimersByTimeAsync(50);
      await promise;

      // Assert - should convert values correctly
      const batchCall = (mockSheetsApi.spreadsheets.batchUpdate as any).mock.calls[0][0];
      const rows = batchCall.requestBody.requests[0].appendCells.rows;
      expect(rows[0].values[0].userEnteredValue.numberValue).toBe(123);
      expect(rows[0].values[1].userEnteredValue.stringValue).toBe('text');
      expect(rows[0].values[2].userEnteredValue.boolValue).toBe(true);
      expect(rows[0].values[3].userEnteredValue.formulaValue).toBe('=SUM(A1:A2)');
    });

    it('should handle append with unresolvable sheet ID', async () => {
      // Arrange
      const spreadsheetId = 'append-bad-sheet';
      mockSheetsApi.spreadsheets.get = vi.fn().mockResolvedValue({
        data: {
          sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
        },
      });

      // Act - try to append to non-existent sheet
      const promise = batchingSystem.execute({
        id: 'append-bad',
        type: 'values:append',
        spreadsheetId,
        params: { range: 'NonExistentSheet!A1', values: [[1]] },
      });

      // Catch to avoid unhandled rejection warnings
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(50);

      // Assert - should reject with appropriate error
      await expect(promise).rejects.toThrow(/Could not resolve sheet ID/);
    });
  });

  describe('BatchUpdate Operations', () => {
    it('should merge multiple batchUpdate requests', async () => {
      // Arrange
      const spreadsheetId = 'batch-update-test';
      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [{ updateCells: {} }, { repeatCell: {} }, { mergeCells: {} }],
        },
      });

      // Act - queue same type operations (they batch together)
      const promises = [
        batchingSystem.execute({
          id: 'format1',
          type: 'format:update',
          spreadsheetId,
          params: {
            requests: [
              {
                updateCells: {
                  range: { sheetId: 0 },
                  fields: 'userEnteredFormat.backgroundColor',
                },
              },
            ],
          },
        }),
        batchingSystem.execute({
          id: 'format2',
          type: 'format:update',
          spreadsheetId,
          params: {
            requests: [{ repeatCell: { range: { sheetId: 0 }, fields: 'userEnteredFormat' } }],
          },
        }),
        batchingSystem.execute({
          id: 'format3',
          type: 'format:update',
          spreadsheetId,
          params: {
            request: { mergeCells: { range: { sheetId: 0 }, mergeType: 'MERGE_ALL' } },
          },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(promises);

      // Assert - should merge all requests into single batchUpdate
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
      const batchCall = (mockSheetsApi.spreadsheets.batchUpdate as any).mock.calls[0][0];
      expect(batchCall.requestBody.requests).toHaveLength(3);
      expect(batchCall.requestBody.requests[0]).toHaveProperty('updateCells');
      expect(batchCall.requestBody.requests[1]).toHaveProperty('repeatCell');
      expect(batchCall.requestBody.requests[2]).toHaveProperty('mergeCells');
    });

    it('should preserve request order in batch', async () => {
      // Arrange
      const spreadsheetId = 'order-test';
      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: { replies: [{}, {}, {}] },
      });

      // Act - queue operations in specific order
      const promises = [
        batchingSystem.execute({
          id: 'op1',
          type: 'sheet:update',
          spreadsheetId,
          params: { requests: [{ addSheet: { properties: { title: 'First' } } }] },
        }),
        batchingSystem.execute({
          id: 'op2',
          type: 'sheet:update',
          spreadsheetId,
          params: { requests: [{ addSheet: { properties: { title: 'Second' } } }] },
        }),
        batchingSystem.execute({
          id: 'op3',
          type: 'sheet:update',
          spreadsheetId,
          params: { requests: [{ addSheet: { properties: { title: 'Third' } } }] },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(promises);

      // Assert - requests should be in same order as queued
      const batchCall = (mockSheetsApi.spreadsheets.batchUpdate as any).mock.calls[0][0];
      expect(batchCall.requestBody.requests[0].addSheet.properties.title).toBe('First');
      expect(batchCall.requestBody.requests[1].addSheet.properties.title).toBe('Second');
      expect(batchCall.requestBody.requests[2].addSheet.properties.title).toBe('Third');
    });

    it('should distribute batchUpdate responses to correct operations', async () => {
      // Arrange
      const spreadsheetId = 'response-test';
      mockSheetsApi.spreadsheets.batchUpdate = vi.fn().mockResolvedValue({
        data: {
          replies: [
            { addSheet: { properties: { sheetId: 123 } } },
            { addSheet: { properties: { sheetId: 456 } } },
          ],
        },
      });

      // Act
      const promise1 = batchingSystem.execute({
        id: 'sheet1',
        type: 'sheet:update',
        spreadsheetId,
        params: { requests: [{ addSheet: { properties: { title: 'S1' } } }] },
      });

      const promise2 = batchingSystem.execute({
        id: 'sheet2',
        type: 'sheet:update',
        spreadsheetId,
        params: { requests: [{ addSheet: { properties: { title: 'S2' } } }] },
      });

      await vi.advanceTimersByTimeAsync(50);
      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Assert - each operation gets its corresponding reply
      expect(result1.addSheet.properties.sheetId).toBe(123);
      expect(result2.addSheet.properties.sheetId).toBe(456);
    });
  });

  describe('Values Clear Batching', () => {
    it('should batch multiple clear operations using batchClear', async () => {
      // Arrange
      const spreadsheetId = 'clear-test';
      mockSheetsApi.spreadsheets.values.batchClear = vi.fn().mockResolvedValue({
        data: { clearedRanges: ['Sheet1!A1', 'Sheet1!B1', 'Sheet2!A1'] },
      });

      // Act - queue multiple clear operations
      const promises = [
        batchingSystem.execute({
          id: 'clear1',
          type: 'values:clear',
          spreadsheetId,
          params: { range: 'Sheet1!A1' },
        }),
        batchingSystem.execute({
          id: 'clear2',
          type: 'values:clear',
          spreadsheetId,
          params: { range: 'Sheet1!B1' },
        }),
        batchingSystem.execute({
          id: 'clear3',
          type: 'values:clear',
          spreadsheetId,
          params: { range: 'Sheet2!A1' },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(promises);

      // Assert
      expect(mockSheetsApi.spreadsheets.values.batchClear).toHaveBeenCalledTimes(1);
      expect(mockSheetsApi.spreadsheets.values.batchClear).toHaveBeenCalledWith({
        spreadsheetId,
        requestBody: {
          ranges: ['Sheet1!A1', 'Sheet1!B1', 'Sheet2!A1'],
        },
      });
    });

    it('should resolve all clear operations with same response', async () => {
      // Arrange
      const spreadsheetId = 'clear-test-2';
      const mockResponse = { clearedRanges: ['A1', 'B1'] };
      mockSheetsApi.spreadsheets.values.batchClear = vi
        .fn()
        .mockResolvedValue({ data: mockResponse });

      // Act
      const promises = [
        batchingSystem.execute({
          id: 'clear1',
          type: 'values:clear',
          spreadsheetId,
          params: { range: 'A1' },
        }),
        batchingSystem.execute({
          id: 'clear2',
          type: 'values:clear',
          spreadsheetId,
          params: { range: 'B1' },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      const [result1, result2] = await Promise.all(promises);

      // Assert - both should get the same response
      expect(result1).toEqual(mockResponse);
      expect(result2).toEqual(mockResponse);
    });
  });

  describe('Efficiency Metrics', () => {
    it('should calculate batch efficiency ratio correctly', async () => {
      // Arrange
      const spreadsheetId = 'metrics-test';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{}, {}, {}, {}, {}] },
      });

      // Act - execute 5 operations in one batch
      const promises = [
        batchingSystem.execute({
          id: 'op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A1', values: [[1]] },
        }),
        batchingSystem.execute({
          id: 'op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A2', values: [[2]] },
        }),
        batchingSystem.execute({
          id: 'op3',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A3', values: [[3]] },
        }),
        batchingSystem.execute({
          id: 'op4',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A4', values: [[4]] },
        }),
        batchingSystem.execute({
          id: 'op5',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A5', values: [[5]] },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(promises);

      // Assert
      const stats = batchingSystem.getStats();
      expect(stats.totalOperations).toBe(5);
      expect(stats.totalBatches).toBe(1);
      expect(stats.totalApiCalls).toBe(1);
      expect(stats.apiCallsSaved).toBe(4); // 5 operations - 1 API call
      expect(stats.reductionPercentage).toBe(80); // (4/5) * 100
      expect(stats.avgBatchSize).toBe(5);
      expect(stats.maxBatchSize).toBe(5);
      expect(stats.minBatchSize).toBe(5);
    });

    it('should track operations saved across multiple batches', async () => {
      // Arrange
      const spreadsheetId = 'metrics-test-2';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{}, {}, {}] },
      });

      // Act - execute two separate batches
      // Batch 1: 3 operations
      const batch1 = [
        batchingSystem.execute({
          id: 'b1-op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A1', values: [[1]] },
        }),
        batchingSystem.execute({
          id: 'b1-op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A2', values: [[2]] },
        }),
        batchingSystem.execute({
          id: 'b1-op3',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A3', values: [[3]] },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(batch1);

      // Batch 2: 3 more operations
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{}, {}, {}] },
      });

      const batch2 = [
        batchingSystem.execute({
          id: 'b2-op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'B1', values: [[4]] },
        }),
        batchingSystem.execute({
          id: 'b2-op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'B2', values: [[5]] },
        }),
        batchingSystem.execute({
          id: 'b2-op3',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'B3', values: [[6]] },
        }),
      ];

      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(batch2);

      // Assert
      const stats = batchingSystem.getStats();
      expect(stats.totalOperations).toBe(6);
      expect(stats.totalBatches).toBe(2);
      expect(stats.totalApiCalls).toBe(2);
      expect(stats.apiCallsSaved).toBe(4); // 6 operations - 2 API calls
      expect(stats.reductionPercentage).toBeCloseTo(66.67, 1); // (4/6) * 100
      expect(stats.avgBatchSize).toBe(3);
    });

    it('should track batch duration metrics', async () => {
      // Arrange
      const spreadsheetId = 'duration-test';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { data: { responses: [{}] } };
      });

      // Act
      const promise = batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'A1', values: [[1]] },
      });

      await vi.advanceTimersByTimeAsync(50); // Trigger batch
      await vi.advanceTimersByTimeAsync(100); // Wait for API call
      await promise;

      // Assert
      const stats = batchingSystem.getStats();
      expect(stats.avgBatchDuration).toBeGreaterThan(0);
    });

    it('should reset statistics correctly', async () => {
      // Arrange
      const spreadsheetId = 'reset-test';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{}] },
      });

      // Execute some operations
      const promise = batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'A1', values: [[1]] },
      });

      await vi.advanceTimersByTimeAsync(50);
      await promise;

      // Act - reset stats
      batchingSystem.resetStats();

      // Assert
      const stats = batchingSystem.getStats();
      expect(stats.totalOperations).toBe(0);
      expect(stats.totalBatches).toBe(0);
      expect(stats.totalApiCalls).toBe(0);
      expect(stats.apiCallsSaved).toBe(0);
      expect(stats.avgBatchSize).toBe(0);
      expect(stats.maxBatchSize).toBe(0);
      expect(stats.minBatchSize).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should reject all operations in batch when API call fails', async () => {
      // Arrange
      const spreadsheetId = 'error-test';
      const apiError = new Error('API request failed');
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockRejectedValue(apiError);

      // Act - queue multiple operations
      const promises = [
        batchingSystem.execute({
          id: 'op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A1', values: [[1]] },
        }),
        batchingSystem.execute({
          id: 'op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A2', values: [[2]] },
        }),
      ];

      // Catch to avoid unhandled rejection warnings
      promises[0].catch(() => {});
      promises[1].catch(() => {});

      await vi.advanceTimersByTimeAsync(50);

      // Assert - all operations should be rejected with same error
      await expect(promises[0]).rejects.toThrow('API request failed');
      await expect(promises[1]).rejects.toThrow('API request failed');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      // Arrange
      const spreadsheetId = 'error-test-2';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi
        .fn()
        .mockRejectedValue('String error message');

      // Act
      const promise = batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'A1', values: [[1]] },
      });

      // Catch to avoid unhandled rejection warnings
      promise.catch(() => {});

      await vi.advanceTimersByTimeAsync(50);

      // Assert - should convert to Error
      await expect(promise).rejects.toThrow('String error message');
    });

    it('should handle timeout in batch execution', async () => {
      // Arrange
      const spreadsheetId = 'timeout-test';
      let resolveFn: () => void;
      const hangingPromise = new Promise<any>((resolve) => {
        resolveFn = () => resolve({ data: { responses: [{}] } });
      });

      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockReturnValue(hangingPromise);

      // Act
      const promise = batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'A1', values: [[1]] },
      });

      await vi.advanceTimersByTimeAsync(50);

      // Verify it's still pending
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      // Resolve the hanging promise
      resolveFn!();
      await promise;
      expect(resolved).toBe(true);
    });
  });

  describe('Disabled Batching Mode', () => {
    it('should execute operations immediately when batching is disabled', async () => {
      // Arrange
      const noBatchSystem = new BatchingSystem(mockSheetsApi, {
        enabled: false,
      });

      const spreadsheetId = 'no-batch-test';
      mockSheetsApi.spreadsheets.values.update = vi.fn().mockResolvedValue({
        data: { updatedCells: 1 },
      });

      // Act - execute multiple operations
      await Promise.all([
        noBatchSystem.execute({
          id: 'op1',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A1', values: [[1]] },
        }),
        noBatchSystem.execute({
          id: 'op2',
          type: 'values:update',
          spreadsheetId,
          params: { range: 'A2', values: [[2]] },
        }),
      ]);

      // Don't advance timers

      // Assert - should call individual API methods immediately
      expect(mockSheetsApi.spreadsheets.values.update).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();

      noBatchSystem.destroy();
    });

    it('should execute append immediately when batching is disabled', async () => {
      // Arrange
      const noBatchSystem = new BatchingSystem(mockSheetsApi, {
        enabled: false,
      });

      const spreadsheetId = 'no-batch-append';
      mockSheetsApi.spreadsheets.values.append = vi.fn().mockResolvedValue({
        data: { updates: { updatedCells: 1 } },
      });

      // Act
      await noBatchSystem.execute({
        id: 'append1',
        type: 'values:append',
        spreadsheetId,
        params: { range: 'Sheet1!A1', values: [[1]] },
      });

      // Assert
      expect(mockSheetsApi.spreadsheets.values.append).toHaveBeenCalledTimes(1);
      expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();

      noBatchSystem.destroy();
    });
  });

  describe('Adaptive Window', () => {
    it('should adjust window size based on queue depth', async () => {
      // Arrange
      const adaptiveSystem = new BatchingSystem(mockSheetsApi, {
        enabled: true,
        adaptiveWindow: true,
        adaptiveConfig: {
          minWindowMs: 20,
          maxWindowMs: 200,
          initialWindowMs: 50,
          lowThreshold: 3,
          highThreshold: 10,
        },
      });

      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{}] },
      });

      // Act - execute single operation (below lowThreshold)
      const promise = adaptiveSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId: 'test',
        params: { range: 'A1', values: [[1]] },
      });

      await vi.advanceTimersByTimeAsync(50);
      await promise;

      const stats = adaptiveSystem.getStats();

      // Assert - window should exist in stats
      expect(stats.currentWindowMs).toBeDefined();
      expect(stats.avgWindowMs).toBeDefined();

      adaptiveSystem.destroy();
    });

    it('should increase window when operations are below threshold', () => {
      // Arrange
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 50,
        lowThreshold: 3,
        increaseRate: 1.5,
      });

      // Act - adjust with low operation count
      window.adjust(2); // Below threshold of 3

      // Assert - window should increase
      expect(window.getCurrentWindow()).toBe(75); // 50 * 1.5
    });

    it('should decrease window when operations are above threshold', () => {
      // Arrange
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 100,
        highThreshold: 50,
        decreaseRate: 0.5,
      });

      // Act - adjust with high operation count
      window.adjust(60); // Above threshold of 50

      // Assert - window should decrease
      expect(window.getCurrentWindow()).toBe(50); // 100 * 0.5
    });

    it('should respect min and max window bounds', () => {
      // Arrange
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 50,
        lowThreshold: 3,
        highThreshold: 50,
        increaseRate: 10, // Aggressive increase
        decreaseRate: 0.01, // Aggressive decrease
      });

      // Act - try to exceed max
      window.adjust(1); // Very low, should trigger increase
      const afterIncrease = window.getCurrentWindow();

      // Try to go below min
      window.adjust(1000); // Very high, should trigger decrease
      window.adjust(1000);
      window.adjust(1000);
      const afterDecrease = window.getCurrentWindow();

      // Assert
      expect(afterIncrease).toBeLessThanOrEqual(200);
      expect(afterDecrease).toBeGreaterThanOrEqual(20);
    });

    it('should maintain window in optimal range', () => {
      // Arrange
      const window = new AdaptiveBatchWindow({
        minWindowMs: 20,
        maxWindowMs: 200,
        initialWindowMs: 50,
        lowThreshold: 3,
        highThreshold: 50,
      });

      const initialWindow = window.getCurrentWindow();

      // Act - adjust with optimal operation count
      window.adjust(25); // Between 3 and 50

      // Assert - window should remain unchanged
      expect(window.getCurrentWindow()).toBe(initialWindow);
    });
  });

  describe('Flush and Destroy', () => {
    it('should flush all pending batches immediately', async () => {
      // Arrange
      const spreadsheetId = 'flush-test';
      mockSheetsApi.spreadsheets.values.batchUpdate = vi.fn().mockResolvedValue({
        data: { responses: [{}] },
      });

      // Queue operations but don't wait for timer
      const promise = batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'A1', values: [[1]] },
      });

      // Act - flush immediately
      await batchingSystem.flush();
      await promise;

      // Assert - should have executed without waiting for timer
      expect(mockSheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should clear all timers and batches on destroy', () => {
      // Arrange
      const spreadsheetId = 'destroy-test';
      batchingSystem.execute({
        id: 'op1',
        type: 'values:update',
        spreadsheetId,
        params: { range: 'A1', values: [[1]] },
      });

      // Act
      batchingSystem.destroy();

      // Assert - internal state should be cleared
      const pendingBatches = (batchingSystem as any).pendingBatches;
      const batchTimers = (batchingSystem as any).batchTimers;
      expect(pendingBatches.size).toBe(0);
      expect(batchTimers.size).toBe(0);
    });
  });
});
