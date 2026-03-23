/**
 * Tool: sheets_visualize
 * Consolidated chart and pivot table visualization operations
 * Charts (11 actions) + Pivot tables (7 actions) = 18 actions
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  RangeInputSchema,
  GridRangeSchema,
  ChartTypeSchema,
  LegendPositionSchema,
  ChartPositionSchema,
  ColorSchema,
  ColorStyleSchema,
  TextFormatSchema,
  SummarizeFunctionSchema,
  SortOrderSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ResponseMetaSchema,
  type ToolAnnotations,
  type RangeInput,
} from './shared.js';

// ============================================================================
// CHART SCHEMAS (from charts.ts)
// ============================================================================

// Trendline type enum - supported by LINE, AREA, SCATTER, STEPPED_AREA, COLUMN charts
const TrendlineTypeSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['LINEAR', 'EXPONENTIAL', 'POLYNOMIAL', 'POWER', 'LOGARITHMIC', 'MOVING_AVERAGE'])
  )
  .describe(
    'Trendline type (case-insensitive). LINEAR: straight line fit (most common). EXPONENTIAL: for growth/decay data. POLYNOMIAL: curved fit (requires polynomialDegree 2-6). LOGARITHMIC: for diminishing returns. POWER: for power-law relationships. MOVING_AVERAGE: smoothing with period parameter.'
  );

// Trendline configuration for chart series
const TrendlineSchema = z
  .object({
    type: TrendlineTypeSchema.describe('Trendline type'),
    polynomialDegree: z.coerce
      .number()
      .int()
      .min(2)
      .max(6)
      .optional()
      .describe(
        'Degree for POLYNOMIAL type. Required when type=POLYNOMIAL. Typical values: 2 (quadratic), 3 (cubic). Higher values (4-6) risk overfitting. Omitting this when type=POLYNOMIAL will cause an error.'
      ),
    label: z.string().max(255).optional().describe('Custom label for trendline'),
    showEquation: z
      .boolean()
      .optional()
      .default(false)
      .describe('Display regression equation on chart'),
    showRSquared: z
      .boolean()
      .optional()
      .default(false)
      .describe('Display R-squared value on chart'),
    color: ColorSchema.optional().describe('Trendline color (defaults to series color)'),
  })
  .describe('Trendline configuration for visualizing data trends');

// Data label placement options
const DataLabelPlacementSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum([
      'CENTER',
      'LEFT',
      'RIGHT',
      'ABOVE',
      'BELOW',
      'INSIDE_END',
      'INSIDE_BASE',
      'OUTSIDE_END',
    ])
  )
  .describe('Data label placement (case-insensitive)');

// Data label type - what to display
const DataLabelTypeSchema = z
  .preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['NONE', 'DATA', 'CUSTOM'])
  )
  .describe('Data label type (case-insensitive)');

// Data label configuration for chart series
const DataLabelSchema = z
  .object({
    type: DataLabelTypeSchema.default('DATA').describe(
      'What to label: DATA (values), CUSTOM (from range), NONE'
    ),
    placement: DataLabelPlacementSchema.optional().describe(
      'Label position relative to data point'
    ),
    textFormat: TextFormatSchema.optional().describe('Text formatting for labels'),
  })
  .describe('Data label configuration for displaying values on chart points');

// Chart series with optional trendline and data labels
const ChartSeriesSchema = z.object({
  column: z.coerce.number().int().min(0).describe('Column index (0-based) for series data'),
  color: ColorSchema.optional().describe('Series color (RGB)'),
  colorStyle: ColorStyleSchema.optional().describe('Series color as RGB or theme color'),
  trendline: TrendlineSchema.optional().describe('Add trendline to this series'),
  dataLabel: DataLabelSchema.optional().describe('Configure data labels for this series'),
});

/**
 * Chart-specific range schema that accepts:
 * 1. Standard RangeInput (structured object with a1, namedRange, semantic, or grid)
 * 2. Direct string including comma-separated ranges for multi-series charts
 *
 * This is more permissive than A1NotationSchema to support chart requirements
 * where multiple non-contiguous ranges are needed (e.g., "Sheet1!A1:A10,Sheet1!D1:D10")
 */
