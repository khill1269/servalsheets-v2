/**
 * Tool: sheets_agent
 * Agentic execution: autonomous planning, step execution, observation, and rollback.
 *
 * Actions (8):
 * - plan: Create multi-step execution plan from natural language
 * - execute: Execute entire plan autonomously
 * - execute_step: Execute single step from plan
 * - observe: Capture current spreadsheet state as checkpoint
 * - rollback: Revert to previous checkpoint
 * - get_status: Get plan and execution status
 * - list_plans: List all saved plans
 * - resume: Resume interrupted plan execution
 */

import { z } from 'zod';
import {
  ErrorDetailSchema,
  ResponseMetaSchema,
  SafetyOptionsSchema,
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options (dryRun to preview execution without applying, etc.)'
  ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
});

// ============================================================================
// Individual Action Schemas
// ============================================================================

const PlanActionSchema = CommonFieldsSchema.extend({
  action: z.literal('plan').describe('Create multi-step execution plan from natural language'),
  description: z
    .string()
    .min(1)
    .describe(
      'Natural language description of the goal or task to accomplish. Example: "Add a profit margin column and calculate totals for Q1 data"'
    ),
  spreadsheetId: z
    .string()
    .optional()
    .describe('Spreadsheet ID from URL (optional - can be specified in context)'),
  maxSteps: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum number of steps to generate in the plan (default: 10, max: 50)'),
  context: z
    .string()
    .optional()
    .describe(
      'Additional context to help the planner (e.g., "Data is in columns A-D, rows 2-100. Headers in row 1.")'
    ),
}).strict();

const ExecuteActionSchema = CommonFieldsSchema.extend({
  action: z.literal('execute').describe('Execute entire plan autonomously'),
  planId: z.string().min(1).describe('Plan ID from plan response'),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe('Preview execution without applying changes (default: false)'),
  interactiveMode: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, each plan step requires user approval via elicitation before executing (default: false)'
    ),
}).strict();

const ExecuteStepActionSchema = CommonFieldsSchema.extend({
  action: z.literal('execute_step').describe('Execute single step from plan'),
  planId: z.string().min(1).describe('Plan ID'),
  // BUG-15 fix: Accept both string step IDs and numeric step indices.
  // Plan responses use numeric indices (0, 1, 2) but schema originally required string.
  stepId: z
    .union([z.string().min(1), z.number().int().min(0)])
    .transform((val) => String(val))
    .describe('Step ID or index from plan (string or number)'),
}).strict();

const ObserveActionSchema = CommonFieldsSchema.extend({
  action: z.literal('observe').describe('Capture current spreadsheet state as checkpoint'),
  planId: z.string().min(1).describe('Plan ID to associate checkpoint with'),
  spreadsheetId: z.string().optional().describe('Spreadsheet ID (if different from plan context)'),
  context: z
    .string()
    .optional()
    .describe('Additional context about the checkpoint (e.g., "Before applying formulas")'),
}).strict();

const RollbackActionSchema = CommonFieldsSchema.extend({
  action: z.literal('rollback').describe('Revert to previous checkpoint'),
  planId: z.string().min(1).describe('Plan ID'),
  checkpointId: z.string().min(1).describe('Checkpoint ID from observe response'),
}).strict();

const GetStatusActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_status').describe('Get plan and execution status'),
  planId: z.string().min(1).describe('Plan ID'),
}).strict();

const ListPlansActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_plans').describe('List all saved plans'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(20)
    .describe('Maximum number of plans to return (default: 20)'),
  status: z
    .enum(['draft', 'executing', 'completed', 'paused', 'failed'])
    .optional()
    .describe('Filter by status (omit for all)'),
}).strict();

const ResumeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('resume').describe('Resume interrupted plan execution'),
  planId: z.string().min(1).describe('Plan ID'),
  fromStepId: z
    .string()
    .optional()
    .describe('Resume from specific step ID (omit to resume from next incomplete step)'),
}).strict();

// ============================================================================
// Combined Input Schema
// ============================================================================

// Preprocess to normalize common LLM input variations
const normalizeAgentRequest = (val: unknown): unknown => {
  if (typeof val !== 'object' || val === null) return val;
  const obj = val as Record<string, unknown>;

  // Alias: 'goal' → 'description' for plan action
  if (obj['action'] === 'plan' && obj['goal'] && !obj['description']) {
    return { ...obj, description: obj['goal'] };
  }

  // Alias: 'task' → 'description' for plan action
  if (obj['action'] === 'plan' && obj['task'] && !obj['description']) {
    return { ...obj, description: obj['task'] };
  }

  // Alias: 'id' → 'planId' for multi-step/execute/get_status/resume
  if (
    (obj['action'] === 'execute' ||
      obj['action'] === 'execute_step' ||
      obj['action'] === 'get_status' ||
      obj['action'] === 'observe' ||
      obj['action'] === 'rollback' ||
      obj['action'] === 'resume') &&
    obj['id'] &&
    !obj['planId']
  ) {
    return { ...obj, planId: obj['id'] };
  }

  // Alias: 'id' → 'checkpointId' for rollback
  if (obj['action'] === 'rollback' && obj['checkpointId'] === undefined && obj['id']) {
    return { ...obj, checkpointId: obj['id'] };
  }

  return val;
};

