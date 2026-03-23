/**
 * Tool: sheets_analyze (CONSOLIDATED - PURE ANALYSIS)
 *
 * Ultimate analysis tool combining traditional statistics + AI-powered insights.
 * Consolidates legacy sheets_analysis into sheets_analyze (16 actions)
 * into a single intelligent tool with 16 actions and smart routing.
 *
 * DESIGN PRINCIPLE: This tool ANALYZES data and provides recommendations.
 * It does NOT create or modify spreadsheets. Recommendations include executable
 * parameters that other tools (sheets_visualize) can use directly.
 *
 * Features:
 * - Fast path: Traditional statistics for <10K rows (0.5-2s)
 * - AI path: LLM-powered insights via MCP Sampling for complex analysis (3-15s)
 * - Streaming path: Task-enabled chunked processing for >50K rows (async)
 * - Tiered retrieval: 4-level data fetching (metadata/structure/sample/full)
 * - 43-category extraction: Systematic feature extraction
 * - Executable recommendations: Ready-to-use params for creation tools
 *
 * @see MCP_PROTOCOL_COMPLETE_REFERENCE.md - Sampling, Tasks
 * @see MCP_SEP_SPECIFICATIONS_COMPLETE.md - SEP-1577
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  RangeInputSchema,
  ChartPositionSchema,
  ChartTypeSchema,
  LegendPositionSchema,
  ColorSchema,
  SummarizeFunctionSchema,
  SortOrderSchema,
  ErrorDetailSchema,
  ResponseMetaSchema,
  NextActionsSchema,
  AnalysisSummarySchema,
  AnalysisSessionSchema,
  type ToolAnnotations,
} from './shared.js';

/**
 * Analysis types available
 */
const AnalysisTypeSchema = z.enum([
  'summary', // Overall data summary
  'patterns', // Pattern recognition
  'anomalies', // Outlier/anomaly detection
  'trends', // Trend analysis
  'quality', // Data quality assessment
  'correlations', // Relationship discovery
  'recommendations', // Actionable recommendations
]);

/**
 * Data quality issue schema (from sheets_analyze) - Enhanced with executable fixes
 */
const DataQualityIssueSchema = z.object({
  type: z.enum([
    'EMPTY_HEADER',
    'DUPLICATE_HEADER',
    'MIXED_DATA_TYPES',
    'EMPTY_ROW',
    'EMPTY_COLUMN',
    'TRAILING_WHITESPACE',
    'LEADING_WHITESPACE',
    'INCONSISTENT_FORMAT',
    'STATISTICAL_OUTLIER',
    'MISSING_VALUE',
    'DUPLICATE_ROW',
    'INVALID_EMAIL',
    'INVALID_URL',
    'INVALID_DATE',
    'FORMULA_ERROR',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  location: z.string(),
  description: z.string(),
  autoFixable: z.boolean(),
  fixTool: z.string().optional(),
  fixAction: z.string().optional(),
  fixParams: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      ])
    )
    .optional(),
  // NEW: Ready-to-execute fix parameters
  executableFix: z
    .object({
      tool: z.string().describe('Tool to use for fix (e.g., sheets_fix, sheets_data)'),
      action: z.string().describe('Action to perform'),
      params: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
            z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          ])
        )
        .describe(
          'Complete parameters ready to execute (can be string, number, boolean, null, array, or object)'
        ),
      description: z.string().describe('Human-readable fix description'),
      estimatedTime: z.string().optional().describe('Estimated time to complete fix'),
    })
    .optional()
    .describe('Fully parameterized fix that can be executed immediately'),
});

/**
 * Template detection schema (NEW for Phase 3)
 */
const TemplateDetectionSchema = z.object({
  detectedType: z.enum([
    'budget',
    'invoice',
    'expense_report',
    'crm',
    'project_tracker',
    'inventory',
    'time_sheet',
    'sales_report',
    'dashboard',
    'data_entry',
    'custom',
    'unknown',
  ]),
  confidence: z.coerce.number().min(0).max(100),
  characteristics: z.array(z.string()).describe('Key characteristics that match the template'),
  recommendations: z
    .array(
      z.object({
        type: z.enum(['formula', 'formatting', 'validation', 'chart', 'pivot', 'structure']),
        suggestion: z.string(),
        benefit: z.string(),
        executionParams: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
              z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
            ])
          )
          .optional(),
      })
    )
    .optional()
    .describe('Template-specific recommendations to enhance the spreadsheet'),
  missingFeatures: z
    .array(z.string())
    .optional()
    .describe('Common features of this template type that are missing'),
});

/**
 * Performance recommendation schema (NEW)
 */
export const PerformanceRecommendationSchema = z.object({
  type: z.enum([
    'VOLATILE_FORMULAS',
    'EXCESSIVE_FORMULAS',
    'LARGE_RANGES',
    'CIRCULAR_REFERENCES',
    'INEFFICIENT_STRUCTURE',
    'TOO_MANY_SHEETS',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string(),
  estimatedImpact: z.string(),
  recommendation: z.string(),
  executableFix: z
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
          z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
          z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        ])
      ),
      description: z.string(),
    })
    .optional()
    .describe('Ready-to-execute optimization'),
});

// ============================================================================
// INPUT SCHEMA (16 actions)
// ============================================================================

const CommonFieldsSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  sheetId: SheetIdSchema.optional().describe('Sheet ID for analysis'),
});

// ===== ANALYSIS INTENT & DEPTH (used by multiple actions) =====

/**
 * Analysis intent - guides what type of analysis to perform
 */
const AnalysisIntentSchema = z
  .enum([
    'quick', // Scout + minimal analysis (~200ms)
    'optimize', // Performance, formulas, structure
    'clean', // Quality, duplicates, missing values
    'visualize', // Patterns, chart/pivot recommendations
    'understand', // Structure, relationships, summary
    'audit', // Everything, comprehensive
    'auto', // Auto-detect intent from context
  ])
  .describe(
    'Analysis intent: quick (fast scan), optimize (performance focus), clean (quality focus), visualize (charts/patterns), understand (structure), audit (everything), auto (detect)'
  );

/**
 * Analysis depth - controls how much data to fetch
 */
const AnalysisDepthSchema = z
  .enum([
    'metadata', // Tier 1: Sheet names, row counts, column names only (~200ms)
    'structure', // Tier 2: + column types, basic stats (~500ms)
    'sample', // Tier 3: + sample data analysis (~1-2s)
    'full', // Tier 4: Full data analysis (~5-30s depending on size)
  ])
  .describe(
    'Analysis depth: metadata (fastest, sheet structure only), structure (+ types), sample (+ data sample), full (complete analysis)'
  );

// ===== CORE ACTIONS (5 actions) =====

const ComprehensiveActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('comprehensive')
    .describe(
      'Complete analysis replacing separate sheets_core + sheets_data + sheets_analyze calls'
    ),
  range: RangeInputSchema.optional().describe('Range to analyze'),

  // NEW: Intent-driven analysis (guides what to analyze)
  intent: AnalysisIntentSchema.optional()
    .default('auto')
    .describe(
      'Analysis intent - guides focus area. auto detects from spreadsheet characteristics.'
    ),

  // NEW: Depth control (guides how much data to fetch)
  depth: AnalysisDepthSchema.optional()
    .default('sample')
    .describe('Data depth: metadata (fastest), structure, sample (default), full (complete).'),

  // NEW: Focus areas for targeted analysis
  focus: z
    .object({
      sheets: z
        .array(z.number().int().min(0))
        .max(10)
        .optional()
        .describe('Only analyze these sheet indices'),
      columns: z.array(z.string()).max(20).optional().describe('Only analyze these columns'),
      analyses: z
        .array(z.enum(['quality', 'formulas', 'patterns', 'performance', 'structure']))
        .optional()
        .describe('Only run these analysis types'),
    })
    .optional()
    .describe('Focus analysis on specific sheets, columns, or analysis types'),

  // NEW: Always include next actions for LLM guidance
  includeNextActions: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include executable nextActions in response (recommended for LLM guidance)'),

  // Legacy params (kept for backward compatibility)
  quickScan: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'DEPRECATED: Use intent="quick" instead. Fast mode: skip formulas/visualizations/performance.'
    ),
  includeFormulas: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include formula analysis and optimization suggestions'),
  includeVisualizations: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include visualization recommendations with executable params'),
  includePerformance: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include performance analysis and optimization recommendations'),
  forceFullData: z
    .boolean()
    .optional()
    .default(false)
    .describe('DEPRECATED: Use depth="full" instead. Force full data retrieval.'),
  samplingThreshold: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10000)
    .describe('Row count threshold before sampling kicks in'),
  sampleSize: z
    .number()
    .int()
    .positive()
    .max(5000)
    .optional()
    .default(500)
    .describe('Sample size when sampling is used'),
  cursor: z
    .string()
    .optional()
    .describe(
      'Pagination cursor for comprehensive analysis (format: "sheet:N" where N is sheet index)'
    ),
  pageSize: z
    .number()
    .int()
    .positive()
    .min(1)
    .max(50)
    .optional()
    .default(5)
    .describe('Number of sheets to return per page'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Maximum number of items to return per page (default: 50, max: 500)'),
  context: z.string().optional().describe('Additional context for analysis'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120000)
    .optional()
    .default(30000)
    .describe(
      'Analysis timeout in milliseconds (default: 30000ms). Use with quickScan=true for faster results.'
    ),
});

const AnalyzeDataActionSchema = CommonFieldsSchema.extend({
  action: z.literal('analyze_data').describe('Smart routing (stats OR AI)'),
  range: RangeInputSchema.optional().describe('Range to analyze'),
  analysisTypes: z
    .array(AnalysisTypeSchema)
    .min(1)
    .optional()
    .default(['summary', 'quality'])
    .describe('Types of analysis to perform'),
  useAI: z.boolean().optional().describe('Force AI-powered analysis via MCP Sampling'),
  context: z.string().optional().describe('Additional context for the analysis'),
  maxTokens: z
    .number()
    .int()
    .positive()
    .max(8192)
    .optional()
    .describe('Maximum tokens for AI response (default: 4096)'),
});

const SuggestVisualizationActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('suggest_visualization')
    .describe('Unified chart/pivot recommendations with executable params'),
  range: RangeInputSchema.describe('Range to analyze for visualization suggestions'),
  goal: z
    .string()
    .optional()
    .describe('Visualization goal, e.g., "show trends", "compare categories"'),
  preferredTypes: z.array(z.string()).optional().describe('Preferred chart/pivot types'),
  includeCharts: z.boolean().optional().default(true).describe('Include chart recommendations'),
  includePivots: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include pivot table recommendations'),
});

const GenerateFormulaActionSchema = CommonFieldsSchema.extend({
  action: z.literal('generate_formula').describe('Formula generation with context'),
  description: z.string().min(1).describe('Natural language description of the formula'),
  range: RangeInputSchema.optional().describe('Range for formula context'),
  targetCell: z.string().optional().describe('Target cell for formula context'),
  includeExplanation: z.boolean().optional().default(true).describe('Include formula explanation'),
  formulaType: z
    .enum([
      'auto',
      'xlookup',
      'xmatch',
      'filter_array',
      'unique',
      'sort_array',
      'sequence',
      'let_formula',
      'lambda',
      'byrow',
      'bycol',
    ])
    .optional()
    .default('auto')
    .describe(
      'Modern formula type preset: auto (AI chooses), xlookup (flexible lookup), xmatch (position match), filter_array (conditional array), unique (deduplicate), sort_array (sort by column), sequence (number series), let_formula (variable binding), lambda (reusable function), byrow/bycol (row/column iteration)'
    ),
});

const DetectPatternsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('detect_patterns').describe('Anomalies, trends, correlations'),
  range: RangeInputSchema.describe('Range to analyze for patterns'),
  includeCorrelations: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include correlation analysis'),
  includeTrends: z.boolean().optional().default(true).describe('Include trend detection'),
  includeSeasonality: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include seasonality patterns'),
  includeAnomalies: z.boolean().optional().default(true).describe('Include anomaly detection'),
});

// ===== SPECIALIZED ACTIONS (4 actions) =====

const AnalyzeStructureActionSchema = CommonFieldsSchema.extend({
  action: z.literal('analyze_structure').describe('Schema, types, relationships'),
  range: RangeInputSchema.optional().describe('Range to analyze'),
  detectTables: z.boolean().optional().default(true).describe('Detect table structures'),
  detectHeaders: z.boolean().optional().default(true).describe('Detect header rows'),
});

const AnalyzeQualityActionSchema = CommonFieldsSchema.extend({
  action: z.literal('analyze_quality').describe('Nulls, duplicates, outliers'),
  range: RangeInputSchema.optional().describe('Range to analyze'),
  checks: z
    .array(
      z.enum([
        'headers',
        'data_types',
        'empty_cells',
        'duplicates',
        'outliers',
        'formatting',
        'validation',
      ])
    )
    .optional()
    .describe('Quality checks to perform'),
  outlierMethod: z.enum(['iqr', 'zscore', 'modified_zscore']).optional().default('iqr'),
  outlierThreshold: z.coerce.number().optional().default(1.5),
});

const AnalyzePerformanceActionSchema = CommonFieldsSchema.extend({
  action: z.literal('analyze_performance').describe('Optimization suggestions'),
  range: RangeInputSchema.optional().describe('Range to analyze'),
  maxSheets: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(5)
    .describe(
      'Maximum sheets to fetch grid data for (default 5). Prevents unbounded fetches on large spreadsheets.'
    ),
});

const AnalyzeFormulasActionSchema = CommonFieldsSchema.extend({
  action: z.literal('analyze_formulas').describe('Formula analysis and optimization'),
  range: RangeInputSchema.optional().describe('Range to analyze'),
  includeOptimizations: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include optimization suggestions'),
  includeComplexity: z.boolean().optional().default(true).describe('Include complexity scoring'),
});

// ===== INTELLIGENCE ACTIONS (2 actions) =====

const QueryNaturalLanguageActionSchema = CommonFieldsSchema.extend({
  action: z.literal('query_natural_language').describe('Conversational data queries'),
  query: z.string().describe('Natural language query'),
  range: RangeInputSchema.optional().describe('Range for query context'),
  conversationId: z.string().optional().describe('Conversation ID for multi-turn queries'),
});

const ExplainAnalysisActionSchema = z
  .object({
    action: z.literal('explain_analysis').describe('Conversational explanations'),
    analysisResult: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
          z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        ])
      )
      .optional()
      .describe('Previous analysis result to explain'),
    question: z.string().optional().describe('Specific question about the analysis'),
    spreadsheetId: SpreadsheetIdSchema.optional().describe('Spreadsheet ID (optional for context)'),
    sheetId: SheetIdSchema.optional().describe('Sheet ID (optional for context)'),
    context: z.string().optional().describe('Additional context'),
    verbosity: z
      .enum(['minimal', 'standard', 'detailed'])
      .optional()
      .default('standard')
      .describe('Response detail level'),
  })
  .refine((data) => !!data.analysisResult || !!data.question, {
    message: 'Either analysisResult or question must be provided',
  });

// ===== PROGRESSIVE ANALYSIS ACTIONS (5 actions) =====

/**
 * Scout Action - Quick metadata scan for initial assessment
 *
 * DESIGN: Single API call, NO data fetch, ~200ms response time.
 * Returns: sheet overview, column names/types, quick indicators, suggested analyses.
 * Use this as the FIRST step before deeper analysis.
 */
const ScoutActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('scout')
    .describe(
      'Quick metadata scan (~200ms) - NO data fetched. Returns sheet overview, column types, quick quality indicators, and suggested next analyses. Use as FIRST step.'
    ),
  includeColumnTypes: z
    .boolean()
    .optional()
    .default(true)
    .describe('Infer column types from header row (minimal overhead)'),
  includeQuickIndicators: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include quick quality/health indicators'),
  detectIntent: z
    .boolean()
    .optional()
    .default(true)
    .describe('Auto-detect likely analysis intent based on spreadsheet characteristics'),
});

/**
 * Plan Action - Create AI-assisted analysis plan
 *
 * DESIGN: Uses MCP Sampling to intelligently plan analysis steps.
 * Takes scout results + user intent, returns ordered steps with estimates.
 */
const PlanActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('plan')
    .describe(
      'Create AI-assisted analysis plan based on scout results and intent. Returns ordered steps with time estimates.'
    ),
  intent: AnalysisIntentSchema.default('auto'),
  scoutResult: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      ])
    )
    .optional()
    .describe('Result from previous scout action (optional, will scout if not provided)'),
  constraints: z
    .object({
      maxDuration: z
        .number()
        .int()
        .positive()
        .max(300000)
        .optional()
        .describe('Maximum total analysis time in ms (default: 30000)'),
      maxApiCalls: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe('Maximum Google API calls (default: 20)'),
      focusSheets: z
        .array(z.number().int().min(0))
        .max(10)
        .optional()
        .describe('Only analyze these sheet indices'),
      focusColumns: z.array(z.string()).max(20).optional().describe('Only analyze these columns'),
      skipAnalyses: z
        .array(z.enum(['quality', 'formulas', 'patterns', 'performance', 'visualizations']))
        .optional()
        .describe('Skip these analysis types'),
    })
    .optional()
    .describe('Constraints to limit analysis scope'),
});

/**
 * Analysis Plan Step - Individual step in a plan
 */
const AnalysisPlanStepSchema = z.object({
  // BUG-16 fix: Only `type` is truly required. LLMs often omit metadata fields
  // like order, priority, estimatedDuration, reason, outputs when calling execute_plan.
  order: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Execution order (1 = first, auto-assigned if omitted)'),
  type: z
    .enum(['quality', 'formulas', 'patterns', 'performance', 'structure', 'visualizations'])
    .describe('Analysis type'),
  priority: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .default('medium')
    .describe('Priority based on detected issues'),
  target: z
    .object({
      sheets: z.array(z.number().int()).optional().describe('Sheet indices to analyze'),
      columns: z.array(z.string()).optional().describe('Column names to focus on'),
      range: z.string().optional().describe('Specific range to analyze'),
    })
    .optional()
    .describe('Target scope for this step'),
  estimatedDuration: z
    .string()
    .optional()
    .default('~2s')
    .describe('Estimated time (e.g., "~2s", "~500ms")'),
  reason: z.string().optional().describe('Why this step is recommended'),
  outputs: z.array(z.string()).optional().describe('What this step will produce'),
});

/**
 * Execute Plan Action - Run planned analysis steps
 */
const ExecutePlanActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('execute_plan')
    .describe('Execute analysis plan steps. Can run all at once or step-by-step.'),
  plan: z.object({
    steps: z.array(AnalysisPlanStepSchema).min(1).max(10),
  }),
  executeAll: z
    .boolean()
    .optional()
    .default(true)
    .describe('Execute all steps (true) or just the first step (false)'),
  stepIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Specific step index to execute (0-based, overrides executeAll)'),
  includeNextActions: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include executable nextActions in response'),
});

/**
 * Drill Down Action - Deep dive into specific finding
 *
 * DESIGN: After analysis, LLM can use drillDown options to explore further.
 * Each drill-down target type has specific parameters.
 */
const DrillDownActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('drill_down')
    .describe(
      'Deep dive into specific finding, issue, sheet, column, or pattern. Use after initial analysis to explore further.'
    ),
  target: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('issue').describe('Drill into a specific quality issue'),
        issueId: z.string().describe('Issue ID from previous analysis'),
        includeContext: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include surrounding data context'),
        showSimilar: z
          .boolean()
          .optional()
          .default(true)
          .describe('Find similar issues in other locations'),
      }),
      z.object({
        type: z.literal('sheet').describe('Drill into a specific sheet'),
        sheetIndex: z.number().int().min(0).describe('Sheet index (0-based)'),
        analyses: z
          .array(z.enum(['quality', 'formulas', 'patterns', 'performance']))
          .optional()
          .describe('Specific analyses to run (all if not specified)'),
      }),
      z.object({
        type: z.literal('column').describe('Drill into a specific column'),
        sheetIndex: z.number().int().min(0).describe('Sheet index'),
        column: z.string().describe('Column name or letter (e.g., "Name" or "B")'),
        depth: z
          .enum(['stats', 'quality', 'patterns', 'all'])
          .optional()
          .default('all')
          .describe('Analysis depth'),
      }),
      z.object({
        type: z.literal('formula').describe('Drill into a specific formula'),
        cell: z.string().describe('Cell reference (e.g., "Sheet1!B5")'),
        includeDependencies: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include formula dependency graph'),
        includeImpact: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include cells affected by this formula'),
      }),
      z.object({
        type: z.literal('anomaly').describe('Drill into a detected anomaly'),
        anomalyId: z.string().describe('Anomaly ID from previous analysis'),
        includeNeighbors: z
          .boolean()
          .optional()
          .default(true)
          .describe('Include neighboring values for context'),
        explainDetection: z
          .boolean()
          .optional()
          .default(true)
          .describe('Explain why this was flagged'),
      }),
      z.object({
        type: z.literal('pattern').describe('Drill into a detected pattern'),
        patternId: z.string().describe('Pattern ID from previous analysis'),
        showExamples: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe('Number of examples to show'),
      }),
      z.object({
        type: z.literal('correlation').describe('Drill into a correlation'),
        columns: z
          .array(z.string())
          .min(2)
          .max(2)
          .describe('Two column names to analyze correlation'),
        sheetIndex: z.number().int().min(0).optional().describe('Sheet index (0 if not specified)'),
      }),
    ])
    .describe(
      'Target to drill into. Valid types: issue, sheet, column, formula, anomaly, pattern, correlation. Each type has its own required fields. Example: { "type": "sheet", "sheetIndex": 0 }'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe('Maximum items to return'),
});

/**
 * Generate Actions Action - Create executable action plan from findings
 *
 * DESIGN: Takes analysis results and generates ready-to-execute actions.
 * Each action has complete params for immediate execution.
 */
const GenerateActionsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('generate_actions')
    .describe(
      'Generate executable action plan from analysis findings. Returns prioritized actions with complete params.'
    ),
  findings: z
    .union([
      z.array(z.record(z.string(), z.unknown())),
      z
        .object({
          findings: z.array(z.record(z.string(), z.unknown())).optional(),
          issues: z.array(z.record(z.string(), z.unknown())).optional(),
          errors: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .passthrough(),
      z.record(z.string(), z.unknown()),
    ])
    .optional()
    .describe(
      'Previous analysis findings. Accepts a canonical findings[] array, or an object containing findings[], issues[], or errors[] from prior analyze actions.'
    ),
  intent: z
    .enum([
      'fix_critical', // Only critical/high severity issues
      'fix_all', // All fixable issues
      'optimize', // Performance improvements
      'visualize', // Create recommended charts/pivots
      'format', // Apply formatting suggestions
    ])
    .describe(
      'Intended action type. Valid values: fix_critical (high severity issues only), fix_all (all fixable issues), optimize (performance improvements), visualize (create charts/pivots), format (apply styling)'
    ),
  preview: z
    .boolean()
    .optional()
    .default(true)
    .describe('Preview mode - show what would happen without executing'),
  maxActions: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum actions to return'),
  groupRelated: z.boolean().optional().default(true).describe('Group related actions together'),
  estimateImpact: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include before/after impact estimates'),
});

