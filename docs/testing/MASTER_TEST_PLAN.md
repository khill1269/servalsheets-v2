# ServalSheets — Master Test Plan

> 13 test categories covering all 403 actions, 27 error patterns, 4 agent workflows,
> 8 user personas, and every MCP interaction pattern.
> Generated: 2026-03-19. Source: action registry, server capabilities, real-world workflow research.

---

## Overview

| Metric               | Count            |
| -------------------- | ---------------- |
| Test Categories      | 13               |
| Actions Covered      | 403 / 403 (100%) |
| Error Patterns       | 27               |
| User Personas        | 8                |
| End-to-End Workflows | 50+              |
| Estimated Test Cases | 200–250          |

---

## Category 1: Core CRUD & Spreadsheet Lifecycle

**Tools**: sheets_core (21 actions), sheets_auth (5 actions)
**What it tests**: The fundamental lifecycle — create, read, list, describe, copy, delete spreadsheets and sheets.

### Scenarios

| #    | Scenario                                   | Actions                                                   | What to Verify                                                         |
| ---- | ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1.1  | Create spreadsheet from scratch            | `create`                                                  | Returns spreadsheetId + URL; elicitation wizard fires if title omitted |
| 1.2  | Describe a workbook completely             | `describe_workbook`, `workbook_fingerprint`               | Sheet names, row/col counts, formulas detected, fingerprint stable     |
| 1.3  | Add/delete/duplicate sheets                | `add_sheet`, `delete_sheet`, `duplicate_sheet`            | Idempotency guard on add_sheet; confirmation prompt on delete          |
| 1.4  | Batch operations on sheets                 | `batch_get`, `batch_delete_sheets`, `batch_update_sheets` | Progress notifications for large batches; partial failure handling     |
| 1.5  | Copy sheet to another spreadsheet          | `copy_sheet_to`                                           | Cross-spreadsheet permission check; snapshot created                   |
| 1.6  | Move sheet order                           | `move_sheet`                                              | Tab order changes; undo via history                                    |
| 1.7  | Auth lifecycle                             | `status`, `login`, `callback`, `logout`                   | OAuth flow; token refresh; status shows blocking issues                |
| 1.8  | Error: spreadsheet not found               | —                                                         | `SPREADSHEET_NOT_FOUND` → fixableVia suggests `sheets_core.list`       |
| 1.9  | Error: sheet not found                     | —                                                         | `SHEET_NOT_FOUND` → detects emoji/whitespace/case issues in name       |
| 1.10 | Idempotency: create same spreadsheet twice | `create`                                                  | Second call returns existing with `_idempotent: true`                  |

### Personas: All (foundational)

---

## Category 2: Data Read/Write/Transform

**Tools**: sheets_data (25 actions)
**What it tests**: Reading, writing, appending, searching, cross-spreadsheet operations, and data manipulation.

### Scenarios

| #    | Scenario                       | Actions                                      | What to Verify                                                          |
| ---- | ------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| 2.1  | Read a range, verify hints     | `read`                                       | Response includes `_hints` (dataShape, primaryKey, relationships, risk) |
| 2.2  | Write data with formulas       | `write`                                      | Formula cells evaluated; `_hints.verificationNudge` on write response   |
| 2.3  | Append rows to growing dataset | `append`                                     | Appends after last row; no overwrite; smart_append deduplicates         |
| 2.4  | Batch read 10+ ranges          | `batch_read`                                 | Parallel execution; `batchingHint` if called with single range          |
| 2.5  | Find and replace with dry-run  | `find_replace`                               | Sampling predicts match count; preview mode before commit               |
| 2.6  | Notes and hyperlinks           | `add_note`, `get_note`, `set_hyperlink`      | CRUD cycle; clear operations work                                       |
| 2.7  | Merge/unmerge cells            | `merge_cells`, `unmerge_cells`, `get_merges` | Merge types (horizontal/vertical/all); data in merged region            |
| 2.8  | Cut/copy paste                 | `cut_paste`, `copy_paste`                    | Source cleared on cut; formulas adjusted on paste                       |
| 2.9  | Auto-fill pattern detection    | `auto_fill`                                  | Linear, date, repeat strategies; RangeInput schema works                |
| 2.10 | Cross-spreadsheet read+join    | `cross_read`                                 | Multiple sources; joinKey matching; parallel fetch                      |
| 2.11 | Cross-spreadsheet NL query     | `cross_query`                                | Sampling interprets query; correct source selection                     |
| 2.12 | Cross-spreadsheet write        | `cross_write`                                | Confirmation before overwrite; permission check on destination          |
| 2.13 | Cross-spreadsheet compare      | `cross_compare`                              | Cell-level diffs; numeric tolerance; added/removed/changed buckets      |
| 2.14 | Large dataset (10K+ rows)      | `read`, `batch_read`                         | Tiered retrieval; progress notifications; response compaction           |
| 2.15 | Error: invalid range           | —                                            | `INVALID_RANGE` → fixableVia adds bounds (A:Z → A1:Z1000)               |
| 2.16 | Quality warnings on read       | `read`                                       | `dataQualityWarnings` injected (mixed types, nulls, duplicates)         |
| 2.17 | Action recommender after read  | `read`                                       | Suggestions: sort_range if unsorted dates, fill_missing if >10% null    |

