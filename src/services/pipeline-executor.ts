/**
 * ServalSheets — Pipeline Executor (P16 Phase 7)
 *
 * DAG-based parallel/sequential execution of multi-step tool sequences.
 * READ steps within an execution wave run in parallel; WRITE steps run
 * sequentially to prevent data races.
 *
 * Execution model:
 *   1. Build execution waves via Kahn's topological sort on `dependsOn` edges.
 *   2. Within each wave: if ALL steps are READ → parallel; otherwise sequential.
 *   3. On failure: fail-fast by default, mark remaining steps as 'skipped'.
 *   4. No automatic rollback — caller is responsible (use sheets_history.undo).
 */

import { ValidationError } from '../core/errors.js';

// ============================================================================
// Public types
// ============================================================================

/** Function signature for dispatching a single tool call. */
export type ToolDispatch = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface PipelineStep {
  /** Unique identifier — referenced by other steps' `dependsOn`. */
  id: string;
  /** Tool name (e.g. `sheets_data`, `sheets_format`). */
  tool: string;
  /** Action within the tool (e.g. `read`, `write`, `set_format`). */
  action: string;
  /** Tool parameters, excluding `action` (added automatically). */
  params: Record<string, unknown>;
  /** IDs of steps that must complete successfully before this step runs. */
  dependsOn?: string[];
}

export interface PipelineOptions {
  /** Stop execution on first error. Default: `true`. */
  failFast?: boolean;
}

export interface PipelineStepResult {
  id: string;
  tool: string;
  action: string;
  status: 'success' | 'error' | 'skipped';
  /** Handler response on success. */
  result?: unknown;
  /** Error message on failure. */
  error?: string;
  /** Wall-clock duration of this step in milliseconds. */
  durationMs: number;
}

export interface PipelineResult {
  success: boolean;
  stepsCompleted: number;
  stepsTotal: number;
  results: PipelineStepResult[];
  /** ID of the step where the pipeline first failed (if any). */
  failedAt?: string;
  /** Total wall-clock duration in milliseconds. */
  durationMs: number;
}

// ============================================================================
// READ / WRITE classification
// ============================================================================

/**
 * Action name prefixes indicating read-only operations (safe to parallelise).
 * Conservative: anything not matching is treated as a WRITE.
 */
const READ_PREFIXES: readonly string[] = [
  'get_',
  'list_',
  'read',
  'batch_read',
  'batch_get',
  'find_',
  'analyze_',
  'analyze',
  'search',
  'detect_',
  'suggest_',
  'preview_',
  'scout',
  'status',
  'diff_',
  'export_dot',
  'query_',
];

/** Exact action names that are read-only (don't match any prefix above). */
const READ_EXACT = new Set<string>([
  'build',
  'get',
  'list',
  'read',
  'find',
  'scout',
  'status',
  'comprehensive',
  'drill_down',
  'explain_analysis',
  'suggest_visualization',
  'export_dot',
  'get_stats',
  'get_context',
  'get_active',
  'get_last_operation',
  'get_history',
  'find_by_reference',
  'get_preferences',
  'get_pending',
  'list_checkpoints',
  'get_alerts',
  'get_profile',
  'get_top_formulas',
]);

function classifyStep(action: string): 'read' | 'write' {
  if (READ_EXACT.has(action)) return 'read';
  for (const prefix of READ_PREFIXES) {
    if (action.startsWith(prefix)) return 'read';
  }
  return 'write';
}

// ============================================================================
// DAG (topological sort → execution waves)
// ============================================================================

/**
 * Builds execution waves using Kahn's algorithm.
 * Each wave contains steps that can begin once all previous waves complete.
 * Throws if an unknown dependency ID is referenced or a cycle is detected.
 */
