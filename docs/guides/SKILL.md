---
title: ServalSheets Skill Guide for Claude
category: guide
last_updated: 2026-03-11
description: This guide helps Claude (and other AI assistants) use ServalSheets MCP server effectively.
version: 1.7.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# ServalSheets Skill Guide for Claude

This guide helps Claude (and other AI assistants) use ServalSheets MCP server effectively.

## Overview

ServalSheets provides 25 tools with 407 actions for comprehensive Google Sheets operations. It's production-grade with safety rails, semantic range resolution, and intelligent batching.

## MCP Protocol Notes (2025-11-25)

ServalSheets follows MCP 2025-11-25. Use protocol-level features when available.

- Tool results are MCP CallToolResult. Prefer `structuredContent.response`; check `response.success` and read `response.error` when false. `isError` may be set.
- Tool inputs are wrapped under `request` (e.g., `{ request: { action: 'read', ... } }`).
- Tool annotations are provided (readOnlyHint, destructiveHint, idempotentHint, openWorldHint). Use them to choose safe operations and confirm destructive changes.
- Resources:
  - `sheets:///{spreadsheetId}` returns spreadsheet metadata (properties + sheet list).
  - `sheets:///{spreadsheetId}/{range}` returns range values (A1 notation; URL-encoded).
  - `knowledge:///formulas/financial.json`, `knowledge:///formulas/lookup.json`, `knowledge:///formulas/key-formulas.json`
  - `knowledge:///templates/common-templates.json`
    Use resources/list and resources/read to discover and load.
- Prompts: use `prompts/list` to discover the full current set. Common starter workflows include `welcome`, `test_connection`, `first_operation`, `analyze_spreadsheet`, `transform_data`, `create_report`, and `clean_data`.
- Long operations may emit MCP progress notifications. Treat them as status only.
- Large reads may return `truncated: true` and `resourceUri`. You can read the URI with the range resource; if you cannot fetch it, request a narrower range or use batch reads.

## Core Capabilities

### 1. Data Operations (sheets_data)

**What it does**: Read, write, append, and batch operations on cell values

**Best practices**:

- Use `valueRenderOption: 'FORMATTED_VALUE'` for human-readable data
- Use `valueRenderOption: 'UNFORMATTED_VALUE'` for calculations
- Always specify `valueInputOption` when writing (typically 'USER_ENTERED' for formulas)
- Use batch operations for multiple ranges to save API calls

**Example workflow**:

```javascript
// 1. Read data
const data = await sheets_data({
  action: 'read',
  spreadsheetId: 'xxx',
  range: { a1: 'Sales!A1:D100' },
  valueRenderOption: 'UNFORMATTED_VALUE',
});

// 2. Process data (your logic here)
const processed = processData(data.values);

// 3. Write back
await sheets_data({
  action: 'write',
  spreadsheetId: 'xxx',
  range: { a1: 'Results!A1' },
  values: processed,
  valueInputOption: 'USER_ENTERED',
});
```

### 2. Semantic Range Resolution

**What it does**: Query ranges by column headers instead of A1 notation

**When to use**:

