/**
 * Tool: sheets_confirm
 *
 * Uses MCP Elicitation (SEP-1036) for user confirmation before executing
 * multi-step operations. This is the correct MCP pattern:
 * - Claude plans the operations
 * - This tool presents the plan for user confirmation
 * - User approves/modifies/rejects via Elicitation
 *
 * @see MCP_PROTOCOL_COMPLETE_REFERENCE.md - Elicitation section
 */

import { z } from 'zod';
import { ErrorDetailSchema, ResponseMetaSchema, type ToolAnnotations } from './shared.js';

/**
 * Verbosity level for response filtering
 */
const VerbositySchema = z
  .enum(['minimal', 'standard', 'detailed'])
  .optional()
  .default('standard')
  .describe(
    'Response verbosity: minimal (essential info only), standard (balanced), detailed (full metadata)'
  );

/**
 * Risk level schema
 */
const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Plan step schema
 */
const PlanStepSchema = z.object({
  stepNumber: z.coerce.number().int().positive().describe('Step number (1-based)'),
  description: z.string().min(1).describe('Human-readable description of what this step does'),
  tool: z
    .string()
    .min(1)
    .transform((val) => {
      // Auto-prefix with sheets_ if not present
      const lower = val.toLowerCase();
      return lower.startsWith('sheets_') ? lower : `sheets_${lower}`;
    })
    .describe('Tool to be called (e.g., "sheets_data", "sheets_format", or just "data", "format")'),
  action: z.string().min(1).describe('Action within the tool (e.g., "write", "format")'),
  risk: RiskLevelSchema.optional()
    .default('low')
    .describe('Risk level of this step (default: low)'),
  estimatedApiCalls: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Estimated Google Sheets API calls (optional)'),
  isDestructive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether this step modifies/deletes data (default: false)'),
  canUndo: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether this step can be undone (default: false)'),
  rationale: z.string().optional().describe('Optional rationale for why this step is needed'),
  expectedOutcome: z.string().optional().describe('Expected outcome from this step'),
  estimatedDuration: z.coerce
    .number()
    .positive()
    .optional()
    .describe('Estimated step duration in seconds'),
  optional: z.boolean().optional().default(false).describe('Whether this step can be skipped'),
  dependsOn: z
    .array(z.coerce.number().int().positive())
    .optional()
    .describe('Step numbers that this step depends on'),
});

/**
 * Operation plan schema for confirmation
 */
const OperationPlanSchema = z.object({
  title: z.string().min(1).describe('Plan title'),
  description: z.string().describe('Detailed description of what the plan does'),
  steps: z
    .array(PlanStepSchema)
    .min(1)
    .max(50, 'Plan cannot have more than 50 steps')
    .describe('Steps in the plan (max 50)'),
  willCreateSnapshot: z
    .boolean()
    .default(true)
    .describe('Whether to create a snapshot before execution'),
  additionalWarnings: z.array(z.string()).optional().describe('Additional warnings to display'),
  successCriteria: z
    .array(z.string())
    .optional()
    .describe('Success criteria that define completion quality'),
  rollbackStrategy: z.string().optional().describe('Rollback strategy if execution fails'),
  alternatives: z
    .array(
      z.object({
        description: z.string().describe('Alternative approach'),
        reason: z.string().optional().describe('Why this alternative was not selected'),
      })
    )
    .optional()
    .describe('Alternative approaches considered before selecting this plan'),
});

/**
 * Input schema - discriminated union (2 actions)
 */
const RequestActionSchema = z.object({
  action: z
    .literal('request')
    .describe('Request user confirmation for a multi-step operation plan'),
  plan: OperationPlanSchema.describe('The plan to confirm with the user'),
  verbosity: VerbositySchema,
});

const GetStatsActionSchema = z.object({
  action: z.literal('get_stats').describe('Get statistics about confirmation requests'),
  verbosity: VerbositySchema,
});

/**
 * Wizard step definition for multi-step flows
 */
const WizardStepDefSchema = z.object({
  stepId: z.string().describe('Unique step identifier'),
  title: z.string().describe('Step title'),
  description: z.string().describe('Step description'),
  fields: z
    .array(
      z.object({
        name: z.string().describe('Field name'),
        label: z.string().describe('Field label'),
        type: z.enum(['text', 'number', 'boolean', 'select', 'multiselect']).describe('Field type'),
        required: z.boolean().default(true),
        options: z.array(z.string()).optional().describe('Options for select/multiselect'),
        default: z
          .union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
          ])
          .optional()
          .describe('Default value'),
        validation: z.string().optional().describe('Validation regex pattern'),
      })
    )
    .describe('Fields to collect in this step'),
  dependsOn: z.string().optional().describe('Step ID this step depends on'),
});

/**
 * Wizard start action - initiates a multi-step wizard flow
 */