const ChartRangeSchema = z.union([
  RangeInputSchema,
  z
    .string()
    .min(1)
    .max(500)
    .transform((val) => ({ a1: val }))
    .describe(
      'A1 notation range(s). For multiple ranges, use comma-separated: "Sheet1!A1:A10,Sheet1!D1:D10"'
    ),
]);

const ChartDataSchema = z.object({
  sourceRange: ChartRangeSchema.describe(
    'Chart data source. Accepts A1 notation, comma-separated ranges for multi-series, or structured input {a1: "..."}.'
  ),
  series: z
    .array(ChartSeriesSchema)
    .optional()
    .describe('Data series with optional trendlines and data labels'),
  categories: z.coerce.number().int().min(0).optional(),
  aggregateType: z
    .enum([
      'AVERAGE',
      'COUNT',
      'COUNTA',
      'COUNTUNIQUE',
      'MAX',
      'MEDIAN',
      'MIN',
      'STDEV',
      'STDEVP',
      'SUM',
      'VAR',
      'VARP',
    ])
    .optional(),
});

// ISSUE-198: Per-axis configuration (min/max/title) for BasicChart types
const ChartAxisConfigSchema = z.object({
  title: z.string().optional().describe('Axis title label'),
  min: z.number().optional().describe('Minimum value for axis (sets viewWindowMode to EXPLICIT)'),
  max: z.number().optional().describe('Maximum value for axis (sets viewWindowMode to EXPLICIT)'),
});

const ChartOptionsSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  legendPosition: LegendPositionSchema.optional(),
  backgroundColor: ColorSchema.optional(),
  backgroundColorStyle: ColorStyleSchema.optional().describe(
    'Background color as RGB or theme color (Google Sheets API v4 ColorStyle)'
  ),
  is3D: z.boolean().optional(),
  pieHole: z.coerce.number().min(0).max(1).optional(),
  stacked: z.boolean().optional(),
  lineSmooth: z.boolean().optional(),
  /** @deprecated Use axes.horizontal.title and axes.vertical.title instead */
  axisTitle: z
    .object({
      horizontal: z.string().optional(),
      vertical: z.string().optional(),
    })
    .optional()
    .describe('Axis titles (deprecated: use axes.horizontal.title / axes.vertical.title)'),
  // ISSUE-198: Full axis configuration with min/max bounds
  axes: z
    .object({
      horizontal: ChartAxisConfigSchema.optional().describe(
        'Horizontal (X / BOTTOM_AXIS) configuration'
      ),
      vertical: ChartAxisConfigSchema.optional().describe('Vertical (Y / LEFT_AXIS) configuration'),
    })
    .optional()
    .describe(
      'Axis configuration. Example: { axes: { vertical: { title: "Revenue", min: 0, max: 1000000 } } }'
    ),
});

// ============================================================================
// PIVOT SCHEMAS (from pivot.ts)
// ============================================================================

