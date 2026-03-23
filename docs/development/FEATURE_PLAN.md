---
title: ServalSheets — Competitive Differentiation Feature Plan
category: development
last_updated: 2026-03-10
description: '6 features designed to create maximum distance from commodity Sheets MCP servers.'
version: 1.6.0
tags: [sheets]
---

# ServalSheets — Competitive Differentiation Feature Plan

> 6 features designed to create maximum distance from commodity Sheets MCP servers.
> Each feature leverages existing infrastructure to minimize new code while maximizing impact.

## Executive Summary

| #         | Feature                          | New Tool?                         | New Actions        | Est. Files Changed | Builds On                          |
| --------- | -------------------------------- | --------------------------------- | ------------------ | ------------------ | ---------------------------------- |
| F1        | Natural Language Sheet Generator | No (extend `sheets_composite`)    | 3                  | 4-5 src/           | Sampling + composite + format      |
| F2        | Multi-Spreadsheet Federation     | No (extend `sheets_data`)         | 4                  | 3-4 src/           | Tiered retrieval + batch system    |
| F3        | Automated Data Cleaning Pipeline | No (extend `sheets_fix`)          | 5                  | 3-4 src/           | Quality validators + fix engine    |
| F4        | Smart Suggestions / Copilot      | No (extend `sheets_analyze`)      | 2                  | 3-4 src/           | Scout + action generator + session |
| F5        | Time-Travel Debugger             | No (extend `sheets_history`)      | 3                  | 3-4 src/           | History service + diff engine      |
| F6        | Scenario Modeling                | No (extend `sheets_dependencies`) | 3                  | 4-5 src/           | Dependency graph + sampling        |
| **Total** |                                  | **0 new tools**                   | **20 new actions** |                    | 315 → 335 actions                  |

**Design principle**: Extend existing tools rather than creating new ones. This keeps the 25-tool surface stable, avoids client-side discovery changes, and leverages existing schema validation + handler infrastructure.

---

## F1: Natural Language Sheet Generator

### What It Does

"Create a Q1 budget tracker with revenue by month, expense categories, and profit margin formulas" → Fully structured, formatted, formula-ready spreadsheet.

### Why It Wins

No competitor turns a sentence into a production-ready spreadsheet. Most MCP servers require you to specify every column, formula, and format manually. This is the "wow" feature.

### Actions (extend `sheets_composite`)

| Action               | Input                                                                                       | Output                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `generate_sheet`     | `{ description: string, context?: string, style?: 'minimal'\|'professional'\|'dashboard' }` | New spreadsheet with structure, formulas, formatting, sample data                    |
| `generate_template`  | `{ description: string, parameterize?: boolean }`                                           | Reusable template definition (saved via `sheets_templates`)                          |
| `preview_generation` | `{ description: string }`                                                                   | Dry-run: returns proposed structure (columns, formulas, formatting) without creating |

### Implementation Plan

**Step 1: Schema** — `src/schemas/composite.ts`

- Add 3 actions to the discriminated union
- `generate_sheet`: description (required), context (optional), style (optional enum), spreadsheetId (optional — create new if omitted), sheetName (optional)
- `generate_template`: description (required), parameterize (optional boolean)
- `preview_generation`: description (required)

**Step 2: Generator Service** — `src/services/sheet-generator.ts` (NEW, ~400 lines)

```typescript
export class SheetGeneratorService {
  constructor(
    private samplingServer: SamplingServer,
    private compositeOps: CompositeOperationsService
  ) {}

  // Core pipeline:
  // 1. Send description to MCP Sampling → get structured sheet definition
  // 2. Parse response into SheetDefinition (columns, formulas, formatting, sample data)
  // 3. Execute via composite operations (create sheet → write headers → apply formulas → format)

  async generate(description: string, options: GenerateOptions): Promise<SheetDefinition> {
    // Build sampling request with system prompt containing:
    // - Column naming conventions
    // - Formula best practices (no volatile functions, use structured refs)
    // - Formatting standards (header freeze, number formats, conditional formatting)
    const samplingRequest = this.buildSamplingRequest(description, options);
    const response = await this.samplingServer.sample(samplingRequest);
    return this.parseSheetDefinition(response);
  }

  async execute(definition: SheetDefinition, spreadsheetId?: string): Promise<ExecutionResult> {
    // 1. Create spreadsheet (or use existing)
    // 2. Write headers via sheets_data.write
    // 3. Write sample data rows
    // 4. Apply formulas (relative refs for row formulas, absolute for summaries)
    // 5. Apply formatting via sheets_format (header style, number formats, conditional rules)
    // 6. Freeze header row via sheets_dimensions.freeze
    // 7. Auto-resize columns via sheets_dimensions.auto_resize
  }
}
```

