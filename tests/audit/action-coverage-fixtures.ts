/**
 * ServalSheets - Action Coverage Fixtures
 *
 * Auto-generates minimal valid + invalid inputs for ALL actions across ALL tools.
 * Source of truth: TOOL_ACTIONS from src/mcp/completions.ts
 *
 * Design:
 *   - Each action gets { tool, action, validInput, invalidInput, requiredFields }
 *   - validInput always includes spreadsheetId: 'test-id' (unless auth/session/etc.)
 *   - invalidInput omits the action field (guaranteed validation failure)
 *   - Complex actions get manual overrides via FIXTURE_OVERRIDES
 *   - When new actions are added to TOOL_ACTIONS, fixtures auto-appear
 */

import { TOOL_ACTIONS } from '../../src/mcp/completions.js';

// ─── Types ──────────────────────────────────────────────────

export interface ActionFixture {
  tool: string;
  action: string;
  validInput: Record<string, unknown>;
  invalidInput: Record<string, unknown>;
  requiredFields: string[];
  /** Actions that don't need spreadsheetId */
  noSpreadsheet?: boolean;
}

// ─── Tools that don't require spreadsheetId ─────────────────

const NO_SPREADSHEET_TOOLS = new Set([
  'sheets_auth',
  'sheets_session',
  'sheets_confirm',
  'sheets_transaction',
  'sheets_quality',
  'sheets_federation',
  'sheets_agent',
  'sheets_connectors',
]);

// Actions within spreadsheet-requiring tools that don't need spreadsheetId
const NO_SPREADSHEET_ACTIONS: Record<string, Set<string>> = {
  sheets_core: new Set(['create', 'list']),
  sheets_templates: new Set(['list', 'import_builtin']),
  sheets_composite: new Set(['import_csv']),
  sheets_analyze: new Set(['explain_analysis']),
};

// ─── Fixture Overrides (complex actions needing extra params) ────

type PartialFixture = Partial<Pick<ActionFixture, 'validInput' | 'requiredFields'>>;

/**
 * Manual overrides for actions that need more than just { action, spreadsheetId }.
 * Only override what's necessary — the generator fills defaults.
 */
