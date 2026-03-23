/**
 * Tool 5: sheets_format
 * Cell formatting operations (includes conditional formatting, data validation, sparklines, and rich text)
 * Format (10) + Batch (1) + Rich Text (1) + Sparklines (3) + Rules (8) = 23 actions
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  RangeInputSchema,
  CellFormatSchema,
  ColorSchema,
  ColorStyleSchema,
  TextFormatSchema,
  NumberFormatSchema,
  BorderSchema,
  BorderStyleSchema as _BorderStyleSchema,
  HorizontalAlignSchema,
  VerticalAlignSchema,
  WrapStrategySchema,
  GridRangeSchema,
  ConditionSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ResponseMetaSchema,
  A1NotationSchema,
  type ToolAnnotations,
} from './shared.js';

// Rules-related schema definitions
const InterpolationPointTypeSchema = z.preprocess(
  (val) => {
    if (typeof val !== 'string') return val;
    const normalized = val.toUpperCase();
    if (normalized === 'MIN_VALUE') return 'MIN';
    if (normalized === 'MAX_VALUE') return 'MAX';
    return normalized;
  },
  z.enum(['MIN', 'MAX', 'NUMBER', 'PERCENT', 'PERCENTILE'])
);

const BooleanRuleSchema = z.object({
  type: z.literal('boolean'),
  condition: ConditionSchema,
  format: CellFormatSchema,
});

const GradientColorPointBaseSchema = z.object({
  color: ColorSchema.optional(),
  colorStyle: ColorStyleSchema.optional(),
});

const GradientColorPointSchema = GradientColorPointBaseSchema.superRefine((value, ctx) => {
  if (!value.color && !value.colorStyle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either color or colorStyle is required',
      path: ['colorStyle'],
    });
  }
});

const requireGradientColorPoint = (
  value: z.infer<typeof GradientColorPointBaseSchema>,
  ctx: z.RefinementCtx
): void => {
  if (!GradientColorPointSchema.safeParse(value).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either color or colorStyle is required',
      path: ['colorStyle'],
    });
  }
};

const GradientEndpointSchema = z
  .object({
    type: InterpolationPointTypeSchema,
    value: z.string().optional(),
  })
  .merge(GradientColorPointBaseSchema)
  .superRefine(requireGradientColorPoint);

const GradientMidpointSchema = z
  .object({
    type: z.preprocess(
      (val) => (typeof val === 'string' ? val.toUpperCase() : val),
      z.enum(['NUMBER', 'PERCENT', 'PERCENTILE'])
    ),
    value: z.string(),
  })
  .merge(GradientColorPointBaseSchema)
  .superRefine(requireGradientColorPoint);

const GradientRuleSchema = z.object({
  type: z.literal('gradient'),
  minpoint: GradientEndpointSchema,
  midpoint: GradientMidpointSchema.optional(),
  maxpoint: GradientEndpointSchema,
});

const ConditionalFormatRuleSchema = z.discriminatedUnion('type', [
  BooleanRuleSchema,
  GradientRuleSchema,
]);

const SparklineColorInputSchema = z
  .union([ColorStyleSchema, ColorSchema])
  .describe('Sparkline color as RGB/hex/named color, or ColorStyle with rgbColor/themeColor');

// ============================================================================
// SPARKLINE SCHEMAS (3 new actions)
// ============================================================================

// Sparkline chart type
const SparklineTypeSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['LINE', 'BAR', 'COLUMN', 'WINLOSS'])
  )
  .describe(
    'Sparkline chart type (case-insensitive). LINE: continuous line chart (default). BAR: horizontal bars. COLUMN: vertical bars. WINLOSS: binary up/down for win/loss tracking.'
  );

// Sparkline configuration options
const SparklineConfigSchema = z
  .object({
    type: SparklineTypeSchema.default('LINE').describe(
      'Sparkline chart type. LINE (default): continuous line chart. BAR: horizontal bars. COLUMN: vertical bars. WINLOSS: binary up/down visualization.'
    ),
    color: SparklineColorInputSchema.optional().describe('Line/bar color'),
    negativeColor: SparklineColorInputSchema.optional().describe('Color for negative values'),
    axisColor: SparklineColorInputSchema.optional().describe('Horizontal axis line color'),
    firstColor: SparklineColorInputSchema.optional().describe('First data point highlight color'),
    lastColor: SparklineColorInputSchema.optional().describe('Last data point highlight color'),
    highColor: SparklineColorInputSchema.optional().describe('Highest value highlight color'),
    lowColor: SparklineColorInputSchema.optional().describe('Lowest value highlight color'),
    lineWidth: z.coerce
      .number()
      .min(0.5)
      .max(4)
      .optional()
      .default(1)
      .describe('Line width in pixels (LINE type only, 0.5-4)'),
    minValue: z.coerce.number().optional().describe('Custom minimum Y-axis value'),
    maxValue: z.coerce.number().optional().describe('Custom maximum Y-axis value'),
    showAxis: z.boolean().optional().default(false).describe('Show horizontal axis line'),
    rtl: z.boolean().optional().default(false).describe('Right-to-left rendering direction'),
  })
  .describe('Sparkline visualization configuration');

// ============================================================================
// INPUT SCHEMA (22 actions)
// ============================================================================

const CommonFieldsSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~50% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe('Safety options (dryRun, createSnapshot, etc.)'),
});

// ===== FORMAT ACTION SCHEMAS (10 actions) =====

const SetFormatActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('set_format')
    .describe(
      'Apply complete cell format. For a single cell or range. Use batch_format for 3+ different format changes (significantly faster).'
    ),
  range: RangeInputSchema.describe('Range to format (A1 notation or semantic)'),
  format: CellFormatSchema.describe(
    'Complete cell format specification (background, text, borders, etc.)'
  ),
}).strict();

const SuggestFormatActionSchema = CommonFieldsSchema.extend({
  action: z.literal('suggest_format').describe('Get AI-powered format suggestions'),
  range: RangeInputSchema.describe('Range to analyze for format suggestions'),
  maxSuggestions: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(3)
    .describe('Number of format suggestions to return (default: 3)'),
}).strict();

const SetBackgroundActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_background').describe('Set background color'),
  range: RangeInputSchema.describe('Range to format'),
  color: ColorSchema.describe('Background color (RGB)'),
});

const SetTextFormatActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_text_format').describe('Set text formatting'),
  range: RangeInputSchema.describe('Range to format'),
  textFormat: TextFormatSchema.describe(
    'Text format specification (font family, size, bold, italic, color, etc.)'
  ),
});

const SetNumberFormatActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_number_format').describe('Set number formatting'),
  range: RangeInputSchema.describe('Range to format'),
  numberFormat: NumberFormatSchema.describe(
    'Number format specification (type, pattern, currency symbol, etc.)'
  ),
});

const SetAlignmentActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_alignment').describe('Set cell alignment'),
  range: RangeInputSchema.describe('Range to format'),
  horizontal: HorizontalAlignSchema.optional().describe(
    'Horizontal alignment (LEFT, CENTER, RIGHT)'
  ),
  vertical: VerticalAlignSchema.optional().describe('Vertical alignment (TOP, MIDDLE, BOTTOM)'),
  wrapStrategy: WrapStrategySchema.optional().describe(
    'Text wrap strategy (OVERFLOW_CELL, LEGACY_WRAP, CLIP, WRAP)'
  ),
});

// LLM-friendly border schema: accepts boolean (true = SOLID border) or object { style, color }
const LLMBorderSchema = z.preprocess((val) => {
  // Convert true to { style: "SOLID" } and false to undefined
  if (val === true) return { style: 'SOLID' };
  if (val === false || val === null) return undefined;
  // Also handle string style directly: "SOLID" -> { style: "SOLID" }
  if (typeof val === 'string') return { style: val };
  return val;
}, BorderSchema.optional());

const SetBordersActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_borders').describe('Set cell borders'),
  range: RangeInputSchema.describe('Range to format'),
  top: LLMBorderSchema.describe('Top border: true for SOLID, or { style: "SOLID", color: {...} }'),
  bottom: LLMBorderSchema.describe(
    'Bottom border: true for SOLID, or { style: "SOLID", color: {...} }'
  ),
  left: LLMBorderSchema.describe(
    'Left border: true for SOLID, or { style: "SOLID", color: {...} }'
  ),
  right: LLMBorderSchema.describe(
    'Right border: true for SOLID, or { style: "SOLID", color: {...} }'
  ),
  innerHorizontal: LLMBorderSchema.describe('Inner horizontal borders (between rows)'),
  innerVertical: LLMBorderSchema.describe('Inner vertical borders (between columns)'),
});

const ClearFormatActionSchema = CommonFieldsSchema.extend({
  action: z.literal('clear_format').describe('Clear all formatting from cells'),
  range: RangeInputSchema.describe('Range to clear formatting from'),
});

const ApplyPresetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('apply_preset').describe('Apply a preset format style'),
  range: RangeInputSchema.describe('Range to apply preset to'),
  preset: z
    .preprocess(
      (val) => {
        if (typeof val !== 'string') return val;
        const lower = val.toLowerCase();
        // Normalize common aliases
        const aliases: Record<string, string> = {
          header: 'header_row',
          headers: 'header_row',
          header_style: 'header_row',
          alternating: 'alternating_rows',
          zebra: 'alternating_rows',
          zebra_stripes: 'alternating_rows',
          total: 'total_row',
          totals: 'total_row',
          footer: 'total_row',
          money: 'currency',
          dollars: 'currency',
          percent: 'percentage',
          pct: 'percentage',
          positive: 'highlight_positive',
          green: 'highlight_positive',
          negative: 'highlight_negative',
          red: 'highlight_negative',
        };
        return aliases[lower] ?? lower;
      },
      z.enum([
        'header_row',
        'alternating_rows',
        'total_row',
        'currency',
        'percentage',
        'date',
        'highlight_positive',
        'highlight_negative',
      ])
    )
    .describe(
      'Preset name: header_row (also: header, headers), alternating_rows (also: zebra, alternating), currency, percentage, date, highlight_positive, highlight_negative. Case-insensitive with common aliases supported.'
    ),
});

const AutoFitActionSchema = CommonFieldsSchema.extend({
  action: z.literal('auto_fit').describe('Auto-fit column width or row height to content'),
  range: RangeInputSchema.optional().describe(
    'Range to auto-fit (omit if using sheetId to fit entire sheet)'
  ),
  sheetId: SheetIdSchema.optional().describe(
    'Sheet ID to auto-fit entire sheet (alternative to range)'
  ),
  dimension: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.toUpperCase() : val),
      z.enum(['ROWS', 'COLUMNS', 'BOTH'])
    )
    .optional()
    .default('COLUMNS')
    .describe(
      'Dimension to auto-fit: ROWS, COLUMNS, or BOTH (default: COLUMNS). Case-insensitive.'
    ),
}).refine((data) => data.range || data.sheetId !== undefined, {
  message: 'Either range or sheetId must be provided',
});

// ===== SPARKLINE ACTION SCHEMAS (3 actions) =====

const SparklineAddActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('sparkline_add')
    .describe('Add a sparkline visualization to a cell using the SPARKLINE formula'),
  targetCell: A1NotationSchema.describe(
    "Target cell for sparkline (A1 notation or sheet-qualified like Sheet1!A1 or '📊 Dashboard'!G10, single cell only)"
  ),
  dataRange: RangeInputSchema.describe(
    'Data range for sparkline (should be 1D - single row or column)'
  ),
  config: SparklineConfigSchema.optional().describe('Sparkline configuration options'),
});

const SparklineGetActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('sparkline_get')
    .describe('Get sparkline formula and configuration from a cell'),
  cell: A1NotationSchema.describe(
    "Cell to get sparkline from (A1 notation or sheet-qualified like Sheet1!A1 or '📊 Dashboard'!G10)"
  ),
});

const SparklineClearActionSchema = CommonFieldsSchema.extend({
  action: z.literal('sparkline_clear').describe('Remove sparkline from a cell'),
  cell: A1NotationSchema.describe(
    "Cell to clear sparkline from (A1 notation or sheet-qualified like Sheet1!A1 or '📊 Dashboard'!G10)"
  ),
});

// ===== RULES ACTION SCHEMAS (8 actions) =====

const RuleAddConditionalFormatActionSchema = CommonFieldsSchema.extend({
  action: z.literal('rule_add_conditional_format').describe(
    `Add a conditional formatting rule to a sheet.

⚠️ COMPLEX SCHEMA: This action has strict schema requirements. For simpler usage, consider add_conditional_format_rule with presets instead.

⚠️ CRITICAL: The "rule" parameter MUST have type:"boolean" OR type:"gradient" — no other types allowed!`
  ),
  sheetId: SheetIdSchema.describe('Numeric sheet ID where rule will be applied'),
  range: RangeInputSchema.describe('Range for the conditional format rule'),
  rule: ConditionalFormatRuleSchema.describe(
    `Conditional format rule object. MUST specify type first!

✅ TYPE 1: BOOLEAN RULE (condition-based)
{
  type: "boolean",  ← REQUIRED
  condition: {
    type: "TEXT_CONTAINS",  ← Condition type
    values: [{ userEnteredValue: "error" }]  ← Values as objects
  },
  format: {
    backgroundColor: { red: 1, green: 0.5, blue: 0.5 },
    textFormat: { bold: true }
  }
}

Other condition types: NUMBER_GREATER, NUMBER_LESS, NUMBER_BETWEEN, TEXT_IS_EMAIL, TEXT_IS_URL, DATE_BEFORE, BLANK, NOT_BLANK, CUSTOM_FORMULA

✅ TYPE 2: GRADIENT RULE (color scale/heat map)
{
  type: "gradient",  ← REQUIRED
  minpoint: { type: "MIN", color: { red: 0, green: 1, blue: 0 } },
  midpoint: { type: "PERCENT", value: "50", color: { red: 1, green: 1, blue: 0 } },  ← Optional
  maxpoint: { type: "MAX", color: { red: 1, green: 0, blue: 0 } }
}

Minpoint/maxpoint types: MIN, MAX, NUMBER, PERCENT, PERCENTILE

❌ COMMON MISTAKE: Omitting type field or using wrong type value causes "invalid_union" error
✅ SIMPLER ALTERNATIVE: Use add_conditional_format_rule with rulePreset for common cases (highlight_duplicates, color_scale_green_red, etc.)`
  ),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Position to insert rule (0 = first, omit = append to end)'),
  // Internal sentinel set by normalizeFormatRequest when multiple ranges are provided
  _multiRange: z.boolean().optional(),
})
  .superRefine((input, ctx) => {
    if (input._multiRange === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'exactly one target range is required. Split into multiple rule_add_conditional_format calls for multiple ranges.',
        path: ['ranges'],
      });
    }
  })
  .transform(({ _multiRange: _, ...rest }) => rest);

const RuleUpdateConditionalFormatActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('rule_update_conditional_format')
    .describe('Update a conditional formatting rule'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID containing the rule'),
  ruleIndex: z.coerce.number().int().min(0).describe('Zero-based index of the rule to update'),
  range: RangeInputSchema.optional().describe('New range for the rule'),
  rule: ConditionalFormatRuleSchema.optional().describe('New rule definition'),
  newIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('New position for the rule (omit to keep current position)'),
});

const RuleDeleteConditionalFormatActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('rule_delete_conditional_format')
    .describe('Delete a conditional formatting rule'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID containing the rule'),
  ruleIndex: z.coerce.number().int().min(0).describe('Zero-based index of the rule to delete'),
});

const RuleListConditionalFormatsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('rule_list_conditional_formats')
    .describe('List all conditional formatting rules on a sheet'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID to list rules from'),
});

const SetDataValidationActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('set_data_validation')
    .describe(
      'Add data validation to a range. Example: { "action": "set_data_validation", "range": "A1:A10", "condition": { "type": "ONE_OF_LIST", "values": ["Yes", "No", "Maybe"] } }'
    ),
  range: RangeInputSchema.describe('Range to apply validation to'),
  condition: ConditionSchema.describe(
    'Validation condition. Required: type (condition type), values (array of strings). Types: ONE_OF_LIST (dropdown), NUMBER_BETWEEN/NUMBER_GREATER/NUMBER_LESS (numeric), TEXT_CONTAINS/TEXT_IS_EMAIL/TEXT_IS_URL (text), DATE_BEFORE/DATE_AFTER (date), BLANK/NOT_BLANK (empty check), CUSTOM_FORMULA. Example: { "type": "ONE_OF_LIST", "values": ["Yes", "No"] }'
  ),
  inputMessage: z
    .string()
    .max(500, 'Input message exceeds Google Sheets limit of 500 characters')
    .optional()
    .describe('Help text shown when cell is selected (max 500 chars)'),
  strict: z
    .boolean()
    .optional()
    .default(true)
    .describe('If true, reject invalid input; if false, show warning (default: true)'),
  showDropdown: z
    .boolean()
    .optional()
    .default(true)
    .describe('Show dropdown for list validations (default: true)'),
});

const ClearDataValidationActionSchema = CommonFieldsSchema.extend({
  action: z.literal('clear_data_validation').describe('Clear data validation from a range'),
  range: RangeInputSchema.describe('Range to clear validation from'),
});

const ListDataValidationsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_data_validations').describe('List data validations on a sheet or range'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID to list validations from'),
  range: RangeInputSchema.optional().describe(
    'Optional range to limit validation scan (e.g., "A1:Z100"). REQUIRED for sheets >10K cells to prevent timeout. If omitted, scans entire sheet (may timeout on large sheets).'
  ),
  cursor: z
    .string()
    .optional()
    .describe('Pagination cursor from previous response (numeric offset encoded as string)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Maximum number of validation rules to return (default: 50, max: 500)'),
});

const AddConditionalFormatRuleActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_conditional_format_rule').describe(
    `Add a preset conditional formatting rule (RECOMMENDED over rule_add_conditional_format).

✅ SIMPLER ALTERNATIVE: This action uses presets instead of complex rule objects — much easier than rule_add_conditional_format!

Common presets: highlight_duplicates, highlight_blanks, highlight_errors, color_scale_green_red, data_bars, top_10_percent, bottom_10_percent

Use this UNLESS you need highly custom rules (then use rule_add_conditional_format).`
  ),
  sheetId: SheetIdSchema.optional().describe(
    'Numeric sheet ID where rule will be applied. Optional — auto-derived from the range sheet name when omitted.'
  ),
  range: RangeInputSchema.describe('Range for the preset rule'),
  rulePreset: z
    .preprocess(
      (val) => {
        if (typeof val === 'string') {
          // Normalize common variations - support many LLM naming patterns
          const normalized = val.toLowerCase().replace(/[\s-]/g, '_');
          const aliases: Record<string, string> = {
            // Duplicates
            duplicates: 'highlight_duplicates',
            duplicate: 'highlight_duplicates',
            find_duplicates: 'highlight_duplicates',
            show_duplicates: 'highlight_duplicates',
            // Blanks
            blanks: 'highlight_blanks',
            blank: 'highlight_blanks',
            empty: 'highlight_blanks',
            empty_cells: 'highlight_blanks',
            highlight_empty: 'highlight_blanks',
            // Errors
            errors: 'highlight_errors',
            error: 'highlight_errors',
            error_cells: 'highlight_errors',
            show_errors: 'highlight_errors',
            // Color scales
            green_red: 'color_scale_green_red',
            red_green: 'color_scale_green_red',
            green_to_red: 'color_scale_green_red',
            red_to_green: 'color_scale_green_red',
            heat_map: 'color_scale_green_red',
            heatmap: 'color_scale_green_red',
            blue_red: 'color_scale_blue_red',
            red_blue: 'color_scale_blue_red',
            blue_to_red: 'color_scale_blue_red',
            // Data bars (any color variation maps to data_bars)
            data_bar: 'data_bars',
            databars: 'data_bars',
            bar: 'data_bars',
            bars: 'data_bars',
            progress_bar: 'data_bars',
            data_bar_blue: 'data_bars',
            data_bar_green: 'data_bars',
            data_bar_red: 'data_bars',
            data_bars_blue: 'data_bars',
            data_bars_green: 'data_bars',
            data_bars_red: 'data_bars',
            blue_bars: 'data_bars',
            green_bars: 'data_bars',
            red_bars: 'data_bars',
            // Top/Bottom percentiles
            top_10: 'top_10_percent',
            top10: 'top_10_percent',
            top_ten: 'top_10_percent',
            top_values: 'top_10_percent',
            highest: 'top_10_percent',
            bottom_10: 'bottom_10_percent',
            bottom10: 'bottom_10_percent',
            bottom_ten: 'bottom_10_percent',
            bottom_values: 'bottom_10_percent',
            lowest: 'bottom_10_percent',
            // Above/Below average
            above_avg: 'above_average',
            above_mean: 'above_average',
            above: 'above_average',
            greater_than_average: 'above_average',
            positive: 'above_average',
            positive_numbers: 'above_average',
            highlight_positive: 'above_average',
            below_avg: 'below_average',
            below_mean: 'below_average',
            below: 'below_average',
            less_than_average: 'below_average',
            negative: 'below_average',
            negative_numbers: 'below_average',
            highlight_negative: 'below_average',
            // Financial: negative red / positive green
            negative_red_positive_green: 'negative_red_positive_green',
            red_green_numbers: 'negative_red_positive_green',
            financial: 'negative_red_positive_green',
            pnl: 'negative_red_positive_green',
            profit_loss: 'negative_red_positive_green',
            accounting: 'negative_red_positive_green',
            negative_red: 'negative_red_positive_green',
            // Traffic light (red/yellow/green gradient)
            traffic_light: 'traffic_light',
            stoplight: 'traffic_light',
            rag: 'traffic_light',
            red_amber_green: 'traffic_light',
            red_yellow_green: 'traffic_light',
            // Variance highlight (>±10%)
            variance: 'variance_highlight',
            variance_highlight: 'variance_highlight',
            budget_variance: 'variance_highlight',
            deviation: 'variance_highlight',
          };
          return aliases[normalized] || normalized;
        }
        return val;
      },
      z.enum([
        'highlight_duplicates',
        'highlight_blanks',
        'highlight_errors',
        'color_scale_green_red',
        'color_scale_blue_red',
        'data_bars',
        'top_10_percent',
        'bottom_10_percent',
        'above_average',
        'below_average',
        'negative_red_positive_green',
        'traffic_light',
        'variance_highlight',
      ])
    )
    .describe(
      'Preset rule type. Accepts many aliases: duplicates, blanks, errors, green_red/heatmap, blue_red, data_bars/bars, top_10/highest, bottom_10/lowest, above_avg/positive, below_avg/negative, financial/pnl/negative_red_positive_green, traffic_light/rag/stoplight, variance/budget_variance'
    ),
});

// ============================================================================
// BATCH FORMAT SCHEMA (1 new action)
// ============================================================================

/**
 * Individual operation within a batch_format call.
 * Each operation specifies a type, range, and type-specific parameters.
 * All operations are combined into a single Google Sheets batchUpdate API call.
 */
