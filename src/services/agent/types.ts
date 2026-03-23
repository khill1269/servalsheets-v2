/**
 * Agent Engine — Types and Interfaces
 *
 * Shared type definitions and schema registration for the agent execution engine.
 * Keeping types in a dedicated module prevents circular imports when sub-modules
 * need to reference the same interfaces.
 */

import type { ZodTypeAny } from 'zod';
import type { ErrorDetail } from '../../schemas/shared.js';

// ============================================================================
// Exported interfaces
// ============================================================================

export interface SamplingTextContent {
  type: 'text';
  text: string;
}

export interface SamplingMessage {
  role: 'user' | 'assistant';
  content: SamplingTextContent;
}

export interface SamplingCreateMessageResult {
  content:
    | SamplingTextContent
    | SamplingTextContent[]
    | Array<{
        type: string;
        text?: string;
      }>;
}

export interface SamplingServer {
  createMessage(params: {
    messages: SamplingMessage[];
    systemPrompt?: string;
    maxTokens?: number;
    modelPreferences?: { hints?: Array<{ name: string }> };
    temperature?: number;
  }): Promise<SamplingCreateMessageResult>;
}

export type PlanStatus = 'draft' | 'executing' | 'completed' | 'paused' | 'failed';

export interface ExecutionStep {
  stepId: string;
  tool: string;
  action: string;
  params: Record<string, unknown>;
  description: string;
  dependsOn?: string[];
  /** Set to 1 after the first auto-retry; prevents infinite retry loops */
  retryCount?: number;
  /** True if this step was auto-inserted as a recovery step */
  autoInserted?: boolean;
  /**
   * Step type override. When set to 'inject_cross_sheet_lookup', the executor
   * handles the step internally rather than delegating to executeHandler.
   */
  type?: 'inject_cross_sheet_lookup';
  /**
   * Typed configuration block for custom step types.
   * For 'inject_cross_sheet_lookup': sourceSheet, lookupCol, returnCol,
   * targetSheet, targetCol, targetKeyCol, startRow.
   */
  config?: Record<string, unknown>;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface Checkpoint {
  checkpointId: string;
  planId: string;
  stepIndex: number;
  context?: string;
  timestamp: string;
  snapshotId?: string;
}

export interface PlanState {
  planId: string;
  description: string;
  spreadsheetId?: string;
  planningContextSummary?: string;
  steps: ExecutionStep[];
  status: PlanStatus;
  results: StepResult[];
  checkpoints: Checkpoint[];
  createdAt: string;
  updatedAt: string;
  currentStepIndex: number;
  error?: string;
  /** Structured error detail for the last failure, if available */
  errorDetail?: ErrorDetail;
}

export type ExecuteHandlerFn = (
  tool: string,
  action: string,
  params: Record<string, unknown>
) => Promise<unknown>;

export type StepRunStatus = 'success' | 'retry' | 'pause';

export type StepRunOutcome = {
  status: StepRunStatus;
  stepResult?: StepResult;
  errorDetail?: ErrorDetail;
  recoveryStep?: ExecutionStep | null;
  retryAfterMs?: number;
};

export type ParsedHandlerResponse = {
  success?: boolean;
  action?: string;
  error?: Record<string, unknown>;
  values?: unknown;
  scout?: Record<string, unknown>;
  spreadsheet?: Record<string, unknown>;
};

// ============================================================================
// Schema registration (setter pattern — avoids services→mcp/registration dependency)
// ============================================================================

// Populated by the MCP layer at startup via registerToolInputSchemas().
// Using a setter avoids a services→mcp/registration architecture boundary violation.
let _toolInputSchemas: Map<string, ZodTypeAny> | null = null;

/**
 * Called once by the MCP registration layer to provide tool input schemas for
 * step-result validation. Must be called before any agent plans are executed.
 */
export function registerToolInputSchemas(schemas: Map<string, ZodTypeAny>): void {
  _toolInputSchemas = schemas;
}

export function getToolInputSchemas(): Map<string, ZodTypeAny> {
  return _toolInputSchemas ?? new Map();
}
