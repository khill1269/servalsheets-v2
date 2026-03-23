/**
 * Cache Invalidation Graph Tests
 *
 * Tests for operation-based cache invalidation rules to achieve 40-60% cache hit rate.
 * Uses TDD approach to drive implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CacheInvalidationGraph } from '../../src/services/cache-invalidation-graph.js';
import { ACTION_COUNTS } from '../../src/schemas/action-counts.js';

describe('CacheInvalidationGraph', () => {
  let graph: CacheInvalidationGraph;

  beforeEach(() => {
    graph = new CacheInvalidationGraph();
  });

  describe('Initialization', () => {
    it('should have invalidation rules for all actions', () => {
      const totalActions = Object.values(ACTION_COUNTS).reduce((sum, count) => sum + count, 0);

      // Get all rules
      const rules = graph.getAllRules();
      const ruleCount = Object.keys(rules).length;

      // Should have exactly one rule per action
      expect(ruleCount).toBeGreaterThanOrEqual(totalActions);
    });

    it('should validate all rule patterns', () => {
      const rules = graph.getAllRules();

      for (const [action, rule] of Object.entries(rules)) {
        expect(action).toMatch(/^sheets_\w+\.\w+$/);
        expect(rule).toHaveProperty('invalidates');
        expect(Array.isArray(rule.invalidates)).toBe(true);
        // Read-only operations can have empty invalidates arrays
      }
    });
  });

  describe('Read Operations (No Invalidation)', () => {
    it('sheets_data.read should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'read');
      expect(patterns).toEqual([]);
    });

    it('sheets_core.get should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_core', 'get');
      expect(patterns).toEqual([]);
    });

    it('sheets_core.list should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_core', 'list');
      expect(patterns).toEqual([]);
    });

    it('sheets_data.batch_read should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'batch_read');
      expect(patterns).toEqual([]);
    });
  });

  describe('Write Operations (Selective Invalidation)', () => {
    it('sheets_data.write should invalidate values cache but not metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'write');

      expect(patterns).toContain('values:*');
      expect(patterns).not.toContain('metadata:*');
    });

    it('sheets_data.batch_write should invalidate values cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'batch_write');

      expect(patterns).toContain('values:*');
      expect(patterns).not.toContain('metadata:*');
    });

    it('sheets_data.append should invalidate values cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'append');

      expect(patterns).toContain('values:*');
    });

    it('sheets_data.clear should invalidate values cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'clear');

      expect(patterns).toContain('values:*');
    });
  });

  describe('Format Operations (Selective Invalidation)', () => {
    it('sheets_format.update_format should invalidate metadata but not values', () => {
      const patterns = graph.getInvalidationKeys('sheets_format', 'update_format');

      expect(patterns).toContain('metadata:*');
      expect(patterns).not.toContain('values:*');
    });

    it('sheets_format.set_format should invalidate metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_format', 'set_format');

      expect(patterns).toContain('metadata:*');
    });

    it('sheets_format.clear_format should invalidate metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_format', 'clear_format');

      expect(patterns).toContain('metadata:*');
    });

    it('sheets_format.add_conditional_format_rule should invalidate metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_format', 'add_conditional_format_rule');

      expect(patterns).toContain('metadata:*');
    });
  });

  describe('Structural Operations (Full Invalidation)', () => {
    it('sheets_core.add_sheet should invalidate metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_core', 'add_sheet');

      expect(patterns).toContain('metadata:*');
      expect(graph.shouldCascade('sheets_core', 'add_sheet')).toBe(false);
    });

    it('sheets_core.delete_sheet should invalidate everything', () => {
      const patterns = graph.getInvalidationKeys('sheets_core', 'delete_sheet');

      expect(patterns).toContain('*');
      expect(graph.shouldCascade('sheets_core', 'delete_sheet')).toBe(true);
    });

    it('sheets_dimensions.insert_rows should invalidate values and metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_dimensions', 'insert_rows');

      expect(patterns).toContain('values:*');
      expect(patterns).toContain('metadata:*');
    });

    it('sheets_dimensions.delete_rows should invalidate values and metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_dimensions', 'delete_rows');

      expect(patterns).toContain('values:*');
      expect(patterns).toContain('metadata:*');
    });

    it('sheets_dimensions.insert_columns should invalidate values and metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_dimensions', 'insert_columns');

      expect(patterns).toContain('values:*');
      expect(patterns).toContain('metadata:*');
    });
  });

  describe('Pattern Matching', () => {
    it('should match wildcard patterns correctly', () => {
      const allKeys = [
        'spreadsheet123:metadata',
        'spreadsheet123:values:Sheet1!A1:B10',
        'spreadsheet123:values:Sheet2!C1:D10',
        'spreadsheet123:properties',
      ];

      const keysToInvalidate = graph.getKeysToInvalidate('sheets_data', 'write', allKeys);

      // Should match all values:* keys
      expect(keysToInvalidate).toContain('spreadsheet123:values:Sheet1!A1:B10');
      expect(keysToInvalidate).toContain('spreadsheet123:values:Sheet2!C1:D10');

      // Should NOT match metadata or properties
      expect(keysToInvalidate).not.toContain('spreadsheet123:metadata');
      expect(keysToInvalidate).not.toContain('spreadsheet123:properties');
    });

    it('should match exact patterns correctly', () => {
      const allKeys = [
        'spreadsheet123:metadata',
        'spreadsheet123:values:Sheet1!A1:B10',
        'spreadsheet123:properties',
      ];

      const keysToInvalidate = graph.getKeysToInvalidate('sheets_format', 'update_format', allKeys);

      // Should match metadata
      expect(keysToInvalidate).toContain('spreadsheet123:metadata');

      // Should NOT match values or properties
      expect(keysToInvalidate).not.toContain('spreadsheet123:values:Sheet1!A1:B10');
      expect(keysToInvalidate).not.toContain('spreadsheet123:properties');
    });

    it('should match full wildcard pattern correctly', () => {
      const allKeys = [
        'spreadsheet123:metadata',
        'spreadsheet123:values:Sheet1!A1:B10',
        'spreadsheet123:properties',
        'spreadsheet123:sheets',
      ];

      const keysToInvalidate = graph.getKeysToInvalidate('sheets_core', 'delete_sheet', allKeys);

      // Should match all keys
      expect(keysToInvalidate).toEqual(allKeys);
    });
  });

  describe('Cascade Behavior', () => {
    it('should not cascade for data writes', () => {
      expect(graph.shouldCascade('sheets_data', 'write')).toBe(false);
      expect(graph.shouldCascade('sheets_data', 'batch_write')).toBe(false);
    });

    it('should not cascade for format changes', () => {
      expect(graph.shouldCascade('sheets_format', 'update_format')).toBe(false);
      expect(graph.shouldCascade('sheets_format', 'set_format')).toBe(false);
    });

    it('should cascade for structural changes', () => {
      expect(graph.shouldCascade('sheets_core', 'delete_sheet')).toBe(true);
      expect(graph.shouldCascade('sheets_dimensions', 'delete_rows')).toBe(true);
      expect(graph.shouldCascade('sheets_dimensions', 'delete_columns')).toBe(true);
    });

    it('should not cascade for non-destructive structural changes', () => {
      expect(graph.shouldCascade('sheets_core', 'add_sheet')).toBe(false);
      expect(graph.shouldCascade('sheets_dimensions', 'insert_rows')).toBe(false);
      expect(graph.shouldCascade('sheets_dimensions', 'insert_columns')).toBe(false);
    });
  });

  describe('Transaction Operations', () => {
    it('sheets_transaction.begin should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_transaction', 'begin');
      expect(patterns).toEqual([]);
    });

    it('sheets_transaction.commit should invalidate based on operations', () => {
      const patterns = graph.getInvalidationKeys('sheets_transaction', 'commit');
      // Commit should invalidate everything to be safe
      expect(patterns).toContain('*');
    });

    it('sheets_transaction.rollback should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_transaction', 'rollback');
      expect(patterns).toEqual([]);
    });
  });

  describe('Chart and Visualization Operations', () => {
    it('sheets_visualize.create_chart should invalidate metadata only', () => {
      const patterns = graph.getInvalidationKeys('sheets_visualize', 'create_chart');

      expect(patterns).toContain('metadata:*');
      expect(patterns).not.toContain('values:*');
    });

    it('sheets_visualize.update_chart should invalidate metadata only', () => {
      const patterns = graph.getInvalidationKeys('sheets_visualize', 'update_chart');

      expect(patterns).toContain('metadata:*');
      expect(patterns).not.toContain('values:*');
    });

    it('sheets_visualize.delete_chart should invalidate metadata only', () => {
      const patterns = graph.getInvalidationKeys('sheets_visualize', 'delete_chart');

      expect(patterns).toContain('metadata:*');
      expect(patterns).not.toContain('values:*');
    });
  });

  describe('Collaboration Operations', () => {
    it('sheets_collaborate.share should not invalidate data cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_collaborate', 'share');
      // Sharing doesn't affect data or metadata
      expect(patterns).toEqual([]);
    });

    it('sheets_collaborate.comment_add should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_collaborate', 'comment_add');
      // Comments are separate from spreadsheet data
      expect(patterns).toEqual([]);
    });

    it('sheets_collaborate.protect_range should invalidate metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_collaborate', 'protect_range');

      expect(patterns).toContain('metadata:*');
      expect(patterns).not.toContain('values:*');
    });
  });

  describe('Advanced Operations', () => {
    it('sheets_advanced.sort_range should invalidate values', () => {
      const patterns = graph.getInvalidationKeys('sheets_advanced', 'sort_range');

      expect(patterns).toContain('values:*');
      expect(patterns).not.toContain('metadata:*');
    });

    it('sheets_advanced.filter should not invalidate cache (read operation)', () => {
      const patterns = graph.getInvalidationKeys('sheets_advanced', 'filter');
      expect(patterns).toEqual([]);
    });

    it('sheets_advanced.merge_cells should invalidate values and metadata', () => {
      const patterns = graph.getInvalidationKeys('sheets_advanced', 'merge_cells');

      expect(patterns).toContain('values:*');
      expect(patterns).toContain('metadata:*');
    });
  });

  describe('History Operations', () => {
    it('sheets_history.list should not invalidate cache', () => {
      const patterns = graph.getInvalidationKeys('sheets_history', 'list');
      expect(patterns).toEqual([]);
    });

    it('sheets_history.undo should invalidate everything', () => {
      const patterns = graph.getInvalidationKeys('sheets_history', 'undo');
      // Undo can affect any cached state
      expect(patterns).toContain('*');
    });

    it('sheets_history.redo should invalidate everything', () => {
      const patterns = graph.getInvalidationKeys('sheets_history', 'redo');
      // Redo can affect any cached state
      expect(patterns).toContain('*');
    });
  });

  describe('Cache Hit Rate Optimization', () => {
    it('should preserve cache for orthogonal operations', () => {
      const allKeys = [
        'spreadsheet123:metadata',
        'spreadsheet123:values:Sheet1!A1:B10',
        'spreadsheet123:values:Sheet2!C1:D10',
      ];

      // Format change should preserve values cache
      const formatKeys = graph.getKeysToInvalidate('sheets_format', 'update_format', allKeys);
      expect(formatKeys.length).toBe(1); // Only metadata
      expect(formatKeys).toContain('spreadsheet123:metadata');

      // Data write should preserve metadata cache
      const dataKeys = graph.getKeysToInvalidate('sheets_data', 'write', allKeys);
      expect(dataKeys.length).toBe(2); // Only values
      expect(dataKeys).toContain('spreadsheet123:values:Sheet1!A1:B10');
      expect(dataKeys).toContain('spreadsheet123:values:Sheet2!C1:D10');
    });

    it('should support range-specific invalidation', () => {
      const allKeys = [
        'spreadsheet123:values:Sheet1!A1:B10',
        'spreadsheet123:values:Sheet1!C1:D10',
        'spreadsheet123:values:Sheet2!A1:B10',
      ];

      // Future: range-specific invalidation for targeted writes
      // For now, write invalidates all values:* patterns
      const dataKeys = graph.getKeysToInvalidate('sheets_data', 'write', allKeys);
      expect(dataKeys.length).toBe(3); // All values invalidated
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown tool gracefully', () => {
      const patterns = graph.getInvalidationKeys('unknown_tool', 'unknown_action');
      // Unknown operations should invalidate everything to be safe
      expect(patterns).toContain('*');
    });

    it('should handle unknown action gracefully', () => {
      const patterns = graph.getInvalidationKeys('sheets_data', 'unknown_action');
      // Unknown operations should invalidate everything to be safe
      expect(patterns).toContain('*');
    });

    it('should handle empty key list', () => {
      const keysToInvalidate = graph.getKeysToInvalidate('sheets_data', 'write', []);
      expect(keysToInvalidate).toEqual([]);
    });
  });

  describe('Rule Consistency', () => {
    it('should have consistent naming for similar operations', () => {
      // All write operations should have similar patterns
      const writeActions = ['write', 'batch_write', 'append', 'update'];

      for (const action of writeActions) {
        const patterns = graph.getInvalidationKeys('sheets_data', action);
        expect(patterns).toContain('values:*');
      }
    });

    it('should have consistent patterns for format operations', () => {
      const formatActions = ['update_format', 'set_format', 'clear_format'];

      for (const action of formatActions) {
        const patterns = graph.getInvalidationKeys('sheets_format', action);
        expect(patterns).toContain('metadata:*');
      }
    });
  });

  describe('Performance', () => {
    it('should perform pattern matching efficiently', () => {
      const allKeys = Array.from(
        { length: 1000 },
        (_, i) => `spreadsheet123:values:Sheet${i}!A1:B10`
      );

      const start = Date.now();
      const keysToInvalidate = graph.getKeysToInvalidate('sheets_data', 'write', allKeys);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(50); // Should complete in < 50ms
      expect(keysToInvalidate.length).toBe(1000); // All values matched
    });

    it('should handle large rule sets efficiently', () => {
      const start = Date.now();
      const allRules = graph.getAllRules();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10); // Should complete in < 10ms
      expect(Object.keys(allRules).length).toBeGreaterThanOrEqual(298);
    });
  });
});
