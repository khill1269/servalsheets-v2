/**
 * Tool: sheets_quality
 * Enterprise quality assurance: validation, conflict detection, and impact analysis.
 *
 * Actions (4):
 * - validate: Data validation with built-in validators
 * - detect_conflicts: Detect concurrent modification conflicts
 * - resolve_conflict: Resolve detected conflicts with strategies
 * - analyze_impact: Pre-execution impact analysis with dependency tracking
 */

import { z } from 'zod';
import {
  CellValueSchema,
  ErrorDetailSchema,
  RangeInputSchema,
  ResponseMetaSchema,
  SafetyOptionsSchema,
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options (dryRun to test validation rules without applying, etc.)'
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

export const BuiltinValidationRuleSchema = z
  .enum([
    'builtin_string',
    'builtin_number',
    'builtin_boolean',
    'builtin_date',
    'builtin_positive',
    'builtin_non_negative',
    'builtin_email',
    'builtin_url',
    'builtin_phone',
    'builtin_required',
    'builtin_non_empty_string',
  ])
  .describe(
    'Built-in validation rule ID: ' +
      'builtin_string (value is a string), ' +
      'builtin_number (valid number), ' +
      'builtin_boolean (true/false/0/1/yes/no), ' +
      'builtin_date (ISO 8601 date), ' +
      'builtin_positive (number > 0), ' +
      'builtin_non_negative (number >= 0), ' +
      'builtin_email (valid email format), ' +
      'builtin_url (valid HTTP/HTTPS URL), ' +
      'builtin_phone (phone number format), ' +
      'builtin_required (non-empty value), ' +
      'builtin_non_empty_string (string with non-whitespace content)'
  );

const ValidationSeveritySchema = z.enum(['error', 'warning', 'info']);

const ComparableLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const ComparisonTargetSchema = z.union([
  z.object({
    value: ComparableLiteralSchema.describe('Literal value to compare against'),
  }),
  z.object({
    contextKey: z
      .string()
      .min(1)
      .describe('Lookup key in validate.context or validate.context.metadata'),
  }),
]);

const CustomComparisonRuleSchema = z.object({
  type: z.literal('comparison'),
  id: z.string().min(1).optional().describe('Optional stable rule ID. Auto-generated if omitted'),
  name: z.string().min(1).optional().describe('Optional rule name'),
  operator: z
    .enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'])
    .describe('Comparison operator: gt, gte, lt, lte, eq, or neq'),
  compareTo: ComparisonTargetSchema.describe(
    'Comparison target. Example: { contextKey: "cogs" } or { value: 100 }'
  ),
  severity: ValidationSeveritySchema.optional().default('error'),
  message: z
    .string()
    .optional()
    .describe('Optional custom failure message shown when the rule fails'),
});

const CustomPatternRuleSchema = z.object({
  type: z.literal('pattern'),
  id: z.string().min(1).optional().describe('Optional stable rule ID. Auto-generated if omitted'),
  name: z.string().min(1).optional().describe('Optional rule name'),
  pattern: z.string().min(1).describe('Regular expression pattern without surrounding slashes'),
  flags: z.string().optional().describe('Optional RegExp flags, e.g. "i"'),
  severity: ValidationSeveritySchema.optional().default('error'),
  message: z.string().optional().describe('Optional custom failure message'),
});

const CustomLengthRuleSchema = z
  .object({
    type: z.literal('length'),
    id: z.string().min(1).optional().describe('Optional stable rule ID. Auto-generated if omitted'),
    name: z.string().min(1).optional().describe('Optional rule name'),
    min: z.number().optional().describe('Minimum string/array length'),
    max: z.number().optional().describe('Maximum string/array length'),
    severity: ValidationSeveritySchema.optional().default('error'),
    message: z.string().optional().describe('Optional custom failure message'),
  })
  .refine((rule) => rule.min !== undefined || rule.max !== undefined, {
    message: 'At least one of min or max must be provided',
  });

const CustomOneOfRuleSchema = z.object({
  type: z.literal('one_of'),
  id: z.string().min(1).optional().describe('Optional stable rule ID. Auto-generated if omitted'),
  name: z.string().min(1).optional().describe('Optional rule name'),
  values: z
    .array(ComparableLiteralSchema)
    .min(1)
    .describe('Allowed literal values. Example: ["draft", "approved", "archived"]'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(true)
    .describe('For string comparisons, whether matching is case-sensitive'),
  severity: ValidationSeveritySchema.optional().default('error'),
  message: z.string().optional().describe('Optional custom failure message'),
});

export const CustomValidationRuleSchema = z.discriminatedUnion('type', [
  CustomComparisonRuleSchema,
  CustomPatternRuleSchema,
  CustomLengthRuleSchema,
  CustomOneOfRuleSchema,
]);

export const ValidationRuleInputSchema = z.union([
  BuiltinValidationRuleSchema,
  CustomValidationRuleSchema,
]);

const ValidateActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('validate')
    .describe('Validate data using built-in validators and custom single-value rules'),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.any()),
      z.record(z.string(), z.any()),
    ])
    .optional()
    .describe(
      'Value to validate (string, number, boolean, null, array, or object). Required for single-value validation. For range-based data validation, use sheets_fix.detect_anomalies or sheets_analyze.scout instead.'
    ),
  rules: z
    .array(ValidationRuleInputSchema)
    .optional()
    .describe(
      'Rules to apply. Built-ins: builtin_string, builtin_number, builtin_boolean, builtin_date, builtin_positive, builtin_non_negative, builtin_email, builtin_url, builtin_phone, builtin_required, builtin_non_empty_string. Custom object rules support comparison, pattern, length, and one_of checks. Example: ["builtin_required", { "type": "comparison", "operator": "gt", "compareTo": { "contextKey": "cogs" }, "message": "Unit Price must exceed COGS" }]'
    ),
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
    .describe('Validation context: spreadsheetId, sheetName, range, etc.'),
  stopOnFirstError: z
    .boolean()
    .optional()
    .default(false)
    .describe('Stop validation on first error (default: false)'),
});

const DetectConflictsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('detect_conflicts').describe('Detect concurrent modification conflicts'),
  spreadsheetId: z.string().min(1).describe('Spreadsheet ID from URL'),
  range: RangeInputSchema.optional().describe('Range to check - entire sheet if omitted'),
  since: z
    .number()
    .optional()
    .describe('Timestamp to check conflicts since (ms) - checks all history if omitted'),
});

const ResolveConflictActionSchema = CommonFieldsSchema.extend({
  action: z.literal('resolve_conflict').describe('Resolve a detected conflict with a strategy'),
  conflictId: z.string().min(1).describe('Conflict ID from detect_conflicts response'),
  strategy: z
    .enum(['keep_local', 'keep_remote', 'merge', 'manual'])
    .describe('Resolution strategy: keep_local, keep_remote, merge, or manual'),
  mergedValue: CellValueSchema.optional().describe(
    'Merged value for manual resolution strategy (required if strategy=manual)'
  ),
});

const AnalyzeImpactActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('analyze_impact')
    .describe(
      'Pre-execution impact analysis with dependency tracking. Example: { "action": "analyze_impact", "spreadsheetId": "abc123", "operation": { "tool": "sheets_data", "action": "clear", "params": { "range": "A1:Z100" } } }'
    ),
  spreadsheetId: z.string().min(1).describe('Spreadsheet ID from URL'),
  operation: z
    .object({
      type: z
        .string()
        .optional()
        .describe(
          'Operation type (e.g., "values_write", "sheet_delete", "format_update", "dimension_change")'
        ),
      // BUG-11 fix: tool + action should be required — they identify what operation to analyze.
      // Made optional with superRefine below to give clear error messages.
      tool: z.string().min(1).describe('Tool name (e.g., "sheets_data", "sheets_format")'),
      action: z
        .string()
        .min(1)
        .describe('Action name within the tool (e.g., "write", "clear", "format")'),
      params: z
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
          'Operation parameters that will be passed to the tool. Expected shape: { spreadsheetId: string, range: string, values?: any[], ... } or other tool-specific parameters'
        ),
      description: z
        .string()
        .optional()
        .describe('Natural language description of the operation (alternative to tool/action)'),
    })
    .refine(
      (op) => op.type || op.tool || op.action || op.description,
      'At least one of type, tool, action, or description must be provided'
    )
    .describe(
      'Operation to analyze. Expected shape: { tool: string, action: string, params: Record<string, unknown> }. Example: { "tool": "sheets_data", "action": "write", "params": { "spreadsheetId": "abc123", "range": "Sheet1!A1:B10", "values": [[1,2]] } }. For clear operations: { "tool": "sheets_data", "action": "clear", "params": { "spreadsheetId": "...", "range": "Sheet1!A1:Z100" } }'
    ),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

// Preprocess to normalize common LLM input variations
const normalizeQualityRequest = (val: unknown): unknown => {
  if (typeof val !== 'object' || val === null) return val;
  const obj = val as Record<string, unknown>;

  // Alias: 'resolution' → 'strategy' for resolve_conflict (LLM compatibility)
  if (obj['action'] === 'resolve_conflict' && obj['resolution'] && !obj['strategy']) {
    return { ...obj, strategy: obj['resolution'] };
  }

  return val;
};