function buildExecutionWaves(steps: PipelineStep[]): PipelineStep[][] {
  if (steps.length === 0) return [];

  const stepMap = new Map<string, PipelineStep>(steps.map((s) => [s.id, s]));

  // Validate dependency references
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!stepMap.has(dep)) {
        throw new ValidationError(
          `Step "${step.id}" depends on unknown step "${dep}"`,
          'dependsOn'
        );
      }
      if (dep === step.id) {
        throw new ValidationError(`Step "${step.id}" depends on itself`, 'dependsOn');
      }
    }
  }

  // Build reverse adjacency: dep → [steps that depend on it]
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const step of steps) {
    inDegree.set(step.id, step.dependsOn?.length ?? 0);
    dependents.set(step.id, dependents.get(step.id) ?? []);
    for (const dep of step.dependsOn ?? []) {
      const arr = dependents.get(dep) ?? [];
      arr.push(step.id);
      dependents.set(dep, arr);
    }
  }

  const waves: PipelineStep[][] = [];
  const remaining = new Set(steps.map((s) => s.id));

  while (remaining.size > 0) {
    const wave: PipelineStep[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        wave.push(stepMap.get(id)!);
      }
    }
    if (wave.length === 0) {
      throw new ValidationError(
        'Cycle detected in pipeline — check dependsOn references',
        'dependsOn'
      );
    }
    waves.push(wave);
    for (const step of wave) {
      remaining.delete(step.id);
      for (const dependent of dependents.get(step.id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 0) - 1);
      }
    }
  }

  return waves;
}

// ============================================================================
// PipelineExecutor
// ============================================================================

export class PipelineExecutor {
  constructor(private dispatch: ToolDispatch) {}

  async executePipeline(
    steps: PipelineStep[],
    options: PipelineOptions = {}
  ): Promise<PipelineResult> {
    const { failFast = true } = options;
    const pipelineStart = Date.now();

    if (steps.length === 0) {
      return {
        success: true,
        stepsCompleted: 0,
        stepsTotal: 0,
        results: [],
        durationMs: 0,
      };
    }

    // Validate step IDs are unique
    const ids = new Set<string>();
    for (const step of steps) {
      if (ids.has(step.id)) {
        return {
          success: false,
          stepsCompleted: 0,
          stepsTotal: steps.length,
          results: [],
          failedAt: `duplicate step id: "${step.id}"`,
          durationMs: Date.now() - pipelineStart,
        };
      }
      ids.add(step.id);
    }

    // Build execution waves (topological sort)
    let waves: PipelineStep[][];
    try {
      waves = buildExecutionWaves(steps);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        stepsCompleted: 0,
        stepsTotal: steps.length,
        results: [],
        failedAt: msg,
        durationMs: Date.now() - pipelineStart,
      };
    }

    const results: PipelineStepResult[] = [];
    let failedAt: string | undefined;
    let failed = false;

    for (const wave of waves) {
      if (failed) {
        // Mark all steps in remaining waves as skipped
        for (const step of wave) {
          results.push({
            id: step.id,
            tool: step.tool,
            action: step.action,
            status: 'skipped',
            durationMs: 0,
          });
        }
        continue;
      }

      // Parallelise if every step in this wave is a READ
      const allRead = wave.every((s) => classifyStep(s.action) === 'read');

      if (allRead && wave.length > 1) {
        const waveResults = await Promise.all(wave.map((s) => this.executeStep(s)));
        results.push(...waveResults);
        const firstFailure = waveResults.find((r) => r.status === 'error');
        if (firstFailure && failFast) {
          failed = true;
          failedAt = firstFailure.id;
        }
      } else {
        for (const step of wave) {
          const result = await this.executeStep(step);
          results.push(result);
          if (result.status === 'error' && failFast) {
            failed = true;
            failedAt = step.id;
            break;
          }
        }
      }
    }

    return {
      success: !failed,
      stepsCompleted: results.filter((r) => r.status === 'success').length,
      stepsTotal: steps.length,
      results,
      ...(failedAt ? { failedAt } : {}),
      durationMs: Date.now() - pipelineStart,
    };
  }

  private async executeStep(step: PipelineStep): Promise<PipelineStepResult> {
    const start = Date.now();
    try {
      const result = await this.dispatch(step.tool, {
        request: { action: step.action, ...step.params },
      });
      return {
        id: step.id,
        tool: step.tool,
        action: step.action,
        status: 'success',
        result,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        id: step.id,
        tool: step.tool,
        action: step.action,
        status: 'error',
        error: msg,
        durationMs: Date.now() - start,
      };
    }
  }
}
