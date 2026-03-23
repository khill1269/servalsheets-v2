/**
 * Agent Engine — Plan Compiler
 *
 * Converts natural language descriptions into executable agent plans.
 * Tries AI-powered (MCP Sampling) planning first, falls back to regex-based matching.
 * Also provides template-based compilation via WORKFLOW_TEMPLATES.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { getSessionContext } from '../session-context.js';
import type { ExecutionStep, PlanState } from './types.js';
import {
  getSamplingServer,
  assertSamplingConsent,
  withSamplingTimeout,
  createUserMessage,
  extractTextFromResult,
  getModelHint,
} from './sampling.js';
import { planStore, MAX_PLANS, evictOldestPlan, persistPlan } from './plan-store.js';
import { WORKFLOW_TEMPLATES } from './templates.js';
import type { WorkflowTemplate } from './templates.js';

// ============================================================================
// Helpers
// ============================================================================

export function summarizePlanningContext(context?: string): string | undefined {
  const trimmed = context?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= 2000 ? trimmed : `${trimmed.slice(0, 2000)}...`;
}

export function buildPlanState(args: {
  planId: string;
  description: string;
  steps: ExecutionStep[];
  now: string;
  spreadsheetId?: string;
  planningContextSummary?: string;
}): PlanState {
  return {
    planId: args.planId,
    description: args.description,
    spreadsheetId: args.spreadsheetId,
    planningContextSummary: args.planningContextSummary,
    steps: args.steps,
    status: 'draft',
    results: [],
    checkpoints: [],
    createdAt: args.now,
    updatedAt: args.now,
    currentStepIndex: 0,
  };
}

// ============================================================================
// AI-Powered Plan Generation
// ============================================================================

/**
 * Use MCP Sampling to generate semantically intelligent execution steps.
 * Falls back to undefined if sampling is unavailable or fails.
 */
