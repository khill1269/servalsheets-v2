# ServalSheets Live API Test Executor

# Run this by telling Claude: "Execute the comprehensive test suite using the connected MCP tools"

This file defines the test plan. Claude should execute each test using the connected servalsheets MCP tools.

## Test Plan

### Phase 1: Authentication

- [x] sheets_auth:status
- [ ] sheets_auth:login (if needed)

### Phase 2: Setup - Create Test Spreadsheet

- [ ] sheets_core:create - Create test spreadsheet with initial sheet

### Phase 3: Core Operations

#### sheets_core (15 actions)

- [ ] get
- [ ] create
- [ ] copy
- [ ] update_properties
- [ ] get_url
- [ ] batch_get
- [ ] get_comprehensive
- [ ] list
- [ ] add_sheet
- [ ] delete_sheet
- [ ] duplicate_sheet
- [ ] update_sheet
- [ ] copy_sheet_to
- [ ] list_sheets
- [ ] get_sheet

#### sheets_data (20 actions)

- [ ] read
- [ ] write
- [ ] append
- [ ] clear
- [ ] batch_read
- [ ] batch_write
- [ ] batch_clear
- [ ] find_replace
- [ ] add_note
- [ ] get_note
- [ ] clear_note
- [ ] set_validation
- [ ] clear_validation
- [ ] set_hyperlink
- [ ] clear_hyperlink
- [ ] merge_cells
- [ ] unmerge_cells
- [ ] get_merges
- [ ] cut_paste
- [ ] copy_paste

#### sheets_format (18 actions)

- [ ] set_format
- [ ] suggest_format
- [ ] set_background
- [ ] set_text_format
- [ ] set_number_format
- [ ] set_alignment
- [ ] set_borders
- [ ] clear_format
- [ ] apply_preset
- [ ] auto_fit
- [ ] rule_add_conditional_format
- [ ] rule_update_conditional_format
- [ ] rule_delete_conditional_format
- [ ] rule_list_conditional_formats
- [ ] set_data_validation
- [ ] clear_data_validation
- [ ] list_data_validations
- [ ] add_conditional_format_rule

#### sheets_dimensions (39 actions)

- [ ] insert_rows
- [ ] insert_columns
- [ ] delete_rows
- [ ] delete_columns
- [ ] move_rows
- [ ] move_columns
- [ ] resize_rows
- [ ] resize_columns
- [ ] auto_resize
- [ ] hide_rows
- [ ] hide_columns
- [ ] show_rows
- [ ] show_columns
- [ ] freeze_rows
- [ ] freeze_columns
- [ ] group_rows
- [ ] group_columns
- [ ] ungroup_rows
- [ ] ungroup_columns
- [ ] append_rows
- [ ] append_columns
- [ ] set_basic_filter
- [ ] clear_basic_filter
- [ ] get_basic_filter
- [ ] filter_update_filter_criteria
- [ ] sort_range
- [ ] trim_whitespace
- [ ] randomize_range
- [ ] text_to_columns
- [ ] auto_fill
- [ ] create_filter_view
- [ ] update_filter_view
- [ ] delete_filter_view
- [ ] list_filter_views
- [ ] get_filter_view
- [ ] create_slicer
- [ ] update_slicer
- [ ] delete_slicer
- [ ] list_slicers

#### sheets_visualize (16 actions)

- [ ] chart_create
- [ ] suggest_chart
- [ ] chart_update
- [ ] chart_delete
- [ ] chart_list
- [ ] chart_get
- [ ] chart_move
- [ ] chart_resize
- [ ] chart_update_data_range
- [ ] pivot_create
- [ ] suggest_pivot
- [ ] pivot_update
- [ ] pivot_delete
- [ ] pivot_list
- [ ] pivot_get
- [ ] pivot_refresh

#### sheets_collaborate (28 actions)

- [ ] share_add
- [ ] share_update
- [ ] share_remove
- [ ] share_list
- [ ] share_get
- [ ] share_transfer_ownership
- [ ] share_set_link
- [ ] share_get_link
- [ ] comment_add
- [ ] comment_update
- [ ] comment_delete
- [ ] comment_list
- [ ] comment_get
- [ ] comment_resolve
- [ ] comment_reopen
- [ ] comment_add_reply
- [ ] comment_update_reply
- [ ] comment_delete_reply
- [ ] version_list_revisions
- [ ] version_get_revision
- [ ] version_restore_revision
- [ ] version_keep_revision
- [ ] version_create_snapshot
- [ ] version_list_snapshots
- [ ] version_restore_snapshot
- [ ] version_delete_snapshot
- [ ] version_compare
- [ ] version_export

#### sheets_analyze (16 actions)

- [ ] comprehensive
- [ ] analyze_data
- [ ] suggest_visualization
- [ ] generate_formula
- [ ] detect_patterns
- [ ] analyze_structure
- [ ] analyze_quality
- [ ] analyze_performance
- [ ] analyze_formulas
- [ ] query_natural_language
- [ ] explain_analysis

#### sheets_advanced (19 actions)

- [ ] add_named_range
- [ ] update_named_range
- [ ] delete_named_range
- [ ] list_named_ranges
- [ ] get_named_range
- [ ] add_protected_range
- [ ] update_protected_range
- [ ] delete_protected_range
- [ ] list_protected_ranges
- [ ] set_metadata
- [ ] get_metadata
- [ ] delete_metadata
- [ ] add_banding
- [ ] update_banding
- [ ] delete_banding
- [ ] list_banding
- [ ] create_table
- [ ] delete_table
- [ ] list_tables

#### sheets_transaction (6 actions)

- [ ] begin
- [ ] queue
- [ ] commit
- [ ] rollback
- [ ] status
- [ ] list

#### sheets_quality (4 actions)

- [ ] validate
- [ ] detect_conflicts
- [ ] resolve_conflict
- [ ] analyze_impact

#### sheets_history (7 actions)

- [ ] list
- [ ] get
- [ ] stats
- [ ] undo
- [ ] redo
- [ ] revert_to
- [ ] clear

#### sheets_confirm (2 actions)

- [ ] request (skip - requires elicitation)
- [ ] get_stats

#### sheets_fix (1 action)

- [ ] fix (preview mode)

#### sheets_composite (4 actions)

- [ ] import_csv
- [ ] smart_append
- [ ] bulk_update
- [ ] deduplicate

#### sheets_session (13 actions)

- [ ] set_active
- [ ] get_active
- [ ] get_context
- [ ] get_preferences
- [ ] update_preferences
- [ ] record_operation
- [ ] get_last_operation
- [ ] get_history
- [ ] find_by_reference
- [ ] set_pending
- [ ] get_pending
- [ ] clear_pending
- [ ] reset

## Total: 25 tools, 391 actions