const BatchFormatOperationSchema = z.preprocess(
  (val) => {
    if (typeof val !== 'object' || val === null) return val;
    const op = { ...(val as Record<string, unknown>) };

    // Normalize set_* aliases → batch_format operation types.
    // Individual format actions use set_background, set_text_format, etc. but
    // batch_format operations use shorter names (background, text_format, etc.).
    // Accept both conventions to prevent first-try failures.
    const typeAliases: Record<string, string> = {
      set_background: 'background',
      set_text_format: 'text_format',
      set_number_format: 'number_format',
      set_alignment: 'alignment',
      set_borders: 'borders',
      set_format: 'format',
      apply_preset: 'preset',
    };
    const aliased = typeof op['type'] === 'string' ? typeAliases[op['type']] : undefined;
    if (aliased) {
      op['type'] = aliased;
    }

    // Infer type from fields when absent
    if (op['type'] === undefined) {
      const hasColor = op['color'] !== undefined;
      const hasTextFormat = op['textFormat'] !== undefined;
      const hasFormatTextFormat =
        op['format'] !== undefined &&
        typeof op['format'] === 'object' &&
        op['format'] !== null &&
        'textFormat' in (op['format'] as object);

      if (hasColor && hasFormatTextFormat) {
        // Mark as ambiguous so superRefine can produce a targeted error
        op['_ambiguous'] = true;
      } else if (hasTextFormat) {
        op['type'] = 'text_format';
      } else if (hasColor) {
        op['type'] = 'background';
      }
    }

    return op;
  },
  z
    .object({
      type: z
        .enum([
          'background',
          'text_format',
          'number_format',
          'alignment',
          'borders',
          'format',
          'preset',
        ])
        .optional()
        .describe(
          'Operation type: background (set color), text_format (bold/italic/font), number_format (currency/percentage), alignment (left/center/right), borders (cell borders), format (full CellFormat), preset (header_row/alternating_rows/etc.)'
        ),
      range: RangeInputSchema.describe('Range to apply this format operation to (A1 notation)'),
      // Type-specific fields (all optional, validated by handler based on type)
      color: ColorSchema.optional().describe('Background color (for type: "background")'),
      textFormat: TextFormatSchema.optional().describe(
        'Text format spec (for type: "text_format")'
      ),
      numberFormat: NumberFormatSchema.optional().describe(
        'Number format spec (for type: "number_format")'
      ),
      horizontal: HorizontalAlignSchema.optional().describe(
        'Horizontal alignment (for type: "alignment")'
      ),
      vertical: VerticalAlignSchema.optional().describe(
        'Vertical alignment (for type: "alignment")'
      ),
      wrapStrategy: WrapStrategySchema.optional().describe('Wrap strategy (for type: "alignment")'),
      top: LLMBorderSchema.describe('Top border (for type: "borders")'),
      bottom: LLMBorderSchema.describe('Bottom border (for type: "borders")'),
      left: LLMBorderSchema.describe('Left border (for type: "borders")'),
      right: LLMBorderSchema.describe('Right border (for type: "borders")'),
      innerHorizontal: LLMBorderSchema.describe('Inner horizontal borders (for type: "borders")'),
      innerVertical: LLMBorderSchema.describe('Inner vertical borders (for type: "borders")'),
      format: CellFormatSchema.optional().describe(
        'Full cell format specification (for type: "format")'
      ),
      preset: z
        .enum([
          'header_row',
          'alternating_rows',
          'total_row',
          'currency',
          'percentage',
          'date',
          'highlight_positive',
          'highlight_negative',
        ])
        .optional()
        .describe('Preset name (for type: "preset")'),
    })
    .superRefine((op, ctx) => {
      if (op.type === undefined) {
        // Check for ambiguous case: both color and format.textFormat are present
        const hasColor = op.color !== undefined;
        const hasFormatTextFormat =
          op.format !== undefined &&
          typeof op.format === 'object' &&
          op.format !== null &&
          'textFormat' in op.format;

        if (hasColor && hasFormatTextFormat) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'ambiguous operation: both color and format.textFormat are present. Specify an explicit type field.',
            path: ['type'],
          });
        } else {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'type is required',
            path: ['type'],
          });
        }
      }
    })
    .describe('Single format operation within a batch')
);

const BatchFormatActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('batch_format')
    .describe(
      'Combine multiple format operations into one API call. 80-95% faster than calling set_format repeatedly. More efficient than set_format for 3+ different format changes.'
    ),
  operations: z
    .array(BatchFormatOperationSchema)
    .min(1)
    .max(100)
    .describe(
      'Array of format operations to apply in one batch. Each operation specifies a type, range, and type-specific parameters. All are sent as a single Google Sheets API call.'
    ),
});

// ============================================================================
// RICH TEXT SCHEMA (1 new action)
// ============================================================================

/**
 * A text run within a rich text cell — a substring with its own formatting.
 */
const TextRunSchema = z.object({
  text: z.string().describe('The text content of this run'),
  format: TextFormatSchema.optional().describe(
    'Formatting for this text run (bold, italic, color, etc.)'
  ),
});

const SetRichTextActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('set_rich_text')
    .describe(
      'Set rich text formatting within a single cell — allows different formatting per text segment (e.g., bold first word, italic rest)'
    ),
  cell: z
    .string()
    .regex(
      /^(?:(?:'[^']+'|[A-Za-z0-9_ ]+)!)?[A-Z]{1,3}\d+$/,
      'Invalid cell reference (expected A1 notation like A1 or Sheet1!A1)'
    )
    .describe('Target cell in A1 notation (e.g., "A1" or "Sheet1!B2")'),
  runs: z
    .array(TextRunSchema)
    .min(1)
    .max(100)
    .describe(
      'Array of text runs, each with text content and optional formatting. Runs are concatenated in order to form the cell value.'
    ),
});

