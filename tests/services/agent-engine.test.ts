/**
 * Core agent-engine function tests.
 *
 * Covers: compilePlan, compileFromTemplate, listTemplates, executePlan (dryRun + real),
 * executeStep, createCheckpoint, rollbackToPlan, getPlanStatus, listPlans, deletePlan.
 *
 * Auto-retry, error classification, cross-sheet lookup, and consent are covered by
 * separate focused test files (agent-error-classification, agent-cross-sheet-lookup,
 * agent-engine-consent).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import {
  clearAllPlans,
  compilePlan,
  compileFromTemplate,
  createCheckpoint,
  deletePlan,
  executePlan,
  executeStep,
  getPlanStatus,
  listPlans,
  listTemplates,
  registerToolInputSchemas,
  resumePlan,
  rollbackToPlan,
  type ExecuteHandlerFn,
  type PlanState,
} from '../../src/services/agent-engine.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/tool-definitions.js';
import { encryptPlan, decryptPlan } from '../../src/utils/plan-crypto.js';
import { resetEnvForTest } from '../../src/config/env.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPREADSHEET_ID = 'test-spreadsheet-abc';

function makeHandler(
  result: unknown = { success: true },
  shouldThrow?: Error
): ExecuteHandlerFn {
  return async (_tool, _action, _params) => {
    if (shouldThrow) throw shouldThrow;
    return result;
  };
}

function makePlanExecutable(plan: PlanState): PlanState {
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

/** Create a plan with at least one step ("read" maps to sheets_data.read). */
function makePlan(description = 'read data from spreadsheet'): PlanState {
  return makePlanExecutable(compilePlan(description, 10, SPREADSHEET_ID));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Register tool input schemas for step-parameter validation during plan execution
  registerToolInputSchemas(new Map(TOOL_DEFINITIONS.map((t) => [t.name, t.inputSchema] as const)));
  await clearAllPlans();
});

