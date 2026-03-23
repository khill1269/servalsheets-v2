/**
 * ServalSheets - Incremental Scope Consent (SEP-835)
 *
 * Implements on-demand OAuth scope requests without full re-authentication.
 * When an operation requires elevated permissions, the server returns a
 * structured error with the required scopes and authorization URL.
 *
 * Flow:
 * 1. User attempts operation requiring elevated scope (e.g., sharing)
 * 2. Server detects insufficient scopes
 * 3. Server returns IncrementalScopeRequired error with auth URL
 * 4. Client prompts user to authorize additional scopes
 * 5. User completes authorization
 * 6. Client retries operation with new token
 *
 * @see https://spec.modelcontextprotocol.io/specification/security/
 */

import type { OAuth2Client } from 'google-auth-library';
import { logger } from '../utils/logger.js';
import { DEFAULT_SCOPES } from '../services/google-api.js';

/**
 * Scope categories for different operations
 */
export enum ScopeCategory {
  /** Basic spreadsheet operations */
  SPREADSHEET = 'spreadsheet',
  /** File-level Drive operations (create, open) */
  DRIVE_FILE = 'drive_file',
  /** Full Drive operations (share, list all, permissions) */
  DRIVE_FULL = 'drive_full',
  /** Read-only operations */
  READONLY = 'readonly',
}

/**
 * Operation to required scope mapping
 */
export const OPERATION_SCOPES: Record<
  string,
  {
    required: string[];
    category: ScopeCategory;
    description: string;
  }
