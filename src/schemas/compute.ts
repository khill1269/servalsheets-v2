/**
 * Tool: sheets_compute
 * Server-side computation engine for spreadsheet data.
 * Provides deterministic math, statistics, forecasting, and matrix operations
 * without requiring AI/Sampling round-trips.
 *
 * Actions (10):
 * - evaluate: Evaluate a formula/expression against cell data
 * - aggregate: Run aggregation functions (SUM, AVG, COUNT, etc.) on ranges
 * - statistical: Descriptive statistics (mean, median, stddev, percentiles, etc.)
 * - regression: Linear/polynomial/exponential regression on data series
 * - forecast: Time-series forecasting with trend detection
 * - matrix_op: Matrix operations (transpose, multiply, inverse, determinant)
 * - pivot_compute: In-memory pivot table computation
 * - custom_function: Execute a user-defined computation expression
 * - batch_compute: Run multiple computations in a single call
 * - explain_formula: Parse and explain a Google Sheets formula
 */

import { z } from 'zod';
import {
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
  spreadsheetId: z.string().min(1).describe('Spreadsheet ID from URL'),
  safety: SafetyOptionsSchema.optional().describe('Safety options for computation'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (result only), standard (result + metadata), detailed (result + steps + metadata)'
    ),
});

// ============================================================================
// Individual Action Schemas
// ============================================================================

const EvaluateActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('evaluate')
    .describe('Evaluate a formula or expression against spreadsheet data'),
  formula: z
    .string()
    .min(1)
    .describe(
      'Formula to evaluate. Supports Google Sheets syntax (e.g., "=SUM(A1:A10)", "=IF(B2>100, B2*0.9, B2)"). Cell references are resolved against the spreadsheet.'
    ),
  range: RangeInputSchema.optional().describe(
    'Context range for relative cell references. Accepts A1 notation string, named range, or grid reference. Required if formula uses relative refs.'
  ),
}).strict();

const AggregateActionSchema = CommonFieldsSchema.extend({
  action: z.literal('aggregate').describe('Run aggregation functions on a range of data'),
  range: RangeInputSchema.describe('Range to aggregate (e.g., "Sheet1!A1:A100" or named range)'),
  functions: z
    .array(
      z.enum([
        'sum',
        'average',
        'count',
        'counta',
        'countblank',
        'min',
        'max',
        'median',
        'mode',
        'product',
        'stdev',
        'stdevp',
        'var',
        'varp',
      ])
    )
    .min(1)
    .describe('Aggregation functions to compute. Example: ["sum", "average", "count"]'),
  groupBy: z
    .string()
    .optional()
    .describe(
      'Column to group by before aggregating (column letter, e.g., "A" or column header name)'
    ),
  type: z
    .enum(['standard', 'moving_average', 'moving_median', 'moving_sum'])
    .optional()
    .default('standard')
    .describe(
      'Aggregation mode. "standard" runs the functions array; "moving_*" computes a rolling window over valueColumn.'
    ),
  valueColumn: z
    .string()
    .optional()
    .describe(
      'Column to use for moving window operations (letter or header name). Required when type is moving_*.'
    ),
  windowSize: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(3)
    .describe('Number of rows in the moving window (default: 3). Only used when type is moving_*.'),
}).strict();

const StatisticalActionSchema = CommonFieldsSchema.extend({
  action: z.literal('statistical').describe('Compute descriptive statistics for a data range'),
  range: RangeInputSchema.describe('Range containing numeric data'),
  columns: z
    .array(z.string())
    .optional()
    .describe(
      'Specific columns to analyze (letters or header names). All numeric columns if omitted.'
    ),
  percentiles: z
    .array(z.number().min(0).max(100))
    .optional()
    .default([25, 50, 75])
    .describe('Percentiles to compute (0-100). Default: [25, 50, 75] (quartiles)'),
  includeCorrelations: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include correlation matrix between numeric columns'),
  movingWindow: z
    .object({
      windowSize: z.number().int().min(1).default(3).describe('Rolling window size (default: 3)'),
      operation: z
        .enum(['average', 'median', 'sum'])
        .default('average')
        .describe('Window operation to compute'),
      column: z.string().describe('Column to apply the moving window to (letter or header name)'),
    })
    .optional()
    .describe('If provided, compute a moving window statistic alongside the standard statistics.'),
}).strict();

const RegressionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('regression').describe('Perform regression analysis on data series'),
  range: RangeInputSchema.describe('Range containing X and Y data'),
  xColumn: z.string().describe('Column for independent variable (letter or header name)'),
  yColumn: z.string().describe('Column for dependent variable (letter or header name)'),
  type: z
    .enum(['linear', 'polynomial', 'exponential', 'logarithmic', 'power'])
    .optional()
    .default('linear')
    .describe('Regression type. Default: linear'),
  degree: z
    .number()
    .int()
    .min(2)
    .max(6)
    .optional()
    .default(2)
    .describe('Polynomial degree (only for polynomial type). Default: 2'),
  predict: z
    .array(z.number())
    .optional()
    .describe('X values to predict Y for using the fitted model'),
}).strict();

const ForecastActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('forecast')
    .describe(
      'Time-series forecasting with trend and seasonality detection. Requires one numeric row per distinct period; aggregate repeated dates/timestamps before calling.'
    ),
  range: RangeInputSchema.describe(
    'Range containing time series data with headers. Use a pre-aggregated range with one row per period.'
  ),
  dateColumn: z
    .string()
    .describe(
      'Column containing dates/timestamps (letter or header name). Needs at least 3 distinct periods.'
    ),
  valueColumn: z
    .string()
    .describe(
      'Column containing numeric values to forecast (letter or header name). One value per period.'
    ),
  periods: z.number().int().min(1).max(365).describe('Number of future periods to forecast'),
  method: z
    .enum(['linear_trend', 'moving_average', 'exponential_smoothing', 'auto'])
    .optional()
    .default('auto')
    .describe('Forecasting method. "auto" selects best fit. Default: auto'),
  seasonality: z
    .number()
    .int()
    .min(2)
    .optional()
    .describe('Seasonality period (e.g., 12 for monthly data with yearly seasonality)'),
}).strict();

const MatrixOpActionSchema = CommonFieldsSchema.extend({
  action: z.literal('matrix_op').describe('Perform matrix operations on spreadsheet data'),
  range: RangeInputSchema.describe('Range containing the matrix data'),
  operation: z
    .enum(['transpose', 'multiply', 'inverse', 'determinant', 'eigenvalues', 'rank', 'trace'])
    .describe('Matrix operation to perform'),
  secondRange: RangeInputSchema.optional().describe(
    'Second matrix range (required for multiply operation)'
  ),
  outputRange: RangeInputSchema.optional().describe(
    'Range to write the result to (if omitted, result is returned but not written)'
  ),
}).strict();

const PivotComputeActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('pivot_compute')
    .describe('Compute an in-memory pivot table from spreadsheet data'),
  range: RangeInputSchema.describe('Source data range (must include headers)'),
  rows: z
    .array(z.string())
    .min(1)
    .describe('Columns to use as row groupings (header names or column letters)'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Columns to use as column groupings (header names or column letters)'),
  values: z
    .array(
      z.object({
        column: z.string().describe('Column to aggregate (header name or letter)'),
        function: z
          .enum(['sum', 'average', 'count', 'min', 'max', 'median'])
          .describe('Aggregation function'),
      })
    )
    .min(1)
    .describe('Value columns with aggregation functions'),
  filters: z
    .array(
      z.object({
        column: z.string().describe('Column to filter on'),
        values: z.array(z.union([z.string(), z.number(), z.boolean()])).describe('Allowed values'),
      })
    )
    .optional()
    .describe('Optional filters to apply before pivoting'),
}).strict();

const CustomFunctionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('custom_function').describe('Execute a custom computation expression on data'),
  range: RangeInputSchema.describe('Data range to operate on'),
  expression: z
    .string()
    .min(1)
    .describe(
      'Computation expression using column references. Supports: arithmetic (+, -, *, /, %), comparison (>, <, ==, !=), logical (AND, OR, NOT), and built-in functions (ABS, ROUND, CEIL, FLOOR, SQRT, POW, LOG, LN, EXP, MOD). Column refs: $A, $B or $ColumnName. Also supports bare "x" for single-column ranges (e.g. "x * 1.1"). Examples: "ROUND($Revenue * $TaxRate, 2)", "x * 1.1"'
    ),
  outputColumn: z
    .string()
    .optional()
    .describe('Column header name for the result. If omitted, returns results without writing.'),
}).strict();

const BatchComputeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('batch_compute').describe('Run multiple computations in a single call'),
  computations: z
    .array(
      z.object({
        id: z.string().describe('Unique identifier for this computation'),
        type: z
          .enum(['evaluate', 'aggregate', 'statistical', 'custom_function'])
          .describe('Computation type'),
        params: z
          .record(z.string(), z.unknown())
          .describe(
            'Parameters for the computation (same as individual action params, minus spreadsheetId)'
          ),
      })
    )
    .min(1)
    .max(50)
    .describe('Array of computations to execute (max 50)'),
  stopOnError: z
    .boolean()
    .optional()
    .default(false)
    .describe('Stop execution on first error (default: false, continues and collects errors)'),
}).strict();

const ExplainFormulaActionSchema = CommonFieldsSchema.extend({
  action: z.literal('explain_formula').describe('Parse and explain a Google Sheets formula'),
  formula: z
    .string()
    .min(1)
    .describe('Google Sheets formula to explain (e.g., "=VLOOKUP(A2, Sheet2!A:C, 3, FALSE)")'),
  range: RangeInputSchema.optional().describe(
    'Context range for resolving cell references to actual values'
  ),
}).strict();

// ============================================================================
// Phase 1: DuckDB SQL Analytics
// ============================================================================

const SqlQueryActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('sql_query')
    .describe('Execute SQL analytics query on spreadsheet data using DuckDB'),
  tables: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
          .describe('SQL table alias for this range'),
        range: RangeInputSchema,
        hasHeaders: z.boolean().default(true).describe('Whether first row contains column headers'),
      })
    )
    .min(1)
    .max(10)
    .describe('Sheet ranges to register as SQL tables'),
  sql: z.string().min(1).max(10000).describe('SQL query to execute against registered tables'),
  timeoutMs: z
    .number()
    .min(1000)
    .max(60000)
    .default(30000)
    .describe('Query timeout in milliseconds'),
}).strict();

const SqlJoinActionSchema = CommonFieldsSchema.extend({
  action: z.literal('sql_join').describe('Join two ranges using SQL JOIN semantics via DuckDB'),
  left: z.object({
    range: RangeInputSchema,
    alias: z.string().default('left').describe('SQL alias for left table'),
  }),
  right: z.object({
    range: RangeInputSchema,
    alias: z.string().default('right').describe('SQL alias for right table'),
  }),
  on: z.string().describe('JOIN condition (e.g., "left.id = right.id")'),
  select: z.string().optional().describe('SELECT clause (default: *)'),
  joinType: z.enum(['inner', 'left', 'right', 'full']).default('inner'),
  timeoutMs: z.number().min(1000).max(60000).default(30000),
}).strict();

// ============================================================================
// Phase 2: Pyodide Python Bridge
// ============================================================================

const PythonEvalActionSchema = CommonFieldsSchema.extend({
  action: z.literal('python_eval').describe('Run Python code on spreadsheet data via Pyodide WASM'),
  range: RangeInputSchema,
  code: z
    .string()
    .min(1)
    .max(50000)
    .describe(
      'Python code to execute. Data available as `data` (list of lists) and `df` (pandas DataFrame if hasHeaders=true)'
    ),
  hasHeaders: z.boolean().default(true),
  timeoutMs: z.number().min(1000).max(120000).default(60000),
}).strict();

const PandasProfileActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('pandas_profile')
    .describe('Generate statistical profile of spreadsheet data using pandas'),
  range: RangeInputSchema,
  columns: z
    .array(z.string())
    .optional()
    .describe('Optional list of column names to profile. If omitted, profiles all columns.'),
  hasHeaders: z.boolean().default(true),
  includeCorrelations: z.boolean().default(true),
}).strict();

const SklearnModelActionSchema = CommonFieldsSchema.extend({
  action: z.literal('sklearn_model').describe('Train a scikit-learn ML model on spreadsheet data'),
  range: RangeInputSchema,
  targetColumn: z.string().describe('Column name to predict'),
  featureColumns: z
    .array(z.string())
    .optional()
    .describe('Columns to use as features (default: all except target)'),
  modelType: z.enum([
    'linear_regression',
    'logistic_regression',
    'kmeans',
    'random_forest',
    'ridge',
  ]),
  testSize: z
    .number()
    .min(0.1)
    .max(0.5)
    .default(0.2)
    .describe('Fraction of data to use for testing'),
}).strict();

const MatplotlibChartActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('matplotlib_chart')
    .describe('Generate a matplotlib chart from spreadsheet data, returned as base64 PNG'),
  range: RangeInputSchema,
  chartType: z.enum(['line', 'bar', 'scatter', 'heatmap', 'histogram', 'boxplot']),
  xColumn: z.string().optional(),
  yColumns: z.array(z.string()).optional(),
  title: z.string().optional(),
  width: z.number().default(800),
  height: z.number().default(600),
}).strict();

// ============================================================================
// Combined Input Schema
// ============================================================================

const normalizeComputeRequest = (val: unknown): unknown => {
  if (typeof val !== 'object' || val === null) return val;
  const obj = val as Record<string, unknown>;

  // Alias: 'expr' → 'expression' for custom_function (LLM compatibility)
  if (obj['action'] === 'custom_function' && obj['expr'] && !obj['expression']) {
    return { ...obj, expression: obj['expr'] };
  }

  // Alias: 'type' → 'method' for forecast (LLM compatibility)
  if (obj['action'] === 'forecast' && !obj['method'] && typeof obj['type'] === 'string') {
    const typeVal = obj['type'];
    if (
      ['linear_trend', 'moving_average', 'exponential_smoothing', 'auto'].includes(
        typeVal as string
      )
    ) {
      return { ...obj, method: typeVal };
    }
  }

  return val;
};

/**
 * All computation engine inputs
 *
 * Discriminated union for 10 compute actions.
 * Each action has only its required fields (no optional field pollution).
 */
export const SheetsComputeInputSchema = z.object({
  request: z.preprocess(
    normalizeComputeRequest,
    z.discriminatedUnion('action', [
      EvaluateActionSchema,
      AggregateActionSchema,
      StatisticalActionSchema,
      RegressionActionSchema,
      ForecastActionSchema,
      MatrixOpActionSchema,
      PivotComputeActionSchema,
      CustomFunctionActionSchema,
      BatchComputeActionSchema,
      ExplainFormulaActionSchema,
      // Phase 1: DuckDB SQL Analytics
      SqlQueryActionSchema,
      SqlJoinActionSchema,
      // Phase 2: Pyodide Python Bridge
      PythonEvalActionSchema,
      PandasProfileActionSchema,
      SklearnModelActionSchema,
      MatplotlibChartActionSchema,
    ])
  ),
});

// ============================================================================
// Output Schema
// ============================================================================

const ComputeResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // EVALUATE response
    result: z.unknown().optional().describe('Computation result value'),
    formula: z.string().optional().describe('The formula that was evaluated'),
    resolvedCells: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Cell references resolved during evaluation'),
    // AGGREGATE response
    aggregations: z
      .record(z.string(), z.union([z.number(), z.null()]))
      .optional()
      .describe('Aggregation results keyed by function name'),
    groups: z
      .array(
        z.object({
          key: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          aggregations: z.record(z.string(), z.union([z.number(), z.null()])),
          rowCount: z.number(),
        })
      )
      .optional()
      .describe('Grouped aggregation results (when groupBy is specified)'),
    movingWindow: z
      .object({
        type: z.string(),
        windowSize: z.number(),
        values: z.array(z.number()),
        originalCount: z.number(),
        resultCount: z.number(),
      })
      .optional()
      .describe('Moving window aggregation result'),
    rowCount: z.number().optional().describe('Total rows processed'),
    // STATISTICAL response
    statistics: z
      .record(
        z.string(),
        z.object({
          count: z.number(),
          mean: z.number().nullable(),
          median: z.number().nullable(),
          mode: z.union([z.number(), z.null()]).optional(),
          stddev: z.number().nullable(),
          variance: z.number().nullable(),
          min: z.number().nullable(),
          max: z.number().nullable(),
          range: z.number().nullable(),
          skewness: z.number().nullable().optional(),
          kurtosis: z.number().nullable().optional(),
          percentiles: z.record(z.string(), z.number()).optional(),
          nullCount: z.number().optional(),
        })
      )
      .optional()
      .describe('Per-column statistics'),
    correlations: z
      .record(z.string(), z.record(z.string(), z.number()))
      .optional()
      .describe('Correlation matrix between columns'),
    correlationMatrix: z
      .object({
        columns: z.array(z.string()),
        matrix: z.array(z.array(z.number())),
      })
      .optional()
      .describe('Structured correlation matrix format'),
    // REGRESSION response
    coefficients: z.array(z.number()).optional().describe('Regression coefficients'),
    rSquared: z.number().optional().describe('R-squared (coefficient of determination)'),
    equation: z.string().optional().describe('Human-readable equation string'),
    predictions: z
      .array(z.object({ x: z.number(), y: z.number() }))
      .optional()
      .describe('Predicted values for the provided predict[] inputs'),
    residuals: z
      .object({
        mean: z.number(),
        stddev: z.number(),
        max: z.number(),
      })
      .optional()
      .describe('Residual statistics'),
    // FORECAST response
    forecast: z
      .array(
        z.object({
          period: z.union([z.string(), z.number()]),
          value: z.number(),
          lowerBound: z.number().optional(),
          upperBound: z.number().optional(),
        })
      )
      .optional()
      .describe('Forecasted values with optional confidence bounds'),
    trend: z
      .object({
        direction: z.enum(['increasing', 'decreasing', 'stable']),
        strength: z.number(),
        seasonalityDetected: z.boolean(),
        seasonalPeriod: z.number().optional(),
      })
      .optional()
      .describe('Detected trend information'),
    methodUsed: z.string().optional().describe('Forecasting method that was selected/used'),
    // MATRIX_OP response
    matrix: z
      .array(z.array(z.number()))
      .optional()
      .describe('Result matrix (for transpose, multiply, inverse)'),
    scalar: z.number().optional().describe('Scalar result (for determinant, trace, rank)'),
    eigenvalues: z.array(z.number()).optional().describe('Eigenvalues (for eigenvalues operation)'),
    written: z.boolean().optional().describe('Whether result was written to outputRange'),
    // PIVOT_COMPUTE response
    pivotTable: z
      .object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
        totals: z.record(z.string(), z.number()).optional(),
      })
      .optional()
      .describe('Computed pivot table'),
    // CUSTOM_FUNCTION response
    values: z.array(z.unknown()).optional().describe('Computed values per row'),
    writtenToColumn: z.string().optional().describe('Column the results were written to'),
    // BATCH_COMPUTE response
    results: z
      .array(
        z.object({
          id: z.string(),
          success: z.boolean(),
          result: z.unknown().optional(),
          error: z.string().optional(),
        })
      )
      .optional()
      .describe('Results for each computation in the batch'),
    // EXPLAIN_FORMULA response
    explanation: z
      .object({
        summary: z.string(),
        functions: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            arguments: z.array(z.string()),
          })
        ),
        references: z.array(
          z.object({
            ref: z.string(),
            value: z.unknown().optional(),
          })
        ),
        complexity: z.enum(['simple', 'moderate', 'complex']),
        dependencyChain: z.array(z.string()).optional(),
      })
      .optional()
      .describe('Formula explanation with function breakdown and references'),
    // SQL_QUERY / SQL_JOIN response fields
    sqlColumns: z.array(z.string()).optional().describe('Column names from SQL result'),
    sqlRows: z.array(z.array(z.unknown())).optional().describe('Data rows from SQL result'),
    sqlExecutionMs: z.number().optional().describe('DuckDB query execution time in milliseconds'),
    rowsReturned: z.number().optional().describe('Number of rows in SQL result'),
    // PYTHON_EVAL response fields
    pythonResult: z.unknown().optional().describe('Python execution result value'),
    pythonOutput: z.string().optional().describe('Captured stdout from Python execution'),
    pythonExecutionMs: z.number().optional().describe('Python execution time in milliseconds'),
    // PANDAS_PROFILE response fields
    profileStats: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Per-column statistics from pandas'),
    // SKLEARN_MODEL response fields
    modelMetrics: z
      .object({
        accuracy: z.number().optional(),
        r2: z.number().optional(),
        mse: z.number().optional(),
        mae: z.number().optional(),
      })
      .optional()
      .describe('Model evaluation metrics'),
    featureImportances: z
      .record(z.string(), z.number())
      .optional()
      .describe('Feature importance scores (random_forest only)'),
    // MATPLOTLIB_CHART response fields
    chartImage: z
      .string()
      .optional()
      .describe('Base64 PNG image data URI (data:image/png;base64,...)'),
    // Common
    computationTimeMs: z.number().optional().describe('Time taken for computation in milliseconds'),
    message: z.string().optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsComputeOutputSchema = z.object({
  response: ComputeResponseSchema,
});

