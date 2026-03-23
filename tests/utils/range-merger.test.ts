/**
 * Range Merger Tests
 *
 * Tests for synchronous range merging to reduce API calls in batch operations.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeOverlappingRanges,
  type RangeMergeResult,
  type MergedRange,
  type OriginalRangeIndex,
} from '../../src/utils/range-merger.js';

describe('Range Merger - Synchronous Batch Optimization', () => {
  describe('mergeOverlappingRanges', () => {
    it('should merge two overlapping ranges on same sheet', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!A5:C15'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:C15");
      expect(result.mergedRanges[0]!.originalIndices).toEqual([0, 1]);
      expect(result.apiCallReduction).toBe(1); // 2 requests → 1 request = 50% reduction
      expect(result.originalCount).toBe(2);
      expect(result.mergedCount).toBe(1);
    });

    it('should merge three overlapping ranges into one', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!A5:C15', 'Sheet1!B8:D20'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:D20");
      expect(result.mergedRanges[0]!.originalIndices).toEqual([0, 1, 2]);
      expect(result.apiCallReduction).toBe(2); // 3 requests → 1 request
    });

    it('should not merge non-overlapping ranges', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!D1:E10'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(2);
      expect(result.mergedRanges[0]!.originalIndices).toEqual([0]);
      expect(result.mergedRanges[1]!.originalIndices).toEqual([1]);
      expect(result.apiCallReduction).toBe(0); // No reduction
    });

    it('should keep ranges from different sheets separate', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet2!A1:B10'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(2);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:B10");
      expect(result.mergedRanges[1]!.mergedRange).toBe("'Sheet2'!A1:B10");
      expect(result.apiCallReduction).toBe(0);
    });

    it('should handle quoted sheet names with spaces', () => {
      const ranges = ["'Sales Data'!A1:B10", "'Sales Data'!A5:C15"];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sales Data'!A1:C15");
      expect(result.apiCallReduction).toBe(1);
    });

    it('should handle transitive overlaps (A overlaps B, B overlaps C)', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!B5:C15', 'Sheet1!C10:D20'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:D20");
      expect(result.mergedRanges[0]!.originalIndices).toEqual([0, 1, 2]);
    });

    it('should handle single cell ranges', () => {
      const ranges = ['Sheet1!A1', 'Sheet1!A2', 'Sheet1!A3'];

      const result = mergeOverlappingRanges(ranges);

      // Single cells don't overlap, but should still work
      expect(result.mergedRanges).toHaveLength(3);
      expect(result.apiCallReduction).toBe(0);
    });

    it('should merge adjacent ranges when they touch', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!C1:D10'];

      const result = mergeOverlappingRanges(ranges);

      // Adjacent ranges are NOT merged by default (only overlapping)
      expect(result.mergedRanges).toHaveLength(2);
      expect(result.apiCallReduction).toBe(0);
    });

    it('should handle ranges that fully contain others', () => {
      const ranges = ['Sheet1!A1:D20', 'Sheet1!B5:C15'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:D20");
      expect(result.mergedRanges[0]!.originalIndices).toEqual([0, 1]);
    });

    it('should handle empty input array', () => {
      const ranges: string[] = [];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(0);
      expect(result.apiCallReduction).toBe(0);
      expect(result.originalCount).toBe(0);
      expect(result.mergedCount).toBe(0);
    });

    it('should handle single range input', () => {
      const ranges = ['Sheet1!A1:B10'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:B10");
      expect(result.mergedRanges[0]!.originalIndices).toEqual([0]);
      expect(result.apiCallReduction).toBe(0);
    });

    it('should handle complex multi-sheet scenario', () => {
      const ranges = [
        'Sheet1!A1:B10', // 0
        'Sheet1!A5:C15', // 1 - overlaps with 0
        'Sheet2!A1:B10', // 2 - different sheet
        'Sheet1!D1:E10', // 3 - same sheet, no overlap
        'Sheet2!A5:C15', // 4 - overlaps with 2
        'Sheet3!A1:B10', // 5 - different sheet
      ];

      const result = mergeOverlappingRanges(ranges);

      // Expected: Sheet1 (2 groups), Sheet2 (1 group), Sheet3 (1 group)
      expect(result.mergedRanges).toHaveLength(4);
      expect(result.apiCallReduction).toBe(2); // 6 → 4 = 2 saved

      // Find Sheet1 merged ranges
      const sheet1Ranges = result.mergedRanges.filter((r) => r.mergedRange.includes('Sheet1'));
      expect(sheet1Ranges).toHaveLength(2);

      // Find Sheet2 merged range
      const sheet2Ranges = result.mergedRanges.filter((r) => r.mergedRange.includes('Sheet2'));
      expect(sheet2Ranges).toHaveLength(1);
      expect(sheet2Ranges[0]!.originalIndices).toEqual([2, 4]);
    });

    it('should handle ranges with row/column only notation', () => {
      const ranges = ['Sheet1!A:A', 'Sheet1!B:B'];

      const result = mergeOverlappingRanges(ranges);

      // Column ranges don't overlap
      expect(result.mergedRanges).toHaveLength(2);
    });

    it('should preserve original order in indices', () => {
      const ranges = ['Sheet1!C10:D20', 'Sheet1!A1:B10', 'Sheet1!B5:C15'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      // Should contain all three indices in original order
      expect(result.mergedRanges[0]!.originalIndices).toContain(0);
      expect(result.mergedRanges[0]!.originalIndices).toContain(1);
      expect(result.mergedRanges[0]!.originalIndices).toContain(2);
    });

    it('should handle emoji sheet names', () => {
      const ranges = ["'📊 Dashboard'!A1:B10", "'📊 Dashboard'!A5:C15"];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'📊 Dashboard'!A1:C15");
    });

    it('should calculate correct savings percentage', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!A5:C15', 'Sheet1!B8:D20', 'Sheet1!Z1:Z10'];

      const result = mergeOverlappingRanges(ranges);

      // 3 ranges merge into 1, 1 stays separate = 2 total
      expect(result.mergedRanges).toHaveLength(2);
      expect(result.apiCallReduction).toBe(2); // 4 → 2 = 2 saved (50%)
      expect(result.originalCount).toBe(4);
      expect(result.mergedCount).toBe(2);
    });

    it('should track range info correctly for response splitting', () => {
      const ranges = ['Sheet1!A1:B10', 'Sheet1!A5:C15'];

      const result = mergeOverlappingRanges(ranges);

      const merged = result.mergedRanges[0]!;
      expect(merged.rangeInfo.sheetName).toBe('Sheet1');
      expect(merged.rangeInfo.startRow).toBe(1);
      expect(merged.rangeInfo.startCol).toBe(1); // A = 1
      expect(merged.rangeInfo.endRow).toBe(15);
      expect(merged.rangeInfo.endCol).toBe(3); // C = 3
    });
  });

  describe('Edge Cases', () => {
    it('should handle ranges with single row', () => {
      const ranges = ['Sheet1!A1:Z1', 'Sheet1!B1:C1'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:Z1");
    });

    it('should handle ranges with single column', () => {
      const ranges = ['Sheet1!A1:A100', 'Sheet1!A50:A150'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'Sheet1'!A1:A150");
    });

    it('should handle large batch (100+ ranges)', () => {
      const ranges: string[] = [];
      for (let i = 0; i < 100; i++) {
        ranges.push(`Sheet1!A${i + 1}:B${i + 10}`);
      }

      const result = mergeOverlappingRanges(ranges);

      // All should merge into one since they all overlap
      expect(result.mergedRanges).toHaveLength(1);
      expect(result.apiCallReduction).toBe(99); // 100 → 1 = 99 saved
    });

    it('should handle maximum column range', () => {
      const ranges = ['Sheet1!A1:ZZZ1000', 'Sheet1!B500:C1500'];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
    });

    it('should handle sheet names with special characters', () => {
      const ranges = ["'2024-Q1 Results'!A1:B10", "'2024-Q1 Results'!A5:C15"];

      const result = mergeOverlappingRanges(ranges);

      expect(result.mergedRanges).toHaveLength(1);
      expect(result.mergedRanges[0]!.mergedRange).toBe("'2024-Q1 Results'!A1:C15");
    });
  });

  describe('Performance Tests', () => {
    it('should handle 1000 ranges efficiently', () => {
      const ranges: string[] = [];
      // Create 10 groups of 100 overlapping ranges each
      for (let group = 0; group < 10; group++) {
        for (let i = 0; i < 100; i++) {
          const baseRow = group * 1000;
          ranges.push(`Sheet1!A${baseRow + i + 1}:B${baseRow + i + 10}`);
        }
      }

      const startTime = Date.now();
      const result = mergeOverlappingRanges(ranges);
      const duration = Date.now() - startTime;

      expect(result.mergedRanges).toHaveLength(10); // 10 separate groups
      expect(duration).toBeLessThan(1000); // Should complete in < 1 second
    });
  });
});