const FIXTURE_OVERRIDES: Record<string, Record<string, PartialFixture>> = {
  sheets_data: {
    read: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    write: {
      validInput: { range: 'Sheet1!A1:B2', values: [['a', 'b']] },
      requiredFields: ['spreadsheetId', 'range', 'values'],
    },
    append: {
      validInput: { range: 'Sheet1!A1:B1', values: [['new']] },
      requiredFields: ['spreadsheetId', 'range', 'values'],
    },
    clear: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    batch_read: {
      validInput: { ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5'] },
      requiredFields: ['spreadsheetId', 'ranges'],
    },
    batch_write: {
      validInput: { data: [{ range: 'Sheet1!A1:B1', values: [['a', 'b']] }] },
      requiredFields: ['spreadsheetId', 'data'],
    },
    batch_clear: {
      validInput: { ranges: ['Sheet1!A1:B2'] },
      requiredFields: ['spreadsheetId', 'ranges'],
    },
    find_replace: {
      validInput: { find: 'old', replacement: 'new' },
      requiredFields: ['spreadsheetId', 'find'],
    },
    add_note: {
      validInput: { cell: 'A1', note: 'test note' },
      requiredFields: ['spreadsheetId', 'cell', 'note'],
    },
    get_note: {
      validInput: { cell: 'A1' },
      requiredFields: ['spreadsheetId', 'cell'],
    },
    clear_note: {
      validInput: { cell: 'A1' },
      requiredFields: ['spreadsheetId', 'cell'],
    },
    set_hyperlink: {
      validInput: { cell: 'A1', url: 'https://example.com' },
      requiredFields: ['spreadsheetId', 'cell', 'url'],
    },
    clear_hyperlink: {
      validInput: { cell: 'A1' },
      requiredFields: ['spreadsheetId', 'cell'],
    },
    merge_cells: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    unmerge_cells: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    get_merges: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    cut_paste: {
      validInput: { source: 'Sheet1!A1:B2', destination: 'Sheet1!C1' },
      requiredFields: ['spreadsheetId', 'source', 'destination'],
    },
    copy_paste: {
      validInput: { source: 'Sheet1!A1:B2', destination: 'Sheet1!C1' },
      requiredFields: ['spreadsheetId', 'source', 'destination'],
    },
    smart_fill: {
      validInput: { sourceRange: 'Sheet1!A1:A5', fillRange: 'Sheet1!A6:A10' },
      requiredFields: ['spreadsheetId', 'sourceRange', 'fillRange'],
    },
    detect_spill_ranges: {
      requiredFields: ['spreadsheetId'],
    },
    cross_read: {
      validInput: { sources: [{ spreadsheetId: 'id1', range: 'Sheet1!A1:D10' }, { spreadsheetId: 'id2', range: 'Sheet1!A1:D10' }] },
      requiredFields: ['sources'],
    },
    cross_query: {
      validInput: { sources: [{ spreadsheetId: 'id1', range: 'Sheet1!A1:D10' }], query: 'revenue' },
      requiredFields: ['sources', 'query'],
    },
    cross_write: {
      validInput: { source: { spreadsheetId: 'id1', range: 'Sheet1!A1:D10' }, destination: { spreadsheetId: 'id2', range: 'Sheet1!A1' } },
      requiredFields: ['source', 'destination'],
    },
    cross_compare: {
      validInput: { source1: { spreadsheetId: 'id1', range: 'Sheet1!A1:D10' }, source2: { spreadsheetId: 'id2', range: 'Sheet1!A1:D10' } },
      requiredFields: ['source1', 'source2'],
    },
    smart_fill: {
      validInput: { sourceRange: 'Sheet1!A1:A5', fillRange: 'Sheet1!A6:A20' },
      requiredFields: ['spreadsheetId', 'sourceRange', 'fillRange'],
    },
    auto_fill: {
      validInput: { sourceRange: 'Sheet1!A1:A5', fillRange: 'Sheet1!A6:A20' },
      requiredFields: ['spreadsheetId', 'sourceRange', 'fillRange'],
    },
  },

  sheets_core: {
    get: { requiredFields: ['spreadsheetId'] },
    create: {
      validInput: { title: 'New Sheet' },
      requiredFields: ['title'],
    },
    copy: { requiredFields: ['spreadsheetId'] },
    update_properties: {
      validInput: { title: 'Updated Title' },
      requiredFields: ['spreadsheetId'],
    },
    get_url: { requiredFields: ['spreadsheetId'] },
    batch_get: {
      validInput: { spreadsheetIds: ['id1', 'id2'] },
      requiredFields: ['spreadsheetIds'],
    },
    get_comprehensive: { requiredFields: ['spreadsheetId'] },
    list: { requiredFields: [] },
    add_sheet: {
      validInput: { title: 'NewSheet' },
      requiredFields: ['spreadsheetId'],
    },
    delete_sheet: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    duplicate_sheet: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    update_sheet: {
      validInput: { sheetId: 0, title: 'Renamed' },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    copy_sheet_to: {
      validInput: { sheetId: 0, destinationSpreadsheetId: 'dest-id' },
      requiredFields: ['spreadsheetId', 'sheetId', 'destinationSpreadsheetId'],
    },
    list_sheets: { requiredFields: ['spreadsheetId'] },
    get_sheet: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId'],
    },
    batch_delete_sheets: {
      validInput: { sheetIds: [1, 2] },
      requiredFields: ['spreadsheetId', 'sheetIds'],
    },
    batch_update_sheets: {
      validInput: { updates: [{ sheetId: 0, title: 'A' }] },
      requiredFields: ['spreadsheetId', 'updates'],
    },
    clear_sheet: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId'],
    },
    move_sheet: {
      validInput: { sheetId: 0, newIndex: 1 },
      requiredFields: ['spreadsheetId', 'sheetId', 'newIndex'],
    },
  },

  sheets_format: {
    set_format: {
      validInput: { range: 'Sheet1!A1:B2', format: { backgroundColor: { red: 1 } } },
      requiredFields: ['spreadsheetId', 'range', 'format'],
    },
    suggest_format: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    set_background: {
      validInput: { range: 'Sheet1!A1:B2', color: '#FF0000' },
      requiredFields: ['spreadsheetId', 'range', 'color'],
    },
    set_text_format: {
      validInput: { range: 'Sheet1!A1:B2', textFormat: { bold: true } },
      requiredFields: ['spreadsheetId', 'range'],
    },
    set_number_format: {
      validInput: { range: 'Sheet1!A1:B2', numberFormat: { type: 'NUMBER' } },
      requiredFields: ['spreadsheetId', 'range'],
    },
    set_alignment: {
      validInput: { range: 'Sheet1!A1:B2', horizontal: 'CENTER' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    set_borders: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    clear_format: {
      validInput: { range: 'Sheet1!A1:B2' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    apply_preset: {
      validInput: { range: 'Sheet1!A1:D10', preset: 'header_row' },
      requiredFields: ['spreadsheetId', 'range', 'preset'],
    },
    auto_fit: {
      validInput: { sheetId: 0, dimension: 'COLUMNS' },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    sparkline_add: {
      validInput: { targetCell: 'A1', dataRange: 'B1:B10' },
      requiredFields: ['spreadsheetId', 'targetCell', 'dataRange'],
    },
    sparkline_get: {
      validInput: { cell: 'A1' },
      requiredFields: ['spreadsheetId'],
    },
    sparkline_clear: {
      validInput: { cell: 'A1' },
      requiredFields: ['spreadsheetId'],
    },
    rule_add_conditional_format: {
      validInput: { sheetId: 0, range: 'Sheet1!A1:A10', rule: { type: 'boolean', condition: { type: 'CUSTOM_FORMULA', values: ['=TRUE'] }, format: { backgroundColor: { red: 1 } } } },
      requiredFields: ['spreadsheetId', 'sheetId', 'range', 'rule'],
    },
    rule_update_conditional_format: {
      validInput: { sheetId: 0, ruleIndex: 0, rule: { type: 'boolean', condition: { type: 'CUSTOM_FORMULA', values: ['=TRUE'] }, format: { backgroundColor: { red: 1 } } } },
      requiredFields: ['spreadsheetId', 'sheetId', 'ruleIndex', 'rule'],
    },
    rule_delete_conditional_format: {
      validInput: { sheetId: 0, ruleIndex: 0 },
      requiredFields: ['spreadsheetId', 'sheetId', 'ruleIndex'],
    },
    rule_list_conditional_formats: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    set_data_validation: {
      validInput: { range: 'Sheet1!A1:A10', condition: { type: 'ONE_OF_LIST', values: ['A', 'B'] } },
      requiredFields: ['spreadsheetId', 'range', 'condition'],
    },
    clear_data_validation: {
      validInput: { range: 'Sheet1!A1:A10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    list_data_validations: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    add_conditional_format_rule: {
      validInput: { sheetId: 0, range: 'Sheet1!A1:A10', rulePreset: 'highlight_duplicates' },
      requiredFields: ['spreadsheetId', 'sheetId', 'range', 'rulePreset'],
    },
    batch_format: {
      validInput: { operations: [{ type: 'text_format', range: 'A1:B2', textFormat: { bold: true } }] },
      requiredFields: ['spreadsheetId', 'operations'],
    },
    set_rich_text: {
      validInput: { cell: 'A1', runs: [{ text: 'Hello' }] },
      requiredFields: ['spreadsheetId', 'cell', 'runs'],
    },
    generate_conditional_format: {
      validInput: { sheetId: 0, range: 'Sheet1!A1:A10', description: 'highlight values > 100' },
      requiredFields: ['spreadsheetId', 'sheetId', 'range', 'description'],
    },
    build_dependent_dropdown: {
      validInput: { parentRange: 'Sheet1!A2:A100', dependentRange: 'Sheet1!B2:B100', lookupSheet: 'Lookup' },
      requiredFields: ['spreadsheetId', 'parentRange', 'dependentRange', 'lookupSheet'],
    },
  },

  sheets_dimensions: {
    insert: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, count: 1 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex'],
    },
    delete: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex'],
    },
    move: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 5, destinationIndex: 10 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex', 'destinationIndex'],
    },
    resize: {
      validInput: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 1, pixelSize: 120 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex', 'pixelSize'],
    },
    auto_resize: {
      validInput: { sheetId: 0, dimension: 'COLUMNS' },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    hide: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex'],
    },
    show: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex'],
    },
    freeze: {
      validInput: { sheetId: 0, dimension: 'ROWS', count: 1 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'count'],
    },
    group: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 5 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex'],
    },
    ungroup: {
      validInput: { sheetId: 0, dimension: 'ROWS', startIndex: 0, endIndex: 5 },
      requiredFields: ['spreadsheetId', 'sheetId', 'dimension', 'startIndex', 'endIndex'],
    },
    append: {
      validInput: { sheetId: 0, dimension: 'ROWS', count: 5 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    set_basic_filter: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    clear_basic_filter: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    get_basic_filter: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    sort_range: {
      validInput: { range: 'Sheet1!A1:D10', sortSpecs: [{ columnIndex: 0 }] },
      requiredFields: ['spreadsheetId', 'range', 'sortSpecs'],
    },
    delete_duplicates: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    trim_whitespace: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    randomize_range: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    text_to_columns: {
      validInput: { range: 'Sheet1!A1:A10', source: 'Sheet1!A1:A10', delimiterType: 'COMMA' },
      requiredFields: ['spreadsheetId', 'range', 'source'],
    },
    auto_fill: {
      validInput: { sourceRange: 'Sheet1!A1:A5', fillLength: 10 },
      requiredFields: ['spreadsheetId', 'sourceRange'],
    },
    create_filter_view: {
      validInput: { range: 'Sheet1!A1:D10', title: 'My Filter' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    duplicate_filter_view: {
      validInput: { filterViewId: 123 },
      requiredFields: ['spreadsheetId', 'filterViewId'],
    },
    update_filter_view: {
      validInput: { filterViewId: 123 },
      requiredFields: ['spreadsheetId', 'filterViewId'],
    },
    delete_filter_view: {
      validInput: { filterViewId: 123 },
      requiredFields: ['spreadsheetId', 'filterViewId'],
    },
    list_filter_views: {
      requiredFields: ['spreadsheetId'],
    },
    get_filter_view: {
      validInput: { filterViewId: 123 },
      requiredFields: ['spreadsheetId', 'filterViewId'],
    },
    create_slicer: {
      validInput: { sheetId: 0, dataRange: 'Sheet1!A1:D10', filterColumn: 0, position: { anchorCell: 'P1', width: 200, height: 150 } },
      requiredFields: ['spreadsheetId', 'sheetId', 'dataRange', 'filterColumn', 'position'],
    },
    update_slicer: {
      validInput: { slicerId: 1 },
      requiredFields: ['spreadsheetId', 'slicerId'],
    },
    delete_slicer: {
      validInput: { slicerId: 1 },
      requiredFields: ['spreadsheetId', 'slicerId'],
    },
    list_slicers: {
      requiredFields: ['spreadsheetId'],
    },
    delete_duplicates: {
      validInput: { range: 'Sheet1!A1:D100' },
      requiredFields: ['spreadsheetId', 'range'],
    },
  },

  sheets_visualize: {
    chart_create: {
      validInput: { sheetId: 0, chartType: 'BAR', data: { sourceRange: 'Sheet1!A1:D10' }, position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 4 } } } },
      requiredFields: ['spreadsheetId', 'sheetId', 'chartType', 'data', 'position'],
    },
    suggest_chart: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    chart_update: {
      validInput: { chartId: 1, options: {} },
      requiredFields: ['spreadsheetId', 'chartId'],
    },
    chart_delete: {
      validInput: { chartId: 1 },
      requiredFields: ['spreadsheetId', 'chartId'],
    },
    chart_list: { requiredFields: ['spreadsheetId'] },
    chart_get: {
      validInput: { chartId: 1 },
      requiredFields: ['spreadsheetId', 'chartId'],
    },
    chart_move: {
      validInput: { chartId: 1, position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 4 } } } },
      requiredFields: ['spreadsheetId', 'chartId', 'position'],
    },
    chart_resize: {
      validInput: { chartId: 1, width: 600, height: 400 },
      requiredFields: ['spreadsheetId', 'chartId'],
    },
    chart_update_data_range: {
      validInput: { chartId: 1, data: { sourceRange: 'Sheet1!A1:D10' } },
      requiredFields: ['spreadsheetId', 'chartId', 'data'],
    },
    chart_add_trendline: {
      validInput: { chartId: 1, seriesIndex: 0, trendline: { type: 'LINEAR' } },
      requiredFields: ['spreadsheetId', 'chartId', 'seriesIndex', 'trendline'],
    },
    chart_remove_trendline: {
      validInput: { chartId: 1, seriesIndex: 0 },
      requiredFields: ['spreadsheetId', 'chartId'],
    },
    pivot_create: {
      validInput: { sourceRange: 'Sheet1!A1:D10', rows: [{ sourceColumnOffset: 0 }], values: [{ sourceColumnOffset: 1, summarizeFunction: 'SUM' }] },
      requiredFields: ['spreadsheetId', 'sourceRange', 'values'],
    },
    suggest_pivot: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    pivot_update: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    pivot_delete: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    pivot_list: { requiredFields: ['spreadsheetId'] },
    pivot_get: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
    pivot_refresh: {
      validInput: { sheetId: 0 },
      requiredFields: ['spreadsheetId', 'sheetId'],
    },
  },

  sheets_collaborate: {
    share_add: {
      validInput: { emailAddress: 'user@test.com', role: 'writer', type: 'user' },
      requiredFields: ['spreadsheetId', 'emailAddress', 'role', 'type'],
    },
    share_update: {
      validInput: { permissionId: 'perm1', role: 'reader' },
      requiredFields: ['spreadsheetId', 'permissionId', 'role'],
    },
    share_remove: {
      validInput: { permissionId: 'perm1' },
      requiredFields: ['spreadsheetId', 'permissionId'],
    },
    share_list: { requiredFields: ['spreadsheetId'] },
    share_get: {
      validInput: { permissionId: 'perm1' },
      requiredFields: ['spreadsheetId', 'permissionId'],
    },
    share_transfer_ownership: {
      validInput: { newOwnerEmail: 'owner@test.com' },
      requiredFields: ['spreadsheetId', 'newOwnerEmail'],
    },
    share_set_link: {
      validInput: { role: 'reader', enabled: true },
      requiredFields: ['spreadsheetId', 'enabled'],
    },
    share_get_link: { requiredFields: ['spreadsheetId'] },
    comment_add: {
      validInput: { content: 'test comment' },
      requiredFields: ['spreadsheetId', 'content'],
    },
    comment_update: {
      validInput: { commentId: 'c1', content: 'updated' },
      requiredFields: ['spreadsheetId', 'commentId', 'content'],
    },
    comment_delete: {
      validInput: { commentId: 'c1' },
      requiredFields: ['spreadsheetId', 'commentId'],
    },
    comment_list: { requiredFields: ['spreadsheetId'] },
    comment_get: {
      validInput: { commentId: 'c1' },
      requiredFields: ['spreadsheetId', 'commentId'],
    },
    comment_resolve: {
      validInput: { commentId: 'c1' },
      requiredFields: ['spreadsheetId', 'commentId'],
    },
    comment_reopen: {
      validInput: { commentId: 'c1' },
      requiredFields: ['spreadsheetId', 'commentId'],
    },
    comment_add_reply: {
      validInput: { commentId: 'c1', content: 'reply' },
      requiredFields: ['spreadsheetId', 'commentId', 'content'],
    },
    comment_update_reply: {
      validInput: { commentId: 'c1', replyId: 'r1', content: 'updated' },
      requiredFields: ['spreadsheetId', 'commentId', 'replyId', 'content'],
    },
    comment_delete_reply: {
      validInput: { commentId: 'c1', replyId: 'r1' },
      requiredFields: ['spreadsheetId', 'commentId', 'replyId'],
    },
    version_list_revisions: { requiredFields: ['spreadsheetId'] },
    version_get_revision: {
      validInput: { revisionId: 'rev1' },
      requiredFields: ['spreadsheetId', 'revisionId'],
    },
    version_restore_revision: {
      validInput: { revisionId: 'rev1' },
      requiredFields: ['spreadsheetId', 'revisionId'],
    },
    version_keep_revision: {
      validInput: { revisionId: 'rev1', keepForever: true },
      requiredFields: ['spreadsheetId', 'revisionId', 'keepForever'],
    },
    version_create_snapshot: {
      validInput: { description: 'snapshot' },
      requiredFields: ['spreadsheetId'],
    },
    version_snapshot_status: {
      validInput: { taskId: 'snapshot_task_1' },
      requiredFields: ['spreadsheetId', 'taskId'],
    },
    version_list_snapshots: { requiredFields: ['spreadsheetId'] },
    version_restore_snapshot: {
      validInput: { snapshotId: 'snap1' },
      requiredFields: ['spreadsheetId', 'snapshotId'],
    },
    version_delete_snapshot: {
      validInput: { snapshotId: 'snap1' },
      requiredFields: ['spreadsheetId', 'snapshotId'],
    },
    version_compare: {
      validInput: { revisionId1: 'rev1', revisionId2: 'rev2' },
      requiredFields: ['spreadsheetId', 'revisionId1', 'revisionId2'],
    },
    version_export: {
      validInput: { format: 'xlsx' },
      requiredFields: ['spreadsheetId'],
    },
    approval_create: {
      validInput: { range: 'Sheet1!A1:D10', approvers: ['user@test.com'], requiredApprovals: 1 },
      requiredFields: ['spreadsheetId', 'approvers', 'requiredApprovals'],
    },
    approval_approve: {
      validInput: { approvalId: 'a1' },
      requiredFields: ['spreadsheetId', 'approvalId'],
    },
    approval_reject: {
      validInput: { approvalId: 'a1' },
      requiredFields: ['spreadsheetId', 'approvalId'],
    },
    approval_get_status: {
      validInput: { approvalId: 'a1' },
      requiredFields: ['spreadsheetId', 'approvalId'],
    },
    approval_list_pending: { requiredFields: ['spreadsheetId'] },
    approval_delegate: {
      validInput: { approvalId: 'a1', delegateTo: 'user@test.com' },
      requiredFields: ['spreadsheetId', 'approvalId', 'delegateTo'],
    },
    approval_cancel: {
      validInput: { approvalId: 'a1' },
      requiredFields: ['spreadsheetId', 'approvalId'],
    },
    list_access_proposals: {
      validInput: {},
      requiredFields: ['spreadsheetId'],
    },
    resolve_access_proposal: {
      validInput: { proposalId: 'p1', decision: 'APPROVE', role: 'reader' },
      requiredFields: ['spreadsheetId', 'proposalId', 'decision'],
    },
    label_list: {
      validInput: {},
      requiredFields: ['spreadsheetId'],
    },
    label_apply: {
      validInput: { labelId: 'label123' },
      requiredFields: ['spreadsheetId', 'labelId'],
    },
    label_remove: {
      validInput: { labelId: 'label123' },
      requiredFields: ['spreadsheetId', 'labelId'],
    },
  },

  sheets_advanced: {
    add_named_range: {
      validInput: { name: 'TestRange', range: 'Sheet1!A1:B10' },
      requiredFields: ['spreadsheetId', 'name', 'range'],
    },
    update_named_range: {
      validInput: { namedRangeId: 'nr1', name: 'Updated', range: 'Sheet1!A1:C10' },
      requiredFields: ['spreadsheetId', 'namedRangeId'],
    },
    delete_named_range: {
      validInput: { namedRangeId: 'nr1' },
      requiredFields: ['spreadsheetId', 'namedRangeId'],
    },
    list_named_ranges: { requiredFields: ['spreadsheetId'] },
    get_named_range: {
      validInput: { name: 'TestRange' },
      requiredFields: ['spreadsheetId', 'name'],
    },
    add_protected_range: {
      validInput: { range: 'Sheet1!A1:B10', description: 'Protected' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    update_protected_range: {
      validInput: { protectedRangeId: 1 },
      requiredFields: ['spreadsheetId', 'protectedRangeId'],
    },
    delete_protected_range: {
      validInput: { protectedRangeId: 1 },
      requiredFields: ['spreadsheetId', 'protectedRangeId'],
    },
    list_protected_ranges: { requiredFields: ['spreadsheetId'] },
    set_metadata: {
      validInput: { metadataKey: 'key', metadataValue: 'val' },
      requiredFields: ['spreadsheetId', 'metadataKey', 'metadataValue'],
    },
    get_metadata: {
      validInput: { metadataKey: 'key' },
      requiredFields: ['spreadsheetId'],
    },
    delete_metadata: {
      validInput: { metadataId: 1 },
      requiredFields: ['spreadsheetId', 'metadataId'],
    },
    add_banding: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    update_banding: {
      validInput: { bandedRangeId: 1 },
      requiredFields: ['spreadsheetId', 'bandedRangeId'],
    },
    delete_banding: {
      validInput: { bandedRangeId: 1 },
      requiredFields: ['spreadsheetId', 'bandedRangeId'],
    },
    list_banding: { requiredFields: ['spreadsheetId'] },
    create_table: {
      validInput: { range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    delete_table: {
      validInput: { tableId: 't1' },
      requiredFields: ['spreadsheetId', 'tableId'],
    },
    list_tables: { requiredFields: ['spreadsheetId'] },
    update_table: {
      validInput: { tableId: 't1' },
      requiredFields: ['spreadsheetId', 'tableId'],
    },
    rename_table_column: {
      validInput: { tableId: 't1', columnIndex: 0, newName: 'Col A' },
      requiredFields: ['spreadsheetId', 'tableId', 'columnIndex', 'newName'],
    },
    set_table_column_properties: {
      validInput: { tableId: 't1', columnIndex: 0 },
      requiredFields: ['spreadsheetId', 'tableId', 'columnIndex'],
    },
    add_person_chip: {
      validInput: { range: 'A1', email: 'user@test.com' },
      requiredFields: ['spreadsheetId', 'range', 'email'],
    },
    add_drive_chip: {
      validInput: { range: 'A1', fileId: 'file1' },
      requiredFields: ['spreadsheetId', 'range', 'fileId'],
    },
    add_rich_link_chip: {
      validInput: { range: 'A1', uri: 'https://example.com' },
      requiredFields: ['spreadsheetId', 'range', 'uri'],
    },
    list_chips: { requiredFields: ['spreadsheetId'] },
    create_named_function: {
      validInput: { functionName: 'MY_FUNC', functionBody: '=A1+B1' },
      requiredFields: ['spreadsheetId', 'functionName', 'functionBody'],
    },
    list_named_functions: { requiredFields: ['spreadsheetId'] },
    get_named_function: {
      validInput: { functionName: 'MY_FUNC' },
      requiredFields: ['spreadsheetId', 'functionName'],
    },
    update_named_function: {
      validInput: { functionName: 'MY_FUNC', functionBody: '=A1+C1' },
      requiredFields: ['spreadsheetId', 'functionName'],
    },
    delete_named_function: {
      validInput: { functionName: 'MY_FUNC' },
      requiredFields: ['spreadsheetId', 'functionName'],
    },
  },

  sheets_auth: {
    status: { requiredFields: [] },
    login: { requiredFields: [] },
    callback: {
      validInput: { code: 'auth-code-123' },
      requiredFields: ['code'],
    },
    logout: { requiredFields: [] },
  },

  sheets_session: {
    set_active: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    get_active: { requiredFields: [] },
    get_context: { requiredFields: [] },
    record_operation: {
      validInput: { tool: 'sheets_data', toolAction: 'read', spreadsheetId: 'test-id', description: 'test op', undoable: true, cellsAffected: 5 },
      requiredFields: ['tool', 'toolAction', 'spreadsheetId', 'description', 'undoable'],
    },
    get_last_operation: { requiredFields: [] },
    get_history: { requiredFields: [] },
    find_by_reference: {
      validInput: { reference: 'test', referenceType: 'operation' },
      requiredFields: ['reference', 'referenceType'],
    },
    update_preferences: { requiredFields: [] },
    get_preferences: { requiredFields: [] },
    set_pending: {
      validInput: { step: 1, totalSteps: 3 },
      requiredFields: ['step', 'totalSteps'],
    },
    get_pending: { requiredFields: [] },
    clear_pending: { requiredFields: [] },
    save_checkpoint: {
      validInput: { sessionId: 'sess1' },
      requiredFields: ['sessionId'],
    },
    load_checkpoint: {
      validInput: { sessionId: 'sess1' },
      requiredFields: ['sessionId'],
    },
    list_checkpoints: { requiredFields: [] },
    delete_checkpoint: {
      validInput: { sessionId: 'sess1' },
      requiredFields: ['sessionId'],
    },
    reset: { requiredFields: [] },
    get_alerts: { requiredFields: [] },
    acknowledge_alert: {
      validInput: { alertId: 'a1' },
      requiredFields: ['alertId'],
    },
    clear_alerts: { requiredFields: [] },
    set_user_id: {
      validInput: { userId: 'user1' },
      requiredFields: ['userId'],
    },
    get_profile: { requiredFields: [] },
    update_profile_preferences: {
      validInput: { preferences: {} },
      requiredFields: ['preferences'],
    },
    record_successful_formula: {
      validInput: { formula: '=SUM(A1:A10)', useCase: 'sum' },
      requiredFields: ['formula', 'useCase'],
    },
    reject_suggestion: {
      validInput: { suggestion: 'bad advice' },
      requiredFields: ['suggestion'],
    },
    get_top_formulas: { requiredFields: [] },
    execute_pipeline: {
      validInput: { steps: [{ id: 'step1', tool: 'sheets_data', action: 'read', params: { spreadsheetId: 'test-id', range: 'A1:B10' } }] },
      requiredFields: ['steps'],
    },
    schedule_create: {
      validInput: {
        spreadsheetId: 'test-id',
        cronExpression: '0 9 * * 1-5',
        description: 'Weekday data refresh',
        tool: 'sheets_data',
        actionName: 'read',
        params: { spreadsheetId: 'test-id', range: 'Sheet1!A1:B10' },
      },
      requiredFields: [
        'spreadsheetId',
        'cronExpression',
        'description',
        'tool',
        'actionName',
        'params',
      ],
    },
    schedule_cancel: {
      validInput: { jobId: 'job-123' },
      requiredFields: ['jobId'],
    },
    schedule_run_now: {
      validInput: { jobId: 'job-123' },
      requiredFields: ['jobId'],
    },
  },

  sheets_transaction: {
    begin: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    queue: {
      validInput: { transactionId: 'tx1', operation: { tool: 'sheets_data', action: 'write', params: { range: 'A1:B2', values: [['a', 'b']] } } },
      requiredFields: ['transactionId', 'operation'],
    },
    commit: {
      validInput: { transactionId: 'tx1' },
      requiredFields: ['transactionId'],
    },
    rollback: {
      validInput: { transactionId: 'tx1' },
      requiredFields: ['transactionId'],
    },
    status: {
      validInput: { transactionId: 'tx1' },
      requiredFields: ['transactionId'],
    },
    list: { requiredFields: [] },
  },

  sheets_quality: {
    validate: {
      validInput: { spreadsheetId: 'test-id', value: { range: 'A1:B2' } },
      requiredFields: ['spreadsheetId', 'value'],
    },
    detect_conflicts: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    resolve_conflict: {
      validInput: { spreadsheetId: 'test-id', conflictId: 'c1', strategy: 'keep_local' },
      requiredFields: ['spreadsheetId', 'conflictId', 'strategy'],
    },
    analyze_impact: {
      validInput: { spreadsheetId: 'test-id', operation: { tool: 'sheets_data', action: 'write' } },
      requiredFields: ['spreadsheetId', 'operation'],
    },
  },

  sheets_history: {
    list: { requiredFields: [] },
    get: {
      validInput: { operationId: 'op1' },
      requiredFields: ['operationId'],
    },
    stats: { requiredFields: [] },
    undo: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    redo: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    revert_to: {
      validInput: { operationId: 'op1' },
      requiredFields: ['operationId'],
    },
    clear: { requiredFields: [] },
    timeline: {
      requiredFields: ['spreadsheetId'],
    },
    diff_revisions: {
      validInput: { revisionId1: 'rev1', revisionId2: 'rev2' },
      requiredFields: ['spreadsheetId', 'revisionId1', 'revisionId2'],
    },
    restore_cells: {
      validInput: { revisionId: 'rev1', cells: ['A1', 'B2'] },
      requiredFields: ['spreadsheetId', 'revisionId', 'cells'],
    },
  },

  sheets_confirm: {
    request: {
      validInput: { plan: { title: 'Op', description: 'Op plan', steps: [{ stepNumber: 1, description: 'Step 1', tool: 'sheets_data', action: 'write' }] }, undoable: true },
      requiredFields: ['plan', 'undoable'],
    },
    get_stats: { requiredFields: [] },
    wizard_start: {
      validInput: { title: 'Setup Wizard', description: 'Complete wizard setup', steps: [{ stepId: 's1', title: 'Step 1', description: 'First step', fields: [] }] },
      requiredFields: ['title', 'description', 'steps'],
    },
    wizard_step: {
      validInput: { wizardId: 'w1', stepId: 's1', values: {} },
      requiredFields: ['wizardId', 'stepId', 'values'],
    },
    wizard_complete: {
      validInput: { wizardId: 'w1' },
      requiredFields: ['wizardId'],
    },
  },

  sheets_fix: {
    fix: {
      validInput: { spreadsheetId: 'test-id', issues: [] },
      requiredFields: ['spreadsheetId'],
    },
    clean: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    standardize_formats: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100', columns: [{ column: 'A', targetFormat: 'iso_date' }] },
      requiredFields: ['spreadsheetId', 'range', 'columns'],
    },
    fill_missing: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100', strategy: 'forward' },
      requiredFields: ['spreadsheetId', 'range', 'strategy'],
    },
    detect_anomalies: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    suggest_cleaning: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100' },
      requiredFields: ['spreadsheetId', 'range'],
    },
  },

  sheets_analyze: {
    comprehensive: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    analyze_data: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId'],
    },
    suggest_visualization: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId'],
    },
    generate_formula: {
      validInput: { spreadsheetId: 'test-id', description: 'sum column A' },
      requiredFields: ['spreadsheetId', 'description'],
    },
    detect_patterns: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D10' },
      requiredFields: ['spreadsheetId'],
    },
    analyze_structure: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    analyze_quality: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    analyze_performance: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    analyze_formulas: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    query_natural_language: {
      validInput: { spreadsheetId: 'test-id', query: 'What is the total?' },
      requiredFields: ['spreadsheetId', 'query'],
    },
    explain_analysis: {
      validInput: { analysisResult: { key: 'val' }, question: 'Why did revenue increase?' },
      requiredFields: [],
    },
    scout: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    plan: {
      validInput: { spreadsheetId: 'test-id', intent: 'optimize' },
      requiredFields: ['spreadsheetId'],
    },
    execute_plan: {
      validInput: { spreadsheetId: 'test-id', plan: { steps: [{ order: 1, type: 'quality', priority: 'high', reason: 'test', outputs: ['output'], estimatedDuration: '5m' }] } },
      requiredFields: ['spreadsheetId', 'plan'],
    },
    drill_down: {
      validInput: { spreadsheetId: 'test-id', target: { type: 'sheet', sheetIndex: 0 } },
      requiredFields: ['spreadsheetId', 'target'],
    },
    generate_actions: {
      validInput: { spreadsheetId: 'test-id', intent: 'fix_critical' },
      requiredFields: ['spreadsheetId', 'intent'],
    },
    suggest_next_actions: {
      requiredFields: ['spreadsheetId'],
    },
    auto_enhance: {
      requiredFields: ['spreadsheetId'],
    },
    semantic_search: {
      validInput: { spreadsheetId: 'test-id', query: 'revenue by month', topK: 5 },
      requiredFields: ['spreadsheetId', 'query'],
    },
    discover_action: {
      validInput: { query: 'find action for merging data' },
      requiredFields: ['query'],
    },
    schedule_intelligence: {
      validInput: {
        spreadsheetId: 'test-id',
        analysisType: 'quality_check',
        intervalMinutes: 60,
        conditions: [{ metric: 'quality_score', operator: 'lt', threshold: 0.8 }],
        webhookUrl: 'https://example.com/webhook',
      },
      requiredFields: ['spreadsheetId', 'analysisType'],
    },
    get_intelligence_report: {
      validInput: {
        spreadsheetId: 'test-id',
        scheduleId: '550e8400-e29b-41d4-a716-446655440000',
      },
      requiredFields: ['spreadsheetId', 'scheduleId'],
    },
    cancel_intelligence: {
      validInput: {
        spreadsheetId: 'test-id',
        scheduleId: '550e8400-e29b-41d4-a716-446655440000',
      },
      requiredFields: ['spreadsheetId', 'scheduleId'],
    },
  },

  sheets_composite: {
    import_csv: {
      validInput: { spreadsheetId: 'test-id', csvData: 'a,b\n1,2' },
      requiredFields: ['spreadsheetId', 'csvData'],
    },
    smart_append: {
      validInput: { spreadsheetId: 'test-id', sheet: 'Sheet1', data: [{ a: 'val', b: 'val2' }] },
      requiredFields: ['spreadsheetId', 'sheet', 'data'],
    },
    bulk_update: {
      validInput: { spreadsheetId: 'test-id', sheet: 'Sheet1', keyColumn: 'id', updates: [{ id: '1', name: 'test' }] },
      requiredFields: ['spreadsheetId', 'sheet', 'keyColumn', 'updates'],
    },
    deduplicate: {
      validInput: { spreadsheetId: 'test-id', sheet: 'Sheet1', keyColumns: ['Name', 'Email'] },
      requiredFields: ['spreadsheetId', 'sheet', 'keyColumns'],
    },
    export_xlsx: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    import_xlsx: {
      validInput: { spreadsheetId: 'test-id', fileContent: 'base64data' },
      requiredFields: ['spreadsheetId', 'fileContent'],
    },
    get_form_responses: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    setup_sheet: {
      validInput: { spreadsheetId: 'test-id', sheetName: 'Data', headers: ['Name', 'Age'] },
      requiredFields: ['spreadsheetId', 'sheetName', 'headers'],
    },
    import_and_format: {
      validInput: { spreadsheetId: 'test-id', csvData: 'a,b\n1,2' },
      requiredFields: ['spreadsheetId', 'csvData'],
    },
    clone_structure: {
      validInput: { spreadsheetId: 'test-id', sourceSheet: 'Sheet1', newSheetName: 'Clone' },
      requiredFields: ['spreadsheetId', 'sourceSheet'],
    },
    export_large_dataset: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:Z1000' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    generate_sheet: {
      validInput: { description: 'Q1 budget tracker with revenue and expenses' },
      requiredFields: ['description'],
    },
    generate_template: {
      validInput: { description: 'Employee onboarding checklist' },
      requiredFields: ['description'],
    },
    preview_generation: {
      validInput: { description: 'Sales pipeline tracker' },
      requiredFields: ['description'],
    },
    audit_sheet: {
      requiredFields: ['spreadsheetId'],
    },
    publish_report: {
      requiredFields: ['spreadsheetId'],
    },
    data_pipeline: {
      validInput: { spreadsheetId: 'test-id', sourceRange: 'Sheet1!A1:D100', steps: [{ type: 'filter', config: { column: 'A', operator: 'equals', value: 'x' } }] },
      requiredFields: ['spreadsheetId', 'sourceRange', 'steps'],
    },
    instantiate_template: {
      validInput: { templateId: 'tmpl1', variables: { companyName: 'Acme Corp' } },
      requiredFields: ['templateId', 'variables'],
    },
    migrate_spreadsheet: {
      validInput: { sourceSpreadsheetId: 'src-id', sourceRange: 'Sheet1!A1:D100', destinationSpreadsheetId: 'dest-id', destinationRange: 'Sheet1!A1', columnMapping: [{ sourceColumn: 'Name', destinationColumn: 'Name' }] },
      requiredFields: ['sourceSpreadsheetId', 'sourceRange', 'destinationSpreadsheetId', 'destinationRange', 'columnMapping'],
    },
    batch_operations: {
      validInput: { spreadsheetId: 'test-id', operations: [{ tool: 'sheets_data', action: 'read', params: { range: 'Sheet1!A1:B2' } }] },
      requiredFields: ['spreadsheetId', 'operations'],
    },
    build_dashboard: {
      validInput: { spreadsheetId: 'test-id', dataSheet: 'Sales' },
      requiredFields: ['spreadsheetId', 'dataSheet'],
    },
  },

  sheets_templates: {
    list: { requiredFields: [] },
    get: {
      validInput: { templateId: 't1' },
      requiredFields: ['templateId'],
    },
    create: {
      validInput: { spreadsheetId: 'test-id', name: 'My Template' },
      requiredFields: ['spreadsheetId', 'name'],
    },
    apply: {
      validInput: { templateId: 't1', spreadsheetId: 'test-id', title: 'New Sheet' },
      requiredFields: ['templateId', 'spreadsheetId', 'title'],
    },
    update: {
      validInput: { templateId: 't1' },
      requiredFields: ['templateId'],
    },
    delete: {
      validInput: { templateId: 't1' },
      requiredFields: ['templateId'],
    },
    preview: {
      validInput: { templateId: 't1' },
      requiredFields: ['templateId'],
    },
    import_builtin: {
      validInput: { builtinName: 'crm' },
      requiredFields: ['builtinName'],
    },
  },

  sheets_bigquery: {
    connect: {
      validInput: { spreadsheetId: 'test-id', spec: { projectId: 'proj1', datasetId: 'ds1', tableId: 'tbl1' } },
      requiredFields: ['spreadsheetId', 'spec'],
    },
    connect_looker: {
      validInput: { spreadsheetId: 'test-id', spec: { instanceUri: 'https://company.looker.com', model: 'm1', explore: 'e1' } },
      requiredFields: ['spreadsheetId', 'spec'],
    },
    disconnect: {
      validInput: { spreadsheetId: 'test-id', dataSourceId: 'ds1' },
      requiredFields: ['spreadsheetId', 'dataSourceId'],
    },
    list_connections: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    get_connection: {
      validInput: { spreadsheetId: 'test-id', dataSourceId: 'ds1' },
      requiredFields: ['spreadsheetId', 'dataSourceId'],
    },
    query: {
      validInput: { spreadsheetId: 'test-id', projectId: 'proj1', query: 'SELECT 1' },
      requiredFields: ['spreadsheetId', 'projectId', 'query'],
    },
    preview: {
      validInput: { projectId: 'proj1', query: 'SELECT 1' },
      requiredFields: ['projectId', 'query'],
    },
    refresh: {
      validInput: { spreadsheetId: 'test-id', dataSourceId: 'ds1' },
      requiredFields: ['spreadsheetId', 'dataSourceId'],
    },
    cancel_refresh: {
      validInput: { spreadsheetId: 'test-id', dataSourceId: 'ds1' },
      requiredFields: ['spreadsheetId', 'dataSourceId'],
    },
    list_datasets: {
      validInput: { projectId: 'proj1' },
      requiredFields: ['projectId'],
    },
    list_tables: {
      validInput: { projectId: 'proj1', datasetId: 'ds1' },
      requiredFields: ['projectId', 'datasetId'],
    },
    get_table_schema: {
      validInput: { projectId: 'proj1', datasetId: 'ds1', tableId: 'tbl1' },
      requiredFields: ['projectId', 'datasetId', 'tableId'],
    },
    export_to_bigquery: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D10', destination: { projectId: 'proj1', datasetId: 'ds1', tableId: 'tbl1' } },
      requiredFields: ['spreadsheetId', 'range', 'destination'],
    },
    import_from_bigquery: {
      validInput: { spreadsheetId: 'test-id', projectId: 'proj1', query: 'SELECT 1' },
      requiredFields: ['spreadsheetId', 'projectId', 'query'],
    },
    create_scheduled_query: {
      validInput: { projectId: 'proj1', query: 'SELECT 1', displayName: 'test', schedule: 'every 24 hours' },
      requiredFields: ['projectId', 'query', 'displayName', 'schedule'],
    },
    list_scheduled_queries: {
      validInput: { projectId: 'proj1' },
      requiredFields: ['projectId'],
    },
    delete_scheduled_query: {
      validInput: { transferConfigName: 'config1' },
      requiredFields: ['transferConfigName'],
    },
  },

  sheets_appsscript: {
    create: {
      validInput: { title: 'New Script', parentId: 'test-id' },
      requiredFields: ['title'],
    },
    get: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    get_content: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    update_content: {
      validInput: { scriptId: 'script1', files: [{ name: 'Code', type: 'SERVER_JS', source: 'function test() {}' }] },
      requiredFields: ['scriptId', 'files'],
    },
    create_version: {
      validInput: { scriptId: 'script1', description: 'v1' },
      requiredFields: ['scriptId'],
    },
    list_versions: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    get_version: {
      validInput: { scriptId: 'script1', versionNumber: 1 },
      requiredFields: ['scriptId', 'versionNumber'],
    },
    deploy: {
      validInput: { scriptId: 'script1', versionNumber: 1 },
      requiredFields: ['scriptId'],
    },
    list_deployments: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    get_deployment: {
      validInput: { scriptId: 'script1', deploymentId: 'dep1' },
      requiredFields: ['scriptId', 'deploymentId'],
    },
    undeploy: {
      validInput: { scriptId: 'script1', deploymentId: 'dep1' },
      requiredFields: ['scriptId', 'deploymentId'],
    },
    run: {
      validInput: { scriptId: 'script1', functionName: 'test', devMode: true },
      requiredFields: ['scriptId', 'functionName', 'devMode'],
    },
    list_processes: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    get_metrics: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    create_trigger: {
      validInput: { scriptId: 'script1', functionName: 'test', triggerType: 'CLOCK' },
      requiredFields: ['scriptId', 'functionName', 'triggerType'],
    },
    list_triggers: {
      validInput: { scriptId: 'script1' },
      requiredFields: ['scriptId'],
    },
    delete_trigger: {
      validInput: { scriptId: 'script1', triggerId: 'trig1' },
      requiredFields: ['scriptId', 'triggerId'],
    },
    update_trigger: {
      validInput: { scriptId: 'script1', triggerId: 'trig1' },
      requiredFields: ['scriptId', 'triggerId'],
    },
  },

  sheets_webhook: {
    register: {
      validInput: { spreadsheetId: 'test-id', webhookUrl: 'https://example.com/hook', eventTypes: ['sheet.update'] },
      requiredFields: ['spreadsheetId', 'webhookUrl', 'eventTypes'],
    },
    unregister: {
      validInput: { webhookId: 'wh1' },
      requiredFields: ['webhookId'],
    },
    list: { requiredFields: [] },
    get: {
      validInput: { webhookId: 'wh1' },
      requiredFields: ['webhookId'],
    },
    test: {
      validInput: { webhookId: 'wh1' },
      requiredFields: ['webhookId'],
    },
    get_stats: { requiredFields: [] },
    watch_changes: {
      validInput: { spreadsheetId: 'test-id', webhookUrl: 'https://example.com/hook' },
      requiredFields: ['spreadsheetId', 'webhookUrl'],
    },
    subscribe_workspace: {
      validInput: {
        spreadsheetId: 'test-id',
        notificationEndpoint: 'projects/test-project/topics/test-topic',
      },
      requiredFields: ['spreadsheetId', 'notificationEndpoint'],
    },
    unsubscribe_workspace: {
      validInput: { subscriptionId: 'sub-123' },
      requiredFields: ['subscriptionId'],
    },
  },

  sheets_dependencies: {
    build: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    analyze_impact: {
      validInput: { spreadsheetId: 'test-id', cell: 'A1' },
      requiredFields: ['spreadsheetId', 'cell'],
    },
    detect_cycles: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    get_dependencies: {
      validInput: { spreadsheetId: 'test-id', cell: 'A1' },
      requiredFields: ['spreadsheetId', 'cell'],
    },
    get_dependents: {
      validInput: { spreadsheetId: 'test-id', cell: 'A1' },
      requiredFields: ['spreadsheetId', 'cell'],
    },
    get_stats: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    export_dot: {
      validInput: { spreadsheetId: 'test-id' },
      requiredFields: ['spreadsheetId'],
    },
    model_scenario: {
      validInput: { spreadsheetId: 'test-id', changes: [{ cell: 'B2', newValue: 80000 }] },
      requiredFields: ['spreadsheetId', 'changes'],
    },
    compare_scenarios: {
      validInput: { spreadsheetId: 'test-id', scenarios: [{ name: 'Base', changes: [{ cell: 'B2', newValue: 100000 }] }, { name: 'Optimistic', changes: [{ cell: 'B2', newValue: 120000 }] }] },
      requiredFields: ['spreadsheetId', 'scenarios'],
    },
    create_scenario_sheet: {
      validInput: { spreadsheetId: 'test-id', scenario: { name: 'Optimistic', changes: [{ cell: 'B2', newValue: 120000 }] } },
      requiredFields: ['spreadsheetId', 'scenario'],
    },
  },

  sheets_federation: {
    call_remote: {
      validInput: { serverName: 'srv1', toolName: 'test_tool' },
      requiredFields: ['serverName', 'toolName'],
    },
    list_servers: { requiredFields: [] },
    get_server_tools: {
      validInput: { serverName: 'srv1' },
      requiredFields: ['serverName'],
    },
    validate_connection: {
      validInput: { serverName: 'srv1' },
      requiredFields: ['serverName'],
    },
  },

  sheets_agent: {
    plan: {
      validInput: { description: 'Add a profit margin column to the data sheet' },
      requiredFields: ['description'],
    },
    execute: {
      validInput: { planId: 'plan-123' },
      requiredFields: ['planId'],
    },
    execute_step: {
      validInput: { planId: 'plan-123', stepId: 'step-1' },
      requiredFields: ['planId', 'stepId'],
    },
    observe: {
      validInput: { planId: 'plan-123' },
      requiredFields: ['planId'],
    },
    rollback: {
      validInput: { planId: 'plan-123', checkpointId: 'ckpt-1' },
      requiredFields: ['planId', 'checkpointId'],
    },
    get_status: {
      validInput: { planId: 'plan-123' },
      requiredFields: ['planId'],
    },
    list_plans: {
      requiredFields: [],
    },
    resume: {
      validInput: { planId: 'plan-123' },
      requiredFields: ['planId'],
    },
  },

  sheets_compute: {
    evaluate: {
      validInput: { spreadsheetId: 'test-id', formula: '=SUM(A1:A10)' },
      requiredFields: ['spreadsheetId', 'formula'],
    },
    aggregate: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:A100', functions: ['sum', 'average'] },
      requiredFields: ['spreadsheetId', 'range', 'functions'],
    },
    statistical: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100' },
      requiredFields: ['spreadsheetId', 'range'],
    },
    regression: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:B100', xColumn: 'A', yColumn: 'B' },
      requiredFields: ['spreadsheetId', 'range', 'xColumn', 'yColumn'],
    },
    forecast: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:B24', dateColumn: 'A', valueColumn: 'B', periods: 6 },
      requiredFields: ['spreadsheetId', 'range', 'dateColumn', 'valueColumn', 'periods'],
    },
    matrix_op: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:C3', operation: 'transpose' },
      requiredFields: ['spreadsheetId', 'range', 'operation'],
    },
    pivot_compute: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:D100', rows: ['Category'], values: [{ column: 'Revenue', function: 'sum' }] },
      requiredFields: ['spreadsheetId', 'range', 'rows', 'values'],
    },
    custom_function: {
      validInput: { spreadsheetId: 'test-id', range: 'Sheet1!A1:C100', expression: 'ROUND($Revenue * $TaxRate, 2)' },
      requiredFields: ['spreadsheetId', 'range', 'expression'],
    },
    batch_compute: {
      validInput: { spreadsheetId: 'test-id', computations: [{ id: 'c1', type: 'aggregate', params: { range: 'Sheet1!A1:A10', functions: ['sum'] } }] },
      requiredFields: ['spreadsheetId', 'computations'],
    },
    explain_formula: {
      validInput: { spreadsheetId: 'test-id', formula: '=VLOOKUP(A2, Sheet2!A:C, 3, FALSE)' },
      requiredFields: ['spreadsheetId', 'formula'],
    },
    sql_query: {
      validInput: {
        spreadsheetId: 'test-id',
        tables: [{ name: 'sales', range: 'Sheet1!A1:D100', hasHeaders: true }],
        sql: 'SELECT * FROM sales LIMIT 10',
      },
      requiredFields: ['spreadsheetId', 'tables', 'sql'],
    },
    sql_join: {
      validInput: {
        spreadsheetId: 'test-id',
        left: { range: 'Sheet1!A1:C100', alias: 'left' },
        right: { range: 'Sheet2!A1:C100', alias: 'right' },
        on: 'left.id = right.id',
      },
      requiredFields: ['spreadsheetId', 'left', 'right', 'on'],
    },
    python_eval: {
      validInput: {
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C50',
        code: 'result = len(data)',
      },
      requiredFields: ['spreadsheetId', 'range', 'code'],
    },
    pandas_profile: {
      validInput: {
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C50',
      },
      requiredFields: ['spreadsheetId', 'range'],
    },
    sklearn_model: {
      validInput: {
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:D100',
        targetColumn: 'revenue',
        modelType: 'linear_regression',
      },
      requiredFields: ['spreadsheetId', 'range', 'targetColumn', 'modelType'],
    },
    matplotlib_chart: {
      validInput: {
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:C50',
        chartType: 'line',
      },
      requiredFields: ['spreadsheetId', 'range', 'chartType'],
    },
  },

  sheets_connectors: {
    list_connectors: {
      requiredFields: [],
    },
    configure: {
      validInput: { connectorId: 'finnhub', credentials: { type: 'api_key', apiKey: 'test-key' } },
      requiredFields: [],
    },
    query: {
      validInput: { connectorId: 'finnhub', endpoint: 'stock/quote' },
      requiredFields: ['connectorId', 'endpoint'],
    },
    batch_query: {
      validInput: { queries: [{ connectorId: 'finnhub', endpoint: 'stock/quote' }] },
      requiredFields: ['queries'],
    },
    subscribe: {
      validInput: { connectorId: 'finnhub', endpoint: 'stock/quote', schedule: { interval: 'hourly' }, destination: { spreadsheetId: 'test-id', range: 'Sheet1!A1' } },
      requiredFields: ['connectorId', 'endpoint', 'schedule', 'destination'],
    },
    unsubscribe: {
      validInput: { subscriptionId: 'sub-123' },
      requiredFields: ['subscriptionId'],
    },
    list_subscriptions: {
      requiredFields: [],
    },
    transform: {
      validInput: { connectorId: 'finnhub', endpoint: 'stock/quote', transform: { limit: 10 } },
      requiredFields: ['connectorId', 'endpoint', 'transform'],
    },
    status: {
      validInput: { connectorId: 'finnhub' },
      requiredFields: ['connectorId'],
    },
    discover: {
      validInput: { connectorId: 'finnhub' },
      requiredFields: ['connectorId'],
    },
  },
};