> = {
  // Basic operations - default scopes
  'sheets_data.read': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Read spreadsheet values',
  },
  'sheets_data.write': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Write spreadsheet values',
  },
  'sheets_format.set_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Format cells',
  },
  'sheets_core.create': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Create new spreadsheet',
  },
  'sheets_core.get': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get spreadsheet metadata',
  },

  // Elevated operations - require full drive access
  'sheets_collaborate.share_add': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Share spreadsheet with others',
  },
  'sheets_collaborate.share_list': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List sharing permissions',
  },
  'sheets_collaborate.share_transfer_ownership': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Transfer spreadsheet ownership',
  },
  'sheets_collaborate.share_set_link': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Configure link sharing',
  },

  // Read-only operations
  'sheets_analyze.analyze_quality': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze data quality',
  },
  'sheets_analyze.analyze_data': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze data and compute statistics',
  },

  // Templates operations - require drive.appdata
  'sheets_templates.create': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Save template to app data folder',
  },
  'sheets_templates.get': {
    required: ['https://www.googleapis.com/auth/drive.appdata'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get template details',
  },
  'sheets_templates.list': {
    required: ['https://www.googleapis.com/auth/drive.appdata'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List available templates',
  },
  'sheets_templates.update': {
    required: ['https://www.googleapis.com/auth/drive.appdata'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Update template definition',
  },
  'sheets_templates.delete': {
    required: ['https://www.googleapis.com/auth/drive.appdata'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Delete template from app data folder',
  },
  'sheets_templates.apply': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Create spreadsheet from template',
  },
  'sheets_templates.preview': {
    required: ['https://www.googleapis.com/auth/drive.appdata'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Preview template structure',
  },
  'sheets_templates.import_builtin': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Import built-in template',
  },

  // Comment operations - require full drive access
  'sheets_collaborate.comment_add': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Add comment to cell or range',
  },
  'sheets_collaborate.comment_delete': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Delete comment',
  },
  'sheets_collaborate.comment_resolve': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Resolve comment thread',
  },
  'sheets_collaborate.comment_list': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List comments in spreadsheet',
  },

  // Version operations - require drive access
  'sheets_collaborate.version_list': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List version history',
  },
  'sheets_collaborate.version_restore': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Restore previous version',
  },
  'sheets_collaborate.version_get': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get specific version details',
  },

  // BigQuery operations - require BigQuery scopes
  'sheets_bigquery.export': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Export spreadsheet to BigQuery table',
  },
  'sheets_bigquery.import': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Import BigQuery results to spreadsheet',
  },
  'sheets_bigquery.query': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Execute BigQuery query and load results',
  },
  'sheets_bigquery.sync': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Sync spreadsheet with BigQuery table',
  },

  // Apps Script operations - require script.projects scope
  'sheets_appsscript.create_project': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.projects',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Create Apps Script project',
  },
  'sheets_appsscript.execute': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.projects',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Execute Apps Script function',
  },
  'sheets_appsscript.deploy': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Deploy Apps Script as web app or add-on',
  },
  'sheets_appsscript.manage': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Manage Apps Script project settings',
  },

  // Webhook operations - require drive access
  'sheets_webhook.register': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Register webhook for spreadsheet events',
  },
  'sheets_webhook.unregister': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Unregister webhook',
  },
  'sheets_webhook.list': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List registered webhooks',
  },
  'sheets_webhook.get': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get webhook details',
  },

  // Composite operations - may require drive access
  'sheets_composite.import_data': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Import data from external source',
  },
  'sheets_composite.export_data': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Export data to external format',
  },

  // Transaction operations (sheets_transaction) - remaining actions
  'sheets_transaction.queue': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Queue transaction operation',
  },
  'sheets_transaction.status': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get transaction status',
  },
  'sheets_transaction.list': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List transactions',
  },
  'sheets_transaction.begin': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Begin transaction',
  },
  'sheets_transaction.commit': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Commit transaction',
  },
  'sheets_transaction.rollback': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Rollback transaction',
  },

  // Advanced operations (sheets_advanced) - all require spreadsheets scope
  'sheets_advanced.add_named_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add named range',
  },
  'sheets_advanced.update_named_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update named range',
  },
  'sheets_advanced.delete_named_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete named range',
  },
  'sheets_advanced.list_named_ranges': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List named ranges',
  },
  'sheets_advanced.get_named_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get named range details',
  },
  'sheets_advanced.add_protected_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add protected range',
  },
  'sheets_advanced.update_protected_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update protected range',
  },
  'sheets_advanced.delete_protected_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete protected range',
  },
  'sheets_advanced.list_protected_ranges': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List protected ranges',
  },
  'sheets_advanced.set_metadata': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set developer metadata',
  },
  'sheets_advanced.get_metadata': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get developer metadata',
  },
  'sheets_advanced.delete_metadata': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete developer metadata',
  },
  'sheets_advanced.add_banding': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add banding to range',
  },
  'sheets_advanced.update_banding': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update banding',
  },
  'sheets_advanced.delete_banding': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete banding',
  },
  'sheets_advanced.list_banding': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List banding',
  },
  'sheets_advanced.create_table': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Create table',
  },
  'sheets_advanced.delete_table': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete table',
  },
  'sheets_advanced.list_tables': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List tables',
  },
  'sheets_advanced.update_table': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update table',
  },
  'sheets_advanced.rename_table_column': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Rename table column',
  },
  'sheets_advanced.set_table_column_properties': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set table column properties',
  },
  'sheets_advanced.add_person_chip': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add person chip',
  },
  'sheets_advanced.add_drive_chip': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add Drive file chip',
  },
  'sheets_advanced.add_rich_link_chip': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add rich link chip',
  },
  'sheets_advanced.list_chips': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List smart chips',
  },

  // Analyze operations (sheets_analyze) - all readonly
  'sheets_analyze.comprehensive': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Comprehensive data analysis',
  },
  'sheets_analyze.suggest_visualization': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Suggest visualization',
  },
  'sheets_analyze.generate_formula': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Generate formula',
  },
  'sheets_analyze.detect_patterns': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Detect data patterns',
  },
  'sheets_analyze.analyze_structure': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze spreadsheet structure',
  },
  'sheets_analyze.analyze_performance': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze performance',
  },
  'sheets_analyze.analyze_formulas': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze formulas',
  },
  'sheets_analyze.query_natural_language': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Query using natural language',
  },
  'sheets_analyze.explain_analysis': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Explain analysis',
  },
  'sheets_analyze.scout': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Scout spreadsheet',
  },
  'sheets_analyze.plan': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Plan analysis',
  },
  'sheets_analyze.execute_plan': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Execute analysis plan',
  },
  'sheets_analyze.drill_down': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Drill down into data',
  },
  'sheets_analyze.generate_actions': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Generate action suggestions',
  },

  // Core operations - remaining actions (not in original list)
  'sheets_core.copy': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Copy spreadsheet',
  },
  'sheets_core.update_properties': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update spreadsheet properties',
  },
  'sheets_core.get_url': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get spreadsheet URL',
  },
  'sheets_core.get_comprehensive': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get comprehensive spreadsheet data',
  },
  'sheets_core.list': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List spreadsheets',
  },
  'sheets_core.update_sheet': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update sheet properties',
  },
  'sheets_core.copy_sheet_to': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Copy sheet to another spreadsheet',
  },
  'sheets_core.list_sheets': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List sheets in spreadsheet',
  },
  'sheets_core.get_sheet': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get sheet details',
  },
  'sheets_core.batch_delete_sheets': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Batch delete sheets',
  },
  'sheets_core.batch_update_sheets': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Batch update sheets',
  },
  'sheets_core.add_sheet': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add new sheet/tab',
  },
  'sheets_core.delete_sheet': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete sheet/tab',
  },
  'sheets_core.duplicate_sheet': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Duplicate sheet/tab',
  },
  'sheets_core.batch_get': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Batch get spreadsheet metadata',
  },

  // Data operations - remaining actions (batch operations not in original list)
  'sheets_data.batch_read': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Batch read cell data',
  },
  'sheets_data.batch_write': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Batch write cell data',
  },
  'sheets_data.batch_clear': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Batch clear cell data',
  },
  'sheets_data.add_note': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add note to cell',
  },
  'sheets_data.get_note': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get cell note',
  },
  'sheets_data.clear_note': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear cell note',
  },
  'sheets_data.set_hyperlink': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set cell hyperlink',
  },
  'sheets_data.clear_hyperlink': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear cell hyperlink',
  },
  'sheets_data.get_merges': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get merged cell ranges',
  },
  'sheets_data.cut_paste': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Cut and paste data',
  },
  'sheets_data.append': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Append data to range',
  },
  'sheets_data.clear': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear range data',
  },
  'sheets_data.copy_paste': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Copy and paste data',
  },
  'sheets_data.find_replace': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Find and replace text',
  },
  'sheets_data.merge_cells': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Merge cells',
  },
  'sheets_data.unmerge_cells': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Unmerge cells',
  },

  // Format operations - remaining actions (not in original list)
  'sheets_format.suggest_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Suggest format',
  },
  'sheets_format.set_background': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set background color',
  },
  'sheets_format.set_text_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set text format',
  },
  'sheets_format.set_number_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set number format',
  },
  'sheets_format.set_alignment': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set cell alignment',
  },
  'sheets_format.set_borders': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set cell borders',
  },
  'sheets_format.clear_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear cell format',
  },
  'sheets_format.apply_preset': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Apply format preset',
  },
  'sheets_format.auto_fit': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Auto-fit columns',
  },
  'sheets_format.sparkline_add': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add sparkline',
  },
  'sheets_format.sparkline_get': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get sparkline',
  },
  'sheets_format.sparkline_clear': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear sparkline',
  },
  'sheets_format.rule_add_conditional_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add conditional format rule',
  },
  'sheets_format.rule_update_conditional_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update conditional format rule',
  },
  'sheets_format.rule_delete_conditional_format': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete conditional format rule',
  },
  'sheets_format.rule_list_conditional_formats': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List conditional format rules',
  },
  'sheets_format.set_data_validation': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set data validation',
  },
  'sheets_format.clear_data_validation': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear data validation',
  },
  'sheets_format.list_data_validations': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List data validations',
  },
  'sheets_format.add_conditional_format_rule': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add conditional format rule',
  },

  // Dimension operations - remaining actions
  'sheets_dimensions.insert': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Insert rows or columns',
  },
  'sheets_dimensions.delete': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete rows or columns',
  },
  'sheets_dimensions.move': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Move rows or columns',
  },
  'sheets_dimensions.resize': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Resize rows or columns',
  },
  'sheets_dimensions.auto_resize': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Auto-resize dimensions',
  },
  'sheets_dimensions.hide': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Hide rows or columns',
  },
  'sheets_dimensions.show': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Show rows or columns',
  },
  'sheets_dimensions.freeze': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Freeze rows or columns',
  },
  'sheets_dimensions.group': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Group rows or columns',
  },
  'sheets_dimensions.ungroup': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Ungroup rows or columns',
  },
  'sheets_dimensions.append': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Append rows',
  },
  'sheets_dimensions.set_basic_filter': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set basic filter',
  },
  'sheets_dimensions.clear_basic_filter': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear basic filter',
  },
  'sheets_dimensions.get_basic_filter': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get basic filter',
  },
  'sheets_dimensions.sort_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Sort range',
  },
  'sheets_dimensions.trim_whitespace': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Trim whitespace',
  },
  'sheets_dimensions.randomize_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Randomize range',
  },
  'sheets_dimensions.text_to_columns': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Convert text to columns',
  },
  'sheets_dimensions.auto_fill': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Auto-fill range',
  },
  'sheets_dimensions.create_filter_view': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Create filter view',
  },
  'sheets_dimensions.update_filter_view': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update filter view',
  },
  'sheets_dimensions.delete_filter_view': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete filter view',
  },
  'sheets_dimensions.list_filter_views': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List filter views',
  },
  'sheets_dimensions.get_filter_view': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get filter view',
  },
  'sheets_dimensions.create_slicer': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Create slicer',
  },
  'sheets_dimensions.update_slicer': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update slicer',
  },
  'sheets_dimensions.delete_slicer': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete slicer',
  },
  'sheets_dimensions.list_slicers': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List slicers',
  },

  // Visualize operations - remaining actions
  'sheets_visualize.chart_create': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Create chart',
  },
  'sheets_visualize.suggest_chart': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Suggest chart type',
  },
  'sheets_visualize.chart_update': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update chart',
  },
  'sheets_visualize.chart_delete': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete chart',
  },
  'sheets_visualize.chart_list': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List charts',
  },
  'sheets_visualize.chart_get': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get chart details',
  },
  'sheets_visualize.chart_move': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Move chart',
  },
  'sheets_visualize.chart_resize': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Resize chart',
  },
  'sheets_visualize.chart_update_data_range': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update chart data range',
  },
  'sheets_visualize.chart_add_trendline': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Add trendline to chart',
  },
  'sheets_visualize.chart_remove_trendline': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Remove chart trendline',
  },
  'sheets_visualize.pivot_create': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Create pivot table',
  },
  'sheets_visualize.suggest_pivot': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Suggest pivot table',
  },
  'sheets_visualize.pivot_update': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update pivot table',
  },
  'sheets_visualize.pivot_delete': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete pivot table',
  },
  'sheets_visualize.pivot_list': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List pivot tables',
  },
  'sheets_visualize.pivot_get': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get pivot table details',
  },
  'sheets_visualize.pivot_refresh': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Refresh pivot table',
  },

  // Collaborate operations - remaining actions
  'sheets_collaborate.share_update': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Update sharing permissions',
  },
  'sheets_collaborate.share_remove': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Remove sharing permissions',
  },
  'sheets_collaborate.share_get': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get sharing permission details',
  },
  'sheets_collaborate.share_get_link': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get link sharing settings',
  },
  'sheets_collaborate.comment_update': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Update comment',
  },
  'sheets_collaborate.comment_get': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get comment details',
  },
  'sheets_collaborate.comment_reopen': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Reopen comment thread',
  },
  'sheets_collaborate.comment_add_reply': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Add comment reply',
  },
  'sheets_collaborate.comment_update_reply': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Update comment reply',
  },
  'sheets_collaborate.comment_delete_reply': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Delete comment reply',
  },
  'sheets_collaborate.version_list_revisions': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List revision history',
  },
  'sheets_collaborate.version_get_revision': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get revision details',
  },
  'sheets_collaborate.version_restore_revision': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Restore revision',
  },
  'sheets_collaborate.version_keep_revision': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Keep revision permanently',
  },
  'sheets_collaborate.version_create_snapshot': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Create version snapshot',
  },
  'sheets_collaborate.version_snapshot_status': {
    required: [],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Check version snapshot task status',
  },
  'sheets_collaborate.version_list_snapshots': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List snapshots',
  },
  'sheets_collaborate.version_restore_snapshot': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Restore snapshot',
  },
  'sheets_collaborate.version_delete_snapshot': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Delete snapshot',
  },
  'sheets_collaborate.version_compare': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Compare versions',
  },
  'sheets_collaborate.version_export': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Export version',
  },
  'sheets_collaborate.approval_create': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Create approval request with protected range',
  },
  'sheets_collaborate.approval_approve': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Approve approval request',
  },
  'sheets_collaborate.approval_reject': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Reject approval request',
  },
  'sheets_collaborate.approval_get_status': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get approval status',
  },
  'sheets_collaborate.approval_list_pending': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List pending approvals',
  },
  'sheets_collaborate.approval_delegate': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Delegate approval to another user',
  },
  'sheets_collaborate.approval_cancel': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Cancel approval request',
  },

  // History operations - remaining actions
  'sheets_history.stats': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get history statistics',
  },
  'sheets_history.undo': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Undo last operation',
  },
  'sheets_history.redo': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Redo operation',
  },
  'sheets_history.revert_to': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Revert to specific operation',
  },
  'sheets_history.clear': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear history',
  },
  'sheets_history.list': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List operation history',
  },
  'sheets_history.get': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get operation details',
  },

  // Quality operations - remaining actions
  'sheets_quality.validate': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Validate data',
  },
  'sheets_quality.detect_conflicts': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Detect conflicts',
  },
  'sheets_quality.resolve_conflict': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Resolve conflict',
  },
  'sheets_quality.analyze_impact': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze change impact',
  },

  // Fix operations (sheets_fix)
  'sheets_fix.fix': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Apply suggested fix',
  },

  // Dependencies operations - remaining actions
  'sheets_dependencies.build': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Build dependency graph',
  },
  'sheets_dependencies.analyze_impact': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Analyze formula impact',
  },
  'sheets_dependencies.detect_cycles': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Detect circular references',
  },
  'sheets_dependencies.get_dependencies': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get formula dependencies',
  },
  'sheets_dependencies.get_dependents': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get formula dependents',
  },
  'sheets_dependencies.get_stats': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get dependency statistics',
  },
  'sheets_dependencies.export_dot': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Export dependency graph as DOT',
  },

  // Composite operations - remaining actions
  'sheets_composite.import_csv': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Import CSV data',
  },
  'sheets_composite.smart_append': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Smart append data',
  },
  'sheets_composite.bulk_update': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Bulk update cells',
  },
  'sheets_composite.deduplicate': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Deduplicate data',
  },
  'sheets_composite.export_xlsx': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Export to XLSX',
  },
  'sheets_composite.import_xlsx': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Import XLSX data',
  },
  'sheets_composite.get_form_responses': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get form responses',
  },
  'sheets_composite.setup_sheet': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Setup sheet structure',
  },
  'sheets_composite.import_and_format': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Import and format data',
  },
  'sheets_composite.clone_structure': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
    category: ScopeCategory.DRIVE_FILE,
    description: 'Clone sheet structure',
  },

  // Webhook operations - remaining actions
  'sheets_webhook.test': {
    required: ['https://www.googleapis.com/auth/drive'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Test webhook delivery',
  },
  'sheets_webhook.get_stats': {
    required: ['https://www.googleapis.com/auth/drive.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get webhook statistics',
  },

  // Apps Script operations - remaining actions
  'sheets_appsscript.create': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.projects',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Create Apps Script project',
  },
  'sheets_appsscript.get': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get Apps Script project',
  },
  'sheets_appsscript.get_content': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get Apps Script content',
  },
  'sheets_appsscript.update_content': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Update Apps Script content',
  },
  'sheets_appsscript.create_version': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Create Apps Script version',
  },
  'sheets_appsscript.list_versions': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List Apps Script versions',
  },
  'sheets_appsscript.get_version': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get Apps Script version',
  },
  'sheets_appsscript.list_deployments': {
    required: ['https://www.googleapis.com/auth/script.deployments.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List deployments',
  },
  'sheets_appsscript.get_deployment': {
    required: ['https://www.googleapis.com/auth/script.deployments.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get deployment details',
  },
  'sheets_appsscript.list_processes': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List running processes',
  },
  'sheets_appsscript.get_metrics': {
    required: ['https://www.googleapis.com/auth/script.projects'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get execution metrics',
  },

  // BigQuery operations - remaining actions
  'sheets_bigquery.connect': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Connect to BigQuery',
  },
  'sheets_bigquery.connect_looker': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Connect to Looker Studio',
  },
  'sheets_bigquery.disconnect': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Disconnect BigQuery connection',
  },
  'sheets_bigquery.list_connections': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'List BigQuery connections',
  },
  'sheets_bigquery.get_connection': {
    required: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    category: ScopeCategory.READONLY,
    description: 'Get BigQuery connection details',
  },
  'sheets_bigquery.preview': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/bigquery.readonly',
    ],
    category: ScopeCategory.READONLY,
    description: 'Preview BigQuery results',
  },
  'sheets_bigquery.refresh': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Refresh BigQuery data',
  },
  'sheets_bigquery.cancel_refresh': {
    required: ['https://www.googleapis.com/auth/spreadsheets'],
    category: ScopeCategory.SPREADSHEET,
    description: 'Cancel BigQuery refresh',
  },
  'sheets_bigquery.list_datasets': {
    required: ['https://www.googleapis.com/auth/bigquery.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List BigQuery datasets',
  },
  'sheets_bigquery.list_tables': {
    required: ['https://www.googleapis.com/auth/bigquery.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'List BigQuery tables',
  },
  'sheets_bigquery.get_table_schema': {
    required: ['https://www.googleapis.com/auth/bigquery.readonly'],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Get BigQuery table schema',
  },
  'sheets_bigquery.export_to_bigquery': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/bigquery',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Export to BigQuery table',
  },
  'sheets_bigquery.import_from_bigquery': {
    required: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/bigquery.readonly',
    ],
    category: ScopeCategory.DRIVE_FULL,
    description: 'Import from BigQuery',
  },

  // Auth operations - no Google API scopes needed (handled by auth flow)
  'sheets_auth.status': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get authentication status',
  },
  'sheets_auth.login': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Initiate login flow',
  },
  'sheets_auth.callback': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Handle OAuth callback',
  },
  'sheets_auth.logout': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Logout user',
  },

  // Confirm operations - no Google API scopes needed (MCP elicitation)
  'sheets_confirm.request': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Request user confirmation',
  },
  'sheets_confirm.get_stats': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get confirmation statistics',
  },
  'sheets_confirm.wizard_start': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Start confirmation wizard',
  },
  'sheets_confirm.wizard_step': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Progress wizard step',
  },
  'sheets_confirm.wizard_complete': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Complete wizard',
  },

  // Session operations - no Google API scopes needed (local state)
  'sheets_session.set_active': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set active spreadsheet',
  },
  'sheets_session.get_active': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get active spreadsheet',
  },
  'sheets_session.get_context': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get session context',
  },
  'sheets_session.record_operation': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Record operation',
  },
  'sheets_session.get_last_operation': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get last operation',
  },
  'sheets_session.get_history': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get operation history',
  },
  'sheets_session.find_by_reference': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Find by reference',
  },
  'sheets_session.update_preferences': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update preferences',
  },
  'sheets_session.get_preferences': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get preferences',
  },
  'sheets_session.set_pending': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set pending operation',
  },
  'sheets_session.get_pending': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get pending operation',
  },
  'sheets_session.clear_pending': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear pending operation',
  },
  'sheets_session.save_checkpoint': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Save checkpoint',
  },
  'sheets_session.load_checkpoint': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Load checkpoint',
  },
  'sheets_session.list_checkpoints': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'List checkpoints',
  },
  'sheets_session.delete_checkpoint': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Delete checkpoint',
  },
  'sheets_session.reset': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Reset session',
  },
  'sheets_session.get_alerts': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get session alerts',
  },
  'sheets_session.acknowledge_alert': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Acknowledge alert',
  },
  'sheets_session.clear_alerts': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Clear alerts',
  },
  'sheets_session.set_user_id': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Set user ID',
  },
  'sheets_session.get_profile': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get user profile',
  },
  'sheets_session.update_profile_preferences': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Update profile preferences',
  },
  'sheets_session.record_successful_formula': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Record successful formula',
  },
  'sheets_session.reject_suggestion': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Reject suggestion',
  },
  'sheets_session.get_top_formulas': {
    required: [],
    category: ScopeCategory.SPREADSHEET,
    description: 'Get top formulas',
  },
};