### Personas: Financial Analyst (budget data), Data Engineer (ETL), Sales Ops (CRM sync)

---

## Category 3: Formatting & Visual Presentation

**Tools**: sheets_format (25 actions), sheets_dimensions (30 actions)
**What it tests**: Number formats, text styles, conditional formatting, data validation, layout, sorting, filtering, slicers.

### Scenarios

| #    | Scenario                              | Actions                                             | What to Verify                                                    |
| ---- | ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| 3.1  | Apply preset format                   | `apply_preset`                                      | Professional/financial/dashboard presets work                     |
| 3.2  | Batch format multiple ranges          | `batch_format`                                      | Single batchUpdate API call; all formats applied atomically       |
| 3.3  | Conditional format via wizard         | `add_conditional_format_rule`                       | Wizard fires for preset selection; idempotency guard on duplicate |
| 3.4  | Generate conditional format (AI)      | `generate_conditional_format`                       | Sampling generates rule from NL description                       |
| 3.5  | Data validation + dependent dropdowns | `set_data_validation`, `build_dependent_dropdown`   | ONE_OF_RANGE validation; named ranges created; cascade works      |
| 3.6  | Suggest format (AI)                   | `suggest_format`                                    | Sampling provides rationale; session context recorded             |
| 3.7  | Rich text in cells                    | `set_rich_text`                                     | Bold/italic/color within single cell                              |
| 3.8  | Sparklines                            | `sparkline_add`, `sparkline_get`, `sparkline_clear` | Line/bar/column types; data range updates                         |
| 3.9  | Insert/delete/move rows/cols          | `insert`, `delete`, `move`                          | Formula references updated; confirmation on delete                |
| 3.10 | Auto-resize columns                   | `auto_resize`                                       | Content-based width; respects min/max                             |
| 3.11 | Freeze header rows                    | `freeze`                                            | Session context records freeze state for "unfreeze"               |
| 3.12 | Sort range                            | `sort_range`                                        | Multi-column sort; session records for "sort other way"           |
| 3.13 | Filter views + slicers                | `create_filter_view`, `create_slicer`               | Non-destructive filtering; slicer bound to correct range          |
| 3.14 | Delete duplicates                     | `delete_duplicates`                                 | Confirmation required; snapshot before deletion                   |
| 3.15 | Text to columns                       | `text_to_columns`                                   | Delimiter detection; preview before split                         |
| 3.16 | Group/ungroup rows                    | `group`, `ungroup`                                  | Nesting levels; collapse/expand                                   |

### Personas: Marketing Manager (dashboards), Small Business Owner (invoices), Educator (grade books)

---

## Category 4: Analysis & Intelligence (Sampling-Powered)

**Tools**: sheets_analyze (22 actions), sheets_fix (6 actions), sheets_quality (4 actions), sheets_dependencies (10 actions)
**What it tests**: AI-powered analysis, formula generation, data cleaning, scenario modeling, quality validation.

### Scenarios