const PivotGroupSchema = z.object({
  sourceColumnOffset: z.coerce.number().int().min(0),
  sortOrder: SortOrderSchema.optional(),
  showTotals: z.boolean().optional().default(true),
  groupRule: z
    .object({
      dateTimeRule: z
        .object({
          type: z.enum([
            'SECOND',
            'MINUTE',
            'HOUR',
            'DAY_OF_WEEK',
            'DAY_OF_YEAR',
            'DAY_OF_MONTH',
            'WEEK_OF_YEAR',
            'MONTH',
            'QUARTER',
            'YEAR',
            'YEAR_MONTH',
            'YEAR_QUARTER',
            'YEAR_MONTH_DAY',
          ]),
        })
        .optional(),
      manualRule: z
        .object({
          groups: z.array(
            z.object({
              groupName: z.string(),
              items: z.array(z.string()),
            })
          ),
        })
        .optional(),
      histogramRule: z
        .object({
          interval: z.coerce.number().positive(),
          start: z.coerce.number().optional(),
          end: z.coerce.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

const PivotValueSchema = z.object({
  sourceColumnOffset: z.coerce.number().int().min(0),
  summarizeFunction: SummarizeFunctionSchema,
  name: z.string().optional(),
  calculatedDisplayType: z
    .enum(['PERCENT_OF_ROW_TOTAL', 'PERCENT_OF_COLUMN_TOTAL', 'PERCENT_OF_GRAND_TOTAL'])
    .optional(),
});

const PivotFilterSchema = z.object({
  sourceColumnOffset: z.coerce.number().int().min(0),
  filterCriteria: z.object({
    visibleValues: z.array(z.string()).optional(),
    condition: z
      .object({
        type: z.string(),
        values: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});

// ============================================================================
// CONSOLIDATED INPUT SCHEMA (18 actions)
// ============================================================================

const CommonFieldsSchema = z.object({
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~50% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe('Safety options (dryRun, createSnapshot, etc.)'),
});

// ===== CHART ACTION SCHEMAS (11 actions) =====

const ChartCreateActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('chart_create')
    .describe(
      'Create a new chart. Minimal example: { "action": "chart_create", "spreadsheetId": "abc123", "sheetId": 0, "chartType": "LINE", "data": { "sourceRange": "Sheet1!A1:B10" }, "position": { "anchorCell": "E2", "sheetId": 0 } }'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID where chart will be placed'),
  chartType: ChartTypeSchema.describe(
    'Chart type. BAR=horizontal bars, COLUMN=vertical bars. PIE, LINE, SCATTER, AREA, COMBO also available.'
  ),
  data: ChartDataSchema.describe(
    'Chart data source. NOTE: BAR charts only support BOTTOM_AXIS (horizontal bars). Use COLUMN for vertical bars.'
  ),
  position: ChartPositionSchema.describe(
    'Chart position. Prefer "Sheet1!E2". If anchorCell omits the sheet name, set position.sheetId so the chart lands on the correct sheet.'
  ),
  options: ChartOptionsSchema.optional().describe(
    'Chart options (title, subtitle, legend, colors, 3D, stacking, etc.)'
  ),
});

const SuggestChartActionSchema = CommonFieldsSchema.extend({
  action: z.literal('suggest_chart').describe('Get AI-powered chart suggestions for data range'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  range: RangeInputSchema.describe('Data range to analyze for suggestions'),
  maxSuggestions: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(3)
    .describe('Number of suggestions to return (default: 3)'),
});

const ChartUpdateActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_update').describe('Update an existing chart'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to update'),
  chartType: ChartTypeSchema.optional().describe('New chart type'),
  data: ChartDataSchema.optional().describe('New chart data source'),
  position: ChartPositionSchema.optional().describe('New chart position'),
  options: ChartOptionsSchema.optional().describe('New chart options'),
});

const ChartDeleteActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_delete').describe('Delete a chart'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to delete'),
});

const ChartListActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_list').describe('List all charts in a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID to filter charts'),
});

const ChartGetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_get').describe('Get details of a specific chart'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to retrieve'),
});

const ChartMoveActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_move').describe('Move a chart to a new position'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to move'),
  position: ChartPositionSchema.describe(
    'New position. Prefer "Sheet1!E2". If anchorCell omits the sheet name, set position.sheetId.'
  ),
});

const ChartResizeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_resize').describe('Resize a chart'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to resize'),
  width: z.coerce.number().positive().describe('Width in pixels (must be positive)'),
  height: z.coerce.number().positive().describe('Height in pixels (must be positive)'),
});

const ChartUpdateDataRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_update_data_range').describe("Update a chart's data range"),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to update'),
  data: ChartDataSchema.describe('New chart data source'),
});

const ChartAddTrendlineActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('chart_add_trendline')
    .describe('Add a trendline to an existing chart series (LINE, AREA, SCATTER, COLUMN charts)'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to modify'),
  seriesIndex: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Series index to add trendline to (0-based, default: 0)'),
  trendline: TrendlineSchema.describe('Trendline configuration'),
});

