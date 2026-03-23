/**
 * ServalSheets - LLM-Optimized Tool Descriptions
 *
 * Routing-focused descriptions that help Claude select the right tool:
 * 1. **ROUTING** - When to pick this tool
 * 2. **NOT this tool** - Cross-references to alternatives
 * 3. **ACTIONS BY CATEGORY** - Grouped for quick scanning
 * 4. **TOP 3 ACTIONS** - Most common usage patterns
 * 5. **SAFETY** - Destructive operation warnings
 *
 * Total: 25 tools, 407 actions (see TOOL_COUNT/ACTION_COUNT in index.ts)
 *
 * SHARED CONTEXT (applies to all tools except sheets_auth):
 * - PREREQUISITE: sheets_auth must be authenticated before using any tool.
 * - Range format: "Sheet1!A1:D10" (case-sensitive, include sheet name). Spaces/emoji: "'My Sheet'!A1:D10"
 * - spreadsheetId: Long alphanumeric string from Google Sheets URL.
 * - sheetId: Numeric ID from sheets_core.list_sheets (0, 123456789, etc.), not sheet name.
 * - BATCH RULE: 3+ similar operations → use batch_* or sheets_transaction (1 API call, 80-95% savings).
 * - FIRST TIME? Start with sheets_auth action:"status", read the readiness block, then use /test_connection.
 */