| #    | Scenario                        | Actions                                    | What to Verify                                                            |
| ---- | ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| 4.1  | Scout a new spreadsheet         | `scout`                                    | Fast structural scan (<500ms); understanding store populated              |
| 4.2  | Quick insights (no AI)          | `quick_insights`                           | Column types detected; pattern insights generated; no sampling call       |
| 4.3  | Comprehensive analysis (AI)     | `comprehensive`                            | Sampling consent checked; semantic index persisted; 43 feature categories |
| 4.4  | Generate formula from NL        | `generate_formula`                         | FORMULA_PATTERN_LIBRARY injected as few-shot; correct formula returned    |
| 4.5  | Explain existing formula        | `explain_analysis`                         | Human-readable breakdown of complex formulas                              |
| 4.6  | Formula health check            | `formula_health_check`                     | Detects volatiles, circular risks, deprecated functions                   |
| 4.7  | Suggest next actions            | `suggest_next_actions`                     | Pattern-based + AI suggestions; executable params included                |
| 4.8  | Auto-enhance (safe ops)         | `auto_enhance`                             | Only non-destructive: freeze, resize, number format; preview mode         |
| 4.9  | Natural language query          | `query_natural_language`                   | Understanding store context consumed; semantic workbook hints used        |
| 4.10 | Data cleaning pipeline          | `clean`                                    | Auto-detect 10 rule types; preview vs apply mode; snapshot before         |
| 4.11 | Standardize formats             | `standardize_formats`                      | Dates, currency, phones normalized per-column                             |
| 4.12 | Fill missing values             | `fill_missing`                             | Forward/backward/mean/median/mode/constant strategies                     |
| 4.13 | Detect anomalies                | `detect_anomalies`                         | IQR and z-score methods; flagged cells with scores                        |
| 4.14 | AI cleaning suggestions         | `suggest_cleaning`                         | Sampling recommends rules; does NOT apply                                 |
| 4.15 | Build dependency graph          | `build`, `detect_cycles`, `get_dependents` | Formula dependencies traced; cycle detection works                        |
| 4.16 | Scenario modeling ("what if")   | `model_scenario`                           | Input changes → cascade effects traced; delta percentages                 |
| 4.17 | Compare scenarios side-by-side  | `compare_scenarios`                        | Matrix comparison; parallel modeling; ranking by impact                   |
| 4.18 | Materialize scenario as sheet   | `create_scenario_sheet`                    | New sheet created; changed cells highlighted; confirmation required       |
| 4.19 | Conflict detection + resolution | `detect_conflicts`, `resolve_conflict`     | Concurrent edit detection; merge strategies                               |
| 4.20 | Sampling consent denied         | —                                          | Graceful degradation to heuristic; `_meta.aiMode: 'heuristic'`            |
| 4.21 | Semantic column detection       | —                                          | Revenue+cost → profit margin formula suggested in `_hints`                |

### Personas: Financial Analyst (scenarios), Data Engineer (quality), Marketing Manager (anomalies)

---

## Category 5: Visualization & Charts

**Tools**: sheets_visualize (18 actions)
**What it tests**: Chart CRUD, pivot tables, AI chart suggestions, trendlines.

### Scenarios

| #   | Scenario                | Actions                                         | What to Verify                                              |
| --- | ----------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| 5.1 | Create chart via wizard | `chart_create`                                  | 2-step wizard: type → title; idempotency on same range+type |
| 5.2 | AI chart suggestion     | `suggest_chart`                                 | Sampling recommends best chart type for data shape          |
| 5.3 | Update chart data range | `chart_update_data_range`                       | Chart refreshes; data linkage maintained                    |
| 5.4 | Add/remove trendlines   | `chart_add_trendline`, `chart_remove_trendline` | Linear/exponential/polynomial; R² value                     |
| 5.5 | Chart lifecycle (CRUD)  | `chart_list`, `chart_get`, `chart_delete`       | Full lifecycle; session context records chart ID            |
| 5.6 | Create pivot table      | `pivot_create`                                  | Source range validated; idempotency guard                   |
| 5.7 | AI pivot suggestion     | `suggest_pivot`                                 | Recommends row/column/value groupings                       |
| 5.8 | Pivot refresh           | `pivot_refresh`                                 | Data recalculated; structure preserved                      |

### Personas: Marketing Manager (campaign charts), Financial Analyst (P&L charts), Project Manager (burndown)

---

## Category 6: Collaboration & Version Control

**Tools**: sheets_collaborate (41 actions), sheets_history (10 actions)
**What it tests**: Sharing, comments, approvals, version history, time-travel, snapshots.

### Scenarios

