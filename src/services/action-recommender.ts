/**
 * Action Recommender Service
 *
 * Provides intelligent suggestions for next actions based on what the user just did.
 * After a successful tool call, this service recommends what to do next based on
 * pattern matching against the tool and action that just completed.
 *
 * Used to make ServalSheets more proactive and assist the Claude LLM in
 * discovering powerful chaining patterns.
 */

export interface SuggestedAction {
  tool: string;
  action: string;
  reason: string;
  params?: Record<string, unknown>;
}

const RECOMMENDATION_RULES: Record<string, SuggestedAction[]> = {
  // After reading data
  'sheets_data.read': [
    {
      tool: 'sheets_analyze',
      action: 'detect_patterns',
      reason: 'Analyze patterns in the data you just read',
    },
    {
      tool: 'sheets_visualize',
      action: 'suggest_chart',
      reason: 'Visualize this data with a chart',
    },
    {
      tool: 'sheets_dimensions',
      action: 'auto_resize',
      reason: 'Auto-fit column widths to content',
    },
  ],
  'sheets_data.batch_read': [
    {
      tool: 'sheets_analyze',
      action: 'detect_patterns',
      reason: 'Analyze patterns across multiple ranges',
    },
    {
      tool: 'sheets_data',
      action: 'cross_compare',
      reason: 'Compare the ranges you just read',
    },
  ],

  // After writing data
  'sheets_data.write': [
    {
      tool: 'sheets_format',
      action: 'set_format',
      reason: 'Format the cells you just wrote',
    },
    {
      tool: 'sheets_dimensions',
      action: 'freeze',
      reason: 'Freeze header row if you wrote headers',
    },
    {
      tool: 'sheets_dimensions',
      action: 'auto_resize',
      reason: 'Auto-fit columns to new content',
    },
  ],
  'sheets_data.append': [
    {
      tool: 'sheets_format',
      action: 'set_format',
      reason: 'Format the appended rows',
    },
    {
      tool: 'sheets_quality',
      action: 'validate',
      reason: 'Validate the data you just appended',
    },
  ],

  // After importing
  'sheets_composite.import_csv': [
    {
      tool: 'sheets_fix',
      action: 'clean',
      reason: 'Clean imported data (trim, normalize formats)',
    },
    {
      tool: 'sheets_fix',
      action: 'detect_anomalies',
      reason: 'Check for outliers in imported data',
    },
    {
      tool: 'sheets_format',
      action: 'apply_preset',
      reason: 'Apply professional formatting to imported data',
    },
  ],
  'sheets_composite.import_xlsx': [
    {
      tool: 'sheets_fix',
      action: 'clean',
      reason: 'Clean imported data',
    },
    {
      tool: 'sheets_analyze',
      action: 'scout',
      reason: 'Understand the imported sheet structure',
    },
  ],

  // After creating a chart
  'sheets_visualize.chart_create': [
    {
      tool: 'sheets_visualize',
      action: 'chart_update',
      reason: 'Refine chart title, colors, or legend',
    },
    {
      tool: 'sheets_format',
      action: 'set_format',
      reason: 'Format the data range behind the chart',
    },
    {
      tool: 'sheets_composite',
      action: 'export_xlsx',
      reason: 'Export spreadsheet with chart',
    },
  ],

  // After generating a sheet
  'sheets_composite.generate_sheet': [
    {
      tool: 'sheets_format',
      action: 'batch_format',
      reason: 'Add professional formatting',
    },
    {
      tool: 'sheets_format',
      action: 'add_conditional_format_rule',
      reason: 'Add conditional formatting rules',
    },
    {
      tool: 'sheets_collaborate',
      action: 'share_add',
      reason: 'Share the generated spreadsheet',
    },
  ],

  // After cleaning data
  'sheets_fix.clean': [
    {
      tool: 'sheets_fix',
      action: 'suggest_cleaning',
      reason: 'Check for additional cleaning opportunities',
    },
    {
      tool: 'sheets_fix',
      action: 'detect_anomalies',
      reason: 'Detect statistical outliers',
    },
    {
      tool: 'sheets_format',
      action: 'set_number_format',
      reason: 'Standardize number formats',
    },
  ],

  // After sharing
  'sheets_collaborate.share_add': [
    {
      tool: 'sheets_collaborate',
      action: 'comment_add',
      reason: 'Add a comment explaining the share',
    },
    {
      tool: 'sheets_collaborate',
      action: 'share_set_link',
      reason: 'Configure link sharing settings',
    },
  ],

  // After analysis
  'sheets_analyze.scout': [
    {
      tool: 'sheets_analyze',
      action: 'suggest_next_actions',
      reason: 'Get AI-powered improvement suggestions',
    },
    {
      tool: 'sheets_analyze',
      action: 'comprehensive',
      reason: 'Run deep analysis on the sheet',
    },
    {
      tool: 'sheets_analyze',
      action: 'detect_patterns',
      reason: 'Detect data patterns',
    },
  ],
  'sheets_analyze.comprehensive': [
    {
      tool: 'sheets_analyze',
      action: 'suggest_next_actions',
      reason: 'Get actionable suggestions from analysis',
    },
    {
      tool: 'sheets_analyze',
      action: 'generate_actions',
      reason: 'Generate executable improvement actions',
    },
  ],

  // After formatting
  'sheets_format.batch_format': [
    {
      tool: 'sheets_dimensions',
      action: 'auto_resize',
      reason: 'Auto-fit columns after formatting',
    },
    {
      tool: 'sheets_dimensions',
      action: 'freeze',
      reason: 'Freeze header row',
    },
  ],

  // After creating a spreadsheet
  'sheets_core.create': [
    {
      tool: 'sheets_core',
      action: 'add_sheet',
      reason: 'Add additional sheets/tabs',
    },
    {
      tool: 'sheets_data',
      action: 'write',
      reason: 'Write data to the new spreadsheet',
    },
    {
      tool: 'sheets_session',
      action: 'set_active',
      reason: 'Set as active spreadsheet for subsequent calls',
    },
  ],

  // After cross-sheet operations
  'sheets_data.cross_read': [
    {
      tool: 'sheets_data',
      action: 'cross_compare',
      reason: 'Compare data across spreadsheets',
    },
    {
      tool: 'sheets_analyze',
      action: 'detect_patterns',
      reason: 'Analyze patterns in cross-sheet data',
    },
  ],

  // After template operations
  'sheets_templates.apply': [
    {
      tool: 'sheets_data',
      action: 'write',
      reason: 'Fill template with your data',
    },
    {
      tool: 'sheets_format',
      action: 'batch_format',
      reason: 'Customize template formatting',
    },
  ],

  // After quality checks
  'sheets_quality.validate': [
    {
      tool: 'sheets_fix',
      action: 'clean',
      reason: 'Fix data quality issues found',
    },
    {
      tool: 'sheets_quality',
      action: 'detect_conflicts',
      reason: 'Detect concurrent modification conflicts',
    },
  ],

  // After sorting
  'sheets_dimensions.sort_range': [
    {
      tool: 'sheets_format',
      action: 'apply_preset',
      reason: 'Apply formatting to sorted data',
    },
    {
      tool: 'sheets_analyze',
      action: 'detect_patterns',
      reason: 'Analyze patterns in sorted data',
    },
    {
      tool: 'sheets_dimensions',
      action: 'set_basic_filter',
      reason: 'Add a filter for interactive sorting and filtering',
    },
    {
      tool: 'sheets_dimensions',
      action: 'create_filter_view',
      reason: 'Create a named filter view to save this sort configuration',
    },
  ],

  // After cross-sheet write
  'sheets_data.cross_write': [
    {
      tool: 'sheets_data',
      action: 'cross_read',
      reason: 'Verify data written to destination spreadsheet',
    },
    {
      tool: 'sheets_data',
      action: 'cross_compare',
      reason: 'Compare source and destination to confirm accuracy',
    },
  ],

  // After cross-sheet query
  'sheets_data.cross_query': [
    {
      tool: 'sheets_data',
      action: 'cross_read',
      reason: 'Fetch raw data from source spreadsheets for deeper analysis',
    },
    {
      tool: 'sheets_analyze',
      action: 'scout',
      reason: 'Explore the structure of queried spreadsheets',
    },
  ],

  // After quick insights
  'sheets_analyze.quick_insights': [
    {
      tool: 'sheets_analyze',
      action: 'comprehensive',
      reason: 'Run a full analysis to go beyond the quick structural snapshot',
    },
    {
      tool: 'sheets_fix',
      action: 'suggest_cleaning',
      reason: 'Get AI-powered cleaning recommendations for any issues found',
    },
  ],

  // After auto_enhance
  'sheets_analyze.auto_enhance': [
    {
      tool: 'sheets_analyze',
      action: 'suggest_next_actions',
      reason: 'Get further ranked suggestions after applying enhancements',
    },
    {
      tool: 'sheets_visualize',
      action: 'suggest_chart',
      reason: 'Visualize the enhanced data with a recommended chart',
    },
  ],

  // After federation remote call
  'sheets_federation.call_remote': [
    {
      tool: 'sheets_data',
      action: 'write',
      reason: 'Store remote results in the active spreadsheet',
    },
    {
      tool: 'sheets_session',
      action: 'get_context',
      reason: 'Review session context updated by the remote operation',
    },
  ],

  // After freezing rows/columns
  'sheets_dimensions.freeze': [
    {
      tool: 'sheets_format',
      action: 'apply_preset',
      reason: 'Format the header row with a professional style',
    },
    {
      tool: 'sheets_dimensions',
      action: 'auto_resize',
      reason: 'Auto-resize columns for readability',
    },
  ],

  // After adding a new sheet
  'sheets_core.add_sheet': [
    {
      tool: 'sheets_data',
      action: 'write',
      reason: 'Write column headers to the new sheet',
    },
    {
      tool: 'sheets_dimensions',
      action: 'freeze',
      reason: 'Freeze the header row on the new sheet',
    },
    {
      tool: 'sheets_core',
      action: 'update_sheet',
      reason: 'Set a tab color to organize sheets visually',
    },
  ],

  // After adding a named range
  'sheets_advanced.add_named_range': [
    {
      tool: 'sheets_analyze',
      action: 'generate_formula',
      reason: 'Use the named range in a formula via generate_formula',
    },
    {
      tool: 'sheets_advanced',
      action: 'add_protected_range',
      reason: 'Protect the named range to prevent accidental edits',
    },
  ],

  // After comparing revisions (closest to restore_cells intent)
  'sheets_history.diff_revisions': [
    {
      tool: 'sheets_data',
      action: 'read',
      reason: 'Read the current values to verify against the diff',
    },
    {
      tool: 'sheets_collaborate',
      action: 'comment_add',
      reason: 'Document the revision finding with a comment',
    },
  ],

  // After modeling a scenario
  'sheets_dependencies.model_scenario': [
    {
      tool: 'sheets_dependencies',
      action: 'create_scenario_sheet',
      reason: 'Materialize the scenario as a separate sheet for comparison',
    },
    {
      tool: 'sheets_dependencies',
      action: 'compare_scenarios',
      reason: 'Compare this scenario against another set of changes',
    },
  ],

  // After importing from BigQuery
  'sheets_bigquery.import_from_bigquery': [
    {
      tool: 'sheets_analyze',
      action: 'scout',
      reason: 'Scout the imported data structure and column types',
    },
    {
      tool: 'sheets_fix',
      action: 'clean',
      reason: 'Clean and standardize the imported data',
    },
  ],

  // After running an Apps Script
  'sheets_appsscript.run': [
    {
      tool: 'sheets_data',
      action: 'read',
      reason: 'Verify the script results by reading the affected range',
    },
    {
      tool: 'sheets_appsscript',
      action: 'update_content',
      reason:
        'If you need recurring automation, edit the script to manage ScriptApp triggers in code',
    },
  ],

  // After committing a transaction
  'sheets_transaction.commit': [
    {
      tool: 'sheets_data',
      action: 'read',
      reason: 'Verify the committed changes look correct',
    },
    {
      tool: 'sheets_history',
      action: 'undo',
      reason: 'Undo the transaction if the results are unexpected',
    },
  ],

  // After running a forecast
  'sheets_compute.forecast': [
    {
      tool: 'sheets_visualize',
      action: 'chart_create',
      reason: 'Visualize the forecast results with a chart',
    },
    {
      tool: 'sheets_composite',
      action: 'export_xlsx',
      reason: 'Export the forecast results as an Excel file',
    },
  ],

  // After detecting anomalies
  'sheets_fix.detect_anomalies': [
    {
      tool: 'sheets_fix',
      action: 'clean',
      reason: 'Clean the anomalous data identified',
    },
    {
      tool: 'sheets_format',
      action: 'add_conditional_format_rule',
      reason: 'Highlight anomalies with conditional formatting',
    },
  ],

  // After applying a format preset
  'sheets_format.apply_preset': [
    {
      tool: 'sheets_dimensions',
      action: 'freeze',
      reason: 'Freeze the header row after applying the preset',
    },
    {
      tool: 'sheets_dimensions',
      action: 'auto_resize',
      reason: 'Auto-resize columns to fit the formatted content',
    },
  ],
};