// ===== SMART SUGGESTIONS ACTIONS (2) - F4 =====

/**
 * Suggestion category for filtering
 */
const SuggestionCategorySchema = z.enum([
  'formulas',
  'formatting',
  'structure',
  'data_quality',
  'visualization',
]);

/**
 * Individual suggestion with executable params
 */
export const SuggestionSchema = z.object({
  id: z.string().describe('Unique suggestion identifier'),
  title: z.string().describe('Short human-readable title'),
  description: z.string().describe('Detailed explanation of what this suggestion does and why'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
  category: SuggestionCategorySchema.describe('Suggestion category'),
  impact: z
    .enum(['low_risk', 'medium_risk', 'high_risk'])
    .describe('Risk level of applying this suggestion'),
  action: z
    .object({
      tool: z.string().describe('Tool to use (e.g., sheets_data, sheets_format)'),
      action: z.string().describe('Action to perform'),
      params: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
            z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          ])
        )
        .describe('Complete parameters ready to execute'),
    })
    .describe('Executable action — can be dispatched directly to the target tool'),
});

const SuggestNextActionsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('suggest_next_actions')
    .describe(
      'Proactively suggest improvements for a spreadsheet. Returns ranked, executable suggestions based on structural analysis and pattern detection.'
    ),
  range: RangeInputSchema.optional().describe('Scope suggestions to this range'),
  maxSuggestions: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum suggestions to return (default 5)'),
  categories: z
    .array(SuggestionCategorySchema)
    .optional()
    .describe('Filter to specific categories. Omit for all categories.'),
});

const AutoEnhanceActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('auto_enhance')
    .describe(
      'Automatically apply non-destructive enhancements (formatting, structure) to a spreadsheet. Preview mode shows changes without applying.'
    ),
  range: RangeInputSchema.optional().describe('Scope enhancements to this range'),
  categories: z
    .array(SuggestionCategorySchema)
    .optional()
    .default(['formatting', 'structure'])
    .describe(
      'Enhancement categories to apply (default: formatting + structure only — safe, non-destructive)'
    ),
  mode: z
    .enum(['preview', 'apply'])
    .optional()
    .default('preview')
    .describe('preview = show what would change; apply = execute enhancements'),
  maxEnhancements: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3)
    .describe('Maximum enhancements to apply (default 3)'),
});

// ===== ACTION DISCOVERY - Meta-tool for finding actions by natural language =====

/**
 * Discovery result for a single action
 */
export const ActionDiscoveryMatchSchema = z.object({
  tool: z.string().describe('Tool name (e.g., sheets_data, sheets_format)'),
  action: z.string().describe('Action name (e.g., read, write)'),
  confidence: z.number().min(0).max(1).describe('Match confidence score 0-1'),
  description: z.string().describe('What this action does'),
  whenToUse: z.string().optional().describe('When to use this action'),
  whenNotToUse: z.string().optional().describe('When to avoid this action'),
  commonMistake: z.string().optional().describe('Top common mistake to avoid'),
});

/**
 * Discover Action - Find actions using natural language search
 *
 * DESIGN: This is a meta-tool that helps Claude find the right action
 * when they're not sure what to use. Instead of guessing, the user can ask:
 * "How do I merge cells?" → discover_action finds sheets_dimensions.merge
 * "I want to combine two spreadsheets" → discover_action finds sheets_data.cross_read
 *
 * Powered by ACTION_ANNOTATIONS which contains all registered actions
 * with whenToUse descriptions that get indexed for search.
 */
const DiscoverActionActionSchema = z.object({
  action: z
    .literal('discover_action')
    .describe(
      'Find the right action using natural language. Ask in plain English: "merge cells", "combine spreadsheets", "find duplicates", etc.'
    ),
  query: z
    .string()
    .min(2)
    .describe(
      'Natural language search query (e.g., "merge cells", "combine data", "find missing values"). Be specific about what you want to do.'
    ),
  category: z
    .enum(['data', 'format', 'analysis', 'structure', 'collaboration', 'automation', 'all'])
    .optional()
    .default('all')
    .describe('Optional category filter for faster results'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(5)
    .describe('Maximum results to return (default 5, max 10)'),
});

/**
 * Check overall formula health: volatile functions, deeply nested formulas,
 * missing error guards (IFERROR/IFNA), inconsistent column formulas, and
 * named range coverage. Returns a scored health report with actionable findings.
 */
const FormulaHealthCheckActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('formula_health_check')
    .describe(
      'Audit formula health across the spreadsheet. Detects volatile functions (NOW, RAND, INDIRECT), ' +
        'deeply nested formulas (depth > 5), missing IFERROR/IFNA guards on VLOOKUP/INDEX-MATCH, ' +
        'inconsistent formulas within a column, and orphaned named ranges. ' +
        'Returns a health score (0–100) with severity-ranked findings and fix suggestions.'
    ),
  range: RangeInputSchema.optional().describe(
    'Range to audit. If omitted, scans all sheets with formulas.'
  ),
  maxDepthThreshold: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Nesting depth at which a formula is flagged as overly complex (default 5)'),
  checkVolatile: z.boolean().optional().default(true).describe('Flag volatile functions'),
  checkConsistency: z
    .boolean()
    .optional()
    .default(true)
    .describe('Flag columns where some rows have formulas and others have hardcoded values'),
  checkErrorGuards: z
    .boolean()
    .optional()
    .default(true)
    .describe('Flag lookup formulas missing IFERROR/IFNA protection'),
});

/**
 * Quick Insights — fast, no-AI structural snapshot of a spreadsheet.
 *
 * Returns row/column counts, detected column data-types, empty-cell rate,
 * pattern-based observations, and actionable suggestions. No Sampling call
 * is made, so this completes in milliseconds even for large sheets.
 */
const QuickInsightsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('quick_insights')
    .describe(
      'Fast, AI-free structural analysis. Returns stats (row count, column count, data types, ' +
        'empty rate), pattern-based insights, actionable suggestions, and data-quality warnings ' +
        'in under 500 ms. Use this for a quick overview before running deeper analysis.'
    ),
  range: z
    .string()
    .optional()
    .describe('Optional A1 notation range to scope analysis (e.g. Sheet1!A1:D100)'),
  maxInsights: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .default(5)
    .describe('Maximum number of insights to return (default: 5)'),
});

/**
 * Diagnose formula errors (#REF!, #VALUE!, #NAME?, #DIV/0!, #N/A, circular refs)
 * with root cause analysis and suggested fixes.
 * Competitive parity: Claude in Excel's #1 feature — traces formula errors with cell-level citations.
 */
const DiagnoseErrorsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('diagnose_errors')
    .describe(
      'Diagnose and explain errors in spreadsheet formulas and data. ' +
        'Traces #REF!, #VALUE!, #NAME?, #DIV/0!, #NULL!, #N/A errors and circular references ' +
        'with root cause analysis, dependency chain, and suggested fixes.'
    ),
  range: RangeInputSchema.optional().describe(
    'Range to scan for errors. If omitted, scans all sheets.'
  ),
  includeFormulas: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include formula text in error diagnosis for context'),
});

/**
 * Semantic search across spreadsheet contents using natural language.
 * Indexes cell ranges as embeddings and retrieves the most relevant sections
 * for a given query. Requires VOYAGE_API_KEY environment variable.
 */
const SemanticSearchActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('semantic_search')
    .describe(
      'Search spreadsheet content by meaning, not exact text. ' +
        'Indexes cell ranges as embeddings and returns the most relevant sections for a natural language query. ' +
        'Example: "find all rows about Q4 revenue projections". ' +
        'Requires VOYAGE_API_KEY. First call on a spreadsheet triggers indexing (~2-5s). ' +
        'Subsequent queries on the same spreadsheet are fast (<500ms).'
    ),
  query: z
    .string()
    .min(3)
    .max(500)
    .describe('Natural language search query, e.g. "quarterly revenue targets by region"'),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe('Number of results to return (default: 5, max: 20)'),
  forceReindex: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Force re-indexing even if a recent index exists. Use after significant spreadsheet edits.'
    ),
});

