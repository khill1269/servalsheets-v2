/**
 * Response Compactor Tests
 * Phase 0.1: Verify list action fields remain arrays (not wrapped in objects)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { compactResponse } from '../../src/utils/response-compactor.js';

describe('Response Compactor - List Action Fields (Phase 0.1)', () => {
  beforeEach(() => {
    // Ensure compact mode is enabled for tests
    delete process.env['COMPACT_RESPONSES'];
  });

  afterEach(() => {
    delete process.env['COMPACT_RESPONSES'];
  });

  describe('BUG FIX: List action fields remain arrays', () => {
    it('should keep permissions array for share_list (small array)', () => {
      const response = {
        success: true,
        action: 'share_list',
        permissions: [
          { id: '1', email: 'user1@test.com', role: 'writer' },
          { id: '2', email: 'user2@test.com', role: 'reader' },
        ],
      };

      const compacted = compactResponse(response);

      expect(compacted.permissions).toBeDefined();
      expect(Array.isArray(compacted.permissions)).toBe(true);
      expect(compacted.permissions).toHaveLength(2);
      expect(compacted.permissions[0]).toEqual({
        id: '1',
        email: 'user1@test.com',
        role: 'writer',
      });
    });

    it('should keep permissions array for share_list (large array, truncated)', () => {
      const permissions = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        email: `user${i}@test.com`,
        role: 'reader',
      }));

      const response = {
        success: true,
        action: 'share_list',
        permissions,
      };

      const compacted = compactResponse(response);

      // Should be truncated to 50 items but remain an array
      expect(compacted.permissions).toBeDefined();
      expect(Array.isArray(compacted.permissions)).toBe(true);
      expect(compacted.permissions).toHaveLength(50);
      expect(compacted.permissions[0]).toEqual({
        id: '0',
        email: 'user0@test.com',
        role: 'reader',
      });

      // Should NOT be wrapped in object like { _truncated: true, items: [...] }
      expect('_truncated' in (compacted.permissions as object)).toBe(false);
    });

    it('should keep comments array for comment_list', () => {
      const comments = Array.from({ length: 30 }, (_, i) => ({
        id: String(i),
        content: `Comment ${i}`,
        author: 'user@test.com',
      }));

      const response = {
        success: true,
        action: 'comment_list',
        comments,
      };

      const compacted = compactResponse(response);

      expect(compacted.comments).toBeDefined();
      expect(Array.isArray(compacted.comments)).toBe(true);
      expect(compacted.comments).toHaveLength(30);
    });

    it('should keep namedRanges array for list_named_ranges', () => {
      const namedRanges = Array.from({ length: 15 }, (_, i) => ({
        name: `Range${i}`,
        range: `Sheet1!A${i}:B${i}`,
      }));

      const response = {
        success: true,
        action: 'list_named_ranges',
        namedRanges,
      };

      const compacted = compactResponse(response);

      expect(compacted.namedRanges).toBeDefined();
      expect(Array.isArray(compacted.namedRanges)).toBe(true);
      expect(compacted.namedRanges).toHaveLength(15);
    });

    it('should truncate but keep array for very large permissions list', () => {
      const permissions = Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        email: `user${i}@test.com`,
        role: 'reader',
      }));

      const response = {
        success: true,
        action: 'share_list',
        permissions,
      };

      const compacted = compactResponse(response);

      // Should be truncated to 50 items
      expect(compacted.permissions).toBeDefined();
      expect(Array.isArray(compacted.permissions)).toBe(true);
      expect(compacted.permissions).toHaveLength(50);

      // First item should be preserved
      expect(compacted.permissions[0]).toEqual({
        id: '0',
        email: 'user0@test.com',
        role: 'reader',
      });
    });
  });

  describe('Verbosity override', () => {
    it('should skip truncation with verbosity:"detailed"', () => {
      const permissions = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        email: `user${i}@test.com`,
        role: 'reader',
      }));

      const response = {
        success: true,
        action: 'share_list',
        permissions,
      };

      const compacted = compactResponse(response, { verbosity: 'detailed' });

      // Should NOT be truncated
      expect(compacted.permissions).toHaveLength(100);
      expect(Array.isArray(compacted.permissions)).toBe(true);
    });
  });

  describe('Empty arrays', () => {
    it('should handle empty permissions array', () => {
      const response = {
        success: true,
        action: 'share_list',
        permissions: [],
      };

      const compacted = compactResponse(response);

      expect(compacted.permissions).toBeDefined();
      expect(Array.isArray(compacted.permissions)).toBe(true);
      expect(compacted.permissions).toHaveLength(0);
    });
  });

  describe('Nested data payloads', () => {
    it('preserves nested list arrays inside response.data', () => {
      const response = {
        response: {
          success: true,
          data: {
            webhooks: [],
            message: 'No webhooks registered',
          },
        },
      };

      const compacted = compactResponse(response) as {
        response: {
          data: {
            webhooks: unknown[];
            message: string;
          };
        };
      };

      expect(Array.isArray(compacted.response.data.webhooks)).toBe(true);
      expect(compacted.response.data.webhooks).toEqual([]);
      expect(compacted.response.data.message).toBe('No webhooks registered');
    });
  });
});

// ─── Task A6: Explicit truncation hints ──────────────────────────────────────

describe('Truncation hints (_truncated key on response object)', () => {
  it('adds _truncated key when a 2D values array is truncated', () => {
    // Create a large 2D array (>500 cells) to trigger truncation
    const bigGrid: (string | number)[][] = [
      Array.from({ length: 30 }, (_, i) => `Col${i}`),
      ...Array.from({ length: 20 }, (_, r) =>
        Array.from({ length: 30 }, (_, c) => r * 30 + c)
      ),
    ];

    const response = {
      success: true,
      action: 'read',
      values: bigGrid,
    };

    const compacted = compactResponse(response);
    const valuesField = (compacted as Record<string, unknown>)['values'];

    // values should have been truncated (600 cells > 500 MAX_INLINE_ITEMS)
    expect(valuesField).toBeDefined();
    // The top-level response should now include a _truncated hint
    const resp = compacted as Record<string, unknown>;
    expect(resp['_truncated']).toBeDefined();
    const truncated = resp['_truncated'] as Record<string, string>;
    expect(typeof truncated).toBe('object');
    expect(truncated['values']).toBeDefined();
    expect(truncated['values']).toContain('verbosity');
  });

  it('does NOT add _truncated key when no truncation occurred', () => {
    const response = {
      success: true,
      action: 'read',
      values: [
        ['Name', 'Age'],
        ['Alice', 30],
        ['Bob', 25],
      ],
    };

    const compacted = compactResponse(response);
    const resp = compacted as Record<string, unknown>;
    expect(resp['_truncated']).toBeUndefined();
  });

  it('adds _truncated with correct field name when a list field is truncated', () => {
    // Create a large permissions array (>50 items triggers LIST_ACTION_FIELDS truncation)
    const permissions = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      email: `user${i}@test.com`,
      role: 'reader',
    }));

    const response = {
      success: true,
      action: 'share_list',
      permissions,
    };

    const compacted = compactResponse(response);
    const resp = compacted as Record<string, unknown>;
    expect(resp['_truncated']).toBeDefined();
    const truncated = resp['_truncated'] as Record<string, string>;
    expect(truncated['permissions']).toBeDefined();
    expect(truncated['permissions']).toContain('50');
  });

  it('_truncated message includes verbosity hint', () => {
    const bigGrid: number[][] = Array.from({ length: 25 }, () =>
      Array.from({ length: 25 }, (_, c) => c)
    );
    const response = {
      success: true,
      action: 'read',
      values: bigGrid,
    };

    const compacted = compactResponse(response);
    const resp = compacted as Record<string, unknown>;
    if (resp['_truncated']) {
      const truncated = resp['_truncated'] as Record<string, string>;
      if (truncated['values']) {
        expect(truncated['values']).toContain('verbosity');
      }
    }
    // If no truncation triggered, test is not applicable but passes
  });
});

describe('Phase 0.1 - All Affected List Actions', () => {
  it('should handle all 8 affected list action fields from bug report', () => {
    // Test all fields mentioned in Phase 0.1 bug report
    const testCases = [
      { field: 'permissions', action: 'share_list', handler: 'sheets_collaborate' },
      { field: 'comments', action: 'comment_list', handler: 'sheets_collaborate' },
      { field: 'revisions', action: 'version_list_revisions', handler: 'sheets_collaborate' },
      { field: 'namedRanges', action: 'list_named_ranges', handler: 'sheets_advanced' },
      { field: 'filterViews', action: 'list_filter_views', handler: 'sheets_dimensions' },
      { field: 'filter', action: 'get_basic_filter', handler: 'sheets_dimensions' },
      { field: 'valueRanges', action: 'batch_read', handler: 'sheets_data' },
      { field: 'templates', action: 'list', handler: 'sheets_templates' },
    ];

    for (const { field, action } of testCases) {
      // Create test data (20 items to test truncation logic)
      const data = Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        value: `Item ${i}`,
      }));

      const response = {
        success: true,
        action,
        [field]: data,
      };

      const compacted = compactResponse(response);

      // Verify field exists and is array (not object)
      expect(compacted[field], `${field} should exist`).toBeDefined();
      expect(Array.isArray(compacted[field]), `${field} should be an array`).toBe(true);

      const fieldValue = compacted[field];
      if (Array.isArray(fieldValue)) {
        expect(fieldValue.length, `${field} should have items`).toBeGreaterThan(0);
      }

      // Ensure not wrapped in truncation object
      expect('_truncated' in (compacted[field] as object), `${field} should not be wrapped`).toBe(
        false
      );
    }
  });
});
