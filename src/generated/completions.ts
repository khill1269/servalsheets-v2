// @generated — Do not edit manually. Run npm run schema:commit to regenerate.
/**
 * ServalSheets - Completions Support
 *
 * Implements MCP completions capability for argument autocompletion.
 * Provides suggestions for spreadsheet IDs, sheet names, and action names.
 *
 * MCP Protocol: 2025-11-25
 */

import type { CompleteResult } from '@modelcontextprotocol/sdk/types.js';
import { getAvailableToolActions, getAvailableToolNames } from '../mcp/tool-registry-state.js';

/**
 * Action names for each tool (for autocompletion)
 * Total: 407 actions across 25 tools
 *
 * IMPORTANT: These must match the z.literal('action') values in the schema files.
 * Source of truth: src/schemas/*.ts
 * Total counts are derived from src/schemas/action-counts.ts.
 * Note: sheets_analyze has 23 actions (comprehensive + targeted + progressive analyses)
 */
export const TOOL_ACTIONS: Record<string, string[]> = {
  sheets_advanced: [
    'add_named_range',
    'update_named_range',
    'delete_named_range',
    'list_named_ranges',
    'get_named_range',
    'add_protected_range',
    'update_protected_range',
    'delete_protected_range',
    'list_protected_ranges',
    'set_metadata',
    'get_metadata',
    'delete_metadata',
    'add_banding',
    'update_banding',
    'delete_banding',
    'list_banding',
    'create_table',
    'delete_table',
    'list_tables',
    'update_table',
    'rename_table_column',
    'set_table_column_properties',
    'add_person_chip',
    'add_drive_chip',
    'add_rich_link_chip',
    'list_chips',
    'create_named_function',
    'list_named_functions',
    'get_named_function',
    'update_named_function',
    'delete_named_function',
  ],
  sheets_agent: [
    'plan',
    'execute',
    'execute_step',
    'observe',
    'rollback',
    'get_status',
    'list_plans',
    'resume',
  ],
  sheets_analyze: [
    'comprehensive',
    'analyze_data',
    'suggest_visualization',
    'generate_formula',
    'detect_patterns',
    'analyze_structure',
    'analyze_quality',
    'analyze_performance',
    'analyze_formulas',
    'query_natural_language',
    'explain_analysis',
    'scout',
    'plan',
    'execute_plan',
    'drill_down',
    'generate_actions',
    'suggest_next_actions',
    'auto_enhance',
    'discover_action',
    'diagnose_errors',
    'formula_health_check',
    'quick_insights',
    'semantic_search',
    'schedule_intelligence',
    'get_intelligence_report',
    'cancel_intelligence',
  ],
  sheets_appsscript: [
    'create',
    'get',
    'get_content',
    'update_content',
    'create_version',
    'list_versions',
    'get_version',
    'deploy',
    'list_deployments',
    'get_deployment',
    'undeploy',
    'run',
    'list_processes',
    'get_metrics',
    'create_trigger',
    'list_triggers',
    'delete_trigger',
    'update_trigger',
    'install_serval_function',
  ],
  sheets_auth: [
    'status',
    'login',
    'callback',
    'logout',
    'setup_feature',
  ],
  sheets_bigquery: [
    'connect',
    'connect_looker',
    'disconnect',
    'list_connections',
    'get_connection',
    'query',
    'preview',
    'refresh',
    'cancel_refresh',
    'list_datasets',
    'list_tables',
    'get_table_schema',
    'export_to_bigquery',
    'import_from_bigquery',
    'create_scheduled_query',
    'list_scheduled_queries',
    'delete_scheduled_query',
  ],
  sheets_collaborate: [
    'share_add',
    'share_update',
    'share_remove',
    'share_list',
    'share_get',
    'share_transfer_ownership',
    'share_set_link',
    'share_get_link',
    'comment_add',
    'comment_update',
    'comment_delete',
    'comment_list',
    'comment_get',
    'comment_resolve',
    'comment_reopen',
    'comment_add_reply',
    'comment_update_reply',
    'comment_delete_reply',
    'version_list_revisions',
    'version_get_revision',
    'version_restore_revision',
    'version_keep_revision',
    'version_create_snapshot',
    'version_snapshot_status',
    'version_list_snapshots',
    'version_restore_snapshot',
    'version_delete_snapshot',
    'version_compare',
    'version_export',
    'approval_create',
    'approval_approve',
    'approval_reject',
    'approval_get_status',
    'approval_list_pending',
    'approval_delegate',
    'approval_cancel',
    'list_access_proposals',
    'resolve_access_proposal',
    'label_list',
    'label_apply',
    'label_remove',
  ],
  sheets_composite: [
    'import_csv',
    'smart_append',
    'bulk_update',
    'deduplicate',
    'export_xlsx',
    'import_xlsx',
    'get_form_responses',
    'setup_sheet',
    'import_and_format',
    'clone_structure',
    'export_large_dataset',
    'audit_sheet',
    'publish_report',
    'data_pipeline',
    'instantiate_template',
    'migrate_spreadsheet',
    'generate_sheet',
    'generate_template',
    'preview_generation',
    'batch_operations',
    'build_dashboard',
  ],
  sheets_compute: [
    'evaluate',
    'aggregate',
    'statistical',
    'regression',
    'forecast',
    'matrix_op',
    'pivot_compute',
    'custom_function',
    'batch_compute',
    'explain_formula',
    'sql_query',
    'sql_join',
    'python_eval',
    'pandas_profile',
    'sklearn_model',
    'matplotlib_chart',
  ],
  sheets_confirm: [
    'request',
    'get_stats',
    'wizard_start',
    'wizard_step',
    'wizard_complete',
  ],
  sheets_connectors: [
    'list_connectors',
    'configure',
    'query',
    'batch_query',
    'subscribe',
    'unsubscribe',
    'list_subscriptions',
    'transform',
    'status',
    'discover',
  ],
  sheets_core: [
    'get',
    'create',
    'copy',
    'update_properties',
    'get_url',
    'batch_get',
    'get_comprehensive',
    'describe_workbook',
    'workbook_fingerprint',
    'list',
    'add_sheet',
    'delete_sheet',
    'duplicate_sheet',
    'update_sheet',
    'copy_sheet_to',
    'list_sheets',
    'get_sheet',
    'batch_delete_sheets',
    'batch_update_sheets',
    'clear_sheet',
    'move_sheet',
  ],
  sheets_data: [
    'read',
    'write',
    'append',
    'clear',
    'batch_read',
    'batch_write',
    'batch_clear',
    'find_replace',
    'add_note',
    'get_note',
    'clear_note',
    'set_hyperlink',
    'clear_hyperlink',
    'merge_cells',
    'unmerge_cells',
    'get_merges',
    'cut_paste',
    'copy_paste',
    'detect_spill_ranges',
    'smart_fill',
    'auto_fill',
    'cross_read',
    'cross_query',
    'cross_write',
    'cross_compare',
  ],
  sheets_dependencies: [
    'build',
    'analyze_impact',
    'detect_cycles',
    'get_dependencies',
    'get_dependents',
    'get_stats',
    'export_dot',
    'model_scenario',
    'compare_scenarios',
    'create_scenario_sheet',
  ],
  sheets_dimensions: [
    'insert',
    'delete',
    'move',
    'resize',
    'auto_resize',
    'hide',
    'show',
    'freeze',
    'group',
    'ungroup',
    'append',
    'set_basic_filter',
    'clear_basic_filter',
    'get_basic_filter',
    'sort_range',
    'delete_duplicates',
    'trim_whitespace',
    'randomize_range',
    'text_to_columns',
    'auto_fill',
    'create_filter_view',
    'duplicate_filter_view',
    'update_filter_view',
    'delete_filter_view',
    'list_filter_views',
    'get_filter_view',
    'create_slicer',
    'update_slicer',
    'delete_slicer',
    'list_slicers',
  ],
  sheets_federation: [
    'call_remote',
    'list_servers',
    'get_server_tools',
    'validate_connection',
  ],
  sheets_fix: [
    'fix',
    'clean',
    'standardize_formats',
    'fill_missing',
    'detect_anomalies',
    'suggest_cleaning',
  ],
  sheets_format: [
    'set_format',
    'suggest_format',
    'set_background',
    'set_text_format',
    'set_number_format',
    'set_alignment',
    'set_borders',
    'clear_format',
    'apply_preset',
    'auto_fit',
    'sparkline_add',
    'sparkline_get',
    'sparkline_clear',
    'rule_add_conditional_format',
    'rule_update_conditional_format',
    'rule_delete_conditional_format',
    'rule_list_conditional_formats',
    'set_data_validation',
    'clear_data_validation',
    'list_data_validations',
    'add_conditional_format_rule',
    'batch_format',
    'set_rich_text',
    'generate_conditional_format',
    'build_dependent_dropdown',
  ],
  sheets_history: [
    'list',
    'get',
    'stats',
    'undo',
    'redo',
    'revert_to',
    'clear',
    'timeline',
    'diff_revisions',
    'restore_cells',
  ],
  sheets_quality: [
    'validate',
    'detect_conflicts',
    'resolve_conflict',
    'analyze_impact',
  ],
  sheets_session: [
    'set_active',
    'get_active',
    'get_context',
    'record_operation',
    'get_last_operation',
    'get_history',
    'find_by_reference',
    'update_preferences',
    'get_preferences',
    'set_pending',
    'get_pending',
    'clear_pending',
    'save_checkpoint',
    'load_checkpoint',
    'list_checkpoints',
    'delete_checkpoint',
    'reset',
    'get_alerts',
    'acknowledge_alert',
    'clear_alerts',
    'set_user_id',
    'get_profile',
    'update_profile_preferences',
    'record_successful_formula',
    'reject_suggestion',
    'get_top_formulas',
    'schedule_create',
    'schedule_list',
    'schedule_cancel',
    'schedule_run_now',
    'execute_pipeline',
  ],
  sheets_templates: [
    'list',
    'get',
    'create',
    'apply',
    'update',
    'delete',
    'preview',
    'import_builtin',
  ],
  sheets_transaction: [
    'begin',
    'queue',
    'commit',
    'rollback',
    'status',
    'list',
  ],
  sheets_visualize: [
    'chart_create',
    'suggest_chart',
    'chart_update',
    'chart_delete',
    'chart_list',
    'chart_get',
    'chart_move',
    'chart_resize',
    'chart_update_data_range',
    'chart_add_trendline',
    'chart_remove_trendline',
    'pivot_create',
    'suggest_pivot',
    'pivot_update',
    'pivot_delete',
    'pivot_list',
    'pivot_get',
    'pivot_refresh',
  ],
  sheets_webhook: [
    'register',
    'unregister',
    'list',
    'get',
    'test',
    'get_stats',
    'watch_changes',
    'subscribe_workspace',
    'unsubscribe_workspace',
    'list_workspace_subscriptions',
  ],
};