// Scheduled Intelligence actions (3) — Steps 066-068
const ScheduleIntelligenceActionSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema,
  action: z
    .literal('schedule_intelligence')
    .describe(
      'Create a recurring intelligence schedule that periodically analyzes a spreadsheet ' +
        'and optionally fires a webhook when conditions are met. ' +
        'Example: Monitor for anomalies in revenue data every hour.'
    ),
  analysisType: z
    .enum(['quality_check', 'anomaly_detection', 'trend_analysis', 'custom_query'])
    .describe('Type of analysis to perform on each run'),
  query: z
    .string()
    .max(500)
    .optional()
    .describe('Natural language query for custom_query analysis type'),
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(10080)
    .default(60)
    .describe('How often to run analysis (minutes). Default: 60 (hourly). Max: 10080 (weekly).'),
  conditions: z
    .array(
      z.object({
        metric: z.string().describe('Metric to evaluate (e.g., "anomaly_count", "quality_score")'),
        operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'ne']),
        threshold: z.number(),
      })
    )
    .optional()
    .describe('Conditions that must be met to trigger webhook delivery'),
  webhookUrl: z
    .string()
    .url()
    .optional()
    .describe('Webhook URL to POST results when conditions are met'),
  range: z.string().optional().describe('Specific range to analyze (default: entire spreadsheet)'),
});

const GetIntelligenceReportActionSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema,
  action: z
    .literal('get_intelligence_report')
    .describe(
      'Retrieve the latest intelligence report for a schedule. ' +
        'Returns findings, condition evaluation results, and delivery status.'
    ),
  scheduleId: z.string().uuid().describe('ID of the schedule to get the report for'),
});

const CancelIntelligenceActionSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema,
  action: z
    .literal('cancel_intelligence')
    .describe('Cancel and delete a recurring intelligence schedule.'),
  scheduleId: z.string().uuid().describe('ID of the schedule to cancel'),
});

/**
 * All analysis operation inputs
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsAnalyzeInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    // Core actions (5)
    ComprehensiveActionSchema,
    AnalyzeDataActionSchema,
    SuggestVisualizationActionSchema,
    GenerateFormulaActionSchema,
    DetectPatternsActionSchema,
    // Specialized actions (4)
    AnalyzeStructureActionSchema,
    AnalyzeQualityActionSchema,
    AnalyzePerformanceActionSchema,
    AnalyzeFormulasActionSchema,
    // Intelligence actions (2)
    QueryNaturalLanguageActionSchema,
    ExplainAnalysisActionSchema,
    // Progressive analysis actions (5)
    ScoutActionSchema,
    PlanActionSchema,
    ExecutePlanActionSchema,
    DrillDownActionSchema,
    GenerateActionsActionSchema,
    // Smart suggestions actions (2) - F4
    SuggestNextActionsActionSchema,
    AutoEnhanceActionSchema,
    // Meta-tools (1)
    DiscoverActionActionSchema,
    // Diagnostic actions (2) - competitive parity with Claude in Excel
    DiagnoseErrorsActionSchema,
    FormulaHealthCheckActionSchema,
    // Fast insights (1) - no AI, instant structural snapshot
    QuickInsightsActionSchema,
    // Semantic search (1) - ISSUE-174/175
    SemanticSearchActionSchema,
    // Scheduled intelligence (3) - Steps 066-068
    ScheduleIntelligenceActionSchema,
    GetIntelligenceReportActionSchema,
    CancelIntelligenceActionSchema,
  ]),
});

/**
 * Analysis finding schema
 */
const AnalysisFindingSchema = z.object({
  type: AnalysisTypeSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  findings: z.array(z.string()),
  details: z.string(),
  affectedCells: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
});

/**
 * Formula suggestion schema
 */
const FormulaSuggestionSchema = z.object({
  formula: z.string(),
  explanation: z.string(),
  assumptions: z.array(z.string()).optional(),
  alternatives: z
    .array(
      z.object({
        formula: z.string(),
        useCase: z.string(),
      })
    )
    .optional(),
  tips: z.array(z.string()).optional(),
});

/**
 * Chart recommendation schema with executable parameters
 */
