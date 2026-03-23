/**
 * Self-Healing Error Recovery Engine
 *
 * Orchestrates error recovery by combining:
 * 1. Pattern-based fixes (error-fix-suggester.ts) — instant, deterministic
 * 2. Learned fixes (error-pattern-learner.ts) — success-rate weighted
 * 3. Error-code-specific recovery strategies — contextual guidance
 *
 * Returns structured recovery actions with executable params,
 * populating `fixableVia`, `alternatives`, and `resolutionSteps`
 * on ErrorDetail responses.
 *
 * @module services/recovery-engine
 */

import { logger } from '../utils/logger.js';
import { suggestFix, type SuggestedFix } from './error-fix-suggester.js';
import { getErrorPatternLearner } from './error-pattern-learner.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecoveryAction {
  tool: string;
  action: string;
  params: Record<string, unknown>;
  description: string;
  confidence: number;
  /** Whether this action can be auto-retried vs needs user confirmation */
  automatic: boolean;
}

export interface RecoveryResult {
  /** Primary fix — ready to execute (maps to `fixableVia` on ErrorDetail) */
  primaryFix: RecoveryAction | null;
  /** Alternative approaches (maps to `alternatives` on ErrorDetail) */
  alternatives: Array<{ tool: string; action: string; description: string }>;
  /** Step-by-step guidance (maps to `resolutionSteps` on ErrorDetail) */
  resolutionSteps: string[];
  /** Suggested tools for the LLM to consider */
  suggestedTools: string[];
}

export interface RecoveryContext {
  toolName?: string;
  actionName?: string;
  spreadsheetId?: string;
  params?: Record<string, unknown>;
}

// ─── Recovery Strategy Map ───────────────────────────────────────────────────
// Maps error codes to contextual recovery strategies beyond what suggestFix covers

interface RecoveryStrategy {
  resolutionSteps: string[];
  alternatives: Array<{ tool: string; action: string; description: string }>;
  suggestedTools: string[];
  /** Auto-retryable without user interaction */
  autoRetryable: boolean;
}