/**
 * Chart types for autocompletion
 */
export const CHART_TYPES = [
  'BAR',
  'LINE',
  'AREA',
  'COLUMN',
  'SCATTER',
  'COMBO',
  'STEPPED_AREA',
  'PIE',
  'DOUGHNUT',
  'TREEMAP',
  'WATERFALL',
  'HISTOGRAM',
  'CANDLESTICK',
  'ORG',
  'SCORECARD',
  'BUBBLE',
];

/**
 * Number format types for autocompletion
 */
export const NUMBER_FORMAT_TYPES = [
  'TEXT',
  'NUMBER',
  'PERCENT',
  'CURRENCY',
  'DATE',
  'TIME',
  'DATE_TIME',
  'SCIENTIFIC',
];

/**
 * Condition types for validation and conditional formatting
 */
export const CONDITION_TYPES = [
  'NUMBER_GREATER',
  'NUMBER_GREATER_THAN_EQ',
  'NUMBER_LESS',
  'NUMBER_LESS_THAN_EQ',
  'NUMBER_EQ',
  'NUMBER_NOT_EQ',
  'NUMBER_BETWEEN',
  'NUMBER_NOT_BETWEEN',
  'TEXT_CONTAINS',
  'TEXT_NOT_CONTAINS',
  'TEXT_STARTS_WITH',
  'TEXT_ENDS_WITH',
  'TEXT_EQ',
  'TEXT_IS_EMAIL',
  'TEXT_IS_URL',
  'DATE_EQ',
  'DATE_BEFORE',
  'DATE_AFTER',
  'DATE_ON_OR_BEFORE',
  'DATE_ON_OR_AFTER',
  'DATE_BETWEEN',
  'DATE_NOT_BETWEEN',
  'DATE_IS_VALID',
  'BLANK',
  'NOT_BLANK',
  'CUSTOM_FORMULA',
  'ONE_OF_LIST',
  'ONE_OF_RANGE',
  'BOOLEAN',
];

