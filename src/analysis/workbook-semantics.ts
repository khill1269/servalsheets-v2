/**
 * Workbook Semantic Index
 *
 * Classifies spreadsheet PURPOSE (not just structure) from comprehensive
 * analysis results. Enables LLMs to reason about what a spreadsheet IS
 * rather than just what data it contains.
 *
 * @module analysis/workbook-semantics
 */

import type { ComprehensiveResult, ColumnStats, SheetAnalysis } from './comprehensive.js';
import { logger } from '../utils/logger.js';

// ────────────────────────────────────────────
// Public Types
// ────────────────────────────────────────────

export type WorkbookType =
  | 'budget'
  | 'tracker'
  | 'report'
  | 'database'
  | 'dashboard'
  | 'form'
  | 'calendar'
  | 'inventory'
  | 'invoice'
  | 'unknown';

export interface Entity {
  type: 'date' | 'currency' | 'email' | 'percentage' | 'phone' | 'url' | 'id';
  column: string;
  sheetName: string;
  prevalence: number; // 0-1, fraction of non-null cells matching
}

export interface Relationship {
  type: 'formula_dependency' | 'lookup' | 'aggregation' | 'co_occurrence';
  from: { sheet: string; column: string };
  to: { sheet: string; column: string };
  description: string;
}

export interface KeyColumn {
  column: string;
  sheetName: string;
  role: 'id' | 'label' | 'value' | 'formula' | 'date' | 'category';
  confidence: number;
}

export interface DataRegion {
  sheetName: string;
  range: string;
  purpose: string;
  rowCount: number;
  columnCount: number;
}

export interface SemanticIndex {
  workbookType: WorkbookType;
  workbookTypeConfidence: number;
  entities: Entity[];
  relationships: Relationship[];
  temporalPattern: 'monthly' | 'weekly' | 'quarterly' | 'yearly' | 'daily' | 'none';
  keyColumns: KeyColumn[];
  dataRegions: DataRegion[];
  suggestedOperations: string[];
}

// ────────────────────────────────────────────
// Header / Column Name Pattern Banks
// ────────────────────────────────────────────

const BUDGET_PATTERNS =
  /\b(budget|expense|revenue|income|cost|profit|margin|forecast|actual|variance|spending|allocation)\b/i;
const TRACKER_PATTERNS =
  /\b(status|progress|assigned|owner|due|deadline|priority|task|milestone|phase|sprint|ticket|completed|pending)\b/i;
const REPORT_PATTERNS =
  /\b(summary|total|average|period|quarter|fiscal|ytd|mtd|comparison|growth|change|delta)\b/i;
const DATABASE_PATTERNS =
  /\b(id|key|foreign|record|index|type|category|code|sku|ref|reference|uuid)\b/i;
const DASHBOARD_PATTERNS = /\b(kpi|metric|target|goal|score|rating|benchmark|indicator)\b/i;
const CALENDAR_PATTERNS =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|schedule|appointment|event|time|slot)\b/i;
const INVENTORY_PATTERNS =
  /\b(stock|quantity|warehouse|location|reorder|sku|unit|supplier|shelf|bin)\b/i;
const INVOICE_PATTERNS =
  /\b(invoice|bill|payment|amount|due|client|customer|subtotal|tax|discount|po|purchase.?order)\b/i;
const FORM_PATTERNS =
  /\b(response|submitted|timestamp|answer|question|form|survey|feedback|rating)\b/i;

const MONTH_NAMES =
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i;
const QUARTER_NAMES = /\b(q[1-4]|quarter\s*[1-4])\b/i;
const WEEK_NAMES = /\b(week\s*\d+|wk\s*\d+|w\d+)\b/i;

// ────────────────────────────────────────────
// Main Analysis Function
// ────────────────────────────────────────────

/**
 * Build a semantic index from comprehensive analysis results.
 * This is a pure in-memory computation — zero API calls.
 */