| #    | Scenario                     | Actions                                                                         | What to Verify                                                            |
| ---- | ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 6.1  | Share with user (idempotent) | `share_add`                                                                     | Idempotency if same email+role; role hierarchy check                      |
| 6.2  | Transfer ownership           | `share_transfer_ownership`                                                      | Confirmation required; snapshot created                                   |
| 6.3  | Link sharing settings        | `share_set_link`, `share_get_link`                                              | Public/org/restricted modes                                               |
| 6.4  | Comment thread lifecycle     | `comment_add`, `comment_list`, `comment_resolve`, `comment_add_reply`           | Thread structure; AI suggested reply via sampling                         |
| 6.5  | Approval workflow            | `approval_create`, `approval_approve`, `approval_reject`                        | Status tracking; delegation; cancellation                                 |
| 6.6  | Access proposals             | `list_access_proposals`, `resolve_access_proposal`                              | Approve/deny external requests                                            |
| 6.7  | Labels                       | `label_list`, `label_apply`, `label_remove`                                     | Drive label management                                                    |
| 6.8  | Timeline (time-travel)       | `timeline`                                                                      | Per-cell change history; who/what/when; session context recorded          |
| 6.9  | Diff two revisions           | `diff_revisions`                                                                | Cell-level diffs; AI explanation via sampling                             |
| 6.10 | Restore specific cells       | `restore_cells`                                                                 | Surgical restore (not full revision); confirmation + snapshot             |
| 6.11 | Undo/redo operations         | `undo`, `redo`, `revert_to`                                                     | Safety rails; snapshot before revert                                      |
| 6.12 | Snapshot lifecycle           | `version_create_snapshot`, `version_list_snapshots`, `version_restore_snapshot` | Full CRUD; comparison between snapshots                                   |
| 6.13 | Error: permission denied     | —                                                                               | fixableVia suggests `sheets_auth.login` or `sheets_collaborate.share_add` |

### Personas: HR Manager (approval workflows), Project Manager (version tracking), Educator (shared grade books)

---

## Category 7: Advanced Sheet Features

**Tools**: sheets_advanced (31 actions), sheets_templates (8 actions)
**What it tests**: Named ranges, protected ranges, metadata, banding, tables, chips, named functions, templates.

### Scenarios

| #   | Scenario                     | Actions                                                   | What to Verify                                 |
| --- | ---------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| 7.1 | Named range CRUD             | `add_named_range` through `delete_named_range`            | Full lifecycle; used by dependent dropdowns    |
| 7.2 | Protected range permissions  | `add_protected_range`, `list_protected_ranges`            | Editor lists; warning-only mode                |
| 7.3 | Developer metadata           | `set_metadata`, `get_metadata`, `delete_metadata`         | Key-value store on cells/sheets                |
| 7.4 | Banding (alternating colors) | `add_banding`, `update_banding`, `delete_banding`         | Header/footer rows; color schemes              |
| 7.5 | Structured tables            | `create_table`, `update_table`, `rename_table_column`     | Table boundaries; column properties            |
| 7.6 | Smart chips                  | `add_person_chip`, `add_drive_chip`, `add_rich_link_chip` | People/file/URL chips inserted correctly       |
| 7.7 | Named functions              | `create_named_function` through `delete_named_function`   | Custom function registration; formula usage    |
| 7.8 | Template lifecycle           | `create`, `apply`, `preview`, `import_builtin`            | Idempotency on create; parameterized templates |

### Personas: Data Engineer (metadata), Financial Analyst (protected ranges), Small Business Owner (templates)

---

## Category 8: Agent Workflows & Orchestration

**Tools**: sheets_agent (8 actions), sheets_composite (21 actions), sheets_session (31 actions), sheets_transaction (6 actions)
**What it tests**: Multi-step plans, atomic transactions, session context, composite operations, pipeline execution.

### Scenarios

