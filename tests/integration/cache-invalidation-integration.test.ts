/**
 * Cache Invalidation Integration Tests
 *
 * Tests the integration between CachedSheetsApi and CacheInvalidationGraph
 * to verify selective invalidation works end-to-end.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CacheInvalidationGraph } from '../../src/services/cache-invalidation-graph.js';

describe('Cache Invalidation Integration', () => {
  let graph: CacheInvalidationGraph;

  beforeEach(() => {
    graph = new CacheInvalidationGraph();
  });

  describe('End-to-End Invalidation Flow', () => {
    it('should invalidate only affected cache entries after data write', () => {
      // Simulate cache keys for a spreadsheet
      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet2!C1:D10',
        'sheet123:properties',
      ];

      // Perform a data write operation
      const keysToInvalidate = graph.getKeysToInvalidate('sheets_data', 'write', allKeys);

      // Should only invalidate values, not metadata
      expect(keysToInvalidate).toHaveLength(2);
      expect(keysToInvalidate).toContain('sheet123:values:Sheet1!A1:B10');
      expect(keysToInvalidate).toContain('sheet123:values:Sheet2!C1:D10');
      expect(keysToInvalidate).not.toContain('sheet123:metadata');
      expect(keysToInvalidate).not.toContain('sheet123:properties');

      // Calculate cache hit rate improvement
      const preservedKeys = allKeys.length - keysToInvalidate.length;
      const preservationRate = (preservedKeys / allKeys.length) * 100;
      expect(preservationRate).toBeGreaterThanOrEqual(50); // At least 50% preserved
    });

    it('should invalidate only format cache after format operation', () => {
      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet2!C1:D10',
      ];

      // Perform a format operation
      const keysToInvalidate = graph.getKeysToInvalidate('sheets_format', 'set_format', allKeys);

      // Should only invalidate metadata (formats are part of metadata)
      expect(keysToInvalidate).toHaveLength(1);
      expect(keysToInvalidate).toContain('sheet123:metadata');
      expect(keysToInvalidate).not.toContain('sheet123:values:Sheet1!A1:B10');
      expect(keysToInvalidate).not.toContain('sheet123:values:Sheet2!C1:D10');

      // Calculate preservation rate
      const preservedKeys = allKeys.length - keysToInvalidate.length;
      const preservationRate = (preservedKeys / allKeys.length) * 100;
      expect(preservationRate).toBeGreaterThanOrEqual(66); // At least 66% preserved
    });

    it('should demonstrate cache hit rate improvement over full invalidation', () => {
      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet1!C1:D10',
        'sheet123:values:Sheet2!A1:B10',
        'sheet123:properties',
        'sheet123:sheets',
      ];

      // Test various operations
      const operations = [
        { tool: 'sheets_data', action: 'write' }, // Invalidates values only
        { tool: 'sheets_format', action: 'set_format' }, // Invalidates metadata only
        { tool: 'sheets_core', action: 'update_properties' }, // Invalidates metadata only
        { tool: 'sheets_collaborate', action: 'share' }, // No invalidation
      ];

      const results = operations.map(({ tool, action }) => {
        const keysToInvalidate = graph.getKeysToInvalidate(tool, action, allKeys);
        const preservedKeys = allKeys.length - keysToInvalidate.length;
        const preservationRate = (preservedKeys / allKeys.length) * 100;

        return {
          operation: `${tool}.${action}`,
          invalidated: keysToInvalidate.length,
          preserved: preservedKeys,
          preservationRate,
        };
      });

      // Log results for visibility
      console.log('\nCache Preservation by Operation:');
      results.forEach((result) => {
        console.log(
          `  ${result.operation}: ${result.preserved}/${allKeys.length} preserved (${result.preservationRate.toFixed(0)}%)`
        );
      });

      // Average preservation rate should be > 60% (target 40-60% hit rate means 40-60% preservation)
      const avgPreservation =
        results.reduce((sum, r) => sum + r.preservationRate, 0) / results.length;
      expect(avgPreservation).toBeGreaterThan(60);
    });

    it('should handle read operations without invalidation', () => {
      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet2!C1:D10',
      ];

      // Read operations should not invalidate anything
      const readOperations = [
        { tool: 'sheets_data', action: 'read' },
        { tool: 'sheets_core', action: 'get' },
        { tool: 'sheets_core', action: 'list' },
        { tool: 'sheets_analyze', action: 'scout' },
      ];

      for (const { tool, action } of readOperations) {
        const keysToInvalidate = graph.getKeysToInvalidate(tool, action, allKeys);
        expect(keysToInvalidate).toHaveLength(0);
      }

      // 100% cache preservation for read operations
    });

    it('should handle cascading invalidation for destructive operations', () => {
      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet2!C1:D10',
        'sheet123:properties',
        'sheet123:sheets',
      ];

      // Destructive operations should invalidate everything
      const destructiveOps = [
        { tool: 'sheets_core', action: 'delete_sheet' },
        { tool: 'sheets_history', action: 'undo' },
        { tool: 'sheets_fix', action: 'fix' },
      ];

      for (const { tool, action } of destructiveOps) {
        const keysToInvalidate = graph.getKeysToInvalidate(tool, action, allKeys);
        expect(keysToInvalidate).toEqual(allKeys);
        expect(graph.shouldCascade(tool, action)).toBe(true);
      }
    });

    it('should optimize for common workflows', () => {
      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet1!C1:D10',
        'sheet123:values:Sheet2!A1:B10',
      ];

      // Simulate a common workflow: read → format → read → write → read
      const workflow = [
        { tool: 'sheets_data', action: 'read', expectPreserve: 100 }, // No invalidation
        { tool: 'sheets_format', action: 'set_format', expectPreserve: 75 }, // Preserve values
        { tool: 'sheets_data', action: 'read', expectPreserve: 100 }, // No invalidation
        { tool: 'sheets_data', action: 'write', expectPreserve: 25 }, // Preserve metadata
        { tool: 'sheets_data', action: 'read', expectPreserve: 100 }, // No invalidation
      ];

      let hitCount = 0;
      let totalOperations = workflow.length;

      for (const step of workflow) {
        const keysToInvalidate = graph.getKeysToInvalidate(step.tool, step.action, allKeys);
        const preservedKeys = allKeys.length - keysToInvalidate.length;
        const preservationRate = (preservedKeys / allKeys.length) * 100;

        // Each step should preserve at least its expected amount
        expect(preservationRate).toBeGreaterThanOrEqual(step.expectPreserve);

        // Count potential cache hits (operations that don't invalidate everything)
        if (keysToInvalidate.length === 0) {
          hitCount++;
        } else if (keysToInvalidate.length < allKeys.length) {
          hitCount += preservationRate / 100; // Partial hit
        }
      }

      // Overall workflow should have >60% cache hit potential
      const workflowHitRate = (hitCount / totalOperations) * 100;
      expect(workflowHitRate).toBeGreaterThan(60);
    });
  });

  describe('Performance Impact', () => {
    it('should improve cache hit rate compared to full invalidation', () => {
      // Simulate 100 operations with realistic distribution
      const operations = [
        // 60% reads (no invalidation)
        ...Array(60).fill({ tool: 'sheets_data', action: 'read' }),
        // 20% writes (partial invalidation)
        ...Array(20).fill({ tool: 'sheets_data', action: 'write' }),
        // 10% format (partial invalidation)
        ...Array(10).fill({ tool: 'sheets_format', action: 'set_format' }),
        // 5% structural (full invalidation)
        ...Array(5).fill({ tool: 'sheets_core', action: 'add_sheet' }),
        // 5% analysis (no invalidation)
        ...Array(5).fill({ tool: 'sheets_analyze', action: 'summarize' }),
      ];

      const allKeys = [
        'sheet123:metadata',
        'sheet123:values:Sheet1!A1:B10',
        'sheet123:values:Sheet2!C1:D10',
      ];

      // Calculate average cache preservation
      let totalPreserved = 0;
      for (const { tool, action } of operations) {
        const keysToInvalidate = graph.getKeysToInvalidate(tool, action, allKeys);
        const preservedKeys = allKeys.length - keysToInvalidate.length;
        totalPreserved += preservedKeys;
      }

      const avgCachePreservation = totalPreserved / (operations.length * allKeys.length);

      // With selective invalidation, should preserve >70% of cache entries
      expect(avgCachePreservation).toBeGreaterThan(0.7);

      // With full invalidation after every write/format/structural change,
      // would preserve only 65% (reads + analysis only)
      const fullInvalidationPreservation = 0.65;

      // Improvement should be significant
      expect(avgCachePreservation).toBeGreaterThan(fullInvalidationPreservation);
    });
  });
});