const ChartRecommendationSchema = z.object({
  chartType: ChartTypeSchema,
  suitabilityScore: z.coerce.number().min(0).max(100),
  reasoning: z.string(),
  configuration: z
    .object({
      categories: z.string().optional(),
      series: z.array(z.string()).optional(),
      stacked: z.boolean().optional(),
      title: z.string().optional(),
    })
    .optional(),
  insights: z.array(z.string()).optional(),
  // NEW: Executable parameters for sheets_visualize tool
  executionParams: z
    .object({
      tool: z.literal('sheets_visualize'),
      action: z.literal('chart_create'),
      params: z.object({
        spreadsheetId: z.string(),
        sheetId: z.coerce.number().int(),
        chartType: ChartTypeSchema,
        data: z.object({
          sourceRange: RangeInputSchema,
          series: z
            .array(
              z.object({
                column: z.coerce.number().int().min(0),
                color: ColorSchema.optional(),
              })
            )
            .optional(),
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
        }),
        position: ChartPositionSchema,
        options: z
          .object({
            title: z.string().optional(),
            legendPosition: LegendPositionSchema.optional(),
            axisTitle: z
              .object({
                horizontal: z.string().optional(),
                vertical: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    })
    .describe('Ready-to-execute parameters for sheets_visualize:chart_create action'),
});

/**
 * Pivot table recommendation schema with executable parameters
 */
const PivotRecommendationSchema = z.object({
  confidence: z.coerce.number().min(0).max(100),
  reasoning: z.string(),
  configuration: z.object({
    rows: z.array(z.string()),
    columns: z.array(z.string()),
    values: z.array(
      z.object({
        field: z.string(),
        aggregation: z.enum(['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX']),
      })
    ),
  }),
  sourceRange: z.string(),
  // NEW: Executable parameters for sheets_visualize tool
  executionParams: z
    .object({
      tool: z.literal('sheets_visualize'),
      action: z.literal('pivot_create'),
      params: z.object({
        spreadsheetId: z.string(),
        sourceRange: RangeInputSchema,
        values: z
          .array(
            z.object({
              sourceColumnOffset: z.coerce.number().int().min(0),
              summarizeFunction: SummarizeFunctionSchema,
              name: z.string().optional(),
              calculatedDisplayType: z
                .enum(['PERCENT_OF_ROW_TOTAL', 'PERCENT_OF_COLUMN_TOTAL', 'PERCENT_OF_GRAND_TOTAL'])
                .optional(),
            })
          )
          .min(1),
        rows: z
          .array(
            z.object({
              sourceColumnOffset: z.coerce.number().int().min(0),
              sortOrder: SortOrderSchema.optional(),
              showTotals: z.boolean().optional(),
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
            })
          )
          .optional(),
        columns: z
          .array(
            z.object({
              sourceColumnOffset: z.coerce.number().int().min(0),
              sortOrder: SortOrderSchema.optional(),
              showTotals: z.boolean().optional(),
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
            })
          )
          .optional(),
        filters: z
          .array(
            z.object({
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
            })
          )
          .optional(),
        destinationSheetId: z.coerce.number().int().optional(),
        destinationCell: z.string().optional(),
      }),
    })
    .describe('Ready-to-execute parameters for sheets_visualize:pivot_create action'),
});

/**
 * Structure analysis result (from sheets_analyze)
 */
const StructureAnalysisSchema = z.object({
  sheets: z.coerce.number().int(),
  totalRows: z.coerce.number().int(),
  totalColumns: z.coerce.number().int(),
  tables: z
    .array(
      z.object({
        sheetId: z.coerce.number().int(),
        range: z.string(),
        headers: z.array(z.string()),
        rowCount: z.coerce.number().int(),
      })
    )
    .optional(),
  namedRanges: z
    .array(
      z.object({
        name: z.string(),
        range: z.string(),
      })
    )
    .optional(),
});

/**
 * Pattern detection result (from sheets_analyze + AI)
 */
const PatternDetectionSchema = z.object({
  correlations: z
    .object({
      matrix: z.array(z.array(z.coerce.number())),
      columns: z.array(z.string()),
    })
    .optional(),
  trends: z
    .array(
      z.object({
        column: z.string(),
        direction: z.enum(['increasing', 'decreasing', 'stable', 'seasonal']),
        confidence: z.coerce.number().min(0).max(100),
        description: z.string(),
      })
    )
    .optional(),
  anomalies: z
    .array(
      z.object({
        location: z.string(),
        value: z.union([z.string(), z.coerce.number()]),
        expectedRange: z.string().optional(),
        severity: z.enum(['low', 'medium', 'high']),
      })
    )
    .optional(),
  seasonality: z
    .object({
      detected: z.boolean(),
      period: z.coerce.number().optional(),
      confidence: z.coerce.number().optional(),
    })
    .optional(),
});

/**
 * Response schema (consolidated)
 */
const AnalyzeResponseSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      action: z.string(),
      aiInsight: z.string().optional().describe('Optional AI-generated narrative insight'),

      // analyze_data results
      summary: z.string().optional(),
      analyses: z.array(AnalysisFindingSchema).optional(),
      overallQualityScore: z.coerce.number().min(0).max(100).optional(),
      topInsights: z.array(z.string()).optional(),
      executionPath: z
        .enum(['fast', 'ai', 'streaming', 'sample', 'full'])
        .optional()
        .describe('Path used for analysis'),

      // suggest_visualization results
      chartRecommendations: z.array(ChartRecommendationSchema).optional(),
      pivotRecommendations: z.array(PivotRecommendationSchema).optional(),
      dataAssessment: z
        .object({
          dataType: z.string(),
          rowCount: z.coerce.number(),
          columnCount: z.coerce.number(),
          hasHeaders: z.boolean(),
        })
        .optional(),

      // generate_formula results
      formula: FormulaSuggestionSchema.optional(),

      // detect_patterns results
      patterns: PatternDetectionSchema.optional(),

      // analyze_structure results
      structure: StructureAnalysisSchema.optional(),

      // template detection results (Phase 3)
      templateDetection: TemplateDetectionSchema.optional(),

      // analyze_quality results
      dataQuality: z
        .object({
          score: z.coerce.number().min(0).max(100),
          completeness: z.coerce.number().min(0).max(100),
          consistency: z.coerce.number().min(0).max(100),
          accuracy: z.coerce.number().min(0).max(100),
          issues: z.array(DataQualityIssueSchema),
          summary: z.string(),
        })
        .passthrough()
        .optional(),

      // analyze_performance results (and comprehensive)
      performance: z
        .object({
          overallScore: z.coerce.number().min(0).max(100).optional(),
          score: z.coerce.number().min(0).max(100).optional(), // Comprehensive uses 'score'
          recommendations: z.array(
            z
              .object({
                type: z
                  .enum([
                    'VOLATILE_FORMULAS',
                    'EXCESSIVE_FORMULAS',
                    'LARGE_RANGES',
                    'CIRCULAR_REFERENCES',
                    'INEFFICIENT_STRUCTURE',
                    'TOO_MANY_SHEETS',
                  ])
                  .optional(),
                severity: z.enum(['low', 'medium', 'high']).optional(),
                description: z.string().optional(),
                estimatedImpact: z.string().optional(),
                recommendation: z.string().optional(),
              })
              .passthrough()
          ),
          estimatedImprovementPotential: z.string().optional(),
        })
        .optional(),

      // analyze_formulas results
      formulaAnalysis: z
        .object({
          totalFormulas: z.coerce.number(),
          // Health metrics (Issue #1 fix - #REF! error detection)
          healthScore: z.coerce.number().optional(),
          healthyFormulas: z.coerce.number().optional(),
          errorCount: z.coerce.number().optional(),
          errorsByType: z.record(z.string(), z.coerce.number()).optional(),
          formulaErrors: z
            .array(
              z.object({
                cell: z.string(),
                formula: z.string(),
                errorType: z.string(),
                errorValue: z.string(),
                severity: z.enum(['low', 'medium', 'high', 'critical']),
                suggestion: z.string(),
                possibleCauses: z.array(z.string()),
              })
            )
            .optional(),
          complexityDistribution: z.record(z.string(), z.coerce.number()),
          volatileFormulas: z.array(
            z.object({
              cell: z.string(),
              formula: z.string(),
              volatileFunctions: z.array(z.string()),
              impact: z.enum(['low', 'medium', 'high']),
              suggestion: z.string(),
            })
          ),
          optimizationOpportunities: z.array(
            z.object({
              type: z.string(),
              priority: z.enum(['low', 'medium', 'high']),
              affectedCells: z.array(z.string()),
              currentFormula: z.string(),
              suggestedFormula: z.string(),
              reasoning: z.string(),
            })
          ),
          upgradeOpportunities: z
            .array(
              z.object({
                cell: z.string(),
                pattern: z.string(),
                currentFormula: z.string(),
                suggestedFormula: z.string(),
                reason: z.string(),
                confidence: z.coerce.number(),
                executable: z.boolean().optional(),
              })
            )
            .optional(),
          circularReferences: z
            .array(
              z.object({
                cells: z.array(z.string()),
                chain: z.string(),
              })
            )
            .optional(),
        })
        .passthrough()
        .optional(),

      // query_natural_language results
      queryResult: z
        .object({
          query: z.string(),
          answer: z.string(),
          intent: z.object({
            type: z.string(),
            confidence: z.coerce.number(),
          }),
          data: z
            .object({
              headers: z.array(z.string()),
              rows: z.array(
                z.array(
                  z.union([
                    z.string(),
                    z.number(),
                    z.boolean(),
                    z.null(),
                    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
                    z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
                  ])
                )
              ),
            })
            .optional(),
          visualizationSuggestion: z
            .object({
              chartType: ChartTypeSchema,
              reasoning: z.string(),
            })
            .optional(),
          followUpQuestions: z.array(z.string()),
        })
        .optional(),

      // explain_analysis results
      explanation: z.string().optional(),

      // comprehensive results
      spreadsheet: z
        .object({
          id: z.string(),
          title: z.string(),
          locale: z.string(),
          timeZone: z.string(),
          lastModified: z.string().optional(),
          owner: z.string().optional(),
          sheetCount: z.coerce.number(),
          totalRows: z.coerce.number(),
          totalColumns: z.coerce.number(),
          totalCells: z.coerce.number(),
          namedRanges: z.array(z.object({ name: z.string(), range: z.string() })),
        })
        .optional(),
      sheets: z
        .array(
          z.object({
            sheetId: z.coerce.number(),
            sheetName: z.string(),
            rowCount: z.coerce.number(),
            columnCount: z.coerce.number(),
            dataRowCount: z.coerce.number(),
            columns: z.array(
              z
                .object({
                  index: z.coerce.number(),
                  name: z.string(),
                  type: z.string(),
                  nonBlankCount: z.coerce.number().optional(),
                  uniqueCount: z.coerce.number().optional(),
                })
                .passthrough()
            ), // Column stats - detailed type
            qualityScore: z.coerce.number(),
            completeness: z.coerce.number(),
            consistency: z.coerce.number(),
            issues: z.array(DataQualityIssueSchema), // Quality issues
            trends: z.array(
              z.object({
                column: z.string(),
                direction: z.enum(['increasing', 'decreasing', 'stable', 'seasonal']),
                confidence: z.coerce.number(),
                description: z.string(),
              })
            ), // Trend results
            anomalies: z.array(
              z.object({
                location: z.string(),
                value: z.union([z.string(), z.coerce.number()]),
                expectedRange: z.string().optional(),
                severity: z.enum(['low', 'medium', 'high']),
              })
            ), // Anomaly results
            correlations: z.array(
              z
                .object({
                  column1: z.string(),
                  column2: z.string(),
                  coefficient: z.coerce.number(),
                })
                .passthrough()
            ), // Correlation results
            formulas: z
              .object({
                total: z.coerce.number(),
                unique: z.coerce.number(),
                volatile: z.coerce.number(),
                complex: z.coerce.number(),
                issues: z.array(
                  z
                    .object({
                      cell: z.string(),
                      formula: z.string(),
                      errorType: z.string(),
                      severity: z.enum(['low', 'medium', 'high', 'critical']),
                    })
                    .passthrough()
                ),
              })
              .optional(),
          })
        )
        .optional(),
      aggregate: z
        .object({
          totalDataRows: z.coerce.number(),
          totalFormulas: z.coerce.number(),
          overallQualityScore: z.coerce.number(),
          overallCompleteness: z.coerce.number(),
          totalIssues: z.coerce.number(),
          totalAnomalies: z.coerce.number(),
          totalTrends: z.coerce.number(),
          totalCorrelations: z.coerce.number(),
        })
        .optional(),
      visualizations: z
        .array(
          z.object({
            chartType: ChartTypeSchema,
            suitabilityScore: z.coerce.number(),
            reasoning: z.string(),
            suggestedConfig: z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.array(z.union([z.string(), z.number(), z.boolean()])),
                z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
              ])
            ),
            executionParams: z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.array(z.union([z.string(), z.number(), z.boolean()])),
                z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
              ])
            ),
          })
        )
        .optional(),
      apiCalls: z.coerce.number().optional(),
      dataRetrieved: z
        .object({
          tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
          rowsAnalyzed: z.coerce.number(),
          samplingUsed: z.boolean(),
        })
        .optional(),

      // Pagination fields (MCP 2025-11-25 - comprehensive only)
      nextCursor: z
        .string()
        .optional()
        .describe('Next page cursor for pagination (format: "sheet:N")'),
      hasMore: z.boolean().optional().describe('True if more sheets available'),
      totalCount: z.coerce
        .number()
        .int()
        .optional()
        .describe('Total number of items available (comprehensive)'),
      resourceUri: z
        .string()
        .optional()
        .describe('Resource URI when response is too large (analyze://results/{id})'),

      // ===== PROGRESSIVE ANALYSIS RESPONSE FIELDS =====

      // scout results
      scout: z
        .object({
          spreadsheet: z.object({
            id: z.string(),
            title: z.string(),
            owner: z.string().optional(),
            lastModified: z.string().optional(),
          }),
          sheets: z.array(
            z.object({
              sheetId: z.coerce.number(),
              title: z.string(),
              rowCount: z.coerce.number(),
              columnCount: z.coerce.number(),
              estimatedCells: z.coerce.number(),
              columns: z.array(
                z.object({
                  index: z.coerce.number(),
                  name: z.string(),
                  inferredType: z.enum([
                    'number',
                    'text',
                    'date',
                    'boolean',
                    'mixed',
                    'empty',
                    'formula',
                  ]),
                })
              ),
              flags: z.object({
                hasHeaders: z.boolean(),
                hasFormulas: z.boolean(),
                hasCharts: z.boolean(),
                hasPivots: z.boolean(),
                hasFilters: z.boolean(),
                hasProtection: z.boolean(),
                isEmpty: z.boolean(),
                isLarge: z.boolean(),
              }),
            })
          ),
          totals: z.object({
            sheets: z.coerce.number(),
            rows: z.coerce.number(),
            columns: z.coerce.number(),
            estimatedCells: z.coerce.number(),
            namedRanges: z.coerce.number(),
          }),
          quickIndicators: z.object({
            emptySheets: z.coerce.number(),
            largeSheets: z.coerce.number(),
            potentialIssues: z.array(z.string()),
          }),
          suggestedAnalyses: z.array(
            z.object({
              type: z.enum([
                'quality',
                'formulas',
                'patterns',
                'performance',
                'structure',
                'visualizations',
              ]),
              priority: z.enum(['high', 'medium', 'low']),
              reason: z.string(),
              estimatedDuration: z.string(),
            })
          ),
          detectedIntent: z.object({
            likely: z.enum(['optimize', 'clean', 'visualize', 'understand', 'audit']),
            confidence: z.coerce.number().min(0).max(100),
            signals: z.array(z.string()),
          }),
        })
        .optional()
        .describe('Scout results - quick metadata scan'),

      // plan results
      plan: z
        .object({
          id: z.string(),
          intent: z.string(),
          steps: z.array(
            z.object({
              order: z.coerce.number(),
              type: z.enum([
                'quality',
                'formulas',
                'patterns',
                'performance',
                'structure',
                'visualizations',
              ]),
              priority: z.enum(['critical', 'high', 'medium', 'low']),
              target: z
                .object({
                  sheets: z.array(z.coerce.number()).optional(),
                  columns: z.array(z.string()).optional(),
                  range: z.string().optional(),
                })
                .optional(),
              estimatedDuration: z.string(),
              reason: z.string(),
              outputs: z.array(z.string()),
            })
          ),
          estimatedTotalDuration: z.string(),
          estimatedApiCalls: z.coerce.number(),
          confidenceScore: z.coerce.number(),
          rationale: z.string(),
          skipped: z.array(
            z.object({
              type: z.string(),
              reason: z.string(),
            })
          ),
        })
        .optional()
        .describe('Analysis plan - ordered steps with estimates'),

      // execute_plan results
      stepResults: z
        .array(
          z.object({
            stepIndex: z.coerce.number(),
            type: z.string(),
            status: z.enum(['completed', 'skipped', 'failed']),
            duration: z.coerce.number(),
            findings: z
              .record(
                z.string(),
                z.union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.null(),
                  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
                  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
                ])
              )
              .optional(),
            issuesFound: z.coerce.number().optional(),
            error: z.string().optional(),
          })
        )
        .optional()
        .describe('Results from execute_plan - per-step results'),

      // drill_down results
      drillDownResult: z
        .object({
          targetType: z.string(),
          targetId: z.string(),
          context: z
            .record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
                z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
              ])
            )
            .optional(),
          details: z.record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
              z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
            ])
          ),
          relatedItems: z
            .array(
              z.record(
                z.string(),
                z.union([
                  z.string(),
                  z.number(),
                  z.boolean(),
                  z.null(),
                  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
                  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
                ])
              )
            )
            .optional(),
          suggestions: z.array(z.string()).optional(),
        })
        .optional()
        .describe('Deep dive results'),

      // generate_actions results
      actionPlan: z
        .object({
          totalActions: z.coerce.number(),
          estimatedTotalImpact: z.string(),
          actions: z.array(
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
                z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
              ])
            )
          ), // ExecutableAction objects
          groupedActions: z
            .array(
              z.object({
                category: z.string(),
                actions: z.array(
                  z.record(
                    z.string(),
                    z.union([
                      z.string(),
                      z.number(),
                      z.boolean(),
                      z.null(),
                      z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
                      z.record(
                        z.string(),
                        z.union([z.string(), z.number(), z.boolean(), z.null()])
                      ),
                    ])
                  )
                ),
                combinedImpact: z.string(),
              })
            )
            .optional(),
          preview: z
            .object({
              beforeMetrics: z.record(z.string(), z.coerce.number()),
              afterMetrics: z.record(z.string(), z.coerce.number()),
              changes: z.array(z.string()),
            })
            .optional(),
        })
        .optional()
        .describe('Generated action plan with executable actions'),

      // CRITICAL: Next Actions - LLM guidance
      analysisSessionInfo: AnalysisSessionSchema.optional().describe(
        'Session info for multi-step workflows'
      ),
      analysisSummary: AnalysisSummarySchema.optional().describe(
        'Quick summary (<100 tokens) for LLM context efficiency'
      ),
      next: NextActionsSchema.optional().describe(
        'CRITICAL: What should happen next - recommended action, alternatives, drill-down options'
      ),

      // suggest_next_actions results (F4: Smart Suggestions)
      suggestions: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            confidence: z.coerce.number().min(0).max(1),
            category: z.enum([
              'formulas',
              'formatting',
              'structure',
              'data_quality',
              'visualization',
            ]),
            impact: z.enum(['low_risk', 'medium_risk', 'high_risk']),
            action: z.object({
              tool: z.string(),
              action: z.string(),
              params: z.record(z.string(), z.unknown()),
            }),
          })
        )
        .optional()
        .describe('Ranked suggestions with executable action params'),
      scoutSummary: z
        .object({
          title: z.string(),
          sheetCount: z.coerce.number(),
          estimatedCells: z.coerce.number(),
          complexityScore: z.coerce.number(),
        })
        .optional()
        .describe('Quick metadata summary from Scout scan'),
      totalCandidates: z.coerce.number().optional(),
      filtered: z.coerce.number().optional(),

      // auto_enhance results (F4: Smart Suggestions)
      enhancements: z
        .array(
          z.object({
            suggestion: z.object({
              id: z.string(),
              title: z.string(),
              description: z.string(),
              confidence: z.coerce.number(),
              category: z.string(),
              impact: z.string(),
              action: z.object({
                tool: z.string(),
                action: z.string(),
                params: z.record(z.string(), z.unknown()),
              }),
            }),
            status: z.enum(['applied', 'skipped', 'failed']),
            reason: z.string().optional(),
          })
        )
        .optional()
        .describe('Enhancement results with status per suggestion'),
      enhanceSummary: z
        .object({
          total: z.coerce.number(),
          applied: z.coerce.number(),
          skipped: z.coerce.number(),
          failed: z.coerce.number(),
        })
        .optional()
        .describe('Enhancement summary counts'),
      mode: z.enum(['preview', 'apply']).optional().describe('Enhancement mode (preview or apply)'),

      // discover_action results (meta-tool for finding actions)
      query: z.string().optional().describe('Original search query'),
      category: z.string().optional().describe('Category filter used'),
      matches: z
        .array(
          z.object({
            tool: z.string().describe('Tool name (e.g., sheets_data)'),
            action: z.string().describe('Action name (e.g., read)'),
            confidence: z.number().min(0).max(1).describe('Match confidence score'),
            description: z.string().describe('What this action does'),
            whenToUse: z.string().optional().describe('When to use this action'),
            whenNotToUse: z.string().optional().describe('When to avoid this action'),
            commonMistake: z.string().optional().describe('Top common mistake to avoid'),
          })
        )
        .optional()
        .describe('List of matching actions ranked by relevance'),
      matchCount: z.number().int().min(0).optional().describe('Total number of matches found'),
      needsClarification: z
        .boolean()
        .optional()
        .describe('True when the query is ambiguous and should be clarified'),
      clarificationReason: z
        .enum(['no_matches', 'underspecified_query', 'low_confidence', 'close_competition'])
        .optional()
        .describe('Why clarification is needed'),
      clarificationQuestion: z
        .string()
        .optional()
        .describe('Question to ask the user to disambiguate intent'),
      clarificationOptions: z
        .array(z.string())
        .optional()
        .describe('Suggested options for disambiguation'),

      // quick_insights results (S3-A)
      stats: z
        .object({
          rowCount: z.number().int().describe('Number of data rows (excluding header)'),
          columnCount: z.number().int().describe('Number of columns'),
          dataTypes: z.array(z.string()).describe('Detected data type per column'),
          emptyRate: z.number().describe('Fraction of empty cells (0–1)'),
        })
        .optional()
        .describe('Structural statistics from quick_insights'),
      insights: z
        .array(z.string())
        .optional()
        .describe('Pattern-based observations (e.g. "Column D has 23% empty cells")'),

      // Common
      duration: z.coerce.number().optional(),
      message: z.string().optional(),
      _meta: ResponseMetaSchema.optional(),
    })
    .passthrough(),
  z
    .object({
      success: z.literal(false),
      error: ErrorDetailSchema,
    })
    .passthrough(),
]);

