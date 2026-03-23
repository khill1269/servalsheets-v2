---
title: Benchmark Fix Action Plan
category: general
last_updated: 2026-03-20
description: Prioritized 44-fix benchmark remediation plan derived from the Fix Action Plan sheet.
version: 1.7.0
---

# Benchmark Fix Action Plan - 2026-03-20

**Source of truth:** [Fix Action Plan sheet](https://docs.google.com/spreadsheets/d/1LB-drKFyi1xpM5Z-xqqMa4KtvT7c0vNz9K8AkJo7lDM) (`Fix Action Plan` tab)
**Scope:** Benchmark-specific execution order for spreadsheet-task accuracy, speed, and failure-rate reduction
**Status:** Finalized priority plan captured from the live sheet

This document is the benchmark remediation counterpart to the broader audit and framework material. It captures the concrete tool-usage fixes most likely to raise real-world task success, especially on live spreadsheet workflows that fail silently today.

## Outcome Target

The working hypothesis from the benchmark review is:

- P0 + P1 account for nearly all of the gap between 91.7% on the initial 12-question slice and 75%+ on the full 912-question benchmark.
- Closing those first 15 items should improve both accuracy and latency because they remove repeated metadata overhead, wrong-range writes, string-vs-number mismatches, and avoidable multi-call planning loops.

## Priority Summary

| Priority | Count    | Purpose                                                      |
| -------- | -------- | ------------------------------------------------------------ |
| P0       | 9 fixes  | Stop silent corruption and high-frequency execution mistakes |
| P1       | 6 fixes  | Close major orchestration and batching gaps                  |
| P2       | 15 fixes | Raise production quality and workflow efficiency             |
| P3       | 14 fixes | Unlock advanced analysis, automation, and scale patterns     |

## P0 - Breaks Things Silently, Fix Immediately

1. **`update_preferences` first** — set `verbosity:minimal` once at session start. Current tool calls return 300+ extra tokens of metadata on every call.
2. **`set_active` first** — register the spreadsheet once. Stop passing `spreadsheetId` in every tool call.
3. **`scout` before touching unknown sheets** — run the 200ms structure map with zero data fetch before writing. This prevents wrong-range writes.
4. **Always use `USER_ENTERED` for numeric and formula writes** — `RAW` stores numbers as strings, which causes silent comparison failures.
5. **Always use `UNFORMATTED_VALUE` for numeric reads** — `FORMATTED_VALUE` returns strings like `1,234.56`, which breaks numeric comparisons.
6. **Use `batch_write` with explicit row formulas** — `auto_fill` and `copy_paste` do not extend formulas. Generate formulas per row in code and write them in one batch.
7. **Use `EXACT()` for case-sensitive `SUMPRODUCT` logic** — Google Sheets `=` is case-insensitive, unlike Excel. Mixed-case labels require `EXACT()`.
8. **Call `diagnose_errors` immediately on any `#ERROR!`** — use the built-in root-cause and fix suggestion path instead of retry loops.
9. **Run `formula_health_check` after every formula batch** — catch silent zeros, broken ranges, and missing data before scores or rollups are affected.

## P1 - Major Capability Gaps

1. **Use `sheets_agent` `plan -> observe -> execute` for complex manipulation** — this is the default for the 351 sheet-level benchmark questions and any real multi-sheet workflow.
2. **Always pass `context` to `agent.plan()`** — informed plans cut the step count materially versus having the agent rediscover structure.
3. **Always run `observe()` between plan and execute** — create a rollback checkpoint before any destructive production operation.
4. **Use `execute_pipeline` for 5+ sequential operations** — dependency-ordered execution and fewer round trips materially reduce runtime.
5. **Use `batch_write` and `batch_read` everywhere** — formula fills and answer collection should happen in batches, never write/read loops.
6. **Use `transaction begin -> queue -> commit` for multi-write workflows** — make CRM-style and production writes atomic while reducing API cost.

## P2 - Production-Quality Improvements

These include:

1. The optimal 6-step formula loop.
2. Formula library capture via `record_successful_formula`.
3. `import_csv` instead of `import_xlsx`.
4. Apps Script for procedural logic.
5. `install_serval_function` for AI-in-cells.
6. `data_pipeline` for transformations.
7. `bulk_update` for CRM updates.
8. `smart_append` for row appends.
9. `generate_sheet` for new spreadsheets.
10. Connector setup for live market data.
11. `scout -> plan -> execute_plan` for analysis.
12. Developer metadata for dynamic ranges.
13. Checkpointing for multi-session workflows.
14. Natural language queries.

## P3 - Untapped Capability

These include:

1. `cross_read` and `cross_compare` for multi-sheet joins and diffs.
2. Streaming reads for 42K+ row data.
3. `formulaType` hints for modern functions.
4. `IFERROR` wrapping on lookups.
5. `detect_spill_ranges` before writes.
6. `auto_enhance` for polish.
7. `build_dashboard` for reporting.
8. `schedule_create` for automation.
9. `create_trigger` for real-time events.
10. BigQuery integration for scale.

## Implementation Notes

- This plan is ordered by real-world impact, not by engineering effort.
- P0 items should be treated as execution defaults and prompt-routing defaults, not optional tips.
- P1 items are the minimum orchestration layer needed for full-benchmark performance.
- P2 and P3 should be folded into documentation, prompt registration, examples, and evaluation methodology after P0/P1 are enforced.

## Relationship to Other Docs

- [AQUI-VR v3.2 Framework](../../AQUI-VR_v3.2_Framework.md) tracks audit verification gates and remediation evidence.
- [AQUI-VR Evaluation](../AQUI-VR_EVALUATION.md) records the March 12, 2026 evaluation snapshot.
- [AQUI-VR Framework Improvements](../AQUI-VR_FRAMEWORK_IMPROVEMENTS.md) captures proposed changes to the framework itself.

This document is narrower: it is the operational playbook for fixing benchmark execution behavior.
