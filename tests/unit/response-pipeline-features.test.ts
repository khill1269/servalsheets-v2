/**
 * Unit tests for response pipeline features
 *
 * Tests Phase 1B.1 (suggestedFix) and Phase 1B.2 (suggestedNextActions)
 */

import { describe, it, expect } from 'vitest';
import { suggestFix } from '../../src/services/error-fix-suggester.js';
import { getRecommendedActions } from '../../src/services/action-recommender.js';

describe('Phase 1B.1: Error Fix Suggester', () => {
  it('should suggest fixing unbounded range', () => {
    const fix = suggestFix(
      'INVALID_RANGE',
      'Range is unbounded',
      'sheets_data',
      'read',
      { range: 'Sheet1!A:Z' }
    );
    expect(fix).not.toBeNull();
    expect(fix?.tool).toBe('sheets_data');
    expect(fix?.action).toBe('read');
    expect(fix?.params['range']).toBe('Sheet1!A1:Z1000');
    expect(fix?.explanation).toContain('Added row bounds');
  });

  it('should suggest listing sheets when sheet not found', () => {
    const fix = suggestFix('SHEET_NOT_FOUND', 'Sheet "Sales" not found', 'sheets_data', 'read', {
      spreadsheetId: 'abc123',
    });
    expect(fix).not.toBeNull();
    expect(fix?.tool).toBe('sheets_core');
    expect(fix?.action).toBe('list_sheets');
    expect(fix?.params['spreadsheetId']).toBe('abc123');
  });

  it('should suggest listing spreadsheets when not found', () => {
    const fix = suggestFix('SPREADSHEET_NOT_FOUND', 'Spreadsheet not found');
    expect(fix).not.toBeNull();
    expect(fix?.tool).toBe('sheets_core');
    expect(fix?.action).toBe('list');
  });

  it('should suggest re-login for permission denied', () => {
    const fix = suggestFix('PERMISSION_DENIED', 'User does not have access');
    expect(fix).not.toBeNull();
    expect(fix?.tool).toBe('sheets_auth');
    expect(fix?.action).toBe('login');
    expect(fix?.explanation).toContain('Re-authenticate');
  });

  it('should suggest minimal verbosity for quota exceeded', () => {
    const fix = suggestFix('QUOTA_EXCEEDED', 'Rate limit exceeded', 'sheets_data', 'read', {
      range: 'A1:Z100',
    });
    expect(fix).not.toBeNull();
    expect(fix?.params['verbosity']).toBe('minimal');
  });

  it('should suggest alternate sheet name for duplicate', () => {
    const fix = suggestFix(
      'DUPLICATE_SHEET_NAME',
      'A sheet with the name "Budget" already exists',
      'sheets_core',
      'add_sheet',
      { title: 'Budget' }
    );
    expect(fix).not.toBeNull();
    expect(fix?.params['title']).toBe('Budget (2)');
  });

  it('should suggest chart suggestion for invalid chart type', () => {
    const fix = suggestFix(
      'INVALID_CHART_TYPE',
      'Chart type "UNKNOWN" is not supported',
      'sheets_visualize',
      'chart_create',
      { spreadsheetId: 'abc123' }
    );
    expect(fix).not.toBeNull();
    expect(fix?.tool).toBe('sheets_visualize');
    expect(fix?.action).toBe('suggest_chart');
  });

  it('should suggest checking merges for range overlap', () => {
    const fix = suggestFix(
      'RANGE_OVERLAP',
      'Range overlaps with merged cells',
      'sheets_data',
      'merge_cells',
      { spreadsheetId: 'abc123' }
    );
    expect(fix).not.toBeNull();
    expect(fix?.tool).toBe('sheets_data');
    expect(fix?.action).toBe('get_merges');
  });

  it('should return null for unknown error code', () => {
    const fix = suggestFix('UNKNOWN_ERROR', 'Something went wrong');
    expect(fix).toBeNull();
  });
});

describe('Phase 1B.2: Action Recommender', () => {
  it('should recommend actions after reading data', () => {
    const actions = getRecommendedActions('sheets_data', 'read');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.action === 'detect_patterns')).toBe(true);
  });

  it('should recommend formatting after writing data', () => {
    const actions = getRecommendedActions('sheets_data', 'write');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.tool === 'sheets_format')).toBe(true);
  });

  it('should recommend cleaning after importing CSV', () => {
    const actions = getRecommendedActions('sheets_composite', 'import_csv');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.action === 'clean')).toBe(true);
  });

  it('should recommend chart refinement after chart creation', () => {
    const actions = getRecommendedActions('sheets_visualize', 'chart_create');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.action === 'chart_update')).toBe(true);
  });

  it('should recommend validation after append', () => {
    const actions = getRecommendedActions('sheets_data', 'append');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.action === 'validate')).toBe(true);
  });

  it('should limit recommendations to max 3', () => {
    const actions = getRecommendedActions('sheets_data', 'read');
    expect(actions.length).toBeLessThanOrEqual(3);
  });

  it('should return empty array for unknown action', () => {
    const actions = getRecommendedActions('sheets_data', 'unknown_action');
    expect(actions).toEqual([]);
  });

  it('should include reason with each recommendation', () => {
    const actions = getRecommendedActions('sheets_data', 'read');
    actions.forEach((action) => {
      expect(action.reason).toBeTruthy();
      expect(typeof action.reason).toBe('string');
      expect(action.reason.length).toBeGreaterThan(0);
    });
  });
});