export const SheetsAnalyzeOutputSchema = z.object({
  response: AnalyzeResponseSchema,
});

/**
 * Tool annotations following MCP 2025-11-25
 */
export const SHEETS_ANALYZE_ANNOTATIONS: ToolAnnotations = {
  title: 'Ultimate Data Analysis',
  readOnlyHint: true, // Pure analysis - does not modify spreadsheets
  destructiveHint: false, // Analysis is non-destructive
  idempotentHint: false, // AI responses may vary
  openWorldHint: true, // Uses MCP Sampling + Google API
};

// Type exports
export type SheetsAnalyzeInput = z.infer<typeof SheetsAnalyzeInputSchema>;
export type SheetsAnalyzeOutput = z.infer<typeof SheetsAnalyzeOutputSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type AnalysisType = z.infer<typeof AnalysisTypeSchema>;
export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;
export type DataQualityIssue = z.infer<typeof DataQualityIssueSchema>;
export type PerformanceRecommendation = z.infer<typeof PerformanceRecommendationSchema>;

// Type narrowing helpers for handler methods
export type AnalyzeDataInput = SheetsAnalyzeInput['request'] & {
  action: 'analyze_data';
  spreadsheetId: string;
};
export type SuggestVisualizationInput = SheetsAnalyzeInput['request'] & {
  action: 'suggest_visualization';
  spreadsheetId: string;
  range: string;
};
export type GenerateFormulaInput = SheetsAnalyzeInput['request'] & {
  action: 'generate_formula';
  spreadsheetId: string;
  description: string;
};
export type DetectPatternsInput = SheetsAnalyzeInput['request'] & {
  action: 'detect_patterns';
  spreadsheetId: string;
  range: string;
};
export type AnalyzeStructureInput = SheetsAnalyzeInput['request'] & {
  action: 'analyze_structure';
  spreadsheetId: string;
};
export type AnalyzeQualityInput = SheetsAnalyzeInput['request'] & {
  action: 'analyze_quality';
  spreadsheetId: string;
};
export type AnalyzePerformanceInput = SheetsAnalyzeInput['request'] & {
  action: 'analyze_performance';
  spreadsheetId: string;
};
export type ExplainAnalysisInput = SheetsAnalyzeInput['request'] & {
  action: 'explain_analysis';
};

