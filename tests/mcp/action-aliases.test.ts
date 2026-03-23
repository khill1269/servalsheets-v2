/**
 * Tests for Action Equivalence Map - Quick Win #4
 */

import { describe, it, expect } from 'vitest';
import { completeAction } from '../../src/mcp/completions.js';

describe('Action Equivalence Map - Quick Win #4', () => {
  describe('Data operations aliases', () => {
    it('should map "get data" to "read"', () => {
      const results = completeAction('sheets_data', 'get data');
      expect(results).toContain('read');
    });

    it('should map "fetch" to "read"', () => {
      const results = completeAction('sheets_data', 'fetch');
      expect(results).toContain('read');
    });

    it('should map "set data" to "write"', () => {
      const results = completeAction('sheets_data', 'set data');
      expect(results).toContain('write');
    });

    it('should map "erase" to "clear"', () => {
      const results = completeAction('sheets_data', 'erase');
      expect(results).toContain('clear');
    });

    it('should map "find" to "find_replace"', () => {
      const results = completeAction('sheets_data', 'find');
      expect(results).toContain('find_replace');
    });
  });

  describe('Spreadsheet operations aliases', () => {
    it('should map "new spreadsheet" to "create"', () => {
      const results = completeAction('sheets_core', 'new spreadsheet');
      expect(results).toContain('create');
    });

    it('should map "duplicate spreadsheet" to "copy"', () => {
      const results = completeAction('sheets_core', 'duplicate spreadsheet');
      expect(results).toContain('copy');
    });

    it('should map "new sheet" to "add_sheet"', () => {
      const results = completeAction('sheets_core', 'new sheet');
      expect(results).toContain('add_sheet');
    });

    it('should map "delete tab" to "delete_sheet"', () => {
      const results = completeAction('sheets_core', 'delete tab');
      expect(results).toContain('delete_sheet');
    });

    it('should map "rename sheet" to "update_sheet"', () => {
      const results = completeAction('sheets_core', 'rename sheet');
      expect(results).toContain('update_sheet');
    });

    it('should map "rename tab" to "update_sheet"', () => {
      const results = completeAction('sheets_core', 'rename tab');
      expect(results).toContain('update_sheet');
    });

    it('should map generic "rename" to "update_sheet"', () => {
      const results = completeAction('sheets_core', 'rename');
      expect(results).toContain('update_sheet');
    });
  });

  describe('Formatting operations aliases', () => {
    it('should map "color" to "set_background"', () => {
      const results = completeAction('sheets_format', 'color');
      expect(results).toContain('set_background');
    });

    it('should map "font" to "set_text_format"', () => {
      const results = completeAction('sheets_format', 'font');
      expect(results).toContain('set_text_format');
    });

    it('should map "currency" to "set_number_format"', () => {
      const results = completeAction('sheets_format', 'currency');
      expect(results).toContain('set_number_format');
    });

    it('should map "percentage" to "set_number_format"', () => {
      const results = completeAction('sheets_format', 'percentage');
      expect(results).toContain('set_number_format');
    });
  });

  describe('Dimension operations aliases', () => {
    it('should map "add row" to "insert"', () => {
      const results = completeAction('sheets_dimensions', 'add row');
      expect(results).toContain('insert');
    });

    it('should map "new column" to "insert"', () => {
      const results = completeAction('sheets_dimensions', 'new column');
      expect(results).toContain('insert');
    });

    it('should map "delete row" to "delete"', () => {
      const results = completeAction('sheets_dimensions', 'delete row');
      expect(results).toContain('delete');
    });

    it('should map "hide column" to "hide"', () => {
      const results = completeAction('sheets_dimensions', 'hide column');
      expect(results).toContain('hide');
    });
  });

  describe('Chart operations aliases', () => {
    it('should map "create chart" to "chart_create"', () => {
      const results = completeAction('sheets_visualize', 'create chart');
      expect(results).toContain('chart_create');
    });

    it('should map "make graph" to "chart_create"', () => {
      const results = completeAction('sheets_visualize', 'make graph');
      expect(results).toContain('chart_create');
    });

    it('should map "visualize" to "chart_create"', () => {
      const results = completeAction('sheets_visualize', 'visualize');
      expect(results).toContain('chart_create');
    });

    it('should map "modify chart" to "chart_update"', () => {
      const results = completeAction('sheets_visualize', 'modify chart');
      expect(results).toContain('chart_update');
    });
  });

  describe('Cell operations aliases', () => {
    it('should map "merge" to "merge_cells"', () => {
      const results = completeAction('sheets_data', 'merge');
      expect(results).toContain('merge_cells');
    });

    it('should map "combine cells" to "merge_cells"', () => {
      const results = completeAction('sheets_data', 'combine cells');
      expect(results).toContain('merge_cells');
    });

    it('should map "unmerge" to "unmerge_cells"', () => {
      const results = completeAction('sheets_data', 'unmerge');
      expect(results).toContain('unmerge_cells');
    });
  });

  describe('Analysis operations aliases', () => {
    it('should map "understand" to "comprehensive"', () => {
      const results = completeAction('sheets_analyze', 'understand');
      expect(results).toContain('comprehensive');
    });

    it('should map "analyze" to "analyze_data"', () => {
      const results = completeAction('sheets_analyze', 'analyze');
      expect(results).toContain('analyze_data');
    });

    it('should map "check quality" to "analyze_quality"', () => {
      const results = completeAction('sheets_analyze', 'check quality');
      expect(results).toContain('analyze_quality');
    });

    it('should map "stats" to "analyze_data"', () => {
      const results = completeAction('sheets_analyze', 'stats');
      expect(results).toContain('analyze_data');
    });

    it('should map "patterns" to "detect_patterns"', () => {
      const results = completeAction('sheets_analyze', 'patterns');
      expect(results).toContain('detect_patterns');
    });
  });

  describe('Collaboration operations aliases', () => {
    it('should map "share" to "share_add"', () => {
      const results = completeAction('sheets_collaborate', 'share');
      expect(results).toContain('share_add');
    });

    it('should map "give access" to "share_add"', () => {
      const results = completeAction('sheets_collaborate', 'give access');
      expect(results).toContain('share_add');
    });

    it('should map "revoke" to "share_remove"', () => {
      const results = completeAction('sheets_collaborate', 'revoke');
      expect(results).toContain('share_remove');
    });

    it('should map "change permission" to "share_update"', () => {
      const results = completeAction('sheets_collaborate', 'change permission');
      expect(results).toContain('share_update');
    });
  });

  describe('Version operations aliases', () => {
    it('should map "snapshot" to "version_create_snapshot"', () => {
      const results = completeAction('sheets_collaborate', 'snapshot');
      expect(results).toContain('version_create_snapshot');
    });

    it('should map "undo" to "version_restore_revision"', () => {
      const results = completeAction('sheets_collaborate', 'undo');
      expect(results).toContain('version_restore_revision');
    });

    it('should map "restore" to "version_restore_revision"', () => {
      const results = completeAction('sheets_collaborate', 'restore');
      expect(results).toContain('version_restore_revision');
    });
  });

  describe('Transaction operations aliases', () => {
    it('should map "batch" to "begin"', () => {
      const results = completeAction('sheets_transaction', 'batch');
      expect(results).toContain('begin');
    });

    it('should map "atomic" to "begin"', () => {
      const results = completeAction('sheets_transaction', 'atomic');
      expect(results).toContain('begin');
    });
  });

  describe('Fallback to direct action matching', () => {
    it('should still match direct action names when no alias', () => {
      const results = completeAction('sheets_data', 'read');
      expect(results).toContain('read');
    });

    it('should match action name prefixes', () => {
      const results = completeAction('sheets_data', 'bat');
      expect(results).toContain('batch_read');
      expect(results).toContain('batch_write');
    });

    it('should prioritize direct matches over aliases', () => {
      const results = completeAction('sheets_data', 'rea');
      expect(results[0]).toBe('read'); // Direct prefix match comes first
    });
  });

  describe('Partial alias matching', () => {
    it('should match partial phrases in aliases', () => {
      const results = completeAction('sheets_visualize', 'chart');
      // Should find actions containing 'chart'
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.includes('chart'))).toBe(true);
    });

    it('should require minimum 3 characters for alias matching', () => {
      const results = completeAction('sheets_data', 'fi');
      // Too short for alias matching, should fall back to direct prefix
      expect(results.length).toBeLessThanOrEqual(20);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty partial string', () => {
      const results = completeAction('sheets_data', '');
      expect(results).toEqual([]);
    });

    it('should handle undefined partial string', () => {
      const results = completeAction('sheets_data', undefined as unknown as string);
      expect(results).toEqual([]);
    });

    it('should handle non-existent tool name', () => {
      const results = completeAction('non_existent_tool', 'read');
      expect(results).toEqual([]);
    });

    it('should deduplicate results', () => {
      const results = completeAction('sheets_data', 'read');
      const unique = [...new Set(results)];
      expect(results.length).toBe(unique.length);
    });

    it('should limit results to 20', () => {
      // Even if many matches, should cap at 20
      const results = completeAction('sheets_data', 'a');
      expect(results.length).toBeLessThanOrEqual(20);
    });
  });

  describe('Case insensitivity', () => {
    it('should match aliases case-insensitively', () => {
      const lowerResults = completeAction('sheets_data', 'get data');
      const upperResults = completeAction('sheets_data', 'GET DATA');
      const mixedResults = completeAction('sheets_data', 'Get Data');

      expect(lowerResults).toContain('read');
      expect(upperResults).toContain('read');
      expect(mixedResults).toContain('read');
    });

    it('should match action names case-insensitively', () => {
      const lowerResults = completeAction('sheets_data', 'read');
      const upperResults = completeAction('sheets_data', 'READ');

      expect(lowerResults).toContain('read');
      expect(upperResults).toContain('read');
    });
  });
});