// Preprocess to normalize common LLM input variations for format actions
const normalizeFormatRequest = (val: unknown): unknown => {
  if (typeof val !== 'object' || val === null) return val;
  const obj = val as Record<string, unknown>;
  const action = obj['action'] as string;

  // Normalize flattened validation params for set_data_validation
  // LLMs often send: { validationType: "ONE_OF_LIST", values: [...] }
  // Schema expects: { condition: { type: "ONE_OF_LIST", values: [...] } }
  if (action === 'set_data_validation') {
    let condition = obj['condition'] as Record<string, unknown> | undefined;

    // Handle rule: { condition: {...} } wrapper pattern (Google API format)
    // LLMs sometimes copy the Google API structure: { rule: { condition: {...} } }
    const rule = obj['rule'] as Record<string, unknown> | undefined;
    if (!condition && rule?.['condition']) {
      condition = rule['condition'] as Record<string, unknown>;
    }

    // Normalize values array: convert [{ userEnteredValue: "..." }] to ["..."]
    if (condition?.['values'] && Array.isArray(condition['values'])) {
      const values = condition['values'] as unknown[];
      const normalizedValues = values.map((v) => {
        if (typeof v === 'object' && v !== null && 'userEnteredValue' in v) {
          return (v as { userEnteredValue: string }).userEnteredValue;
        }
        return v;
      });
      condition = { ...condition, values: normalizedValues };
    }

    if (condition) {
      const { rule: _r, ...rest } = obj;
      return { ...rest, condition };
    }

    // FIX P1-3: Handle dropdownValues shortcut
    // LLMs often send: { dropdownValues: ["A", "B", "C"] } instead of condition object
    const dropdownValues = obj['dropdownValues'] as unknown[] | undefined;
    if (dropdownValues && Array.isArray(dropdownValues) && !obj['condition']) {
      const { dropdownValues: _dv, ...rest } = obj;
      return {
        ...rest,
        condition: { type: 'ONE_OF_LIST', values: dropdownValues },
      };
    }

    // Also handle flattened format: { validationType: "ONE_OF_LIST", values: [...] }
    const validationType = obj['validationType'] as string | undefined;
    const values = obj['values'] as unknown[] | undefined;

    if (validationType || values) {
      const newCondition: Record<string, unknown> = {};
      if (validationType) newCondition['type'] = validationType;
      if (values) newCondition['values'] = values;

      // Return new object with condition, removing flattened fields
      const { validationType: _vt, values: _v, ...rest } = obj;
      return { ...rest, condition: newCondition };
    }
  }

  // Normalize Google Sheets API-style payload for rule_add_conditional_format
  // LLMs copying from Google API docs may send: { ranges: [...], booleanRule: { condition, format } }
  if (action === 'rule_add_conditional_format') {
    let normalized = { ...obj };

    if (Array.isArray(normalized['ranges']) && normalized['range'] === undefined) {
      const ranges = normalized['ranges'] as Record<string, unknown>[];
      if (ranges.length > 1) {
        // Multi-range: mark for rejection via superRefine in schema
        normalized['_multiRange'] = true;
        // Still need to provide required fields so schema validation reaches superRefine
        // Set sheetId from the first range, provide required fields so superRefine is reached
        const firstRange = ranges[0]!;
        if (normalized['sheetId'] === undefined && firstRange['sheetId'] !== undefined) {
          normalized['sheetId'] = firstRange['sheetId'];
        }
        // Provide a valid range so schema doesn't fail before superRefine
        normalized['range'] = { grid: firstRange };
      } else if (ranges.length === 1) {
        const gridRange = ranges[0]!;
        // Extract sheetId from the first range
        if (normalized['sheetId'] === undefined && gridRange['sheetId'] !== undefined) {
          normalized['sheetId'] = gridRange['sheetId'];
        }
        normalized['range'] = { grid: gridRange };
        delete normalized['ranges'];
      }
    }

    // Normalize booleanRule → rule (Google Sheets API format)
    if (normalized['booleanRule'] !== undefined && normalized['rule'] === undefined) {
      const booleanRule = normalized['booleanRule'] as Record<string, unknown>;
      normalized['rule'] = {
        type: 'boolean',
        condition: booleanRule['condition'],
        format: booleanRule['format'],
      };
      delete normalized['booleanRule'];
    }

    // QA-2.4: Auto-infer rule.type when missing
    if (normalized['rule'] && typeof normalized['rule'] === 'object') {
      const rule = normalized['rule'] as Record<string, unknown>;
      if (!rule['type']) {
        if (rule['minpoint'] || rule['maxpoint'] || rule['gradientRule']) {
          rule['type'] = 'gradient';
        } else if (rule['condition'] || rule['format']) {
          rule['type'] = 'boolean';
        } else {
          rule['type'] = 'boolean';
        }
      }
    }

    return normalized;
  }

  // Handle rulePreset: "custom" - convert to rule_add_conditional_format with proper rule structure
  // Claude often sends: { action: "add_conditional_format_rule", rulePreset: "custom", customFormula: "=...", backgroundColor: {...} }
  // or: { action: "add_conditional_format_rule", rulePreset: "custom", customRule: { type, formula, format } }
  // or: { action: "add_conditional_format_rule", rulePreset: "custom", condition: {...}, format: {...} }
  if (action === 'add_conditional_format_rule' && obj['rulePreset'] === 'custom') {
    const customFormula = obj['customFormula'] as string | undefined;
    const customRule = obj['customRule'] as Record<string, unknown> | undefined;
    const condition = obj['condition'] as Record<string, unknown> | undefined;
    const format = obj['format'] as Record<string, unknown> | undefined;
    const backgroundColor = obj['backgroundColor'] as Record<string, unknown> | undefined;

    // Build the rule structure
    let rule: Record<string, unknown> | undefined;

    if (customFormula) {
      // Pattern: { customFormula: "=...", backgroundColor: {...} }
      rule = {
        type: 'boolean',
        condition: {
          type: 'CUSTOM_FORMULA',
          values: [{ userEnteredValue: customFormula }],
        },
        format: backgroundColor ? { backgroundColor } : format || {},
      };
    } else if (customRule) {
      // Pattern: { customRule: { type: "CUSTOM_FORMULA", formula: "=...", format: {...} } }
      const formula = customRule['formula'] as string | undefined;
      const ruleFormat = customRule['format'] as Record<string, unknown> | undefined;
      rule = {
        type: 'boolean',
        condition: {
          type: customRule['type'] || 'CUSTOM_FORMULA',
          values: formula ? [{ userEnteredValue: formula }] : [],
        },
        format: ruleFormat || {},
      };
    } else if (condition) {
      // Pattern: { condition: { type: "NUMBER_GREATER", values: [...] }, format: {...} }
      rule = {
        type: 'boolean',
        condition,
        format: format || {},
      };
    }

    if (rule) {
      // Convert to rule_add_conditional_format action
      const {
        rulePreset: _rp,
        customFormula: _cf,
        customRule: _cr,
        condition: _c,
        format: _f,
        backgroundColor: _bg,
        ...rest
      } = obj;
      return {
        ...rest,
        action: 'rule_add_conditional_format',
        rule,
      };
    }
  }

  return val;
};