**Step 3: Sampling Prompt Design** — `src/analysis/prompts/sheet-generation.ts` (NEW, ~150 lines)

The sampling prompt is the critical differentiator. It must produce:

```json
{
  "title": "Q1 2026 Budget Tracker",
  "sheets": [
    {
      "name": "Budget",
      "columns": [
        { "header": "Category", "type": "text", "width": 180 },
        { "header": "Jan", "type": "currency", "width": 120 },
        { "header": "Feb", "type": "currency", "width": 120 },
        { "header": "Mar", "type": "currency", "width": 120 },
        { "header": "Q1 Total", "type": "currency", "formula": "=SUM(B{row}:D{row})" }
      ],
      "rows": [
        { "values": ["Revenue", 50000, 55000, 60000] },
        { "values": ["COGS", 20000, 22000, 24000] },
        { "values": ["Gross Profit", null, null, null], "formulas": ["=B2-B3", "=C2-C3", "=D2-D3"] }
      ],
      "formatting": {
        "headerStyle": "bold_blue_background",
        "numberFormat": "$#,##0",
        "conditionalRules": [{ "range": "E2:E100", "rule": "negative_red" }],
        "freezeRows": 1
      }
    }
  ]
}
```

**Step 4: Handler Integration** — `src/handlers/composite.ts`

- Add 3 cases to the action switch
- Wire to SheetGeneratorService
- Use existing `sendProgress()` for streaming feedback during generation

**Files Changed:**

1. `src/schemas/composite.ts` — Add 3 actions to union
2. `src/handlers/composite.ts` — Add 3 handler methods
3. `src/services/sheet-generator.ts` — NEW (~400 lines)
4. `src/analysis/prompts/sheet-generation.ts` — NEW (~150 lines)
5. `tests/handlers/composite-generate.test.ts` — NEW

**Dependencies:** MCP Sampling capability (already integrated via `ElicitationEngine`)

**Leverage:**

- `CompositeOperationsService` for sheet creation + data writing
- `sheets_format` handler for styling (called internally)
- `sheets_dimensions` handler for freeze + auto-resize
- `sheets_templates.create` for saving as reusable template
- Sampling server for AI-powered structure design

---

## F2: Multi-Spreadsheet Federation

### What It Does

Query and join data across multiple spreadsheets in a single operation. "Show me all Q4 revenue from the Sales spreadsheet joined with cost data from the Finance spreadsheet."

### Why It Wins

Every other Sheets MCP server operates on one spreadsheet at a time. Cross-spreadsheet operations are the #1 pain point for Sheets power users. This solves it programmatically.

### Actions (extend `sheets_data`)

| Action          | Input                                                                         | Output                                        |
| --------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `cross_read`    | `{ sources: [{ spreadsheetId, range }], joinKey?: string }`                   | Merged dataset from multiple spreadsheets     |
| `cross_query`   | `{ sources: [...], query: string }`                                           | Natural language query across multiple sheets |
| `cross_write`   | `{ source: { spreadsheetId, range }, destination: { spreadsheetId, range } }` | Copy data between spreadsheets                |
| `cross_compare` | `{ source1: {...}, source2: {...}, compareColumns: string[] }`                | Diff two ranges across spreadsheets           |

### Implementation Plan

**Step 1: Schema** — `src/schemas/data.ts`

- Add 4 actions to discriminated union
- `cross_read`: sources array (each: spreadsheetId + range), joinKey (optional), joinType (optional: 'inner' | 'left' | 'outer')
- `cross_query`: sources array, query string (NL), outputFormat ('table' | 'summary')
- `cross_write`: source (spreadsheetId + range), destination (spreadsheetId + range), overwrite safety
- `cross_compare`: source1, source2, compareColumns array, tolerance (for numeric)

**Step 2: Cross-Spreadsheet Service** — `src/services/cross-spreadsheet.ts` (NEW, ~500 lines)

