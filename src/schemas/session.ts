/**
 * ServalSheets - Session Tool Schema
 *
 * Tool for managing conversation-level context.
 * Enables natural language references like "the spreadsheet", "undo that", etc.
 *
 * @module schemas/session
 */

import { z } from 'zod';
import { RangeInputSchema } from './shared.js';
import type { ToolAnnotations } from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
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

const SetActiveActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_active').describe('Set the active spreadsheet for natural references'),
  spreadsheetId: z
    .string()
    .describe(
      'Spreadsheet ID from the Google Sheets URL (the long alphanumeric string between /d/ and /edit). ' +
        'Setting this enables natural references like "the spreadsheet" or "this sheet" in subsequent calls. ' +
        'Example: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"'
    ),
  title: z
    .string()
    .optional()
    .describe(
      'Human-readable title for natural language references like "my budget" or "Q1 report". ' +
        'Optional — fetched from the API if not provided. ' +
        'Example: "Q1 2026 Sales Report"'
    ),
  sheetNames: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      'Names of the sheets (tabs) in this spreadsheet. Used to resolve references like "the Revenue sheet". ' +
        'Optional — fetched from the API if not provided. ' +
        'Example: ["Sheet1", "Revenue", "Costs", "Summary"]'
    ),
});

const GetActiveActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_active').describe('Get the currently active spreadsheet'),
});

const GetContextActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_context').describe('Get full conversation context with suggestions'),
});

const RecordOperationActionSchema = CommonFieldsSchema.extend({
  action: z.literal('record_operation').describe('Record a completed operation for undo support'),
  tool: z.string().describe('Tool that was called'),
  toolAction: z.string().describe('Action within the tool'),
  spreadsheetId: z.string().describe('Spreadsheet ID affected'),
  description: z
    .string()
    .min(1, 'Description cannot be empty')
    .max(1000, 'Description exceeds 1000 character limit')
    .describe('Human-readable description (max 1000 chars)'),
  undoable: z
    .boolean()
    .default(true)
    .describe('Whether this operation can be undone (default: true)'),
  range: RangeInputSchema.optional().describe('Range affected'),
  snapshotId: z.string().optional().describe('Snapshot ID if created for rollback'),
  cellsAffected: z.coerce.number().optional().describe('Number of cells affected'),
});

const GetLastOperationActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_last_operation').describe('Get the most recent operation'),
});

const GetHistoryActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_history').describe('Get operation history'),
  limit: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(10)
    .describe('Max operations to return (default: 10, max: 20)'),
});

const FindByReferenceActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('find_by_reference')
    .describe('Find spreadsheet or operation by natural language reference'),
  reference: z
    .string()
    .min(1, 'Reference cannot be empty')
    .max(500, 'Reference exceeds 500 character limit')
    .describe(
      'Natural language reference like "that", "the budget", "the last write" (max 500 chars)'
    ),
  referenceType: z
    .enum(['spreadsheet', 'operation'])
    .default('spreadsheet')
    .describe('What to find: spreadsheet or operation (default: spreadsheet)'),
});

const UpdatePreferencesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_preferences').describe('Update user preferences'),
  confirmationLevel: z
    .enum(['always', 'destructive', 'never'])
    .optional()
    .describe('When to ask for confirmation (always, destructive, or never)'),
  dryRunDefault: z.boolean().optional().describe('Default dry run setting'),
  snapshotDefault: z.boolean().optional().describe('Default snapshot setting'),
});

const GetPreferencesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_preferences').describe('Get current user preferences'),
});

const SetPendingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_pending').describe('Set pending multi-step operation state'),
  type: z
    .string()
    .optional()
    .default('general')
    .describe('Type of pending operation (default: "general")'),
  step: z
    .preprocess((val) => (val === undefined || val === null ? 1 : Number(val)), z.number())
    .describe('Current step number (default: 1)'),
  totalSteps: z
    .preprocess((val) => (val === undefined || val === null ? 1 : Number(val)), z.number())
    .describe('Total number of steps (default: 1)'),
  context: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    )
    .optional()
    .default({})
    .describe('Operation context data (string, number, boolean, null, array, or object)'),
});

const GetPendingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_pending').describe('Get pending multi-step operation state'),
});

const ClearPendingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('clear_pending').describe('Clear pending multi-step operation state'),
});

const SaveCheckpointActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('save_checkpoint')
    .describe('Save session state for resuming after context reset'),
  sessionId: z
    .string()
    .describe(
      'Unique identifier for this session checkpoint. Choose a descriptive name so you can resume it later. ' +
        'Must be consistent across save and load calls. ' +
        'Example: "quarterly-review-2026-03" or "budget-update-session"'
    ),
  description: z
    .string()
    .optional()
    .describe(
      'Human-readable description of what work this checkpoint captures. ' +
        'Helps identify the right checkpoint when listing them. ' +
        'Example: "After updating Q1 revenue formulas, before formatting pass"'
    ),
});

const LoadCheckpointActionSchema = CommonFieldsSchema.extend({
  action: z.literal('load_checkpoint').describe('Load and resume from a saved checkpoint'),
  sessionId: z
    .string()
    .describe(
      'Session identifier to resume — must match the sessionId used in save_checkpoint. ' +
        'Use list_checkpoints to see available sessions. ' +
        'Example: "quarterly-review-2026-03"'
    ),
  timestamp: z.coerce
    .number()
    .optional()
    .describe(
      'Unix timestamp (ms) of the specific checkpoint to restore. ' +
        'Omit to load the most recent checkpoint for this sessionId. ' +
        'Use list_checkpoints to see available timestamps.'
    ),
});

const ListCheckpointsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_checkpoints').describe('List available checkpoints'),
  sessionId: z
    .string()
    .optional()
    .describe(
      'Filter checkpoints by session ID. Omit to list checkpoints for all sessions. ' +
        'Example: "quarterly-review-2026-03"'
    ),
});

const DeleteCheckpointActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_checkpoint').describe('Delete checkpoint(s)'),
  sessionId: z
    .string()
    .describe(
      'Session ID whose checkpoints to delete. All checkpoints for this session are deleted unless timestamp is specified. ' +
        'Example: "quarterly-review-2026-03"'
    ),
  timestamp: z.coerce
    .number()
    .optional()
    .describe(
      'Unix timestamp (ms) of the specific checkpoint to delete. ' +
        'Omit to delete all checkpoints for the given sessionId.'
    ),
});

const ResetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('reset').describe('Reset session context to initial state'),
});

const GetAlertsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_alerts').describe('Get alerts for proactive monitoring'),
  onlyUnacknowledged: z
    .boolean()
    .optional()
    .default(true)
    .describe('Only return unacknowledged alerts (default: true)'),
  severity: z
    .enum(['low', 'medium', 'high', 'critical'])
    .optional()
    .describe('Filter by severity level'),
});

const AcknowledgeAlertActionSchema = CommonFieldsSchema.extend({
  action: z.literal('acknowledge_alert').describe('Acknowledge an alert'),
  alertId: z.string().describe('Alert ID to acknowledge'),
});

const ClearAlertsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('clear_alerts').describe('Clear all alerts'),
});

// User profile actions
const SetUserIdActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_user_id').describe('Set current user ID and load their profile'),
  userId: z.string().describe('User identifier'),
});

const GetProfileActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_profile').describe('Get current user profile'),
});

const UpdateProfilePreferencesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_profile_preferences').describe('Update user profile preferences'),
  preferences: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    )
    .describe('Preferences to update (can be string, number, boolean, null, array, or object)'),
});

const RecordSuccessfulFormulaActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('record_successful_formula')
    .describe('Record a successful formula for learning'),
  formula: z.string().describe('Formula that worked well'),
  useCase: z.string().describe('What the formula was used for'),
});

const RejectSuggestionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('reject_suggestion').describe('Record that user rejected a suggestion'),
  suggestion: z.string().describe('Suggestion that was rejected'),
});

const GetTopFormulasActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_top_formulas').describe('Get top successful formulas for user'),
  limit: z.number().int().positive().optional().describe('Number of formulas to return'),
});

// Schedule actions (Phase 6: Scheduled Workflows)
const ScheduledOperationSchema = z
  .object({
    tool: z.string().min(1).describe('MCP tool name to invoke (e.g., "sheets_data")'),
    action: z
      .string()
      .min(1)
      .optional()
      .describe('Compatibility alias for actionName in nested schedule requests'),
    actionName: z.string().min(1).optional().describe('Action within the tool (e.g., "read")'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Parameters to pass to the action'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.action && !data.actionName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Nested schedule operation requires action or actionName',
        path: ['actionName'],
      });
    }
  });

const ScheduleCreateActionSchema = CommonFieldsSchema.extend({
  action: z.literal('schedule_create'),
  spreadsheetId: z.string().min(1),
  cronExpression: z
    .string()
    .min(1)
    .describe('Cron expression (e.g., "0 9 * * 1-5" for weekdays at 9 AM)'),
  description: z.string().min(1).describe('Human-readable description of the scheduled task'),
  tool: z.string().min(1).optional().describe('MCP tool name to invoke (e.g., "sheets_data")'),
  actionName: z.string().min(1).optional().describe('Action within the tool (e.g., "read")'),
  params: z.record(z.string(), z.unknown()).optional().describe('Parameters to pass to the action'),
  operation: ScheduledOperationSchema.optional().describe(
    'Compatibility nested schedule shape: { tool, action or actionName, params }'
  ),
  target: ScheduledOperationSchema.optional().describe(
    'Alternative nested schedule shape for LLM compatibility: { tool, action or actionName, params }'
  ),
})
  .strict()
  .superRefine((data, ctx) => {
    const nested = data.operation ?? data.target;
    const hasFlat = Boolean(data.tool && data.actionName);
    const hasNested = Boolean(nested?.tool && (nested.actionName ?? nested.action));

    if (!hasFlat && !hasNested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'schedule_create requires either flat tool/actionName fields or a nested operation',
        path: ['actionName'],
      });
    }
  });

const ScheduleListActionSchema = CommonFieldsSchema.extend({
  action: z.literal('schedule_list'),
  spreadsheetId: z
    .string()
    .optional()
    .describe('Filter by spreadsheet ID (omit for all schedules)'),
}).strict();

const ScheduleCancelActionSchema = CommonFieldsSchema.extend({
  action: z.literal('schedule_cancel'),
  jobId: z.string().min(1).describe('Job ID returned by schedule_create'),
}).strict();

const ScheduleRunNowActionSchema = CommonFieldsSchema.extend({
  action: z.literal('schedule_run_now'),
  jobId: z.string().min(1).describe('Job ID to trigger immediately'),
}).strict();

// Pipeline step schema (used by execute_pipeline)
const PipelineStepSchema = z.object({
  id: z.string().min(1).describe('Unique step identifier — referenced by other steps dependsOn'),
  tool: z.string().describe('Tool name (e.g. "sheets_data", "sheets_format")'),
  action: z.string().describe('Action within the tool (e.g. "read", "write", "set_format")'),
  params: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.unknown()),
        z.record(z.string(), z.unknown()),
      ])
    )
    .describe('Tool parameters (excluding action — added automatically)'),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe('IDs of steps that must complete before this step runs'),
});

const ExecutePipelineActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('execute_pipeline')
    .describe(
      'Execute a DAG-based multi-step pipeline. READ steps within a wave run in parallel; WRITE steps run sequentially. Use dependsOn to define execution order.'
    ),
  steps: z
    .array(PipelineStepSchema)
    .min(1)
    .max(50)
    .describe('Pipeline steps (max 50). Steps without dependsOn run in the first wave.'),
  failFast: z
    .boolean()
    .optional()
    .default(true)
    .describe('Stop execution on first error (default: true). Set false to collect all errors.'),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