/**
 * Formatting presets for autocompletion
 */
export const FORMAT_PRESETS = [
  'alternating',
  'corporate',
  'modern',
  'minimal',
  'colorful',
  'financial',
  'dashboard',
];

/**
 * Permission roles for autocompletion
 */
export const PERMISSION_ROLES = [
  'owner',
  'organizer',
  'fileOrganizer',
  'writer',
  'commenter',
  'reader',
];

/**
 * Visibility options for autocompletion
 */
export const VISIBILITY_OPTIONS = ['private', 'anyone_with_link', 'anyone_in_domain'];

/**
 * Conflict resolution strategies for sheets_quality.resolve_conflict
 */
export const CONFLICT_RESOLUTION_STRATEGIES = [
  'keep_local',
  'keep_remote',
  'merge',
  'manual',
] as const;

/**
 * Fill strategies for sheets_fix.fill_missing
 */
export const FILL_STRATEGIES = [
  'forward',
  'backward',
  'mean',
  'median',
  'mode',
  'constant',
] as const;

/**
 * Recent spreadsheet cache for completions
 * In production, this would be populated from user's recent activity
 */
class SpreadsheetCache {
  private recentIds: Map<string, { title: string; lastAccess: number }> = new Map();
  private maxSize = 50;

  add(spreadsheetId: string, title: string): void {
    this.recentIds.set(spreadsheetId, {
      title,
      lastAccess: Date.now(),
    });

    // Prune if over max size
    if (this.recentIds.size > this.maxSize) {
      const entries = Array.from(this.recentIds.entries()).sort(
        (a, b) => b[1].lastAccess - a[1].lastAccess
      );
      this.recentIds = new Map(entries.slice(0, this.maxSize));
    }
  }

  getCompletions(partial: string): string[] {
    // Defensive: handle undefined/null partial
    if (!partial || typeof partial !== 'string') {
      return [];
    }
    const lower = partial.toLowerCase();
    return Array.from(this.recentIds.entries())
      .filter(
        ([id, meta]) => id.toLowerCase().includes(lower) || meta.title.toLowerCase().includes(lower)
      )
      .sort((a, b) => b[1].lastAccess - a[1].lastAccess)
      .map(([id]) => id)
      .slice(0, 20);
  }
}