const RECOVERY_STRATEGIES: Record<string, (ctx: RecoveryContext) => RecoveryStrategy> = {
  QUOTA_EXCEEDED: (ctx) => ({
    resolutionSteps: [
      'Wait 60 seconds for quota to reset',
      'Reduce batch size or use pagination',
      'Switch to minimal verbosity to reduce payload size',
      'Use sheets_composite.batch_operations to combine multiple calls',
    ],
    alternatives: [
      {
        tool: 'sheets_session',
        action: 'get_context',
        description: 'Check current quota usage and estimate remaining capacity',
      },
      ...(ctx.actionName === 'read' || ctx.actionName === 'batch_read'
        ? [
            {
              tool: 'sheets_data',
              action: 'read',
              description: 'Retry with a smaller range or add pagination (pageSize)',
            },
          ]
        : []),
    ],
    suggestedTools: ['sheets_session', 'sheets_composite'],
    autoRetryable: true,
  }),

  RATE_LIMITED: (_ctx) => ({
    resolutionSteps: [
      'Wait for the retryAfterMs duration before retrying',
      'Reduce concurrent operations',
      'Use batch operations to combine multiple API calls',
    ],
    alternatives: [
      {
        tool: 'sheets_composite',
        action: 'batch_operations',
        description: 'Combine multiple operations into a single batch call',
      },
    ],
    suggestedTools: ['sheets_composite', 'sheets_transaction'],
    autoRetryable: true,
  }),

  PERMISSION_DENIED: (_ctx) => ({
    resolutionSteps: [
      'Check current access level with sheets_collaborate.share_list',
      'Request access from the spreadsheet owner',
      'Re-authenticate if token may have expired',
    ],
    alternatives: [
      {
        tool: 'sheets_collaborate',
        action: 'share_list',
        description: 'List current sharing permissions to verify access level',
      },
      { tool: 'sheets_auth', action: 'status', description: 'Check authentication status' },
      { tool: 'sheets_auth', action: 'login', description: 'Re-authenticate with fresh token' },
    ],
    suggestedTools: ['sheets_collaborate', 'sheets_auth'],
    autoRetryable: false,
  }),

  INSUFFICIENT_PERMISSIONS: (_ctx) => ({
    resolutionSteps: [
      'The current OAuth scopes are insufficient for this operation',
      'Re-authenticate with broader scopes using sheets_auth.login',
      'Some operations require Drive or BigQuery scopes',
    ],
    alternatives: [
      {
        tool: 'sheets_auth',
        action: 'login',
        description: 'Re-authenticate with required scopes',
      },
      {
        tool: 'sheets_auth',
        action: 'status',
        description: 'Check current OAuth scopes',
      },
    ],
    suggestedTools: ['sheets_auth'],
    autoRetryable: false,
  }),

  SPREADSHEET_NOT_FOUND: (_ctx) => ({
    resolutionSteps: [
      'Verify the spreadsheet ID is correct',
      'List recent spreadsheets to find the correct ID',
      'Check if the spreadsheet was deleted or moved to trash',
    ],
    alternatives: [
      {
        tool: 'sheets_core',
        action: 'list',
        description: 'List accessible spreadsheets to find the correct ID',
      },
      {
        tool: 'sheets_session',
        action: 'get_active',
        description: 'Check if a different spreadsheet is currently active',
      },
    ],
    suggestedTools: ['sheets_core', 'sheets_session'],
    autoRetryable: false,
  }),

  SHEET_NOT_FOUND: (ctx) => ({
    resolutionSteps: [
      'List all sheets in the spreadsheet to find the correct name',
      'Sheet names are case-sensitive — verify exact spelling',
      'The sheet may have been renamed or deleted',
    ],
    alternatives: [
      {
        tool: 'sheets_core',
        action: 'list_sheets',
        description: 'List all sheets to find the correct name',
      },
      ...(ctx.spreadsheetId
        ? [
            {
              tool: 'sheets_analyze',
              action: 'scout',
              description: 'Quick scan to see all sheet names and structure',
            },
          ]
        : []),
    ],
    suggestedTools: ['sheets_core', 'sheets_analyze'],
    autoRetryable: false,
  }),

  INVALID_RANGE: (_ctx) => ({
    resolutionSteps: [
      'Verify the range uses valid A1 notation (e.g., Sheet1!A1:D10)',
      'Avoid unbounded ranges like A:Z — add row bounds (A1:Z1000)',
      'Check that the sheet name in the range exists',
      'Ensure column letters and row numbers are within sheet dimensions',
    ],
    alternatives: [
      {
        tool: 'sheets_core',
        action: 'list_sheets',
        description: 'Verify sheet names and dimensions',
      },
      {
        tool: 'sheets_analyze',
        action: 'scout',
        description: 'Scan spreadsheet structure to find valid ranges',
      },
    ],
    suggestedTools: ['sheets_core', 'sheets_analyze'],
    autoRetryable: false,
  }),

  RANGE_NOT_FOUND: (_ctx) => ({
    resolutionSteps: [
      'The specified range does not exist in the spreadsheet',
      'List sheets to verify the sheet name is correct',
      'Use scout to understand the data layout',
    ],
    alternatives: [
      {
        tool: 'sheets_core',
        action: 'list_sheets',
        description: 'List sheets and their dimensions',
      },
      {
        tool: 'sheets_analyze',
        action: 'scout',
        description: 'Quick metadata scan to find data ranges',
      },
    ],
    suggestedTools: ['sheets_core', 'sheets_analyze'],
    autoRetryable: false,
  }),

  FORMULA_ERROR: (_ctx) => ({
    resolutionSteps: [
      'Use diagnose_errors to identify the root cause of formula failures',
      'Check for circular references or missing references',
      'Verify referenced cells exist and contain expected data types',
    ],
    alternatives: [
      {
        tool: 'sheets_analyze',
        action: 'diagnose_errors',
        description: 'Diagnose formula errors with dependency chain analysis',
      },
      {
        tool: 'sheets_analyze',
        action: 'analyze_formulas',
        description: 'Analyze all formulas in the spreadsheet for issues',
      },
    ],
    suggestedTools: ['sheets_analyze'],
    autoRetryable: false,
  }),

  CIRCULAR_REFERENCE: (_ctx) => ({
    resolutionSteps: [
      'A circular reference was detected in formulas',
      'Use dependency graph to identify the cycle',
      'Break the cycle by modifying one of the formulas in the chain',
    ],
    alternatives: [
      {
        tool: 'sheets_dependencies',
        action: 'detect_cycles',
        description: 'Identify all circular reference cycles in formulas',
      },
      {
        tool: 'sheets_dependencies',
        action: 'build',
        description: 'Build full dependency graph to visualize relationships',
      },
    ],
    suggestedTools: ['sheets_dependencies'],
    autoRetryable: false,
  }),

  PROTECTED_RANGE: (_ctx) => ({
    resolutionSteps: [
      'The target range is protected and cannot be modified',
      'Check protection settings to see who has edit access',
      'Contact the sheet owner to modify protection or grant access',
    ],
    alternatives: [
      {
        tool: 'sheets_advanced',
        action: 'list_protected_ranges',
        description: 'List all protected ranges and their editors',
      },
    ],
    suggestedTools: ['sheets_advanced', 'sheets_collaborate'],
    autoRetryable: false,
  }),

  BATCH_UPDATE_ERROR: (_ctx) => ({
    resolutionSteps: [
      'One or more operations in the batch failed',
      'Review the error details for the specific failing operation',
      'Try breaking the batch into smaller chunks',
      'Ensure all ranges and sheet references are valid before batching',
    ],
    alternatives: [
      {
        tool: 'sheets_analyze',
        action: 'scout',
        description: 'Verify spreadsheet structure before retrying batch',
      },
      {
        tool: 'sheets_quality',
        action: 'validate',
        description: 'Validate data before batch write',
      },
    ],
    suggestedTools: ['sheets_analyze', 'sheets_quality', 'sheets_composite'],
    autoRetryable: false,
  }),

  TRANSACTION_ERROR: (_ctx) => ({
    resolutionSteps: [
      'The transaction encountered an error',
      'Check if the transaction expired (default timeout)',
      'Roll back and retry with a fresh transaction',
    ],
    alternatives: [
      {
        tool: 'sheets_transaction',
        action: 'rollback',
        description: 'Roll back the failed transaction to restore previous state',
      },
      {
        tool: 'sheets_transaction',
        action: 'status',
        description: 'Check current transaction status',
      },
    ],
    suggestedTools: ['sheets_transaction'],
    autoRetryable: false,
  }),

  DEADLINE_EXCEEDED: (ctx) => ({
    resolutionSteps: [
      'The operation timed out before completing',
      'Try with a smaller data range or fewer operations',
      'Use pagination to process data in chunks',
    ],
    alternatives: [
      {
        tool: ctx.toolName || 'sheets_data',
        action: ctx.actionName || 'read',
        description: 'Retry with a smaller range or added pagination',
      },
    ],
    suggestedTools: ['sheets_composite'],
    autoRetryable: true,
  }),

  UNAVAILABLE: (_ctx) => ({
    resolutionSteps: [
      'Google Sheets API is temporarily unavailable',
      'Wait 30-60 seconds and retry',
      'Check Google Workspace Status Dashboard for outages',
    ],
    alternatives: [],
    suggestedTools: [],
    autoRetryable: true,
  }),

  CONNECTION_ERROR: (_ctx) => ({
    resolutionSteps: [
      'Network connection failed — check internet connectivity',
      'The Google API endpoint may be temporarily unreachable',
      'Retry after a brief wait (30 seconds)',
    ],
    alternatives: [],
    suggestedTools: [],
    autoRetryable: true,
  }),

  DUPLICATE_SHEET_NAME: (_ctx) => ({
    resolutionSteps: [
      'A sheet with this name already exists',
      'Choose a unique name or append a suffix',
      'List existing sheets to see current names',
    ],
    alternatives: [
      {
        tool: 'sheets_core',
        action: 'list_sheets',
        description: 'List existing sheet names to pick a unique name',
      },
    ],
    suggestedTools: ['sheets_core'],
    autoRetryable: false,
  }),

  PARTIAL_FAILURE: (_ctx) => ({
    resolutionSteps: [
      'A batch operation was halted mid-execution',
      'Check partialResult.results for operations that completed successfully',
      'Fix the failing operation and retry only the remaining operations',
    ],
    alternatives: [
      {
        tool: 'sheets_composite',
        action: 'batch_operations',
        description: 'Retry remaining operations (skip already-completed ones)',
      },
    ],
    suggestedTools: ['sheets_composite'],
    autoRetryable: false,
  }),

  SNAPSHOT_CREATION_FAILED: (_ctx) => ({
    resolutionSteps: [
      'Could not create a safety snapshot before the mutation',
      'Verify you have read access to the target range',
      'The range may be too large — try a smaller scope',
      'You can bypass snapshot with safety.skipSnapshot: true (use with caution)',
    ],
    alternatives: [
      {
        tool: 'sheets_data',
        action: 'read',
        description: 'Verify you can read the target range before mutating',
      },
    ],
    suggestedTools: ['sheets_data', 'sheets_history'],
    autoRetryable: false,
  }),

  ELICITATION_UNAVAILABLE: (ctx) => ({
    resolutionSteps: [
      'Interactive confirmation is unavailable in this client',
      'Use sheets_confirm.wizard_start to start an interactive wizard instead',
      'Or pass safety.confirmed: true to skip confirmation prompts',
      'Or use a client that supports MCP Elicitation (SEP-1036)',
    ],
    alternatives: [
      {
        tool: 'sheets_confirm',
        action: 'wizard_start',
        description: 'Start interactive wizard as alternative to elicitation',
      },
      {
        tool: ctx.toolName || 'sheets_data',
        action: ctx.actionName || 'read',
        description: 'Retry with safety.confirmed: true to bypass confirmation',
      },
    ],
    suggestedTools: ['sheets_confirm'],
    autoRetryable: false,
  }),
};