const GenerateConditionalFormatActionSchema = CommonFieldsSchema.extend({
  action: z.literal('generate_conditional_format').describe(
    `Generate and apply a conditional format rule from a natural language description.

Examples:
  "highlight cells greater than 100 in red"
  "color scale green to red"
  "bold cells containing 'error'"
  "highlight blanks in yellow"
  "above average values in green"
  "top 10% in blue"

Parses the description into the correct rule type and applies it to the range.`
  ),
  description: z
    .string()
    .min(3)
    .describe('Natural language description of the rule (e.g., "highlight values > 100 in red")'),
  range: RangeInputSchema.describe('Range to apply the rule to (A1 notation)'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID where rule will be applied'),
  applyImmediately: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'If true (default), applies the rule immediately. If false, returns the rule JSON without applying.'
    ),
});

const BuildDependentDropdownActionSchema = z
  .object({
    action: z.literal('build_dependent_dropdown'),
    spreadsheetId: SpreadsheetIdSchema.describe(
      'ID of the spreadsheet. Example: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"'
    ),
    parentRange: z
      .string()
      .describe(
        'A1 notation range of the parent (level-1) dropdown cells. ' +
          'These cells will get a simple dropdown of unique values from the lookup table. ' +
          'Example: "Sheet1!A2:A100"'
      ),
    dependentRange: z
      .string()
      .describe(
        'A1 notation range of the dependent (level-2) dropdown cells. ' +
          'Each cell in this range will show options based on the corresponding parent cell. ' +
          'Must be same number of rows as parentRange. Example: "Sheet1!B2:B100"'
      ),
    lookupSheet: z
      .string()
      .describe(
        'Name of the lookup table sheet. ' +
          'Column A must contain parent values. Subsequent columns contain child options for each parent. ' +
          'Example: A1=USA, B1=California, C1=Texas / A2=Canada, B2=Ontario, C2=Quebec. ' +
          'Sheet name: "Lookup"'
      ),
    verbosity: z
      .enum(['minimal', 'standard', 'detailed'])
      .optional()
      .default('standard')
      .describe('Response detail level'),
  })
  .describe(
    'Create dependent dropdown validation where the options in column B depend on the selection in column A. ' +
      'Handles the full workflow: reads unique parent values from lookup table, creates named ranges ' +
      'for each parent group, sets INDIRECT formula-based validation on the dependent column. ' +
      'Requires a lookup table sheet where column A = parent values and columns B+ = child options per parent. ' +
      'Example: parentRange:"Sheet1!A2:A100" dependentRange:"Sheet1!B2:B100" lookupSheet:"Lookup"'
  );

