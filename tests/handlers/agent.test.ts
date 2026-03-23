/**
 * ServalSheets - Agent Handler Tests
 *
 * Covers all 8 actions for sheets_agent:
 * plan, execute, execute_step, observe, rollback, get_status, list_plans, resume
 *
 * Critical paths:
 * - rollback success and when no plan exists
 * - execute dry-run vs live mode
 * - plan returns steps
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentHandler } from '../../src/handlers/agent.js';

// ---------------------------------------------------------------------------
// Module-level mocks — mock all exported functions from agent-engine
// ---------------------------------------------------------------------------

vi.mock('../../src/services/agent-engine.js', () => ({
  compilePlanAI: vi.fn(),
  executePlan: vi.fn(),
  executeStep: vi.fn(),
  createCheckpoint: vi.fn(),
  rollbackToPlan: vi.fn(),
  getPlanStatus: vi.fn(),
  listPlans: vi.fn(),
  resumePlan: vi.fn(),
  setAgentSamplingServer: vi.fn(),
  setAgentSamplingConsentChecker: vi.fn(),
  initializePlanStore: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAN_ID = 'plan-test-001';
const STEP_ID = 'step-001';
const CHECKPOINT_ID = 'ckpt-001';

function makeStep(overrides?: Partial<{
  stepId: string;
  tool: string;
  action: string;
  params: Record<string, unknown>;
  description: string;
}>) {
  return {
    stepId: STEP_ID,
    tool: 'sheets_data',
    action: 'write',
    params: { spreadsheetId: 'ss-001', range: 'Sheet1!A1' },
    description: 'Write headers to Sheet1',
    ...overrides,
  };
}

function makePlanState(overrides?: Record<string, unknown>) {
  return {
    planId: PLAN_ID,
    description: 'Add profit margin column',
    status: 'draft',
    steps: [makeStep()],
    results: [],
    currentStepIndex: 0,
    createdAt: 1704067200000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentHandler', () => {
  let compilePlanAI: ReturnType<typeof vi.fn>;
  let executePlan: ReturnType<typeof vi.fn>;
  let executeStep: ReturnType<typeof vi.fn>;
  let createCheckpoint: ReturnType<typeof vi.fn>;
  let rollbackToPlan: ReturnType<typeof vi.fn>;
  let getPlanStatus: ReturnType<typeof vi.fn>;
  let listPlans: ReturnType<typeof vi.fn>;
  let resumePlan: ReturnType<typeof vi.fn>;
  let handler: AgentHandler;

  beforeEach(async () => {
    vi.clearAllMocks();

    const agentEngine = await import('../../src/services/agent-engine.js');
    compilePlanAI = vi.mocked(agentEngine.compilePlanAI);
    executePlan = vi.mocked(agentEngine.executePlan);
    executeStep = vi.mocked(agentEngine.executeStep);
    createCheckpoint = vi.mocked(agentEngine.createCheckpoint);
    rollbackToPlan = vi.mocked(agentEngine.rollbackToPlan);
    getPlanStatus = vi.mocked(agentEngine.getPlanStatus);
    listPlans = vi.mocked(agentEngine.listPlans);
    resumePlan = vi.mocked(agentEngine.resumePlan);

    // No real tool handlers needed for these tests
    handler = new AgentHandler();
  });

  // -------------------------------------------------------------------------
  // plan
  // -------------------------------------------------------------------------

  describe('plan', () => {
    it('should create a plan and return steps', async () => {
      const steps = [
        makeStep({ stepId: 'step-001', description: 'Read current data' }),
        makeStep({ stepId: 'step-002', action: 'write', description: 'Write profit column' }),
      ];
      compilePlanAI.mockResolvedValue({
        planId: PLAN_ID,
        steps,
      });

      const result = await handler.handle({
        request: {
          action: 'plan',
          description: 'Add a profit margin column to the Q1 data',
          spreadsheetId: 'ss-001',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('plan');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.steps).toHaveLength(2);
        expect(result.response.summary).toContain('2 steps');
      }
      expect(compilePlanAI).toHaveBeenCalledWith(
        'Add a profit margin column to the Q1 data',
        10,
        'ss-001',
        undefined
      );
    });

    it('should respect maxSteps parameter', async () => {
      compilePlanAI.mockResolvedValue({ planId: PLAN_ID, steps: [makeStep()] });

      await handler.handle({
        request: {
          action: 'plan',
          description: 'Do something complex',
          maxSteps: 5,
        },
      });

      expect(compilePlanAI).toHaveBeenCalledWith('Do something complex', 5, undefined, undefined);
    });

    it('injects live spreadsheet scout context before planning when handlers are available', async () => {
      compilePlanAI.mockResolvedValue({ planId: PLAN_ID, steps: [makeStep()] });

      const analyzeHandler = {
        handle: vi.fn().mockResolvedValue({
          response: {
            success: true,
            action: 'scout',
            scout: {
              sheets: [
                {
                  sheetId: 1,
                  title: 'Revenue Data',
                  rowCount: 42,
                  columnCount: 4,
                  flags: { isEmpty: false },
                },
              ],
            },
          },
        }),
      };
      const dataHandler = {
        handle: vi.fn().mockResolvedValue({
          response: {
            success: true,
            action: 'read',
            values: [
              ['Month', 'Revenue', 'Cost', 'Profit'],
              ['Jan', 100, 40, 60],
            ],
          },
        }),
      };

      handler = new AgentHandler({
        analyze: analyzeHandler,
        data: dataHandler,
      });

      await handler.handle({
        request: {
          action: 'plan',
          description: 'Summarize profit trends',
          spreadsheetId: 'ss-live-001',
        },
      });

      expect(analyzeHandler.handle).toHaveBeenCalledWith({
        request: {
          action: 'scout',
          spreadsheetId: 'ss-live-001',
          verbosity: 'minimal',
        },
      });
      expect(dataHandler.handle).toHaveBeenCalledWith({
        request: {
          action: 'read',
          spreadsheetId: 'ss-live-001',
          range: "'Revenue Data'!1:3",
          verbosity: 'minimal',
        },
      });
      expect(compilePlanAI).toHaveBeenCalledWith(
        'Summarize profit trends',
        10,
        'ss-live-001',
        expect.stringContaining('Spreadsheet scout (live):')
      );
      expect(compilePlanAI.mock.calls[0]?.[3]).toContain('sheet="Revenue Data"');
      expect(compilePlanAI.mock.calls[0]?.[3]).toContain('headers=["Month","Revenue","Cost","Profit"]');
      expect(compilePlanAI.mock.calls[0]?.[3]).toContain('sample=["Jan",100,40,60]');
    });

    it('should return error when compilePlanAI throws', async () => {
      compilePlanAI.mockRejectedValue(new Error('AI service unavailable'));

      const result = await handler.handle({
        request: {
          action: 'plan',
          description: 'Create budget tracker',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('AI service unavailable');
      }
    });
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  describe('execute', () => {
    it('should execute a plan in live mode', async () => {
      executePlan.mockResolvedValue({
        planId: PLAN_ID,
        status: 'completed',
        steps: [makeStep()],
        results: [{ stepId: STEP_ID, success: true, result: { rowsWritten: 5 } }],
      });

      const result = await handler.handle({
        request: {
          action: 'execute',
          planId: PLAN_ID,
          dryRun: false,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('execute');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.status).toBe('completed');
        expect(result.response.completedSteps).toBe(1);
        expect(result.response.totalSteps).toBe(1);
      }
      expect(executePlan).toHaveBeenCalledWith(PLAN_ID, false, expect.any(Function), false);
    });

    it('should execute a plan in dry-run mode', async () => {
      executePlan.mockResolvedValue({
        planId: PLAN_ID,
        status: 'completed',
        steps: [makeStep(), makeStep({ stepId: 'step-002' })],
        results: [
          { stepId: STEP_ID, success: true, result: { dryRun: true } },
          { stepId: 'step-002', success: true, result: { dryRun: true } },
        ],
      });

      const result = await handler.handle({
        request: {
          action: 'execute',
          planId: PLAN_ID,
          dryRun: true,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.completedSteps).toBe(2);
        expect(result.response.totalSteps).toBe(2);
      }
      expect(executePlan).toHaveBeenCalledWith(PLAN_ID, true, expect.any(Function), false);
    });

    it('should return error when plan execution fails', async () => {
      executePlan.mockRejectedValue(new Error('Plan not found: plan-missing'));

      const result = await handler.handle({
        request: {
          action: 'execute',
          planId: 'plan-missing',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('Plan not found');
      }
    });
  });

  // -------------------------------------------------------------------------
  // execute_step
  // -------------------------------------------------------------------------

  describe('execute_step', () => {
    it('should execute a single step successfully', async () => {
      executeStep.mockResolvedValue({ success: true, result: { cellsWritten: 3 } });

      const result = await handler.handle({
        request: {
          action: 'execute_step',
          planId: PLAN_ID,
          stepId: STEP_ID,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('execute_step');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.stepId).toBe(STEP_ID);
        expect(result.response.completed).toBe(true);
      }
    });

    it('should surface step failure without throwing', async () => {
      executeStep.mockResolvedValue({ success: false, error: 'Range locked' });

      const result = await handler.handle({
        request: {
          action: 'execute_step',
          planId: PLAN_ID,
          stepId: STEP_ID,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.completed).toBe(false);
        expect(result.response.error).toBe('Range locked');
      }
    });

    it('should return INTERNAL_ERROR when executeStep throws', async () => {
      executeStep.mockRejectedValue(new Error('Step service crashed'));

      const result = await handler.handle({
        request: {
          action: 'execute_step',
          planId: PLAN_ID,
          stepId: 'step-bad',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  // -------------------------------------------------------------------------
  // observe
  // -------------------------------------------------------------------------

  describe('observe', () => {
    it('should create a checkpoint for the plan', async () => {
      createCheckpoint.mockReturnValue({
        checkpointId: CHECKPOINT_ID,
        stepIndex: 2,
        timestamp: '2026-03-04T10:00:00.000Z',
      });

      const result = await handler.handle({
        request: {
          action: 'observe',
          planId: PLAN_ID,
          context: 'Before applying formulas',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('observe');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.checkpointId).toBe(CHECKPOINT_ID);
        expect(result.response.snapshot).toEqual({ stepIndex: 2 });
      }
      expect(createCheckpoint).toHaveBeenCalledWith(PLAN_ID, 'Before applying formulas');
    });

    it('should return error when createCheckpoint throws', async () => {
      createCheckpoint.mockImplementation(() => {
        throw new Error('Plan plan-xyz not found');
      });

      const result = await handler.handle({
        request: {
          action: 'observe',
          planId: 'plan-xyz',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  // -------------------------------------------------------------------------
  // rollback — CRITICAL
  // -------------------------------------------------------------------------

  describe('rollback', () => {
    it('should rollback to a checkpoint successfully', async () => {
      rollbackToPlan.mockReturnValue({
        planId: PLAN_ID,
        status: 'paused',
        currentStepIndex: 1,
        steps: [makeStep(), makeStep({ stepId: 'step-002' })],
        results: [],
      });

      const result = await handler.handle({
        request: {
          action: 'rollback',
          planId: PLAN_ID,
          checkpointId: CHECKPOINT_ID,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('rollback');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.checkpointId).toBe(CHECKPOINT_ID);
        expect(result.response.status).toBe('restored');
        expect(result.response.restoredSteps).toBe(1);
      }
      expect(rollbackToPlan).toHaveBeenCalledWith(PLAN_ID, CHECKPOINT_ID);
    });

    it('should return error when plan does not exist for rollback', async () => {
      rollbackToPlan.mockImplementation(() => {
        throw new Error('Plan plan-missing not found');
      });

      const result = await handler.handle({
        request: {
          action: 'rollback',
          planId: 'plan-missing',
          checkpointId: CHECKPOINT_ID,
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('plan-missing');
      }
    });

    it('should return error when checkpoint does not exist', async () => {
      rollbackToPlan.mockImplementation(() => {
        throw new Error('Checkpoint ckpt-missing not found');
      });

      const result = await handler.handle({
        request: {
          action: 'rollback',
          planId: PLAN_ID,
          checkpointId: 'ckpt-missing',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.message).toContain('ckpt-missing');
      }
    });
  });

  // -------------------------------------------------------------------------
  // get_status
  // -------------------------------------------------------------------------

  describe('get_status', () => {
    it('should return plan status and progress', async () => {
      getPlanStatus.mockReturnValue(
        makePlanState({
          status: 'executing',
          steps: [makeStep(), makeStep({ stepId: 'step-002' })],
          results: [{ stepId: STEP_ID, success: true }],
          currentStepIndex: 1,
        })
      );

      const result = await handler.handle({
        request: {
          action: 'get_status',
          planId: PLAN_ID,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('get_status');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.status).toBe('executing');
        expect(result.response.progress?.completedSteps).toBe(1);
        expect(result.response.progress?.totalSteps).toBe(2);
        expect(result.response.progress?.percentage).toBe(50);
      }
    });

    it('should return NOT_FOUND when plan does not exist', async () => {
      getPlanStatus.mockReturnValue(undefined);

      const result = await handler.handle({
        request: {
          action: 'get_status',
          planId: 'plan-nonexistent',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('NOT_FOUND');
        expect(result.response.error.message).toContain('plan-nonexistent');
      }
    });

    it('should calculate 0% progress for empty results', async () => {
      getPlanStatus.mockReturnValue(
        makePlanState({
          status: 'draft',
          steps: [makeStep(), makeStep({ stepId: 'step-002' })],
          results: [],
          currentStepIndex: 0,
        })
      );

      const result = await handler.handle({
        request: {
          action: 'get_status',
          planId: PLAN_ID,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.progress?.percentage).toBe(0);
        expect(result.response.progress?.completedSteps).toBe(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // list_plans
  // -------------------------------------------------------------------------

  describe('list_plans', () => {
    it('should list plans with default limit', async () => {
      const mockPlans = [
        makePlanState({ planId: 'plan-001', description: 'Plan A', status: 'completed', createdAt: 1000 }),
        makePlanState({ planId: 'plan-002', description: 'Plan B', status: 'draft', createdAt: 2000 }),
      ];
      listPlans.mockReturnValue(mockPlans);

      const result = await handler.handle({
        request: {
          action: 'list_plans',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('list_plans');
        expect(result.response.plans).toHaveLength(2);
        expect(result.response.plans?.[0]?.planId).toBe('plan-001');
        expect(result.response.plans?.[0]?.stepsCount).toBe(1);
      }
      expect(listPlans).toHaveBeenCalledWith(20, undefined);
    });

    it('should filter plans by status', async () => {
      listPlans.mockReturnValue([
        makePlanState({ status: 'completed' }),
      ]);

      const result = await handler.handle({
        request: {
          action: 'list_plans',
          status: 'completed',
          limit: 5,
        },
      });

      expect(result.response.success).toBe(true);
      expect(listPlans).toHaveBeenCalledWith(5, 'completed');
    });

    it('should return empty plans array when none match', async () => {
      listPlans.mockReturnValue([]);

      const result = await handler.handle({
        request: {
          action: 'list_plans',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.plans).toHaveLength(0);
      }
    });

    it('should return error when listPlans throws', async () => {
      listPlans.mockImplementation(() => {
        throw new Error('Store access error');
      });

      const result = await handler.handle({
        request: {
          action: 'list_plans',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  // -------------------------------------------------------------------------
  // resume
  // -------------------------------------------------------------------------

  describe('resume', () => {
    it('should resume a paused plan from next incomplete step', async () => {
      resumePlan.mockResolvedValue({
        planId: PLAN_ID,
        status: 'completed',
        steps: [makeStep(), makeStep({ stepId: 'step-002' })],
        results: [
          { stepId: STEP_ID, success: true },
          { stepId: 'step-002', success: true },
        ],
      });

      const result = await handler.handle({
        request: {
          action: 'resume',
          planId: PLAN_ID,
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('resume');
        expect(result.response.planId).toBe(PLAN_ID);
        expect(result.response.status).toBe('completed');
        expect(result.response.completedSteps).toBe(2);
      }
      expect(resumePlan).toHaveBeenCalledWith(PLAN_ID, undefined, expect.any(Function));
    });

    it('should resume from a specific step ID', async () => {
      resumePlan.mockResolvedValue({
        planId: PLAN_ID,
        status: 'completed',
        steps: [makeStep()],
        results: [{ stepId: STEP_ID, success: true }],
      });

      const result = await handler.handle({
        request: {
          action: 'resume',
          planId: PLAN_ID,
          fromStepId: STEP_ID,
        },
      });

      expect(result.response.success).toBe(true);
      expect(resumePlan).toHaveBeenCalledWith(PLAN_ID, STEP_ID, expect.any(Function));
    });

    it('should return error when plan to resume is not found', async () => {
      resumePlan.mockRejectedValue(new Error('Plan plan-gone not found'));

      const result = await handler.handle({
        request: {
          action: 'resume',
          planId: 'plan-gone',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
        expect(result.response.error.message).toContain('plan-gone');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Unknown action (exhaustiveness check)
  // -------------------------------------------------------------------------

  describe('unknown action', () => {
    it('should return INVALID_PARAMS for unknown action', async () => {
      const result = await handler.handle({
        request: { action: 'totally_unknown' } as any,
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error).toBeDefined();
      }
    });
  });
});