/**
 * Error thrown when additional scopes are required
 */
export class IncrementalScopeRequiredError extends Error {
  public readonly code = 'INCREMENTAL_SCOPE_REQUIRED';
  public readonly requiredScopes: string[];
  public readonly currentScopes: string[];
  public readonly missingScopes: string[];
  public readonly authorizationUrl: string;
  public readonly operation: string;
  public readonly category: ScopeCategory;
  public readonly retryable = true;

  constructor(options: {
    operation: string;
    requiredScopes: string[];
    currentScopes: string[];
    authorizationUrl: string;
    category: ScopeCategory;
    description?: string;
  }) {
    const missingScopes = options.requiredScopes.filter((s) => !options.currentScopes.includes(s));

    super(
      `Operation "${options.operation}" requires additional permissions. ` +
        `Missing scopes: ${missingScopes.join(', ')}. ` +
        `Please authorize at: ${options.authorizationUrl}`
    );

    this.name = 'IncrementalScopeRequiredError';
    this.operation = options.operation;
    this.requiredScopes = options.requiredScopes;
    this.currentScopes = options.currentScopes;
    this.missingScopes = missingScopes;
    this.authorizationUrl = options.authorizationUrl;
    this.category = options.category;
  }

  /**
   * Convert to MCP tool error response
   */
  toToolResponse(): {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: {
      error: string;
      code: string;
      operation: string;
      category: string;
      requiredScopes: string[];
      currentScopes: string[];
      missingScopes: string[];
      authorizationUrl: string;
      retryable: boolean;
      instructions: string;
    };
    isError: true;
  } {
    return {
      content: [
        {
          type: 'text',
          text: this.message,
        },
      ],
      structuredContent: {
        error: this.message,
        code: this.code,
        operation: this.operation,
        category: this.category,
        requiredScopes: this.requiredScopes,
        currentScopes: this.currentScopes,
        missingScopes: this.missingScopes,
        authorizationUrl: this.authorizationUrl,
        retryable: this.retryable,
        instructions:
          'To complete this operation, the user needs to grant additional permissions. ' +
          'Direct them to the authorization URL to approve the required scopes, then retry the operation.',
      },
      isError: true,
    };
  }
}