```typescript
export class CrossSpreadsheetService {
  constructor(
    private cachedApi: CachedSheetsApi,
    private parallelExecutor: ParallelExecutor,
    private samplingServer?: SamplingServer // for NL queries
  ) {}

  async crossRead(sources: DataSource[], joinConfig?: JoinConfig): Promise<MergedDataset> {
    // 1. Parallel fetch all source ranges (leverage ParallelExecutor)
    // 2. Normalize headers (case-insensitive, trim whitespace)
    // 3. If joinKey provided: perform join (hash-join for performance)
    // 4. If no joinKey: concatenate with source column added
    // Return: unified 2D array with merged headers
  }

  async crossQuery(sources: DataSource[], query: string): Promise<QueryResult> {
    // 1. Parallel fetch metadata + sample rows from each source
    // 2. Build Sampling request with schema context + query
    // 3. Parse AI response into: filter criteria, aggregations, join logic
    // 4. Execute data fetch with filters applied
    // 5. Apply aggregations/joins in-memory
    // Return: result set + explanation of query interpretation
  }

  async crossWrite(source: SourceRef, dest: DestRef, safety: SafetyOptions): Promise<WriteResult> {
    // 1. Read source range
    // 2. Validate destination (exists, size compatible)
    // 3. If overwrite: require confirmation via elicitation
    // 4. Write to destination
    // Return: cells written count
  }

  async crossCompare(s1: SourceRef, s2: SourceRef, config: CompareConfig): Promise<DiffResult> {
    // 1. Parallel fetch both ranges
    // 2. Align by compareColumns (key-based matching)
    // 3. Compute diffs: added rows, removed rows, changed cells
    // 4. For numeric columns: compute absolute + percentage deltas
    // Return: structured diff with change summary
  }
}
```

**Step 3: Handler Integration** — `src/handlers/data.ts`

- Add 4 cases to action switch
- Wire to CrossSpreadsheetService
- Safety: `cross_write` requires confirmation via `confirmDestructiveAction()`

**Files Changed:**

1. `src/schemas/data.ts` — Add 4 actions to union
2. `src/handlers/data.ts` — Add 4 handler methods
3. `src/services/cross-spreadsheet.ts` — NEW (~500 lines)
4. `tests/handlers/data-cross.test.ts` — NEW

**Dependencies:** `ParallelExecutor` (enabled), `CachedSheetsApi` (existing), Sampling for NL queries

**Leverage:**

- `ParallelExecutor` for concurrent multi-spreadsheet fetches (40% faster)
- `CachedSheetsApi` for repeat reads (80-100x reduction)
- `TieredRetrieval` for smart data loading per source
- Sampling server for natural language query interpretation
- `RequestDeduplicator` prevents duplicate fetches within 5s window

---

## F3: Automated Data Cleaning Pipeline

### What It Does

Detect and fix data quality issues automatically: inconsistent formats, duplicates, type mismatches, trailing whitespace, empty required fields, invalid emails, outlier values.

### Why It Wins

Data cleaning is 80% of spreadsheet work. Nobody automates this well in MCP. We already have `sheets_quality` (4 actions) for detection and `sheets_fix` (1 action) for fixes. This bridges the gap with an intelligent, automated pipeline.

### Actions (extend `sheets_fix`)

| Action                | Input                                                                                             | Output                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `clean`               | `{ spreadsheetId, range, rules?: CleanRule[] }`                                                   | Auto-detect and fix common issues                  |
| `standardize_formats` | `{ spreadsheetId, range, columns: FormatSpec[] }`                                                 | Normalize dates, currencies, phones, etc.          |
| `fill_missing`        | `{ spreadsheetId, range, strategy: 'forward'\|'backward'\|'mean'\|'median'\|'mode'\|'constant' }` | Fill empty cells using statistical strategies      |
| `detect_anomalies`    | `{ spreadsheetId, range, method?: 'iqr'\|'zscore'\|'isolation_forest' }`                          | Flag statistical outliers                          |
| `suggest_cleaning`    | `{ spreadsheetId, range }`                                                                        | AI-powered cleaning recommendations (preview only) |

### Implementation Plan

**Step 1: Schema** — `src/schemas/fix.ts`

- Extend from 1 action to 6 actions
- `clean`: spreadsheetId, range, rules (optional array of CleanRule), mode ('preview' | 'apply'), safety
- `standardize_formats`: spreadsheetId, range, columns (array of { column, targetFormat })
- `fill_missing`: spreadsheetId, range, strategy, constantValue (if strategy='constant')
- `detect_anomalies`: spreadsheetId, range, method, threshold (default 1.5 for IQR, 3 for zscore)
- `suggest_cleaning`: spreadsheetId, range (uses Sampling for AI recommendations)

**Step 2: Cleaning Engine** — `src/services/cleaning-engine.ts` (NEW, ~600 lines)