import { ACTION_COUNTS } from './action-counts.js';

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  //=============================================================================
  // AUTHENTICATION
  //=============================================================================

  sheets_auth: `🔐 AUTH - Authentication, readiness, and optional feature setup (${ACTION_COUNTS['sheets_auth']} actions). Call status first.

**Use when:** Checking auth/readiness state, logging in/out, or configuring connectors, AI fallback, webhooks, and federation
**NOT this tool - use instead:**
> All other tools REQUIRE authentication first - this is a PREREQUISITE
**ACTIONS (5):** status, login, callback, logout, setup_feature
**FIRST-RUN FUNNEL:**
1. status
2. read readiness + blockingIssues + recommendedNextAction
3. /test_connection
4. /first_operation or /full_setup
**Parameter format examples:**
- Status check: {"action":"status"}
- Login: {"action":"login"}
- Callback: {"action":"callback","code":"4/0AX4XfWh..."}
- Feature setup: {"action":"setup_feature","feature":"connectors"}

**SETUP FEATURE:** Use setup_feature as the canonical path for optional capabilities. Responses include configured, verified, nextStep, and fallbackInstructions.`,

  //=============================================================================
  // CORE DATA OPERATIONS
  //=============================================================================

  sheets_core: `📋 CORE - Spreadsheet and sheet/tab management (${ACTION_COUNTS['sheets_core']} actions). Metadata, structure, URLs.

**DECISION GUIDE - Which action should I use?**
→ **Creating NEW spreadsheet?** Use create (creates entire Google Sheets file)
→ **Adding NEW TAB to existing spreadsheet?** Use add_sheet (creates sheet within file)
→ **Need metadata from 3+ spreadsheets?** Use batch_get (1 API call, NOT 3 separate calls)
→ **Deleting 3+ sheets/tabs?** Use batch_delete_sheets (1 API call, 80%+ savings)
→ **Updating 3+ sheet properties?** Use batch_update_sheets (1 call vs N calls)
→ **Just getting sheet names?** Use sheets_analyze.scout (faster, 0 data transfer)

**Use when:** Creating/copying/moving spreadsheets, adding/deleting/renaming sheet tabs, getting metadata and URLs

**NOT this tool - use instead:**
> sheets_data - Reading/writing CELL VALUES
> sheets_format - Cell colors, fonts, borders, styling
> sheets_composite.setup_sheet - New sheet + headers + formatting (2 calls total)
> sheets_analyze - Quick metadata + data + quality (faster!)

**ACTIONS BY CATEGORY:**
[Create/Copy] create (new spreadsheet), copy (copy spreadsheet), copy_sheet_to (copy sheet to another spreadsheet)
[Spreadsheet Management] get, batch_get (metadata from 3+ files), list, get_url
[Sheet Management] add_sheet (new tab), delete_sheet, duplicate_sheet, update_sheet, list_sheets, get_sheet, batch_delete_sheets, batch_update_sheets, move_sheet, clear_sheet
[Properties] update_properties (title, locale, timezone)
[Full Analysis] get_comprehensive (metadata + data + formulas in 1 call)

**⚠️ KEY DISTINCTION:**
- **create** = New Google Sheets FILE (entire spreadsheet with blank sheet)
- **add_sheet** = New TAB within existing file
- **sheets_analyze.scout** = Metadata only, no data transfer (faster for structure)
- **sheets_composite.setup_sheet** = Sheet + headers + format + freeze (2 calls)

**SAFETY:**
[Read-only] get, batch_get, list, list_sheets, get_sheet, get_url, get_comprehensive
[Destructive] delete_sheet, batch_delete_sheets, clear_sheet ← permanent, use sheets_confirm
[Safe mutation] create, copy, add_sheet, duplicate_sheet, update_sheet, update_properties, copy_sheet_to, move_sheet, batch_update_sheets

**TOP 3 ACTIONS:**
1. create: {"action":"create","title":"My Spreadsheet"} — Create new spreadsheet file
2. add_sheet: {"action":"add_sheet","spreadsheetId":"1ABC...","title":"New Sheet"} — Add new tab
3. batch_get: {"action":"batch_get","spreadsheetIds":["1ABC...","1DEF...","1GHI..."]} — 3 files, 1 call

**SMART ROUTING:**
- New file? → create (1 call)
- New sheet tab? → add_sheet (not create)
- New sheet + headers + formatting? → sheets_composite.setup_sheet (2 calls)
- Just sheet names? → sheets_analyze.scout (faster, 0 data)
- Managing 3+ sheets? → batch_delete_sheets or batch_update_sheets (1 call)
- Duplicate structure? → duplicate_sheet or sheets_composite.clone_structure`,

  sheets_data: `📝 DATA - Read and write cell values, notes, and hyperlinks (${ACTION_COUNTS['sheets_data']} actions). Append rows, find/replace text, merge cells.

**DECISION GUIDE - Which action should I use?**
→ **Need to add rows?** Use append (auto-finds last row at bottom) OR sheets_composite.smart_append (column-matched)
→ **Need multiple ranges?** Use batch_read / batch_write (1 API call, same cost as 1 read/write!)
→ **Need column matching?** Use sheets_composite.smart_append (auto-matches headers, safer than manual append)

**Use when:** Reading/writing cell values, appending rows, managing notes/links/validation, clipboard operations
**NOT this tool - use instead:**
> sheets_core - Managing SHEETS/TABS (add_sheet, delete_sheet)
> sheets_format - Applying CELL STYLES, colors, borders
> sheets_dimensions - Resizing, hiding, freezing ROWS/COLUMNS
> sheets_analyze - For analyzing DATA patterns and quality
**ACTIONS BY CATEGORY:**
[Read/Write] read, write, append, clear, batch_read, batch_write, batch_clear, find_replace
[Notes/Links] add_note, get_note, clear_note, set_hyperlink, clear_hyperlink
[Merge] merge_cells, unmerge_cells, get_merges
[Clipboard] cut_paste, copy_paste
[Spill Detection] detect_spill_ranges — find array formula spill regions
[Cross-Spreadsheet] cross_read (fetch+join from multiple spreadsheets), cross_query (NL query across spreadsheets), cross_write (copy data between spreadsheets), cross_compare (diff two ranges across spreadsheets)

**Range format:** "Sheet1!A1:D10" (case-sensitive; spaces/emoji: "'My Sheet'!A1:D10")

⚠️ **EMOJI SHEET NAMES:** ALWAYS use single quotes: "'📊 Dashboard'!A1:Z30" NOT "📊 Dashboard!A1:Z30"

ℹ️ **SPARKLINE NOTE:** SPARKLINE formulas render visually but API reads return empty values (expected behavior). Don't retry or investigate empty SPARKLINE reads.

**Parameter format examples:**
- Read single: {"action":"read","spreadsheetId":"1ABC...","range":"Sheet1!A1:D10"}
- Read batch: {"action":"batch_read","spreadsheetId":"1ABC...","ranges":["Sheet1!A1:D100","Sheet2!A1:B50"]} ← Same API cost as read, but gets 2 ranges!
- Write: {"action":"write","spreadsheetId":"1ABC...","range":"Sheet1!A1:D10","values":[["Name","Age"],["Alice",30]]}
- Write batch: {"action":"batch_write","spreadsheetId":"1ABC...","data":[{"range":"Sheet1!A1:D10","values":[...]},{"range":"Sheet2!A1:B20","values":[...]}]}
- Append: {"action":"append","spreadsheetId":"1ABC...","range":"Sheet1!A:D","values":[["Bob",25]]}
**SAFETY:**
[Read-only] read, batch_read, get_note, get_merges, detect_spill_ranges, cross_read, cross_query, cross_compare
[Destructive] write, clear, batch_write, batch_clear, cut_paste, cross_write ← requires confirmation for >100 cells
[Non-idempotent] append ← NEVER retry on timeout (duplicates rows)
[Safe mutation] find_replace, add_note, clear_note, set_hyperlink, clear_hyperlink, merge_cells, unmerge_cells, copy_paste

**Dynamic ranges:** Use \`dataFilter\` instead of hard-coded A1 ranges for production systems. Read \`knowledge:///search?q=dynamic ranges datafilter\` for full guide with examples.

**COMMON MISTAKES (AVOID!):**
1. Range format: ✅ "Sheet1!A1:D10" ✅ "'My Sheet'!A1:D10" | ❌ "A1:D10" (missing sheet name) | ❌ "Sheet1A1:D10" (wrong syntax)
2. Using write instead of append: ❌ write for new rows requires finding last row manually | ✅ append auto-finds last row
3. Multiple sequential reads instead of batch: ❌ Multiple read calls | ✅ batch_read in 1 call
4. Not validating before large writes: ❌ write directly | ✅ sheets_quality.validate first, then write

**CROSS-SPREADSHEET OPERATIONS:**
→ **Need data from multiple spreadsheets?** Use cross_read (parallel fetch + optional join by key column)
→ **Natural language query across sheets?** Use cross_query ("show revenue from Sales joined with costs from Finance")
→ **Copy data between spreadsheets?** Use cross_write (source → destination, with confirmation)
→ **Compare data across spreadsheets?** Use cross_compare (cell-level diff with delta percentages)

**Parameter format examples (cross-spreadsheet):**
- Cross read: {"action":"cross_read","sources":[{"spreadsheetId":"1ABC...","range":"Sheet1!A1:D100"},{"spreadsheetId":"2DEF...","range":"Sheet1!A1:D100"}],"joinKey":"ProductID"}
- Cross query: {"action":"cross_query","sources":[{"spreadsheetId":"1ABC...","range":"Sales!A1:D100"},{"spreadsheetId":"2DEF...","range":"Costs!A1:C50"}],"query":"total revenue minus costs by category"}
- Detect spills: {"action":"detect_spill_ranges","spreadsheetId":"1ABC...","sheetId":0}

**SMART ROUTING:**
- Need to add rows? → Use append (auto-finds last row) NOT write
- 3+ ranges to read/write? → Use batch_read/batch_write (same API cost!)
- 5+ operations that must succeed together? → Use sheets_transaction (1 API call, 80%+ savings)
- Bulk updating 50+ rows? → Use sheets_transaction OR sheets_composite.bulk_update
- Need column matching? → Use sheets_composite.smart_append instead
- Want to validate first? → Run sheets_quality.validate before write
- Need structure first? → Run sheets_analyze.scout (0 data transfer)
- Need data from multiple spreadsheets? → Use cross_read / cross_query (NOT manual multi-read)`,

  //=============================================================================
  // FORMATTING & STYLING
  //=============================================================================

  sheets_format: `🎨 FORMAT - Colors, fonts, borders, conditional rules & data validation (${ACTION_COUNTS['sheets_format']} actions).

**DECISION GUIDE - Which action should I use?**
→ **Formatting 3+ ranges?** Use batch_format (1 API call, 80%+ savings vs sequential)
→ **Need professional look?** Use apply_preset or sheets_composite.setup_sheet (2 calls total)
→ **Conditional formatting?** Use add_conditional_format_rule with presets (simpler than rule_add_). REQUIRED: sheetId (numeric — get from sheets_core.list_sheets, NOT sheet name). rulePreset enum: highlight_duplicates | highlight_blanks | highlight_errors | color_scale_green_red | color_scale_blue_red | data_bars | top_10_percent | bottom_10_percent | above_average | below_average | negative_red_positive_green | traffic_light | variance_highlight
→ **Data validation dropdowns?** Use set_data_validation
→ **Just 1-2 changes?** Use individual set_format (simple, direct)

**Use when:** Colors, fonts, borders, alignment, number formats, conditional rules, data validation, sparklines, rich text

**NOT this tool - use instead:**
> sheets_data - Reading/writing CELL VALUES
> sheets_dimensions - Row/column size, visibility, grouping
> sheets_core - Sheet/tab management
> sheets_advanced - Named ranges, protection
> sheets_composite.setup_sheet - Full setup (headers + format + freeze)

**ACTIONS BY CATEGORY:**
[Style] set_format, set_background, set_text_format, set_number_format, set_alignment, set_borders
[Batch] batch_format (3+ ranges, 1 call)
[Presets] apply_preset (instant professional look), suggest_format (AI recommendations)
[Conditional] add_conditional_format_rule (presets), rule_add_conditional_format (advanced), rule_update_conditional_format, rule_delete_conditional_format, rule_list_conditional_formats
[Validation] set_data_validation (dropdowns), clear_data_validation, list_data_validations
[Sparklines] sparkline_add, sparkline_get, sparkline_clear
[Rich Text] set_rich_text (bold, color, link in one cell)

**⚡ PERFORMANCE:**
- **1-2 ranges:** Individual set_format (1 call each)
- **3+ ranges:** batch_format (1 call total, 80%+ savings)
- **New sheet:** sheets_composite.setup_sheet (2 calls, includes headers + format + freeze)

**SAFETY:**
[Read-only] suggest_format, rule_list_conditional_formats, list_data_validations, sparkline_get
[Safe mutation] set_format, set_background, set_text_format, set_number_format, set_alignment, set_borders, batch_format, apply_preset, clear_format, set_data_validation, clear_data_validation, add_conditional_format_rule, rule_add_conditional_format, rule_update_conditional_format, rule_delete_conditional_format, sparkline_add, sparkline_clear, set_rich_text
[Destructive] rule_delete_conditional_format

**TOP 3 ACTIONS:**
1. batch_format: {"action":"batch_format","spreadsheetId":"1ABC...","operations":[{"type":"background","range":"Sheet1!A1:A10","color":{"red":0.8,"green":0.9,"blue":1}},{"type":"text_format","range":"Sheet1!1:1","bold":true}]} — 2+ ranges, 1 call
   NOTE: param is "operations" (NOT "requests"). type enum: background | text_format | number_format | alignment | borders | format | preset
2. apply_preset: {"action":"apply_preset","spreadsheetId":"1ABC...","range":"Sheet1!A1:D10","preset":"header_row"} — Instant professional look
3. set_data_validation: {"action":"set_data_validation","spreadsheetId":"1ABC...","range":"Sheet1!D2:D100","type":"list","values":["Option 1","Option 2"]} — Dropdowns`,

  //=============================================================================
  // DIMENSIONS & STRUCTURE
  //=============================================================================

  sheets_dimensions: `📐 DIMENSIONS - Rows, columns, filters, sorting (${ACTION_COUNTS['sheets_dimensions']} actions).

**DECISION GUIDE - Which action should I use?**
→ **Need 3+ dimension changes?** Use sheets_transaction (1 API call, 80%+ savings)
→ **Setting up new sheet?** Use sheets_composite.setup_sheet (includes freeze + headers in 2 calls)
→ **Just 1-2 changes?** Use individual actions
→ **Deleting rows/columns?** ALWAYS delete from BOTTOM to TOP (indices shift!)
→ **Freezing header row?** Use freeze (dimension:"ROWS", count:1)

**Use when:** Insert/delete/move rows or columns, freeze/hide/group, apply filters, sort data, resize columns, create slicers

**NOT this tool - use instead:**
> sheets_data - Reading/writing CELL VALUES or content
> sheets_format - Colors, fonts, borders, styling
> sheets_core - Managing entire SHEETS or tabs
> sheets_analyze - Understanding data before filtering
> sheets_composite - Setting up new sheet (use setup_sheet instead)

**ACTIONS BY CATEGORY:**
[Insert/Delete/Move] insert (add rows/cols), append (add at end), delete (DESTRUCTIVE, NOT idempotent), move, resize, auto_resize
[Visibility] hide, show, freeze (lock top/left rows/cols)
[Grouping] group, ungroup (collapsible sections)
[Filters] set_basic_filter (auto-dropdown on headers), clear_basic_filter, get_basic_filter
[Filter Views] create_filter_view, duplicate_filter_view, update_filter_view, delete_filter_view, list_filter_views, get_filter_view
[Sort] sort_range (by column)
[Slicers] create_slicer, update_slicer, delete_slicer, list_slicers
[Utils] trim_whitespace, randomize_range, text_to_columns, auto_fill

**⚠️ CRITICAL - NOT IDEMPOTENT:**
- **insert/delete are NOT idempotent** — calling twice = double effect (10 rows inserted twice = 20 rows)
- **ALWAYS delete from BOTTOM to TOP** — deleting row 3 shifts row 5 to row 4, so delete row 7 first, then 5, then 3
- **NEVER retry on timeout** — verify state first (get current count, then insert once)

**SAFETY:**
[Read-only] get_basic_filter, list_filter_views, get_filter_view, list_slicers
[Destructive] delete (permanent, NOT idempotent), delete_filter_view, delete_slicer, clear_basic_filter
[Non-idempotent] insert, append (calling twice doubles effect)
[Safe mutation] move, resize, auto_resize, hide, show, freeze, group, ungroup, sort_range, trim_whitespace, randomize_range, text_to_columns, auto_fill, set_basic_filter, create_filter_view, update_filter_view, create_slicer, update_slicer

**TOP 3 ACTIONS:**
1. freeze: {"action":"freeze","spreadsheetId":"1ABC...","sheetId":0,"dimension":"ROWS","count":1} — Lock header row
2. sort_range: {"action":"sort_range","spreadsheetId":"1ABC...","range":"Sheet1!A1:D100","sortSpecs":[{"columnIndex":0,"sortOrder":"DESCENDING"}]} — Sort by column
3. insert: {"action":"insert","spreadsheetId":"1ABC...","sheetId":0,"dimension":"ROWS","startIndex":5,"count":10} — Add 10 rows at position 5

**PARAMETERS:**
- dimension: "ROWS" or "COLUMNS" (uppercase)
- sheetId: Numeric ID from sheets_core.list_sheets (0, 123456789, etc.)
- range: "Sheet1!A1:D100" (required for sort_range, case-sensitive)
- auto_resize: REQUIRES numeric sheetId (NOT sheetName). dimension enum: "ROWS" | "COLUMNS" (omit for both axes)

**COMMON WORKFLOWS:**
- New sheet + headers? → sheets_composite.setup_sheet (freeze + format in 2 calls)
- Delete multiple rows? → Delete from BOTTOM to TOP (indices don't shift)
- Bulk insert? → Use sheets_transaction to batch (1 API call)
- Filter + sort? → set_basic_filter then sort_range`,

  //=============================================================================
  // VISUALIZATION
  //=============================================================================

  sheets_visualize: `📊 VISUALIZE - Charts and pivot tables (${ACTION_COUNTS['sheets_visualize']} actions).

**DECISION GUIDE - Which action should I use?**
→ **Not sure what chart to create?** Use suggest_chart (AI recommendations)
→ **Need to aggregate/summarize data?** Use pivot_create or suggest_pivot (cross-tabulation, grouping)
→ **Creating a chart?** Use chart_create with chartType (BAR, LINE, PIE, SCATTER, COLUMN, AREA, COMBO)
→ **Moving/resizing a chart?** Use chart_move or chart_resize

**Use when:** Creating charts, pivot tables, updating visualizations, moving/resizing, refreshing data sources

**NOT this tool - use instead:**
> sheets_data - Reading/writing SOURCE DATA
> sheets_format - Styling the SOURCE data (not the chart itself)
> sheets_dimensions - Source data structure changes

**ACTIONS BY CATEGORY:**
[Recommendations] suggest_chart (AI suggests chart type), suggest_pivot (AI suggests aggregation)
[Charts] chart_create, chart_update, chart_delete, chart_list, chart_get, chart_move, chart_resize, chart_update_data_range
[Trendlines] chart_add_trendline (REST API support limited — may fail; falls back to helpful error with Sheets UI instructions), chart_remove_trendline
[Pivots] pivot_create, pivot_update, pivot_delete, pivot_list, pivot_get, pivot_refresh

**SAFETY:**
[Read-only] suggest_chart, suggest_pivot, chart_list, chart_get, pivot_list, pivot_get
[Safe mutation] chart_create, chart_update, chart_move, chart_resize, chart_update_data_range, pivot_create, pivot_update, pivot_refresh, chart_add_trendline
[Destructive] chart_delete, chart_remove_trendline, pivot_delete

**TOP 3 ACTIONS:**
1. suggest_chart: {"action":"suggest_chart","spreadsheetId":"1ABC...","range":"Sheet1!A1:D100"} — Get AI recommendations
2. chart_create: {"action":"chart_create","spreadsheetId":"1ABC...","sheetId":0,"chartType":"LINE","data":{"sourceRange":"Sheet1!A1:B10"},"position":{"anchorCell":"Sheet1!E2"}} — Create chart
3. pivot_create: {"action":"pivot_create","spreadsheetId":"1ABC...","sourceRange":"Sheet1!A1:D100","rows":[{"sourceColumnOffset":0}],"values":[{"sourceColumnOffset":3,"summarizeFunction":"SUM"}]} — Create pivot

**PARAMETERS:**
- chartType enum (17 values): BAR | LINE | AREA | COLUMN | SCATTER | COMBO | STEPPED_AREA | PIE | DOUGHNUT | TREEMAP | WATERFALL | HISTOGRAM | CANDLESTICK | ORG | RADAR | SCORECARD | BUBBLE (case-insensitive)
- legendPosition enum: BOTTOM_LEGEND | LEFT_LEGEND | RIGHT_LEGEND | TOP_LEGEND | NO_LEGEND (case-insensitive)
- anchorCell: Prefer "Sheet1!E2"; if you only have "E2", also set position.sheetId
- sourceRange: "Sheet1!A1:D100" (case-sensitive)
- sheetId: Numeric from sheets_core.list_sheets (0, 123456789)

**WORKFLOW:**
- Not sure? → suggest_chart → review → chart_create
- Aggregating? → suggest_pivot → review → pivot_create
- Updating data? → chart_update_data_range (refresh linked range)`,

  //=============================================================================
  // COLLABORATION
  //=============================================================================

  sheets_collaborate: `👥 COLLABORATE - Sharing, comments, versions, snapshots & approvals (${ACTION_COUNTS['sheets_collaborate']} actions).

**DECISION GUIDE - Which action should I use?**
→ **Need to share with users or change permissions?** Use share_add/share_update/share_remove. REQUIRED for share_add: type (user|group|domain|anyone) AND role (writer|reader|commenter) AND emailAddress
→ **Adding comments or building discussion?** Use comment_add/comment_update/comment_resolve (with optional replies)
→ **Before destructive operation (delete, clear)?** Use version_create_snapshot, then poll version_snapshot_status until complete
→ **Find when data changed?** Use version_list_revisions + version_compare (across-session file history, NOT this session)
→ **Need multi-user approval workflow?** Use approval_create/approval_approve/approval_reject (audit trail)

**Use when:** Sharing files with users/groups, managing comments/discussions, creating backups, viewing file version history, transferring ownership, approval workflows

**NOT this tool - use instead:**
> sheets_advanced - PROTECTING specific cell ranges (not sharing entire file)
> sheets_history - OPERATION history THIS SESSION (undo/redo) — use this for across-session file history
> sheets_data - Writing or reading CELL VALUES
> sheets_session - CONVERSATION context

**ACTIONS BY CATEGORY:**
[Sharing] share_add, share_update, share_remove, share_list, share_get, share_transfer_ownership, share_set_link, share_get_link
[Comments] comment_add, comment_update, comment_delete, comment_list, comment_get, comment_resolve, comment_reopen, comment_add_reply, comment_update_reply, comment_delete_reply
[File Versions] version_list_revisions, version_get_revision, version_restore_revision, version_keep_revision, version_create_snapshot, version_snapshot_status, version_list_snapshots, version_restore_snapshot, version_delete_snapshot, version_compare, version_export
[Approvals] approval_create, approval_approve, approval_reject, approval_get_status, approval_list_pending, approval_delegate, approval_cancel

**⚠️ KEY DISTINCTIONS:**
- version_* = File revisions (Google Drive history, across sessions + users)
- sheets_history = Operation audit (this session only, ServalSheets ops)
- Snapshots = Explicit backups before changes (restore entire snapshot)
- Restore cells = sheets_history.restore_cells (surgical — restore just specific cells from past revision)

**SAFETY:**
[Read-only] share_list, share_get, share_get_link, comment_list, comment_get, version_list_revisions, version_get_revision, version_snapshot_status, version_list_snapshots, version_compare, version_export, approval_get_status, approval_list_pending
[Destructive] share_remove, comment_delete, comment_delete_reply, version_restore_revision, version_restore_snapshot, version_delete_snapshot, approval_cancel ← irreversible or data-altering
[Non-idempotent] share_transfer_ownership ← IRREVERSIBLE, cannot undo
[Safe mutation] share_add, share_update, share_set_link, comment_add, comment_update, comment_resolve, comment_reopen, comment_add_reply, comment_update_reply, version_create_snapshot, version_keep_revision, approval_create, approval_approve, approval_reject, approval_delegate

**COMMON WORKFLOWS:**
- Multi-user editing? → share_add (with role) → comment_add (discussions) → version_create_snapshot (before cleanup)
- Data governance? → approval_create (requires review) → approval_approve (audit trail) → version_keep_revision (pin)
- Cross-session recovery? → version_list_revisions → version_compare → version_restore_revision (full revert) OR sheets_history.restore_cells (surgical)`,

  //=============================================================================
  // ANALYSIS & INTELLIGENCE
  //=============================================================================

  sheets_analyze: `🤖 ANALYZE - AI-powered spreadsheet insights & recommendations (${ACTION_COUNTS['sheets_analyze']} actions). Use for discovery, explanation, and planning.

**Use this first ONLY when:**
- The spreadsheet is unfamiliar and you need context before choosing another tool
- The user asked for exploration, auditing, diagnosis, or recommendations
- You need AI help planning a multi-step change safely

**Skip this tool when:**
- The user already gave a precise read/write/format/structure request
- You already know the exact target range, action, or sheet mutation needed
- Another specialist tool clearly matches the request (data, format, dimensions, collaborate, advanced, etc.)

**DECISION GUIDE - Which action should I use?**
→ **Quick overview only?** Use scout (metadata only, 0 data transfer, ~200ms)
→ **Full analysis (all categories)?** Use comprehensive (metadata + data + quality + formulas)
→ **Specific category only?** Use analyze_quality/analyze_formulas/analyze_performance (focused deep-dive)
→ **Need a chart/pivot?** Use suggest_chart or suggest_pivot
→ **Proactive suggestions?** Use suggest_next_actions (ranked improvements with executable params)
→ **Auto-fix safe issues?** Use auto_enhance with mode:"preview" then mode:"apply"

**Use when:** Understanding sheet structure/quality, getting AI insights, detecting patterns, generating formulas, getting improvement suggestions

**NOT this tool - use instead:**
> sheets_quality - VALIDATING data before writing
> sheets_data - Writing/reading CELL VALUES
> sheets_fix - AUTO-FIXING issues after diagnosis or when the cleanup path is already clear
> sheets_dependencies - FORMULA relationships

**ACTIONS BY CATEGORY:**
[Discovery] scout (metadata only, fast), comprehensive (full audit, 43 categories), analyze_structure
[Analysis] analyze_data, analyze_quality, analyze_formulas, analyze_performance, detect_patterns
[AI] generate_formula (describe → formula), generate_actions, explain_analysis, query_natural_language
[Workflow] plan, execute_plan, drill_down
[Copilot] suggest_next_actions (ranked improvements), auto_enhance (auto-apply safe changes)

**⚠️ KEY DISTINCTIONS:**
- **scout** = Metadata only (sheet names, column count) → Best first step for unfamiliar sheets
- **comprehensive** = All analysis (metadata + data + quality + formulas + recommendations) → Use for full audits or after scout
- **suggest_next_actions** = Ranked suggestions with executable params → Get proactive ideas
- **auto_enhance** = Auto-apply safe improvements (freeze, format, resize) → Mode: preview or apply

**SAFETY:**
[Read-only] comprehensive, scout, analyze_*, detect_patterns, generate_formula, explain_analysis, query_natural_language, plan, drill_down, generate_actions, suggest_next_actions
[Safe mutation] auto_enhance (mode:"apply", non-destructive only: freeze, format, resize)

**TOP 3 ACTIONS:**
1. scout: {"action":"scout","spreadsheetId":"1ABC..."} — Fast structural overview
2. comprehensive: {"action":"comprehensive","spreadsheetId":"1ABC..."} — Full audit across categories
3. suggest_next_actions: {"action":"suggest_next_actions","spreadsheetId":"1ABC...","maxSuggestions":5} — Ranked improvements

**WORKFLOWS:**
- **Unfamiliar sheet?** → scout → comprehensive if you need a full audit
- **Just need structure?** → scout (fast, 0 data)
- **Need ideas?** → suggest_next_actions (proactive suggestions)
- **Apply improvements?** → auto_enhance with mode:"preview" → mode:"apply"
- **Planning changes?** → plan → execute_plan → drill_down
- **Large/complex?** → scout → plan → execute_plan → drill_down`,

  //=============================================================================
  // ADVANCED FEATURES
  //=============================================================================

  sheets_advanced: `⚙️ ADVANCED - Named ranges, protection, metadata, banding & tables (${ACTION_COUNTS['sheets_advanced']} actions). Infrastructure for large sheets.

**DECISION GUIDE - Which action should I use?**
→ **Need cells to reference other cells by name?** Use add_named_range (formulas: =SUM(Revenue) instead of =SUM(B2:B100))
→ **Prevent users from editing specific cells?** Use add_protected_range (lock formula cells, unlock data entry cells)
→ **Add alternating row colors for readability?** Use add_banding then list_banding first (check if exists to avoid error)
→ **Organize data as structured table?** Use create_table for the table object, then add_banding separately if you want alternating colors
→ **Store custom metadata for programmatic access?** Use set_metadata (custom attributes, not visible in UI)

**Use when:** Creating named ranges, protecting ranges, organizing data as tables, adding alternating row colors, storing custom metadata, creating smart chips (person/file links)

**NOT this tool - use instead:**
> sheets_data - Writing or reading CELL VALUES
> sheets_format - Colors, fonts, borders (use set_format instead)
> sheets_dimensions - Hiding/freezing rows/columns, row/column operations
> sheets_collaborate - SHARING with other users or PROTECTING entire sheet

**ACTIONS BY CATEGORY:**
[Named Ranges] add_named_range, update_named_range, delete_named_range, list_named_ranges, get_named_range — Formulas use "Revenue" instead of "B2:B100"
[Protection] add_protected_range, update_protected_range, delete_protected_range, list_protected_ranges — Lock formula cells, unlock data cells
[Metadata] set_metadata, get_metadata, delete_metadata — Custom app attributes (not visible to users)
[Banding] add_banding, update_banding, delete_banding, list_banding — Alternating row colors
[Tables] create_table, delete_table, list_tables, update_table, rename_table_column, set_table_column_properties — Structured ranges with filters (banding is a separate add_banding step)
[Smart Chips] add_person_chip, add_drive_chip, add_rich_link_chip, list_chips — Linked references. Note: For write operations, only Drive file links are supported via add_rich_link_chip. Reading back smart chips via list_chips can return YouTube, Calendar, and People chip types, but these cannot be created via the API.
[Named Functions] create_named_function, update_named_function, delete_named_function, list_named_functions, get_named_function — Compatibility stubs; currently return FEATURE_UNAVAILABLE because the live Sheets API does not expose named functions reliably

**⚠️ BANDING PRE-CHECK:** list_banding BEFORE add_banding (adding to range that already has banding fails silently). Protection always requires editor list.

**SAFETY:**
[Read-only] list_named_ranges, get_named_range, list_protected_ranges, get_metadata, list_banding, list_tables, list_chips, list_named_functions, get_named_function
[Destructive] delete_named_range, delete_protected_range, delete_metadata, delete_banding, delete_table, delete_named_function ← permanent
[Safe mutation] add_named_range, update_named_range, add_protected_range, update_protected_range, set_metadata, add_banding, update_banding, create_table, update_table, rename_table_column, set_table_column_properties, add_person_chip, add_drive_chip, add_rich_link_chip, create_named_function, update_named_function

**COMMON PATTERN:**
- Financial sheet? → create_table (A1:E100) → add_banding → add_protected_range (formula row) → add_named_range (for SUM formulas)
- Data entry form? → add_protected_range (lock instructions) → unprotectedRanges (data entry only) → add_named_range (field references)`,

  //=============================================================================
  // ENTERPRISE / SAFETY
  //=============================================================================

  sheets_transaction: `🔄 TRANSACTION - Atomic batch operations (${ACTION_COUNTS['sheets_transaction']} actions).

**DECISION GUIDE - Should I use transactions?**
→ **1-4 simple operations?** Use direct tool calls (overhead exceeds benefit, skip transaction overhead)
→ **5+ operations that must succeed/fail together?** Use transactions (1 API call total, 80%+ savings)
→ **Bulk update 50+ rows?** Use transactions OR sheets_composite.bulk_update (both atomic, similar savings)
→ **Mix of different operation types?** Use transactions (begin → queue → commit = atomic execution)
→ **Sequential non-dependent ops?** Use direct calls (no atomicity needed, don't add transaction overhead)

**ROUTING - Pick this tool when:**
> You need 5+ operations to succeed or fail TOGETHER
> Bulk updates/imports (>50 rows with different values)
> Operations where atomicity matters (all-or-nothing)
> You want to SAVE API QUOTA (80-95% savings)

**NOT this tool - use instead:**
> Direct tool calls for 1-4 simple operations (transaction overhead exceeds benefit)
> sheets_composite for high-level operations (import_csv, smart_append, bulk_update)
> Single read/write operations (no need for atomicity)

**ACTIONS (6):** begin, queue, commit, rollback, status, list

**COST:** 100 writes = 1 API call with transaction. Use for 5+ operations (80-95% savings).

**Parameter format examples:**
1. begin: {"action":"begin","spreadsheetId":"1ABC..."} -> Get transactionId
2. queue: {"action":"queue","transactionId":"tx_123","operation":{...}} -> Add operations (0 API cost!)
3. queue: {"action":"queue","transactionId":"tx_123","operation":{...}} -> Add more operations
4. commit: {"action":"commit","transactionId":"tx_123"} -> Execute ALL atomically in 1 call
5. rollback: {"action":"rollback","transactionId":"tx_123"} -> Discard all queued operations

**transactionId format:** Returned from begin action: "tx_abc123..."
**operation format:** Any valid sheets_data or sheets_dimensions request without spreadsheetId (transaction context)

**WORKFLOW:** begin → queue (0 cost) → queue → commit (1 API call). NOT: begin → queue → commit → queue → commit.
**RULE:** Only use for 5+ operations OR when atomicity is critical.`,

  sheets_quality: `✅ QUALITY - Data validation & conflict detection (${ACTION_COUNTS['sheets_quality']} actions).

**Use BEFORE writes.** Run validate before sheets_data/sheets_transaction.

**ROUTING - Pick this tool when:**
> VALIDATING individual values or entire datasets before writing (email formats, required fields, data types)
> Detecting CONFLICTS from concurrent/simultaneous edits
> Analyzing IMPACT of a planned operation on dependent formulas or data
> Pre-flight checks before destructive operations

**NOT this tool - use instead:**
> sheets_analyze - For comprehensive data QUALITY ANALYSIS (patterns, issues, suggestions)
> sheets_format - For adding VALIDATION RULES to cells (dropdowns, data validation)
> sheets_data - For WRITING the validated data

**ACTIONS (4):** validate, detect_conflicts, resolve_conflict, analyze_impact

**SAFETY GATE - WHEN TO VALIDATE:**
Call validate BEFORE large writes (>100 cells) to catch format errors, type mismatches, and constraint violations BEFORE they hit the API:
❌ RISKY: Write 500 cells, discover halfway through they're wrong type
✅ SAFE: validate all 500 cells (instant), then write

Example: {"action":"validate","value":"test@email.com","rules":["not_empty","valid_email"]}

**TOP 3 ACTIONS:**
1. validate: {"action":"validate","value":"test@email.com","rules":["not_empty","valid_email"]}
2. analyze_impact (tool+action form): {"action":"analyze_impact","spreadsheetId":"1ABC...","operation":{"tool":"sheets_data","action":"clear","params":{"spreadsheetId":"1ABC...","range":"Sheet1!A1:A100"}}}
   analyze_impact (description form): {"action":"analyze_impact","spreadsheetId":"1ABC...","operation":{"description":"delete rows A1:A100"}}
3. detect_conflicts: {"action":"detect_conflicts","spreadsheetId":"1ABC..."}

**validate builtin rule IDs — 11 values (use in \`rules\` array, MUST be exact strings):**
builtin_string | builtin_number | builtin_boolean | builtin_date | builtin_positive | builtin_non_negative | builtin_email | builtin_url | builtin_phone | builtin_required | builtin_non_empty_string
⚠️ LIMITATIONS: No custom rule expressions. No natural language rules. Only these 11 builtin IDs are supported. For complex validation, use sheets_format.set_data_validation instead.
**impact operation object:** at least one of \`type\`, \`tool\`, \`action\`, or \`description\` required.
- Tool+action form: \`{ "tool": "sheets_data", "action": "write", "params": { "spreadsheetId": "...", "range": "Sheet1!A1:B10" } }\`
- Description form: \`{ "description": "delete column B" }\` (simpler, uses natural language)

**PRE-WRITE WORKFLOW:**
1. Plan operation (which cells, what values)
2. sheets_quality.validate → Check for errors
3. sheets_quality.analyze_impact → Check formula dependencies
4. sheets_data.write → Execute with confidence

**USE BEFORE:** Large writes, deletes, or concurrent editing scenarios. Use analyze_impact to check formula dependencies.`,

  sheets_history: `📜 HISTORY - Operation audit, undo/redo & time-travel (${ACTION_COUNTS['sheets_history']} actions).

**DECISION GUIDE - Which action should I use?**
→ **Undo recent ServalSheets operation?** Use undo (this session only)
→ **When did a value change?** Use timeline (who/what/when across sessions)
→ **Compare two time points?** Use diff_revisions (cell-level diff between revisions)
→ **Restore just specific cells?** Use restore_cells (surgical, not full revert)
→ **Need full file restore?** Use sheets_collaborate.version_restore_revision

**Use when:** Undoing recent ops, finding when data changed, comparing versions, restoring specific cells

**NOT this tool - use instead:**
> sheets_collaborate.version_* — Full file restore or snapshots (across sessions)
> sheets_session — Conversation context and natural language references
> sheets_analyze — Data quality insights

**ACTIONS BY CATEGORY:**
[Session Audit] list (operations), get, stats, undo, redo, revert_to, clear
[Time-Travel] timeline (who/what/when), diff_revisions (compare revisions), restore_cells (surgical restore)

**⚠️ KEY DISTINCTIONS:**
- **undo/redo/revert_to** = Session scope (THIS conversation only, ServalSheets ops only)
- **timeline/diff_revisions/restore_cells** = File scope (Google Drive history, all users, across sessions)
- **Full restore** = sheets_collaborate.version_restore_revision (all-or-nothing)
- **Surgical restore** = sheets_history.restore_cells (just specific cells)

**SAFETY:**
[Read-only] list, get, stats, timeline, diff_revisions
[Destructive] clear (erases operation history), restore_cells (overwrites current cell values)
[Non-idempotent] undo, redo (calling twice reverses operation)

**TOP 3 ACTIONS:**
1. timeline: {"action":"timeline","spreadsheetId":"1ABC...","range":"Sheet1!D1:D100","since":"2026-02-01"} — When did data change?
2. undo: {"action":"undo","spreadsheetId":"1ABC..."} — Revert last ServalSheets operation
3. restore_cells: {"action":"restore_cells","spreadsheetId":"1ABC...","revisionId":"123","cells":["Sheet1!D15","Sheet1!E20"]} — Restore just those cells

**RECOVERY WORKFLOWS:**
- **Quick undo?** → undo (session only)
- **Find what changed?** → timeline (who/what/when) → diff_revisions (full diff) → restore_cells (fix)
- **Full file restore?** → sheets_collaborate.version_restore_revision (all-or-nothing)

**⚠️ LIMITS:**
- Session history: Last 100 ops per spreadsheet
- Drive revision retention: Auto-deletes after 30 days (pin with sheets_collaborate.version_keep_revision)
- timeline/diff_revisions: Empty if revisions expired`,

  sheets_confirm: `⚠️ CONFIRM - User confirmation before destructive operations (${ACTION_COUNTS['sheets_confirm']} actions).

**ROUTING - Pick this tool when:**
> You've PLANNED a multi-step operation and need user approval
> The operation is DESTRUCTIVE (deletes, overwrites >100 cells)
> The operation has HIGH RISK (irreversible, affects formulas)
> You want the user to review steps BEFORE execution

**NOT this tool - use instead:**
> Direct tool calls for SINGLE low-risk operations
> sheets_quality analyze_impact - To check impact BEFORE building a plan

**ACTIONS (5):** request, get_stats, wizard_start, wizard_step, wizard_complete

**HOW IT WORKS (MCP Elicitation SEP-1036):**
1. Claude builds a plan with steps, risks, estimates
2. sheets_confirm.request presents the plan to the user
3. User sees interactive UI in Claude Desktop/client
4. User approves/modifies/declines
5. Claude receives result and acts accordingly

**Parameter format examples:**
1. Build your plan:
   {
     "action": "request",
     "plan": {
       "title": "Delete Duplicate Rows",
       "description": "Remove 150 duplicate rows from Sales sheet",
       "steps": [
         {"stepNumber":1, "description":"Identify duplicates", "tool":"sheets_analyze", "action":"comprehensive", "risk":"low"},
         {"stepNumber":2, "description":"Delete 150 rows", "tool":"sheets_dimensions", "action":"delete", "risk":"high", "isDestructive":true}
       ],
       "willCreateSnapshot": true,
       "additionalWarnings": ["This cannot be undone without the snapshot"]
     }
   }

2. Check result:
   - If approved: Execute the plan using sheets_transaction
   - If declined: Explain what was avoided, ask for alternatives
   - If modified: Parse modifications, adjust plan, re-confirm if needed

**WHEN TO USE:**
- delete_rows/delete_columns affecting >10 rows
- write/batch_write affecting >100 cells
- share_transfer_ownership (irreversible)
- Any operation chain with 3+ steps
- Operations the user hasn't explicitly approved

**TIP:** Always include risk levels and isDestructive flags for each step.`,

  sheets_fix: `🔧 FIX - Auto-fix issues & data cleaning (${ACTION_COUNTS['sheets_fix']} actions).

**DECISION GUIDE - Which action should I use?**
→ **sheets_analyze found issues?** Use fix (resolves volatile formulas, missing freezes)
→ **Messy data (whitespace, duplicates)?** Use suggest_cleaning first, then clean
→ **Different date/currency formats?** Use standardize_formats (normalize to one format)
→ **Empty cells?** Use fill_missing (strategy enum: forward | backward | mean | median | mode | constant). IMPORTANT: add mode:"apply" to write values — default mode:"preview" only shows what would change
→ **Statistical outliers?** Use detect_anomalies (IQR or z-score)

**Use when:** Auto-fixing formula/structure issues, cleaning messy data, standardizing formats, filling gaps, detecting anomalies

**NOT this tool - use instead:**
> sheets_analyze - To DETECT issues first (comprehensive or analyze_quality)
> sheets_data/sheets_format - For MANUAL targeted changes
> sheets_quality - For data VALIDATION before writing

**ACTIONS BY CATEGORY:**
[Issue Resolution] fix (formula issues, missing freezes)
[Data Cleaning] clean (auto-detect issues), suggest_cleaning (AI recommendations)
[Format Standardization] standardize_formats (dates, currencies, phones → consistent)
[Gap Filling] fill_missing (forward, backward, mean, median, mode, constant)
[Anomaly Detection] detect_anomalies (IQR, z-score outlier flagging)

**SAFETY:**
[Read-only] suggest_cleaning, detect_anomalies
[Safe mutation] fix, clean (with mode:"apply"), standardize_formats, fill_missing

**TOP 3 ACTIONS:**
1. suggest_cleaning: {"action":"suggest_cleaning","spreadsheetId":"1ABC...","range":"Sheet1!A1:Z100"} — Get AI recommendations
2. clean: {"action":"clean","spreadsheetId":"1ABC...","range":"Sheet1!A1:Z100","mode":"preview"} — See proposed changes
3. standardize_formats: {"action":"standardize_formats","spreadsheetId":"1ABC...","range":"Sheet1!A1:Z100","columns":[{"column":"B","targetFormat":"iso_date"}]} — Normalize formats

**DATA CLEANING WORKFLOW:**
1. suggest_cleaning → Get AI recommendations
2. clean mode:"preview" → Review proposed changes (snapshot created)
3. clean mode:"apply" → Execute (with rollback via snapshot)

**BUILT-IN RULES:** trim_whitespace, fix_dates, fix_numbers, fix_booleans, remove_duplicates, fix_emails, fix_phones
**FORMAT TARGETS (all 16):** iso_date | us_date | eu_date | currency_usd | currency_eur | currency_gbp | number_plain | percentage | phone_e164 | phone_national | email_lowercase | url_https | title_case | upper_case | lower_case | boolean
**FILL STRATEGIES:** forward, backward, mean, median, mode, constant`,

  //=============================================================================
  // COMPOSITE OPERATIONS
  //=============================================================================

  sheets_composite: `🔗 COMPOSITE - Pre-optimized multi-step workflows (${ACTION_COUNTS['sheets_composite']} actions). 60-80% fewer API calls than manual approach.

**DECISION GUIDE - Pick the right action**
→ **Setting up new sheet (headers + format)?** Use setup_sheet (2 calls vs 6 manual)
→ **Adding rows with column matching?** Use smart_append (auto-matches headers, safer than append)
→ **Importing CSV file?** Use import_csv (parse + validate + write in 1 call)
→ **Bulk updating many rows?** Use bulk_update (atomic, with preview mode)
→ **Removing duplicates?** Use deduplicate with preview:true first
→ **Generating from description?** Use generate_sheet (AI-powered: structure + formulas + formatting)
→ **Exporting to file?** Use export_xlsx or publish_report (PDF/XLSX/CSV with formatting preserved)
→ **Run ETL pipeline?** Use data_pipeline (filter → sort → deduplicate → transform in 1 call)

**Use when:** Setting up sheets, importing/exporting, bulk updates, deduplication, column matching, AI generation, data pipelines, auditing, migration

**NOT this tool - use instead:**
> sheets_data - Single read/write/append operations
> sheets_transaction - Custom multi-op workflows needing atomicity
> sheets_core - Creating spreadsheets without templates
> sheets_format - One-off format changes
> sheets_analyze - Getting recommendations before operations

**ACTIONS BY CATEGORY:**
[Sheet Setup] setup_sheet (headers + format + freeze in 2 calls)
[Import/Export] import_csv, import_xlsx, import_and_format, export_xlsx, export_large_dataset, get_form_responses
[Smart Operations] smart_append (auto-match columns), bulk_update (atomic), deduplicate (with preview), clone_structure
[AI Generation] generate_sheet (description → spreadsheet), generate_template (reusable), preview_generation (dry-run)
[Audit & Report] audit_sheet (formula/type/blank analysis), publish_report (PDF/XLSX/CSV export with formatting)
[Pipeline & Migrate] data_pipeline (ETL: filter→sort→dedup→transform), instantiate_template (template + {{placeholder}}), migrate_spreadsheet (column mapping)

**⚡ TOP 3 ACTIONS:**
1. **setup_sheet:** Headers + formatting + freeze → 2 API calls (vs 6-7 manual)
2. **smart_append:** Auto-match columns by header name → Safer, no manual mapping
3. **import_csv:** Parse + validate + write → 1 call (auto detects types)

**Savings:** 60-80% fewer API calls. Example: setup_sheet = sheets_core.add_sheet + sheets_data.write + sheets_format (3 ops) = 1 call in composite.

**SAFETY:**
[Read-only] export_xlsx, export_large_dataset, get_form_responses, audit_sheet, publish_report (PDF/XLSX/CSV), preview_generation
[Safe mutation] setup_sheet, smart_append, import_csv, import_xlsx, import_and_format, clone_structure, generate_sheet, generate_template, instantiate_template
[Requires confirmation] bulk_update (>50 rows), deduplicate, migrate_spreadsheet
[Requires snapshot] bulk_update, deduplicate (if mode:"apply")

**COMMON WORKFLOWS:**
- New sheet? → setup_sheet OR generate_sheet (AI: description → full sheet)
- Import + clean? → import_csv → deduplicate with preview:true
- Bulk update? → bulk_update with preview:true first, then mode:"apply"
- Data pipeline? → data_pipeline (filter → sort → dedup → aggregate in 1 call)
- Migrate files? → migrate_spreadsheet (with column mapping)
- Quality audit? → audit_sheet → publish_report (export with formatting)`,

  //=============================================================================
  // SESSION CONTEXT
  //=============================================================================

  sheets_session: `📋 SESSION - Conversation context for natural language (${ACTION_COUNTS['sheets_session']} actions).

**Tip:** Call action:"set_active" early to enable natural language references. Checkpoints require ENABLE_CHECKPOINTS=true.

**ROUTING - Pick this tool when:**
> Setting the "active" spreadsheet for natural language references
> Recording operations for undo support in this conversation
> Resolving references like "the spreadsheet", "that sheet", "the budget"
> Storing user preferences or conversation checkpoints
> Finding spreadsheets by natural language descriptions

**NOT this tool - use instead:**
> sheets_history - For OPERATION AUDIT trail (what was changed and when)
> sheets_collaborate - For FILE versions and versions history
> sheets_core - For getting spreadsheet metadata

**ACTIONS BY CATEGORY:**
[Context] set_active, get_active, get_context
[History] record_operation (manual/external steps), get_last_operation, get_history
[References] find_by_reference
[Preferences] update_preferences, get_preferences
[Pending] set_pending, get_pending, clear_pending
[Checkpoints] save_checkpoint, load_checkpoint, list_checkpoints, delete_checkpoint
[Alerts] get_alerts, acknowledge_alert, clear_alerts
[Profile] set_user_id, get_profile, update_profile_preferences
[Formula Learning] record_successful_formula, reject_suggestion, get_top_formulas
[Reset] reset

**🚀 CALL THIS FIRST IN MULTI-STEP WORKFLOWS:**
Use action:"set_active" at the start of any multi-step workflow. This stores the spreadsheet context so subsequent tools can use natural language references.
Example workflow:
1. sheets_session.set_active → Stores active spreadsheet ID + title
2. "Update the budget" → Resolves to active spreadsheet (no need to repeat spreadsheetId)
3. sheets_data operations now don't need spreadsheetId parameter (implicit context)

**TOP 3 ACTIONS:**
1. set_active: {"action":"set_active","spreadsheetId":"1ABC...","title":"Budget 2025"} ← CALL THIS FIRST
2. get_context: {"action":"get_context"} → Returns active spreadsheet, last operation, pending ops
3. find_by_reference: {"action":"find_by_reference","reference":"the budget spreadsheet","type":"spreadsheet"}

**reference types:** spreadsheet, sheet, range, cell
**Enables natural language:** "Update the budget" → Resolves to the active spreadsheet. "Undo that" → Uses session history.
**NATURAL LANGUAGE WORKFLOW:**
1. set_active("1ABC...") → Store context
2. "Update column A" → Tools now know which spreadsheet
3. Subsequent operations don't need spreadsheetId (use active context)`,

  //=============================================================================
  // ENTERPRISE TIER 7
  //=============================================================================

  sheets_templates: `📄 TEMPLATES - Reusable spreadsheet templates (${ACTION_COUNTS['sheets_templates']} actions).

**ROUTING - Pick this tool when:**
> Creating a new spreadsheet from a TEMPLATE
> Saving a spreadsheet AS a template for reuse
> Managing your template library
> Using builtin templates from knowledge base (import_builtin)

**NOT this tool - use instead:**
> sheets_core - For CREATING spreadsheets without templates
> sheets_collaborate - For FILE snapshots/backups/versions
> sheets_composite.setup_sheet - For quick setup instead of templates

**ACTIONS BY CATEGORY:**
[List] list (with optional category filter, includeBuiltin)
[CRUD] get, create, update, delete
[Use] apply (create spreadsheet from template), preview
[Import] import_builtin (from knowledge base)

**Parameter format examples:**
- List templates: {"action":"list","includeBuiltin":true}
- Apply template: {"action":"apply","templateId":"budget-2024","title":"Q1 Budget"}
- Create template: {"action":"create","spreadsheetId":"1ABC...","name":"My Budget Template"}
- Import builtin: {"action":"import_builtin","templateId":"expense_tracker"}

**TOP 3 ACTIONS:**
1. list: {"action":"list","includeBuiltin":true} -> See all templates
2. apply: {"action":"apply","templateId":"budget-2024","title":"Q1 Budget"} -> Create from template
3. create: {"action":"create","spreadsheetId":"1ABC...","name":"My Budget Template"} -> Save as template

**STORAGE:** Templates are stored in your Google Drive appDataFolder (hidden, private, auto-cleanup on uninstall).

**TIP:** Use import_builtin to import pre-built templates from ServalSheets knowledge base.`,

  sheets_bigquery: `📊 BIGQUERY - Connected Sheets integration (${ACTION_COUNTS['sheets_bigquery']} actions).

**Requires:** BigQuery API enabled in GCP project + bigquery.readonly or bigquery OAuth scope.

**ROUTING - Pick this tool when:**
> Connecting Google Sheets to BigQuery data sources
> Running SQL queries on BigQuery from Sheets
> Exploring BigQuery datasets and table schemas
> Exporting sheet data TO BigQuery tables
> Importing BigQuery query results INTO sheets

**NOT this tool - use instead:**
> sheets_data - For regular read/write within the spreadsheet
> sheets_visualize - For creating charts from sheet data

**ACTIONS BY CATEGORY:**
[Connection] connect, connect_looker, disconnect, list_connections, get_connection
[Query] query (run SQL), preview (test without full execution), refresh (update data), cancel_refresh
[Discovery] list_datasets, list_tables, get_table_schema
[Transfer] export_to_bigquery, import_from_bigquery
[Scheduled] create_scheduled_query, list_scheduled_queries, delete_scheduled_query

**TOP 3 ACTIONS:**
1. query: {"action":"query","projectId":"my-project","query":"SELECT * FROM dataset.table LIMIT 100"}
2. list_tables: {"action":"list_tables","projectId":"my-project","datasetId":"my_dataset"}
3. import_from_bigquery: {"action":"import_from_bigquery","spreadsheetId":"1ABC...","projectId":"my-project","query":"SELECT ..."}

**projectId:** Your GCP project ID (e.g., "my-project-12345")
**TIP:** Use preview to test expensive queries before full execution.`,

  sheets_appsscript: `⚡ APPSSCRIPT - Apps Script automation (${ACTION_COUNTS['sheets_appsscript']} actions).

**Requires:** USER OAuth only (NOT service accounts). Apps Script API must be enabled in GCP.

**ROUTING - Pick this tool when:**
> Creating, updating, or managing Apps Script projects
> Deploying scripts as web apps or Execution API deployments
> Running Apps Script functions remotely after deployment
> Monitoring script execution, logs, and performance
> Creating automation workflows extending Sheets functionality

**NOT this tool - use instead:**
> sheets_data - For direct cell manipulation and data changes
> sheets_composite - For high-level data operations (import, append, etc.)
> sheets_analyze - For AI-powered data analysis
> sheets_dimensions/sheets_format - For structural/styling changes

**ACTIONS BY CATEGORY:**
[Project] create, get, get_content, update_content
[Version] create_version, list_versions, get_version
[Deploy] deploy, list_deployments, get_deployment, undeploy
[Execute] run (execute function), list_processes (logs), get_metrics
[ScriptApp scheduling] Implement time-driven/event triggers inside the project with update_content + deploy. Trigger compatibility actions are hidden by default and remain NOT_IMPLEMENTED if re-enabled for legacy compatibility.

**TOP 3 ACTIONS:**
1. update_content: {"action":"update_content","scriptId":"1ABC...","files":[{"name":"Code","type":"SERVER_JS","source":"function myFunction() {}"}]}
2. deploy: {"action":"deploy","scriptId":"1ABC...","deploymentType":"EXECUTION_API","versionNumber":1}
3. run: {"action":"run","scriptId":"1ABC...","deploymentId":"AKfycb...","functionName":"myFunction","parameters":["arg1"]}

**⚠️ SAFETY:** run executes code with SIDE EFFECTS. deploy creates PUBLIC endpoints.
**IDENTIFIER GUIDE:**
- create, get, get_content, update_content, run → accept spreadsheetId (auto-resolves to bound script) OR scriptId
- Trigger compatibility actions are hidden by default. If legacy compatibility is enabled, prefer scriptId over spreadsheetId and expect NOT_IMPLEMENTED.
**scriptId:** From Apps Script editor. **deploymentId:** From Deploy > Manage deployments. **deploymentType:** WEB_APP, EXECUTION_API
**SUPPORTED WORKFLOW:** create → update_content → create_version → deploy → run with deploymentId
**TIP:** Use devMode:true to test latest saved code (owner only). Implement scheduling with ScriptApp in the script itself, then push via update_content and deploy.`,

  sheets_webhook: `🔔 WEBHOOK - Event-driven automation and real-time notifications (${ACTION_COUNTS['sheets_webhook']} actions).

⚠️ **REDIS REQUIRED for most actions:** Set \`REDIS_URL\` env var. Without it:
- ❌ UNAVAILABLE (CONFIG_ERROR): register, unregister, list, get, test, get_stats
- ✅ AVAILABLE without Redis: watch_changes, subscribe_workspace, unsubscribe_workspace, list_workspace_subscriptions
Check server availability in the \`x-servalsheets.availability\` field of tools/list before calling.

**Requires (when Redis configured):** HTTPS endpoint returning 200 OK within 10s.

**ROUTING - Pick this tool when:**
> Setting up REAL-TIME notifications for spreadsheet changes
> Triggering EXTERNAL systems when data updates
> Building EVENT-DRIVEN workflows and automation
> Monitoring spreadsheet ACTIVITY in real-time
> Integrating with external webhooks or callback systems

**NOT this tool - use instead:**
> sheets_data - For direct read/write operations
> sheets_history - For viewing PAST changes (this session)
> sheets_collaborate - For sharing and permissions
> sheets_appsscript - For custom automation within Sheets

**ACTIONS BY CATEGORY:**
[Lifecycle] register (create webhook), unregister (remove webhook), get (view details), list (all webhooks), watch_changes (monitor updates)
[Testing] test (send test payload), get_stats (delivery metrics)

**TOP 3 ACTIONS:**
1. register: {"action":"register","spreadsheetId":"1ABC...","webhookUrl":"https://api.example.com/webhook","eventTypes":["cell.update"],"secret":"your-secret-key"}
2. list: {"action":"list","spreadsheetId":"1ABC..."}
3. test: {"action":"test","webhookId":"wh_123"}

**webhookUrl format:** "https://api.example.com/webhook" (HTTPS only, not HTTP)
**eventTypes examples:** cell.update, format.update, sheet.create, sheet.delete, sheet.rename, all
**secret parameter:** Used for HMAC signature verification (recommended)

**eventTypes:** cell.update, format.update, sheet.create/delete/rename, all
**Limits:** Max 1 day lifetime (re-register daily). HTTPS only. Use secret for HMAC verification.`,

  sheets_dependencies: `🔗 DEPENDENCIES - Formula dependency analysis and impact assessment (${ACTION_COUNTS['sheets_dependencies']} actions).

**ROUTING - Pick this tool when:**
> Understanding FORMULA relationships and dependencies
> Analyzing IMPACT of changing specific cell values
> Detecting CIRCULAR REFERENCES causing #REF! errors
> Finding what cells DEPEND ON a given cell
> Visualizing formula DEPENDENCY GRAPHS
> Planning spreadsheet REFACTORING safely
> Checking formula complexity before changes

**NOT this tool - use instead:**
> sheets_analyze - For general spreadsheet analysis and quality insights
> sheets_quality - For error DETECTION and impact analysis
> sheets_fix - For AUTO-FIXING formula errors
> sheets_data - For reading/writing cell VALUES

**ACTIONS BY CATEGORY:**
[Analysis] build (create graph), analyze_impact (what changes affect), get_stats (complexity metrics)
[Queries] get_dependencies (what cell depends on), get_dependents (what depends on cell)
[Quality] detect_cycles (find circular refs)
[Export] export_dot (Graphviz visualization)
[Scenario Modeling] model_scenario ("what if revenue drops 20%?" — traces full recalculation cascade), compare_scenarios (side-by-side comparison of multiple what-if scenarios), create_scenario_sheet (materialize scenario as new sheet)

**DECISION GUIDE:**
→ **What cells does this formula depend on?** Use get_dependencies
→ **What breaks if I change this cell?** Use analyze_impact or get_dependents
→ **Circular reference errors?** Use detect_cycles
→ **What if revenue drops 20%?** Use model_scenario (traces formula cascade, shows all affected cells with deltas)
→ **Compare best/worst/expected cases?** Use compare_scenarios (multiple scenarios side-by-side)
→ **Save a scenario as a separate sheet?** Use create_scenario_sheet (non-destructive copy with changes applied)

**TOP 3 ACTIONS:**
1. model_scenario: {"action":"model_scenario","spreadsheetId":"1ABC...","changes":[{"cell":"Revenue!B2","newValue":80000}]} ← What-if analysis with full cascade
2. analyze_impact: {"action":"analyze_impact","spreadsheetId":"1ABC...","cell":"Data!A1"}
3. compare_scenarios: {"action":"compare_scenarios","spreadsheetId":"1ABC...","scenarios":[{"name":"Best Case","changes":[{"cell":"B2","newValue":120000}]},{"name":"Worst Case","changes":[{"cell":"B2","newValue":60000}]}]}

**Parameter format examples (Scenario Modeling):**
- Model scenario: {"action":"model_scenario","spreadsheetId":"1ABC...","changes":[{"cell":"Revenue!B2","newValue":80000},{"cell":"Revenue!C2","newValue":85000}]}
- Compare scenarios: {"action":"compare_scenarios","spreadsheetId":"1ABC...","scenarios":[{"name":"Conservative","changes":[{"cell":"B2","newValue":90000}]},{"name":"Aggressive","changes":[{"cell":"B2","newValue":150000}]}]}
- Materialize: {"action":"create_scenario_sheet","spreadsheetId":"1ABC...","scenario":{"name":"Q2 Conservative","changes":[{"cell":"B2","newValue":90000}]}}

**cell format:** "Sheet1!A1" or "Sheet1!A1:C10"
**changes[] field name:** Use "newValue" (NOT "value") — e.g., {"cell":"Sheet1!B2","newValue":80000}

**SCENARIO WORKFLOW:**
1. build → Create dependency graph
2. model_scenario → "What if revenue drops 20%?" → See all cascading effects
3. compare_scenarios → Compare conservative vs aggressive vs expected
4. create_scenario_sheet → Save chosen scenario as separate sheet for stakeholders

**SAFETY:**
[Read-only] build, analyze_impact, get_dependencies, get_dependents, detect_cycles, get_stats, export_dot, model_scenario, compare_scenarios
[Safe mutation] create_scenario_sheet ← creates new sheet (non-destructive to original data, but requires confirmation)

**TIP:** Run detect_cycles first, then model_scenario for accurate what-if analysis.`,

  sheets_federation: `🌐 FEDERATION - Call external MCP servers for composite workflows (${ACTION_COUNTS['sheets_federation']} actions).

**PREREQUISITES:** Set MCP_FEDERATION_ENABLED=true and MCP_FEDERATION_SERVERS in environment. Remote servers must be running and accessible.

**ROUTING - Pick this tool when:**
> Integrating EXTERNAL data sources (weather, ML models, databases)
> Chaining operations across MULTIPLE services (analyze → transform → write to Sheets)
> Calling specialized MCP SERVERS (Python analytics, SQL databases)
> Building COMPOSITE workflows that combine different MCP tools
> Connecting to THIRD-PARTY APIs via their MCP server implementations

**NOT this tool - use instead:**
> sheets_data - For direct Sheets read/write operations
> sheets_bigquery - For BigQuery integration (built-in)
> sheets_webhook - For receiving notifications FROM external services
> sheets_appsscript - For custom JavaScript automation WITHIN Sheets

**ACTIONS BY CATEGORY:**
[Execution] call_remote (invoke remote tool)
[Discovery] list_servers (configured servers), get_server_tools (available tools on server)
[Health] validate_connection (test connectivity)

**Parameter format examples:**
- Call remote: {"action":"call_remote","serverName":"weather-api","toolName":"get_forecast","toolInput":{"location":"San Francisco"}}
- List servers: {"action":"list_servers"}
- Get tools: {"action":"get_server_tools","serverName":"ml-server"}
- Validate: {"action":"validate_connection","serverName":"weather-api"}

**TOP 3 ACTIONS:**
1. call_remote: {"action":"call_remote","serverName":"weather-api","toolName":"get_forecast","toolInput":{"location":"SF","days":7}} -> Call remote MCP tool
2. list_servers: {"action":"list_servers"} -> See configured remote servers
3. validate_connection: {"action":"validate_connection","serverName":"weather-api"} -> Test connection

**CONFIGURATION:**
Set MCP_FEDERATION_SERVERS environment variable with JSON array:
[{"name":"weather-api","url":"http://localhost:3001","auth":{"type":"bearer","token":"sk-..."}}]

**SECURITY:** Only call trusted MCP servers. Use bearer tokens. Set timeouts (default: 30s). Validate responses before writing.
**WORKFLOW:** validate_connection → get_server_tools → call_remote → sheets_data.write results. Results cached 5 min.`,
  //=============================================================================
  // COMPUTATION ENGINE (Phase 5)
  //=============================================================================

  sheets_compute: `🧮 COMPUTE - Server-side computation engine for spreadsheet data (${ACTION_COUNTS['sheets_compute']} actions). Math, stats, regression, forecasting, matrix ops.

**ROUTING - Pick this tool when:**
> Computing AGGREGATIONS (sum, average, count, etc.) with optional group-by
> Running STATISTICAL analysis (mean, median, std dev, correlation, percentiles)
> Performing REGRESSION analysis (linear, polynomial, exponential, logarithmic, power)
> FORECASTING future values from time-series data
> MATRIX operations (transpose, multiply, inverse, determinant, eigenvalues)
> Creating computed PIVOT TABLES with custom aggregations
> EVALUATING mathematical expressions referencing cell data
> EXPLAINING what a formula does in plain language

**NOT this tool - use instead:**
> sheets_data - For reading/writing cell values (no computation)
> sheets_analyze - For AI-powered analysis and recommendations
> sheets_format - For number formatting (not computation)
> sheets_dependencies - For formula dependency graphs and scenario modeling

**ACTIONS BY CATEGORY:**
[Math] evaluate (arithmetic expressions), batch_compute (multiple computations)
[Aggregation] aggregate (sum/avg/count/min/max with group-by)
[Statistics] statistical (descriptive stats, correlations, percentiles)
[Modeling] regression (5 types with R²), forecast (trend/moving avg/exponential smoothing)
[Matrix] matrix_op (transpose, multiply, inverse, determinant, eigenvalues, rank, trace)
[Pivot] pivot_compute (server-side pivot with custom aggregations)
[Utility] custom_function (evaluate expressions over ranges), explain_formula (plain-language formula explanation)

**PARAMETER EXAMPLES:**
• evaluate: {"action":"evaluate","expression":"=SUM(B2:B100)*1.1","range":"Sheet1!B2:B100"} → Multiply sum by 10%
• aggregate: {"action":"aggregate","range":"Sheet1!A1:D100","function":"sum","columns":["B","C"],"groupBy":"A"} → Sum revenue/cost by region
• statistical: {"action":"statistical","range":"Sheet1!B2:B100","includeCorrelations":true,"includePercentiles":true} → Stats with P25/P75
• regression: {"action":"regression","range":"Sheet1!A1:B50","type":"linear","confidenceLevel":0.95} → Linear trend with R²
• forecast: {"action":"forecast","range":"Sheet1!A1:B50","periods":12,"method":"exponential_smoothing"} → 12-month forecast
  REQUIRES: 3+ distinct aggregated time periods in the data. Aggregate repeated dates before calling.
  method enum: linear | exponential_smoothing | moving_average | holt_winters
• matrix_op: {"action":"matrix_op","range":"Sheet1!A1:D4","operation":"transpose"} → Swap rows/columns
• pivot_compute: {"action":"pivot_compute","dataRange":"Sheet1!A1:D100","rowFields":["Category"],"valueFields":[{"field":"Amount","function":"sum"}]} → Pivot by category
• batch_compute: {"action":"batch_compute","operations":[{"operation":"sum","range":"B2:B100"},{"operation":"avg","range":"C2:C100"}]} → Multiple computations

**SAFETY:** [Read-only] All actions are read-only computations. No data is modified.
**PERFORMANCE:** Computations run server-side, avoiding round-trips. Use batch_compute for 3+ operations.`,

  //=============================================================================
  // AGENT LOOP (Phase 6)
  //=============================================================================

  sheets_agent: `🤖 AGENT - Autonomous multi-step execution engine (${ACTION_COUNTS['sheets_agent']} actions). Plan, execute, observe, rollback.

**ROUTING - Pick this tool when:**
- User wants a complex multi-step workflow executed autonomously
- Multiple tools need to be orchestrated in sequence
- You need rollback safety for multi-step operations

**NOT this tool:**
- Single operations → use the specific tool directly
- Analysis → sheets_analyze
- Batch writes → sheets_transaction

**ACTIONS BY CATEGORY:**

📋 Planning:
- plan: Create multi-step execution plan from natural language description
- list_plans: List all saved execution plans

⚡ Execution:
- execute: Execute entire plan autonomously (all steps)
- execute_step: Execute a single step from a plan
- resume: Resume an interrupted plan from last checkpoint

👁️ Observation & Safety:
- observe: Capture current spreadsheet state as checkpoint
- rollback: Revert to a previous checkpoint
- get_status: Get plan and execution status

**TOP 3 ACTIONS:**
1. plan: {"action":"plan","description":"Import CSV, clean data, add summary formulas, format headers","spreadsheetId":"abc"} -> Creates executable plan
2. execute: {"action":"execute","planId":"plan_123"} -> Runs all steps with automatic checkpointing
3. rollback: {"action":"rollback","planId":"plan_123","checkpointId":"cp_456"} -> Reverts to safe state

**SAFETY:** [Destructive] execute and execute_step modify data. Automatic checkpoints before each step enable rollback.
**PATTERN:** plan → execute → (if error) rollback. Always plan first, then execute.`,

  sheets_connectors: `🔌 CONNECTORS - Productized external data setup and live queries (${ACTION_COUNTS['sheets_connectors']} actions). Finnhub, FRED, Alpha Vantage, Polygon, FMP, generic REST.

**ROUTING - Pick this tool when:**
- User wants to import live stock prices, economic data, or weather into a sheet
- User needs to connect a custom REST/JSON API to their spreadsheet
- User wants auto-refreshing data from external sources

**NOT this tool:**
- First-time connector onboarding → sheets_auth.setup_feature
- Data already in Sheets → sheets_data.read
- Cross-spreadsheet operations → sheets_data.cross_read
- ScriptApp-based scheduling/triggers → sheets_appsscript

**ACTIONS BY CATEGORY:**

📋 Discovery:
- list_connectors: List all available connectors plus signupUrl, recommendedUseCases, configured status, and nextStep
- discover: Get available endpoints and data schemas from a connector
- status: Check connector health, quota usage, and whether it is unconfigured vs failing

🔑 Configuration:
- configure: Provide API credentials for a connector (API key / OAuth2), verify health, and return an example query

📊 Querying:
- query: Fetch data from a connector endpoint
- batch_query: Run multiple queries in parallel across connectors
- transform: Fetch + filter/sort/limit in a single call

🔄 Subscriptions:
- subscribe: Schedule automatic data refresh into a sheet range
- unsubscribe: Cancel a refresh subscription
- list_subscriptions: List all active subscriptions

**TOP 3 ACTIONS:**
1. list_connectors: {"action":"list_connectors"} -> pick a provider and see nextStep guidance
2. configure: {"action":"configure","connectorId":"finnhub","credentials":{"type":"api_key","apiKey":"..."}} -> save credentials and verify health
3. status: {"action":"status","connectorId":"finnhub"} -> confirm healthy before first query

**SAFETY:** query/batch_query/transform are read operations against external APIs. subscribe/unsubscribe only manage connector subscriptions.
**PATTERN:** list_connectors → configure → status → query → subscribe (only after a successful first pull).`,
};

// Type export for other modules
export type ToolName = keyof typeof TOOL_DESCRIPTIONS;

/**
 * Template literal type for tool action keys (e.g. `sheets_data.write`).
 * Catches invalid tool name prefixes at compile time.
 */
export type ActionKey = `${ToolName}.${string}`;

// Helper to get description with fallback
export function getToolDescription(name: string): string {
  return TOOL_DESCRIPTIONS[name as ToolName] ?? `${name} operations`;
}