// ─── Recovery Engine ─────────────────────────────────────────────────────────

/**
 * Suggest recovery actions for a failed tool call.
 *
 * Combines three sources:
 * 1. Pattern-based fixes (deterministic, instant) — `error-fix-suggester.ts`
 * 2. Learned fixes (success-rate weighted) — `error-pattern-learner.ts`
 * 3. Error-code strategies (contextual guidance) — recovery strategy map
 */
export function suggestRecovery(
  errorCode: string,
  errorMessage: string,
  context: RecoveryContext
): RecoveryResult {
  const result: RecoveryResult = {
    primaryFix: null,
    alternatives: [],
    resolutionSteps: [],
    suggestedTools: [],
  };

  try {
    // ── Source 1: Pattern-based fix (instant, deterministic) ──────────────
    const patternFix: SuggestedFix | null = suggestFix(
      errorCode,
      errorMessage,
      context.toolName,
      context.actionName,
      context.params
    );

    if (patternFix) {
      result.primaryFix = {
        tool: patternFix.tool,
        action: patternFix.action,
        params: patternFix.params,
        description: patternFix.explanation,
        confidence: 0.8,
        automatic: isAutoRetryableCode(errorCode),
      };
    }

    // ── Source 2: Learned fix (success-rate weighted) ─────────────────────
    try {
      const learner = getErrorPatternLearner();
      const learnedFix = learner.suggestFix(errorCode, {
        tool: context.toolName,
        action: context.actionName,
        spreadsheetId: context.spreadsheetId,
      });

      if (learnedFix && learnedFix.fix) {
        // If no pattern fix, promote learned fix to primary
        if (!result.primaryFix) {
          result.primaryFix = {
            tool: context.toolName || 'sheets_data',
            action: context.actionName || 'read',
            params: context.params || {},
            description: learnedFix.fix,
            confidence: learnedFix.successRate ?? 0.5,
            automatic: false,
          };
        } else {
          // Add as alternative
          result.alternatives.push({
            tool: context.toolName || 'sheets_data',
            action: context.actionName || 'read',
            description: `Learned fix (${Math.round((learnedFix.successRate ?? 0.5) * 100)}% success rate): ${learnedFix.fix}`,
          });
        }
      }
    } catch {
      // Non-blocking: learned suggestions are best-effort
    }

    // ── Source 3: Error-code recovery strategy ───────────────────────────
    const strategyFn = RECOVERY_STRATEGIES[errorCode];
    if (strategyFn) {
      const strategy = strategyFn(context);
      result.resolutionSteps = strategy.resolutionSteps;
      result.suggestedTools = strategy.suggestedTools;

      // Merge alternatives (avoid duplicates by tool+action)
      const existingKeys = new Set(result.alternatives.map((a) => `${a.tool}.${a.action}`));
      for (const alt of strategy.alternatives) {
        const key = `${alt.tool}.${alt.action}`;
        if (!existingKeys.has(key)) {
          result.alternatives.push(alt);
          existingKeys.add(key);
        }
      }

      // If no primary fix yet, promote first alternative with params
      if (!result.primaryFix && strategy.alternatives.length > 0) {
        const first = strategy.alternatives[0]!;
        const primaryParams: Record<string, unknown> = context.spreadsheetId
          ? { spreadsheetId: context.spreadsheetId }
          : {};
        if (first.tool === 'sheets_confirm' && first.action === 'wizard_start') {
          primaryParams['title'] = 'Confirm operation';
        }
        result.primaryFix = {
          tool: first.tool,
          action: first.action,
          params: primaryParams,
          description: first.description,
          confidence: 0.6,
          automatic: strategy.autoRetryable,
        };
      }
    }

    // ── Limit alternatives to 5 ──────────────────────────────────────────
    if (result.alternatives.length > 5) {
      result.alternatives = result.alternatives.slice(0, 5);
    }

    // ── Deduplicate suggestedTools ───────────────────────────────────────
    result.suggestedTools = [...new Set(result.suggestedTools)];
  } catch (err) {
    logger.debug('RecoveryEngine.suggestRecovery threw, returning empty result', { error: err });
  }

  return result;
}