```typescript
export class CleaningEngine {
  // Built-in cleaning rules (auto-detected if no rules specified):
  private autoRules: CleanRule[] = [
    { id: 'trim_whitespace', detect: /^\s+|\s+$/, fix: 'trim' },
    { id: 'normalize_case', detect: 'mixed_case_in_column', fix: 'title_case' },
    { id: 'fix_dates', detect: 'inconsistent_date_formats', fix: 'iso_8601' },
    { id: 'fix_numbers', detect: 'text_numbers', fix: 'parse_number' },
    { id: 'fix_booleans', detect: /^(yes|no|true|false|1|0|y|n)$/i, fix: 'boolean' },
    { id: 'remove_duplicates', detect: 'exact_row_match', fix: 'keep_first' },
    { id: 'fix_emails', detect: 'invalid_email_format', fix: 'lowercase_trim' },
    { id: 'fix_phones', detect: 'inconsistent_phone_format', fix: 'e164' },
    { id: 'fix_urls', detect: 'missing_protocol', fix: 'add_https' },
    { id: 'fix_currency', detect: 'mixed_currency_formats', fix: 'number_only' },
  ];

  async clean(
    data: CellValue[][],
    rules: CleanRule[],
    mode: 'preview' | 'apply'
  ): Promise<CleanResult> {
    // 1. Profile each column (type distribution, null rate, unique rate)
    // 2. Auto-detect applicable rules per column
    // 3. Apply rules in priority order (whitespace → types → formats → dedup)
    // 4. Track all changes: { row, col, oldValue, newValue, rule }
    // 5. If preview: return changes without writing
    // 6. If apply: write via sheets_data.write + return summary
  }

  async standardizeFormats(data: CellValue[][], specs: FormatSpec[]): Promise<FormatResult> {
    // Per-column format normalization:
    // - Dates: detect format (MM/DD, DD/MM, YYYY-MM-DD) → target format
    // - Currency: strip symbols, normalize decimals
    // - Phone: parse via simple regex → E.164 or national format
    // - Percentage: 0.15 ↔ 15% normalization
  }

  async fillMissing(data: CellValue[][], strategy: FillStrategy): Promise<FillResult> {
    // - forward: last known value fills down
    // - backward: next known value fills up
    // - mean/median/mode: column statistics
    // - constant: user-provided value
    // Track: { row, col, filledValue, strategy }
  }

  async detectAnomalies(data: CellValue[][], config: AnomalyConfig): Promise<AnomalyResult> {
    // IQR method: Q1 - 1.5*IQR < x < Q3 + 1.5*IQR
    // Z-score: |z| > threshold (default 3)
    // Return: flagged cells with scores + visualization data
  }
}
```

**Step 3: Handler Integration** — `src/handlers/fix.ts`

- Extend from 1 handler method to 6
- Wire CleaningEngine
- `suggest_cleaning` uses Sampling for AI-powered recommendations
- All mutations respect existing safety rails (snapshot + confirmation)

**Files Changed:**

1. `src/schemas/fix.ts` — Expand from 1 to 6 actions
2. `src/handlers/fix.ts` — Add 5 handler methods
3. `src/services/cleaning-engine.ts` — NEW (~600 lines)
4. `tests/handlers/fix-cleaning.test.ts` — NEW

**Dependencies:** `ValidationEngine` (existing), Sampling for `suggest_cleaning`

**Leverage:**

- `ValidationEngine` built-in validators (email, phone, url, required, etc.)
- `sheets_quality.validate` for detection pass
- Existing snapshot system for safe rollback
- `sendProgress()` for streaming cleaning progress on large datasets
- `applyVerbosityFilter()` for result size control

---

## F4: Smart Suggestions / Copilot Mode

### What It Does

After reading/analyzing a sheet, proactively suggest next actions: "You have Revenue and Cost columns — want me to add a Profit Margin formula?" or "These dates aren't sorted — want me to sort descending?"

### Why It Wins

Every other Sheets MCP server is purely reactive (waits for commands). This makes ServalSheets proactive — it understands your data context and suggests improvements. This is the "it feels intelligent" feature.

### Actions (extend `sheets_analyze`)

| Action                 | Input                                                | Output                                                       |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `suggest_next_actions` | `{ spreadsheetId, range?, maxSuggestions?: number }` | Ranked list of actionable suggestions with executable params |
| `auto_enhance`         | `{ spreadsheetId, range?, categories?: string[] }`   | Apply top N non-destructive enhancements automatically       |

### Implementation Plan

**Step 1: Schema** — `src/schemas/analyze.ts`

- Add 2 actions to discriminated union
- `suggest_next_actions`: spreadsheetId (required), range (optional), maxSuggestions (default 5), categories (optional filter: 'formulas' | 'formatting' | 'structure' | 'data_quality' | 'visualization')
- `auto_enhance`: spreadsheetId, range, categories, mode ('preview' | 'apply'), maxEnhancements (default 3)