export const spreadsheetCache = new SpreadsheetCache();

const DEFAULT_SPREADSHEET_IDS = ['1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'];

const DEFAULT_RANGES = ['Sheet1!A1:Z100', 'Sheet1!A1:Z1000', 'A1:Z100'];

/**
 * Complete action names for a tool
 */
/**
 * Action Equivalence Map (Quick Win #4)
 * Maps natural language phrases to actual action names
 * Helps Claude discover the right actions based on intent
 */
const ACTION_ALIASES: Record<string, string> = {
  // Data operations
  'get data': 'read',
  fetch: 'read',
  retrieve: 'read',
  pull: 'read',
  'set data': 'write',
  put: 'write',
  update: 'write',
  'insert row': 'append',
  'add data': 'append',
  erase: 'clear',
  'remove data': 'clear',
  wipe: 'clear',
  find: 'find_replace',
  search: 'find_replace',
  replace: 'find_replace',

  // Spreadsheet operations
  'new spreadsheet': 'create',
  'make spreadsheet': 'create',
  'duplicate spreadsheet': 'copy',
  'clone spreadsheet': 'copy',
  'new sheet': 'add_sheet',
  'add tab': 'add_sheet',
  'create tab': 'add_sheet',
  'remove sheet': 'delete_sheet',
  'delete tab': 'delete_sheet',
  'copy tab': 'duplicate_sheet',
  'rename sheet': 'update_sheet',
  'rename tab': 'update_sheet',
  rename: 'update_sheet',

  // Formatting operations
  style: 'set_format',
  'apply style': 'set_format',
  color: 'set_background',
  background: 'set_background',
  font: 'set_text_format',
  bold: 'set_text_format',
  currency: 'set_number_format',
  percent: 'set_number_format',
  percentage: 'set_number_format',
  'date format': 'set_number_format',

  // Dimension operations (sheets_dimensions tool)
  'add row': 'insert',
  'add column': 'insert',
  'new row': 'insert',
  'new column': 'insert',
  'delete row': 'delete',
  'delete column': 'delete',
  'remove row': 'delete',
  'remove column': 'delete',
  'hide row': 'hide',
  'hide column': 'hide',
  'show row': 'show',
  'show column': 'show',

  // Chart operations
  'create chart': 'chart_create',
  'make chart': 'chart_create',
  'new chart': 'chart_create',
  'create graph': 'chart_create',
  'make graph': 'chart_create',
  visualize: 'chart_create',
  plot: 'chart_create',
  graph: 'chart_create',
  'modify chart': 'chart_update',
  'edit chart': 'chart_update',
  'change chart': 'chart_update',
  'remove chart': 'chart_delete',
  'delete chart': 'chart_delete',

  // Cell operations
  merge: 'merge_cells',
  'combine cells': 'merge_cells',
  'join cells': 'merge_cells',
  unmerge: 'unmerge_cells',
  'split cells': 'unmerge_cells',
  'separate cells': 'unmerge_cells',

  // Analysis operations
  understand: 'comprehensive',
  analyze: 'analyze_data',
  examine: 'analyze_data',
  inspect: 'analyze_data',
  study: 'analyze_data',
  'check quality': 'analyze_quality',
  validate: 'analyze_quality',
  stats: 'analyze_data',
  patterns: 'detect_patterns',

  // Collaboration operations
  share: 'share_add',
  'give access': 'share_add',
  'grant access': 'share_add',
  invite: 'share_add',
  revoke: 'share_remove',
  unshare: 'share_remove',
  'remove access': 'share_remove',
  'change permission': 'share_update',
  'modify access': 'share_update',

  // Version operations
  snapshot: 'version_create_snapshot',
  'save version': 'version_create_snapshot',
  'snapshot status': 'version_snapshot_status',
  'snapshot task': 'version_snapshot_status',
  revert: 'version_restore_revision',
  rollback: 'version_restore_revision',
  restore: 'version_restore_revision',

  // Transaction operations
  batch: 'begin',
  bulk: 'begin',
  multiple: 'begin',
  atomic: 'begin',

  // P4 feature operations (sheets_composite)
  audit: 'audit_sheet',
  publish: 'publish_report',
  pipeline: 'data_pipeline',
  etl: 'data_pipeline',

  // Cross-spreadsheet operations (sheets_data)
  cross: 'cross_read',
  multi: 'cross_read',

  // Federation operations (sheets_federation)
  remote: 'call_remote',
  federate: 'call_remote',

  // Data cleaning operations (sheets_fix)
  anomaly: 'detect_anomalies',
  anomalies: 'detect_anomalies',

  // Sheet generation and enhancement (sheets_analyze)
  generate: 'generate_sheet',
  enhance: 'auto_enhance',
  suggest: 'suggest_next_actions',

  // Scenario modeling (sheets_dependencies)
  scenario: 'model_scenario',
  'what-if': 'model_scenario',
  what_if: 'model_scenario',

  // sheets_advanced (named ranges, protected ranges, tables, metadata, chips)
  'named range': 'add_named_range',
  'protect range': 'add_protected_range',
  'protect cells': 'add_protected_range',
  metadata: 'set_metadata',
  'person chip': 'add_person_chip',
  table: 'create_table',
  banding: 'add_banding',

  // sheets_agent (autonomous plan/execute/rollback)
  'run plan': 'execute',
  'execute plan': 'execute',
  'agent plan': 'plan',
  'multi-step': 'plan',
  'undo all': 'rollback',
  'cancel plan': 'rollback',

  // sheets_auth (authentication lifecycle)
  login: 'login',
  authenticate: 'login',
  'sign in': 'login',
  logout: 'logout',
  'sign out': 'logout',
  'auth status': 'status',

  // sheets_bigquery (connected sheets / BigQuery integration)
  bigquery: 'connect',
  'connected sheets': 'connect',
  'bq query': 'query',
  'export to bq': 'export_to_bigquery',
  'import from bq': 'import_from_bigquery',
  'scheduled query': 'create_scheduled_query',

  // sheets_compute (server-side statistical computation)
  compute: 'aggregate',
  calculate: 'aggregate',
  statistics: 'statistical',
  regression: 'regression',
  forecast: 'forecast',
  'matrix multiply': 'matrix_op',

  // sheets_confirm (interactive confirmation and wizards)
  confirm: 'request',
  'confirm action': 'request',
  wizard: 'wizard_start',
  'start wizard': 'wizard_start',
  approve: 'request',

  // sheets_connectors (external API connectors)
  connector: 'configure',
  'external api': 'query',
  'live data': 'query',
  'market data': 'query',
  subscribe: 'subscribe',
  'data stream': 'subscribe',

  // sheets_history (operation history / undo-redo)
  history: 'list',
  'version history': 'list',
  undo: 'version_restore_revision',
  redo: 'redo',
  'time travel': 'timeline',
  'restore cells': 'restore_cells',

  // sheets_quality (validation and conflict detection)
  quality: 'validate',
  'detect conflicts': 'detect_conflicts',
  conflict: 'detect_conflicts',
  'resolve conflict': 'resolve_conflict',
  'validate data': 'validate',

  // sheets_session (active context and preferences)
  session: 'set_active',
  context: 'get_context',
  checkpoint: 'save_checkpoint',
  'save state': 'save_checkpoint',
  preferences: 'update_preferences',
  'load checkpoint': 'load_checkpoint',

  // sheets_templates (save and apply layout templates)
  // Note: 'apply' and 'import_builtin' are unique to sheets_templates
  'apply template': 'apply',
  'use template': 'apply',
  'import builtin': 'import_builtin',
  'built-in template': 'import_builtin',

  // sheets_webhook (event notifications)
  webhook: 'register',
  'watch changes': 'watch_changes',
  notification: 'register',
  'event trigger': 'register',
  'unwatch': 'unregister',

  // Boost low-coverage tools to ≥3 aliases
  // sheets_appsscript (was 2 aliases)
  'deploy script': 'deploy',
  'run function': 'run',

  // sheets_federation (was 2 aliases)
  'list servers': 'list_servers',
  'validate server': 'validate_connection',

  // sheets_fix (was 2 aliases)
  clean: 'clean',
  'fill blanks': 'fill_missing',
  standardize: 'standardize_formats',
};