/**
 * All session context operation inputs
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsSessionInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    SetActiveActionSchema,
    GetActiveActionSchema,
    GetContextActionSchema,
    RecordOperationActionSchema,
    GetLastOperationActionSchema,
    GetHistoryActionSchema,
    FindByReferenceActionSchema,
    UpdatePreferencesActionSchema,
    GetPreferencesActionSchema,
    SetPendingActionSchema,
    GetPendingActionSchema,
    ClearPendingActionSchema,
    SaveCheckpointActionSchema,
    LoadCheckpointActionSchema,
    ListCheckpointsActionSchema,
    DeleteCheckpointActionSchema,
    ResetActionSchema,
    GetAlertsActionSchema,
    AcknowledgeAlertActionSchema,
    ClearAlertsActionSchema,
    SetUserIdActionSchema,
    GetProfileActionSchema,
    UpdateProfilePreferencesActionSchema,
    RecordSuccessfulFormulaActionSchema,
    RejectSuggestionActionSchema,
    GetTopFormulasActionSchema,
    ExecutePipelineActionSchema,
    ScheduleCreateActionSchema,
    ScheduleListActionSchema,
    ScheduleCancelActionSchema,
    ScheduleRunNowActionSchema,
  ]),
});

export type SheetsSessionInput = z.infer<typeof SheetsSessionInputSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type SessionRequest = SheetsSessionInput['request'];

// ============================================================================
// OUTPUT SCHEMAS
// ============================================================================

const SpreadsheetContextSchema = z.object({
  spreadsheetId: z.string(),
  title: z.string(),
  activatedAt: z.coerce.number(),
  sheetNames: z.array(z.string()),
  lastRange: z.string().optional(),
});

const OperationRecordSchema = z.object({
  id: z.string(),
  tool: z.string(),
  action: z.string(),
  spreadsheetId: z.string(),
  range: z.string().optional(),
  description: z.string(),
  timestamp: z.coerce.number(),
  undoable: z.boolean(),
  snapshotId: z.string().optional(),
  cellsAffected: z.coerce.number().optional(),
});

const PreferencesSchema = z.object({
  confirmationLevel: z.enum(['always', 'destructive', 'never']),
  defaultSafety: z.object({
    dryRun: z.boolean(),
    createSnapshot: z.boolean(),
  }),
  formatting: z.object({
    headerStyle: z.enum(['bold', 'bold-colored', 'minimal']),
    dateFormat: z.string(),
    currencyFormat: z.string(),
  }),
});

const PendingOperationSchema = z
  .object({
    type: z.string(),
    step: z.coerce.number(),
    totalSteps: z.coerce.number(),
    context: z.record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    ),
  })
  .nullable();

const SessionActionSchema = z.enum([
  'set_active',
  'get_active',
  'get_context',
  'record_operation',
  'get_last_operation',
  'get_history',
  'find_by_reference',
  'update_preferences',
  'get_preferences',
  'set_pending',
  'get_pending',
  'clear_pending',
  'save_checkpoint',
  'load_checkpoint',
  'list_checkpoints',
  'delete_checkpoint',
  'reset',
  'get_alerts',
  'acknowledge_alert',
  'clear_alerts',
  'set_user_id',
  'get_profile',
  'update_profile_preferences',
  'record_successful_formula',
  'reject_suggestion',
  'get_top_formulas',
  'execute_pipeline',
  'schedule_create',
  'schedule_list',
  'schedule_cancel',
  'schedule_run_now',
]);

// Success responses
const SessionSuccessSchema = z.object({
  success: z.literal(true),
  action: SessionActionSchema,
  spreadsheet: SpreadsheetContextSchema.nullable().optional(),
  recentSpreadsheets: z.array(SpreadsheetContextSchema).optional(),
  summary: z.string().optional(),
  activeSpreadsheet: SpreadsheetContextSchema.nullable().optional(),
  lastOperation: OperationRecordSchema.nullable().optional(),
  pendingOperation: PendingOperationSchema.optional(),
  suggestedActions: z.array(z.string()).optional(),
  operationId: z.string().optional(),
  operation: OperationRecordSchema.nullable().optional(),
  operations: z.array(OperationRecordSchema).optional(),
  found: z.boolean().optional(),
  preferences: PreferencesSchema.optional(),
  pending: PendingOperationSchema.optional(),
  message: z.string().optional(),
  // Checkpoint fields
  checkpointPath: z.string().optional(),
  checkpoint: z
    .object({
      sessionId: z.string(),
      timestamp: z.coerce.number(),
      createdAt: z.string(),
      description: z.string().optional(),
      completedSteps: z.coerce.number(),
      spreadsheetTitle: z.string().optional(),
    })
    .optional(),
  checkpoints: z
    .array(
      z.object({
        sessionId: z.string(),
        timestamp: z.coerce.number(),
        createdAt: z.string(),
        description: z.string().optional(),
        completedSteps: z.coerce.number(),
        spreadsheetTitle: z.string().optional(),
      })
    )
    .optional(),
  deleted: z.boolean().optional(),
  // Alert fields
  alerts: z
    .array(
      z.object({
        id: z.string(),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        message: z.string(),
        timestamp: z.coerce.number(),
        spreadsheetId: z.string().optional(),
        actionable: z
          .object({
            tool: z.string(),
            action: z.string(),
            params: z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.array(z.any()),
                z.record(z.string(), z.any()),
              ])
            ),
          })
          .optional(),
        acknowledged: z.boolean(),
      })
    )
    .optional(),
  count: z.coerce.number().optional(),
  hasCritical: z.boolean().optional(),
  alertId: z.string().optional(),
  // User profile fields
  userId: z.string().optional(),
  profile: z
    .object({
      userId: z.string(),
      preferences: z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.any()),
          z.record(z.string(), z.any()),
        ])
      ),
      learnings: z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.any()),
          z.record(z.string(), z.any()),
        ])
      ),
      history: z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.any()),
          z.record(z.string(), z.any()),
        ])
      ),
      lastUpdated: z.number(),
    })
    .nullable()
    .optional(),
  formulas: z
    .array(
      z.object({
        formula: z.string(),
        useCase: z.string(),
        successCount: z.number(),
      })
    )
    .optional(),
  // Pipeline execution fields
  pipelineResults: z
    .array(
      z.object({
        id: z.string(),
        tool: z.string(),
        action: z.string(),
        status: z.enum(['success', 'error', 'skipped']),
        result: z.unknown().optional(),
        error: z.string().optional(),
        durationMs: z.number(),
      })
    )
    .optional(),
  stepsCompleted: z.coerce.number().optional(),
  stepsTotal: z.coerce.number().optional(),
  failedAt: z.string().optional(),
  pipelineDurationMs: z.coerce.number().optional(),
  // Schedule response fields (Phase 6)
  jobId: z.string().optional().describe('Created or targeted job ID'),
  jobs: z
    .array(
      z.object({
        id: z.string(),
        spreadsheetId: z.string(),
        cronExpression: z.string(),
        description: z.string(),
        tool: z.string().optional(),
        actionName: z.string().optional(),
        enabled: z.boolean(),
        lastRun: z.string().optional(),
        createdAt: z.string(),
      })
    )
    .optional()
    .describe('List of scheduled jobs'),
});

// Error response
const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// Combined output - discriminates on success for MCP schema compliance
export const SheetsSessionOutputSchema = z.object({
  response: z.discriminatedUnion('success', [SessionSuccessSchema, ErrorResponseSchema]),
});

export type SheetsSessionOutput = z.infer<typeof SheetsSessionOutputSchema>;

// ============================================================================
// TOOL ANNOTATIONS
// ============================================================================

export const SHEETS_SESSION_ANNOTATIONS: ToolAnnotations = {
  title: 'Session Context',
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ============================================================================
// TOOL DESCRIPTION
// ============================================================================

export const SHEETS_SESSION_DESCRIPTION = `🧠 Manage conversation context for natural language interactions. Enables references like "the spreadsheet", "undo that", "continue".

**Why This Tool Matters:**
Users don't say "spreadsheet ID 1ABC..." - they say "the spreadsheet" or "my budget".
This tool tracks what we're working with so Claude can understand natural references.

**Quick Examples:**
• Set active: {"action":"set_active","spreadsheetId":"1ABC...","title":"Q4 Budget"} (sheetNames optional)
• Get context: {"action":"get_context"} → Returns summary + suggestions
• Find reference: {"action":"find_by_reference","reference":"that","type":"operation"} → Finds last operation
• Record op manually: {"action":"record_operation","tool":"external","toolAction":"sync",...} (optional for work done outside normal tool calls)

**Natural Language Support:**
• "the spreadsheet" → get_active returns current spreadsheet
• "undo that" → find_by_reference finds last undoable operation
• "switch to the budget" → find_by_reference finds by title
• "continue" → get_pending returns multi-step operation state

**When to Use:**
1. ALWAYS call get_context at conversation start
2. Call set_active after opening/creating a spreadsheet
3. Use record_operation only for manual/external work that is not already captured by a normal tool call
4. Call find_by_reference when user uses natural references

**Common Workflows:**
1. Start: get_context → Understand current state
2. After open: set_active → Remember which spreadsheet
3. After write: get_context/history → inspect the auto-tracked operation
4. User says "undo": find_by_reference → Find operation to undo

**Best Practice:**
Call get_context when unsure what user means - it provides suggestions!

**Multi-turn Requirement Gathering:**
Use the collaborative workflow pattern for natural language requests:

1. **Start gathering**: \`set_pending\` with \`type:"requirement_gathering"\` to track Q&A state
   Example: \`{"action":"set_pending","type":"requirement_gathering","step":1,"totalSteps":3,"context":{"userIntent":"create report","gathered":{},"stillNeeded":["spreadsheet","metrics"]}}\`

2. **Update as you learn**: Add to \`context.gathered\` as user answers questions
   Example: \`{"action":"set_pending","step":2,"context":{"gathered":{"spreadsheetId":"1ABC"},"stillNeeded":["metrics"]}}\`

3. **Plan ready**: Switch to \`type:"awaiting_approval"\` when you have enough context
   Example: \`{"action":"set_pending","type":"awaiting_approval","context":{"plan":{"steps":[...]}}}\`

4. **Execute**: After approval, perform operations. Successful tool calls are auto-recorded; use \`record_operation\` only for manual or external steps.
   Example: \`{"action":"record_operation","tool":"external","toolAction":"sync","description":"Ran external backfill",...}\`

5. **Complete**: Clear the pending state when done
   Example: \`{"action":"clear_pending"}\`

**Pending Operation Types:**
- \`requirement_gathering\`: Collecting context through multi-turn Q&A
- \`awaiting_approval\`: Plan is ready, waiting for user confirmation
- \`executing\`: Operation in progress (multi-step workflow)
- \`suspended\`: Temporarily paused (e.g., waiting for external data)

**Context Structure for Requirement Gathering:**
\`\`\`json
{
  "userIntent": "Brief description of what user wants",
  "gathered": {
    "spreadsheetId": "1ABC...",
    "timeframe": "Q1 2024",
    "metrics": ["revenue", "growth"]
  },
  "stillNeeded": ["format", "visualization"],
  "plan": {
    "steps": ["1. Read data", "2. Calculate", "3. Write"],
    "safetyMeasures": {"dryRun": false, "snapshot": true},
    "estimatedImpact": {"cellsAffected": 200}
  }
}
\`\`\`

**Example Full Workflow:**
\`\`\`
User: "Create a sales report"
→ set_pending (type: requirement_gathering, stillNeeded: ["spreadsheet", "timeframe", "metrics"])
User: "Use spreadsheet 1ABC, Q1 2024"
→ set_pending (update gathered, stillNeeded: ["metrics"])
User: "Total revenue by region"
→ set_pending (type: awaiting_approval, include plan)
User: "Go ahead"
→ Execute operations (auto-recorded) and optionally record external/manual steps
→ clear_pending when complete
\`\`\``;