/**
 * Scope validator for checking operation permissions
 */
export class ScopeValidator {
  private oauthClient?: OAuth2Client;
  private currentScopes: string[] = [];
  private clientId?: string;
  private redirectUri?: string;

  constructor(options?: {
    oauthClient?: OAuth2Client;
    scopes?: string[];
    clientId?: string;
    redirectUri?: string;
  }) {
    this.oauthClient = options?.oauthClient;
    this.currentScopes = options?.scopes ?? [];
    this.clientId = options?.clientId;
    this.redirectUri = options?.redirectUri;
  }

  /**
   * Update current scopes (e.g., after token refresh)
   */
  setScopes(scopes: string[]): void {
    this.currentScopes = scopes;
  }

  /**
   * Update OAuth client
   */
  setOAuthClient(client: OAuth2Client): void {
    this.oauthClient = client;
  }

  /**
   * Check if current scopes satisfy operation requirements
   */
  hasRequiredScopes(operation: string): boolean {
    const opConfig = OPERATION_SCOPES[operation];
    if (!opConfig) {
      // Unknown operation - allow by default
      return true;
    }

    return opConfig.required.every(
      (scope) =>
        this.currentScopes.includes(scope) ||
        // Check for scope upgrades (readonly -> full)
        this.hasScopeUpgrade(scope)
    );
  }