**Step 2: Suggestion Engine** — `src/analysis/suggestion-engine.ts` (NEW, ~500 lines)

```typescript
export class SuggestionEngine {
  constructor(
    private scout: Scout,
    private actionGenerator: ActionGenerator,
    private sessionContext: SessionContextManager,
    private samplingServer?: SamplingServer
  ) {}

  async suggest(spreadsheetId: string, range?: string, max: number = 5): Promise<Suggestion[]> {
    // Phase 1: Quick structural scan (via Scout, ~200ms)
    const scoutResult = await this.scout.quickScan(spreadsheetId);

    // Phase 2: Pattern-based suggestions (no AI, instant):
    const patternSuggestions = this.detectPatterns(scoutResult);
    // - Missing summary row (has data rows but no SUM/AVERAGE at bottom)
    // - Unsorted data (dates or IDs out of order)
    // - Missing freeze (header row not frozen)
    // - Inconsistent formatting (mixed number formats in same column)
    // - Empty columns between data (hidden structure issues)
    // - Missing conditional formatting on numeric columns
    // - Columns that could have data validation (repeated values = dropdown candidate)
    // - Missing chart (numeric time series data without visualization)

    // Phase 3: AI-powered suggestions (via Sampling, ~2s):
    if (this.samplingServer && patternSuggestions.length < max) {
      const aiSuggestions = await this.getAISuggestions(scoutResult, patternSuggestions);
      // AI can suggest: calculated columns, pivot table candidates, data relationships
    }

    // Phase 4: Rank and deduplicate
    return this.rankSuggestions([...patternSuggestions, ...aiSuggestions], max);
  }

  // Each suggestion includes executable params ready for tool dispatch:
  // {
  //   id: 'add_profit_margin',
  //   title: 'Add Profit Margin Column',
  //   description: 'Revenue (B) and Cost (C) columns detected. Add Profit Margin = (B-C)/B',
  //   confidence: 0.92,
  //   category: 'formulas',
  //   impact: 'low_risk',
  //   action: {
  //     tool: 'sheets_data',
  //     action: 'write',
  //     params: { spreadsheetId, range: 'Sheet1!E1', values: [['Profit Margin'], ['=(B2-C2)/B2']] }
  //   }
  // }
}
```

**Step 3: Auto-Enhancement Pipeline** — integrated into suggestion engine

```typescript
async autoEnhance(spreadsheetId: string, options: EnhanceOptions): Promise<EnhanceResult> {
  // 1. Get top N non-destructive suggestions (categories: formatting, structure only)
  // 2. Filter to safe operations only (no data modification):
  //    - Freeze header rows ✅
  //    - Auto-resize columns ✅
  //    - Add number formatting ✅
  //    - Add conditional formatting ✅
  //    - Sort by date/ID columns ⚠️ (preview first)
  //    - Add summary row ⚠️ (preview first)
  // 3. If mode='preview': return proposed changes
  // 4. If mode='apply': execute safe operations, return results
}
```

**Step 4: Handler Integration** — `src/handlers/analyze.ts`

- Add 2 cases to action switch
- Wire SuggestionEngine
- `suggest_next_actions` returns suggestions with executable params
- `auto_enhance` creates snapshot before applying

**Files Changed:**

1. `src/schemas/analyze.ts` — Add 2 actions
2. `src/handlers/analyze.ts` — Add 2 handler methods
3. `src/analysis/suggestion-engine.ts` — NEW (~500 lines)
4. `tests/handlers/analyze-suggestions.test.ts` — NEW

**Dependencies:** Scout (existing), ActionGenerator (existing), Sampling (optional), SessionContext (existing)

**Leverage:**