export function completeToolName(partial: string): string[] {
  if (!partial || typeof partial !== 'string') {
    return [];
  }

  const lower = partial.toLowerCase();
  return getAvailableToolNames(Object.keys(TOOL_ACTIONS))
    .filter((toolName) => toolName.toLowerCase().startsWith(lower))
    .slice(0, 20);
}

export function completeAction(toolName: string, partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }

  const actions = getAvailableToolActions(toolName, TOOL_ACTIONS, Object.keys(TOOL_ACTIONS));
  const lower = partial.toLowerCase();

  // First, try direct action name matching
  let matches = actions.filter((a) => a.toLowerCase().startsWith(lower));

  // If no matches, try alias matching
  if (matches.length === 0 && lower.length >= 3) {
    const aliasMatch = ACTION_ALIASES[lower];
    if (aliasMatch && actions.includes(aliasMatch)) {
      matches = [aliasMatch];
    }

    // Also try partial alias matching
    if (matches.length === 0) {
      for (const [alias, action] of Object.entries(ACTION_ALIASES)) {
        if (alias.includes(lower) && actions.includes(action)) {
          matches.push(action);
        }
      }
    }
  }

  // Deduplicate and return
  return [...new Set(matches)].slice(0, 20);
}

/**
 * Complete spreadsheet IDs from cache
 */
export function completeSpreadsheetId(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const cached = spreadsheetCache.getCompletions(partial);
  const lower = partial.toLowerCase();
  const defaults = DEFAULT_SPREADSHEET_IDS.filter((id) => id.toLowerCase().includes(lower));
  const merged = [...cached, ...defaults.filter((id) => !cached.includes(id))];
  return merged.slice(0, 20);
}