| #    | Scenario                    | Actions                                         | What to Verify                                                 |
| ---- | --------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| 8.1  | Plan a multi-step workflow  | `plan`                                          | Structured plan returned; maxSteps capped at 50                |
| 8.2  | Execute plan step-by-step   | `execute`, `execute_step`, `observe`            | Self-eval after each step; progress notifications              |
| 8.3  | Rollback on failure         | `rollback`                                      | Checkpoint-based state reversion; all changes undone           |
| 8.4  | Resume interrupted plan     | `resume`                                        | Continues from last checkpoint                                 |
| 8.5  | Multi-sheet CRM workflow    | `plan` with CRM template                        | Creates Customers/Orders/Products sheets with XLOOKUP formulas |
| 8.6  | Budget-vs-Actuals workflow  | `plan` with budget template                     | Budget + Actuals + Variance sheets with conditional formatting |
| 8.7  | Import CSV + clean + format | `import_csv` → `clean` → `apply_preset`         | End-to-end pipeline; progress at each stage                    |
| 8.8  | Smart append with dedup     | `smart_append`, `deduplicate`                   | Duplicate detection; merge strategies                          |
| 8.9  | Export large dataset        | `export_large_dataset`                          | Streaming; task-capable; progress notifications                |
| 8.10 | Build dashboard             | `build_dashboard`                               | KPI rows, charts, slicers, layout presets                      |
| 8.11 | Atomic transaction          | `begin`, `queue`, `commit`                      | All-or-nothing; wizard for description                         |
| 8.12 | Transaction rollback        | `begin`, `queue`, `rollback`                    | Changes reverted; snapshot restored                            |
| 8.13 | Pipeline execution          | `execute_pipeline`                              | DAG-based step ordering; Kahn's algorithm                      |
| 8.14 | Session context tracking    | `set_active`, `record_operation`, `get_context` | "That range" references resolve correctly                      |
| 8.15 | Checkpoint management       | `save_checkpoint`, `load_checkpoint`            | State preserved across operations                              |
| 8.16 | Scheduled operations        | `schedule_create`, `schedule_run_now`           | Cron-based; on-demand execution                                |
| 8.17 | Agent self-correction       | —                                               | `fixableVia` recovery steps injected; auto-retry on retryable  |
| 8.18 | Plan encryption             | —                                               | Plans encrypted at rest when PLAN_ENCRYPTION_KEY set           |

### Personas: Data Engineer (pipelines), Financial Analyst (budget workflow), Sales Ops (CRM setup)

---

## Category 9: External Integrations

**Tools**: sheets_bigquery (17), sheets_appsscript (19), sheets_federation (4), sheets_connectors (10), sheets_webhook (10)
**What it tests**: BigQuery sync, Apps Script execution, remote MCP federation, external API connectors, webhooks.

### Scenarios

| #    | Scenario                        | Actions                                             | What to Verify                                      |
| ---- | ------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| 9.1  | Connect to BigQuery             | `connect`, `list_datasets`, `list_tables`           | Connection established; schema discoverable         |
| 9.2  | Query BigQuery                  | `query`, `preview`                                  | SQL execution; result preview; row limits           |
| 9.3  | Export to BigQuery              | `export_to_bigquery`                                | Task-capable; large dataset streaming               |
| 9.4  | Import from BigQuery            | `import_from_bigquery`                              | Task-capable; schema mapping                        |
| 9.5  | Scheduled BigQuery queries      | `create_scheduled_query`, `list_scheduled_queries`  | Cron scheduling; auto-refresh                       |
| 9.6  | Create Apps Script project      | `create`, `get_content`, `update_content`           | Project bound to spreadsheet                        |
| 9.7  | Run Apps Script                 | `run`                                               | Task-capable; devMode guard; output captured        |
| 9.8  | Triggers CRUD                   | `create_trigger`, `list_triggers`, `delete_trigger` | Event-based; time-based; ScriptApp note             |
| 9.9  | Deploy script                   | `deploy`, `list_deployments`                        | Version management; web app publishing              |
| 9.10 | Install SERVAL() formula        | `install_serval_function`                           | HMAC-SHA256 signing; callback endpoint              |
| 9.11 | Federation: call remote MCP     | `call_remote`                                       | Server name + tool name required; network latency   |
| 9.12 | Federation: discover servers    | `list_servers`, `get_server_tools`                  | Remote tool registry; validation                    |
| 9.13 | External API connector          | `configure`, `query`, `discover`                    | API key via URL-mode (not form); endpoint discovery |
| 9.14 | Connector subscriptions         | `subscribe`, `unsubscribe`, `list_subscriptions`    | Webhook-based data sync                             |
| 9.15 | Webhook registration            | `register`, `unregister`, `list`                    | Redis-required check; DNS validation                |
| 9.16 | Workspace event subscriptions   | `watch_changes`, `subscribe_workspace`              | Auto-renewal at expireTime-12h                      |
| 9.17 | Error: connector not configured | —                                                   | fixableVia suggests `sheets_connectors.configure`   |
| 9.18 | Error: BigQuery permission      | —                                                   | fixableVia suggests `sheets_bigquery.connect`       |

### Personas: Data Engineer (BigQuery), Financial Analyst (ERPs via connectors), Marketing Manager (API data)

---

## Category 10: Compute & Formula Engine

**Tools**: sheets_compute (16 actions)
**What it tests**: Local formula evaluation, statistics, regression, forecasting, SQL queries, Python execution.

### Scenarios