export const SHEETS_COMPUTE_ANNOTATIONS: ToolAnnotations = {
  title: 'Computation Engine',
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export type SheetsComputeInput = z.infer<typeof SheetsComputeInputSchema>;
export type SheetsComputeOutput = z.infer<typeof SheetsComputeOutputSchema>;
export type ComputeResponse = z.infer<typeof ComputeResponseSchema>;

// Type narrowing helpers for handler methods
export type ComputeEvaluateInput = SheetsComputeInput['request'] & { action: 'evaluate' };
export type ComputeAggregateInput = SheetsComputeInput['request'] & { action: 'aggregate' };
export type ComputeStatisticalInput = SheetsComputeInput['request'] & { action: 'statistical' };
export type ComputeRegressionInput = SheetsComputeInput['request'] & { action: 'regression' };
export type ComputeForecastInput = SheetsComputeInput['request'] & { action: 'forecast' };
export type ComputeMatrixOpInput = SheetsComputeInput['request'] & { action: 'matrix_op' };
export type ComputePivotInput = SheetsComputeInput['request'] & { action: 'pivot_compute' };
export type ComputeCustomFunctionInput = SheetsComputeInput['request'] & {
  action: 'custom_function';
};
export type ComputeBatchInput = SheetsComputeInput['request'] & { action: 'batch_compute' };
export type ComputeExplainFormulaInput = SheetsComputeInput['request'] & {
  action: 'explain_formula';
};
// Phase 1: DuckDB
export type ComputeSqlQueryInput = SheetsComputeInput['request'] & { action: 'sql_query' };
export type ComputeSqlJoinInput = SheetsComputeInput['request'] & { action: 'sql_join' };
// Phase 2: Pyodide
export type ComputePythonEvalInput = SheetsComputeInput['request'] & { action: 'python_eval' };
export type ComputePandasProfileInput = SheetsComputeInput['request'] & {
  action: 'pandas_profile';
};
export type ComputeSklearnModelInput = SheetsComputeInput['request'] & { action: 'sklearn_model' };
export type ComputeMatplotlibChartInput = SheetsComputeInput['request'] & {
  action: 'matplotlib_chart';
};
