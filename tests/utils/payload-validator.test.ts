/**
 * Tests for payload size validator
 */

import { describe, it, expect } from 'vitest';
import {
  validateBatchUpdatePayload,
  validateValuesPayload,
  validateValuesBatchPayload,
  estimatePayloadSize,
  shouldSplitPayload,
  calculateOptimalBatchSize,
  getPayloadStats,
  PAYLOAD_LIMITS,
} from '../../src/utils/payload-validator.js';
import type { sheets_v4 } from 'googleapis';

describe('PayloadValidator', () => {
  describe('estimatePayloadSize', () => {
    it('should estimate size for small objects', () => {
      const obj = { key: 'value' };
      const size = estimatePayloadSize(obj);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(100);
    });

    it('should handle large objects with UTF-8 characters', () => {
      const largeText = 'A'.repeat(200_000);
      const obj = { data: largeText };
      const size = estimatePayloadSize(obj);
      expect(size).toBeGreaterThan(200_000);
    });

    it('should handle Unicode characters', () => {
      const obj = { text: '你好世界 🚀' };
      const size = estimatePayloadSize(obj);
      expect(size).toBeGreaterThan(JSON.stringify(obj).length * 0.5);
    });
  });

  describe('validateBatchUpdatePayload', () => {
    it('should pass for small payloads', () => {
      const requests: sheets_v4.Schema$Request[] = [
        {
          updateCells: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            fields: 'userEnteredValue',
          },
        },
      ];

      const result = validateBatchUpdatePayload(requests, {
        spreadsheetId: 'test-123',
        operationType: 'batchUpdate',
      });

      expect(result.withinLimits).toBe(true);
      expect(result.level).toBe('none');
      expect(result.suggestions).toBeUndefined();
    });

    it('should warn for payloads above 7MB threshold', () => {
      // Create large payload (>7MB)
      const largeData = 'X'.repeat(7_500_000);
      const requests: sheets_v4.Schema$Request[] = [
        {
          updateCells: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: largeData },
                  },
                ],
              },
            ],
            fields: 'userEnteredValue',
          },
        },
      ];

      const result = validateBatchUpdatePayload(requests);

      expect(result.level).toBe('warning');
      expect(result.withinLimits).toBe(true);
      expect(result.sizeBytes).toBeGreaterThan(PAYLOAD_LIMITS.WARNING_THRESHOLD);
    });

    it('should flag critical for payloads above 8.1MB', () => {
      // Create very large payload (>8.1MB)
      const veryLargeData = 'X'.repeat(8_500_000);
      const requests: sheets_v4.Schema$Request[] = [
        {
          updateCells: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: veryLargeData },
                  },
                ],
              },
            ],
            fields: 'userEnteredValue',
          },
        },
      ];

      const result = validateBatchUpdatePayload(requests);

      expect(result.level).toBe('critical');
      expect(result.withinLimits).toBe(true);
      expect(result.sizeBytes).toBeGreaterThan(PAYLOAD_LIMITS.CRITICAL_THRESHOLD);
    });

    it('should reject payloads exceeding 9MB', () => {
      // Create oversized payload (>9MB)
      const oversizedData = 'X'.repeat(9_500_000);
      const requests: sheets_v4.Schema$Request[] = [
        {
          updateCells: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: oversizedData },
                  },
                ],
              },
            ],
            fields: 'userEnteredValue',
          },
        },
      ];

      const result = validateBatchUpdatePayload(requests);

      expect(result.withinLimits).toBe(false);
      expect(result.level).toBe('exceeded');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
      expect(result.estimatedSplitCount).toBeGreaterThanOrEqual(2);
    });

    it('should provide size breakdown by request type', () => {
      const requests: sheets_v4.Schema$Request[] = [
        {
          updateCells: {
            range: { sheetId: 0 },
            fields: 'userEnteredValue',
          },
        },
        {
          repeatCell: {
            range: { sheetId: 0 },
            fields: 'userEnteredFormat',
          },
        },
      ];

      const result = validateBatchUpdatePayload(requests);

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown!.updateCells).toBeGreaterThan(0);
      expect(result.breakdown!.repeatCell).toBeGreaterThan(0);
    });
  });

  describe('validateValuesBatchPayload', () => {
    it('should pass for small values batch payloads', () => {
      const result = validateValuesBatchPayload([
        {
          values: [
            ['Name', 'Age'],
            ['Alice', 30],
          ],
        },
      ]);

      expect(result.withinLimits).toBe(true);
      expect(result.level).toBe('none');
    });
  });

  describe('validateValuesPayload', () => {
    it('should pass for small value arrays', () => {
      const values = [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
      ];

      const result = validateValuesPayload(values, 'Sheet1!A1:C2');

      expect(result.withinLimits).toBe(true);
      expect(result.level).toBe('none');
    });

    it('should reject large value arrays exceeding 9MB', () => {
      // Create large 2D array
      const largeValue = 'X'.repeat(100_000);
      const values: string[][] = [];
      for (let i = 0; i < 100; i++) {
        values.push([largeValue, largeValue, largeValue]);
      }

      const result = validateValuesPayload(values, 'Sheet1!A1:C100');

      expect(result.withinLimits).toBe(false);
      expect(result.level).toBe('exceeded');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.some((s) => s.includes('Split'))).toBe(true);
    });
  });

  describe('shouldSplitPayload', () => {
    it('should recommend split for payloads above 7MB', () => {
      expect(shouldSplitPayload(8_000_000)).toBe(true);
      expect(shouldSplitPayload(7_500_000)).toBe(true);
    });

    it('should not recommend split for small payloads', () => {
      expect(shouldSplitPayload(5_000_000)).toBe(false);
      expect(shouldSplitPayload(1_000_000)).toBe(false);
    });
  });

  describe('calculateOptimalBatchSize', () => {
    it('should calculate reasonable batch size', () => {
      const totalRequests = 100;
      const estimatedSize = 5_000_000; // 5MB total
      const batchSize = calculateOptimalBatchSize(totalRequests, estimatedSize);

      expect(batchSize).toBeGreaterThan(0);
      expect(batchSize).toBeLessThanOrEqual(100);

      // Verify batch size keeps payload under limit
      const avgRequestSize = estimatedSize / totalRequests;
      const batchPayloadSize = avgRequestSize * batchSize;
      expect(batchPayloadSize).toBeLessThan(PAYLOAD_LIMITS.MAX_SIZE);
    });

    it('should handle large requests requiring small batches', () => {
      const totalRequests = 100;
      const estimatedSize = 50_000_000; // 50MB total
      const batchSize = calculateOptimalBatchSize(totalRequests, estimatedSize);

      expect(batchSize).toBeGreaterThan(0);
      expect(batchSize).toBeLessThan(20); // Must split into many small batches

      // Verify batch size keeps payload under limit
      const avgRequestSize = estimatedSize / totalRequests;
      const batchPayloadSize = avgRequestSize * batchSize;
      expect(batchPayloadSize).toBeLessThan(PAYLOAD_LIMITS.MAX_SIZE);
    });

    it('should return at least 1 request per batch', () => {
      const totalRequests = 10;
      const estimatedSize = 100_000_000; // 100MB total (huge requests)
      const batchSize = calculateOptimalBatchSize(totalRequests, estimatedSize);

      expect(batchSize).toBe(1);
    });

    it('should handle edge case of zero requests', () => {
      const batchSize = calculateOptimalBatchSize(0, 0);
      expect(batchSize).toBe(0);
    });
  });

  describe('getPayloadStats', () => {
    it('should calculate stats for empty array', () => {
      const stats = getPayloadStats([]);

      expect(stats.totalPayloads).toBe(0);
      expect(stats.avgSizeMB).toBe('0.00');
      expect(stats.maxSizeMB).toBe('0.00');
      expect(stats.warningCount).toBe(0);
      expect(stats.criticalCount).toBe(0);
      expect(stats.exceededCount).toBe(0);
    });

    it('should calculate stats for multiple results', () => {
      const results = [
        {
          sizeBytes: 1_000_000,
          sizeMB: '1.00',
          withinLimits: true,
          level: 'none' as const,
          message: 'OK',
        },
        {
          sizeBytes: 7_500_000,
          sizeMB: '7.50',
          withinLimits: true,
          level: 'warning' as const,
          message: 'Warning',
          suggestions: ['Split'],
        },
        {
          sizeBytes: 8_500_000,
          sizeMB: '8.50',
          withinLimits: true,
          level: 'critical' as const,
          message: 'Critical',
          suggestions: ['Split now'],
        },
      ];

      const stats = getPayloadStats(results);

      expect(stats.totalPayloads).toBe(3);
      expect(stats.avgSizeMB).toBe('5.67'); // (1 + 7.5 + 8.5) / 3
      expect(stats.maxSizeMB).toBe('8.50');
      expect(stats.warningCount).toBe(1);
      expect(stats.criticalCount).toBe(1);
      expect(stats.exceededCount).toBe(0);
    });
  });
});