/**
 * All quality assurance operation inputs
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsQualityInputSchema = z.object({
  request: z.preprocess(
    normalizeQualityRequest,
    z.discriminatedUnion('action', [
      ValidateActionSchema,
      DetectConflictsActionSchema,
      ResolveConflictActionSchema,
      AnalyzeImpactActionSchema,
    ])
  ),
});

const QualityResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // VALIDATE response fields
    valid: z.boolean().optional(),
    errorCount: z.coerce.number().optional(),
    warningCount: z.coerce.number().optional(),
    infoCount: z.coerce.number().optional(),
    totalChecks: z.coerce.number().optional(),
    passedChecks: z.coerce.number().optional(),
    errors: z
      .array(
        z.object({
          ruleId: z.string(),
          ruleName: z.string(),
          severity: z.enum(['error', 'warning', 'info']),
          message: z.string(),
          actualValue: z
            .union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.array(z.any()),
              z.record(z.string(), z.any()),
            ])
            .optional(),
          expectedValue: z
            .union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.array(z.any()),
              z.record(z.string(), z.any()),
            ])
            .optional(),
          path: z.string().optional(),
        })
      )
      .optional(),
    warnings: z
      .array(
        z.object({
          ruleId: z.string(),
          ruleName: z.string(),
          message: z.string(),
        })
      )
      .optional(),
    duration: z.coerce.number().optional(),
    // Dry run preview
    dryRun: z.boolean().optional().describe('True if this was a dry run (no changes applied)'),
    validationPreview: z
      .object({
        wouldApply: z.boolean().describe('Whether validation would be applied'),
        affectedCells: z
          .number()
          .int()
          .optional()
          .describe('Number of cells that would be affected'),
        rulesPreview: z
          .array(
            z.object({
              ruleId: z.string(),
              condition: z.string(),
              cellsAffected: z.coerce.number().int(),
            })
          )
          .optional(),
      })
      .optional()
      .describe('Preview of what would happen (when dryRun=true)'),
    // DETECT_CONFLICTS response fields
    conflicts: z
      .array(
        z.object({
          id: z.string(),
          spreadsheetId: z.string(),
          range: z.string(),
          localVersion: z.coerce.number(),
          remoteVersion: z.coerce.number(),
          localValue: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
          ]),
          remoteValue: z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
          ]),
          conflictType: z.enum(['concurrent_write', 'version_mismatch', 'data_race']),
          severity: z.enum(['low', 'medium', 'high', 'critical']),
          detectedAt: z.coerce.number(),
          suggestedStrategy: z.enum(['keep_local', 'keep_remote', 'merge', 'manual']),
        })
      )
      .optional(),
    // RESOLVE_CONFLICT response fields
    conflictId: z.string().optional(),
    resolved: z.boolean().optional(),
    resolution: z
      .object({
        strategy: z.string(),
        finalValue: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.any()),
          z.record(z.string(), z.any()),
        ]),
        version: z.coerce.number(),
      })
      .optional(),
    // ANALYZE_IMPACT response fields
    impact: z
      .object({
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        scope: z.object({
          rows: z.coerce.number(),
          columns: z.coerce.number(),
          cells: z.coerce.number(),
          sheets: z.array(z.string()),
        }),
        affectedResources: z.object({
          formulas: z.array(z.string()),
          charts: z.array(z.string()),
          pivotTables: z.array(z.string()),
          validationRules: z.array(z.string()),
          namedRanges: z.array(z.string()),
          protectedRanges: z.array(z.string()),
        }),
        estimatedExecutionTime: z.coerce.number(),
        warnings: z.array(
          z.object({
            severity: z.enum(['low', 'medium', 'high', 'critical']),
            message: z.string(),
            affectedResources: z.array(z.string()).optional(),
          })
        ),
        recommendations: z.array(
          z.object({
            action: z.string(),
            reason: z.string(),
            priority: z.enum(['low', 'medium', 'high']),
          })
        ),
        canProceed: z.boolean(),
        requiresConfirmation: z.boolean(),
      })
      .optional(),
    message: z.string().optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsQualityOutputSchema = z.object({
  response: QualityResponseSchema,
});

export const SHEETS_QUALITY_ANNOTATIONS: ToolAnnotations = {
  title: 'Quality Assurance',
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export type SheetsQualityInput = z.infer<typeof SheetsQualityInputSchema>;
export type SheetsQualityOutput = z.infer<typeof SheetsQualityOutputSchema>;
export type QualityResponse = z.infer<typeof QualityResponseSchema>;
export type BuiltinValidationRuleInput = z.infer<typeof BuiltinValidationRuleSchema>;
export type CustomValidationRuleInput = z.infer<typeof CustomValidationRuleSchema>;
export type ValidationRuleInput = z.infer<typeof ValidationRuleInputSchema>;

// Type narrowing helpers for handler methods
// These provide type safety similar to discriminated union Extract<>
export type QualityValidateInput = SheetsQualityInput['request'] & {
  action: 'validate';
  value: unknown;
};

export type QualityDetectConflictsInput = SheetsQualityInput['request'] & {
  action: 'detect_conflicts';
  spreadsheetId: string;
};

export type QualityResolveConflictInput = SheetsQualityInput['request'] & {
  action: 'resolve_conflict';
  conflictId: string;
  strategy: 'keep_local' | 'keep_remote' | 'merge' | 'manual';
};

export type QualityAnalyzeImpactInput = SheetsQualityInput['request'] & {
  action: 'analyze_impact';
  spreadsheetId: string;
  operation: {
    type: string;
    tool: string;
    action: string;
    params: Record<string, unknown>;
  };
};
