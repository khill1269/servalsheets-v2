/**
 * ServalSheets - Dependencies Schemas
 *
 * Schemas for formula dependency analysis and impact assessment.
 * Analyzes how formula changes propagate through a spreadsheet.
 *
 * @category Schemas
 */

import { z } from 'zod';
import { ErrorDetailSchema, RangeInputSchema } from './shared.js';

/**
 * Dependency actions
 */
export const DependencyActionsSchema = z.enum([
  'build',
  'analyze_impact',
  'detect_cycles',
  'get_dependencies',
  'get_dependents',
  'get_stats',
  'export_dot',
]);

/**
 * Build dependency graph action
 */
export const DependencyBuildInputSchema = z.object({
  action: z.literal('build').describe('Build a formula dependency graph for the spreadsheet'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
  sheetNames: z
    .array(z.string())
    .optional()
    .describe('Sheet names to analyze (default: all sheets)'),
});

/**
 * Analyze impact action
 */
export const DependencyAnalyzeImpactInputSchema = z.object({
  action: z
    .literal('analyze_impact')
    .describe('Analyze what cells would be affected by changing a cell'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
  cell: z.string().min(1, 'Cell address required').describe('Cell address (e.g., Sheet1!A1)'),
});

/**
 * Detect circular dependencies action
 */
export const DependencyDetectCyclesInputSchema = z.object({
  action: z.literal('detect_cycles').describe('Detect circular references in formulas'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
});

/**
 * Get dependencies action
 */
export const DependencyGetDependenciesInputSchema = z.object({
  action: z.literal('get_dependencies').describe('Get cells that a formula cell depends on'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
  cell: z.string().min(1, 'Cell address required').describe('Cell address (e.g., Sheet1!A1)'),
});

/**
 * Get dependents action
 */
export const DependencyGetDependentsInputSchema = z.object({
  action: z.literal('get_dependents').describe('Get cells that depend on a given cell'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
  cell: z.string().min(1, 'Cell address required').describe('Cell address (e.g., Sheet1!A1)'),
});

/**
 * Get statistics action
 */
export const DependencyGetStatsInputSchema = z.object({
  action: z.literal('get_stats').describe('Get dependency graph statistics'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
});

/**
 * Export DOT format action
 */
export const DependencyExportDotInputSchema = z.object({
  action: z.literal('export_dot').describe('Export dependency graph in Graphviz DOT format'),
  spreadsheetId: z.string().min(1, 'Spreadsheet ID required'),
});

// ============================================================================
// F6: Scenario Modeling (3 actions)
// ============================================================================

const ModelScenarioInputSchema = z.object({
  action: z
    .literal('model_scenario')
    .describe(
      'Simulate "what if" changes — trace formula cascades without modifying the spreadsheet'
    ),
  spreadsheetId: z.string().min(1),
  changes: z
    .array(
      z.object({
        cell: z.string().min(1).describe('Cell reference (A1 notation, e.g. "Sheet1!B2")'),
        newValue: z
          .union([z.string(), z.number(), z.boolean(), z.null()])
          .describe('Hypothetical new value'),
      })
    )
    .min(1)
    .max(50)
    .describe('Input changes to simulate'),
  outputRange: RangeInputSchema.optional().describe('Focus impact report on this range'),
});

const CompareScenariosInputSchema = z.object({
  action: z
    .literal('compare_scenarios')
    .describe('Compare multiple what-if scenarios side by side'),
  spreadsheetId: z.string().min(1),
  scenarios: z
    .array(
      z.object({
        name: z.string().min(1).max(100).describe('Scenario label'),
        changes: z
          .array(
            z.object({
              cell: z.string().min(1),
              newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            })
          )
          .min(1),
      })
    )
    .min(2)
    .max(10)
    .describe('Scenarios to compare'),
  compareColumns: z
    .array(z.string())
    .optional()
    .describe('Focus comparison on specific cells (A1 notation)'),
});

const CreateScenarioSheetInputSchema = z.object({
  action: z
    .literal('create_scenario_sheet')
    .describe(
      'Materialize a scenario as a new sheet tab (non-destructive copy with changes applied)'
    ),
  spreadsheetId: z.string().min(1),
  scenario: z.object({
    name: z.string().min(1).max(100).describe('Scenario name (becomes sheet tab name)'),
    changes: z
      .array(
        z.object({
          cell: z.string().min(1),
          newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        })
      )
      .min(1),
  }),
  targetSheet: z.string().optional().describe('Custom name for the new sheet tab'),
  sourceSheetName: z
    .string()
    .optional()
    .describe(
      'Which sheet to duplicate as the scenario base. If omitted, inferred from the first cell reference in changes (e.g., "Sales!A1" → "Sales"). Falls back to first sheet.'
    ),
});

/**
 * Dependencies request (discriminated union)
 */
const DependencyRequestSchema = z.discriminatedUnion('action', [
  DependencyBuildInputSchema,
  DependencyAnalyzeImpactInputSchema,
  DependencyDetectCyclesInputSchema,
  DependencyGetDependenciesInputSchema,
  DependencyGetDependentsInputSchema,
  DependencyGetStatsInputSchema,
  DependencyExportDotInputSchema,
  ModelScenarioInputSchema,
  CompareScenariosInputSchema,
  CreateScenarioSheetInputSchema,
]);

/**
 * Dependencies input (wrapped for MCP compatibility)
 *
 * Uses the standard { request: ... } pattern that other tools use.
 * This ensures the schema matches the MCP SDK's expected input format.
 */
export const SheetsDependenciesInputSchema = z.object({
  request: DependencyRequestSchema,
});

/**
 * Circular dependency
 */
export const CircularDependencySchema = z.object({
  cycle: z.array(z.string()),
  chain: z.string(),
  severity: z.literal('error'),
});

/**
 * Recalculation cost estimate
 */
export const RecalculationCostSchema = z.object({
  cellCount: z.number().int(),
  complexityScore: z.number().int().min(0).max(100),
  timeEstimate: z.enum(['instant', 'fast', 'moderate', 'slow', 'very_slow']),
});

/**
 * Impact analysis result
 */
export const ImpactAnalysisSchema = z.object({
  targetCell: z.string(),
  directDependents: z.array(z.string()),
  allAffectedCells: z.array(z.string()),
  dependencies: z.array(z.string()),
  maxDepth: z.number().int(),
  recalculationCost: RecalculationCostSchema,
  circularDependencies: z.array(CircularDependencySchema),
});

/**
 * Dependency statistics
 */
export const DependencyStatsSchema = z.object({
  totalCells: z.number().int(),
  formulaCells: z.number().int(),
  valueCells: z.number().int(),
  totalDependencies: z.number().int(),
  maxDepth: z.number().int(),
  mostComplexCells: z.array(
    z.object({
      cell: z.string(),
      dependencyCount: z.number().int(),
    })
  ),
  mostInfluentialCells: z.array(
    z.object({
      cell: z.string(),
      dependentCount: z.number().int(),
    })
  ),
});

/**
 * Build result
 */
export const DependencyBuildResultSchema = z.object({
  spreadsheetId: z.string(),
  cellCount: z.number().int(),
  formulaCount: z.number().int(),
  message: z.string(),
});

/**
 * Dependencies output response
 */
const DependenciesResponseSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      data: z.union([
        DependencyBuildResultSchema,
        ImpactAnalysisSchema,
        z.object({ circularDependencies: z.array(CircularDependencySchema) }),
        z.object({ dependencies: z.array(z.string()) }),
        z.object({ dependents: z.array(z.string()) }),
        DependencyStatsSchema,
        z.object({ dot: z.string() }),
        // F6: Scenario results
        z
          .object({
            action: z.literal('model_scenario'),
            inputChanges: z.array(
              z.object({
                cell: z.string(),
                from: z.union([z.string(), z.number(), z.null()]).optional(),
                to: z.union([z.string(), z.number(), z.boolean(), z.null()]),
              })
            ),
            cascadeEffects: z.array(
              z.object({
                cell: z.string(),
                formula: z.string().optional(),
                currentValue: z.union([z.string(), z.number(), z.null()]).optional(),
                affectedBy: z.array(z.string()).optional(),
              })
            ),
            summary: z.object({
              cellsAffected: z.number().int(),
              message: z.string(),
            }),
          })
          .passthrough(),
        // F6: compare_scenarios result
        z
          .object({
            action: z.literal('compare_scenarios'),
            scenarios: z.array(
              z
                .object({
                  name: z.string(),
                  cellsAffected: z.number().int(),
                })
                .passthrough()
            ),
            message: z.string(),
          })
          .passthrough(),
        // F6: create_scenario_sheet result
        z
          .object({
            action: z.literal('create_scenario_sheet'),
            newSheetId: z.number().int(),
            newSheetName: z.string(),
            cellsModified: z.number().int(),
            message: z.string(),
          })
          .passthrough(),
      ]),
    })
    .passthrough(),
  z
    .object({
      success: z.literal(false),
      error: ErrorDetailSchema,
    })
    .passthrough(),
]);

export const SheetsDependenciesOutputSchema = z.object({
  response: DependenciesResponseSchema,
});

/**
 * Tool annotations for sheets_dependencies
 */
export const SHEETS_DEPENDENCIES_ANNOTATIONS = {
  title: 'Formula Dependencies & Scenario Modeling',
  readOnlyHint: false, // create_scenario_sheet writes a new sheet
  destructiveHint: true, // create_scenario_sheet creates a new sheet (side effect)
  idempotentHint: false, // create_scenario_sheet creates new resources
  openWorldHint: true, // Reads from Google Sheets API
};

// Type exports
export type DependencyActions = z.infer<typeof DependencyActionsSchema>;
export type SheetsDependenciesInput = z.infer<typeof SheetsDependenciesInputSchema>;
export type DependencyBuildInput = z.infer<typeof DependencyBuildInputSchema>;
export type DependencyAnalyzeImpactInput = z.infer<typeof DependencyAnalyzeImpactInputSchema>;
export type DependencyDetectCyclesInput = z.infer<typeof DependencyDetectCyclesInputSchema>;
export type DependencyGetDependenciesInput = z.infer<typeof DependencyGetDependenciesInputSchema>;
export type DependencyGetDependentsInput = z.infer<typeof DependencyGetDependentsInputSchema>;
export type DependencyGetStatsInput = z.infer<typeof DependencyGetStatsInputSchema>;
export type DependencyExportDotInput = z.infer<typeof DependencyExportDotInputSchema>;
export type CircularDependency = z.infer<typeof CircularDependencySchema>;
export type RecalculationCost = z.infer<typeof RecalculationCostSchema>;
export type ImpactAnalysis = z.infer<typeof ImpactAnalysisSchema>;
export type DependencyStats = z.infer<typeof DependencyStatsSchema>;
export type DependencyBuildResult = z.infer<typeof DependencyBuildResultSchema>;
export type SheetsDependenciesOutput = z.infer<typeof SheetsDependenciesOutputSchema>;
export type ModelScenarioInput = z.infer<typeof ModelScenarioInputSchema>;
export type CompareScenariosInput = z.infer<typeof CompareScenariosInputSchema>;
export type CreateScenarioSheetInput = z.infer<typeof CreateScenarioSheetInputSchema>;