| #     | Scenario                 | Actions                 | What to Verify                                         |
| ----- | ------------------------ | ----------------------- | ------------------------------------------------------ |
| 10.1  | Evaluate formula locally | `evaluate`              | HyperFormula v3.2; works offline; 5-layer evaluator    |
| 10.2  | Aggregate functions      | `aggregate`             | SUM, AVERAGE, COUNT, MIN, MAX across ranges            |
| 10.3  | Statistical analysis     | `statistical`           | Descriptive stats; distribution fitting                |
| 10.4  | Linear regression        | `regression`            | R², coefficients, residuals                            |
| 10.5  | Forecast time series     | `forecast`              | Moving average; exponential smoothing; trend detection |
| 10.6  | Matrix operations        | `matrix_op`             | Multiply, transpose, inverse, determinant              |
| 10.7  | Pivot computation        | `pivot_compute`         | In-memory pivot; group-by + aggregation                |
| 10.8  | Custom function          | `custom_function`       | User-defined formula execution                         |
| 10.9  | Batch compute            | `batch_compute`         | Multiple computations in parallel                      |
| 10.10 | Explain formula          | `explain_formula`       | Human-readable breakdown                               |
| 10.11 | SQL query on sheet data  | `sql_query`, `sql_join` | DuckDB engine; cross-sheet joins                       |
| 10.12 | Python eval              | `python_eval`           | Pyodide engine; pandas available                       |
| 10.13 | Pandas profiling         | `pandas_profile`        | Column stats, correlations, distributions              |
| 10.14 | ML model                 | `sklearn_model`         | scikit-learn via Pyodide; classification/regression    |
| 10.15 | Matplotlib chart         | `matplotlib_chart`      | Python-generated visualization                         |

### Personas: Financial Analyst (forecasting), Data Engineer (SQL), Marketing Manager (statistics)

---

## Category 11: Error Recovery & Self-Correction

**Cross-cutting** — tests error handling across all tools.
**What it tests**: All 27 error-fix-suggester patterns, fixableVia injection, \_learnedFix surfacing, self-correction protocol.

### Scenarios

| #     | Error Code                | Fix Action                              | What to Verify                                                                  |
| ----- | ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 11.1  | INVALID_RANGE             | Suggest bounded range                   | `fixableVia.params` includes corrected range                                    |
| 11.2  | SHEET_NOT_FOUND           | `sheets_core.list_sheets`               | Detects emoji/whitespace/case issues                                            |
| 11.3  | SPREADSHEET_NOT_FOUND     | `sheets_core.list`                      | Suggests searching by title                                                     |
| 11.4  | PERMISSION_DENIED         | `sheets_auth.login`                     | Re-authentication flow                                                          |
| 11.5  | QUOTA_EXCEEDED            | Retry with minimal verbosity            | Wait time from Retry-After header                                               |
| 11.6  | VALIDATION_ERROR          | Schema field hints                      | Required fields listed in suggestion                                            |
| 11.7  | FORMULA_ERROR             | `sheets_analyze.analyze_formulas`       | Diagnose formula issues                                                         |
| 11.8  | CIRCULAR_REFERENCE        | `sheets_dependencies.detect_cycles`     | Cycle path included                                                             |
| 11.9  | EDIT_CONFLICT             | `sheets_quality.resolve_conflict`       | Merge strategies suggested                                                      |
| 11.10 | TIMEOUT                   | Retry with smaller range                | Range splitting suggestion                                                      |
| 11.11 | PROTECTED_RANGE           | `sheets_advanced.list_protected_ranges` | Shows who has access                                                            |
| 11.12 | BATCH_UPDATE_ERROR        | Retry individual operations             | Chunk size recommendation                                                       |
| 11.13 | FORMULA_INJECTION_BLOCKED | Sanitization guidance                   | Safe formula patterns                                                           |
| 11.14 | PAYLOAD_TOO_LARGE         | Chunk operations                        | Size limit and split strategy                                                   |
| 11.15 | TRANSACTION_CONFLICT      | `sheets_transaction.status`             | Transaction state check                                                         |
| 11.16 | TRANSACTION_EXPIRED       | `sheets_transaction.begin`              | New transaction needed                                                          |
| 11.17 | ELICITATION_UNAVAILABLE   | `sheets_confirm.wizard_start`           | Fallback to wizard                                                              |
| 11.18 | CONNECTOR_ERROR           | `sheets_connectors.status`              | Connector health check                                                          |
| 11.19 | AMBIGUOUS_RANGE           | Explicit range required                 | Corrected A1 notation                                                           |
| 11.20 | Error pattern learning    | —                                       | 3+ occurrences → `_learnedFix` surfaces                                         |
| 11.21 | Self-correction protocol  | —                                       | LLM follows 5-step: read → fixableVia → \_learnedFix → suggestedActions → scout |