/**
 * Merge recovery result into an error detail object (in-place mutation).
 *
 * Populates: fixableVia, alternatives, resolutionSteps, suggestedTools
 * Only sets fields that are not already populated by the handler.
 */
export function applyRecoveryToError(
  error: Record<string, unknown>,
  recovery: RecoveryResult
): void {
  // fixableVia — primary automated fix
  if (recovery.primaryFix && !error['fixableVia']) {
    error['fixableVia'] = {
      tool: recovery.primaryFix.tool,
      action: recovery.primaryFix.action,
      params: recovery.primaryFix.params,
    };
  }

  // alternatives — other approaches
  if (recovery.alternatives.length > 0 && !error['alternatives']) {
    error['alternatives'] = recovery.alternatives;
  }

  // resolutionSteps — step-by-step guidance
  if (recovery.resolutionSteps.length > 0 && !error['resolutionSteps']) {
    error['resolutionSteps'] = recovery.resolutionSteps;
  }

  // suggestedTools — tools the LLM should consider
  if (recovery.suggestedTools.length > 0 && !error['suggestedTools']) {
    error['suggestedTools'] = recovery.suggestedTools;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AUTO_RETRYABLE_CODES = new Set([
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'RESOURCE_EXHAUSTED',
  'DEADLINE_EXCEEDED',
  'UNAVAILABLE',
  'CONNECTION_ERROR',
]);

function isAutoRetryableCode(code: string): boolean {
  return AUTO_RETRYABLE_CODES.has(code);
}