- `Scout.quickScan()` for fast structural analysis (~200ms)
- `ActionGenerator.generate()` for converting findings into executable params
- `SessionContextManager` for remembering rejected suggestions (don't repeat)
- `session.reject_suggestion` action already exists for learning from feedback
- `session.record_successful_formula` for positive reinforcement
- `ConfidenceScorer` for ranking suggestions

---

## F5: Time-Travel Debugger

### What It Does

Step through a spreadsheet's change history to find when and where data broke. Visual diff between any two points in time, with the ability to restore specific cells (not entire revisions).

### Why It Wins

Google Sheets has version history, but it's all-or-nothing restore. This gives surgical precision: "Show me what changed in column D between Tuesday and Thursday" → "Cell D15 changed from 5000 to 500 (likely typo) — want me to restore just that cell?"

### Actions (extend `sheets_history`)

| Action           | Input                                                       | Output                                                 |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `timeline`       | `{ spreadsheetId, range?, since?: string, until?: string }` | Chronological list of changes with who/what/when       |
| `diff_revisions` | `{ spreadsheetId, revisionId1, revisionId2, range? }`       | Cell-level diff between two revisions                  |
| `restore_cells`  | `{ spreadsheetId, revisionId, cells: string[] }`            | Restore specific cells from a past revision (surgical) |

### Implementation Plan

**Step 1: Schema** — `src/schemas/history.ts`

- Add 3 actions to discriminated union (7 → 10 actions)
- `timeline`: spreadsheetId, range (optional for scope), since/until (ISO dates), limit (default 50)
- `diff_revisions`: spreadsheetId, revisionId1, revisionId2, range (optional focus area)
- `restore_cells`: spreadsheetId, revisionId (source), cells (A1 references array), safety

**Step 2: Time-Travel Service** — `src/services/time-travel.ts` (NEW, ~450 lines)

```typescript
export class TimeTravelService {
  constructor(
    private googleClient: GoogleApiClient,
    private historyService: HistoryService,
    private cachedApi: CachedSheetsApi
  ) {}

  async getTimeline(spreadsheetId: string, options: TimelineOptions): Promise<TimelineEntry[]> {
    // 1. Fetch revision list via Drive API (revisions.list)
    // 2. For each revision pair (n, n+1):
    //    a. Export both as CSV (lightweight, avoids full API calls)
    //    b. Compute cell-level diff
    //    c. Attribute to user (revision.lastModifyingUser)
    // 3. Filter to range if specified
    // 4. Return chronological list:
    //    [{ timestamp, user, changes: [{ cell, oldValue, newValue }] }]
    //
    // OPTIMIZATION: For large revision sets, use binary search to find
    // the first revision within the time window, then scan forward.
    // Cache revision metadata (small) but not full content (large).
  }

  async diffRevisions(
    spreadsheetId: string,
    rev1: string,
    rev2: string,
    range?: string
  ): Promise<RevisionDiff> {
    // 1. Export both revisions via Drive API (export as xlsx/csv)
    // 2. Parse both into cell grids
    // 3. Cell-by-cell comparison:
    //    - Added cells (empty → value)
    //    - Removed cells (value → empty)
    //    - Changed cells (value → different value)
    //    - Formula changes (formula text changed)
    //    - Format changes (if detectable)
    // 4. If range specified: filter to that region
    // 5. Return: { added: [], removed: [], changed: [], summary: {} }
    //
    // Uses existing DiffEngine (3 tiers: METADATA, SAMPLE, FULL)
  }

  async restoreCells(
    spreadsheetId: string,
    revisionId: string,
    cells: string[]
  ): Promise<RestoreResult> {
    // 1. Export target revision
    // 2. Extract values for specified cells
    // 3. Create snapshot of current state (safety)
    // 4. Write old values to current spreadsheet
    // 5. Record operation in history (undoable)
    // Return: { restored: [{ cell, oldValue, restoredValue }] }
  }
}
```

**Step 3: Handler Integration** — `src/handlers/history.ts`

- Add 3 cases to action switch (7 → 10)
- Wire TimeTravelService
- `restore_cells` requires confirmation + snapshot

**Files Changed:**

1. `src/schemas/history.ts` — Add 3 actions
2. `src/handlers/history.ts` — Add 3 handler methods
3. `src/services/time-travel.ts` — NEW (~450 lines)
4. `tests/handlers/history-timetravel.test.ts` — NEW

**Dependencies:** Drive API (revisions), existing DiffEngine, HistoryService

**Leverage:**

- `HistoryService` (17,567 lines) for operation tracking and undo support
- Existing diff engine (METADATA/SAMPLE/FULL tiers)
- `createSnapshotIfNeeded()` for safe restoration
- `confirmDestructiveAction()` for restore confirmation
- Drive API `revisions.list` + `revisions.export` (already available via googleClient)

---

## F6: Scenario Modeling ("What If" Engine)

### What It Does

"What if revenue drops 20%?" → Automatically traces all dependent cells, recalculates, and shows impact across the entire spreadsheet. Creates a side-by-side comparison without modifying the original.

### Why It Wins

Excel has "What-If Analysis" (Goal Seek, Data Tables, Scenario Manager), but Google Sheets doesn't. No MCP server offers this. Combined with our dependency graph, this becomes incredibly powerful.

### Actions (extend `sheets_dependencies`)

| Action                  | Input                                                                    | Output                                                |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `model_scenario`        | `{ spreadsheetId, changes: [{ cell, newValue }], outputRange?: string }` | Full recalculation cascade showing all affected cells |
| `compare_scenarios`     | `{ spreadsheetId, scenarios: [{ name, changes }] }`                      | Side-by-side comparison of multiple scenarios         |
| `create_scenario_sheet` | `{ spreadsheetId, scenario: {...}, targetSheet?: string }`               | Materialize scenario as new sheet (non-destructive)   |

### Implementation Plan

**Step 1: Schema** — `src/schemas/dependencies.ts`

- Add 3 actions to discriminated union (7 → 10 actions)
- `model_scenario`: spreadsheetId, changes (array of { cell: A1 ref, newValue: CellValue }), outputRange (optional — scope the impact report)
- `compare_scenarios`: spreadsheetId, scenarios (array of { name, changes }), compareColumns (optional focus)
- `create_scenario_sheet`: spreadsheetId, scenario (name + changes), targetSheet (default: "Scenario - {name}")

**Step 2: Scenario Engine** — `src/services/scenario-engine.ts` (NEW, ~550 lines)

```typescript
export class ScenarioEngine {
  constructor(
    private impactAnalyzer: ImpactAnalyzer,
    private cachedApi: CachedSheetsApi,
    private googleClient: GoogleApiClient
  ) {}

  async modelScenario(spreadsheetId: string, changes: CellChange[]): Promise<ScenarioResult> {
    // 1. Build dependency graph (via ImpactAnalyzer)
    const graph = await this.impactAnalyzer.buildGraph(spreadsheetId);

    // 2. For each changed cell, trace ALL dependents (transitive closure)
    const affectedCells = new Set<string>();
    for (const change of changes) {
      const dependents = graph.getTransitiveDependents(change.cell);
      dependents.forEach((d) => affectedCells.add(d));
    }

    // 3. Fetch current values for all affected cells
    const currentValues = await this.cachedApi.batchGet(
      spreadsheetId,
      [...affectedCells].map((cell) => cell) // A1 references
    );

    // 4. Simulate recalculation:
    //    a. Create in-memory cell grid
    //    b. Apply input changes
    //    c. Topological sort dependents
    //    d. Evaluate formulas in order (using formula-parser)
    //    e. Compare new values vs current values
    const simulation = this.simulate(graph, changes, currentValues);

    // 5. Return impact report:
    // {
    //   inputChanges: [{ cell: 'B2', from: 100000, to: 80000 }],
    //   cascadeEffects: [
    //     { cell: 'B5', formula: '=B2-B3', from: 50000, to: 30000, delta: -40% },
    //     { cell: 'E5', formula: '=SUM(B5:D5)', from: 150000, to: 130000, delta: -13.3% }
    //   ],
    //   summary: { cellsAffected: 47, maxDelta: '-40%', riskLevel: 'high' }
    // }
  }

  async compareScenarios(
    spreadsheetId: string,
    scenarios: NamedScenario[]
  ): Promise<ComparisonResult> {
    // 1. Run modelScenario for each scenario (parallel)
    // 2. Align results by cell reference
    // 3. Build comparison matrix:
    //    | Cell | Current | Scenario A | Scenario B | Scenario C |
    //    | B5   | 50,000  | 30,000     | 45,000     | 60,000     |
    // 4. Rank scenarios by impact severity
  }

  async createScenarioSheet(
    spreadsheetId: string,
    scenario: NamedScenario,
    targetSheet: string
  ): Promise<SheetResult> {
    // 1. Copy current sheet structure (via sheets_core.duplicate_sheet)
    // 2. Apply scenario changes to the copy
    // 3. Add header row: "Scenario: {name} — Generated {date}"
    // 4. Highlight changed cells (yellow background)
    // 5. Add conditional formatting (red for negative deltas, green for positive)
    // Return: new sheet ID + URL
  }

  // In-memory formula evaluator (subset of Google Sheets functions)
  private simulate(
    graph: DependencyGraph,
    changes: CellChange[],
    current: Map<string, CellValue>
  ): SimulationResult {
    // Supports: basic arithmetic, SUM, AVERAGE, MIN, MAX, IF, AND, OR,
    // VLOOKUP (in-memory), ROUND, ABS, percentage calculations
    // For unsupported functions: flag as "cannot simulate" and show dependency only
  }
}
```

**Step 3: Formula Evaluator** — extend `src/analysis/formula-helpers.ts`

- Add `evaluateFormula(formula: string, cellValues: Map<string, CellValue>): CellValue`
- Support top 20 most-used Google Sheets functions
- Flag unsupported functions rather than failing

**Step 4: Handler Integration** — `src/handlers/dependencies.ts`

- Add 3 cases to action switch (7 → 10)
- Wire ScenarioEngine
- `create_scenario_sheet` requires confirmation (creates new sheet)

**Files Changed:**

1. `src/schemas/dependencies.ts` — Add 3 actions
2. `src/handlers/dependencies.ts` — Add 3 handler methods
3. `src/services/scenario-engine.ts` — NEW (~550 lines)
4. `src/analysis/formula-helpers.ts` — Extend with evaluateFormula()
5. `tests/handlers/dependencies-scenario.test.ts` — NEW

**Dependencies:** ImpactAnalyzer (existing), DependencyGraph (existing), formula-parser (existing)

**Leverage:**

- `ImpactAnalyzer` (11,645 lines) for dependency graph building
- `DependencyGraph` (12,954 lines) for traversal + transitive closure
- `formula-parser.ts` (14,047 lines) for AST parsing
- `formula-helpers.ts` (24,415 lines) for formula evaluation utilities
- `ParallelExecutor` for concurrent scenario modeling
- `sheets_core.duplicate_sheet` for materializing scenarios

---

## Implementation Order

### Phase 1: Quick Wins (1-2 sessions each)

| Order | Feature                   | Why First                                                                                                                                 |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **F4: Smart Suggestions** | Smallest scope (2 actions, ~500 lines new). Highest "wow" factor per line of code. Leverages Scout + ActionGenerator which already exist. |
| 2     | **F3: Data Cleaning**     | Clear user need. Extends existing quality/fix infrastructure. 5 actions but straightforward logic (no AI required for core cleaning).     |

### Phase 2: Medium Lift (2-3 sessions each)

| Order | Feature                 | Why Next                                                                                    |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------- |
| 3     | **F1: Sheet Generator** | Depends heavily on Sampling prompt quality (needs iteration). High-impact but needs tuning. |
| 4     | **F5: Time-Travel**     | Depends on Drive API revision access (needs testing). Medium complexity.                    |

### Phase 3: Complex Features (3-4 sessions each)

| Order | Feature                        | Why Last                                                                                              |
| ----- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 5     | **F6: Scenario Modeling**      | Requires in-memory formula evaluator (complex). Depends on dependency graph being bulletproof.        |
| 6     | **F2: Cross-Sheet Federation** | Highest complexity (parallel fetches, joins, NL queries). Needs thorough testing with large datasets. |

### After Each Feature

```bash
npm run schema:commit    # Regenerate metadata (ACTION_COUNT will update: 315 → 335)
npm run verify:safe      # Full verification (skip lint if OOM)
npm run test:fast        # Ensure no regressions
```

---

## Action Count Impact

| Tool                | Current | After   | Delta   |
| ------------------- | ------- | ------- | ------- |
| sheets_composite    | 11      | 14      | +3 (F1) |
| sheets_data         | 19      | 23      | +4 (F2) |
| sheets_fix          | 1       | 6       | +5 (F3) |
| sheets_analyze      | 16      | 18      | +2 (F4) |
| sheets_history      | 7       | 10      | +3 (F5) |
| sheets_dependencies | 7       | 10      | +3 (F6) |
| **TOTAL**           | **315** | **335** | **+20** |

Tool count remains **22** (no new tools created).

---

## Risk Mitigation

| Risk                                  | Mitigation                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sampling server unavailable           | F4 has pattern-based fallback (no AI needed for basic suggestions). F1/F6 degrade gracefully.                              |
| Drive API revision limits             | F5 caches revision metadata, uses binary search for time ranges. Falls back to operation history if revisions unavailable. |
| Formula evaluator incompleteness (F6) | Flag unsupported functions as "cannot simulate" rather than failing. Show dependency chain even without computed values.   |
| Large dataset performance (F2, F3)    | Use TieredRetrieval for smart sampling. Chunk operations. Stream progress via `sendProgress()`.                            |
| Schema bloat                          | All 20 actions extend existing tools — no new tool discovery needed by clients.                                            |

---

## Success Metrics

| Feature                    | Success Metric                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| F1: Sheet Generator        | Generated sheet has >0 formulas AND >0 formatting rules 95% of the time        |
| F2: Cross-Sheet Federation | cross_read handles 5+ sources with <3s latency                                 |
| F3: Data Cleaning          | clean action detects ≥3 issue types automatically per typical dataset          |
| F4: Smart Suggestions      | suggest_next_actions returns ≥3 actionable suggestions for any non-empty sheet |
| F5: Time-Travel            | timeline shows per-cell changes for last 30 days of revision history           |
| F6: Scenario Modeling      | model_scenario traces ≥90% of formula dependencies correctly                   |
