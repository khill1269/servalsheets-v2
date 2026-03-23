/**
 * ServalSheets - Agent Execution Engine (facade)
 *
 * Re-exports all public APIs from the decomposed agent sub-modules.
 * This file exists to maintain backward-compatible import paths for callers
 * that import from 'agent-engine.js' directly.
 *
 * Sub-modules:
 *   agent/types.ts        — Types, interfaces, schema registration
 *   agent/sampling.ts     — MCP Sampling utilities
 *   agent/plan-store.ts   — In-memory store + disk persistence
 *   agent/templates.ts    — Workflow templates
 *   agent/plan-compiler.ts — Plan compilation (AI + regex + template)
 *   agent/plan-executor.ts — Step execution, verification, retry
 *   agent/checkpoints.ts  — Checkpoints, rollback, plan queries
 */

// Types and schema registration (G3: registerToolInputSchemas stays here as the public entry point)
export type {
  SamplingServer,
  SamplingMessage,
  SamplingCreateMessageResult,
  PlanStatus,
  ExecutionStep,
  StepResult,
  Checkpoint,
  PlanState,
  ExecuteHandlerFn,
  StepRunStatus,
  StepRunOutcome,
} from './agent/types.js';
export { registerToolInputSchemas } from './agent/types.js';

// Sampling server setters
export { setAgentSamplingServer, setAgentSamplingConsentChecker } from './agent/sampling.js';

// Plan store initialization
export { initializePlanStore } from './agent/plan-store.js';

// Template types and listing
export type {
  WorkflowTemplateToolStep,
  WorkflowTemplateLookupStep,
  WorkflowTemplateStep,
  WorkflowTemplate,
} from './agent/templates.js';

// Plan compilation
export {
  compilePlanAI,
  compilePlan,
  compileFromTemplate,
  listTemplates,
} from './agent/plan-compiler.js';

// Plan execution
export {
  aiValidateStepResult,
  executePlan,
  executeStep,
  resumePlan,
} from './agent/plan-executor.js';

// Checkpoints and plan queries
export {
  createCheckpoint,
  rollbackToPlan,
  getPlanStatus,
  listPlans,
  deletePlan,
  clearAllPlans,
} from './agent/checkpoints.js';
