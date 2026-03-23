/**
 * ServalSheets - MINIMAL Tool Descriptions (Token-Optimized)
 *
 * These descriptions are designed for DEFERRED_DESCRIPTIONS mode.
 * Target: ~50-100 tokens per tool (vs ~350-500 in full mode)
 *
 * Full documentation available via:
 * - schema://tools/{toolName} - Full schemas
 * - resource://skill/servalsheets - Comprehensive guide (SKILL.md)
 *
 * @module schemas/descriptions-minimal
 */

import { ACTION_COUNTS } from './action-counts.js';

export const TOOL_DESCRIPTIONS_MINIMAL: Record<string, string> = {
  sheets_auth: `🔐 AUTH - Readiness + OAuth + setup (${ACTION_COUNTS['sheets_auth']} actions). status, login, callback, logout, setup_feature. ALWAYS call status first, then follow readiness.recommendedNextAction.`,

  sheets_core: `📋 CORE - Spreadsheet/sheet management (${ACTION_COUNTS['sheets_core']} actions). create, get, list_sheets, add_sheet, update_sheet, delete_sheet, etc. For cell values use sheets_data.`,

  sheets_data: `📝 DATA - Read/write cell values (${ACTION_COUNTS['sheets_data']} actions). read, write, append, batch_read, batch_write, notes, hyperlinks, merge, cross_read, cross_write, cross_query, cross_compare. Range format: "Sheet1!A1:D10"`,

  sheets_format: `🎨 FORMAT - Cell styling (${ACTION_COUNTS['sheets_format']} actions). set_format, backgrounds, borders, number formats, conditional rules, set_rich_text. For values use sheets_data.`,

  sheets_dimensions: `📐 DIMENSIONS - Rows/columns (${ACTION_COUNTS['sheets_dimensions']} actions). insert, delete, resize, hide, freeze, sort, filter. Use dimension:"ROWS"/"COLUMNS". sheetId preferred, sheetName supported.`,

  sheets_visualize: `📊 VISUALIZE - Charts & pivots (${ACTION_COUNTS['sheets_visualize']} actions). chart_create, chart_update, pivot_create. Use sheets_visualize.suggest_chart when the user wants help choosing a chart.`,

  sheets_collaborate: `👥 COLLABORATE - Sharing/comments/versions (${ACTION_COUNTS['sheets_collaborate']} actions). share_add, comment_add, version_create_snapshot, version_snapshot_status, approval_*. Requires elevated Drive scopes.`,

  sheets_advanced: `⚙️ ADVANCED - Named ranges/protection/banding (${ACTION_COUNTS['sheets_advanced']} actions). add_named_range, add_protected_range, banding, tables, smart_chips.`,

  sheets_transaction: `🔄 TRANSACTION - Atomic batch ops (${ACTION_COUNTS['sheets_transaction']} actions). begin, queue, commit, rollback. Use for 5+ operations - 80-95% API savings.`,

  sheets_quality: `✅ QUALITY - Validation & conflicts (${ACTION_COUNTS['sheets_quality']} actions). validate, detect_conflicts, analyze_impact. Use BEFORE large writes.`,

  sheets_history: `📜 HISTORY - Operation audit (${ACTION_COUNTS['sheets_history']} actions). list, undo, redo, revert_to, timeline, diff_revisions, restore_cells. Tracks last 100 operations per spreadsheet.`,

  sheets_confirm: `⚠️ CONFIRM - User confirmation (${ACTION_COUNTS['sheets_confirm']} actions). request, get_stats, wizard_* for multi-step flows. Use for destructive operations >100 cells.`,

  sheets_analyze: `🤖 ANALYZE - AI analysis (${ACTION_COUNTS['sheets_analyze']} actions). Use scout for quick structure, comprehensive for full audits, and skip this tool when the user's write/format request is already specific.`,

  sheets_fix: `🔧 FIX - Auto-fix issues (${ACTION_COUNTS['sheets_fix']} actions). Often paired with sheets_analyze for diagnosis. Fixes: volatile formulas, missing freezes, clean, standardize_formats, fill_missing, detect_anomalies.`,

  sheets_composite: `🔗 COMPOSITE - High-level workflows (${ACTION_COUNTS['sheets_composite']} actions). import_csv, smart_append, deduplicate, setup_sheet, generate_sheet, generate_template, export_large_dataset. 60-80% API savings.`,

  sheets_session: `📋 SESSION - Conversation context (${ACTION_COUNTS['sheets_session']} actions). set_active, get_context, find_by_reference, checkpoints, alerts, profile. save_checkpoint needs ENABLE_CHECKPOINTS=true.`,

  sheets_templates: `📄 TEMPLATES - Reusable templates (${ACTION_COUNTS['sheets_templates']} actions). list, create, apply, import_builtin. Stored in Drive appDataFolder.`,

  sheets_bigquery: `📊 BIGQUERY - Connected Sheets (${ACTION_COUNTS['sheets_bigquery']} actions). query, connect_looker, cancel_refresh, import_from_bigquery, scheduled queries. Requires BigQuery API enabled.`,

  sheets_appsscript: `⚡ APPSSCRIPT - Apps Script (${ACTION_COUNTS['sheets_appsscript']} actions). Supported by default: create, update_content, create_version, deploy, run, list_processes, get_metrics. Trigger compatibility actions are hidden unless ENABLE_APPSSCRIPT_TRIGGER_COMPAT=true; prefer update_content + deploy with ScriptApp code. USER OAuth only.`,

  sheets_webhook: `🔔 WEBHOOK - Change notifications (${ACTION_COUNTS['sheets_webhook']} actions). register, unregister, list, test, watch_changes. Requires Redis backend + HTTPS endpoint. HMAC signature verification.`,

  sheets_dependencies: `🔗 DEPENDENCIES - Formula graph (${ACTION_COUNTS['sheets_dependencies']} actions). build, analyze_impact, detect_cycles, export_dot, model_scenario, compare_scenarios, create_scenario_sheet.`,

  sheets_federation: `🌐 FEDERATION - Call external MCP servers (${ACTION_COUNTS['sheets_federation']} actions). call_remote, list_servers, get_server_tools, validate_connection. Requires MCP_FEDERATION_SERVERS env var.`,

  sheets_compute: `🧮 COMPUTE - Server-side computation engine (${ACTION_COUNTS['sheets_compute']} actions). evaluate, aggregate, statistical, regression, forecast, matrix_op, pivot_compute, custom_function, batch_compute, explain_formula. Read-only.`,

  sheets_agent: `🤖 AGENT - Autonomous multi-step execution (${ACTION_COUNTS['sheets_agent']} actions). plan, execute, execute_step, observe, rollback, get_status, list_plans, resume. Checkpoint-based rollback.`,

  sheets_connectors: `🔌 CONNECTORS - External data onboarding + live queries (${ACTION_COUNTS['sheets_connectors']} actions). First-time ladder: list_connectors → configure → status → query. Supports Finnhub, FRED, Alpha Vantage, Polygon, FMP, REST APIs.`,
};