/**
 * All agentic execution inputs
 *
 * Discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsAgentInputSchema = z.object({
  request: z.preprocess(
    normalizeAgentRequest,
    z.discriminatedUnion('action', [
      PlanActionSchema,
      ExecuteActionSchema,
      ExecuteStepActionSchema,
      ObserveActionSchema,
      RollbackActionSchema,
      GetStatusActionSchema,
      ListPlansActionSchema,
      ResumeActionSchema,
    ])
  ),
});

// ============================================================================
// Output Schemas
// ============================================================================

const PlanStepSchema = z.object({
  stepId: z.string().describe('Unique step identifier'),
  tool: z.string().describe('Tool name (e.g., "sheets_data")'),
  action: z.string().describe('Action name (e.g., "write")'),
  params: z.record(z.string(), z.any()).describe('Parameters for the action'),
  description: z.string().describe('Human-readable description of what this step does'),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe('Step IDs that must complete before this step (if any)'),
});

const AgentResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // PLAN response fields
    planId: z.string().optional().describe('Unique identifier for the plan'),
    steps: z.array(PlanStepSchema).optional().describe('Ordered list of steps to execute'),
    summary: z.string().optional().describe('High-level summary of the plan'),
    estimatedSteps: z.number().int().optional().describe('Estimated number of steps (for preview)'),
    // EXECUTE and RESUME response fields
    // Execution timing
    executionTimeMs: z.number().optional().describe('Time taken in milliseconds'),
    // EXECUTE and RESUME response fields
    status: z
      .enum(['draft', 'executing', 'completed', 'paused', 'failed', 'restored'])
      .optional()
      .describe('Overall execution status'),
    completedSteps: z.number().int().optional().describe('Number of steps completed'),
    totalSteps: z.number().int().optional().describe('Total number of steps'),
    results: z
      .array(
        z.object({
          stepId: z.string(),
          success: z.boolean(),
          result: z.any().optional(),
          error: z.string().optional(),
        })
      )
      .optional()
      .describe('Results from each executed step'),
    // EXECUTE_STEP response fields
    stepId: z.string().optional().describe('Step ID that was executed'),
    completed: z.boolean().optional().describe('Whether the step completed successfully'),
    result: z.any().optional().describe('Result data from the executed step'),
    error: z.string().optional().describe('Error message if step failed'),
    // OBSERVE response fields
    checkpointId: z.string().optional().describe('Unique checkpoint identifier'),
    snapshot: z
      .record(z.string(), z.any())
      .optional()
      .describe('Current spreadsheet state snapshot'),
    timestamp: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Timestamp of observation (ISO string or Unix timestamp)'),
    // ROLLBACK response fields
    restoredSteps: z.number().int().optional().describe('Number of steps reverted'),
    // GET_STATUS response fields
    progress: z
      .object({
        completedSteps: z.number().int(),
        totalSteps: z.number().int(),
        percentage: z.number(),
      })
      .optional()
      .describe('Current progress information'),
    currentStep: z
      .union([
        z.object({
          stepId: z.string(),
          description: z.string(),
        }),
        z.string(),
      ])
      .optional()
      .describe('Currently executing step (if any) — object or stepId string'),
    // LIST_PLANS response fields
    plans: z
      .array(
        z.object({
          planId: z.string(),
          description: z.string(),
          status: z.enum(['draft', 'executing', 'completed', 'paused', 'failed', 'restored']),
          createdAt: z.union([z.number(), z.string()]),
          stepsCount: z.number().int(),
        })
      )
      .optional()
      .describe('List of plans'),
    // Common fields
    message: z.string().optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsAgentOutputSchema = z.object({
  response: AgentResponseSchema,
});

export const SHEETS_AGENT_ANNOTATIONS: ToolAnnotations = {
  title: 'Agentic Execution',
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// ============================================================================
// Type Exports
// ============================================================================

export type SheetsAgentInput = z.infer<typeof SheetsAgentInputSchema>;
export type SheetsAgentOutput = z.infer<typeof SheetsAgentOutputSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type AgentPlanStep = z.infer<typeof PlanStepSchema>;

// Type narrowing helpers for handler methods
export type AgentPlanInput = SheetsAgentInput['request'] & {
  action: 'plan';
  description: string;
};

export type AgentExecuteInput = SheetsAgentInput['request'] & {
  action: 'execute';
  planId: string;
  dryRun?: boolean;
  interactiveMode?: boolean;
};

export type AgentExecuteStepInput = SheetsAgentInput['request'] & {
  action: 'execute_step';
  planId: string;
  stepId: string;
};

export type AgentObserveInput = SheetsAgentInput['request'] & {
  action: 'observe';
  planId: string;
};

export type AgentRollbackInput = SheetsAgentInput['request'] & {
  action: 'rollback';
  planId: string;
  checkpointId: string;
};

export type AgentGetStatusInput = SheetsAgentInput['request'] & {
  action: 'get_status';
  planId: string;
};

export type AgentListPlansInput = SheetsAgentInput['request'] & {
  action: 'list_plans';
};

export type AgentResumeInput = SheetsAgentInput['request'] & {
  action: 'resume';
  planId: string;
};