// ─── Fixture Generator ──────────────────────────────────────

function needsSpreadsheetId(tool: string, action: string): boolean {
  if (NO_SPREADSHEET_TOOLS.has(tool)) return false;
  if (NO_SPREADSHEET_ACTIONS[tool]?.has(action)) return false;
  return true;
}

function buildValidInput(tool: string, action: string): Record<string, unknown> {
  const inner: Record<string, unknown> = { action };

  // Add spreadsheetId if needed
  if (needsSpreadsheetId(tool, action)) {
    inner.spreadsheetId = 'test-spreadsheet-id';
  }

  // Merge overrides
  const override = FIXTURE_OVERRIDES[tool]?.[action]?.validInput;
  if (override) {
    Object.assign(inner, override);
  }

  // ALL schemas use z.object({ request: { action, ... } }) envelope
  return { request: inner };
}

function buildInvalidInput(_tool: string, _action: string): Record<string, unknown> {
  // Missing request.action field entirely — guaranteed to fail validation
  // An empty object has no `request` property, so the schema will reject it
  return {};
}

function getRequiredFields(tool: string, action: string): string[] {
  const override = FIXTURE_OVERRIDES[tool]?.[action]?.requiredFields;
  if (override) return override;

  // Default: action is always required, spreadsheetId if applicable
  const fields = ['action'];
  if (needsSpreadsheetId(tool, action)) {
    fields.push('spreadsheetId');
  }
  return fields;
}

