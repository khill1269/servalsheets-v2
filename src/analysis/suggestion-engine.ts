/**
 * ServalSheets - Suggestion Engine (F4: Smart Suggestions)
 *
 * Proactively suggests improvements for spreadsheets based on structural
 * analysis and pattern detection. Combines instant pattern-based suggestions
 * with optional AI-powered recommendations via MCP Sampling.
 *
 * Each suggestion includes fully executable params ready for tool dispatch.
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from '../utils/logger.js';
import { Scout, type ScoutResult } from './scout.js';
import { ActionGenerator } from './action-generator.js';
import { getSessionContext } from '../services/session-context.js';
import { sendProgress } from '../utils/request-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Suggestion category for filtering
 */
export type SuggestionCategory =
  | 'formulas'
  | 'formatting'
  | 'structure'
  | 'data_quality'
  | 'visualization';

/**
 * Risk level for a suggestion
 */
export type SuggestionImpact = 'low_risk' | 'medium_risk' | 'high_risk';

/**
 * A single suggestion with executable params
 */
export interface Suggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  category: SuggestionCategory;
  impact: SuggestionImpact;
  action: {
    tool: string;
    action: string;
    params: Record<string, unknown>;
  };
}

/**
 * Result from suggest_next_actions
 */
export interface SuggestResult {
  suggestions: Suggestion[];
  scoutSummary: {
    title: string;
    sheetCount: number;
    estimatedCells: number;
    complexityScore: number;
  };
  totalCandidates: number;
  filtered: number;
}

/**
 * Enhancement result from auto_enhance
 */
export interface EnhanceResult {
  applied: Array<{
    suggestion: Suggestion;
    status: 'applied' | 'skipped' | 'failed';
    reason?: string;
  }>;
  summary: {
    total: number;
    applied: number;
    skipped: number;
    failed: number;
  };
}

/**
 * Options for suggestion generation
 */
export interface SuggestOptions {
  spreadsheetId: string;
  range?: string;
  maxSuggestions: number;
  categories?: SuggestionCategory[];
}

/**
 * Options for auto-enhancement
 */
export interface EnhanceOptions {
  spreadsheetId: string;
  range?: string;
  categories: SuggestionCategory[];
  mode: 'preview' | 'apply';
  maxEnhancements: number;
}

/**
 * Configuration for the suggestion engine
 */
export interface SuggestionEngineConfig {
  scout: Scout;
  actionGenerator: ActionGenerator;
}

// ---------------------------------------------------------------------------
// Semantic Column Groups
// ---------------------------------------------------------------------------

const COLUMN_SEMANTIC_GROUPS = {
  financial_revenue: [
    'revenue',
    'income',
    'sales',
    'price',
    'amount',
    'total',
    'billing',
    'invoice',
  ],
  financial_cost: ['cost', 'expense', 'cogs', 'spend', 'budget', 'overhead', 'opex', 'capex'],
  financial_profit: ['profit', 'margin', 'net', 'gross', 'ebitda', 'contribution', 'earnings'],
  temporal: [
    'date',
    'month',
    'quarter',
    'year',
    'week',
    'period',
    'created',
    'updated',
    'timestamp',
  ],
  categorical: ['category', 'type', 'status', 'region', 'department', 'product', 'tier', 'segment'],
  identifier: ['id', 'code', 'sku', 'name', 'ref', 'key', 'number', 'email', 'phone'],
} as const;

type SemanticGroup = keyof typeof COLUMN_SEMANTIC_GROUPS;

/**
 * Map each header to its detected semantic group (first match wins).
 */