const WizardStartActionSchema = z.object({
  action: z.literal('wizard_start').describe('Start a multi-step wizard flow'),
  wizardId: z.string().optional().describe('Optional wizard ID (generated if not provided)'),
  title: z.string().describe('Wizard title'),
  description: z.string().describe('Wizard description'),
  steps: z.array(WizardStepDefSchema).min(1).max(10).describe('Wizard steps (max 10)'),
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
    .describe(
      'Context data available to all steps (can be string, number, boolean, null, array, or object)'
    ),
  verbosity: VerbositySchema,
});

/**
 * Wizard step action - handle a specific step in the wizard
 */
const WizardStepActionSchema = z.object({
  action: z.literal('wizard_step').describe('Process a wizard step'),
  wizardId: z.string().describe('Wizard ID'),
  stepId: z.string().describe('Current step ID'),
  values: z
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
    .describe(
      'Field values for this step (can be string, number, boolean, null, array, or object)'
    ),
  direction: z.enum(['next', 'back', 'skip']).default('next').describe('Navigation direction'),
  verbosity: VerbositySchema,
});

/**
 * Wizard complete action - finalize and execute the wizard
 */
const WizardCompleteActionSchema = z.object({
  action: z.literal('wizard_complete').describe('Complete the wizard and execute'),
  wizardId: z.string().describe('Wizard ID'),
  executeImmediately: z.boolean().default(true).describe('Execute immediately after confirmation'),
  verbosity: VerbositySchema,
});

export const SheetsConfirmInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    RequestActionSchema,
    GetStatsActionSchema,
    WizardStartActionSchema,
    WizardStepActionSchema,
    WizardCompleteActionSchema,
  ]),
});

/**
 * Confirmation result schema
 */
const ConfirmationResultSchema = z.object({
  approved: z.boolean().describe('Whether the user approved the plan'),
  action: z.enum(['accept', 'decline', 'cancel']).describe('User action'),
  modifications: z.string().optional().describe('User modifications to the plan'),
  timestamp: z.coerce.number().describe('Timestamp of confirmation'),
});

/**
 * Stats schema
 */
const ConfirmStatsSchema = z.object({
  totalConfirmations: z.coerce.number(),
  approved: z.coerce.number(),
  declined: z.coerce.number(),
  cancelled: z.coerce.number(),
  approvalRate: z.coerce.number(),
  avgResponseTime: z.coerce.number(),
});

/**
 * Wizard state schema
 */
const WizardStateSchema = z.object({
  wizardId: z.string(),
  title: z.string(),
  currentStepIndex: z.number(),
  totalSteps: z.number(),
  currentStepId: z.string(),
  completedSteps: z.array(z.string()),
  collectedValues: z.record(
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
  isComplete: z.boolean(),
});

/**
 * Response schema
 */
const ConfirmResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // For request action
    planId: z.string().optional(),
    confirmation: ConfirmationResultSchema.optional(),
    // For get_stats action
    stats: ConfirmStatsSchema.optional(),
    // For wizard actions
    wizard: WizardStateSchema.optional(),
    nextStep: WizardStepDefSchema.optional(),
    message: z.string().default(''),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsConfirmOutputSchema = z.object({
  response: ConfirmResponseSchema,
});

/**
 * Tool annotations following MCP 2025-11-25
 */
export const SHEETS_CONFIRM_ANNOTATIONS: ToolAnnotations = {
  title: 'Plan Confirmation',
  readOnlyHint: true, // Confirmation itself doesn't change data
  destructiveHint: false, // The tool just confirms, doesn't execute
  idempotentHint: false, // Each confirmation is unique
  openWorldHint: true, // Interacts with user via Elicitation
};

// Type exports
export type SheetsConfirmInput = z.infer<typeof SheetsConfirmInputSchema>;
export type SheetsConfirmOutput = z.infer<typeof SheetsConfirmOutputSchema>;
export type ConfirmResponse = z.infer<typeof ConfirmResponseSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type OperationPlan = z.infer<typeof OperationPlanSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type WizardStepDef = z.infer<typeof WizardStepDefSchema>;
export type WizardState = z.infer<typeof WizardStateSchema>;

// Type narrowing helpers for handler methods
export type ConfirmRequestInput = SheetsConfirmInput['request'] & {
  action: 'request';
  plan: OperationPlan;
};
export type ConfirmGetStatsInput = SheetsConfirmInput['request'] & { action: 'get_stats' };
export type ConfirmWizardStartInput = SheetsConfirmInput['request'] & {
  action: 'wizard_start';
  title: string;
  description: string;
  steps: WizardStepDef[];
};
export type ConfirmWizardStepInput = SheetsConfirmInput['request'] & {
  action: 'wizard_step';
  wizardId: string;
  stepId: string;
  values: Record<string, unknown>;
};
export type ConfirmWizardCompleteInput = SheetsConfirmInput['request'] & {
  action: 'wizard_complete';
  wizardId: string;
};
