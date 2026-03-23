/**
 * Tests for B1: Agent Error Classification + Structured Error in Plan State
 *
 * Verifies:
 * - Structured errorDetail stored on plan after failure
 * - Auto-retry fires exactly once for retryable errors
 * - Recovery step inserted for fixable errors
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllPlans,
  compilePlan,
  executePlan,
  getPlanStatus,
  type ExecuteHandlerFn,
} from '../../src/services/agent-engine.js';

// compilePlan(description, maxSteps, spreadsheetId, context) — uses parseDescription
// "read" matches sheets_data.read, "write" matches sheets_data.write
function makePlan(description: string = 'read data from spreadsheet') {
  return makePlanExecutable(compilePlan(description, 10, 'abc123'));
}

function makePlanExecutable<T extends { steps: Array<{ tool: string; action: string; params: Record<string, unknown> }> }>(
  plan: T
): T {
  for (const step of plan.steps) {
    if (step.tool === 'sheets_data' && step.action === 'read' && step.params['range'] === undefined) {
      step.params['range'] = 'Sheet1!A1:B5';
    }
    if (
      step.tool === 'sheets_data' &&
      step.action === 'write' &&
      step.params['range'] === undefined
    ) {
      step.params['range'] = 'Sheet1!A1:B2';
      step.params['values'] = [
        ['Name', 'Value'],
        ['Alice', 42],
      ];
    }
  }
  return plan;
}

describe('B1: agent error classification', () => {
  afterEach(async () => {
    await clearAllPlans();
    vi.restoreAllMocks();
  });

  it('plan pauses and records error message when step throws', async () => {
    const plan = makePlan('read data from spreadsheet');
    expect(plan.steps.length).toBeGreaterThan(0);

    const handler: ExecuteHandlerFn = async () => {
      throw new Error('Spreadsheet not found');
    };

    const result = await executePlan(plan.planId, false, handler);

    expect(result.status).toBe('paused');
    expect(result.error).toBe('Spreadsheet not found');
    const stepResult = result.results[0];
    expect(stepResult?.success).toBe(false);
    expect(stepResult?.error).toBe('Spreadsheet not found');
  });

  it('stores structured errorDetail on plan when step throws a typed error', async () => {
    const plan = makePlan('read data from spreadsheet');

    const handler: ExecuteHandlerFn = async () => {
      const err = new Error('Quota exceeded');
      (err as Record<string, unknown>)['errorDetail'] = {
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded',
        retryable: true,
        retryAfterMs: 1, // 1ms for test speed
      };
      throw err;
    };

    const result = await executePlan(plan.planId, false, handler);

    // Plan should be paused regardless
    expect(result.status).toBe('paused');
    expect(result.error).toBeDefined();

    // B1: structured errorDetail should appear on plan
    const stored = getPlanStatus(result.planId);
    expect(stored).toBeDefined();
    expect(stored!.errorDetail).toBeDefined();
    expect(stored!.errorDetail!.code).toBe('QUOTA_EXCEEDED');
    expect(stored!.errorDetail!.retryable).toBe(true);
  });

  it('auto-retry fires once for retryable errors with retryAfterMs', async () => {
    const plan = makePlan('read data from spreadsheet');

    let callCount = 0;
    const handler: ExecuteHandlerFn = async () => {
      callCount++;
      const err = new Error('Rate limit exceeded');
      // Mark as retryable via errorDetail property
      (err as Record<string, unknown>)['errorDetail'] = {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
        retryable: true,
        retryAfterMs: 1, // 1ms for test speed
      };
      throw err;
    };

    const result = await executePlan(plan.planId, false, handler);

    // Plan should have ended in paused state
    expect(result.status).toBe('paused');
    // Auto-retry means handler is called twice: original + 1 retry
    expect(callCount).toBe(2);
    expect(result.error).toBe('Rate limit exceeded');
  });

  it('does NOT retry non-retryable errors', async () => {
    const plan = makePlan('read data from spreadsheet');

    let callCount = 0;
    const handler: ExecuteHandlerFn = async () => {
      callCount++;
      const err = new Error('Spreadsheet not found');
      (err as Record<string, unknown>)['errorDetail'] = {
        code: 'SPREADSHEET_NOT_FOUND',
        message: 'Spreadsheet not found',
        retryable: false,
      };
      throw err;
    };

    const result = await executePlan(plan.planId, false, handler);

    expect(result.status).toBe('paused');
    // Non-retryable: handler called exactly once
    expect(callCount).toBe(1);
  });

  it('recovery step is inserted when error has fixableVia', async () => {
    const plan = makePlan('read data from spreadsheet');
    const originalStepCount = plan.steps.length;

    const handler: ExecuteHandlerFn = async () => {
      const err = new Error('Auth required');
      (err as Record<string, unknown>)['errorDetail'] = {
        code: 'AUTH_REQUIRED',
        message: 'Auth required',
        retryable: false,
        fixableVia: {
          tool: 'sheets_auth',
          action: 'login',
          params: {},
        },
        suggestedFix: 'Login to authenticate',
      };
      throw err;
    };

    const result = await executePlan(plan.planId, false, handler);
    const stored = getPlanStatus(result.planId);

    expect(stored).toBeDefined();
    expect(stored!.status).toBe('paused');
    // B1: recovery step should have been inserted
    expect(stored!.steps.length).toBe(originalStepCount + 1);
    const recoveryStep = stored!.steps.find((s) => s.autoInserted === true);
    expect(recoveryStep).toBeDefined();
    expect(recoveryStep!.tool).toBe('sheets_auth');
    expect(recoveryStep!.action).toBe('login');
  });

  it('does NOT insert recovery step when error has no fixableVia', async () => {
    const plan = makePlan('read data from spreadsheet');
    const originalStepCount = plan.steps.length;

    const handler: ExecuteHandlerFn = async () => {
      const err = new Error('Unknown error');
      (err as Record<string, unknown>)['errorDetail'] = {
        code: 'INTERNAL_ERROR',
        message: 'Unknown error',
        retryable: false,
        // no fixableVia
      };
      throw err;
    };

    const result = await executePlan(plan.planId, false, handler);
    const stored = getPlanStatus(result.planId);

    expect(stored!.status).toBe('paused');
    expect(stored!.steps.length).toBe(originalStepCount);
  });

  it('dry run completes successfully without calling handler', async () => {
    const plan = makePlan('read data from spreadsheet');

    const handler = vi.fn().mockRejectedValue(new Error('Should not be called'));
    const result = await executePlan(plan.planId, true, handler as ExecuteHandlerFn);

    expect(result.status).toBe('completed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('executePlan handles second step error after first step succeeds', async () => {
    const plan = makePlan('read and write data from spreadsheet');
    // "read" and "write" both match patterns, should produce 2 steps
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);

    let callCount = 0;
    const handler: ExecuteHandlerFn = async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Step 2 failed');
      }
      return { data: 'success' };
    };

    const result = await executePlan(plan.planId, false, handler);

    expect(result.status).toBe('paused');
    expect(result.error).toBe('Step 2 failed');
    expect(result.results[result.results.length - 1]?.success).toBe(false);
  });
});