function detectColumnGroups(headers: string[]): Map<string, SemanticGroup> {
  const result = new Map<string, SemanticGroup>();
  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    for (const [group, keywords] of Object.entries(COLUMN_SEMANTIC_GROUPS) as [
      SemanticGroup,
      readonly string[],
    ][]) {
      if (keywords.some((kw) => normalized.includes(kw))) {
        result.set(header, group);
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pattern Detectors
// ---------------------------------------------------------------------------

/**
 * Detect structural improvements from scout results
 */
function detectStructurePatterns(scoutResult: ScoutResult, spreadsheetId: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const indicators = scoutResult.indicators;

  // 1. Missing header freeze
  if (indicators.estimatedCells > 50 && scoutResult.sheets.length > 0) {
    const sheet = scoutResult.sheets[0]!;
    suggestions.push({
      id: 'freeze_header_row',
      title: 'Freeze Header Row',
      description: `Sheet "${sheet.title}" has ${sheet.rowCount} rows but no frozen header. Freezing row 1 keeps headers visible while scrolling.`,
      confidence: 0.9, // Near-certain structural pattern: header row present, freeze not detected
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_dimensions',
        action: 'freeze',
        params: {
          spreadsheetId,
          sheetId: sheet.sheetId,
          position: 1,
          dimension: 'ROWS',
        },
      },
    });
  }

  // 2. Auto-resize columns for readability
  if (scoutResult.sheets.length > 0) {
    const sheet = scoutResult.sheets[0]!;
    if (sheet.columnCount > 3) {
      suggestions.push({
        id: 'auto_resize_columns',
        title: 'Auto-Resize Columns',
        description: `Sheet "${sheet.title}" has ${sheet.columnCount} columns. Auto-resizing ensures all content is visible without manual adjustment.`,
        confidence: 0.75, // Strong signal: many columns → auto-resize typically beneficial
        category: 'formatting',
        impact: 'low_risk',
        action: {
          tool: 'sheets_dimensions',
          action: 'auto_resize',
          params: {
            spreadsheetId,
            sheetId: sheet.sheetId,
            dimension: 'COLUMNS',
          },
        },
      });
    }
  }

  // 3. Multi-sheet but no table of contents
  if (scoutResult.sheets.length >= 4) {
    suggestions.push({
      id: 'add_toc_sheet',
      title: 'Add Table of Contents Sheet',
      description: `Spreadsheet has ${scoutResult.sheets.length} sheets. A TOC sheet with hyperlinks improves navigation.`,
      confidence: 0.65, // Moderate signal: multiple sheets present, TOC often helps navigation
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_core',
        action: 'add_sheet',
        params: {
          spreadsheetId,
          sheetName: 'Table of Contents',
          index: 0,
        },
      },
    });
  }

  return suggestions;
}

/**
 * Detect formula-related improvements from column type info
 */
function detectFormulaPatterns(scoutResult: ScoutResult, spreadsheetId: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const columnTypes = scoutResult.columnTypes ?? [];

  if (columnTypes.length === 0 || scoutResult.sheets.length === 0) {
    return suggestions;
  }

  const sheet = scoutResult.sheets[0]!;
  const numericColumns = columnTypes.filter((c) => c.detectedType === 'number');
  const hasFormulas = scoutResult.indicators.hasFormulas;

  // 1. Numeric columns without summary formulas
  if (numericColumns.length >= 2 && !hasFormulas) {
    const colHeaders = numericColumns
      .map((c) => c.header ?? `Column ${c.index + 1}`)
      .slice(0, 3)
      .join(', ');

    suggestions.push({
      id: 'add_summary_row',
      title: 'Add Summary Row with Totals',
      description: `Found ${numericColumns.length} numeric columns (${colHeaders}) with no summary formulas. Adding SUM/AVERAGE at the bottom provides quick totals.`,
      confidence: 0.85, // Strong signal: 2+ numeric cols with no existing formulas
      category: 'formulas',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'generate_formula',
        params: {
          spreadsheetId,
          description: `Add a summary row at the bottom of sheet "${sheet.title}" with SUM for each numeric column: ${colHeaders}`,
          range: `'${sheet.title}'!A1:${String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25))}${sheet.rowCount}`,
        },
      },
    });
  }

  // 2. Revenue + Cost columns → suggest Profit Margin
  const revenueCol = columnTypes.find(
    (c) => c.header && /revenue|sales|income/i.test(c.header) && c.detectedType === 'number'
  );
  const costCol = columnTypes.find(
    (c) => c.header && /cost|expense|cogs/i.test(c.header) && c.detectedType === 'number'
  );

  if (revenueCol && costCol) {
    const revLetter = String.fromCharCode(65 + revenueCol.index);
    const costLetter = String.fromCharCode(65 + costCol.index);
    suggestions.push({
      id: 'add_profit_margin',
      title: 'Add Profit Margin Column',
      description: `Detected "${revenueCol.header}" (col ${revLetter}) and "${costCol.header}" (col ${costLetter}). A Profit Margin formula = (Revenue - Cost) / Revenue shows profitability.`,
      confidence: 0.92, // Near-certain: revenue + cost columns detected, profit margin not present
      category: 'formulas',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'generate_formula',
        params: {
          spreadsheetId,
          description: `Add a "Profit Margin" column after the last data column. Formula: (${revLetter}{row} - ${costLetter}{row}) / ${revLetter}{row}. Format as percentage.`,
          range: `'${sheet.title}'!A1:${String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25))}${sheet.rowCount}`,
        },
      },
    });
  }

  return suggestions;
}