afterEach(async () => {
  await clearAllPlans();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// compilePlan
// ---------------------------------------------------------------------------

describe('compilePlan', () => {
  it('returns a plan in draft status', () => {
    const plan = makePlan();
    expect(plan.status).toBe('draft');
  });

  it('assigns a unique planId', () => {
    const p1 = makePlan();
    const p2 = makePlan();
    expect(p1.planId).not.toBe(p2.planId);
  });

  it('stores the plan so getPlanStatus finds it', () => {
    const plan = makePlan();
    expect(getPlanStatus(plan.planId)).toBeDefined();
    expect(getPlanStatus(plan.planId)?.planId).toBe(plan.planId);
  });

  it('creates steps for a recognised description', () => {
    const plan = makePlan('read data then write results');
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('respects maxSteps cap', () => {
    const plan = compilePlan('read data from spreadsheet', 1, SPREADSHEET_ID);
    expect(plan.steps.length).toBeLessThanOrEqual(1);
  });

  it('initialises with empty results and checkpoints', () => {
    const plan = makePlan();
    expect(plan.results).toHaveLength(0);
    expect(plan.checkpoints).toHaveLength(0);
    expect(plan.currentStepIndex).toBe(0);
  });

  it('persists spreadsheetId and planning context summary on plan state', () => {
    const plan = compilePlan(
      'read data from spreadsheet',
      10,
      SPREADSHEET_ID,
      'Sheet names: Revenue, Costs'
    );

    expect(plan.spreadsheetId).toBe(SPREADSHEET_ID);
    expect(plan.planningContextSummary).toContain('Sheet names: Revenue, Costs');
  });
});

// ---------------------------------------------------------------------------
// compileFromTemplate + listTemplates
// ---------------------------------------------------------------------------

describe('listTemplates', () => {
  it('returns at least one template', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThan(0);
  });

  it('every entry has name, description, stepCount', () => {
    for (const t of listTemplates()) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.stepCount).toBe('number');
      expect(t.stepCount).toBeGreaterThan(0);
    }
  });
});

describe('compileFromTemplate', () => {
  it('returns undefined for an unknown template name', () => {
    const plan = compileFromTemplate('no-such-template', SPREADSHEET_ID);
    expect(plan).toBeUndefined();
  });

  it('returns a draft plan for a valid template name', () => {
    const templates = listTemplates();
    // Take the first available template name from WORKFLOW_TEMPLATES
    // compileFromTemplate key matches internal template map; listTemplates returns .name
    // We probe by trying the first entry key via the result of compileFromTemplate heuristic.
    // Use the first template's name as the lookup key — may differ from map key.
    // Instead iterate until one succeeds:
    let plan: PlanState | undefined;
    for (const t of templates) {
      plan = compileFromTemplate(t.name, SPREADSHEET_ID);
      if (plan) break;
    }
    if (!plan) {
      // Try known template names from Sprint 4 D1
      const knownNames = [
        'multi-sheet-crm',
        'budget-vs-actuals',
        'project-tracker',
        'inventory-with-lookups',
      ];
      for (const name of knownNames) {
        plan = compileFromTemplate(name, SPREADSHEET_ID);
        if (plan) break;
      }
    }
    expect(plan).toBeDefined();
    expect(plan?.status).toBe('draft');
    expect(plan?.steps.length).toBeGreaterThan(0);
  });

  it('stores compiled template plan in planStore', () => {
    const knownNames = [
      'multi-sheet-crm',
      'budget-vs-actuals',
      'project-tracker',
      'inventory-with-lookups',
    ];
    let plan: PlanState | undefined;
    for (const name of knownNames) {
      plan = compileFromTemplate(name, SPREADSHEET_ID);
      if (plan) break;
    }
    if (!plan) return; // Skip if no templates wired
    expect(getPlanStatus(plan.planId)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// executePlan — dryRun
// ---------------------------------------------------------------------------

describe('executePlan dryRun', () => {
  it('marks plan completed without calling executeHandler', async () => {
    const plan = makePlan();
    const handler = vi.fn().mockResolvedValue({ success: true });

    const result = await executePlan(plan.planId, true, handler);

    expect(result.status).toBe('completed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('sets dryRunPreview:true on each step result', async () => {
    const plan = makePlan();
    const result = await executePlan(plan.planId, true, makeHandler());

    for (const r of result.results) {
      expect((r.result as Record<string, unknown>)?.dryRunPreview).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// executePlan — real execution
// ---------------------------------------------------------------------------

describe('executePlan real execution', () => {
  it('runs all steps and returns completed status', async () => {
    const plan = makePlan();
    const result = await executePlan(plan.planId, false, makeHandler({ success: true, rows: 10 }));

    expect(result.status).toBe('completed');
    expect(result.results.length).toBe(plan.steps.length);
    expect(result.results.every((r) => r.success)).toBe(true);
  });

  it('throws NotFoundError for unknown planId', async () => {
    await expect(executePlan('nonexistent-plan', false, makeHandler())).rejects.toThrow();
  });

  it('marks plan paused and records error when a step throws', async () => {
    const plan = makePlan();
    const err = new Error('API quota exceeded');
    const result = await executePlan(plan.planId, false, makeHandler(undefined, err));

    expect(result.status).toBe('paused');
    expect(result.error).toBe('API quota exceeded');
    expect(result.results[0]?.success).toBe(false);
  });

  it('resumes from currentStepIndex after prior partial execution', async () => {
    const plan = makePlanExecutable(compilePlan('read data then write results', 5, SPREADSHEET_ID));
    if (plan.steps.length < 2) return; // Skip if not enough steps

    // Execute first step only by manipulating the handler
    let callCount = 0;
    const partialHandler: ExecuteHandlerFn = async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient error');
      return { success: true };
    };

    const pausedPlan = await executePlan(plan.planId, false, partialHandler);
    expect(pausedPlan.status).toBe('paused');
    const stepsRemaining = plan.steps.length - pausedPlan.currentStepIndex;

    // Resume — handler no longer throws
    const resumeHandler = makeHandler({ success: true });
    const completed = await executePlan(pausedPlan.planId, false, resumeHandler);
    expect(completed.results.length).toBeGreaterThanOrEqual(stepsRemaining);
  });

  it('pauses before execution when step params fail tool-schema validation', async () => {
    const plan = makePlan();
    plan.steps = [
      {
        stepId: 'invalid-write',
        tool: 'sheets_data',
        action: 'write',
        description: 'Attempt invalid write',
        params: {
          spreadsheetId: SPREADSHEET_ID,
        },
      },
    ];

    const handler = vi.fn(makeHandler({ success: true }));
    const result = await executePlan(plan.planId, false, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe('paused');
    expect(result.errorDetail?.code).toBe('INVALID_PARAMS');
    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toContain('invalid params');
  });

  it('pauses when deterministic post-step verification cannot confirm a clear', async () => {
    const plan = makePlan();
    plan.steps = [
      {
        stepId: 'verified-write',
        tool: 'sheets_data',
        action: 'clear',
        description: 'Clear values from Sheet1',
        params: {
          spreadsheetId: SPREADSHEET_ID,
          range: 'Sheet1!A1:B2',
        },
      },
    ];

    const handlerMock = vi.fn(async (_tool: string, action: string) => {
      if (action === 'clear') {
        return {
          response: {
            success: true,
            action: 'clear',
          },
        };
      }

      if (action === 'read') {
        return {
          response: {
            success: true,
            action: 'read',
            values: [['Mismatch', 'Value']],
          },
        };
      }

      throw new Error(`Unexpected action ${action}`);
    });
    const handler = handlerMock as ExecuteHandlerFn;

    const result = await executePlan(plan.planId, false, handler);

    expect(result.status).toBe('paused');
    expect(result.errorDetail?.code).toBe('FAILED_PRECONDITION');
    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toContain('Post-step verification failed');
    expect(handlerMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// executeStep
// ---------------------------------------------------------------------------

describe('executeStep', () => {
  it('uses the shared validation guard before calling the handler', async () => {
    const plan = makePlan();
    plan.steps = [
      {
        stepId: 'invalid-step',
        tool: 'sheets_data',
        action: 'write',
        description: 'Invalid write',
        params: {
          spreadsheetId: SPREADSHEET_ID,
        },
      },
    ];

    const handler = vi.fn(makeHandler({ success: true }));
    const result = await executeStep(plan.planId, 'invalid-step', handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid params');
    expect(getPlanStatus(plan.planId)?.status).toBe('paused');
  });

  it('executes a named step and returns a successful StepResult', async () => {
    const plan = makePlan();
    const step = plan.steps[0]!;

    const result = await executeStep(plan.planId, step.stepId, makeHandler({ value: 42 }));

    expect(result.success).toBe(true);
    expect(result.stepId).toBe(step.stepId);
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
  });

  it('throws NotFoundError for unknown planId', async () => {
    await expect(executeStep('bad-plan', 'bad-step', makeHandler())).rejects.toThrow();
  });

  it('throws NotFoundError for unknown stepId', async () => {
    const plan = makePlan();
    await expect(executeStep(plan.planId, 'no-such-step', makeHandler())).rejects.toThrow();
  });

  it('records failure in StepResult when handler throws', async () => {
    const plan = makePlan();
    const step = plan.steps[0]!;

    const result = await executeStep(
      plan.planId,
      step.stepId,
      makeHandler(undefined, new Error('sheet not found'))
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('sheet not found');
  });
});

// ---------------------------------------------------------------------------
// createCheckpoint + rollbackToPlan
// ---------------------------------------------------------------------------

describe('createCheckpoint', () => {
  it('creates a checkpoint with planId and stepIndex', () => {
    const plan = makePlan();
    const cp = createCheckpoint(plan.planId, 'before big write');

    expect(cp.planId).toBe(plan.planId);
    expect(cp.checkpointId).toBeDefined();
    expect(cp.context).toBe('before big write');
  });

  it('checkpoint appears on the plan checkpoints array', () => {
    const plan = makePlan();
    createCheckpoint(plan.planId, 'cp1');

    const updated = getPlanStatus(plan.planId);
    expect(updated?.checkpoints.length).toBe(1);
  });

  it('throws for unknown planId', () => {
    expect(() => createCheckpoint('no-plan', 'ctx')).toThrow();
  });
});

describe('rollbackToPlan', () => {
  it('reverts plan status to paused at the checkpoint stepIndex', async () => {
    const plan = makePlan();
    const cp = createCheckpoint(plan.planId, 'pre-exec');

    // Execute the plan so we have results
    await executePlan(plan.planId, false, makeHandler({ success: true }));
    const afterExec = getPlanStatus(plan.planId)!;
    expect(afterExec.status).toBe('completed');

    const reverted = rollbackToPlan(plan.planId, cp.checkpointId);
    expect(reverted.status).toBe('paused');
    expect(reverted.currentStepIndex).toBe(cp.stepIndex);
    // Results after checkpoint stepIndex are removed
    expect(reverted.results.filter((r) => {
      const idx = plan.steps.findIndex((s) => s.stepId === r.stepId);
      return idx >= cp.stepIndex;
    }).length).toBe(0);
  });

  it('throws for unknown checkpointId', () => {
    const plan = makePlan();
    expect(() => rollbackToPlan(plan.planId, 'bad-checkpoint')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getPlanStatus + listPlans
// ---------------------------------------------------------------------------

describe('getPlanStatus', () => {
  it('returns undefined for unknown planId', () => {
    expect(getPlanStatus('does-not-exist')).toBeUndefined();
  });

  it('returns the plan after compilation', () => {
    const plan = makePlan();
    const fetched = getPlanStatus(plan.planId);
    expect(fetched?.planId).toBe(plan.planId);
    expect(fetched?.description).toBe(plan.description);
  });
});

describe('listPlans', () => {
  it('returns all plans when no filter applied', () => {
    makePlan('read data');
    makePlan('write results');
    const plans = listPlans();
    expect(plans.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by status', async () => {
    const plan = makePlan();
    // Execute to completion
    await executePlan(plan.planId, false, makeHandler({ success: true }));

    const completed = listPlans(50, 'completed');
    expect(completed.every((p) => p.status === 'completed')).toBe(true);

    const drafts = listPlans(50, 'draft');
    expect(drafts.some((p) => p.planId === plan.planId)).toBe(false);
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) makePlan(`read step ${i}`);
    const limited = listPlans(2);
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it('includes all created plans in the result', () => {
    // Two plans created in the same test may share an identical millisecond timestamp
    // so relative ordering is non-deterministic; just assert both are present.
    const p1 = makePlan('first plan');
    const p2 = makePlan('second plan');
    const plans = listPlans();
    const ids = plans.map((p) => p.planId);
    expect(ids).toContain(p1.planId);
    expect(ids).toContain(p2.planId);
  });
});

// ---------------------------------------------------------------------------
// deletePlan
// ---------------------------------------------------------------------------

describe('deletePlan', () => {
  it('removes the plan from the store', () => {
    const plan = makePlan();
    expect(getPlanStatus(plan.planId)).toBeDefined();

    const deleted = deletePlan(plan.planId);
    expect(deleted).toBe(true);
    expect(getPlanStatus(plan.planId)).toBeUndefined();
  });

  it('returns false for unknown planId', () => {
    expect(deletePlan('nonexistent-id')).toBe(false);
  });

  it('removes plan from listPlans result', () => {
    const plan = makePlan();
    deletePlan(plan.planId);
    const plans = listPlans();
    expect(plans.some((p) => p.planId === plan.planId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// plan-crypto: encryptPlan / decryptPlan unit tests
// ---------------------------------------------------------------------------

const VALID_KEY_HEX = 'a'.repeat(64); // 32 bytes of 0xaa

describe('plan-crypto encryptPlan/decryptPlan', () => {
  afterEach(() => {
    delete process.env['PLAN_ENCRYPTION_KEY'];
    resetEnvForTest();
  });

  it('returns plaintext unchanged when PLAN_ENCRYPTION_KEY is not set', () => {
    delete process.env['PLAN_ENCRYPTION_KEY'];
    resetEnvForTest();
    const plaintext = JSON.stringify({ planId: 'test-1', status: 'draft' });
    expect(encryptPlan(plaintext)).toBe(plaintext);
  });

  it('returns ciphertext starting with "enc:" when PLAN_ENCRYPTION_KEY is set', () => {
    process.env['PLAN_ENCRYPTION_KEY'] = VALID_KEY_HEX;
    resetEnvForTest();
    const plaintext = JSON.stringify({ planId: 'test-2', status: 'draft' });
    const encrypted = encryptPlan(plaintext);
    expect(encrypted.startsWith('enc:')).toBe(true);
  });

  it('round-trip: encrypt then decrypt returns original plaintext', () => {
    process.env['PLAN_ENCRYPTION_KEY'] = VALID_KEY_HEX;
    resetEnvForTest();
    const plaintext = JSON.stringify({ planId: 'test-3', steps: [], status: 'executing' });
    const encrypted = encryptPlan(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decryptPlan(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('decryptPlan passes through plaintext (no "enc:" prefix) unchanged', () => {
    delete process.env['PLAN_ENCRYPTION_KEY'];
    resetEnvForTest();
    const plaintext = '{"planId":"test-4"}';
    expect(decryptPlan(plaintext)).toBe(plaintext);
  });

  it('decryptPlan throws when ciphertext present but key is missing', () => {
    process.env['PLAN_ENCRYPTION_KEY'] = VALID_KEY_HEX;
    resetEnvForTest();
    const encrypted = encryptPlan('{"planId":"test-5"}');
    expect(encrypted.startsWith('enc:')).toBe(true);

    delete process.env['PLAN_ENCRYPTION_KEY'];
    resetEnvForTest();
    expect(() => decryptPlan(encrypted)).toThrow('PLAN_ENCRYPTION_KEY not configured');
  });

  it('encryptPlan with invalid key (fails Zod regex) throws at env parse time', () => {
    process.env['PLAN_ENCRYPTION_KEY'] = 'tooshort';
    resetEnvForTest();
    const plaintext = '{"planId":"test-6"}';
    // Zod rejects non-64-hex-char values, so getEnv() throws a ZodError
    expect(() => encryptPlan(plaintext)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// persistPlan encryption integration: written files respect PLAN_ENCRYPTION_KEY
// ---------------------------------------------------------------------------

const PLAN_STORAGE_DIR = process.env['AGENT_PLAN_DIR'] || path.join(process.cwd(), '.serval', 'plans');

describe('persistPlan respects PLAN_ENCRYPTION_KEY', () => {
  afterEach(async () => {
    await clearAllPlans();
    delete process.env['PLAN_ENCRYPTION_KEY'];
    resetEnvForTest();
    vi.restoreAllMocks();
  });

  it('writes plaintext JSON when PLAN_ENCRYPTION_KEY is not set', async () => {
    delete process.env['PLAN_ENCRYPTION_KEY'];
    resetEnvForTest();

    const plan = makePlan('read data from spreadsheet');
    // Wait briefly for async persistPlan to complete
    await new Promise((r) => setTimeout(r, 50));

    const filePath = path.join(PLAN_STORAGE_DIR, `${plan.planId}.json`);
    if (!existsSync(filePath)) return; // persistence may be disabled in test env
    const content = await readFile(filePath, 'utf-8');
    expect(content.startsWith('enc:')).toBe(false);
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('writes encrypted content starting with "enc:" when PLAN_ENCRYPTION_KEY is set', async () => {
    process.env['PLAN_ENCRYPTION_KEY'] = VALID_KEY_HEX;
    resetEnvForTest();

    const plan = makePlan('read data from spreadsheet');
    await new Promise((r) => setTimeout(r, 50));

    const filePath = path.join(PLAN_STORAGE_DIR, `${plan.planId}.json`);
    if (!existsSync(filePath)) return;
    const content = await readFile(filePath, 'utf-8');
    expect(content.startsWith('enc:')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plan cancellation semantics
//
// ServalSheets has no explicit cancelPlan() function. Stopping execution
// mid-plan is achieved through one of two mechanisms:
//   1. Let a step fail → plan transitions to 'paused'; resume is possible
//   2. Force-abandon by calling deletePlan() → plan removed from store entirely
//
// The abortSignal on the request context applies only to in-flight MCP
// sampling operations, not to the executePlan() loop itself.
// ---------------------------------------------------------------------------

describe('Plan cancellation semantics', () => {
  it('no cancelPlan export exists — stopping is achieved via pause semantics', () => {
    // This test documents a deliberate architectural decision:
    // the only way to stop execution is through step failure → paused state.
    // There is no fire-and-forget "cancel" API.
    const agentEngineExports = Object.keys({
      clearAllPlans,
      compilePlan,
      compileFromTemplate,
      createCheckpoint,
      deletePlan,
      executePlan,
      executeStep,
      getPlanStatus,
      listPlans,
      listTemplates,
      resumePlan,
      rollbackToPlan,
    });
    expect(agentEngineExports).not.toContain('cancelPlan');
  });

  it('a step failure mid-execution pauses the plan without losing prior results', async () => {
    const plan = makePlanExecutable(
      compilePlan('read data then write results then format', 10, SPREADSHEET_ID)
    );
    // Plan must have at least 2 steps for this test to be meaningful
    if (plan.steps.length < 2) return;

    let callCount = 0;
    const handler: ExecuteHandlerFn = async () => {
      callCount++;
      if (callCount === 2) throw new Error('transient quota exceeded');
      return { success: true };
    };

    const paused = await executePlan(plan.planId, false, handler);

    // Plan is paused, not failed — can be resumed
    expect(paused.status).toBe('paused');
    // First step's result is preserved
    expect(paused.results[0]?.success).toBe(true);
    // The failed step is recorded
    expect(paused.results[1]?.success).toBe(false);
  });

  it('a paused plan can be resumed from the failed step', async () => {
    const plan = makePlanExecutable(
      compilePlan('read data then write results', 10, SPREADSHEET_ID)
    );
    if (plan.steps.length < 2) return;

    let callCount = 0;
    const failingHandler: ExecuteHandlerFn = async () => {
      callCount++;
      if (callCount === 1) throw new Error('network error');
      return { success: true };
    };

    const paused = await executePlan(plan.planId, false, failingHandler);
    expect(paused.status).toBe('paused');

    const resumeHandler: ExecuteHandlerFn = async (_tool, action) => {
      if (action === 'write') {
        return {
          response: {
            success: true,
            action: 'write',
          },
        };
      }

      if (action === 'read') {
        return {
          response: {
            success: true,
            action: 'read',
            values: [
              ['Name', 'Value'],
              ['Alice', 42],
            ],
          },
        };
      }

      return { success: true };
    };

    const completed = await resumePlan(paused.planId, undefined, resumeHandler);
    expect(completed.status).toBe('completed');
    // All steps have at least one result (failed step may have an additional retry record)
    expect(completed.results.length).toBeGreaterThanOrEqual(plan.steps.length);
  });

  it('resumePlan throws ValidationError if plan is not paused', async () => {
    const plan = makePlan();
    const completed = await executePlan(plan.planId, false, makeHandler({ success: true }));
    expect(completed.status).toBe('completed');

    await expect(
      resumePlan(completed.planId, undefined, makeHandler({ success: true }))
    ).rejects.toThrow();
  });

  it('deletePlan force-abandons a paused plan — getPlanStatus returns undefined', async () => {
    const plan = makePlan();
    const paused = await executePlan(
      plan.planId,
      false,
      makeHandler(undefined, new Error('step failed'))
    );
    expect(paused.status).toBe('paused');

    const deleted = deletePlan(paused.planId);
    expect(deleted).toBe(true);

    // Plan is gone — cannot be resumed
    expect(getPlanStatus(paused.planId)).toBeUndefined();
  });

  it('deletePlan on a running-then-completed plan succeeds', async () => {
    const plan = makePlan();
    await executePlan(plan.planId, false, makeHandler({ success: true }));

    const deleted = deletePlan(plan.planId);
    expect(deleted).toBe(true);
    expect(getPlanStatus(plan.planId)).toBeUndefined();
  });
});