---

## Category 12: LLM Intelligence & Usability

**Cross-cutting** — tests the intelligence layer that makes the server "smart" for LLMs.
**What it tests**: Response hints, action recommender, sampling integration, completions, server instructions, discovery hints.

### Scenarios

| #     | Scenario                         | What to Verify                                                      |
| ----- | -------------------------------- | ------------------------------------------------------------------- |
| 12.1  | Response hints on read           | `_hints.dataShape`, `primaryKeyColumn`, `dataRelationships` present |
| 12.2  | Write verification nudge         | `_hints.verificationNudge` suggests confirming written data         |
| 12.3  | Scenario modeling hints          | `_hints` on `model_scenario` response with cascade summary          |
| 12.4  | Quality warnings injected        | `dataQualityWarnings` array with severity + fixAction               |
| 12.5  | Action recommendations           | `suggestedActions` includes tool + action + params after data ops   |
| 12.6  | Batching hint triggered          | Call single `read` → `batchingHint` suggests `batch_read`           |
| 12.7  | Transaction hint triggered       | 5+ API calls → `transactionHint` suggests atomic transaction        |
| 12.8  | `_meta.aiMode` accuracy          | `'sampling'` when AI used, `'heuristic'` otherwise                  |
| 12.9  | `_meta.apiCallsMade` accuracy    | Count matches actual Google API calls made                          |
| 12.10 | `_meta.executionTimeMs` accuracy | Wall-clock time from request start                                  |
| 12.11 | Completions: spreadsheetId       | Session-recorded IDs returned as completions                        |
| 12.12 | Completions: action names        | All 403 actions available as completions                            |
| 12.13 | Completions: enum values         | Chart types, format presets, strategies all completable             |
| 12.14 | Tool discovery hints             | `actionParams` in tools/list with required fields per action        |
| 12.15 | Server instructions quality      | 5-GROUP mental model complete; error recovery table accurate        |
| 12.16 | Semantic column detection        | Revenue+cost columns → profit margin formula opportunity            |
| 12.17 | Time-series detection            | Date+numeric columns → trend visualization suggestion               |
| 12.18 | Primary key detection            | Unique ID column identified correctly                               |
| 12.19 | Risk assessment                  | High null ratio → "medium" or "high" risk with clean suggestion     |

---

## Category 13: Elicitation, Wizards & Interactive Flows

**Tools**: sheets_confirm (5 actions), elicitation system, sampling consent
**What it tests**: Wizard flows, destructive action confirmations, sampling consent, URL-mode OAuth.

### Scenarios

| #     | Scenario                        | What to Verify                                                     |
| ----- | ------------------------------- | ------------------------------------------------------------------ |
| 13.1  | Chart creation wizard           | 2-step: chart type selection → title input                         |
| 13.2  | Conditional format wizard       | 1-step: preset selection (highlight_duplicates, color_scale, etc.) |
| 13.3  | Spreadsheet creation wizard     | 1-step: title input with default                                   |
| 13.4  | Transaction begin wizard        | 1-step: description for audit trail                                |
| 13.5  | Destructive action confirmation | delete_sheet, clear, restore_cells all prompt before executing     |
| 13.6  | Snapshot before destructive ops | Snapshot created BEFORE user approves (correct order)              |
| 13.7  | Wizard session cap (DoS)        | 1000 session limit with LRU eviction                               |
| 13.8  | Elicitation unavailable         | Graceful degradation; fallback to defaults                         |
| 13.9  | Sampling consent flow           | 30-min cache; GDPR-compliant; reject recorded                      |
| 13.10 | Sampling consent denied         | Actions degrade to heuristic; no data sent to LLM                  |
| 13.11 | OAuth via URL-mode              | API key collected via localhost form (not MCP form)                |
| 13.12 | Elicitation completion notifier | try-catch wrapped; failure doesn't crash OAuth flow                |

---

## Cross-Cutting Test Scenarios

These don't fit a single category — they test system behavior under stress or unusual conditions.