/**
 * All format operation inputs (cell formatting and rules)
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsFormatInputSchema = z.object({
  request: z.preprocess(
    normalizeFormatRequest,
    z.discriminatedUnion('action', [
      // Format actions (10)
      SetFormatActionSchema,
      SuggestFormatActionSchema,
      SetBackgroundActionSchema,
      SetTextFormatActionSchema,
      SetNumberFormatActionSchema,
      SetAlignmentActionSchema,
      SetBordersActionSchema,
      ClearFormatActionSchema,
      ApplyPresetActionSchema,
      AutoFitActionSchema,
      // Batch format (1)
      BatchFormatActionSchema,
      // Sparkline actions (3)
      SparklineAddActionSchema,
      SparklineGetActionSchema,
      SparklineClearActionSchema,
      // Rich text (1)
      SetRichTextActionSchema,
      // Rules actions (8)
      RuleAddConditionalFormatActionSchema,
      RuleUpdateConditionalFormatActionSchema,
      RuleDeleteConditionalFormatActionSchema,
      RuleListConditionalFormatsActionSchema,
      SetDataValidationActionSchema,
      ClearDataValidationActionSchema,
      ListDataValidationsActionSchema,
      AddConditionalFormatRuleActionSchema,
      GenerateConditionalFormatActionSchema,
      BuildDependentDropdownActionSchema,
    ])
  ),
});

const FormatResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // Format response fields
    cellsFormatted: z.coerce.number().int().optional(),
    // Batch format response fields
    operationsApplied: z.coerce
      .number()
      .int()
      .optional()
      .describe('Number of operations applied (for batch_format)'),
    apiCallsSaved: z.coerce
      .number()
      .int()
      .optional()
      .describe('Number of API calls saved by batching'),
    suggestions: z
      .array(
        z.object({
          title: z.string(),
          explanation: z.string(),
          confidence: z.coerce.number().min(0).max(100),
          reasoning: z.string(),
          formatOptions: z.object({
            backgroundColor: ColorSchema.optional(),
            textFormat: TextFormatSchema.optional(),
            numberFormat: NumberFormatSchema.optional(),
            borders: z.boolean().optional(),
            alignment: z.enum(['LEFT', 'CENTER', 'RIGHT']).optional(),
          }),
        })
      )
      .optional()
      .describe('Format suggestions (for suggest_format action)'),
    // Rich text response fields
    runsApplied: z.coerce
      .number()
      .int()
      .optional()
      .describe('Number of text runs applied (set_rich_text)'),
    textLength: z.coerce.number().int().optional().describe('Total text length (set_rich_text)'),
    // Sparkline response fields
    cell: z.string().optional().describe('Target cell for sparkline or rich text operation'),
    formula: z.string().optional().describe('SPARKLINE formula (for sparkline_get/sparkline_add)'),
    // Rules response fields
    ruleIndex: z.coerce.number().int().optional().describe('Index of added/updated rule'),
    rules: z
      .array(
        z.object({
          index: z.coerce.number().int(),
          ranges: z.array(GridRangeSchema),
          type: z.string(),
        })
      )
      .optional()
      .describe('List of conditional format rules'),
    validations: z
      .array(
        z.object({
          range: GridRangeSchema,
          condition: ConditionSchema,
        })
      )
      .optional()
      .describe('List of data validation rules'),
    // Pagination fields (list_data_validations)
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for next page (pass as cursor in next request)'),
    hasMore: z.boolean().optional().describe('True if more results are available'),
    totalCount: z.coerce
      .number()
      .int()
      .optional()
      .describe('Total number of validation rules found'),
    rulePreview: z
      .object({
        affectedRanges: z.array(GridRangeSchema).describe('Ranges that would be affected'),
        affectedCells: z.coerce.number().int().describe('Total number of cells affected'),
        existingRules: z
          .number()
          .int()
          .optional()
          .describe('Number of existing rules on these ranges'),
        conflicts: z
          .array(
            z.object({
              range: GridRangeSchema,
              existingRuleIndex: z.coerce.number().int(),
              conflictType: z.enum(['overlap', 'priority', 'condition_conflict']),
            })
          )
          .optional()
          .describe('Potential conflicts with existing rules'),
      })
      .optional()
      .describe('Preview of rule application (when dryRun=true)'),
    // Common response fields
    dryRun: z.boolean().optional(),
    mutation: MutationSummarySchema.optional(),
    snapshotId: z.string().optional().describe('Snapshot ID for rollback (if created)'),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsFormatOutputSchema = z.object({
  response: FormatResponseSchema,
});

export const SHEETS_FORMAT_ANNOTATIONS: ToolAnnotations = {
  title: 'Cell Formatting & Rules',
  readOnlyHint: false,
  destructiveHint: true, // Now includes rule deletion actions
  idempotentHint: true,
  openWorldHint: true,
};

export type SheetsFormatInput = z.infer<typeof SheetsFormatInputSchema>;
export type SheetsFormatOutput = z.infer<typeof SheetsFormatOutputSchema>;
export type FormatResponse = z.infer<typeof FormatResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type FormatRequest = SheetsFormatInput['request'];

// Note: Type narrowing helpers are not needed with discriminated unions.
// TypeScript automatically narrows types in switch statements based on the action field.
