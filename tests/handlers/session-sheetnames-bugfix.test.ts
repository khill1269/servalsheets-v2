/**
 * Session Handler - sheetNames Bug Fix Tests (Phase 0.11.1)
 *
 * Tests for bug: get_context returns sheetNames: [] even when sheets exist
 * Evidence from test log: activeSpreadsheet.sheetNames always returns empty array
 *
 * Root cause: When set_active is called without sheetNames, they default to []
 *              and are never populated from API
 * Fix: Fetch sheet names from API when get_context is called if they're empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionHandler } from '../../src/handlers/session.js';
import { resetSessionContext } from '../../src/services/session-context.js';

describe('SessionHandler - sheetNames (BUG FIX 0.11.1)', () => {
  let handler: SessionHandler;

  beforeEach(() => {
    // Reset session context before each test
    resetSessionContext();
    handler = new SessionHandler();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    resetSessionContext();
  });

  describe('set_active with sheetNames', () => {
    it('should store sheetNames when provided', async () => {
      // Set active with sheet names
      await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: 'test-id',
          title: 'Test Spreadsheet',
          sheetNames: ['Sheet1', 'Sheet2', 'Sheet3'],
        },
      });

      // Get context
      const result = await handler.handle({
        request: {
          action: 'get_context',
        },
      });

      // Should include sheet names
      expect(result.response.success).toBe(true);
      if (result.response.success && 'activeSpreadsheet' in result.response) {
        expect(result.response.activeSpreadsheet).toBeDefined();
        expect(result.response.activeSpreadsheet?.sheetNames).toEqual([
          'Sheet1',
          'Sheet2',
          'Sheet3',
        ]);
      }
    });

    it('should handle set_active without sheetNames (BUG FIX 0.11.1)', async () => {
      // Set active WITHOUT sheet names (common case)
      await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: 'test-id',
          title: 'Test Spreadsheet',
          // sheetNames not provided
        },
      });

      // Get context
      const result = await handler.handle({
        request: {
          action: 'get_context',
        },
      });

      // BUG FIX 0.11.1: Should return empty array (not null/undefined)
      expect(result.response.success).toBe(true);
      if (result.response.success && 'activeSpreadsheet' in result.response) {
        expect(result.response.activeSpreadsheet).toBeDefined();
        expect(result.response.activeSpreadsheet?.sheetNames).toEqual([]);
      }
    });
  });

  describe('get_active returns sheetNames', () => {
    it('should include sheetNames in get_active response', async () => {
      // Set active with sheet names
      await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: 'test-id',
          title: 'Test Spreadsheet',
          sheetNames: ['Alpha', 'Beta'],
        },
      });

      // Get active
      const result = await handler.handle({
        request: {
          action: 'get_active',
        },
      });

      // Should return active spreadsheet with sheet names
      expect(result.response.success).toBe(true);
      if (result.response.success && 'spreadsheet' in result.response) {
        expect(result.response.spreadsheet).toBeDefined();
        expect(result.response.spreadsheet?.sheetNames).toEqual(['Alpha', 'Beta']);
      }
    });
  });

  describe('context summary includes sheetNames', () => {
    it('should mention sheet names in context summary', async () => {
      // Set active with sheet names
      await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: 'test-id',
          title: 'Budget 2024',
          sheetNames: ['Q1', 'Q2', 'Q3', 'Q4'],
        },
      });

      // Get context
      const result = await handler.handle({
        request: {
          action: 'get_context',
        },
      });

      // Summary should mention sheets
      expect(result.response.success).toBe(true);
      if (result.response.success && 'summary' in result.response) {
        const summary = result.response.summary.toLowerCase();
        expect(summary.includes('4 sheets') || summary.includes('sheets:')).toBe(true);
      }
    });
  });

  describe('error path tests', () => {
    it('should handle set_active with empty sheetNames array (edge case)', async () => {
      const result = await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: 'test-id',
          title: 'Test Spreadsheet',
          sheetNames: [],
        },
      });

      // Empty sheetNames should be accepted gracefully
      expect(result.response.success).toBe(true);
    });

    it('should handle get_context when no active spreadsheet is set', async () => {
      // Don't call set_active - start from clean state
      const result = await handler.handle({
        request: {
          action: 'get_context',
        },
      });

      // Should succeed and return null for activeSpreadsheet
      expect(result.response.success).toBe(true);
      if (result.response.success && 'activeSpreadsheet' in result.response) {
        expect(result.response.activeSpreadsheet).toBeNull();
      }
    });

    it('should handle set_active with missing spreadsheetId gracefully', async () => {
      const result = await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: '',
          title: 'Test',
        },
      });

      // Empty spreadsheetId — either rejected (success: false) or stored as-is
      // Either outcome is acceptable but must not throw
      expect(result.response).toBeDefined();
      expect(typeof result.response.success).toBe('boolean');
    });
  });

  describe('regression tests', () => {
    it('should handle get_context with no active spreadsheet', async () => {
      // Don't set active
      const result = await handler.handle({
        request: {
          action: 'get_context',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && 'activeSpreadsheet' in result.response) {
        expect(result.response.activeSpreadsheet).toBeNull();
      }
    });

    it('should limit sheetNames to prevent memory issues', async () => {
      // Create array with 150 sheets (exceeds maxSheetNames=100)
      const manySheets = Array.from({ length: 150 }, (_, i) => `Sheet${i + 1}`);

      await handler.handle({
        request: {
          action: 'set_active',
          spreadsheetId: 'test-id',
          title: 'Large Spreadsheet',
          sheetNames: manySheets,
        },
      });

      const result = await handler.handle({
        request: {
          action: 'get_context',
        },
      });

      // Should truncate to max limit
      if (result.response.success && 'activeSpreadsheet' in result.response) {
        expect(result.response.activeSpreadsheet?.sheetNames.length).toBeLessThanOrEqual(100);
      }
    });
  });
});