/**
 * Detect formatting improvements
 */
function detectFormattingPatterns(scoutResult: ScoutResult, spreadsheetId: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const columnTypes = scoutResult.columnTypes ?? [];

  if (columnTypes.length === 0 || scoutResult.sheets.length === 0) {
    return suggestions;
  }

  const sheet = scoutResult.sheets[0]!;

  // 1. Number columns that could benefit from formatting
  const numericColumns = columnTypes.filter((c) => c.detectedType === 'number' && c.header);

  if (numericColumns.length > 0) {
    const currencyLike = numericColumns.filter(
      (c) => c.header && /price|cost|revenue|amount|total|salary|budget|fee|rate/i.test(c.header)
    );

    if (currencyLike.length > 0) {
      const firstCol = currencyLike[0]!;
      const colLetter = String.fromCharCode(65 + firstCol.index);
      suggestions.push({
        id: 'format_currency_columns',
        title: 'Format Currency Columns',
        description: `Column "${firstCol.header}" appears to contain monetary values. Applying currency format ($#,##0.00) improves readability.`,
        confidence: 0.8, // Strong signal: column name matches currency keywords (price/cost/revenue/amount)
        category: 'formatting',
        impact: 'low_risk',
        action: {
          tool: 'sheets_format',
          action: 'set_number_format',
          params: {
            spreadsheetId,
            range: `'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`,
            numberFormat: '$#,##0.00',
          },
        },
      });
    }
  }

  // 2. Date columns that might need consistent formatting
  const dateColumns = columnTypes.filter((c) => c.detectedType === 'date' && c.header);

  if (dateColumns.length > 0) {
    const firstDateCol = dateColumns[0]!;
    const colLetter = String.fromCharCode(65 + firstDateCol.index);
    suggestions.push({
      id: 'format_date_columns',
      title: 'Standardize Date Format',
      description: `Column "${firstDateCol.header}" contains dates. Applying a consistent format (YYYY-MM-DD) prevents ambiguity.`,
      confidence: 0.7, // Moderate-strong signal: date column detected, format consistency beneficial
      category: 'formatting',
      impact: 'low_risk',
      action: {
        tool: 'sheets_format',
        action: 'set_number_format',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`,
          numberFormat: 'yyyy-mm-dd',
        },
      },
    });
  }

  // 3. Conditional formatting for negative numbers
  if (numericColumns.length >= 2) {
    suggestions.push({
      id: 'add_conditional_formatting',
      title: 'Highlight Negative Values',
      description: `Found ${numericColumns.length} numeric columns. Adding conditional formatting to highlight negative values in red helps spot issues quickly.`,
      confidence: 0.65, // Moderate signal: numeric data present, negative-value highlighting broadly useful
      category: 'formatting',
      impact: 'low_risk',
      action: {
        tool: 'sheets_format',
        action: 'add_conditional_format_rule',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!A1:${String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25))}${sheet.rowCount}`,
          rulePreset: 'negative_red',
        },
      },
    });
  }

  return suggestions;
}

/**
 * Detect data quality improvements
 */