// Progressive analysis action types
export type ScoutInput = SheetsAnalyzeInput['request'] & {
  action: 'scout';
  spreadsheetId: string;
};
export type PlanInput = SheetsAnalyzeInput['request'] & {
  action: 'plan';
  spreadsheetId: string;
};
export type ExecutePlanInput = SheetsAnalyzeInput['request'] & {
  action: 'execute_plan';
  spreadsheetId: string;
};
export type DrillDownInput = SheetsAnalyzeInput['request'] & {
  action: 'drill_down';
  spreadsheetId: string;
};
export type GenerateActionsInput = SheetsAnalyzeInput['request'] & {
  action: 'generate_actions';
  spreadsheetId: string;
};

export type DiscoverActionInput = SheetsAnalyzeInput['request'] & {
  action: 'discover_action';
  query: string;
  category?: string;
  maxResults?: number;
};

// Analysis intent and depth exports
export type AnalysisIntent =
  | 'quick'
  | 'optimize'
  | 'clean'
  | 'visualize'
  | 'understand'
  | 'audit'
  | 'auto';
export type AnalysisDepth = 'metadata' | 'structure' | 'sample' | 'full';
export type ComprehensiveInput = SheetsAnalyzeInput['request'] & {
  action: 'comprehensive';
  spreadsheetId: string;
};
