import { describe, expect, it } from 'vitest';
import {
  getToolAuthPolicy,
  isToolCallAuthExempt,
} from '../../src/mcp/registration/tool-definitions.js';

describe('tool auth policy metadata', () => {
  it('marks local tools as auth exempt', () => {
    expect(isToolCallAuthExempt('sheets_session')).toBe(true);
    expect(isToolCallAuthExempt('sheets_confirm')).toBe(true);
    expect(isToolCallAuthExempt('sheets_auth')).toBe(true);
  });

  it('supports action-level exemptions for partially authenticated tools', () => {
    expect(isToolCallAuthExempt('sheets_history', 'list')).toBe(true);
    expect(isToolCallAuthExempt('sheets_history', 'stats')).toBe(true);
    expect(isToolCallAuthExempt('sheets_history', 'undo')).toBe(false);
    expect(isToolCallAuthExempt('sheets_composite', 'preview_generation')).toBe(true);
    expect(isToolCallAuthExempt('sheets_composite', 'generate_template')).toBe(true);
    expect(isToolCallAuthExempt('sheets_composite', 'generate_sheet')).toBe(false);
  });

  it('defaults to requiring auth for tools without explicit policy', () => {
    const policy = getToolAuthPolicy('sheets_data');
    expect(policy.requiresAuth).toBe(true);
    expect(policy.exemptActions).toEqual([]);
    expect(isToolCallAuthExempt('sheets_data', 'read')).toBe(false);
  });
});