- When user asks to "update the Revenue column" (you don't know which column that is)
- When working with dynamic spreadsheets where columns may move
- When user provides natural language range descriptions

**Example**:

```javascript
// Instead of asking user for column letter
await sheets_data({
  action: 'read',
  spreadsheetId: 'xxx',
  range: {
    semantic: {
      sheet: 'Sales Data',
      column: 'Total Revenue', // Will find the column with this header
      includeHeader: false,
    },
  },
});
// Returns: { values: [...], resolution: { method: 'semantic_header', confidence: 1.0 } }
```

### 3. Safety Rails (Always Use for Destructive Operations)

**What it does**: Prevent accidental data loss or large-scale changes

**When to use**:

- ALWAYS for operations that delete, clear, or overwrite data
- When user asks to "update all rows" or similar bulk operations
- When you're unsure about the scope of impact

**Safety checklist**:

```javascript
{
  safety: {
    // 1. Preview first
    dryRun: true,  // See impact without executing

    // 2. Limit scope
    effectScope: {
      maxCellsAffected: 1000,  // Fail if more than 1000 cells affected
      requireExplicitRange: true  // Prevent whole-sheet operations
    },

    // 3. Validate state
    expectedState: {
      rowCount: 100,  // Fail if row count changed
      sheetTitle: 'Sales',  // Fail if sheet renamed
      checksum: 'abc123'  // Fail if data changed
    },

    // 4. Create backup
    autoSnapshot: true  // Create Drive version before executing
  }
}
```

### 4. Data Analysis (sheets_analyze)

**What it does**: Analyze data quality, formulas, statistics, correlations

**When to use**:

- User asks "is my data clean?" or "any quality issues?"
- Before performing bulk updates (check data first)
- User wants statistics, correlations, or summaries

**Example workflow**:

```javascript
// 1. Check data quality
const quality = await sheets_analyze({
  action: 'analyze_quality',
  spreadsheetId: 'xxx',
  range: { a1: 'Data!A1:Z100' },
});
// Shows: empty headers, duplicates, mixed types, outliers

// 2. Audit formulas
const audit = await sheets_analyze({
  action: 'analyze_formulas',
  spreadsheetId: 'xxx',
  range: { a1: 'Calculations!A1:Z100' },
});
// Shows: broken references, volatile functions, complex formulas

// 3. Get statistics
const stats = await sheets_analyze({
  action: 'analyze_data',
  spreadsheetId: 'xxx',
  range: { a1: 'Sales!B2:F100' },
});
// Shows: mean, median, stdDev, min, max for each column
```

### 5. Formatting and Rules (sheets_format, sheets_format)

**What it does**: Apply text/number formatting, plus conditional formatting and data validation rules.

**Common patterns**:

```javascript
// Currency formatting
await sheets_format({
  action: 'set_number_format',
  spreadsheetId: 'xxx',
  range: { a1: 'Data!B2:B100' },
  numberFormat: {
    type: 'CURRENCY',
    pattern: '$#,##0.00',
  },
});

// Date formatting
await sheets_format({
  action: 'set_number_format',
  spreadsheetId: 'xxx',
  range: { a1: 'Data!C2:C100' },
  numberFormat: {
    type: 'DATE',
    pattern: 'yyyy-mm-dd',
  },
});

// Conditional formatting (highlight > threshold)
// Note: sheetId is required; get it from sheets_core or sheets:///{spreadsheetId}
await sheets_format({
  action: 'rule_add_conditional_format',
  spreadsheetId: 'xxx',
  sheetId: 0,
  range: { a1: 'Data!D2:D100' },
  rule: {
    type: 'boolean',
    condition: {
      type: 'NUMBER_GREATER',
      values: ['1000'],
    },
    format: {
      backgroundColor: { red: 0.8, green: 1, blue: 0.8 },
    },
  },
});
```

### 6. Charts (sheets_visualize)

**What it does**: Create, update, delete charts

**Available chart types**: BAR, COLUMN, LINE, AREA, SCATTER, COMBO, PIE, HISTOGRAM, CANDLESTICK, WATERFALL

**Example**:

```javascript
await sheets_visualize({
  action: 'chart_create',
  spreadsheetId: 'xxx',
  sheetId: 0,
  chartType: 'COLUMN',
  data: {
    sourceRange: { a1: 'Sales!A1:B12' },
    categories: 0, // Column 0 (A) for X-axis
    series: [{ column: 1 }], // Column 1 (B) for data
  },
  position: {
    anchorCell: 'Sheet1!F1',
    width: 600,
    height: 400,
  },
  options: {
    title: 'Monthly Sales',
    legendPosition: 'BOTTOM',
  },
});
```

### 7. Pivot Tables (sheets_visualize)

**What it does**: Create and manage pivot tables

**When to use**:

- User asks to "summarize by category"
- Need to aggregate data dynamically
- Want to analyze data from multiple dimensions

### 8. Version Control (sheets_collaborate)

**What it does**: List revisions and manage snapshots (restore points). Use `version_keep_revision` to pin a revision.

**When to use**:

- User wants to audit changes or list revisions
- Before major destructive operations (create a snapshot)
- User asks "what changed recently?"

```javascript
// List recent revisions
const revisions = await sheets_collaborate({
  action: 'version_list_revisions',
  spreadsheetId: 'xxx',
  pageSize: 20,
});

// Create a snapshot restore point
const snapshot = await sheets_collaborate({
  action: 'version_create_snapshot',
  spreadsheetId: 'xxx',
  name: 'Before bulk update',
});

// Restore from a snapshot copy
await sheets_collaborate({
  action: 'version_restore_snapshot',
  spreadsheetId: 'xxx',
  snapshotId: snapshot.snapshot?.id ?? 'snapshot-id',
});
```

Note: `version_restore_revision` currently returns FEATURE_UNAVAILABLE; use snapshots when you need a restorable copy.

## Common Workflows

### Workflow 1: Data Import and Validation

```javascript
// 1. Read user's source data
const source = await sheets_data({ action: 'read', ... });

// 2. Validate and clean
const quality = await sheets_analyze({ action: 'analyze_quality', ... });
if (quality.dataQuality.issues.length > 0) {
  // Inform user about issues
}

// 3. Write to destination with safety
await sheets_data({
  action: 'write',
  ...,
  safety: {
    dryRun: true,  // Preview first
    effectScope: { maxCellsAffected: 10000 }
  }
});

// 4. If preview looks good, execute
await sheets_data({ action: 'write', ... });
```

### Workflow 2: Automated Report Generation

```javascript
const spreadsheetId = 'xxx';

// 1. Create new sheet for report
const report = await sheets_core({ action: 'add_sheet', spreadsheetId, title: 'Monthly Report' });
const reportSheetId = report.sheet?.sheetId ?? 0;

// 2. Write headers and formulas
await sheets_data({
  action: 'write',
  spreadsheetId,
  range: { a1: 'Monthly Report!A1:E1' },
  values: [['Date', 'Revenue', 'Expenses', 'Profit', 'Margin']],
  valueInputOption: 'RAW',
});

// 3. Write formulas for calculations
await sheets_data({
  action: 'write',
  spreadsheetId,
  range: { a1: 'Monthly Report!D2' },
  values: [['=B2-C2']], // Profit = Revenue - Expenses
  valueInputOption: 'USER_ENTERED',
});

// 4. Format currency columns
await sheets_format({
  action: 'set_number_format',
  spreadsheetId,
  range: { a1: 'Monthly Report!B2:D100' },
  numberFormat: { type: 'CURRENCY' },
});

// 5. Create chart
await sheets_visualize({
  action: 'chart_create',
  spreadsheetId,
  sheetId: reportSheetId,
  chartType: 'LINE',
  data: { sourceRange: { a1: 'Monthly Report!A1:E100' } },
  position: { anchorCell: 'Monthly Report!G1' },
});
```

### Workflow 3: Data Quality Monitoring

```javascript
// 1. Check data quality
const quality = await sheets_analyze({
  action: 'analyze_quality',
  spreadsheetId: 'xxx',
  range: { a1: 'Data!A1:Z1000' },
});

// 2. Audit formulas
const formulas = await sheets_analyze({
  action: 'analyze_formulas',
  spreadsheetId: 'xxx',
  range: { a1: 'Calculations!A1:Z1000' },
});

// 3. Compare with expected state
const comparison = await sheets_analyze({
  action: 'analyze_data',
  spreadsheetId: 'xxx',
  range: { a1: 'Current!A1:Z100' },
});

// 4. Report findings to user
// Quality issues: X duplicates, Y empty headers, Z outliers
// Formula issues: A broken references, B volatile functions
// Stats: C columns profiled, D anomalies detected
```

## Best Practices for Claude

### 1. Always Ask Before Destructive Operations

❌ DON'T: await sheets_data({ action: 'clear', range: { a1: 'Data!A1:Z1000' } })

✅ DO:

- "I found 1000 rows. Do you want me to clear all of them?"
- Use dry-run first: safety: { dryRun: true }
- Show impact: "This will affect 5,000 cells"

### 2. Use Semantic Ranges When Possible

❌ DON'T: "Which column has the revenue data? A? B? C?"

✅ DO: await sheets_data({
range: { semantic: { sheet: 'Sales', column: 'Revenue' } }
})
// Let ServalSheets find the column

### 3. Validate Data Before Operations

❌ DON'T: Write formulas without checking data quality

✅ DO:

1. Run sheets_analyze({ action: 'analyze_quality' })
2. Check for empty headers, duplicates, type mismatches
3. Inform user of issues before proceeding

### 4. Use Effect Scope Limits

❌ DON'T: await sheets_dimensions({ action: 'delete_rows', startIndex: 0, endIndex: 10000 })

✅ DO: await sheets_dimensions({
action: 'delete_rows',
startIndex: 0,
endIndex: 10000,
safety: {
effectScope: { maxRowsAffected: 100 }, // Fail if user meant less
dryRun: true // Preview first
}
})

### 5. Create Restore Points for Major Changes

✅ DO:
const snapshot = await sheets_collaborate({
action: 'version_create_snapshot',
spreadsheetId: 'xxx',
name: 'Before bulk update'
});

// Now do the risky operation
await sheets_data({ action: 'write', ... });

// If something goes wrong:
await sheets_collaborate({
action: 'version_restore_snapshot',
spreadsheetId: 'xxx',
snapshotId: snapshot.snapshot?.id ?? 'snapshot-id'
});

### 6. Batch Operations for Efficiency

❌ DON'T:
for (const range of ranges) {
await sheets_data({ action: 'read', range });
}

✅ DO:
await sheets_data({
action: 'batch_read',
ranges: ranges,
valueRenderOption: 'FORMATTED_VALUE'
});

### 7. Handle Errors Gracefully

All ServalSheets errors include:

- code: Error code (SHEET_NOT_FOUND, PERMISSION_DENIED, etc.)
- message: Human-readable description
- retryable: Whether retry might succeed
- suggestedFix: How to fix the issue
- alternatives: Alternative approaches

```javascript
try {
  await sheets_data({ action: 'write', ... });
} catch (error) {
  if (error.code === 'PERMISSION_DENIED') {
    // Inform user: "You don't have edit access. Ask the owner for permission."
  } else if (error.code === 'QUOTA_EXCEEDED') {
    // Inform user: "API quota exceeded. Try again in a few minutes."
  } else if (error.code === 'PRECONDITION_FAILED') {
    // Inform user: "The spreadsheet changed since we last read it. Refreshing data..."
  }
}
```

## Tool Selection Guide

| User says...                   | Use this tool                | Action                      |
| ------------------------------ | ---------------------------- | --------------------------- |
| "Read data from column B"      | sheets_data                  | read                        |
| "Update the Revenue column"    | sheets_data + semantic range | write                       |
| "Add a new sheet called Sales" | sheets_core                  | add_sheet                   |
| "Delete rows 10-20"            | sheets_dimensions            | delete_rows                 |
| "Format as currency"           | sheets_format                | set_number_format           |
| "Add a chart showing..."       | sheets_visualize             | chart_create                |
| "Is my data clean?"            | sheets_analyze               | analyze_quality             |
| "Show me statistics"           | sheets_analyze               | analyze_data                |
| "Create a pivot table"         | sheets_visualize             | pivot_create                |
| "Add conditional formatting"   | sheets_format                | rule_add_conditional_format |
| "Protect this range"           | sheets_advanced              | add_protected_range         |
| "Undo my last change"          | sheets_history               | undo                        |
| "Who has access?"              | sheets_collaborate           | share_list                  |
| "Add a comment"                | sheets_collaborate           | comment_add                 |

## Advanced Tips

### 1. Combining Tools for Complex Operations

```javascript
// Example: "Clean up my data and create a report"

// Step 1: Analyze data quality
const quality = await sheets_analyze({ action: 'analyze_quality', ... });

// Step 2: Remove duplicates (if found)
if (quality.dataQuality.issues.some(i => i.type === 'DUPLICATE_ROW')) {
  // Implement deduplication logic
}

// Step 3: Create summary sheet
await sheets_core({ action: 'add_sheet', spreadsheetId: 'xxx', title: 'Summary' });

// Step 4: Add pivot table
await sheets_visualize({ action: 'pivot_create', ... });

// Step 5: Add chart
await sheets_visualize({ action: 'chart_create', ... });
```

### 2. Using Named Ranges

```javascript
// Define named range for frequently used data
await sheets_advanced({
  action: 'add_named_range',
  name: 'SalesData',
  range: { a1: 'Sales!A2:F1000' },
});

// Later, reference it easily
await sheets_data({
  action: 'read',
  range: { namedRange: 'SalesData' },
});
```

### 3. Progress Notifications

For long-running operations, ServalSheets sends progress notifications:

```javascript
// User sees progress as operation runs:
// "Preparing operation... (0/5)"
// "Compiling changes... (1/5)"
// "Generating diff... (2/5)"
// "Validating policies... (3/5)"
// "Executing batch request... (4/5)"
// "Complete! (5/5)"
```

## Remember

1. **Safety first**: Always use dry-run for destructive operations
2. **Ask before acting**: Confirm bulk operations with user
3. **Use semantic ranges**: Let ServalSheets find columns by header
4. **Batch operations**: Combine multiple ranges in one API call
5. **Validate data**: Check quality before processing
6. **Create backups**: Use auto-snapshot or version pinning
7. **Handle errors**: All errors include suggested fixes
8. **Show impact**: Tell user how many cells/rows affected

ServalSheets is production-ready with comprehensive safety rails. Trust the system, but always verify with the user before major changes.
