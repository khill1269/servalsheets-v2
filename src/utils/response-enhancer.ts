/**
 * Response Enhancer - Quick Win #1: Semantic Priority Suggestions
 *
 * Generates intelligent suggestions, cost estimates, and metadata
 * for tool responses to improve LLM decision-making.
 *
 * Quick Win #1 Improvements:
 * - Explicit priority ranking (HIGH, MEDIUM, LOW)
 * - Estimated impact for each suggestion
 * - Smart context-based suggestion generation
 * - Priority-based sorting
 */

import type { ToolSuggestion, CostEstimate, ResponseMeta } from '../schemas/shared.js';

/**
 * Context for generating response enhancements
 */
export interface EnhancementContext {
  tool: string;
  action: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  cellsAffected?: number;
  apiCallsMade?: number;
  duration?: number;
}

/**
 * Priority order for sorting suggestions
 * Lower number = higher priority
 */
const PRIORITY_ORDER = {
  high: 0,
  medium: 1,
  low: 2,
} as const;

/**
 * Generate suggestions based on the tool and action
 * Quick Win #1: Enhanced with explicit priorities, impact estimates, and smart ranking
 */
export function generateSuggestions(context: EnhancementContext): ToolSuggestion[] {
  const suggestions: ToolSuggestion[] = [];
  const { tool, action, input, result, cellsAffected } = context;

  // HIGH PRIORITY: Quality issues detected
  if (result && hasQualityIssues(result)) {
    const issueCount = getQualityIssueCount(result);
    suggestions.push({
      type: 'warning',
      message: `${issueCount} quality issues detected - immediate fix recommended`,
      tool: 'sheets_quality',
      action: 'fix',
      reason: `Found ${issueCount} fixable issues (empty cells, inconsistent formats, validation errors)`,
      priority: 'high',
    });
  }

  // HIGH PRIORITY: Destructive operation without safety check
  if (['clear', 'delete', 'batch_clear', 'delete_dimension'].some((a) => action.includes(a))) {
    const safety = input['safety'] as { dryRun?: boolean } | undefined;
    if (!safety?.dryRun) {
      suggestions.push({
        type: 'warning',
        message: 'Destructive operation executed without preview - consider using dryRun next time',
        reason:
          'dryRun shows exactly what will be changed before applying, preventing accidental data loss',
        priority: 'high',
      });
    }
  }

  // HIGH PRIORITY: Large write without batching
  if (action === 'write' && cellsAffected && cellsAffected > 1000) {
    const estimatedSavings = Math.round((cellsAffected / 100) * 50); // ~50ms per 100 cells saved
    suggestions.push({
      type: 'optimization',
      message: `Large write operation (${cellsAffected} cells) - batch_write would be faster`,
      tool: tool,
      action: 'batch_write',
      reason: `Batch operations reduce API calls from ${Math.ceil(cellsAffected / 100)} to 1, saving ~${estimatedSavings}ms`,
      priority: 'high',
    });
  }

  // HIGH PRIORITY: Large change without snapshot
  if (cellsAffected && cellsAffected > 5000) {
    suggestions.push({
      type: 'warning',
      message: `Large change (${cellsAffected} cells) detected - create snapshot for easy rollback`,
      tool: 'sheets_collaborate',
      action: 'version_create_snapshot',
      reason: `Changes affecting ${cellsAffected} cells are difficult to undo manually. Snapshots enable one-click restoration.`,
      priority: 'high',
    });
  }

  // MEDIUM PRIORITY: Visualization opportunities
  if (action === 'read' && result) {
    const values = result['values'] as unknown[][] | undefined;
    if (values && values.length > 20 && hasVisualizableData(values)) {
      suggestions.push({
        type: 'follow_up',
        message: 'Data has clear patterns - visualization recommended',
        tool: 'sheets_visualize',
        action: 'suggest_chart',
        reason: `Dataset with ${values.length} rows shows numeric patterns suitable for charts`,
        priority: 'medium',
      });
    }
  }

  // MEDIUM PRIORITY: Analysis before modification
  if (['write', 'batch_write', 'clear', 'delete'].some((a) => action.includes(a))) {
    const hasAnalysis = result?.['analysis'] !== undefined;
    if (!hasAnalysis) {
      suggestions.push({
        type: 'follow_up',
        message: 'Consider analyzing data quality to understand impact',
        tool: 'sheets_analyze',
        action: 'analyze_quality',
        reason:
          'Quality analysis reveals data structure, patterns, and potential issues before modifications',
        priority: 'medium',
      });
    }
  }

  // MEDIUM PRIORITY: Batch optimization hint
  if (action === 'read' && !action.includes('batch')) {
    suggestions.push({
      type: 'optimization',
      message: 'For reading multiple ranges, use batch_read',
      tool: tool,
      action: 'batch_read',
      reason:
        'Batch operations reduce API calls by ~80% and latency by ~70% when reading multiple ranges',
      priority: 'medium',
    });
  }

  // LOW PRIORITY: Formatting after data write
  if ((action === 'write' || action === 'append' || action === 'batch_write') && cellsAffected) {
    suggestions.push({
      type: 'follow_up',
      message: 'Data written successfully - consider applying formatting',
      tool: 'sheets_format',
      action: 'apply_preset',
      reason:
        'Formatting presets (header, currency, percentage) improve readability and consistency',
      priority: 'low',
    });
  }

  // LOW PRIORITY: Analysis insights for large datasets
  if (action === 'read' && result) {
    const values = result['values'] as unknown[][] | undefined;
    if (values && values.length > 100) {
      suggestions.push({
        type: 'follow_up',
        message: `Large dataset (${values.length} rows) read - statistical analysis available`,
        tool: 'sheets_analyze',
        action: 'analyze_data',
        reason: 'Get descriptive statistics, detect outliers, and identify data quality issues',
        priority: 'low',
      });
    }
  }

  // === NEW SYNERGY PATTERNS (17 additional patterns) ===

  // HIGH PRIORITY: After import → suggest analysis
  if (action === 'import_csv' || action === 'import_data') {
    suggestions.push({
      type: 'follow_up',
      message: 'Data imported successfully - analyze quality before processing',
      tool: 'sheets_analyze',
      action: 'analyze_quality',
      reason: 'Imported data may have encoding issues, missing values, or format inconsistencies',
      priority: 'high',
    });
  }

  // HIGH PRIORITY: After large dataset → suggest BigQuery
  if (action === 'read' && result) {
    const values = result['values'] as unknown[][] | undefined;
    if (values && values.length > 10000) {
      suggestions.push({
        type: 'optimization',
        message: `Very large dataset (${values.length} rows) - BigQuery integration recommended`,
        tool: 'sheets_bigquery',
        action: 'export_to_bigquery',
        reason:
          'BigQuery handles 10K+ rows 100x faster than Sheets with SQL queries and better performance',
        priority: 'high',
      });
    }
  }

  // HIGH PRIORITY: After duplicate data → suggest deduplication
  if (result && hasDuplicates(result)) {
    const dupCount = getDuplicateCount(result);
    suggestions.push({
      type: 'warning',
      message: `${dupCount} duplicate rows detected - deduplication recommended`,
      tool: 'sheets_data',
      action: 'deduplicate',
      reason: 'Duplicate data skews analysis results and wastes storage quota',
      priority: 'high',
    });
  }

  // HIGH PRIORITY: After API rate limit → suggest caching
  if (context.apiCallsMade && context.apiCallsMade > 20) {
    suggestions.push({
      type: 'warning',
      message: `High API usage (${context.apiCallsMade} calls) - enable caching to reduce quota consumption`,
      tool: 'sheets_session',
      action: 'set_config',
      reason: 'Caching reduces repeated API calls by 60-80%, extending your quota headroom',
      priority: 'high',
    });
  }

  // MEDIUM PRIORITY: After analysis → suggest visualization
  if (action === 'analyze_data' || action === 'analyze_quality') {
    suggestions.push({
      type: 'follow_up',
      message: 'Analysis complete - create charts to visualize findings',
      tool: 'sheets_visualize',
      action: 'chart_create',
      reason: 'Visual patterns reveal insights not obvious in statistical summaries',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After chart → suggest trendlines
  if (action === 'chart_create' && result) {
    suggestions.push({
      type: 'follow_up',
      message: 'Chart created - add trendlines for predictive insights',
      tool: 'sheets_visualize',
      action: 'chart_add_trendline',
      reason: 'Trendlines show data direction and enable forecasting',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After formula calculation → suggest named ranges
  if (action === 'calculate' || (action === 'write' && hasFormulas(input))) {
    suggestions.push({
      type: 'optimization',
      message: 'Formulas detected - named ranges improve readability and maintenance',
      tool: 'sheets_advanced',
      action: 'create_named_range',
      reason: 'Named ranges (e.g., "Revenue" instead of "A2:A100") make formulas self-documenting',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After pivot table → suggest refresh schedule
  if (action === 'pivot_create') {
    suggestions.push({
      type: 'follow_up',
      message: 'Pivot table created - set up automatic refresh for live data',
      tool: 'sheets_webhook',
      action: 'create_webhook',
      reason: 'Webhooks trigger pivot refresh when source data changes, keeping analysis current',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After filtering → suggest protected ranges
  if (action === 'filter_create' || action === 'filter_apply') {
    suggestions.push({
      type: 'follow_up',
      message: 'Filter applied - protect filter criteria from accidental changes',
      tool: 'sheets_collaborate',
      action: 'protect_range',
      reason: 'Protected ranges prevent users from breaking complex filters',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After collaboration → suggest notification rules
  if (action === 'share_add' || action === 'share_update') {
    suggestions.push({
      type: 'follow_up',
      message: 'Sharing configured - set up change notifications for collaborators',
      tool: 'sheets_webhook',
      action: 'create_webhook',
      reason: 'Notifications keep team members informed of data changes without manual checking',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After transaction → suggest rollback point
  if (tool === 'sheets_transaction' && action === 'commit') {
    suggestions.push({
      type: 'follow_up',
      message: 'Transaction committed - create checkpoint for easy rollback',
      tool: 'sheets_collaborate',
      action: 'version_create_snapshot',
      reason: 'Snapshots provide instant rollback if the transaction causes issues',
      priority: 'medium',
    });
  }

  // MEDIUM PRIORITY: After batch operation → suggest progress tracking
  if (action.includes('batch') && cellsAffected && cellsAffected > 1000) {
    suggestions.push({
      type: 'optimization',
      message: 'Large batch operation - enable progress tracking for better visibility',
      tool: 'sheets_session',
      action: 'enable_progress',
      reason: 'Progress tracking shows completion percentage for long-running operations',
      priority: 'medium',
    });
  }

  // LOW PRIORITY: After slow operation → suggest optimization
  if (context.duration && context.duration > 2000) {
    suggestions.push({
      type: 'optimization',
      message: `Operation took ${Math.round(context.duration / 1000)}s - optimization recommended`,
      tool: 'sheets_analyze',
      action: 'suggest_optimization',
      reason: 'Slow operations often have simple fixes (batching, field masks, caching)',
      priority: 'low',
    });
  }

  // LOW PRIORITY: After missing data → suggest data validation
  if (result && hasMissingData(result)) {
    suggestions.push({
      type: 'follow_up',
      message: 'Missing data detected - set up validation rules to prevent future gaps',
      tool: 'sheets_format',
      action: 'set_validation',
      reason: 'Data validation prevents empty cells and enforces required fields',
      priority: 'low',
    });
  }

  // LOW PRIORITY: After inconsistent formats → suggest standardization
  if (result && hasInconsistentFormats(result)) {
    suggestions.push({
      type: 'follow_up',
      message: 'Format inconsistencies found - apply preset for standardization',
      tool: 'sheets_format',
      action: 'apply_preset',
      reason: 'Consistent formatting improves readability and prevents parsing errors',
      priority: 'low',
    });
  }

  // LOW PRIORITY: After security concern → suggest access control
  if (action === 'write' && cellsAffected && cellsAffected > 1000) {
    suggestions.push({
      type: 'follow_up',
      message: 'Large data modification - review access permissions for security',
      tool: 'sheets_collaborate',
      action: 'get_permissions',
      reason: 'Verify only authorized users can modify critical data ranges',
      priority: 'low',
    });
  }

  // Sort by priority (HIGH first, then MEDIUM, then LOW)
  return suggestions.sort(
    (a, b) => PRIORITY_ORDER[a.priority || 'medium'] - PRIORITY_ORDER[b.priority || 'medium']
  );
}

/**
 * Check if result contains quality issues
 */
function hasQualityIssues(result: Record<string, unknown>): boolean {
  const quality = result['quality'] as { issues?: unknown[] } | undefined;
  const issues = quality?.issues as unknown[] | undefined;
  return Array.isArray(issues) && issues.length > 0;
}

/**
 * Get count of quality issues
 */
function getQualityIssueCount(result: Record<string, unknown>): number {
  const quality = result['quality'] as { issues?: unknown[] } | undefined;
  const issues = quality?.issues as unknown[] | undefined;
  return Array.isArray(issues) ? issues.length : 0;
}

/**
 * Check if data is suitable for visualization
 */
function hasVisualizableData(values: unknown[][]): boolean {
  if (values.length < 2) return false;

  // Check if there are numeric columns
  const firstDataRow = values[1];
  if (!Array.isArray(firstDataRow)) return false;

  const hasNumbers = firstDataRow.some((cell) => typeof cell === 'number');
  return hasNumbers;
}

/**
 * Check if result contains duplicate rows
 */
function hasDuplicates(result: Record<string, unknown>): boolean {
  const analysis = result['analysis'] as { duplicates?: unknown } | undefined;
  const duplicates = analysis?.duplicates as { count?: number } | undefined;
  return (duplicates?.count || 0) > 0;
}

/**
 * Get count of duplicate rows
 */
function getDuplicateCount(result: Record<string, unknown>): number {
  const analysis = result['analysis'] as { duplicates?: unknown } | undefined;
  const duplicates = analysis?.duplicates as { count?: number } | undefined;
  return duplicates?.count || 0;
}

/**
 * Check if input contains formulas
 */
function hasFormulas(input: Record<string, unknown>): boolean {
  const values = input['values'] as unknown[][] | undefined;
  if (!values) return false;

  return values.some((row) =>
    Array.isArray(row)
      ? row.some((cell) => typeof cell === 'string' && cell.startsWith('='))
      : false
  );
}

/**
 * Check if result contains missing data
 */
function hasMissingData(result: Record<string, unknown>): boolean {
  const analysis = result['analysis'] as { missingCells?: number } | undefined;
  return (analysis?.missingCells || 0) > 0;
}

/**
 * Check if result has inconsistent formats
 */
function hasInconsistentFormats(result: Record<string, unknown>): boolean {
  const quality = result['quality'] as { formatInconsistencies?: number } | undefined;
  return (quality?.formatInconsistencies || 0) > 0;
}

/**
 * Estimate cost of an operation
 */
export function estimateCost(context: EnhancementContext): CostEstimate {
  const { action, input, cellsAffected = 0, apiCallsMade = 1, duration } = context;

  // Base estimates
  let apiCalls = apiCallsMade;
  let estimatedLatencyMs = duration || 500; // Default 500ms if not measured

  // Adjust estimates based on operation type
  if (action.includes('batch')) {
    // Batch operations scale with number of ranges
    const ranges = (input['ranges'] as unknown[] | undefined)?.length || 1;
    apiCalls = Math.ceil(ranges / 100); // Google batches 100 requests
    estimatedLatencyMs = ranges * 50; // ~50ms per range in batch
  } else if (action === 'read' || action === 'write') {
    // Single operations are straightforward
    apiCalls = 1;
    estimatedLatencyMs = cellsAffected > 1000 ? 1000 : 500;
  } else if (action.includes('analysis') || action.includes('profile')) {
    // Analysis requires multiple reads
    apiCalls = 2;
    estimatedLatencyMs = cellsAffected * 0.5; // ~0.5ms per cell
  }

  // Quota tracking (simplified - would be real in production)
  const quotaLimit = 60; // 60 requests per minute per user
  const currentQuota = 0; // Would track this in a real rate limiter

  return {
    apiCalls,
    estimatedLatencyMs: Math.round(estimatedLatencyMs),
    cellsAffected: cellsAffected > 0 ? cellsAffected : undefined,
    quotaImpact: {
      current: currentQuota,
      limit: quotaLimit,
      remaining: quotaLimit - currentQuota - apiCalls,
    },
  };
}

/**
 * Get related tools for a given tool and action
 */
export function getRelatedTools(tool: string, action: string): string[] {
  const relatedMap: Record<string, string[]> = {
    'sheets_data:read': [
      'sheets_data:batch_read',
      'sheets_analyze:analyze_quality',
      'sheets_analyze:analyze_data',
    ],
    'sheets_data:write': [
      'sheets_format:apply_preset',
      'sheets_data:batch_write',
      'sheets_collaborate:version_create_snapshot',
    ],
    'sheets_data:append': ['sheets_format:apply_preset', 'sheets_data:batch_write'],
    'sheets_data:clear': [
      'sheets_collaborate:version_create_snapshot',
      'sheets_collaborate:version_restore_revision',
    ],
    'sheets_data:batch_read': ['sheets_analyze:analyze_data', 'sheets_data:read'],
    'sheets_data:batch_write': [
      'sheets_format:set_format',
      'sheets_collaborate:version_create_snapshot',
    ],
    'sheets_analyze:analyze_quality': ['sheets_analyze:analyze_data', 'sheets_data:read'],
    'sheets_analyze:analyze_data': ['sheets_visualize:chart_create', 'sheets_data:read'],
    'sheets_format:apply_preset': ['sheets_format:set_format', 'sheets_data:write'],
    'sheets_core:add_sheet': ['sheets_core:list_sheets', 'sheets_data:write'],
    'sheets_core:create': ['sheets_collaborate:share_add', 'sheets_core:add_sheet'],
  };

  const key = `${tool}:${action}`;
  return relatedMap[key] || [];
}

/**
 * Generate complete response metadata
 */
export function enhanceResponse(context: EnhancementContext): ResponseMeta {
  const suggestions = generateSuggestions(context);
  const costEstimate = estimateCost(context);
  const relatedTools = getRelatedTools(context.tool, context.action);

  const meta: ResponseMeta = {
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    costEstimate,
    relatedTools: relatedTools.length > 0 ? relatedTools : undefined,
  };

  // Add next steps for common workflows
  const nextSteps = generateNextSteps(context);
  if (nextSteps.length > 0) {
    meta.nextSteps = nextSteps;
  }

  return meta;
}

/**
 * Generate contextual next steps
 */
function generateNextSteps(context: EnhancementContext): string[] {
  const { tool, action, result } = context;
  const steps: string[] = [];

  if (tool === 'sheets_data' && action === 'read') {
    const values = result?.['values'];
    if (values) {
      steps.push('Analyze data with sheets_analyze:analyze_data for statistical insights');
      steps.push('Format the range with sheets_format:apply_preset for better readability');
    }
  }

  if (tool === 'sheets_data' && (action === 'write' || action === 'append')) {
    steps.push('Verify the data was written correctly by reading the range back');
    steps.push('Apply formatting to improve visual presentation');
    steps.push('Create a snapshot to enable easy rollback if needed');
  }

  if (tool === 'sheets_core' && action === 'create') {
    steps.push('Add sheets with sheets_core:add_sheet');
    steps.push('Share the spreadsheet with sheets_collaborate:share_add');
    steps.push('Start adding data with sheets_data:write');
  }

  if (tool === 'sheets_analyze' && action === 'analyze_data') {
    steps.push('Create charts to visualize the data patterns');
    steps.push('Use insights to clean or transform the data');
  }

  return steps;
}