async function aiParsePlan(
  description: string,
  spreadsheetId?: string,
  context?: string,
  maxSteps?: number
): Promise<ExecutionStep[] | undefined> {
  const samplingServer = getSamplingServer();
  if (!samplingServer) return undefined;

  try {
    await assertSamplingConsent();

    const systemPrompt = `You are a task planning expert for spreadsheet operations.
Given a user's description, generate a step-by-step execution plan.
Each step must reference a specific ServalSheets tool and action (e.g., sheets_data.read, sheets_format.set_format).
Include required parameters for each step. Order steps by dependency.
Return a JSON array of plan steps: [{ tool, action, params, description }].

Available tools and their key actions:
- sheets_core: create, get, add_sheet, delete_sheet, list, update_properties
- sheets_data: read, write, append, clear, find_replace, cross_read, cross_query, cross_write, cross_compare
- sheets_format: set_format, set_background, set_text_format, set_number_format, apply_preset, set_borders, clear_format, batch_format, set_rich_text
- sheets_dimensions: sort_range, freeze, insert, delete, auto_resize, hide, show, group, ungroup, set_basic_filter, clear_basic_filter
- sheets_visualize: chart_create, chart_update, pivot_create, pivot_update, suggest_chart, suggest_pivot
- sheets_analyze: comprehensive, scout, analyze_data, detect_patterns, suggest_next_actions, auto_enhance, quick_insights
- sheets_fix: clean, standardize_formats, fill_missing, detect_anomalies, suggest_cleaning, fix
- sheets_compute: aggregate, statistical, forecast, regression, evaluate
- sheets_composite: import_csv, deduplicate, setup_sheet, generate_sheet, import_xlsx, export_xlsx, bulk_update, data_pipeline
- sheets_history: undo, redo, revert_to, timeline, restore_cells
- sheets_dependencies: build, model_scenario, compare_scenarios, analyze_impact
- sheets_collaborate: share_add, comment_add, share_list, comment_list, share_remove
- sheets_advanced: add_named_range, list_named_ranges, add_protected_range, create_table, add_banding
- sheets_templates: list, apply, create, import_builtin, delete
- sheets_auth: status, login, logout, refresh, callback
- sheets_webhook: register, list, unregister, watch_changes, update
- sheets_transaction: begin, queue, commit, rollback, status
- sheets_federation: call_remote, list_servers, get_server_tools, validate_connection
- sheets_bigquery: export_to_bigquery, import_from_bigquery, query, connect, list_connections
- sheets_appsscript: run, create, deploy, list, update_content
- sheets_session: set_active, get_context, save_checkpoint, restore_checkpoint, record_operation
- sheets_quality: validate, detect_conflicts, resolve_conflict, analyze_impact
- sheets_confirm: request, approve, deny, status, cancel
- sheets_connectors: list, configure, query, subscribe, get_status

EXAMPLE PLAN:

User request: "Create a sales tracker with monthly revenue, import Q1 data, and add a chart"

Generated plan:
[
  {
    "step": 1,
    "tool": "sheets_core",
    "action": "create",
    "params": { "title": "Sales Tracker 2026" },
    "description": "Create new spreadsheet"
  },
  {
    "step": 2,
    "tool": "sheets_composite",
    "action": "import_csv",
    "params": { "source": "q1_data.csv", "createNewSheet": true },
    "description": "Import Q1 data into a new sheet"
  },
  {
    "step": 3,
    "tool": "sheets_dimensions",
    "action": "freeze",
    "params": { "frozenRowCount": 1 },
    "description": "Freeze header row"
  },
  {
    "step": 4,
    "tool": "sheets_visualize",
    "action": "chart_create",
    "params": { "chartType": "LINE", "dataRange": "Sheet1!A:B", "title": "Monthly Revenue" },
    "description": "Create revenue trend chart"
  }
]

Return ONLY valid JSON array, no markdown code blocks, no explanation.
Maximum ${maxSteps || 10} steps.`;

    let prompt = `Plan steps for: "${description}"`;
    if (spreadsheetId) prompt += `\nTarget spreadsheet ID: ${spreadsheetId}`;
    if (context) prompt += `\nAdditional context: ${context}`;

    // Inject spreadsheet context if available from session
    if (spreadsheetId) {
      try {
        const sessionCtx = getSessionContext();
        const activeCtx = sessionCtx.getActiveSpreadsheet();
        if (
          activeCtx &&
          activeCtx.spreadsheetId === spreadsheetId &&
          activeCtx.sheetNames.length > 0
        ) {
          prompt += `\nSpreadsheet context:`;
          prompt += `\n- Sheets: ${activeCtx.sheetNames.join(', ')}`;
          prompt += `\nIMPORTANT: Use these exact sheet names (case-sensitive, including spaces and emoji) in your params.`;
        }
      } catch {
        // OK: Session context may not be initialized — skip enrichment
      }
    }

    const modelHint = getModelHint('agentPlanning');
    const result = await withSamplingTimeout(() =>
      samplingServer.createMessage({
        messages: [createUserMessage(prompt)],
        systemPrompt,
        maxTokens: 1500,
        modelPreferences: { hints: modelHint.hints },
        temperature: modelHint.temperature,
      })
    );

    const text = extractTextFromResult(result);
    if (!text) return undefined; // OK: LLM sampling may return empty on failure

    // Parse JSON from response, handling markdown code blocks
    const jsonStr = text
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) return undefined; // OK: Validation guard for LLM output format

    return parsed.slice(0, maxSteps || 10).map(
      (
        step: {
          tool?: string;
          action?: string;
          params?: Record<string, unknown>;
          description?: string;
        },
        i: number
      ) => ({
        stepId: `step-${i + 1}`,
        tool: String(step.tool || 'sheets_analyze'),
        action: String(step.action || 'comprehensive'),
        params: {
          ...(typeof step.params === 'object' && step.params ? step.params : {}),
          ...(spreadsheetId ? { spreadsheetId } : {}),
        },
        description: String(step.description || `Step ${i + 1}`),
        dependsOn: i > 0 ? [`step-${i}`] : undefined,
      })
    );
  } catch (err) {
    logger.debug('AI plan generation failed, falling back to regex', {
      description: description.slice(0, 100),
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return undefined;
  }
}

// ============================================================================
// Regex-Based Plan Parsing
// ============================================================================

/**
 * Parse natural language description into execution steps.
 * Supports common patterns like "read", "write", "format", "sort", etc.
 */
export function parseDescription(
  description: string
): Array<{ tool: string; action: string; label: string }> {
  const lower = description.toLowerCase();
  const steps: Array<{ tool: string; action: string; label: string }> = [];

  // Pattern matching for common operations
  const patterns: Array<{
    regex: RegExp;
    tool: string;
    action: string;
    label: string;
  }> = [
    {
      regex: /\b(read|get|fetch)\b/i,
      tool: 'sheets_data',
      action: 'read',
      label: 'Read data',
    },
    {
      regex: /\b(write|update|set|put)\b/i,
      tool: 'sheets_data',
      action: 'write',
      label: 'Write data',
    },
    {
      regex: /\b(format|style|color|bold|italic)\b/i,
      tool: 'sheets_format',
      action: 'set_format',
      label: 'Apply formatting',
    },
    {
      regex: /\b(sort|order|rank)\b/i,
      tool: 'sheets_dimensions',
      action: 'sort_range',
      label: 'Sort data',
    },
    {
      regex: /\b(chart|graph|plot|visualize)\b/i,
      tool: 'sheets_visualize',
      action: 'chart_create',
      label: 'Create chart',
    },
    {
      regex: /\b(delete|remove)\b/i,
      tool: 'sheets_dimensions',
      action: 'delete',
      label: 'Delete rows/columns',
    },
    {
      regex: /\b(freeze|pin)\b/i,
      tool: 'sheets_dimensions',
      action: 'freeze',
      label: 'Freeze rows/columns',
    },
    {
      regex: /\b(merge)\b/i,
      tool: 'sheets_data',
      action: 'merge_cells',
      label: 'Merge cells',
    },
    {
      regex: /\b(filter|filter view)\b/i,
      tool: 'sheets_dimensions',
      action: 'set_basic_filter',
      label: 'Apply filter',
    },
    {
      regex: /\b(analyze|summarize|summary)\b/i,
      tool: 'sheets_analyze',
      action: 'comprehensive',
      label: 'Analyze data',
    },
    {
      regex: /\b(compute|calculate|aggregate)\b/i,
      tool: 'sheets_analyze',
      action: 'analyze_data',
      label: 'Compute metrics',
    },
    {
      regex: /\b(clean|fix|repair|standardize)\b/i,
      tool: 'sheets_fix',
      action: 'clean',
      label: 'Clean data',
    },
  ];

  // Detect multiple operations
  for (const pattern of patterns) {
    if (pattern.regex.test(lower)) {
      steps.push(pattern);
    }
  }

  // Fallback: if no patterns matched, use comprehensive analysis
  if (steps.length === 0) {
    steps.push({
      tool: 'sheets_analyze',
      action: 'comprehensive',
      label: 'Analyze data',
    });
  }

  return steps;
}

// ============================================================================
// Public Compilation API
// ============================================================================

/**
 * Compile a natural language description into a plan using AI if available.
 * Tries AI-powered planning first, falls back to regex-based planning if AI unavailable or fails.
 * Returns PlanState in 'draft' status with generated steps.
 */
export async function compilePlanAI(
  description: string,
  maxSteps: number = 10,
  spreadsheetId?: string,
  context?: string
): Promise<PlanState> {
  const planId = randomUUID();
  const now = new Date().toISOString();

  // Try AI-powered planning first
  let steps: ExecutionStep[] | undefined;
  try {
    const aiSteps = await aiParsePlan(description, spreadsheetId, context, maxSteps);
    if (aiSteps && aiSteps.length > 0) {
      steps = aiSteps;
    }
  } catch (err) {
    logger.debug('AI plan compilation error', {
      description: description.slice(0, 100),
      reason: err instanceof Error ? err.message : 'unknown',
    });
  }

  // Fall back to regex-based planning if AI failed
  if (!steps || steps.length === 0) {
    const parsedSteps = parseDescription(description).slice(0, maxSteps);
    steps = parsedSteps.map((step, idx) => ({
      stepId: `${planId}-step-${idx}`,
      tool: step.tool,
      action: step.action,
      description: step.label,
      params: {
        ...(spreadsheetId && { spreadsheetId }),
        ...(context && { context }),
      },
    }));
  }

  const plan = buildPlanState({
    planId,
    description,
    steps,
    now,
    spreadsheetId,
    planningContextSummary: summarizePlanningContext(context),
  });

  evictOldestPlan();
  planStore.set(planId, plan);
  persistPlan(plan).catch((err: unknown) => {
    logger.warn('Failed to persist plan state', { planId: plan.planId, error: err });
  });

  return plan;
}

/**
 * Compile a natural language description into a plan (regex-based only).
 * Returns PlanState in 'draft' status with generated steps.
 * Use compilePlanAI() for AI-powered planning that falls back to regex.
 */
export function compilePlan(
  description: string,
  maxSteps: number = 10,
  spreadsheetId?: string,
  context?: string
): PlanState {
  const planId = randomUUID();
  const now = new Date().toISOString();

  const parsedSteps = parseDescription(description).slice(0, maxSteps);

  const steps: ExecutionStep[] = parsedSteps.map((step, idx) => ({
    stepId: `${planId}-step-${idx}`,
    tool: step.tool,
    action: step.action,
    description: step.label,
    params: {
      ...(spreadsheetId && { spreadsheetId }),
      ...(context && { context }),
    },
  }));

  const plan = buildPlanState({
    planId,
    description,
    steps,
    now,
    spreadsheetId,
    planningContextSummary: summarizePlanningContext(context),
  });

  evictOldestPlan();
  planStore.set(planId, plan);
  persistPlan(plan).catch((err: unknown) => {
    logger.warn('Failed to persist plan state', { planId: plan.planId, error: err });
  });

  return plan;
}

/**
 * Compile a plan from a pre-built workflow template.
 * Returns PlanState in 'draft' status with template steps.
 */
export function compileFromTemplate(
  templateName: string,
  spreadsheetId: string,
  overrides?: Record<string, unknown>
): PlanState | undefined {
  const template: WorkflowTemplate | undefined = WORKFLOW_TEMPLATES[templateName];
  if (!template) return undefined;

  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const steps: ExecutionStep[] = template.steps.map((step, i) => {
    const base = {
      stepId: `step-${i + 1}`,
      dependsOn: i > 0 ? [`step-${i}`] : undefined,
    };
    if (step.type === 'inject_cross_sheet_lookup') {
      return {
        ...base,
        tool: '__internal__',
        action: 'inject_cross_sheet_lookup',
        type: 'inject_cross_sheet_lookup' as const,
        description: step.description ?? 'Inject cross-sheet XLOOKUP formulas',
        params: { spreadsheetId },
        config: step.config as Record<string, unknown>,
      };
    }
    return {
      ...base,
      tool: step.tool,
      action: step.action,
      description: step.description,
      params: { spreadsheetId, ...step.paramTemplate, ...(overrides || {}) },
    };
  });

  const now = new Date().toISOString();
  const plan = buildPlanState({
    planId,
    description: `${template.name}: ${template.description}`,
    steps,
    now,
    spreadsheetId,
    planningContextSummary: template.description,
  });

  if (planStore.size >= MAX_PLANS) evictOldestPlan();
  planStore.set(planId, plan);
  persistPlan(plan).catch((err: unknown) => {
    logger.warn('Failed to persist plan state', { planId: plan.planId, error: err });
  });

  return plan;
}

/**
 * List all available workflow templates with their metadata.
 */
export function listTemplates(): Array<{
  name: string;
  description: string;
  stepCount: number;
}> {
  return Object.entries(WORKFLOW_TEMPLATES).map(([_key, t]) => ({
    name: t.name,
    description: t.description,
    stepCount: t.steps.length,
  }));
}