export function buildSemanticIndex(result: ComprehensiveResult): SemanticIndex {
  try {
    const allHeaders = collectHeaders(result);
    const workbookClassification = classifyWorkbook(result, allHeaders);
    const entities = detectEntities(result);
    const relationships = inferRelationships(result);
    const temporalPattern = detectTemporalPattern(result, allHeaders);
    const keyColumns = identifyKeyColumns(result);
    const dataRegions = identifyDataRegions(result);
    const suggestedOperations = generateSuggestions(
      workbookClassification.type,
      result,
      entities,
      temporalPattern
    );

    return {
      workbookType: workbookClassification.type,
      workbookTypeConfidence: workbookClassification.confidence,
      entities,
      relationships,
      temporalPattern,
      keyColumns,
      dataRegions,
      suggestedOperations,
    };
  } catch (err) {
    logger.warn('Semantic index generation failed (non-critical)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      workbookType: 'unknown',
      workbookTypeConfidence: 0,
      entities: [],
      relationships: [],
      temporalPattern: 'none',
      keyColumns: [],
      dataRegions: [],
      suggestedOperations: [],
    };
  }
}

// ────────────────────────────────────────────
// Header Collection
// ────────────────────────────────────────────

function collectHeaders(result: ComprehensiveResult): string[] {
  const headers: string[] = [];
  for (const sheet of result.sheets) {
    for (const col of sheet.columns) {
      if (col.name) headers.push(col.name);
    }
  }
  return headers;
}

// ────────────────────────────────────────────
// Workbook Type Classification
// ────────────────────────────────────────────

interface Classification {
  type: WorkbookType;
  confidence: number;
}