| #    | Scenario                           | Categories Affected | What to Verify                                                       |
| ---- | ---------------------------------- | ------------------- | -------------------------------------------------------------------- |
| X.1  | Very large spreadsheet (10K+ rows) | 2, 4, 10            | Tiered retrieval; progress; response compaction; DuckDB for SQL      |
| X.2  | Concurrent multi-user editing      | 6, 8, 11            | Conflict detection; optimistic locking; merge resolution             |
| X.3  | Rate limiting (429 burst)          | All                 | QuotaCircuitBreaker trips after 3 hits; Retry-After respected        |
| X.4  | Per-spreadsheet throttle           | All                 | Token-bucket at 3 RPS per spreadsheetId; LRU cap at 500              |
| X.5  | Network timeout mid-operation      | 8, 9, 11            | Transaction rollback; agent checkpoint recovery                      |
| X.6  | Expired OAuth token mid-flow       | 1, 9, 11            | Token refresh; retry transparent to handler                          |
| X.7  | Circuit breaker open               | All                 | ReadOnly fallback; clear error message; auto-reset after 30s         |
| X.8  | Redis unavailable (webhooks)       | 9                   | Webhook actions hidden from tools/list; non-Redis actions still work |
| X.9  | Sampling server unavailable        | 4, 5, 12            | Graceful degradation; heuristic fallback; \_meta.aiMode: 'heuristic' |
| X.10 | Multiple spreadsheets in session   | 2, 8                | Session context tracks per-spreadsheet state correctly               |

---

## End-to-End Workflow Tests (Persona-Based)

These combine multiple categories into realistic user journeys.

| #     | Workflow                         | Persona           | Actions Used                                                                                                                                   | Categories     |
| ----- | -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| E2E.1 | Monthly budget variance analysis | Financial Analyst | bigquery.query → data.cross_read → data.write → format.add_conditional_format_rule → composite.build_dashboard → collaborate.share_add         | 2, 3, 5, 6, 9  |
| E2E.2 | Campaign performance dashboard   | Marketing Manager | data.read → analyze.quick_insights → visualize.chart_create → format.apply_preset → composite.build_dashboard                                  | 2, 3, 4, 5, 8  |
| E2E.3 | CRM data sync + analysis         | Sales Ops         | agent.plan (CRM template) → agent.execute → data.cross_read → analyze.detect_patterns → compute.forecast                                       | 2, 4, 8, 10    |
| E2E.4 | Grade book management            | Educator          | core.create → data.write → compute.aggregate → format.add_conditional_format_rule → collaborate.share_add                                      | 1, 2, 3, 6, 10 |
| E2E.5 | Invoice generator                | Small Business    | templates.apply → data.write → format.set_number_format → composite.export_xlsx                                                                | 2, 3, 7, 8     |
| E2E.6 | Data quality pipeline            | Data Engineer     | composite.import_csv → fix.clean → fix.detect_anomalies → quality.validate → compute.sql_query                                                 | 2, 4, 8, 10    |
| E2E.7 | Scenario modeling for board      | Financial Analyst | dependencies.build → dependencies.model_scenario → dependencies.compare_scenarios → dependencies.create_scenario_sheet → collaborate.share_add | 4, 6           |
| E2E.8 | Headcount planning               | HR Manager        | core.create → data.write → dependencies.model_scenario → format.add_conditional_format_rule → collaborate.approval_create                      | 1, 2, 3, 4, 6  |

---

## Test Implementation Priority

| Phase       | Categories            | Why First                                                            |
| ----------- | --------------------- | -------------------------------------------------------------------- |
| **Phase 1** | 1, 2, 11              | Core CRUD + data ops + error recovery = foundation                   |
| **Phase 2** | 3, 4, 10              | Formatting + analysis + compute = primary value                      |
| **Phase 3** | 5, 6, 7               | Visualization + collaboration + advanced = differentiation           |
| **Phase 4** | 8, 9, 12, 13          | Orchestration + integrations + intelligence + wizards = completeness |
| **Phase 5** | X.1–X.10, E2E.1–E2E.8 | Cross-cutting stress + persona workflows = production readiness      |

---

## Coverage Targets

| Metric                   | Target        |
| ------------------------ | ------------- |
| Actions with ≥1 test     | 95% (383/403) |
| Error patterns tested    | 100% (27/27)  |
| Agent workflow templates | 100% (4/4)    |
| Wizard flows             | 100% (4/4)    |
| Sampling call sites      | 100% (9/9)    |
| Personas with E2E test   | 100% (8/8)    |
| Cross-cutting scenarios  | 100% (10/10)  |
