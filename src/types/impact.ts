/**
 * ServalSheets - Operation Impact Analysis Types
 *
 * Type definitions for analyzing operation impact before execution
 *
 * Phase 4, Task 4.3
 */

import type { GoogleApiClient } from '../services/google-api.js';

/**
 * Impact severity
 */
export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Affected resource type
 */
export type AffectedResourceType =
  | 'cells'
  | 'formulas'
  | 'charts'
  | 'pivot_tables'
  | 'validation_rules'
  | 'conditional_formats'
  | 'named_ranges'
  | 'protected_ranges';

/**
 * Operation impact analysis
 */
export interface ImpactAnalysis {
  /** Analysis ID */
  id: string;

  /** Operation being analyzed */
  operation: {
    type: string;
    tool: string;
    action: string;
    params: Record<string, unknown>;
  };

  /** Cells affected */
  cellsAffected: number;

  /** Rows affected */
  rowsAffected: number;

  /** Columns affected */
  columnsAffected: number;

  /** Formulas affected */
  formulasAffected: AffectedFormula[];

  /** Charts affected */
  chartsAffected: AffectedChart[];

  /** Pivot tables affected */
  pivotTablesAffected: AffectedPivotTable[];

  /** Validation rules affected */
  validationRulesAffected: AffectedValidationRule[];

  /** Conditional formats affected */
  conditionalFormatsAffected: number;

  /** Named ranges affected */
  namedRangesAffected: AffectedNamedRange[];

  /** Protected ranges affected */
  protectedRangesAffected: AffectedProtectedRange[];

  /** Estimated execution time (ms) */
  estimatedExecutionTime: number;

  /** Impact severity */
  severity: ImpactSeverity;

  /** Warnings */
  warnings: ImpactWarning[];

  /** Recommendations */
  recommendations: string[];

  /** Timestamp */
  timestamp: number;
}

/**
 * Affected formula
 */
export interface AffectedFormula {
  /** Cell reference */
  cell: string;

  /** Sheet name */
  sheetName: string;

  /** Formula */
  formula: string;

  /** Impact type */
  impactType: 'references_affected_range' | 'will_become_invalid' | 'will_change';

  /** Description */
  description: string;
}

/**
 * Affected chart
 */
export interface AffectedChart {
  /** Chart ID */
  chartId: number;

  /** Chart title */
  title: string;

  /** Sheet name */
  sheetName: string;

  /** Chart type */
  chartType: string;

  /** Data ranges */
  dataRanges: string[];

  /** Impact type */
  impactType: 'data_source_affected' | 'will_break' | 'needs_update';

  /** Description */
  description: string;
}

/**
 * Affected pivot table
 */
export interface AffectedPivotTable {
  /** Pivot table ID */
  pivotTableId: number;

  /** Sheet name */
  sheetName: string;

  /** Source range */
  sourceRange: string;

  /** Impact type */
  impactType: 'source_data_affected' | 'will_break' | 'needs_refresh';

  /** Description */
  description: string;
}

/**
 * Affected validation rule
 */
export interface AffectedValidationRule {
  /** Rule ID */
  ruleId: string;

  /** Range */
  range: string;

  /** Rule type */
  ruleType: string;

  /** Impact type */
  impactType: 'will_be_removed' | 'will_be_modified' | 'may_conflict';

  /** Description */
  description: string;
}

/**
 * Affected named range
 */
export interface AffectedNamedRange {
  /** Named range ID */
  namedRangeId: string;

  /** Name */
  name: string;

  /** Range */
  range: string;

  /** Impact type */
  impactType: 'will_be_affected' | 'will_become_invalid' | 'will_be_deleted';

  /** Description */
  description: string;
}

/**
 * Affected protected range
 */
export interface AffectedProtectedRange {
  /** Protected range ID */
  protectedRangeId: number;

  /** Range */
  range: string;

  /** Description */
  description: string;

  /** Impact type */
  impactType: 'will_be_affected' | 'will_be_removed' | 'permission_required';

  /** Editors */
  editors?: string[];
}

/**
 * Impact warning
 */
export interface ImpactWarning {
  /** Warning severity */
  severity: ImpactSeverity;

  /** Warning message */
  message: string;

  /** Resource type */
  resourceType: AffectedResourceType;

  /** Affected resources count */
  affectedCount: number;

  /** Suggested action */
  suggestedAction?: string;
}

/**
 * Impact analyzer configuration
 */
export interface ImpactAnalyzerConfig {
  /** Enable impact analysis */
  enabled?: boolean;

  /** Analyze formulas */
  analyzeFormulas?: boolean;

  /** Analyze charts */
  analyzeCharts?: boolean;

  /** Analyze pivot tables */
  analyzePivotTables?: boolean;

  /** Analyze validation rules */
  analyzeValidationRules?: boolean;

  /** Analyze named ranges */
  analyzeNamedRanges?: boolean;

  /** Analyze protected ranges */
  analyzeProtectedRanges?: boolean;

  /** Analysis timeout (ms) */
  analysisTimeoutMs?: number;

  /** Verbose logging */
  verboseLogging?: boolean;

  /** Google API client for fetching spreadsheet metadata */
  googleClient?: GoogleApiClient;
}

/**
 * Impact analyzer statistics
 */
export interface ImpactAnalyzerStats {
  /** Total analyses performed */
  totalAnalyses: number;

  /** Operations prevented (critical impact) */
  operationsPrevented: number;

  /** Average analysis time (ms) */
  avgAnalysisTime: number;

  /** Total warnings generated */
  totalWarnings: number;

  /** Warnings by severity */
  warningsBySeverity: Record<ImpactSeverity, number>;
}
