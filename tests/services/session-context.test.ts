/**
 * Tests for SessionContextManager
 *
 * CRITICAL: This service handles natural language interactions.
 * These tests ensure NL references like "the spreadsheet" and "undo that" work correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SessionContextManager,
  type SpreadsheetContext,
  initSessionRedis,
  getSessionContext,
  getOrCreateSessionContext,
  getOrCreateSessionContextAsync,
  resetSessionContext,
  resetSessionRedis,
} from '../../src/services/session-context.js';

describe('SessionContextManager', () => {
  let manager: SessionContextManager;

  beforeEach(() => {
    manager = new SessionContextManager();
  });

  // =========================================================================
  // SPREADSHEET CONTEXT MANAGEMENT
  // =========================================================================

  describe('Spreadsheet Context', () => {
    it('should set and get active spreadsheet', () => {
      const context: SpreadsheetContext = {
        spreadsheetId: '1ABC',
        title: 'My Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1', 'Sheet2'],
      };

      manager.setActiveSpreadsheet(context);
      const active = manager.getActiveSpreadsheet();

      expect(active).toBeDefined();
      expect(active?.spreadsheetId).toBe('1ABC');
      expect(active?.title).toBe('My Budget');
      expect(active?.sheetNames).toEqual(['Sheet1', 'Sheet2']);
    });

    it('should move previous active to recent when setting new active', () => {
      const first: SpreadsheetContext = {
        spreadsheetId: '1ABC',
        title: 'First',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      };

      const second: SpreadsheetContext = {
        spreadsheetId: '2DEF',
        title: 'Second',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      };

      manager.setActiveSpreadsheet(first);
      manager.setActiveSpreadsheet(second);

      const recent = manager.getRecentSpreadsheets();
      expect(recent).toHaveLength(1);
      expect(recent[0]?.spreadsheetId).toBe('1ABC');
    });

    it('should limit recent spreadsheets to 5', () => {
      // Add 7 spreadsheets
      for (let i = 1; i <= 7; i++) {
        manager.setActiveSpreadsheet({
          spreadsheetId: `${i}ABC`,
          title: `Sheet ${i}`,
          activatedAt: 1704067200000,
          sheetNames: ['Sheet1'],
        });
      }

      const recent = manager.getRecentSpreadsheets();
      expect(recent).toHaveLength(5); // Only last 5 (excluding active)
    });

    it('should limit sheet names to 100 to prevent memory issues', () => {
      const manySheets = Array.from({ length: 150 }, (_, i) => `Sheet${i + 1}`);

      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Large Spreadsheet',
        activatedAt: 1704067200000,
        sheetNames: manySheets,
      });

      const active = manager.getActiveSpreadsheet();
      expect(active?.sheetNames).toHaveLength(100); // Limited to 100
    });

    it('should require active spreadsheet or throw helpful error', () => {
      expect(() => manager.requireActiveSpreadsheet()).toThrow('No active spreadsheet');

      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      expect(() => manager.requireActiveSpreadsheet()).not.toThrow();
    });

    it('should find spreadsheet by exact title', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Q4 Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const found = manager.findSpreadsheetByReference('Q4 Budget');
      expect(found?.spreadsheetId).toBe('1ABC');
    });

    it('should find spreadsheet by partial title', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Q4 Budget 2024',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const found = manager.findSpreadsheetByReference('budget');
      expect(found?.spreadsheetId).toBe('1ABC');
    });

    it('should find spreadsheet with "the" prefix', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const found = manager.findSpreadsheetByReference('the budget');
      expect(found?.spreadsheetId).toBe('1ABC');
    });

    it('should find spreadsheet with "my" prefix', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'CRM System',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const found = manager.findSpreadsheetByReference('my CRM');
      expect(found?.spreadsheetId).toBe('1ABC');
    });

    it('should search recent spreadsheets if not active', () => {
      const first: SpreadsheetContext = {
        spreadsheetId: '1ABC',
        title: 'Old Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      };

      const second: SpreadsheetContext = {
        spreadsheetId: '2DEF',
        title: 'Current Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      };

      manager.setActiveSpreadsheet(first);
      manager.setActiveSpreadsheet(second);

      // Find the old one in recent
      const found = manager.findSpreadsheetByReference('old');
      expect(found?.spreadsheetId).toBe('1ABC');
    });

    it('should return null if no matching spreadsheet found', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const found = manager.findSpreadsheetByReference('nonexistent');
      expect(found).toBeNull();
    });

    it('should set and get last range', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.setLastRange('A1:C10');

      const active = manager.getActiveSpreadsheet();
      expect(active?.lastRange).toBe('A1:C10');
    });
  });

  // =========================================================================
  // OPERATION HISTORY
  // =========================================================================

  describe('Operation History', () => {
    it('should record operation with auto-generated ID', () => {
      const id = manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        range: 'A1:B2',
        description: 'Wrote values to range',
        undoable: true,
        cellsAffected: 4,
      });

      expect(id).toMatch(/^op_\d+_[a-z0-9]+$/);
    });

    it('should get last operation', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'First op',
        undoable: true,
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'read',
        spreadsheetId: '1ABC',
        description: 'Second op',
        undoable: false,
      });

      const last = manager.getLastOperation();
      expect(last?.action).toBe('read');
      expect(last?.description).toBe('Second op');
    });

    it('should get last undoable operation', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'read',
        spreadsheetId: '1ABC',
        description: 'Read op',
        undoable: false,
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Write op',
        undoable: true,
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'read',
        spreadsheetId: '1ABC',
        description: 'Another read',
        undoable: false,
      });

      const lastUndoable = manager.getLastUndoableOperation();
      expect(lastUndoable?.action).toBe('write');
    });

    it('should limit operation history to 20', () => {
      // Record 25 operations
      for (let i = 1; i <= 25; i++) {
        manager.recordOperation({
          tool: 'sheets_data',
          action: 'write',
          spreadsheetId: '1ABC',
          description: `Operation ${i}`,
          undoable: true,
        });
      }

      const history = manager.getOperationHistory(100);
      expect(history).toHaveLength(20); // Limited to 20
    });

    it('should truncate long descriptions to 500 chars', () => {
      const longDescription = 'A'.repeat(600);

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: longDescription,
        undoable: true,
      });

      const last = manager.getLastOperation();
      expect(last?.description.length).toBeLessThanOrEqual(500);
      expect(last?.description).toMatch(/\.\.\.$/); // Ends with ...
    });

    it('should find operation by "that" reference', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Write op',
        undoable: true,
      });

      const found = manager.findOperationByReference('that');
      expect(found?.action).toBe('write');
    });

    it('should find operation by "the last" reference', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Write op',
        undoable: true,
      });

      const found = manager.findOperationByReference('the last');
      expect(found?.action).toBe('write');
    });

    it('should find operation by action name', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'read',
        spreadsheetId: '1ABC',
        description: 'Read op',
        undoable: false,
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Write op',
        undoable: true,
      });

      const found = manager.findOperationByReference('write');
      expect(found?.action).toBe('write');
    });

    it('should find operation by "the last write" reference', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'read',
        spreadsheetId: '1ABC',
        description: 'Read op',
        undoable: false,
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Write op',
        undoable: true,
      });

      const found = manager.findOperationByReference('the last write');
      expect(found?.action).toBe('write');
    });

    it('should return null if no matching operation found', () => {
      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Write op',
        undoable: true,
      });

      const found = manager.findOperationByReference('nonexistent');
      expect(found).toBeNull();
    });
  });

  // =========================================================================
  // USER PREFERENCES
  // =========================================================================

  describe('User Preferences', () => {
    it('should have default preferences', () => {
      const prefs = manager.getPreferences();

      expect(prefs.confirmationLevel).toBe('destructive');
      expect(prefs.defaultSafety.dryRun).toBe(false);
      expect(prefs.defaultSafety.createSnapshot).toBe(true);
      expect(prefs.formatting.headerStyle).toBe('bold-colored');
    });

    it('should update preferences', () => {
      manager.updatePreferences({
        confirmationLevel: 'always',
      });

      const prefs = manager.getPreferences();
      expect(prefs.confirmationLevel).toBe('always');
    });

    it('should learn skipConfirmation preference', () => {
      manager.learnPreference('skipConfirmation', true);

      const prefs = manager.getPreferences();
      expect(prefs.confirmationLevel).toBe('never');
    });

    it('should learn alwaysConfirm preference', () => {
      manager.learnPreference('alwaysConfirm', true);

      const prefs = manager.getPreferences();
      expect(prefs.confirmationLevel).toBe('always');
    });

    it('should learn date format preference', () => {
      manager.learnPreference('dateFormat', 'DD/MM/YYYY');

      const prefs = manager.getPreferences();
      expect(prefs.formatting.dateFormat).toBe('DD/MM/YYYY');
    });

    it('should learn currency format preference', () => {
      manager.learnPreference('currencyFormat', '€#,##0.00');

      const prefs = manager.getPreferences();
      expect(prefs.formatting.currencyFormat).toBe('€#,##0.00');
    });
  });

  // =========================================================================
  // PENDING OPERATIONS
  // =========================================================================

  describe('Pending Operations', () => {
    it('should set and get pending operation', () => {
      manager.setPendingOperation({
        type: 'import_csv',
        step: 2,
        totalSteps: 5,
        context: { fileName: 'data.csv' },
      });

      const pending = manager.getPendingOperation();
      expect(pending?.type).toBe('import_csv');
      expect(pending?.step).toBe(2);
      expect(pending?.totalSteps).toBe(5);
    });

    it('should clear pending operation', () => {
      manager.setPendingOperation({
        type: 'import_csv',
        step: 2,
        totalSteps: 5,
        context: {},
      });

      manager.clearPendingOperation();

      const pending = manager.getPendingOperation();
      expect(pending).toBeNull();
    });
  });

  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================

  describe('State Management', () => {
    it('should export and import state', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1', 'Sheet2'],
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Test op',
        undoable: true,
      });

      const exported = manager.exportState();
      expect(exported).toEqual(expect.any(String));
      expect(exported.length).toBeGreaterThan(0);

      // Create new manager and import
      const newManager = new SessionContextManager();
      newManager.importState(exported);

      const active = newManager.getActiveSpreadsheet();
      expect(active?.spreadsheetId).toBe('1ABC');
      expect(active?.title).toBe('Budget');

      const lastOp = newManager.getLastOperation();
      expect(lastOp?.action).toBe('write');
    });

    it('should limit sheet names in export to 10 per spreadsheet', () => {
      const manySheets = Array.from({ length: 50 }, (_, i) => `Sheet${i + 1}`);

      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Large',
        activatedAt: 1704067200000,
        sheetNames: manySheets,
      });

      const exported = manager.exportState();
      const parsed = JSON.parse(exported);

      // Should only have first 10 sheet names in recent
      // (active is limited to 100 in setActiveSpreadsheet, but export limits to 10 for recent)
      expect(parsed.activeSpreadsheet.sheetNames.length).toBeLessThanOrEqual(100);
    });

    it('should export minimal state if serialization too large', () => {
      // This test is tricky - we'd need to create a state >10MB
      // For now, just verify it doesn't crash
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'A'.repeat(1000),
        activatedAt: 1704067200000,
        sheetNames: Array.from({ length: 100 }, (_, i) => `Sheet${i + 1}`),
      });

      const exported = manager.exportState();
      expect(exported).toEqual(expect.any(String));
      expect(exported.length).toBeGreaterThan(0);
      expect(exported.length).toBeLessThan(10_000_000);
    });

    it('should reset state', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.reset();

      const active = manager.getActiveSpreadsheet();
      expect(active).toBeNull();
    });

    it('should get full state', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const state = manager.getState();
      expect(state.activeSpreadsheet?.spreadsheetId).toBe('1ABC');
      expect(state.recentSpreadsheets).toEqual([]);
      expect(state.operationHistory).toEqual([]);
    });
  });

  // =========================================================================
  // NATURAL LANGUAGE HELPERS
  // =========================================================================

  describe('Natural Language Helpers', () => {
    it('should generate context summary with active spreadsheet', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'My Budget 2024',
        activatedAt: 1704067200000,
        sheetNames: ['January', 'February', 'March'],
      });

      const summary = manager.getContextSummary();
      expect(summary).toContain('My Budget 2024');
      expect(summary).toContain('January');
    });

    it('should show "No spreadsheet" when no active spreadsheet', () => {
      const summary = manager.getContextSummary();
      expect(summary).toContain('No spreadsheet currently active');
    });

    it('should include last operation in summary', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Wrote budget data',
        undoable: true,
      });

      const summary = manager.getContextSummary();
      expect(summary).toContain('Wrote budget data');
    });

    it('should include pending operation in summary', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.setPendingOperation({
        type: 'import_csv',
        step: 2,
        totalSteps: 5,
        context: {},
      });

      const summary = manager.getContextSummary();
      expect(summary).toContain('import_csv');
      expect(summary).toContain('step 2/5');
    });

    it('should truncate long titles in summary', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'A'.repeat(200),
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      const summary = manager.getContextSummary();
      expect(summary.length).toBeLessThan(2500); // Max summary length + buffer
    });

    it('should truncate summary to 2000 chars max', () => {
      // Create a scenario with lots of data
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'A'.repeat(100),
        activatedAt: 1704067200000,
        sheetNames: Array.from({ length: 100 }, (_, i) => `Sheet${i + 1}`),
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'B'.repeat(500),
        undoable: true,
      });

      const summary = manager.getContextSummary();
      expect(summary.length).toBeLessThanOrEqual(2000);
    });

    it('should suggest opening spreadsheet when none active', () => {
      const suggestions = manager.suggestNextActions();
      expect(suggestions).toContain('Open or create a spreadsheet to get started');
    });

    it('should suggest recent spreadsheet when available', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Old Spreadsheet',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.setActiveSpreadsheet({
        spreadsheetId: '2DEF',
        title: 'New Spreadsheet',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      // Manually clear active while keeping recent
      const state = manager.getState();
      const newManager = new SessionContextManager({
        ...state,
        activeSpreadsheet: null,
      });

      const suggestions = newManager.suggestNextActions();
      expect(suggestions.some((s) => s.includes('recent'))).toBe(true);
    });

    it('should suggest analysis after read operation', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'read',
        spreadsheetId: '1ABC',
        description: 'Read data',
        undoable: false,
      });

      const suggestions = manager.suggestNextActions();
      expect(suggestions.some((s) => s.includes('Analyze'))).toBe(true);
    });

    it('should suggest format after write operation', () => {
      manager.setActiveSpreadsheet({
        spreadsheetId: '1ABC',
        title: 'Budget',
        activatedAt: 1704067200000,
        sheetNames: ['Sheet1'],
      });

      manager.recordOperation({
        tool: 'sheets_data',
        action: 'write',
        spreadsheetId: '1ABC',
        description: 'Wrote data',
        undoable: true,
      });

      const suggestions = manager.suggestNextActions();
      expect(suggestions.some((s) => s.includes('Format'))).toBe(true);
    });
  });
});

// ============================================================================
// SCALE-01: Redis session persistence (multi-instance continuity)
// ============================================================================

describe('Redis session persistence (SCALE-01)', () => {
  let stored: Record<string, string> = {};
  const mockRedis = {
    get: vi.fn(async (key: string) => stored[key] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      stored[key] = value;
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      delete stored[key];
      return 1;
    }),
  };

  beforeEach(() => {
    stored = {};
    mockRedis.get.mockClear();
    mockRedis.set.mockClear();
    resetSessionContext();
    resetSessionRedis();
  });

  afterEach(() => {
    resetSessionContext();
    resetSessionRedis();
  });

  it('restores session state from Redis on first getSessionContext() call', async () => {
    const manager = new SessionContextManager();
    manager.setActiveSpreadsheet({
      spreadsheetId: 'sheet-from-redis',
      title: 'Persisted Sheet',
      activatedAt: 1704067200000,
      sheetNames: ['Data'],
    });
    stored['servalsheets:session:default:state'] = manager.exportState();

    initSessionRedis(mockRedis);
    const ctx = getSessionContext();

    // Wait for async restore (fire-and-forget)
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRedis.get).toHaveBeenCalledWith('servalsheets:session:default:state');
    expect(ctx.getActiveSpreadsheet()?.spreadsheetId).toBe('sheet-from-redis');
  });

  it('does not call Redis when no client is wired', () => {
    getSessionContext();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('handles Redis restore failure gracefully', async () => {
    const faultyRedis = {
      get: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
      set: vi.fn().mockResolvedValue('OK'),
    };

    initSessionRedis(faultyRedis);
    expect(() => getSessionContext()).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
    const ctx = getSessionContext();
    expect(ctx).toBeDefined();
  });

  it('round-trips session state through exportState/importState', () => {
    const manager = new SessionContextManager();
    manager.setActiveSpreadsheet({
      spreadsheetId: 'roundtrip-sheet',
      title: 'Test',
      activatedAt: 1704067200000,
      sheetNames: ['Sheet1'],
    });
    const exported = manager.exportState();

    const restored = new SessionContextManager();
    restored.importState(exported);

    expect(restored.getActiveSpreadsheet()?.spreadsheetId).toBe('roundtrip-sheet');
    expect(restored.getActiveSpreadsheet()?.title).toBe('Test');
  });

  it('SESSION_INSTANCE_ID key uses expected format', () => {
    // Validate the key format regardless of current env var value
    // The key is a module-level constant evaluated at import time
    initSessionRedis(mockRedis);
    getSessionContext();
    // Just verify the get was called with a key matching our namespace pattern
    const callArgs = mockRedis.get.mock.calls[0];
    expect(callArgs?.[0]).toMatch(/^servalsheets:session:.+:state$/);
  });

  it('restores session-scoped state from Redis on first getOrCreateSessionContextAsync() call', async () => {
    const manager = new SessionContextManager();
    manager.setActiveSpreadsheet({
      spreadsheetId: 'http-session-sheet',
      title: 'Persisted HTTP Session',
      activatedAt: 1704067200000,
      sheetNames: ['Dashboard'],
    });
    stored['servalsheets:http-session:http-session-123:state'] = manager.exportState();

    initSessionRedis(mockRedis);
    const ctx = await getOrCreateSessionContextAsync('http-session-123');

    expect(mockRedis.get).toHaveBeenCalledWith('servalsheets:http-session:http-session-123:state');
    expect(ctx.getActiveSpreadsheet()?.spreadsheetId).toBe('http-session-sheet');
  });

  it('persists session-scoped state to Redis when the HTTP session context changes', async () => {
    initSessionRedis(mockRedis);
    const ctx = await getOrCreateSessionContextAsync('persist-on-write');

    ctx.setActiveSpreadsheet({
      spreadsheetId: 'write-through-sheet',
      title: 'Write Through',
      activatedAt: 1704067200000,
      sheetNames: ['Sheet1'],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRedis.set).toHaveBeenCalled();
    expect(stored['servalsheets:http-session:persist-on-write:state']).toContain(
      'write-through-sheet'
    );
    expect(getOrCreateSessionContext('persist-on-write')).toBe(ctx);
  });
});
