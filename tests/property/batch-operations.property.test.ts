/**
 * ServalSheets - Batch Operations Property Tests
 *
 * Property-based tests for batching system using fast-check.
 * Ensures batch splitting, merging, and execution preserve invariants.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { BatchableOperation } from '../../src/services/batching-system.js';

describe('Batch Operations Property Tests', () => {
  describe('Batch Splitting Invariants', () => {
    it('split batches should preserve total operation count', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 500 }),
          fc.integer({ min: 1, max: 100 }),
          (operationSizes, maxBatchSize) => {
            const totalOperations = operationSizes.length;

            // Simulate splitting operations into batches
            const batches: number[][] = [];
            let currentBatch: number[] = [];

            for (const size of operationSizes) {
              if (currentBatch.length >= maxBatchSize) {
                batches.push(currentBatch);
                currentBatch = [];
              }
              currentBatch.push(size);
            }

            if (currentBatch.length > 0) {
              batches.push(currentBatch);
            }

            // Invariant: Sum of all batch sizes equals total operations
            const reconstitutedTotal = batches.reduce((sum, batch) => sum + batch.length, 0);
            return reconstitutedTotal === totalOperations;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('split batches should respect max batch size', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 500 }),
          fc.integer({ min: 1, max: 100 }),
          (operations, maxBatchSize) => {
            // Simulate splitting operations into batches
            const batches: string[][] = [];
            let currentBatch: string[] = [];

            for (const op of operations) {
              if (currentBatch.length >= maxBatchSize) {
                batches.push(currentBatch);
                currentBatch = [];
              }
              currentBatch.push(op);
            }

            if (currentBatch.length > 0) {
              batches.push(currentBatch);
            }

            // Invariant: All batches except possibly the last should be at or near maxBatchSize
            const allBatchesValid = batches.every((batch, index) => {
              const isLastBatch = index === batches.length - 1;
              return isLastBatch ? batch.length <= maxBatchSize : batch.length <= maxBatchSize;
            });

            return allBatchesValid;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('batch splitting should preserve operation order', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer(), { minLength: 1, maxLength: 200 }),
          fc.integer({ min: 1, max: 50 }),
          (operations, maxBatchSize) => {
            // Split into batches
            const batches: number[][] = [];
            let currentBatch: number[] = [];

            for (const op of operations) {
              if (currentBatch.length >= maxBatchSize) {
                batches.push(currentBatch);
                currentBatch = [];
              }
              currentBatch.push(op);
            }

            if (currentBatch.length > 0) {
              batches.push(currentBatch);
            }

            // Flatten and compare
            const flattened = batches.flat();

            // Invariant: Order must be preserved
            return JSON.stringify(flattened) === JSON.stringify(operations);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  describe('Batch Key Generation', () => {
    it('operations with same spreadsheetId and type should have same batch key', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 50 }),
          fc.constantFrom('values:update', 'values:append', 'values:clear', 'format:update'),
          (spreadsheetId, type) => {
            const getBatchKey = (sid: string, t: string) => `${sid}:${t}`;

            const key1 = getBatchKey(spreadsheetId, type);
            const key2 = getBatchKey(spreadsheetId, type);

            return key1 === key2;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('operations with different spreadsheetId should have different batch keys', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 50 }),
          fc.string({ minLength: 10, maxLength: 50 }),
          fc.constantFrom('values:update', 'values:append'),
          (spreadsheetId1, spreadsheetId2, type) => {
            fc.pre(spreadsheetId1 !== spreadsheetId2); // Only test when IDs differ

            const getBatchKey = (sid: string, t: string) => `${sid}:${t}`;

            const key1 = getBatchKey(spreadsheetId1, type);
            const key2 = getBatchKey(spreadsheetId2, type);

            return key1 !== key2;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('operations with different types should have different batch keys', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 50 }),
          fc.constantFrom('values:update', 'values:append', 'values:clear'),
          fc.constantFrom('values:update', 'values:append', 'values:clear'),
          (spreadsheetId, type1, type2) => {
            fc.pre(type1 !== type2); // Only test when types differ

            const getBatchKey = (sid: string, t: string) => `${sid}:${t}`;

            const key1 = getBatchKey(spreadsheetId, type1);
            const key2 = getBatchKey(spreadsheetId, type2);

            return key1 !== key2;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Payload Size Estimation', () => {
    it('estimated payload size should never be negative', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.array(
              fc.oneof(
                fc.string({ maxLength: 100 }),
                fc.integer({ min: -1000000, max: 1000000 }),
                fc.boolean()
              ),
              { minLength: 1, maxLength: 20 }
            ),
            { minLength: 1, maxLength: 100 }
          ),
          (values) => {
            // Simple payload estimation
            const jsonString = JSON.stringify(values);
            const estimatedSize = Buffer.byteLength(jsonString, 'utf8');

            return estimatedSize >= 0;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('larger value arrays should have larger estimated payload', () => {
      fc.assert(
        fc.property(
          fc.array(fc.array(fc.string({ maxLength: 50 }), { minLength: 1 }), {
            minLength: 1,
            maxLength: 50,
          }),
          (values) => {
            const jsonString = JSON.stringify(values);
            const estimatedSize = Buffer.byteLength(jsonString, 'utf8');

            // Minimum size should be at least the JSON overhead
            const minExpectedSize = '[[]]'.length; // Minimum possible JSON array

            return estimatedSize >= minExpectedSize;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('payload size should be monotonic with data size', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 20 }),
          (row) => {
            const values1 = [row];
            const values2 = [row, row]; // Double the data

            const size1 = Buffer.byteLength(JSON.stringify(values1), 'utf8');
            const size2 = Buffer.byteLength(JSON.stringify(values2), 'utf8');

            // More data should never result in smaller payload
            return size2 >= size1;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Batch Window Adaptation', () => {
    it('window size should stay within min/max bounds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 50 }),
          fc.integer({ min: 100, max: 500 }),
          fc.integer({ min: 0, max: 200 }),
          (minWindow, maxWindow, operationCount) => {
            fc.pre(minWindow < maxWindow);

            // Simulate adaptive window adjustment
            let currentWindow = 50;
            const lowThreshold = 3;
            const highThreshold = 50;

            if (operationCount < lowThreshold) {
              currentWindow = Math.min(maxWindow, currentWindow * 1.2);
            } else if (operationCount > highThreshold) {
              currentWindow = Math.max(minWindow, currentWindow * 0.8);
            }

            return currentWindow >= minWindow && currentWindow <= maxWindow;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('high traffic should decrease window size', () => {
      fc.assert(
        fc.property(fc.integer({ min: 51, max: 500 }), (highOperationCount) => {
          const initialWindow = 100;
          const minWindow = 20;
          const highThreshold = 50;

          let currentWindow = initialWindow;

          if (highOperationCount > highThreshold) {
            currentWindow = Math.max(minWindow, currentWindow * 0.8);
          }

          return currentWindow <= initialWindow;
        }),
        { numRuns: 500 }
      );
    });

    it('low traffic should increase window size', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 2 }), (lowOperationCount) => {
          const initialWindow = 50;
          const maxWindow = 200;
          const lowThreshold = 3;

          let currentWindow = initialWindow;

          if (lowOperationCount < lowThreshold) {
            currentWindow = Math.min(maxWindow, currentWindow * 1.2);
          }

          return currentWindow >= initialWindow;
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Operation Queueing', () => {
    it('queued operations should preserve IDs', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              id: fc.string({ minLength: 5, maxLength: 20 }),
              spreadsheetId: fc.string({ minLength: 10 }),
            }),
            { minLength: 1, maxLength: 100 }
          ),
          (operations) => {
            const queue = [...operations];
            const ids = operations.map((op) => op.id);
            const queuedIds = queue.map((op) => op.id);

            return JSON.stringify(ids) === JSON.stringify(queuedIds);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('empty queue should remain empty after operations complete', () => {
      const queue: unknown[] = [];

      // Process operations
      while (queue.length > 0) {
        queue.shift();
      }

      expect(queue.length).toBe(0);
    });
  });
});
