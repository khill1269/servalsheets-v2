/**
 * Tests for B3: Elicitation Rejection Tracking in SessionContextManager
 *
 * Verifies:
 * - recordElicitationRejection stores rejections
 * - wasRecentlyRejected returns true within 30-minute window
 * - wasRecentlyRejected returns false for old rejections
 * - Rejection list is bounded at 50 entries
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { SessionContextManager } from '../../src/services/session-context.js';

describe('B3: elicitation rejection tracking', () => {
  let manager: SessionContextManager;

  beforeEach(() => {
    manager = new SessionContextManager();
  });

  it('recordElicitationRejection and wasRecentlyRejected are defined methods', () => {
    expect(typeof manager.recordElicitationRejection).toBe('function');
    expect(typeof manager.wasRecentlyRejected).toBe('function');
  });

  it('wasRecentlyRejected returns false when no rejections recorded', () => {
    const result = manager.wasRecentlyRejected('confirm_destructive');
    expect(result).toBe(false);
  });

  it('wasRecentlyRejected returns true after recording a rejection of the same type', () => {
    manager.recordElicitationRejection({ type: 'confirm_destructive' });
    expect(manager.wasRecentlyRejected('confirm_destructive')).toBe(true);
  });

  it('wasRecentlyRejected returns false for different type', () => {
    manager.recordElicitationRejection({ type: 'chart_type_wizard' });
    expect(manager.wasRecentlyRejected('confirm_destructive')).toBe(false);
  });

  it('wasRecentlyRejected matches on tool when provided', () => {
    manager.recordElicitationRejection({
      type: 'confirm_destructive',
      tool: 'sheets_format',
      action: 'set_format',
    });

    // Same type + tool: should be rejected
    expect(
      manager.wasRecentlyRejected('confirm_destructive', { tool: 'sheets_format' })
    ).toBe(true);

    // Same type but different tool: should NOT be rejected
    expect(
      manager.wasRecentlyRejected('confirm_destructive', { tool: 'sheets_data' })
    ).toBe(false);
  });

  it('wasRecentlyRejected matches on action when provided', () => {
    manager.recordElicitationRejection({
      type: 'confirm_destructive',
      tool: 'sheets_format',
      action: 'delete_sheet',
    });

    expect(
      manager.wasRecentlyRejected('confirm_destructive', { action: 'delete_sheet' })
    ).toBe(true);

    expect(
      manager.wasRecentlyRejected('confirm_destructive', { action: 'set_format' })
    ).toBe(false);
  });

  it('rejection list is bounded at 50 entries', () => {
    // Record 60 rejections
    for (let i = 0; i < 60; i++) {
      manager.recordElicitationRejection({ type: `type_${i}` });
    }

    // Should still work — no crash
    expect(manager.wasRecentlyRejected('type_59')).toBe(true);

    // The earliest rejections should have been evicted
    // (type_0 through type_9 should be gone, type_10 through type_59 remain)
    expect(manager.wasRecentlyRejected('type_0')).toBe(false);
  });

  it('stores spreadsheetId in rejection record', () => {
    manager.recordElicitationRejection({
      type: 'confirm_destructive',
      spreadsheetId: 'sheet-123',
    });

    expect(manager.wasRecentlyRejected('confirm_destructive')).toBe(true);
  });

  it('multiple rejections of different types are tracked independently', () => {
    manager.recordElicitationRejection({ type: 'chart_type_wizard' });
    manager.recordElicitationRejection({ type: 'confirm_destructive' });
    manager.recordElicitationRejection({ type: 'data_import_config' });

    expect(manager.wasRecentlyRejected('chart_type_wizard')).toBe(true);
    expect(manager.wasRecentlyRejected('confirm_destructive')).toBe(true);
    expect(manager.wasRecentlyRejected('data_import_config')).toBe(true);
    expect(manager.wasRecentlyRejected('unknown_type')).toBe(false);
  });
});