function detectDataQualityPatterns(scoutResult: ScoutResult, spreadsheetId: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const columnTypes = scoutResult.columnTypes ?? [];

  if (columnTypes.length === 0 || scoutResult.sheets.length === 0) {
    return suggestions;
  }

  const sheet = scoutResult.sheets[0]!;

  // 1. Columns with low unique ratios → suggest data validation dropdown
  const dropdownCandidates = columnTypes.filter(
    (c) =>
      c.detectedType === 'text' && c.uniqueRatio !== undefined && c.uniqueRatio < 0.3 && c.header
  );

  if (dropdownCandidates.length > 0) {
    const col = dropdownCandidates[0]!;
    const colLetter = String.fromCharCode(65 + col.index);
    suggestions.push({
      id: 'add_data_validation',
      title: `Add Dropdown for "${col.header}"`,
      description: `Column "${col.header}" has ${Math.round((col.uniqueRatio ?? 0) * 100)}% unique values — likely a categorical field. Adding data validation prevents typos.`,
      confidence: 0.78, // Strong signal: low-cardinality text column (<30% unique) — likely categorical
      category: 'data_quality',
      impact: 'low_risk',
      action: {
        tool: 'sheets_format',
        action: 'set_data_validation',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`,
          condition: {
            type: 'ONE_OF_RANGE',
            values: [`'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`],
          },
          showDropdown: true,
          strict: false,
        },
      },
    });
  }

  // 2. Nullable columns → suggest required validation
  const highNullColumns = columnTypes.filter(
    (c) => c.nullable && c.header && c.detectedType !== 'empty'
  );

  if (highNullColumns.length > 0 && highNullColumns.length <= 3) {
    const colNames = highNullColumns.map((c) => c.header).join(', ');
    suggestions.push({
      id: 'flag_missing_data',
      title: 'Review Missing Data',
      description: `Columns with missing values detected: ${colNames}. Running data quality analysis can identify patterns in missing data.`,
      confidence: 0.6, // Weak-moderate signal: nulls present, but missing data may be intentional
      category: 'data_quality',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'analyze_quality',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!A1:${String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25))}${sheet.rowCount}`,
        },
      },
    });
  }

  return suggestions;
}

/**
 * Detect visualization opportunities
 */
function detectVisualizationPatterns(
  scoutResult: ScoutResult,
  spreadsheetId: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const columnTypes = scoutResult.columnTypes ?? [];
  const indicators = scoutResult.indicators;

  if (columnTypes.length === 0 || scoutResult.sheets.length === 0) {
    return suggestions;
  }

  const sheet = scoutResult.sheets[0]!;
  const hasDateCol = columnTypes.some((c) => c.detectedType === 'date');
  const numericCount = columnTypes.filter((c) => c.detectedType === 'number').length;

  // 1. Time series data → suggest line chart
  if (hasDateCol && numericCount >= 1 && !indicators.hasVisualizations) {
    suggestions.push({
      id: 'suggest_line_chart',
      title: 'Add Trend Chart',
      description: `Found date column with ${numericCount} numeric columns — ideal for a trend line chart to visualize changes over time.`,
      confidence: 0.82, // Strong signal: date + numeric columns, no existing chart — time series pattern
      category: 'visualization',
      impact: 'low_risk',
      action: {
        tool: 'sheets_visualize',
        action: 'suggest_chart',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!A1:${String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25))}${sheet.rowCount}`,
        },
      },
    });
  }

  // 2. Categorical + numeric → suggest bar chart
  const textCols = columnTypes.filter((c) => c.detectedType === 'text');
  if (textCols.length >= 1 && numericCount >= 1 && !hasDateCol && !indicators.hasVisualizations) {
    suggestions.push({
      id: 'suggest_bar_chart',
      title: 'Add Comparison Chart',
      description: `Found categorical and numeric columns — a bar chart can compare values across categories.`,
      confidence: 0.72, // Moderate signal: text + numeric columns present, bar chart often useful
      category: 'visualization',
      impact: 'low_risk',
      action: {
        tool: 'sheets_visualize',
        action: 'suggest_chart',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!A1:${String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25))}${sheet.rowCount}`,
        },
      },
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Semantic Pattern Detector (15 new rules)
// ---------------------------------------------------------------------------

/**
 * Detect improvements using semantic column group analysis.
 * Supplements the existing pattern detectors with 15 new semantic rules.
 */
function detectSemanticPatterns(scoutResult: ScoutResult, spreadsheetId: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const columnTypes = scoutResult.columnTypes ?? [];
  const sheets = scoutResult.sheets;

  if (columnTypes.length === 0 || sheets.length === 0) {
    return suggestions;
  }

  const sheet = sheets[0]!;
  const headers = columnTypes.map((c) => c.header ?? '').filter(Boolean);
  const groups = detectColumnGroups(headers);

  const groupedHeaders = {
    revenue: [...groups.entries()].filter(([, g]) => g === 'financial_revenue').map(([h]) => h),
    cost: [...groups.entries()].filter(([, g]) => g === 'financial_cost').map(([h]) => h),
    profit: [...groups.entries()].filter(([, g]) => g === 'financial_profit').map(([h]) => h),
    temporal: [...groups.entries()].filter(([, g]) => g === 'temporal').map(([h]) => h),
    categorical: [...groups.entries()].filter(([, g]) => g === 'categorical').map(([h]) => h),
    identifier: [...groups.entries()].filter(([, g]) => g === 'identifier').map(([h]) => h),
  };

  const numericColumns = columnTypes.filter((c) => c.detectedType === 'number');
  const maxCol = String.fromCharCode(65 + Math.min(columnTypes.length - 1, 25));
  const fullRange = `'${sheet.title}'!A1:${maxCol}${sheet.rowCount}`;

  // Rule 1: revenue_cost_present — profit margin formula
  if (groupedHeaders.revenue.length > 0 && groupedHeaders.cost.length > 0) {
    const revCol = columnTypes.find((c) => c.header && groupedHeaders.revenue.includes(c.header));
    const costCol = columnTypes.find((c) => c.header && groupedHeaders.cost.includes(c.header));
    if (revCol && costCol) {
      const revLetter = String.fromCharCode(65 + revCol.index);
      const costLetter = String.fromCharCode(65 + costCol.index);
      suggestions.push({
        id: 'revenue_cost_present',
        title: 'Add Profit Margin Formula',
        description: `Detected "${revCol.header}" and "${costCol.header}" columns. Profit Margin =IFERROR((${revLetter}-${costLetter})/${revLetter}, 0) shows profitability.`,
        confidence: 0.92,
        category: 'formulas',
        impact: 'low_risk',
        action: {
          tool: 'sheets_analyze',
          action: 'generate_formula',
          params: {
            spreadsheetId,
            description: `Add a Profit Margin column. Formula: =IFERROR((${revLetter}{row}-${costLetter}{row})/${revLetter}{row}, 0). Format as percentage.`,
            range: fullRange,
          },
        },
      });
    }
  }

  // Rule 2: temporal_financial — time-series line chart
  if (groupedHeaders.temporal.length > 0 && groupedHeaders.revenue.length > 0) {
    suggestions.push({
      id: 'temporal_financial',
      title: 'Add Revenue Trend Chart',
      description: `Detected date and revenue columns — ideal for a time-series line chart.`,
      confidence: 0.88,
      category: 'visualization',
      impact: 'low_risk',
      action: {
        tool: 'sheets_visualize',
        action: 'suggest_chart',
        params: { spreadsheetId, range: fullRange },
      },
    });
  }

  // Rule 3: category_numeric — pivot table by category
  if (groupedHeaders.categorical.length > 0 && numericColumns.length > 0) {
    suggestions.push({
      id: 'category_numeric',
      title: 'Create Pivot Table by Category',
      description: `Categorical column "${groupedHeaders.categorical[0]}" with ${numericColumns.length} numeric column(s) — a pivot table summarizes data by category.`,
      confidence: 0.8,
      category: 'visualization',
      impact: 'low_risk',
      action: {
        tool: 'sheets_visualize',
        action: 'pivot_create',
        params: {
          spreadsheetId,
          sourceRange: fullRange,
          rowGroup: groupedHeaders.categorical[0],
          valueColumn: numericColumns[0]?.header ?? '',
        },
      },
    });
  }

  // Rule 4: id_multi_sheet — XLOOKUP cross-sheet link
  if (groupedHeaders.identifier.length > 0 && sheets.length > 1) {
    const idHeader = groupedHeaders.identifier[0]!;
    suggestions.push({
      id: 'id_multi_sheet',
      title: 'Link Sheets with XLOOKUP',
      description: `ID column "${idHeader}" found across ${sheets.length} sheets — use XLOOKUP to join data without copy-paste.`,
      confidence: 0.85,
      category: 'formulas',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'generate_formula',
        params: {
          spreadsheetId,
          description: `XLOOKUP formula to retrieve a value from another sheet using "${idHeader}" as the lookup key`,
          range: fullRange,
        },
      },
    });
  }

  // Rule 5: status_repeated — dropdown + slicer for low-cardinality categorical column with >50 rows
  const statusCol = columnTypes.find(
    (c) =>
      c.header &&
      groupedHeaders.categorical.includes(c.header) &&
      c.uniqueRatio !== undefined &&
      c.uniqueRatio < 0.16 &&
      sheet.rowCount > 50
  );
  if (statusCol) {
    const colLetter = String.fromCharCode(65 + statusCol.index);
    suggestions.push({
      id: 'status_repeated',
      title: `Add Dropdown + Slicer for "${statusCol.header}"`,
      description: `"${statusCol.header}" has few unique values across >50 rows — a dropdown ensures data consistency; a slicer enables interactive filtering.`,
      confidence: 0.87,
      category: 'data_quality',
      impact: 'low_risk',
      action: {
        tool: 'sheets_format',
        action: 'set_data_validation',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`,
          condition: {
            type: 'ONE_OF_RANGE',
            values: [`'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`],
          },
          showDropdown: true,
          strict: false,
        },
      },
    });
  }

  // Rule 6: three_plus_kpis — suggest build_dashboard
  const kpiColumns = columnTypes.filter(
    (c) =>
      c.header &&
      (groupedHeaders.revenue.includes(c.header) || groupedHeaders.profit.includes(c.header))
  );
  if (kpiColumns.length >= 3) {
    suggestions.push({
      id: 'three_plus_kpis',
      title: 'Build Full Analytics Dashboard',
      description: `Found ${kpiColumns.length} KPI columns. A dashboard assembles KPI row, charts, slicers, and formatting in one action.`,
      confidence: 0.75,
      category: 'visualization',
      impact: 'low_risk',
      action: {
        tool: 'sheets_composite',
        action: 'build_dashboard',
        params: { spreadsheetId, dataSheet: sheet.title, layout: 'full_analytics' },
      },
    });
  }

  // Rule 7: date_unsorted — suggest sort descending by date column
  const dateCol = columnTypes.find(
    (c) => c.header && groupedHeaders.temporal.includes(c.header) && c.detectedType === 'date'
  );
  if (dateCol) {
    suggestions.push({
      id: 'date_unsorted',
      title: `Sort by "${dateCol.header}" Descending`,
      description: `Date column "${dateCol.header}" detected — sorting newest-first makes recent records easier to find.`,
      confidence: 0.9,
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_dimensions',
        action: 'sort_range',
        params: {
          spreadsheetId,
          range: fullRange,
          sortOrder: [{ dimensionIndex: dateCol.index, sortOrder: 'DESCENDING' }],
        },
      },
    });
  }

  // Rule 8: many_sheets_no_named_ranges — suggest naming key ranges
  if (sheets.length > 5) {
    suggestions.push({
      id: 'many_sheets_no_named_ranges',
      title: 'Add Named Ranges for Key Data Areas',
      description: `Spreadsheet has ${sheets.length} sheets. Named ranges make cross-sheet formulas readable and easier to maintain.`,
      confidence: 0.65,
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_advanced',
        action: 'list_named_ranges',
        params: { spreadsheetId },
      },
    });
  }

  // Rule 9: same_headers_multi_sheet — suggest cross_read consolidation
  if (sheets.length >= 2) {
    suggestions.push({
      id: 'same_headers_multi_sheet',
      title: 'Consolidate Similar Sheets with cross_read',
      description: `Multiple sheets detected — if they share headers, use sheets_data.cross_read to merge them into a unified view.`,
      confidence: 0.78,
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_data',
        action: 'cross_read',
        params: {
          sources: sheets.slice(0, 3).map((s) => ({
            spreadsheetId,
            range: `'${s.title}'!A1:${maxCol}${s.rowCount}`,
          })),
        },
      },
    });
  }

  // Rule 10: numeric_no_conditional — suggest negative→red rule
  if (numericColumns.length > 0 && !scoutResult.indicators.hasFormulas) {
    const firstNum = numericColumns[0]!;
    const colLetter = String.fromCharCode(65 + firstNum.index);
    suggestions.push({
      id: 'numeric_no_conditional',
      title: 'Highlight Negative Values in Red',
      description: `Numeric column "${firstNum.header ?? `Column ${colLetter}`}" has no conditional formatting. Highlighting negatives makes problems immediately visible.`,
      confidence: 0.7,
      category: 'formatting',
      impact: 'low_risk',
      action: {
        tool: 'sheets_format',
        action: 'add_conditional_format_rule',
        params: {
          spreadsheetId,
          range: `'${sheet.title}'!${colLetter}2:${colLetter}${sheet.rowCount}`,
          rulePreset: 'negative_red',
        },
      },
    });
  }

  // Rule 11: text_high_cardinality — suggest UNIQUE formula
  const highCardCol = columnTypes.find(
    (c) =>
      c.detectedType === 'text' &&
      c.uniqueRatio !== undefined &&
      c.uniqueRatio > 0.2 &&
      sheet.rowCount > 20
  );
  if (highCardCol) {
    const colLetter = String.fromCharCode(65 + highCardCol.index);
    suggestions.push({
      id: 'text_high_cardinality',
      title: `Extract Unique Values from "${highCardCol.header}"`,
      description: `"${highCardCol.header}" has high cardinality (${Math.round((highCardCol.uniqueRatio ?? 0) * 100)}% unique). A UNIQUE formula extracts distinct values for dropdowns or analysis.`,
      confidence: 0.72,
      category: 'formulas',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'generate_formula',
        params: {
          spreadsheetId,
          description: `UNIQUE formula to extract all distinct values from the "${highCardCol.header}" column (${colLetter})`,
          range: `'${sheet.title}'!${colLetter}1:${colLetter}${sheet.rowCount}`,
        },
      },
    });
  }

  // Rule 12: date_no_derivation — suggest derived period columns
  if (groupedHeaders.temporal.length > 0 && !headers.some((h) => /year|month|quarter/i.test(h))) {
    suggestions.push({
      id: 'date_no_derivation',
      title: 'Add Year/Month/Quarter Columns',
      description: `Date column detected but no derived period columns found. YEAR/MONTH/QUARTER columns enable period-based grouping and pivot tables.`,
      confidence: 0.68,
      category: 'formulas',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'generate_formula',
        params: {
          spreadsheetId,
          description: `Add YEAR, MONTH, and QUARTER columns derived from the date column "${groupedHeaders.temporal[0]}"`,
          range: fullRange,
        },
      },
    });
  }

  // Rule 13: numeric_no_footer — suggest summary row
  if (numericColumns.length >= 1 && sheet.rowCount > 5) {
    const numericHeaders = numericColumns
      .slice(0, 3)
      .map((c) => c.header ?? '')
      .join(', ');
    suggestions.push({
      id: 'numeric_no_footer',
      title: 'Add Summary Row with Totals',
      description: `Numeric columns (${numericHeaders}) have no summary row. A SUM/AVERAGE footer gives quick totals without manual calculation.`,
      confidence: 0.85,
      category: 'formulas',
      impact: 'low_risk',
      action: {
        tool: 'sheets_analyze',
        action: 'generate_formula',
        params: {
          spreadsheetId,
          description: `Add a totals/summary row at the bottom of "${sheet.title}" with SUM for each numeric column: ${numericHeaders}`,
          range: fullRange,
        },
      },
    });
  }

  // Rule 14: no_freeze — suggest freeze header row (only when estimatedCells <= 50,
  // to avoid overlap with the existing freeze_header_row rule that fires above that threshold)
  // indicators.frozenRows is not in the QuickIndicators schema; use unknown cast for safety
  const frozenRows = (scoutResult.indicators as unknown as Record<string, unknown>)['frozenRows'];
  if (!frozenRows && sheets.length > 0 && scoutResult.indicators.estimatedCells <= 50) {
    suggestions.push({
      id: 'no_freeze',
      title: 'Freeze Header Row',
      description: `No frozen rows detected. Freezing row 1 keeps column headers visible when scrolling.`,
      confidence: 0.95,
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_dimensions',
        action: 'freeze',
        params: { spreadsheetId, sheetId: sheet.sheetId, position: 1, dimension: 'ROWS' },
      },
    });
  }

  // Rule 15: many_sheets — suggest TOC if not already present
  if (
    sheets.length >= 4 &&
    !sheets.some((s) => /index|toc|table of contents/i.test(s.title ?? ''))
  ) {
    suggestions.push({
      id: 'many_sheets',
      title: 'Add Table of Contents with HYPERLINK Formulas',
      description: `${sheets.length} sheets with no TOC/Index sheet. A TOC with =HYPERLINK formulas speeds up navigation.`,
      confidence: 0.6,
      category: 'structure',
      impact: 'low_risk',
      action: {
        tool: 'sheets_core',
        action: 'add_sheet',
        params: { spreadsheetId, sheetName: 'Index', index: 0 },
      },
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Suggestion Engine
// ---------------------------------------------------------------------------

/**
 * Core suggestion engine that combines pattern-based and AI-powered suggestions.
 *
 * Pattern-based suggestions are instant (no API calls). AI-powered suggestions
 * use MCP Sampling (optional) and are only used when pattern-based suggestions
 * don't fill the requested quota.
 */
export class SuggestionEngine {
  private scout: Scout;

  constructor(config: SuggestionEngineConfig) {
    this.scout = config.scout;
    // config.actionGenerator reserved for future suggestion execution wiring
  }

  /**
   * Generate ranked suggestions for a spreadsheet
   */
  async suggest(options: SuggestOptions): Promise<SuggestResult> {
    const { spreadsheetId, maxSuggestions, categories } = options;

    // Phase 1: Quick structural scan via Scout (~200ms)
    sendProgress(0, undefined, 'Scanning spreadsheet structure...');
    const scoutResult = await this.scout.scout(spreadsheetId);
    logger.debug('Scout scan complete', {
      spreadsheetId,
      sheetCount: scoutResult.sheets.length,
      estimatedCells: scoutResult.indicators.estimatedCells,
    });

    // Phase 2: Pattern-based suggestions (instant, no API calls)
    sendProgress(1, undefined, 'Detecting improvement patterns...');
    const allPatterns = [
      ...detectStructurePatterns(scoutResult, spreadsheetId),
      ...detectFormulaPatterns(scoutResult, spreadsheetId),
      ...detectFormattingPatterns(scoutResult, spreadsheetId),
      ...detectDataQualityPatterns(scoutResult, spreadsheetId),
      ...detectVisualizationPatterns(scoutResult, spreadsheetId),
      ...detectSemanticPatterns(scoutResult, spreadsheetId),
    ];

    // Phase 3: Filter by category if specified
    let candidates = categories
      ? allPatterns.filter((s) => categories.includes(s.category))
      : allPatterns;

    // Phase 4: Filter out previously rejected suggestions
    sendProgress(2, undefined, 'Filtering suggestions...');
    candidates = await this.filterRejected(candidates);

    // Phase 5: Boost suggestions based on recent background analysis findings
    const sessionCtx = getSessionContext();
    const recentAnalysis = sessionCtx.getRecentAnalysis(spreadsheetId);
    if (recentAnalysis) {
      for (const s of candidates) {
        // Quality dropped → boost data_quality suggestions
        if (recentAnalysis.qualityChange < -10 && s.category === 'data_quality') {
          s.confidence = Math.min(s.confidence + 0.15, 1.0);
        }
        // Low quality score → boost cleaning-related suggestions
        if (recentAnalysis.qualityScore < 70 && s.category === 'data_quality') {
          s.confidence = Math.min(s.confidence + 0.1, 1.0);
        }
      }
    }

    // Phase 6: Rank by confidence (descending) and take top N
    candidates.sort((a, b) => b.confidence - a.confidence);
    const suggestions = candidates.slice(0, maxSuggestions);

    sendProgress(3, 3, `Found ${suggestions.length} suggestions`);

    return {
      suggestions,
      scoutSummary: {
        title: scoutResult.title,
        sheetCount: scoutResult.sheets.length,
        estimatedCells: scoutResult.indicators.estimatedCells,
        complexityScore: scoutResult.indicators.complexityScore,
      },
      totalCandidates: allPatterns.length,
      filtered: allPatterns.length - suggestions.length,
    };
  }

  /**
   * Auto-enhance a spreadsheet with non-destructive improvements.
   * In preview mode, returns what would change without applying.
   * In apply mode, executes safe operations.
   */
  async enhance(options: EnhanceOptions): Promise<EnhanceResult> {
    const { spreadsheetId, range, categories, mode, maxEnhancements } = options;

    // Get suggestions filtered to safe categories
    const suggestResult = await this.suggest({
      spreadsheetId,
      range,
      maxSuggestions: maxEnhancements,
      categories,
    });

    // In preview mode, return what would be applied
    if (mode === 'preview') {
      return {
        applied: suggestResult.suggestions.map((s) => ({
          suggestion: s,
          status: 'skipped' as const,
          reason: 'Preview mode — not applied',
        })),
        summary: {
          total: suggestResult.suggestions.length,
          applied: 0,
          skipped: suggestResult.suggestions.length,
          failed: 0,
        },
      };
    }

    // In apply mode, we return the suggestions as "applied" since the actual
    // execution happens at the handler level through tool dispatch.
    // The handler will execute each suggestion's action params.
    const results = suggestResult.suggestions.map((s) => ({
      suggestion: s,
      status: 'applied' as const,
    }));

    return {
      applied: results,
      summary: {
        total: results.length,
        applied: results.length,
        skipped: 0,
        failed: 0,
      },
    };
  }

  /**
   * Filter out suggestions the user has previously rejected
   */
  private async filterRejected(suggestions: Suggestion[]): Promise<Suggestion[]> {
    try {
      const sessionCtx = getSessionContext();
      if (!sessionCtx) return suggestions;

      const filtered: Suggestion[] = [];
      for (const suggestion of suggestions) {
        const rejected = await sessionCtx.shouldAvoidSuggestion(suggestion.id);
        if (!rejected) {
          filtered.push(suggestion);
        } else {
          logger.debug('Filtered rejected suggestion', { id: suggestion.id });
        }
      }
      return filtered;
    } catch {
      // If session context is unavailable, return all suggestions
      return suggestions;
    }
  }
}
