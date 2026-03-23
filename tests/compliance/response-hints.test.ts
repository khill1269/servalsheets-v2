/**
 * Response Hints Tests
 *
 * Tests that Claude receives actionable hints when data is truncated,
 * paginated, or when session context is available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compactResponse, isCompactModeEnabled } from '../../src/utils/response-compactor.js';
import { getSessionContext, resetSessionContext } from '../../src/services/session-context.js';

// Enable compact mode for these tests (global setup disables it)
const originalCompactResponses = process.env['COMPACT_RESPONSES'];

beforeAll(() => {
  delete process.env['COMPACT_RESPONSES'];
});

afterAll(() => {
  if (originalCompactResponses !== undefined) {
    process.env['COMPACT_RESPONSES'] = originalCompactResponses;
  }
});

describe('Response Truncation Hints', () => {
  it('should add _hint when 2D array is truncated', () => {
    // Create a response with >10 rows (threshold for truncation)
    const bigValues = Array.from({ length: 200 }, (_, i) => [`row${i}`, `data${i}`, `value${i}`]);

    const response = {
      success: true,
      action: 'read',
      values: bigValues,
    };

    const compacted = compactResponse({ response });
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['_hint']).toBeDefined();
    expect(inner['_hint']).toContain('truncated');
    expect(inner['_hint']).toContain('verbosity:"detailed"');
  });

  it('should add _hint when 1D array is truncated', () => {
    // Must exceed MAX_INLINE_ITEMS (500) to trigger truncation
    const bigItems = Array.from({ length: 600 }, (_, i) => ({
      id: `item_${i}`,
      name: `Item ${i}`,
    }));

    const response = {
      success: true,
      action: 'list',
      items: bigItems,
    };

    const compacted = compactResponse({ response });
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['_hint']).toBeDefined();
    expect(inner['_hint']).toContain('truncated');
  });

  it('should add _hint with cursor when pagination is available', () => {
    const response = {
      success: true,
      action: 'read',
      values: [['a', 'b']],
      hasMore: true,
      nextCursor: 'cursor_abc123',
    };

    const compacted = compactResponse({ response });
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['_hint']).toBeDefined();
    expect(inner['_hint']).toContain('cursor:"cursor_abc123"');
  });

  it('should NOT add _hint when data fits within limits', () => {
    const response = {
      success: true,
      action: 'read',
      values: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    };

    const compacted = compactResponse({ response });
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['_hint']).toBeUndefined();
  });

  it('should NOT add _hint when verbosity is detailed', () => {
    const bigValues = Array.from({ length: 200 }, (_, i) => [`row${i}`, `data${i}`]);

    const response = {
      success: true,
      action: 'read',
      values: bigValues,
    };

    const compacted = compactResponse({ response }, { verbosity: 'detailed' });
    const inner = compacted.response as Record<string, unknown>;

    // verbosity:detailed skips truncation entirely, so no hint needed
    expect(inner['_hint']).toBeUndefined();
  });

  it('should include total count in _hint for list action fields', () => {
    const bigPermissions = Array.from({ length: 100 }, (_, i) => ({
      id: `perm_${i}`,
      email: `user${i}@example.com`,
      role: 'reader',
    }));

    const response = {
      success: true,
      action: 'share_list',
      permissions: bigPermissions,
    };

    const compacted = compactResponse({ response });
    const inner = compacted.response as Record<string, unknown>;

    // LIST_ACTION_FIELDS get truncated to 50 items as array (not wrapped)
    if (inner['_hint']) {
      expect(inner['_hint']).toContain('permissions');
      expect(inner['_hint']).toContain('100');
    }
  });

  it('should include cursor hint when both truncation and pagination occur', () => {
    // Must exceed MAX_INLINE_ITEMS (500 cells) to trigger truncation
    // 300 rows × 2 cols = 600 cells > 500 threshold
    const bigValues = Array.from({ length: 300 }, (_, i) => [`row${i}`, `data${i}`]);

    const response = {
      success: true,
      action: 'read',
      values: bigValues,
      hasMore: true,
      nextCursor: 'page2_cursor',
    };

    const compacted = compactResponse({ response });
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['_hint']).toBeDefined();
    expect(inner['_hint']).toContain('truncated');
    expect(inner['_hint']).toContain('cursor:"page2_cursor"');
  });
});

describe('Session Context in Responses', () => {
  beforeAll(() => {
    resetSessionContext();
  });

  it('should include contextSummary when no spreadsheet is active', () => {
    const session = getSessionContext();
    const summary = session.getContextSummary();

    expect(summary).toContain('No spreadsheet currently active');
  });

  it('should include spreadsheet info in contextSummary after set_active', () => {
    const session = getSessionContext();
    session.setActiveSpreadsheet({
      spreadsheetId: '1ABC_test',
      title: 'Test Budget',
      sheetNames: ['Sheet1', 'Data', 'Charts'],
      activatedAt: Date.now(),
    });

    const summary = session.getContextSummary();

    expect(summary).toContain('Test Budget');
    expect(summary).toContain('3 sheets');
    expect(summary).toContain('Sheet1');
  });

  it('should include last operation in contextSummary', () => {
    const session = getSessionContext();
    session.recordOperation({
      tool: 'sheets_data',
      action: 'write',
      spreadsheetId: '1ABC_test',
      description: 'Updated Q1 sales data',
      undoable: true,
      cellsAffected: 50,
    });

    const summary = session.getContextSummary();

    expect(summary).toContain('Updated Q1 sales data');
  });

  it('should include pending operation in contextSummary', () => {
    const session = getSessionContext();
    session.setPendingOperation({
      type: 'bulk_import',
      step: 2,
      totalSteps: 5,
      context: { source: 'csv' },
    });

    const summary = session.getContextSummary();

    expect(summary).toContain('bulk_import');
    expect(summary).toContain('step 2/5');
  });

  it('should suggest next actions based on context', () => {
    const session = getSessionContext();
    const suggestions = session.suggestNextActions();

    // After a write, should suggest format or verify
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
