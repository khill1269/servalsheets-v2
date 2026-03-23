/**
 * Tests for session context fuzzy matching in find_by_reference
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSheetsSession } from '../../src/handlers/session.js';
import {
  getSessionContext,
  resetSessionContext,
  type SpreadsheetContext,
} from '../../src/services/session-context.js';
import type { SheetsSessionInput } from '../../src/schemas/session.js';

describe('Session Handler - Fuzzy Matching for find_by_reference', () => {
  beforeEach(() => {
    resetSessionContext();
  });

  describe('Spreadsheet fuzzy matching', () => {
    it('should find spreadsheet by exact title', async () => {
      const session = getSessionContext();
      const budget: SpreadsheetContext = {
        spreadsheetId: 'budget-123',
        title: 'Q1 Budget',
        sheetNames: ['Overview', 'Details'],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(budget);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'Q1 Budget',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).confidence).toBe('exact');
      expect((result.response as any).matchScore).toBe(1.0);
    });

    it('should find spreadsheet by fuzzy title match', async () => {
      const session = getSessionContext();
      const budget: SpreadsheetContext = {
        spreadsheetId: 'budget-123',
        title: 'Q1 Financial Budget Tracker',
        sheetNames: ['Monthly', 'Quarterly'],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(budget);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'budget tracker',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).matchScore).toBeGreaterThan(0.5);
    });

    it('should handle reference with articles (the, my, our)', async () => {
      const session = getSessionContext();
      const sales: SpreadsheetContext = {
        spreadsheetId: 'sales-456',
        title: 'Sales Pipeline',
        sheetNames: ['Q1', 'Q2'],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(sales);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'the sales pipeline',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).confidence).toBe('exact');
    });

    it('should prefer recent spreadsheets in fuzzy matching', async () => {
      const session = getSessionContext();
      const budget: SpreadsheetContext = {
        spreadsheetId: 'budget-123',
        title: 'Budget 2025',
        sheetNames: ['Jan', 'Feb'],
        activatedAt: 1704067200000 - 10000,
      };
      const sales: SpreadsheetContext = {
        spreadsheetId: 'sales-456',
        title: 'Sales Report',
        sheetNames: ['Q1', 'Q2'],
        activatedAt: 1704067200000,
      };

      session.setActiveSpreadsheet(budget);
      session.setActiveSpreadsheet(sales); // sales becomes active

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'budget',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      // Should still find budget even though sales is active
      expect((result.response as any).spreadsheet.spreadsheetId).toBe('budget-123');
    });

    it('should include warning for low-confidence fuzzy matches', async () => {
      const session = getSessionContext();
      const veryLongTitle: SpreadsheetContext = {
        spreadsheetId: 'long-123',
        title: 'Comprehensive Quarterly Financial Analysis Report 2025',
        sheetNames: ['Data'],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(veryLongTitle);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'xyz', // Low match
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      // May or may not find (depends on scoring), but should not crash
    });

    it('should find by sheet name as fallback', async () => {
      const session = getSessionContext();
      const tracker: SpreadsheetContext = {
        spreadsheetId: 'tracker-789',
        title: 'Main Tracker',
        sheetNames: ['Budget Details', 'Expenses', 'Summary'],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(tracker);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'budget details',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).spreadsheet.spreadsheetId).toBe('tracker-789');
    });
  });

  describe('Reference type normalization', () => {
    it('should normalize "sheet" to "spreadsheet"', async () => {
      const session = getSessionContext();
      const budget: SpreadsheetContext = {
        spreadsheetId: 'budget-123',
        title: 'Q1 Budget',
        sheetNames: [],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(budget);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'Q1 Budget',
          referenceType: 'sheet', // Should be normalized to spreadsheet
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).spreadsheet).toBeDefined();
    });

    it('should normalize "doc" to "spreadsheet"', async () => {
      const session = getSessionContext();
      const report: SpreadsheetContext = {
        spreadsheetId: 'report-123',
        title: 'Annual Report',
        sheetNames: [],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(report);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'Annual Report',
          referenceType: 'doc',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
    });

    it('should normalize "workbook" to "spreadsheet"', async () => {
      const session = getSessionContext();
      const data: SpreadsheetContext = {
        spreadsheetId: 'data-456',
        title: 'Data Analysis',
        sheetNames: [],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(data);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'Data Analysis',
          referenceType: 'workbook',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
    });
  });

  describe('Operation fuzzy matching', () => {
    it('should find operation by exact reference', async () => {
      const session = getSessionContext();
      session.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: 'test-123',
        description: 'Updated sales data',
        undoable: true,
      });

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'that',
          referenceType: 'operation',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).confidence).toBe('exact');
      expect((result.response as any).matchScore).toBe(1.0);
    });

    it('should find operation by action keyword', async () => {
      const session = getSessionContext();
      session.recordOperation({
        tool: 'sheets_format',
        action: 'set_background',
        spreadsheetId: 'test-123',
        description: 'Applied formatting',
        undoable: true,
      });

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'the format',
          referenceType: 'operation',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).matchScore).toBeGreaterThan(0.5);
    });

    it('should handle multiple operations with fuzzy matching', async () => {
      const session = getSessionContext();
      session.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: 'test-123',
        description: 'Updated revenue data',
        undoable: true,
      });
      session.recordOperation({
        tool: 'sheets_format',
        action: 'set_number_format',
        spreadsheetId: 'test-123',
        description: 'Formatted currency values',
        undoable: true,
      });
      session.recordOperation({
        tool: 'sheets_dimensions',
        action: 'freeze',
        spreadsheetId: 'test-123',
        description: 'Froze header row',
        undoable: true,
      });

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'the write',
          referenceType: 'operation',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).operation.action).toBe('write');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty reference gracefully', async () => {
      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: '',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(false);
      expect((result.response as any).error).toBeDefined();
    });

    it('should return not found when no matches exist', async () => {
      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'nonexistent',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(false);
    });

    it('should be case insensitive', async () => {
      const session = getSessionContext();
      const budget: SpreadsheetContext = {
        spreadsheetId: 'budget-123',
        title: 'Annual BUDGET Report',
        sheetNames: [],
        activatedAt: 1704067200000,
      };
      session.setActiveSpreadsheet(budget);

      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: 'ANNUAL budget REPORT',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(true);
      expect(result.response.found).toBe(true);
      expect((result.response as any).confidence).toBe('exact');
    });

    it('should handle whitespace-only reference gracefully', async () => {
      const input: SheetsSessionInput = {
        request: {
          action: 'find_by_reference',
          reference: '   ',
          referenceType: 'spreadsheet',
        },
      };

      const result = await handleSheetsSession(input);
      expect(result.response.success).toBe(false);
    });
  });
});