  /**
   * Check if a broader scope covers the required scope
   */
  private hasScopeUpgrade(requiredScope: string): boolean {
    // Full drive covers drive.file
    if (
      requiredScope === 'https://www.googleapis.com/auth/drive.file' &&
      this.currentScopes.includes('https://www.googleapis.com/auth/drive')
    ) {
      return true;
    }

    // Full spreadsheets covers readonly
    if (
      requiredScope === 'https://www.googleapis.com/auth/spreadsheets.readonly' &&
      this.currentScopes.includes('https://www.googleapis.com/auth/spreadsheets')
    ) {
      return true;
    }

    // Full drive covers drive.readonly
    if (
      requiredScope === 'https://www.googleapis.com/auth/drive.readonly' &&
      this.currentScopes.includes('https://www.googleapis.com/auth/drive')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Get missing scopes for an operation
   */
  getMissingScopes(operation: string): string[] {
    const opConfig = OPERATION_SCOPES[operation];
    if (!opConfig) {
      return [];
    }

    return opConfig.required.filter(
      (scope) => !this.currentScopes.includes(scope) && !this.hasScopeUpgrade(scope)
    );
  }

  /**
   * Generate authorization URL for incremental consent
   */
  generateIncrementalAuthUrl(additionalScopes: string[]): string {
    if (!this.oauthClient) {
      // Fall back to manual URL construction
      const params = new URLSearchParams({
        client_id: this.clientId ?? process.env['GOOGLE_CLIENT_ID'] ?? '',
        redirect_uri:
          this.redirectUri ??
          process.env['GOOGLE_REDIRECT_URI'] ??
          'http://localhost:3000/oauth/callback',
        response_type: 'code',
        scope: [...this.currentScopes, ...additionalScopes].join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true', // Key for incremental consent
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    return this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      scope: [...this.currentScopes, ...additionalScopes],
      prompt: 'consent',
      include_granted_scopes: true, // Google-specific: include previously granted scopes
    });
  }

  /**
   * Validate operation and throw if scopes insufficient
   */
  validateOperation(operation: string): void {
    if (this.hasRequiredScopes(operation)) {
      return;
    }

    const opConfig = OPERATION_SCOPES[operation];
    if (!opConfig) {
      return; // Unknown operation, allow
    }

    const missingScopes = this.getMissingScopes(operation);
    const authUrl = this.generateIncrementalAuthUrl(missingScopes);

    logger.info('Incremental scope required', {
      operation,
      category: opConfig.category,
      missingScopes,
      currentScopes: this.currentScopes,
    });

    throw new IncrementalScopeRequiredError({
      operation,
      requiredScopes: opConfig.required,
      currentScopes: this.currentScopes,
      authorizationUrl: authUrl,
      category: opConfig.category,
      description: opConfig.description,
    });
  }

  /**
   * Get scope requirements for an operation
   */
  getOperationRequirements(operation: string): {
    required: string[];
    category: ScopeCategory;
    description: string;
    satisfied: boolean;
    missing: string[];
  } | null {
    const opConfig = OPERATION_SCOPES[operation];
    if (!opConfig) {
      return null;
    }

    return {
      ...opConfig,
      satisfied: this.hasRequiredScopes(operation),
      missing: this.getMissingScopes(operation),
    };
  }

  /**
   * Get all operations that can be performed with current scopes
   */
  getAvailableOperations(): string[] {
    return Object.keys(OPERATION_SCOPES).filter((op) => this.hasRequiredScopes(op));
  }

  /**
   * Get operations that require additional scopes
   */
  getRestrictedOperations(): Array<{
    operation: string;
    category: ScopeCategory;
    missingScopes: string[];
  }> {
    return Object.entries(OPERATION_SCOPES)
      .filter(([op]) => !this.hasRequiredScopes(op))
      .map(([op, config]) => ({
        operation: op,
        category: config.category,
        missingScopes: this.getMissingScopes(op),
      }));
  }

  /**
   * Get recommended scope set based on intended operations
   */
  static getRecommendedScopes(operations: string[]): string[] {
    const scopes = new Set<string>();

    for (const op of operations) {
      const config = OPERATION_SCOPES[op];
      if (config) {
        config.required.forEach((s) => scopes.add(s));
      }
    }

    // Default to basic scopes if nothing specific requested
    if (scopes.size === 0) {
      DEFAULT_SCOPES.forEach((s) => scopes.add(s));
    }

    return Array.from(scopes);
  }
}

/**
 * Create a scope validator from auth context
 */
export function createScopeValidator(authContext?: {
  scopes?: string[];
  oauthClient?: OAuth2Client;
}): ScopeValidator {
  return new ScopeValidator({
    scopes: authContext?.scopes,
    oauthClient: authContext?.oauthClient,
  });
}

/**
 * Middleware-style scope check for handlers
 */
export function requireScopes(operation: string, validator: ScopeValidator): void {
  validator.validateOperation(operation);
}

/**
 * Check if error is an incremental scope error
 */
export function isIncrementalScopeError(error: unknown): error is IncrementalScopeRequiredError {
  return error instanceof IncrementalScopeRequiredError;
}