// ─── Export: All Fixtures ───────────────────────────────────

/**
 * Generate fixtures for ALL actions across ALL tools.
 * This is the primary export used by action-coverage.test.ts.
 *
 * When new actions are added to TOOL_ACTIONS, they automatically
 * get basic fixtures (action + spreadsheetId). Add overrides to
 * FIXTURE_OVERRIDES for complex actions that need extra params.
 */
export function generateAllFixtures(): ActionFixture[] {
  const fixtures: ActionFixture[] = [];

  for (const [tool, actions] of Object.entries(TOOL_ACTIONS)) {
    for (const action of actions) {
      fixtures.push({
        tool,
        action,
        validInput: buildValidInput(tool, action),
        invalidInput: buildInvalidInput(tool, action),
        requiredFields: getRequiredFields(tool, action),
        noSpreadsheet: !needsSpreadsheetId(tool, action),
      });
    }
  }

  return fixtures;
}

/**
 * Get fixtures for a specific tool
 */
export function getToolFixtures(tool: string): ActionFixture[] {
  return generateAllFixtures().filter((f) => f.tool === tool);
}

/**
 * Get total action count from fixtures (should match ACTION_COUNT)
 */
export function getFixtureActionCount(): number {
  return generateAllFixtures().length;
}

/**
 * Tool names from TOOL_ACTIONS (should match TOOL_COUNT)
 */
export function getFixtureToolNames(): string[] {
  return Object.keys(TOOL_ACTIONS);
}
