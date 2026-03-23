/**
 * ServalSheets - Session Handler Tests
 *
 * Tests for session context management.
 * Covers all 26 actions: set_active, get_active, get_context, record_operation,
 * get_last_operation, get_history, find_by_reference, update_preferences,
 * get_preferences, set_pending, get_pending, clear_pending, reset,
 * get_alerts, acknowledge_alert, clear_alerts, set_user_id, get_profile,
 * update_profile_preferences, record_successful_formula, get_top_formulas,
 * reject_suggestion, save_checkpoint, load_checkpoint, list_checkpoints,
 * delete_checkpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionHandler } from '../../src/handlers/session.js';
import { SheetsSessionOutputSchema } from '../../src/schemas/session.js';
import {
  getSessionContext,
  resetSessionContext,
  SessionContextManager,
} from '../../src/services/session-context.js';

describe('SessionHandler', () => {
  let handler: SessionHandler;

  beforeEach(() => {
    resetSessionContext();
    handler = new SessionHandler();
  });

  afterEach(() => {
    resetSessionContext();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('set_active', () => {
    it('should set the active spreadsheet context', async () => {
      const result = await handler.handle({
        action: 'set_active',
        spreadsheetId: 'test-spreadsheet-id',
        title: 'Test Spreadsheet',
        sheetNames: ['Sheet1', 'Sheet2'],
      });

      expect(result.response.success).toBe(true);
      const parseResult = SheetsSessionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('uses an injected session context instead of the global singleton', async () => {
      getSessionContext().setActiveSpreadsheet({
        spreadsheetId: 'global-sheet',
        title: 'Global Sheet',
        sheetNames: ['Global'],
        activatedAt: Date.now(),
      });

      const scopedContext = new SessionContextManager();
      const scopedHandler = new SessionHandler(scopedContext);

      await scopedHandler.handle({
        action: 'set_active',
        spreadsheetId: 'scoped-sheet',
        title: 'Scoped Sheet',
        sheetNames: ['Scoped'],
      });

      const scopedResult = await scopedHandler.handle({
        action: 'get_active',
      });
      const globalResult = await handler.handle({
        action: 'get_active',
      });

      expect(scopedResult.response.success).toBe(true);
      expect(globalResult.response.success).toBe(true);
      if (scopedResult.response.success && scopedResult.response.data) {
        expect(scopedResult.response.data.spreadsheetId).toBe('scoped-sheet');
      }
      if (globalResult.response.success && globalResult.response.data) {
        expect(globalResult.response.data.spreadsheetId).toBe('global-sheet');
      }
    });
  });

  describe('get_active', () => {
    it('should return null when no active spreadsheet', async () => {
      const result = await handler.handle({
        action: 'get_active',
      });

      expect(result.response.success).toBe(true);
      const parseResult = SheetsSessionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should return active spreadsheet after set_active', async () => {
      await handler.handle({
        action: 'set_active',
        spreadsheetId: 'test-id',
        title: 'Test',
        sheetNames: ['Sheet1'],
      });

      const result = await handler.handle({
        action: 'get_active',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success && result.response.data) {
        expect(result.response.data.spreadsheetId).toBe('test-id');
      }
    });
  });

  describe('get_context', () => {
    it('should return full session context', async () => {
      const result = await handler.handle({
        action: 'get_context',
      });

      expect(result.response.success).toBe(true);
      const parseResult = SheetsSessionOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('record_operation', () => {
    it('should record an operation in history', async () => {
      await handler.handle({
        action: 'set_active',
        spreadsheetId: 'test-id',
        title: 'Test',
        sheetNames: ['Sheet1'],
      });

      const result = await handler.handle({
        action: 'record_operation',
        spreadsheetId: 'test-id',
        tool: 'sheets_data',
        toolAction: 'write',
        description: 'Wrote data to A1:B10',
        undoable: true,
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('get_last_operation', () => {
    it('should return the last recorded operation', async () => {
      const result = await handler.handle({
        action: 'get_last_operation',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('get_history', () => {
    it('should return operation history', async () => {
      const result = await handler.handle({
        action: 'get_history',
        limit: 10,
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('find_by_reference', () => {
    it('should resolve natural language references', async () => {
      await handler.handle({
        action: 'set_active',
        spreadsheetId: 'budget-2026-id',
        title: 'Budget 2026',
        sheetNames: ['Q1', 'Q2', 'Q3', 'Q4'],
      });

      const result = await handler.handle({
        action: 'find_by_reference',
        reference: 'the budget spreadsheet',
        referenceType: 'spreadsheet',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('defensive validation', () => {
    it('should return a clear error when set_active is missing spreadsheetId', async () => {
      const result = await handler.handle({
        action: 'set_active',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('spreadsheetId');
      }
    });

    it('should return a clear error when find_by_reference is missing reference', async () => {
      const result = await handler.handle({
        action: 'find_by_reference',
        referenceType: 'spreadsheet',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('reference');
      }
    });
  });

  describe('preferences', () => {
    it('should update and retrieve preferences', async () => {
      const updateResult = await handler.handle({
        action: 'update_preferences',
        confirmationLevel: 'destructive',
        dryRunDefault: true,
        snapshotDefault: true,
      });

      expect(updateResult.response.success).toBe(true);

      const getResult = await handler.handle({
        action: 'get_preferences',
      });

      expect(getResult.response.success).toBe(true);
    });
  });

  describe('pending operations', () => {
    it('should manage multi-step operation state', async () => {
      const setResult = await handler.handle({
        action: 'set_pending',
        type: 'bulk_import',
        step: 1,
        totalSteps: 3,
        context: { filename: 'data.csv', rows: 1000 },
      });

      expect(setResult.response.success).toBe(true);

      const getResult = await handler.handle({
        action: 'get_pending',
      });

      expect(getResult.response.success).toBe(true);

      const clearResult = await handler.handle({
        action: 'clear_pending',
      });

      expect(clearResult.response.success).toBe(true);
    });
  });

  describe('schedule_create', () => {
    it('normalizes nested operation payloads into scheduler actions', async () => {
      const scheduler = {
        create: vi.fn().mockResolvedValue({ id: 'job-123' }),
      };
      handler.setScheduler(scheduler as any);

      const result = await handler.handle({
        action: 'schedule_create',
        spreadsheetId: 'sheet-123',
        cronExpression: '0 9 * * 1-5',
        description: 'Weekday refresh',
        operation: {
          tool: 'sheets_data',
          action: 'read',
          params: { range: 'Summary!A1:B3' },
        },
      } as any);

      expect(result.response.success).toBe(true);
      expect(scheduler.create).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'sheet-123',
          cronExpression: '0 9 * * 1-5',
          action: {
            tool: 'sheets_data',
            actionName: 'read',
            params: { range: 'Summary!A1:B3' },
          },
        })
      );
    });
  });

  describe('reset', () => {
    it('should clear all session state', async () => {
      await handler.handle({
        action: 'set_active',
        spreadsheetId: 'test-id',
        title: 'Test',
        sheetNames: ['Sheet1'],
      });

      const result = await handler.handle({
        action: 'reset',
      });

      expect(result.response.success).toBe(true);

      const contextResult = await handler.handle({
        action: 'get_context',
      });

      expect(contextResult.response.success).toBe(true);
    });
  });

  describe('get_alerts', () => {
    it('should return empty alerts list when no alerts exist', async () => {
      // Reset to ensure clean state
      await handler.handle({ action: 'reset' });

      const result = await handler.handle({
        action: 'get_alerts',
        onlyUnacknowledged: false,
      });

      expect(result.response.success).toBe(true);
    });

    it('should filter alerts by acknowledged status', async () => {
      const result = await handler.handle({
        action: 'get_alerts',
        onlyUnacknowledged: true,
      });

      expect(result.response.success).toBe(true);
    });

    it('should filter alerts by severity', async () => {
      const result = await handler.handle({
        action: 'get_alerts',
        severity: 'high',
        onlyUnacknowledged: false,
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('acknowledge_alert', () => {
    it('should acknowledge an existing alert', async () => {
      // Add an alert directly via the session singleton
      const session = getSessionContext();
      session.addAlert({
        severity: 'high',
        message: 'Test alert for acknowledge test',
        spreadsheetId: 'test-id',
      });

      const alerts = session.getAlerts({ onlyUnacknowledged: true });
      expect(alerts.length).toBeGreaterThan(0);
      const alertId = alerts[0].id;

      const result = await handler.handle({
        action: 'acknowledge_alert',
        alertId,
      });

      expect(result.response.success).toBe(true);
    });

    it('should return an error when alert is not found', async () => {
      const result = await handler.handle({
        action: 'acknowledge_alert',
        alertId: 'nonexistent-alert-id',
      });

      expect(result.response.success).toBe(false);
    });
  });

  describe('clear_alerts', () => {
    it('should clear all alerts', async () => {
      // Add an alert first
      const session = getSessionContext();
      session.addAlert({
        severity: 'low',
        message: 'Alert to be cleared',
      });

      const result = await handler.handle({
        action: 'clear_alerts',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('set_user_id', () => {
    it('should set the current user ID', async () => {
      const result = await handler.handle({
        action: 'set_user_id',
        userId: 'user-123',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('get_profile', () => {
    it('should return null profile when no user ID is set', async () => {
      // Reset to clear user ID
      await handler.handle({ action: 'reset' });

      const result = await handler.handle({
        action: 'get_profile',
      });

      expect(result.response.success).toBe(true);
    });

    it('should return profile after user ID is set', async () => {
      await handler.handle({
        action: 'set_user_id',
        userId: 'user-profile-test',
      });

      const result = await handler.handle({
        action: 'get_profile',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('update_profile_preferences', () => {
    it('should update profile preferences for current user', async () => {
      await handler.handle({
        action: 'set_user_id',
        userId: 'user-prefs-test',
      });

      const result = await handler.handle({
        action: 'update_profile_preferences',
        preferences: {
          theme: 'dark',
          language: 'en',
          notifications: true,
        },
      });

      expect(result.response.success).toBe(true);
    });

    it('should succeed even when no user ID is set', async () => {
      // Reset to clear user ID
      await handler.handle({ action: 'reset' });

      const result = await handler.handle({
        action: 'update_profile_preferences',
        preferences: { theme: 'light' },
      });

      // Handler gracefully handles missing user ID (logs a warning but does not throw)
      expect(result.response.success).toBe(true);
    });
  });

  describe('record_successful_formula', () => {
    it('should record a successful formula for the current user', async () => {
      await handler.handle({
        action: 'set_user_id',
        userId: 'formula-user',
      });

      const result = await handler.handle({
        action: 'record_successful_formula',
        formula: '=SUMIF(A:A,"Q1",B:B)',
        useCase: 'Sum Q1 revenue by region',
      });

      expect(result.response.success).toBe(true);
    });

    it('should succeed gracefully when no user ID is set', async () => {
      await handler.handle({ action: 'reset' });

      const result = await handler.handle({
        action: 'record_successful_formula',
        formula: '=VLOOKUP(A1,Sheet2!A:B,2,FALSE)',
        useCase: 'Look up employee department',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('get_top_formulas', () => {
    it('should return top formulas for the current user', async () => {
      await handler.handle({
        action: 'set_user_id',
        userId: 'top-formulas-user',
      });

      const result = await handler.handle({
        action: 'get_top_formulas',
        limit: 5,
      });

      expect(result.response.success).toBe(true);
    });

    it('should return empty list when no user ID is set', async () => {
      await handler.handle({ action: 'reset' });

      const result = await handler.handle({
        action: 'get_top_formulas',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('reject_suggestion', () => {
    it('should record a rejected suggestion for the current user', async () => {
      await handler.handle({
        action: 'set_user_id',
        userId: 'reject-user',
      });

      const result = await handler.handle({
        action: 'reject_suggestion',
        suggestion: 'Use ARRAYFORMULA instead of SUMIF',
      });

      expect(result.response.success).toBe(true);
    });

    it('should succeed gracefully when no user ID is set', async () => {
      await handler.handle({ action: 'reset' });

      const result = await handler.handle({
        action: 'reject_suggestion',
        suggestion: 'Use pivot tables',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('save_checkpoint', () => {
    it('should return disabled error when ENABLE_CHECKPOINTS is not set', async () => {
      // Checkpoints are disabled by default in test environment
      const result = await handler.handle({
        action: 'save_checkpoint',
        sessionId: 'test-session-1',
        description: 'After initial data load',
      });

      // Either succeeds (if enabled) or returns CHECKPOINTS_DISABLED error
      if (!result.response.success) {
        expect(result.response.error.code).toBe('CHECKPOINTS_DISABLED');
      } else {
        expect(result.response.success).toBe(true);
      }
    });
  });

  describe('load_checkpoint', () => {
    it('should return error when checkpoint is not found', async () => {
      const result = await handler.handle({
        action: 'load_checkpoint',
        sessionId: 'nonexistent-session',
      });

      // Either CHECKPOINTS_DISABLED or CHECKPOINT_NOT_FOUND
      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(['CHECKPOINTS_DISABLED', 'CHECKPOINT_NOT_FOUND']).toContain(
          result.response.error.code
        );
      }
    });
  });

  describe('list_checkpoints', () => {
    it('should return empty list or disabled message', async () => {
      const result = await handler.handle({
        action: 'list_checkpoints',
      });

      // list_checkpoints always succeeds (returns empty list when disabled)
      expect(result.response.success).toBe(true);
    });

    it('should filter by sessionId when provided', async () => {
      const result = await handler.handle({
        action: 'list_checkpoints',
        sessionId: 'my-session',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('delete_checkpoint', () => {
    it('should return disabled error when ENABLE_CHECKPOINTS is not set', async () => {
      const result = await handler.handle({
        action: 'delete_checkpoint',
        sessionId: 'test-session-to-delete',
      });

      // Either CHECKPOINTS_DISABLED or succeeds with deleted=false
      if (!result.response.success) {
        expect(result.response.error.code).toBe('CHECKPOINTS_DISABLED');
      } else {
        expect(result.response.success).toBe(true);
      }
    });
  });
});