/**
 * Complete A1-style ranges
 */
export function completeRange(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const lower = partial.toLowerCase();
  return DEFAULT_RANGES.filter((range) => range.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Extract spreadsheetId from an input payload
 */
export function extractSpreadsheetId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const direct = record['spreadsheetId'];
  if (typeof direct === 'string') return direct;
  const request = record['request'];
  if (request && typeof request === 'object') {
    const nested = (request as Record<string, unknown>)['spreadsheetId'];
    if (typeof nested === 'string') return nested;
  }
  return null;
}

/**
 * Record spreadsheet ID usage for completions
 */
export function recordSpreadsheetId(input: unknown): void {
  const spreadsheetId = extractSpreadsheetId(input);
  if (!spreadsheetId) return;
  spreadsheetCache.add(spreadsheetId, spreadsheetId);
}

/**
 * Complete chart types
 */
export function completeChartType(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const lower = partial.toLowerCase();
  return CHART_TYPES.filter((t) => t.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Complete number format types
 */
export function completeNumberFormatType(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const lower = partial.toLowerCase();
  return NUMBER_FORMAT_TYPES.filter((t) => t.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Complete condition types
 */
export function completeConditionType(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const lower = partial.toLowerCase();
  return CONDITION_TYPES.filter((t) => t.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Complete format presets
 */
export function completeFormatPreset(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const lower = partial.toLowerCase();
  return FORMAT_PRESETS.filter((p) => p.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Complete permission roles
 */
export function completePermissionRole(partial: string): string[] {
  // Defensive: handle undefined/null partial
  if (!partial || typeof partial !== 'string') {
    return [];
  }
  const lower = partial.toLowerCase();
  return PERMISSION_ROLES.filter((r) => r.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Create a completion result
 */
export function createCompletionResult(values: string[]): CompleteResult {
  return {
    completion: {
      values: values.slice(0, 100),
      total: values.length,
      hasMore: values.length > 100,
    },
  };
}

/**
 * Empty completion result
 */
export const EMPTY_COMPLETION: CompleteResult = {
  completion: {
    values: [],
    hasMore: false,
  },
};

// ============================================================================
// ISSUE-062: 6 Missing MCP Completions
// ============================================================================

/** Simple bounded LRU set for recently-seen entity values */
class EntityCache {
  private values: Map<string, number> = new Map(); // value → lastAccess
  constructor(private maxSize = 100) {}

  add(value: string): void {
    this.values.set(value, Date.now());
    if (this.values.size > this.maxSize) {
      const sorted = Array.from(this.values.entries()).sort((a, b) => b[1] - a[1]);
      this.values = new Map(sorted.slice(0, this.maxSize));
    }
  }

  getCompletions(partial: string): string[] {
    if (!partial || typeof partial !== 'string') {
      return Array.from(this.values.keys()).slice(0, 20);
    }
    const lower = partial.toLowerCase();
    return Array.from(this.values.entries())
      .filter(([v]) => v.toLowerCase().includes(lower))
      .sort((a, b) => b[1] - a[1])
      .map(([v]) => v)
      .slice(0, 20);
  }
}

const sheetNameCache = new EntityCache(200);
const templateIdCache = new EntityCache(50);
const chartIdCache = new EntityCache(100);
const namedRangeCache = new EntityCache(100);
const webhookIdCache = new EntityCache(50);
const revisionIdCache = new EntityCache(50);
const sheetIdCache = new EntityCache(100);
const connectorIdCache = new EntityCache(20);
const serverNameCache = new EntityCache(20);
const filterViewIdCache = new EntityCache(50);
const slicerIdCache = new EntityCache(50);
const protectedRangeIdCache = new EntityCache(100);
const bandingIdCache = new EntityCache(50);
const scriptIdCache = new EntityCache(20);

/** Record a sheet name observed in a response (call from core/data handlers) */
export function recordSheetName(name: string): void {
  if (name && typeof name === 'string') sheetNameCache.add(name);
}

/** Record a template ID observed in a response */
export function recordTemplateId(id: string): void {
  if (id && typeof id === 'string') templateIdCache.add(id);
}

/** Record a chart ID observed in a response */
export function recordChartId(id: string | number): void {
  const s = String(id);
  if (s) chartIdCache.add(s);
}

/** Record a named range name observed in a response */
export function recordNamedRange(name: string): void {
  if (name && typeof name === 'string') namedRangeCache.add(name);
}

/** Record a webhook ID observed in a response */
export function recordWebhookId(id: string): void {
  if (id && typeof id === 'string') webhookIdCache.add(id);
}

/** Record a revision ID observed in a response */
export function recordRevisionId(id: string): void {
  if (id && typeof id === 'string') revisionIdCache.add(id);
}

/** Complete sheet names from recently-seen values */
export function completeSheetName(partial: string): string[] {
  return sheetNameCache.getCompletions(partial);
}

/** Complete template IDs from recently-seen values */
export function completeTemplateId(partial: string): string[] {
  return templateIdCache.getCompletions(partial);
}

/** Complete chart IDs from recently-seen values */
export function completeChartId(partial: string): string[] {
  return chartIdCache.getCompletions(partial);
}

/** Complete named range names from recently-seen values */
export function completeNamedRange(partial: string): string[] {
  return namedRangeCache.getCompletions(partial);
}

/** Complete webhook IDs from recently-seen values */
export function completeWebhookId(partial: string): string[] {
  return webhookIdCache.getCompletions(partial);
}

/** Complete revision IDs from recently-seen values */
export function completeRevisionId(partial: string): string[] {
  return revisionIdCache.getCompletions(partial);
}

/** Record a sheet ID (numeric) observed in a response (call from core/dimensions handlers) */
export function recordSheetId(id: number | string): void {
  const s = String(id);
  if (s && /^\d+$/.test(s)) sheetIdCache.add(s);
}

/** Complete sheet IDs from recently-seen numeric values */
export function completeSheetId(partial: string): string[] {
  return sheetIdCache.getCompletions(partial);
}

// ============================================================================
// STRUCTURAL ENTITY COMPLETERS (filter views, slicers, protected ranges, etc.)
// ============================================================================

/** Record a filter view ID observed in a response */
export function recordFilterViewId(id: string | number): void {
  const s = String(id);
  if (s && /^\d+$/.test(s)) filterViewIdCache.add(s);
}

/** Complete filter view IDs from recently-seen values */
export function completeFilterViewId(partial: string): string[] {
  return filterViewIdCache.getCompletions(partial);
}

/** Record a slicer ID observed in a response */
export function recordSlicerId(id: string | number): void {
  const s = String(id);
  if (s && /^\d+$/.test(s)) slicerIdCache.add(s);
}

/** Complete slicer IDs from recently-seen values */
export function completeSlicerId(partial: string): string[] {
  return slicerIdCache.getCompletions(partial);
}

/** Record a protected range ID observed in a response */
export function recordProtectedRangeId(id: string | number): void {
  const s = String(id);
  if (s && /^\d+$/.test(s)) protectedRangeIdCache.add(s);
}

/** Complete protected range IDs from recently-seen values */
export function completeProtectedRangeId(partial: string): string[] {
  return protectedRangeIdCache.getCompletions(partial);
}

/** Record a banding ID observed in a response */
export function recordBandingId(id: string | number): void {
  const s = String(id);
  if (s && /^\d+$/.test(s)) bandingIdCache.add(s);
}

/** Complete banding IDs from recently-seen values */
export function completeBandingId(partial: string): string[] {
  return bandingIdCache.getCompletions(partial);
}

/** Record an Apps Script project ID observed in a response */
export function recordScriptId(id: string): void {
  if (id && typeof id === 'string') scriptIdCache.add(id);
}

/** Complete script IDs from recently-seen values */
export function completeScriptId(partial: string): string[] {
  return scriptIdCache.getCompletions(partial);
}

// ============================================================================
// CONNECTOR & FEDERATION COMPLETERS
// ============================================================================

/** Built-in connector IDs (static) */
const BUILTIN_CONNECTOR_IDS: readonly string[] = [
  'alpha_vantage', 'finnhub', 'fmp', 'fred', 'polygon',
] as const;

/** Record a connector ID observed at runtime (call from connectors handler) */
export function recordConnectorId(id: string): void {
  if (id) connectorIdCache.add(id);
}

/** Complete connector IDs from builtins + observed at runtime */
export function completeConnectorId(partial: string): string[] {
  if (!partial || typeof partial !== 'string') {
    const cached = connectorIdCache.getCompletions('');
    const merged = [...BUILTIN_CONNECTOR_IDS, ...cached.filter((c) => !BUILTIN_CONNECTOR_IDS.includes(c))];
    return merged.slice(0, 20);
  }
  const lower = partial.toLowerCase();
  const builtinMatches = (BUILTIN_CONNECTOR_IDS as readonly string[]).filter((id) => id.toLowerCase().startsWith(lower));
  const cacheMatches = connectorIdCache.getCompletions(partial);
  const merged = [...builtinMatches, ...cacheMatches.filter((c) => !builtinMatches.includes(c))];
  return merged.slice(0, 20);
}

/** Record a federation server name observed at runtime (call from federation handler) */
export function recordServerName(name: string): void {
  if (name) serverNameCache.add(name);
}

/** Complete federation server names from recently observed values */
export function completeServerName(partial: string): string[] {
  return serverNameCache.getCompletions(partial);
}

// ============================================================================
// STATIC COMPLETERS — locale and timezone
// ============================================================================

/** BCP-47 locale codes supported by Google Sheets (format: ll_CC) */
const LOCALES: readonly string[] = [
  'af_ZA', 'am_ET', 'ar_SA', 'az_AZ', 'be_BY', 'bg_BG', 'bn_BD', 'ca_ES',
  'cs_CZ', 'cy_GB', 'da_DK', 'de_AT', 'de_CH', 'de_DE', 'el_GR', 'en_AU',
  'en_CA', 'en_GB', 'en_IE', 'en_IN', 'en_NZ', 'en_SG', 'en_US', 'en_ZA',
  'es_AR', 'es_CL', 'es_CO', 'es_ES', 'es_MX', 'es_PE', 'es_VE', 'et_EE',
  'eu_ES', 'fa_IR', 'fi_FI', 'fil_PH', 'fr_BE', 'fr_CA', 'fr_CH', 'fr_FR',
  'gl_ES', 'gu_IN', 'he_IL', 'hi_IN', 'hr_HR', 'hu_HU', 'hy_AM', 'id_ID',
  'is_IS', 'it_CH', 'it_IT', 'ja_JP', 'ka_GE', 'kk_KZ', 'km_KH', 'kn_IN',
  'ko_KR', 'lo_LA', 'lt_LT', 'lv_LV', 'mk_MK', 'ml_IN', 'mn_MN', 'mr_IN',
  'ms_MY', 'my_MM', 'ne_NP', 'nl_BE', 'nl_NL', 'no_NO', 'pa_IN', 'pl_PL',
  'pt_BR', 'pt_PT', 'ro_RO', 'ru_RU', 'si_LK', 'sk_SK', 'sl_SI', 'sq_AL',
  'sr_RS', 'sv_SE', 'sw_TZ', 'ta_IN', 'te_IN', 'th_TH', 'tr_TR', 'uk_UA',
  'ur_PK', 'uz_UZ', 'vi_VN', 'zh_CN', 'zh_HK', 'zh_TW', 'zu_ZA',
] as const;

/** IANA timezone identifiers commonly used in Google Sheets */
const TIMEZONES: readonly string[] = [
  'Africa/Abidjan', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Johannesburg',
  'Africa/Lagos', 'Africa/Nairobi', 'America/Anchorage', 'America/Argentina/Buenos_Aires',
  'America/Bogota', 'America/Chicago', 'America/Denver', 'America/Detroit',
  'America/Halifax', 'America/Lima', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Phoenix', 'America/Santiago', 'America/Sao_Paulo',
  'America/Toronto', 'America/Vancouver', 'Asia/Bangkok', 'Asia/Colombo',
  'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Karachi', 'Asia/Kathmandu',
  'Asia/Kolkata', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Riyadh', 'Asia/Seoul',
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Taipei', 'Asia/Tehran', 'Asia/Tokyo',
  'Asia/Yangon', 'Atlantic/Azores', 'Atlantic/Reykjavik', 'Australia/Adelaide',
  'Australia/Brisbane', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Brussels',
  'Europe/Budapest', 'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Helsinki',
  'Europe/Istanbul', 'Europe/Kiev', 'Europe/Lisbon', 'Europe/London',
  'Europe/Madrid', 'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris',
  'Europe/Prague', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Vienna',
  'Europe/Warsaw', 'Europe/Zurich', 'Pacific/Auckland', 'Pacific/Fiji',
  'Pacific/Guam', 'Pacific/Honolulu', 'Pacific/Noumea', 'Pacific/Port_Moresby',
  'UTC',
] as const;

/**
 * Complete locale codes (format: ll_CC, e.g. en_US, fr_FR, de_DE)
 */
export function completeLocale(partial: string): string[] {
  if (!partial || typeof partial !== 'string') {
    return LOCALES.slice(0, 20) as string[];
  }
  const lower = partial.toLowerCase();
  return (LOCALES as readonly string[]).filter((l) => l.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Complete IANA timezone identifiers (e.g. America/New_York, Europe/London)
 */
export function completeTimeZone(partial: string): string[] {
  if (!partial || typeof partial !== 'string') {
    return TIMEZONES.slice(0, 20) as string[];
  }
  const lower = partial.toLowerCase();
  return (TIMEZONES as readonly string[]).filter((tz) => tz.toLowerCase().startsWith(lower)).slice(0, 20);
}

/**
 * Complete conflict resolution strategies for sheets_quality.resolve_conflict
 */
export function completeConflictResolutionStrategy(partial: string): string[] {
  if (!partial || typeof partial !== 'string') {
    return CONFLICT_RESOLUTION_STRATEGIES.slice(0, 20) as unknown as string[];
  }
  const lower = partial.toLowerCase();
  return (CONFLICT_RESOLUTION_STRATEGIES as readonly string[]).filter((s) => s.toLowerCase().startsWith(lower)).slice(0, 20) as unknown as string[];
}

/**
 * Complete fill strategies for sheets_fix.fill_missing
 */
export function completeFillStrategy(partial: string): string[] {
  if (!partial || typeof partial !== 'string') {
    return FILL_STRATEGIES.slice(0, 20) as unknown as string[];
  }
  const lower = partial.toLowerCase();
  return (FILL_STRATEGIES as readonly string[]).filter((s) => s.toLowerCase().startsWith(lower)).slice(0, 20) as unknown as string[];
}