function classifyWorkbook(result: ComprehensiveResult, headers: string[]): Classification {
  const scores: Record<WorkbookType, number> = {
    budget: 0,
    tracker: 0,
    report: 0,
    database: 0,
    dashboard: 0,
    form: 0,
    calendar: 0,
    inventory: 0,
    invoice: 0,
    unknown: 0,
  };

  const headerText = headers.join(' ');
  const titleText = `${result.spreadsheet.title} ${result.sheets.map((s) => s.sheetName).join(' ')}`;
  const combined = `${headerText} ${titleText}`;

  // Header pattern matching (strongest signal)
  if (BUDGET_PATTERNS.test(combined)) scores.budget += 3;
  if (TRACKER_PATTERNS.test(combined)) scores.tracker += 3;
  if (REPORT_PATTERNS.test(combined)) scores.report += 2;
  if (DATABASE_PATTERNS.test(combined)) scores.database += 2;
  if (DASHBOARD_PATTERNS.test(combined)) scores.dashboard += 3;
  if (CALENDAR_PATTERNS.test(combined)) scores.calendar += 3;
  if (INVENTORY_PATTERNS.test(combined)) scores.inventory += 3;
  if (INVOICE_PATTERNS.test(combined)) scores.invoice += 3;
  if (FORM_PATTERNS.test(combined)) scores.form += 3;

  // Structural signals
  const { aggregate } = result;

  // High formula density → budget/report/dashboard
  if (aggregate.formulaDensity > 0.2) {
    scores.budget += 2;
    scores.report += 1;
    scores.dashboard += 1;
  }

  // Charts present → dashboard/report
  if (aggregate.chartCount > 0) {
    scores.dashboard += 2;
    scores.report += 1;
  }

  // Many charts → strongly dashboard
  if (aggregate.chartCount >= 3) {
    scores.dashboard += 2;
  }

  // Data validation → form/database/inventory
  if (aggregate.dataValidationCount > 3) {
    scores.form += 1;
    scores.database += 1;
    scores.inventory += 1;
  }

  // Many rows, few sheets, high uniqueness → database
  if (result.spreadsheet.totalRows > 500 && result.spreadsheet.sheetCount <= 3) {
    scores.database += 2;
  }

  // ID-like first column (high uniqueness, no nulls) → database
  for (const sheet of result.sheets) {
    if (sheet.columns.length > 0) {
      const firstCol = sheet.columns[0]!;
      if (firstCol.uniqueCount > 0 && firstCol.completeness > 0.95) {
        const uniqueRatio = firstCol.count > 0 ? firstCol.uniqueCount / firstCol.count : 0;
        if (uniqueRatio > 0.9) {
          scores.database += 2;
        }
      }
    }
  }

  // Temporal column headers → tracker/budget/report
  const monthCount = headers.filter((h) => MONTH_NAMES.test(h)).length;
  const quarterCount = headers.filter((h) => QUARTER_NAMES.test(h)).length;
  if (monthCount >= 3) {
    scores.budget += 3;
    scores.report += 2;
  }
  if (quarterCount >= 2) {
    scores.report += 2;
    scores.budget += 1;
  }

  // Conditional formatting → dashboard/report
  if (aggregate.conditionalFormatCount > 2) {
    scores.dashboard += 1;
    scores.report += 1;
  }

  // Pivot tables → report/dashboard
  if (aggregate.pivotTableCount > 0) {
    scores.report += 2;
    scores.dashboard += 1;
  }

  // Single sheet with < 20 rows → could be invoice or form
  if (result.spreadsheet.sheetCount === 1 && result.spreadsheet.totalRows < 20) {
    scores.invoice += 1;
    scores.form += 1;
  }

  // Find the winner
  let bestType: WorkbookType = 'unknown';
  let bestScore = 0;
  let secondScore = 0;

  for (const [type, score] of Object.entries(scores) as [WorkbookType, number][]) {
    if (type === 'unknown') continue;
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestType = type;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Confidence: gap between top and second choice, normalized
  const confidence =
    bestScore === 0 ? 0 : Math.min(1, (bestScore - secondScore) / Math.max(bestScore, 1) + 0.3);

  if (bestScore < 2) {
    return { type: 'unknown', confidence: 0.1 };
  }

  return { type: bestType, confidence: Math.round(confidence * 100) / 100 };
}

// ────────────────────────────────────────────
// Entity Detection
// ────────────────────────────────────────────

function detectEntities(result: ComprehensiveResult): Entity[] {
  const entities: Entity[] = [];

  for (const sheet of result.sheets) {
    for (const col of sheet.columns) {
      // Date columns
      if (col.dataType === 'date') {
        entities.push({
          type: 'date',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }

      // Currency: numeric columns with currency-related names
      if (
        col.dataType === 'number' &&
        /\b(amount|price|cost|revenue|salary|total|balance|payment|fee|charge|budget)\b/i.test(
          col.name
        )
      ) {
        entities.push({
          type: 'currency',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }

      // Email: text columns with email-related names
      if (col.dataType === 'text' && /\b(email|e-mail|mail|contact)\b/i.test(col.name)) {
        entities.push({
          type: 'email',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }

      // Percentage: numeric columns with percentage/rate names or low ranges
      if (
        col.dataType === 'number' &&
        (/\b(rate|percent|pct|ratio|margin|share|growth|change)\b/i.test(col.name) ||
          (col.max !== undefined && col.max <= 1 && col.min !== undefined && col.min >= -1))
      ) {
        entities.push({
          type: 'percentage',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }

      // ID: high-uniqueness columns
      if (
        col.dataType === 'text' &&
        /\b(id|key|code|ref|sku|uuid|number|no|num|#)\b/i.test(col.name)
      ) {
        entities.push({
          type: 'id',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }

      // URL: text columns with url-related names
      if (col.dataType === 'text' && /\b(url|link|website|site|href)\b/i.test(col.name)) {
        entities.push({
          type: 'url',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }

      // Phone: text columns with phone-related names
      if (col.dataType === 'text' && /\b(phone|tel|mobile|cell|fax)\b/i.test(col.name)) {
        entities.push({
          type: 'phone',
          column: col.name,
          sheetName: sheet.sheetName,
          prevalence: col.completeness,
        });
      }
    }
  }

  return entities;
}

// ────────────────────────────────────────────
// Relationship Inference
// ────────────────────────────────────────────

function inferRelationships(result: ComprehensiveResult): Relationship[] {
  const relationships: Relationship[] = [];

  // Formula-based relationships
  for (const sheet of result.sheets) {
    if (!sheet.formulas) continue;
    for (const formula of sheet.formulas.issues) {
      for (const dep of formula.dependencies) {
        // Parse "Sheet2!A1" or "A1" references
        const sheetRefMatch = dep.match(/^(.+)!/);
        const targetSheet = sheetRefMatch ? sheetRefMatch[1]! : sheet.sheetName;
        const colLetter = dep.replace(/^.*!/, '').replace(/[0-9]+$/, '');

        relationships.push({
          type: 'formula_dependency',
          from: { sheet: sheet.sheetName, column: formula.cell },
          to: { sheet: targetSheet, column: colLetter },
          description: `${formula.cell} depends on ${dep} via formula`,
        });
      }
    }
  }

  // Correlation-based relationships (strong correlations suggest data relationships)
  for (const sheet of result.sheets) {
    for (const corr of sheet.correlations) {
      if (corr.strength === 'strong' || corr.strength === 'very_strong') {
        relationships.push({
          type: 'co_occurrence',
          from: { sheet: sheet.sheetName, column: corr.columns[0] },
          to: { sheet: sheet.sheetName, column: corr.columns[1] },
          description: `${corr.strength} ${corr.direction} correlation (r=${corr.coefficient.toFixed(2)})`,
        });
      }
    }
  }

  // Cross-sheet name matching (same column name in different sheets → potential lookup)
  const colNameMap = new Map<string, Array<{ sheet: string; col: ColumnStats }>>();
  for (const sheet of result.sheets) {
    for (const col of sheet.columns) {
      const key = col.name.toLowerCase().trim();
      if (!key) continue;
      const arr = colNameMap.get(key) ?? [];
      arr.push({ sheet: sheet.sheetName, col });
      colNameMap.set(key, arr);
    }
  }

  for (const [, occurrences] of colNameMap) {
    if (occurrences.length >= 2) {
      const firstOccurrence = occurrences[0];
      if (!firstOccurrence) {
        continue;
      }
      // Same column name across sheets → likely a join key
      for (let i = 1; i < occurrences.length; i++) {
        const occurrence = occurrences[i];
        if (!occurrence) {
          continue;
        }
        relationships.push({
          type: 'lookup',
          from: { sheet: firstOccurrence.sheet, column: firstOccurrence.col.name },
          to: { sheet: occurrence.sheet, column: occurrence.col.name },
          description: `Shared column "${firstOccurrence.col.name}" suggests cross-sheet relationship`,
        });
      }
    }
  }

  // Limit to most important relationships
  return relationships.slice(0, 30);
}

// ────────────────────────────────────────────
// Temporal Pattern Detection
// ────────────────────────────────────────────

function detectTemporalPattern(
  result: ComprehensiveResult,
  headers: string[]
): SemanticIndex['temporalPattern'] {
  const monthMatches = headers.filter((h) => MONTH_NAMES.test(h)).length;
  const quarterMatches = headers.filter((h) => QUARTER_NAMES.test(h)).length;
  const weekMatches = headers.filter((h) => WEEK_NAMES.test(h)).length;
  const dayMatches = headers.filter((h) => CALENDAR_PATTERNS.test(h)).length;

  // Check for year patterns in headers (e.g., "2024", "2025", "FY2024")
  const yearMatches = headers.filter((h) => /\b(20\d{2}|FY\s*20\d{2})\b/.test(h)).length;

  if (monthMatches >= 6) return 'monthly';
  if (quarterMatches >= 2) return 'quarterly';
  if (weekMatches >= 3) return 'weekly';
  if (dayMatches >= 5) return 'daily';
  if (yearMatches >= 2 && monthMatches < 3) return 'yearly';
  if (monthMatches >= 3) return 'monthly';

  // Check for date columns with consistent intervals
  for (const sheet of result.sheets) {
    for (const col of sheet.columns) {
      if (col.dataType === 'date' && col.count > 5) {
        // Date column exists with significant data — likely has temporal pattern
        // but we can't determine interval without actual values
        return 'monthly'; // Default assumption for date-heavy sheets
      }
    }
  }

  return 'none';
}

// ────────────────────────────────────────────
// Key Column Identification
// ────────────────────────────────────────────

function identifyKeyColumns(result: ComprehensiveResult): KeyColumn[] {
  const keyColumns: KeyColumn[] = [];

  for (const sheet of result.sheets) {
    for (const col of sheet.columns) {
      const uniqueRatio = col.count > 0 ? col.uniqueCount / col.count : 0;

      // ID columns: high uniqueness, high completeness
      if (uniqueRatio > 0.9 && col.completeness > 0.95 && col.count > 3) {
        if (
          /\b(id|key|code|ref|sku|uuid|number|no|num|#)\b/i.test(col.name) ||
          (col.index === 0 && uniqueRatio > 0.95)
        ) {
          keyColumns.push({
            column: col.name,
            sheetName: sheet.sheetName,
            role: 'id',
            confidence: Math.min(0.95, uniqueRatio),
          });
          continue;
        }
      }

      // Date columns
      if (col.dataType === 'date') {
        keyColumns.push({
          column: col.name,
          sheetName: sheet.sheetName,
          role: 'date',
          confidence: 0.9,
        });
        continue;
      }

      // Category columns: text with low uniqueness (< 30% unique)
      if (col.dataType === 'text' && uniqueRatio < 0.3 && col.count > 5 && uniqueRatio > 0) {
        keyColumns.push({
          column: col.name,
          sheetName: sheet.sheetName,
          role: 'category',
          confidence: 0.7,
        });
        continue;
      }

      // Label columns: text with high uniqueness (descriptive names, titles)
      if (col.dataType === 'text' && uniqueRatio > 0.5 && col.count > 3) {
        if (/\b(name|title|description|label|item|product|person)\b/i.test(col.name)) {
          keyColumns.push({
            column: col.name,
            sheetName: sheet.sheetName,
            role: 'label',
            confidence: 0.8,
          });
          continue;
        }
      }

      // Value columns: numeric with variation
      if (col.dataType === 'number' && col.stdDev !== undefined && col.stdDev > 0) {
        keyColumns.push({
          column: col.name,
          sheetName: sheet.sheetName,
          role: 'value',
          confidence: 0.75,
        });
      }
    }
  }

  // Limit and sort by confidence
  return keyColumns.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
}

// ────────────────────────────────────────────
// Data Region Identification
// ────────────────────────────────────────────

function identifyDataRegions(result: ComprehensiveResult): DataRegion[] {
  const regions: DataRegion[] = [];

  for (const sheet of result.sheets) {
    if (sheet.dataRowCount === 0) continue;

    // Main data region
    const lastCol =
      sheet.columnCount > 0 ? String.fromCharCode(64 + Math.min(sheet.columnCount, 26)) : 'A';
    regions.push({
      sheetName: sheet.sheetName,
      range: `${sheet.sheetName}!A1:${lastCol}${sheet.dataRowCount + 1}`,
      purpose: describePurpose(sheet),
      rowCount: sheet.dataRowCount,
      columnCount: sheet.columnCount,
    });
  }

  return regions;
}

function describePurpose(sheet: SheetAnalysis): string {
  const parts: string[] = [];

  const numericCols = sheet.columns.filter((c) => c.dataType === 'number').length;
  const textCols = sheet.columns.filter((c) => c.dataType === 'text').length;
  const dateCols = sheet.columns.filter((c) => c.dataType === 'date').length;

  if (dateCols > 0 && numericCols > textCols) {
    parts.push('time-series data');
  } else if (numericCols > textCols) {
    parts.push('numerical data');
  } else if (textCols > numericCols) {
    parts.push('categorical/text data');
  } else {
    parts.push('mixed data');
  }

  if (sheet.formulas && sheet.formulas.total > 0) {
    parts.push(`${sheet.formulas.total} formulas`);
  }

  if (sheet.qualityScore < 70) {
    parts.push('quality issues detected');
  }

  return parts.join(', ');
}

// ────────────────────────────────────────────
// Operation Suggestions
// ────────────────────────────────────────────

function generateSuggestions(
  workbookType: WorkbookType,
  result: ComprehensiveResult,
  entities: Entity[],
  temporalPattern: SemanticIndex['temporalPattern']
): string[] {
  const suggestions: string[] = [];

  // Type-specific suggestions
  switch (workbookType) {
    case 'budget':
      suggestions.push('Use sheets_dependencies.model_scenario for "what-if" budget analysis');
      suggestions.push('Use sheets_visualize.chart_create for budget vs. actual comparison chart');
      if (temporalPattern !== 'none') {
        suggestions.push('Use sheets_compute.forecast to project future budget periods');
      }
      break;
    case 'tracker':
      suggestions.push('Use sheets_dimensions.sort_range to sort by status or priority');
      suggestions.push('Use sheets_format.add_conditional_format_rule to highlight overdue items');
      suggestions.push('Use sheets_visualize.chart_create for progress/burndown chart');
      break;
    case 'report':
      suggestions.push(
        'Use sheets_visualize.suggest_chart for optimal visualization of report data'
      );
      suggestions.push('Use sheets_composite.publish_report to format for distribution');
      break;
    case 'database':
      suggestions.push('Use sheets_data.find_replace for bulk data updates');
      suggestions.push('Use sheets_fix.detect_anomalies to find outlier records');
      suggestions.push('Use sheets_format.set_data_validation for data integrity');
      break;
    case 'dashboard':
      suggestions.push('Use sheets_visualize.chart_update to refresh dashboard charts');
      suggestions.push('Use sheets_connectors.query to pull live external data');
      break;
    case 'inventory':
      suggestions.push('Use sheets_format.add_conditional_format_rule to flag low-stock items');
      suggestions.push('Use sheets_compute.aggregate for inventory value calculations');
      break;
    case 'invoice':
      suggestions.push(
        'Use sheets_composite.generate_template to save as reusable invoice template'
      );
      suggestions.push('Use sheets_data.write to populate with new client data');
      break;
    case 'calendar':
      suggestions.push('Use sheets_format.set_background for color-coded schedule visualization');
      break;
    case 'form':
      suggestions.push('Use sheets_analyze.analyze_data for response analysis and trends');
      suggestions.push('Use sheets_visualize.chart_create for response distribution charts');
      break;
    default:
      suggestions.push('Use sheets_analyze.suggest_next_actions for personalized recommendations');
  }

  // Cross-cutting suggestions based on data characteristics
  if (result.aggregate.totalIssues > 5) {
    suggestions.push('Use sheets_fix.clean to auto-fix detected data quality issues');
  }

  if (entities.some((e) => e.type === 'currency') && temporalPattern !== 'none') {
    suggestions.push('Use sheets_compute.regression to analyze financial trends');
  }

  if (result.spreadsheet.sheetCount > 3) {
    suggestions.push('Use sheets_data.cross_read to query data across multiple sheets');
  }

  if (result.aggregate.errorCellCount > 0) {
    suggestions.push('Use sheets_fix.diagnose_errors to trace and fix formula errors');
  }

  return suggestions.slice(0, 6);
}