/**
 * Get recommended next actions based on a tool and action that just completed.
 *
 * @param toolName - The tool that just executed (e.g., 'sheets_data')
 * @param action - The action that just executed (e.g., 'read')
 * @returns Array of SuggestedAction objects (0-3 items), ordered by relevance
 */
export function getRecommendedActions(toolName: string, action: string): SuggestedAction[] {
  const key = `${toolName}.${action}`;
  return RECOMMENDATION_RULES[key] || [];
}

// Date-like detection helpers (mirrors lightweight-quality-scanner logic without import)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const MDY_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function isDateLikeValue(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return ISO_DATE_RE.test(v) || MDY_DATE_RE.test(v);
}

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return true;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return true;
  return false;
}

type CellValue = string | number | boolean | null;

/**
 * Build data-signal suggestions from actual response values.
 * Returns deduplicated suggestions ordered by relevance (data signals first).
 */
export function getDataAwareSuggestions(
  toolName: string,
  action: string,
  _result: Record<string, unknown>,
  options?: {
    responseValues?: CellValue[][];
    confidenceGaps?: Array<{ question: string; options?: string[] }>;
    spreadsheetId?: string;
    range?: string;
  }
): SuggestedAction[] {
  const dataSuggestions: SuggestedAction[] = [];
  const seenKeys = new Set<string>();

  function addIfNew(suggestion: SuggestedAction): void {
    const key = `${suggestion.tool}.${suggestion.action}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      dataSuggestions.push(suggestion);
    }
  }

  // ── Signal 1: Response data signals ────────────────────────────────────────
  if (options?.responseValues && options.responseValues.length >= 2) {
    const values = options.responseValues;
    const numCols = Math.max(...values.map((r) => r.length));

    // Analyse columns (skip header row at index 0)
    let hasDateCol = false;
    let hasNumericCol = false;
    let hasVlookup = false;
    let dateColUnsorted = false;
    let totalCells = 0;
    let nullCells = 0;

    for (let c = 0; c < numCols; c++) {
      const dataRows = values.slice(1, 11); // spot-check first 10 rows max

      let colDates: string[] = [];
      let colNums = 0;
      let colStrings = 0;

      for (const row of dataRows) {
        const cell = row[c];
        if (cell === null || cell === undefined || cell === '') {
          nullCells++;
          totalCells++;
          continue;
        }
        totalCells++;

        if (typeof cell === 'string') {
          if (cell.includes('VLOOKUP')) hasVlookup = true;
          if (isDateLikeValue(cell)) {
            hasDateCol = true;
            colDates.push(cell);
          } else {
            colStrings++;
          }
        } else if (isNumericValue(cell)) {
          hasNumericCol = true;
          colNums++;
        }
        void colStrings;
        void colNums;
      }

      // Check if date column is unsorted (spot-check first 10 values)
      if (colDates.length >= 3) {
        const sorted = [...colDates].sort();
        if (sorted.join() !== colDates.join()) {
          dateColUnsorted = true;
        }
      }
    }

    const nullRatio = totalCells > 0 ? nullCells / totalCells : 0;

    // Has date + numeric → chart suggestion
    if (hasDateCol && hasNumericCol) {
      addIfNew({
        tool: 'sheets_visualize',
        action: 'suggest_chart',
        reason: 'Data has date and numeric columns — a line chart would visualize trends',
      });
    }

    // Contains VLOOKUP → suggest XLOOKUP upgrade
    if (hasVlookup) {
      addIfNew({
        tool: 'sheets_analyze',
        action: 'analyze_formulas',
        reason: 'VLOOKUP detected — consider upgrading to XLOOKUP for better performance',
      });
    }

    // Dates out of order
    if (dateColUnsorted) {
      addIfNew({
        tool: 'sheets_dimensions',
        action: 'sort_range',
        reason: 'Date column values are not in chronological order',
      });
    }

    // High null rate
    if (nullRatio > 0.1) {
      addIfNew({
        tool: 'sheets_fix',
        action: 'fill_missing',
        reason: `${Math.round(nullRatio * 100)}% of cells are empty — fill missing values`,
      });
    }
  }

  // ── Signal 2: Confidence gaps ───────────────────────────────────────────────
  if (options?.confidenceGaps && options.confidenceGaps.length > 0) {
    const gapKeywords: Array<[string, SuggestedAction]> = [
      ['formula', { tool: 'sheets_analyze', action: 'analyze_formulas', reason: '' }],
      ['column type', { tool: 'sheets_analyze', action: 'analyze_data', reason: '' }],
      ['chart', { tool: 'sheets_visualize', action: 'suggest_chart', reason: '' }],
      ['format', { tool: 'sheets_format', action: 'suggest_format', reason: '' }],
      ['duplicate', { tool: 'sheets_fix', action: 'clean', reason: '' }],
    ];

    let gapsAdded = 0;
    for (const gap of options.confidenceGaps.slice(0, 3)) {
      if (gapsAdded >= 3) break;
      const lowerQ = gap.question.toLowerCase();

      let matched = false;
      for (const [keyword, template] of gapKeywords) {
        if (lowerQ.includes(keyword)) {
          addIfNew({
            ...template,
            reason: gap.question,
          });
          gapsAdded++;
          matched = true;
          break;
        }
      }

      // Fallback: map to analyze_data if no keyword matched
      if (!matched) {
        addIfNew({
          tool: 'sheets_analyze',
          action: 'analyze_data',
          reason: gap.question,
        });
        gapsAdded++;
      }
    }
  }

  // ── Base: static rules (appended after data signals, deduplicated) ──────────
  const staticRules = getRecommendedActions(toolName, action);
  for (const rule of staticRules) {
    addIfNew(rule);
  }

  // ── Inject executable params from session context ──────────────────────────
  if (options?.spreadsheetId) {
    const sid = options.spreadsheetId;
    const rng = options.range;
    for (const suggestion of dataSuggestions) {
      if (!suggestion.params) {
        const p: Record<string, unknown> = { spreadsheetId: sid };
        // Carry range for actions that operate on ranges
        if (rng && RANGE_CARRYING_ACTIONS.has(`${suggestion.tool}.${suggestion.action}`)) {
          p['range'] = rng;
        }
        suggestion.params = p;
      }
    }
  }

  return dataSuggestions;
}

/** Actions that benefit from receiving the source range in params */
const RANGE_CARRYING_ACTIONS = new Set([
  'sheets_analyze.detect_patterns',
  'sheets_analyze.analyze_data',
  'sheets_analyze.quick_insights',
  'sheets_visualize.suggest_chart',
  'sheets_fix.suggest_cleaning',
  'sheets_fix.clean',
  'sheets_fix.detect_anomalies',
  'sheets_dimensions.auto_resize',
  'sheets_dimensions.sort_range',
  'sheets_data.cross_read',
  'sheets_compute.evaluate',
]);