const ChartRemoveTrendlineActionSchema = CommonFieldsSchema.extend({
  action: z.literal('chart_remove_trendline').describe('Remove a trendline from a chart series'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  chartId: z.coerce.number().int().describe('Numeric chart ID to modify'),
  seriesIndex: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Series index to remove trendline from (0-based, default: 0)'),
});

// ===== PIVOT ACTION SCHEMAS (7 actions) =====

const PivotCreateActionSchema = CommonFieldsSchema.extend({
  action: z.literal('pivot_create').describe('Create a new pivot table'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sourceRange: RangeInputSchema.describe(
    'Source data range for the pivot table (A1 notation or semantic)'
  ),
  values: z.array(PivotValueSchema).min(1).describe('Value aggregations (at least one required)'),
  rows: z.array(PivotGroupSchema).optional().describe('Row groupings for the pivot table'),
  columns: z.array(PivotGroupSchema).optional().describe('Column groupings for the pivot table'),
  filters: z.array(PivotFilterSchema).optional().describe('Filter criteria for the pivot table'),
  destinationSheetId: SheetIdSchema.optional().describe(
    'Sheet ID for pivot table destination (omit = new sheet)'
  ),
  destinationCell: z
    .preprocess(
      (val) => {
        if (typeof val !== 'string') return val;
        // Strip sheet name prefix if present: "'Sheet Name'!A1" -> "A1" or "Sheet1!A1" -> "A1"
        const match = val.match(/^(?:'[^']+'!|[^!]+!)?([A-Z]{1,3}\d+)$/i);
        return match ? match[1]!.toUpperCase() : val;
      },
      z.string().regex(/^[A-Z]{1,3}\d+$/, 'Invalid cell reference format (expected: A1, AA1, AAA1)')
    )
    .optional()
    .default('A1')
    .describe(
      'Top-left cell for pivot table (default: A1). Sheet prefix will be stripped if provided.'
    ),
});

const SuggestPivotActionSchema = CommonFieldsSchema.extend({
  action: z.literal('suggest_pivot').describe('Get AI-powered pivot table suggestions'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  range: RangeInputSchema.describe('Data range to analyze for suggestions'),
  maxSuggestions: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(3)
    .describe('Number of suggestions to return (default: 3)'),
});

const PivotUpdateActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('pivot_update')
    .describe(
      'Update an existing pivot table. WARNING: Omitting any field (rows/columns/values/filters) will CLEAR that dimension. Fetch current state with pivot_get first, then include ALL dimensions in your update.'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID containing the pivot table'),
  rows: z.array(PivotGroupSchema).optional().describe('New row groupings'),
  columns: z.array(PivotGroupSchema).optional().describe('New column groupings'),
  values: z.array(PivotValueSchema).optional().describe('New value aggregations'),
  filters: z.array(PivotFilterSchema).optional().describe('New filter criteria'),
});

const PivotDeleteActionSchema = CommonFieldsSchema.extend({
  action: z.literal('pivot_delete').describe('Delete a pivot table'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID containing the pivot table'),
});

const PivotListActionSchema = CommonFieldsSchema.extend({
  action: z.literal('pivot_list').describe('List all pivot tables in a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
});

const PivotGetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('pivot_get').describe('Get details of a specific pivot table'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID containing the pivot table'),
});

const PivotRefreshActionSchema = CommonFieldsSchema.extend({
  action: z.literal('pivot_refresh').describe('Refresh a pivot table with latest data'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID containing the pivot table'),
});

/**
 * All visualization operation inputs (charts and pivot tables)
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
const normalizeVisualizeRequest = (val: unknown): unknown => {
  if (typeof val !== 'object' || val === null) return val;
  const input = { ...(val as Record<string, unknown>) };
  const action = input['action'];

  if (action === 'chart_create') {
    // Normalize data.chartType to uppercase and move data.title/legendPosition to options
    if (input['data'] && typeof input['data'] === 'object') {
      const data = { ...(input['data'] as Record<string, unknown>) };
      if (typeof data['chartType'] === 'string') {
        const upperChartType = data['chartType'].toUpperCase();
        data['chartType'] = upperChartType;
        // Also promote to top-level chartType if absent
        if (input['chartType'] === undefined) {
          input['chartType'] = upperChartType;
        }
        delete data['chartType'];
      }
      if (data['title'] !== undefined || data['legendPosition'] !== undefined) {
        const existingOptions =
          typeof input['options'] === 'object' && input['options'] !== null
            ? { ...(input['options'] as Record<string, unknown>) }
            : {};
        if (data['title'] !== undefined) {
          existingOptions['title'] = data['title'];
          delete data['title'];
        }
        if (data['legendPosition'] !== undefined) {
          existingOptions['legendPosition'] = data['legendPosition'];
          delete data['legendPosition'];
        }
        input['options'] = existingOptions;
      }
      input['data'] = data;
    }
    // Normalize top-level chartType to uppercase if present
    if (typeof input['chartType'] === 'string') {
      input['chartType'] = input['chartType'].toUpperCase();
    }
    // Move top-level sourceRange string into data.sourceRange as { a1: ... }
    if (
      typeof input['sourceRange'] === 'string' &&
      input['data'] &&
      typeof input['data'] === 'object'
    ) {
      const data = { ...(input['data'] as Record<string, unknown>) };
      if (data['sourceRange'] === undefined) {
        data['sourceRange'] = { a1: input['sourceRange'] };
        input['data'] = data;
      }
      delete input['sourceRange'];
    }
  }

  if (action === 'chart_move') {
    // Handle destinationCell/destinationSheetId aliases → position
    if (input['destinationCell'] !== undefined && input['position'] === undefined) {
      input['position'] = {
        anchorCell: input['destinationCell'],
        sheetId: input['destinationSheetId'],
      };
      delete input['destinationCell'];
      delete input['destinationSheetId'];
    }
  }

  return input;
};

export const SheetsVisualizeInputSchema = z.object({
  request: z.preprocess(
    normalizeVisualizeRequest,
    z.discriminatedUnion('action', [
      // Chart actions (11)
      ChartCreateActionSchema,
      SuggestChartActionSchema,
      ChartUpdateActionSchema,
      ChartDeleteActionSchema,
      ChartListActionSchema,
      ChartGetActionSchema,
      ChartMoveActionSchema,
      ChartResizeActionSchema,
      ChartUpdateDataRangeActionSchema,
      ChartAddTrendlineActionSchema,
      ChartRemoveTrendlineActionSchema,
      // Pivot actions (7)
      PivotCreateActionSchema,
      SuggestPivotActionSchema,
      PivotUpdateActionSchema,
      PivotDeleteActionSchema,
      PivotListActionSchema,
      PivotGetActionSchema,
      PivotRefreshActionSchema,
    ])
  ),
});

// ============================================================================
// CONSOLIDATED OUTPUT SCHEMA
// ============================================================================

const VisualizeResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),

    // Chart-specific response fields
    chartId: z.coerce.number().int().optional().describe('Chart ID (for chart actions)'),
    charts: z
      .array(
        z.object({
          chartId: z.coerce.number().int(),
          chartType: ChartTypeSchema,
          sheetId: z.coerce.number().int(),
          title: z.string().optional(),
          position: ChartPositionSchema,
        })
      )
      .optional()
      .describe('List of charts (for chart_list action)'),

    // Pivot-specific response fields
    pivotTable: z
      .object({
        sheetId: z.coerce.number().int(),
        sourceRange: GridRangeSchema,
        rowGroups: z.coerce.number().int(),
        columnGroups: z.coerce.number().int(),
        values: z.coerce.number().int(),
      })
      .optional()
      .describe('Pivot table details (for pivot actions)'),
    pivotTables: z
      .array(
        z.object({
          sheetId: z.coerce.number().int(),
          title: z.string(),
        })
      )
      .optional()
      .describe('List of pivot tables (for pivot_list action)'),

    // Shared suggestion fields
    suggestions: z
      .array(
        z.discriminatedUnion('type', [
          // Chart suggestions
          z.object({
            type: z.literal('chart'),
            chartType: ChartTypeSchema,
            title: z.string(),
            explanation: z.string(),
            confidence: z.coerce.number().min(0).max(100),
            reasoning: z.string(),
            dataMapping: z.object({
              seriesColumns: z.array(z.coerce.number().int()).optional(),
              categoryColumn: z.coerce.number().int().optional(),
            }),
          }),
          // Pivot suggestions
          z.object({
            type: z.literal('pivot'),
            title: z.string(),
            explanation: z.string(),
            confidence: z.coerce.number().min(0).max(100),
            reasoning: z.string(),
            configuration: z.object({
              rowGroupColumns: z
                .array(z.coerce.number().int())
                .describe('Column indices to group by rows'),
              columnGroupColumns: z
                .array(z.coerce.number().int())
                .optional()
                .describe('Column indices to group by columns'),
              valueColumns: z
                .array(
                  z.object({
                    columnIndex: z.coerce.number().int(),
                    function: SummarizeFunctionSchema,
                  })
                )
                .describe('Columns to aggregate and their functions'),
            }),
          }),
        ])
      )
      .optional()
      .describe('Visualization suggestions (for suggest_chart, suggest_pivot actions)'),

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

export const SheetsVisualizeOutputSchema = z.object({
  response: VisualizeResponseSchema,
});

// ============================================================================
// ANNOTATIONS
// ============================================================================

export const SHEETS_VISUALIZE_ANNOTATIONS: ToolAnnotations = {
  title: 'Visualizations (Charts & Pivot Tables)',
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type SheetsVisualizeInput = z.infer<typeof SheetsVisualizeInputSchema>;
export type SheetsVisualizeOutput = z.infer<typeof SheetsVisualizeOutputSchema>;
export type VisualizeResponse = z.infer<typeof VisualizeResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type VisualizeRequest = SheetsVisualizeInput['request'];

// ============================================================================
// TYPE NARROWING HELPERS (18 action types)
// ============================================================================

// Chart action types (11)
export type ChartCreateInput = SheetsVisualizeInput['request'] & {
  action: 'chart_create';
  spreadsheetId: string;
  sheetId: number;
  chartType: string;
  data: z.infer<typeof ChartDataSchema>;
  position: z.infer<typeof ChartPositionSchema>;
};

export type SuggestChartInput = SheetsVisualizeInput['request'] & {
  action: 'suggest_chart';
  spreadsheetId: string;
  range: RangeInput;
};

export type ChartUpdateInput = SheetsVisualizeInput['request'] & {
  action: 'chart_update';
  spreadsheetId: string;
  chartId: number;
};

export type ChartDeleteInput = SheetsVisualizeInput['request'] & {
  action: 'chart_delete';
  spreadsheetId: string;
  chartId: number;
};

export type ChartListInput = SheetsVisualizeInput['request'] & {
  action: 'chart_list';
  spreadsheetId: string;
};

export type ChartGetInput = SheetsVisualizeInput['request'] & {
  action: 'chart_get';
  spreadsheetId: string;
  chartId: number;
};

export type ChartMoveInput = SheetsVisualizeInput['request'] & {
  action: 'chart_move';
  spreadsheetId: string;
  chartId: number;
  position: z.infer<typeof ChartPositionSchema>;
};

export type ChartResizeInput = SheetsVisualizeInput['request'] & {
  action: 'chart_resize';
  spreadsheetId: string;
  chartId: number;
  width: number;
  height: number;
};

export type ChartUpdateDataRangeInput = SheetsVisualizeInput['request'] & {
  action: 'chart_update_data_range';
  spreadsheetId: string;
  chartId: number;
  data: z.infer<typeof ChartDataSchema>;
};

export type ChartAddTrendlineInput = SheetsVisualizeInput['request'] & {
  action: 'chart_add_trendline';
  spreadsheetId: string;
  chartId: number;
  seriesIndex: number;
  trendline: z.infer<typeof TrendlineSchema>;
};

export type ChartRemoveTrendlineInput = SheetsVisualizeInput['request'] & {
  action: 'chart_remove_trendline';
  spreadsheetId: string;
  chartId: number;
  seriesIndex: number;
};

// Pivot action types (7)
export type PivotCreateInput = SheetsVisualizeInput['request'] & {
  action: 'pivot_create';
  spreadsheetId: string;
  sourceRange: RangeInput;
  values: z.infer<typeof PivotValueSchema>[];
};

export type SuggestPivotInput = SheetsVisualizeInput['request'] & {
  action: 'suggest_pivot';
  spreadsheetId: string;
  range: RangeInput;
};

export type PivotUpdateInput = SheetsVisualizeInput['request'] & {
  action: 'pivot_update';
  spreadsheetId: string;
  sheetId: number;
};

export type PivotDeleteInput = SheetsVisualizeInput['request'] & {
  action: 'pivot_delete';
  spreadsheetId: string;
  sheetId: number;
};

export type PivotListInput = SheetsVisualizeInput['request'] & {
  action: 'pivot_list';
  spreadsheetId: string;
};

export type PivotGetInput = SheetsVisualizeInput['request'] & {
  action: 'pivot_get';
  spreadsheetId: string;
  sheetId: number;
};

export type PivotRefreshInput = SheetsVisualizeInput['request'] & {
  action: 'pivot_refresh';
  spreadsheetId: string;
  sheetId: number;
};
