#!/usr/bin/env node
/**
 * ServalSheets Comprehensive Test Runner
 *
 * Tests every tool and action systematically, logs failures,
 * and generates a report for fixing issues.
 *
 * Usage: node test-runner.js [spreadsheetId]
 */

const TEST_SPREADSHEET_ID = process.argv[2] || '1GGSb44zvzRa6z7z7q6CrfGj94ALeZEbXb9AGA_wRkQA';

// Tool action fixtures for manual end-to-end testing
const TOOL_DEFINITIONS = {
  sheets_auth: {
    actions: ['status', 'login', 'callback', 'logout'],
    testCases: {
      status: { action: 'status' },
      login: { action: 'login' },
      // callback requires code, logout needs auth
    },
  },

  sheets_core: {
    actions: [
      'get',
      'create',
      'copy',
      'update_properties',
      'get_url',
      'batch_get',
      'get_comprehensive',
      'list',
      'add_sheet',
      'delete_sheet',
      'duplicate_sheet',
      'update_sheet',
      'copy_sheet_to',
      'list_sheets',
      'get_sheet',
    ],
    testCases: {
      get: { action: 'get', spreadsheetId: TEST_SPREADSHEET_ID },
      get_url: { action: 'get_url', spreadsheetId: TEST_SPREADSHEET_ID },
      list_sheets: { action: 'list_sheets', spreadsheetId: TEST_SPREADSHEET_ID },
      get_sheet: { action: 'get_sheet', spreadsheetId: TEST_SPREADSHEET_ID, sheetId: 866521814 },
      list: { action: 'list', query: 'test' },
    },
  },

  sheets_data: {
    actions: [
      'read',
      'write',
      'append',
      'clear',
      'batch_read',
      'batch_write',
      'batch_clear',
      'find',
      'replace', // Note: find_replace in schema vs find/replace in registry
      'add_note',
      'get_note',
      'clear_note',
      'set_validation',
      'clear_validation',
      'set_hyperlink',
      'clear_hyperlink',
      'merge',
      'unmerge',
      'get_merges', // Note: merge_cells/unmerge_cells in schema
      'cut',
      'copy', // Note: cut_paste/copy_paste in schema
    ],
    testCases: {
      read: {
        action: 'read',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: { a1: "'Claude Cache'!A1:E10" },
      },
      batch_read: {
        action: 'batch_read',
        spreadsheetId: TEST_SPREADSHEET_ID,
        ranges: [{ a1: "'Claude Cache'!A1:C5" }, { a1: "'Claude Cache'!D1:F5" }],
      },
      get_note: {
        action: 'get_note',
        spreadsheetId: TEST_SPREADSHEET_ID,
        cell: "'Claude Cache'!A1",
      },
      get_merges: {
        action: 'get_merges',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 866521814,
      },
    },
  },

  sheets_format: {
    actions: [
      'set_format',
      'set_background',
      'set_text_format',
      'set_number_format',
      'set_alignment',
      'set_borders',
      'clear_format',
      'apply_preset',
      'auto_fit',
      // Conditional formatting rules
      'rule_add_conditional_format',
      'rule_update_conditional_format',
      'rule_delete_conditional_format',
      'rule_list_conditional_formats',
      // Data validation rules
      'rule_add_data_validation',
      'rule_clear_data_validation',
      'rule_list_data_validations',
      'rule_add_preset_rule',
      // Suggest
      'suggest_format',
    ],
    testCases: {
      suggest_format: {
        action: 'suggest_format',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: { a1: "'Claude Cache'!A1:E10" },
      },
    },
  },

  sheets_dimensions: {
    actions: [
      'insert_rows',
      'insert_columns',
      'delete_rows',
      'delete_columns',
      'move_rows',
      'move_columns',
      'resize_rows',
      'resize_columns',
      'auto_resize',
      'hide_rows',
      'hide_columns',
      'show_rows',
      'show_columns',
      'freeze_rows',
      'freeze_columns',
      'group_rows',
      'group_columns',
      'ungroup_rows',
      'ungroup_columns',
      'append_rows',
      'append_columns',
      // Filters
      'filter_set_basic_filter',
      'filter_clear_basic_filter',
      'filter_get_basic_filter',
      'filter_update_filter_criteria',
      // Filter views
      'filter_create_filter_view',
      'filter_update_filter_view',
      'filter_delete_filter_view',
      'filter_list_filter_views',
      'filter_get_filter_view',
      // Sort
      'filter_sort_range',
      // Slicers
      'filter_create_slicer',
      'filter_update_slicer',
      'filter_delete_slicer',
      'filter_list_slicers',
    ],
    testCases: {
      filter_get_basic_filter: {
        action: 'filter_get_basic_filter',
        spreadsheetId: TEST_SPREADSHEET_ID,
        sheetId: 866521814,
      },
    },
  },

  sheets_visualize: {
    actions: [
      'chart_create',
      'suggest_chart',
      'chart_update',
      'chart_delete',
      'chart_list',
      'chart_get',
      'chart_move',
      'chart_resize',
      'chart_update_data_range',
      'chart_export',
      'pivot_create',
      'suggest_pivot',
      'pivot_update',
      'pivot_delete',
      'pivot_list',
      'pivot_get',
      'pivot_refresh',
    ],
    testCases: {
      chart_list: { action: 'chart_list', spreadsheetId: TEST_SPREADSHEET_ID },
      pivot_list: { action: 'pivot_list', spreadsheetId: TEST_SPREADSHEET_ID },
      suggest_chart: {
        action: 'suggest_chart',
        spreadsheetId: TEST_SPREADSHEET_ID,
        range: { a1: "'Claude Cache'!A1:E20" },
      },
    },
  },

  sheets_collaborate: {
    actions: [
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
      'version_list_snapshots',
      'version_restore_snapshot',
      'version_delete_snapshot',
      'version_compare',
      'version_export',
    ],
    testCases: {
      share_list: { action: 'share_list', spreadsheetId: TEST_SPREADSHEET_ID },
      share_get_link: { action: 'share_get_link', spreadsheetId: TEST_SPREADSHEET_ID },
      comment_list: { action: 'comment_list', spreadsheetId: TEST_SPREADSHEET_ID },
      version_list_revisions: {
        action: 'version_list_revisions',
        spreadsheetId: TEST_SPREADSHEET_ID,
      },
      version_list_snapshots: {
        action: 'version_list_snapshots',
        spreadsheetId: TEST_SPREADSHEET_ID,
      },
    },
  },

  sheets_advanced: {
    actions: [
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
      // Formula intelligence
      'formula_generate',
      'formula_suggest',
      'formula_explain',
      'formula_optimize',
      'formula_fix',
      'formula_trace_precedents',
      'formula_trace_dependents',
      'formula_manage_named_ranges',
    ],
    testCases: {
      list_named_ranges: { action: 'list_named_ranges', spreadsheetId: TEST_SPREADSHEET_ID },
      list_protected_ranges: {
        action: 'list_protected_ranges',
        spreadsheetId: TEST_SPREADSHEET_ID,
      },
      list_banding: { action: 'list_banding', spreadsheetId: TEST_SPREADSHEET_ID },
      list_tables: { action: 'list_tables', spreadsheetId: TEST_SPREADSHEET_ID },
    },
  },

  sheets_transaction: {
    actions: ['begin', 'queue', 'commit', 'rollback', 'status', 'list'],
    testCases: {
      list: { action: 'list' },
      begin: { action: 'begin', spreadsheetId: TEST_SPREADSHEET_ID },
    },
  },

  sheets_quality: {
    actions: ['validate', 'detect_conflicts', 'resolve_conflict', 'analyze_impact'],
    testCases: {
      detect_conflicts: { action: 'detect_conflicts', spreadsheetId: TEST_SPREADSHEET_ID },
      validate: {
        action: 'validate',
        value: 'test@email.com',
        rules: ['not_empty', 'valid_email'],
      },
    },
  },

  sheets_history: {
    actions: ['list', 'get', 'stats', 'undo', 'redo', 'revert_to', 'clear'],
    testCases: {
      list: { action: 'list', spreadsheetId: TEST_SPREADSHEET_ID },
      stats: { action: 'stats', spreadsheetId: TEST_SPREADSHEET_ID },
    },
  },

  sheets_confirm: {
    actions: ['request', 'get_stats'],
    testCases: {
      get_stats: { request: { action: 'get_stats' } },
    },
  },

  sheets_analyze: {
    actions: [
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
    ],
    testCases: {
      comprehensive: { action: 'comprehensive', spreadsheetId: TEST_SPREADSHEET_ID },
      analyze_structure: { action: 'analyze_structure', spreadsheetId: TEST_SPREADSHEET_ID },
      analyze_quality: { action: 'analyze_quality', spreadsheetId: TEST_SPREADSHEET_ID },
    },
  },

  sheets_fix: {
    actions: ['fix'],
    testCases: {
      fix: {
        action: 'fix',
        spreadsheetId: TEST_SPREADSHEET_ID,
        mode: 'preview',
        issues: [],
      },
    },
  },

  sheets_composite: {
    actions: ['import_csv', 'smart_append', 'bulk_update', 'deduplicate'],
    testCases: {
      // These are destructive, skip in read-only test
    },
  },

  sheets_session: {
    actions: [
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
      'reset',
    ],
    testCases: {
      get_context: { action: 'get_context' },
      get_active: { action: 'get_active' },
      get_preferences: { action: 'get_preferences' },
    },
  },
};

// Calculate totals
function calculateTotals() {
  let totalTools = 0;
  let totalActions = 0;
  let totalTestCases = 0;

  for (const [tool, def] of Object.entries(TOOL_DEFINITIONS)) {
    totalTools++;
    totalActions += def.actions.length;
    totalTestCases += Object.keys(def.testCases || {}).length;
  }

  return { totalTools, totalActions, totalTestCases };
}

// Export for use
module.exports = { TOOL_DEFINITIONS, TEST_SPREADSHEET_ID, calculateTotals };

// If run directly, print summary
if (require.main === module) {
  const totals = calculateTotals();
  console.log('ServalSheets Test Definition Summary');
  console.log('====================================');
  console.log(`Total Tools: ${totals.totalTools}`);
  console.log(`Total Actions: ${totals.totalActions}`);
  console.log(`Test Cases Defined: ${totals.totalTestCases}`);
  console.log('');
  console.log('Tools and Actions:');
  for (const [tool, def] of Object.entries(TOOL_DEFINITIONS)) {
    console.log(
      `  ${tool}: ${def.actions.length} actions, ${Object.keys(def.testCases || {}).length} test cases`
    );
  }
}
