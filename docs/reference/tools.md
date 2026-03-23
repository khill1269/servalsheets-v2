---
title: Tools Overview
category: reference
last_updated: 2026-03-17
description: ServalSheets provides 25 MCP tools with 403 total actions covering the complete Google Sheets API v4.
version: 1.7.0
tags: [sheets]
stability: stable
---

# Tools Overview

ServalSheets provides 25 MCP tools with 403 total actions covering the complete Google Sheets API v4.

## Tool Categories

| Tool                  | Actions | Description                                                                                              |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `sheets_auth`         | 5       | OAuth status/login/callback/logout plus readiness-driven setup                                           |
| `sheets_core`         | 21      | Spreadsheet + sheet metadata and management                                                              |
| `sheets_data`         | 25      | Read/write/append/clear values, notes, links, merges, spill detection                                    |
| `sheets_format`       | 25      | Formatting, borders, number formats, validation, rules                                                   |
| `sheets_dimensions`   | 30      | Rows/columns, filters, sort, filter views, slicers                                                       |
| `sheets_visualize`    | 18      | Charts + pivots (create/update/list)                                                                     |
| `sheets_collaborate`  | 41      | Sharing, comments, revisions, async snapshots, approvals                                                 |
| `sheets_advanced`     | 31      | Named ranges, protections, metadata, banding, chips; named-function actions return `FEATURE_UNAVAILABLE` |
| `sheets_transaction`  | 6       | Begin/queue/commit/rollback/status/list                                                                  |
| `sheets_quality`      | 4       | Validation, conflicts, impact analysis                                                                   |
| `sheets_history`      | 10      | History, undo/redo, revert, time travel                                                                  |
| `sheets_confirm`      | 5       | Elicitation-based confirmations                                                                          |
| `sheets_analyze`      | 22      | AI analysis + planning (comprehensive, scout, plan, diagnostics, etc)                                    |
| `sheets_fix`          | 6       | Auto-fix detected issues                                                                                 |
| `sheets_composite`    | 21      | CSV/XLSX import/export, smart append, dedupe, setup                                                      |
| `sheets_session`      | 31      | Context, preferences, checkpoints, scheduler, pipeline                                                   |
| `sheets_templates`    | 8       | Template management                                                                                      |
| `sheets_bigquery`     | 17      | Connected Sheets + BigQuery query/import/export                                                          |
| `sheets_appsscript`   | 19      | Apps Script project/deploy/run                                                                           |
| `sheets_webhook`      | 10      | Webhook register/test/stats                                                                              |
| `sheets_dependencies` | 10      | Dependency graph + impact analysis                                                                       |
| `sheets_agent`        | 8       | Autonomous multi-step plan/execute/rollback                                                              |
| `sheets_compute`      | 16      | Statistical analysis, SQL queries, Python/DuckDB compute                                                 |
| `sheets_connectors`   | 10      | External data connectors (Finnhub, Polygon, FRED, BigQuery, etc)                                         |
| `sheets_federation`   | 4       | Cross-MCP-server operations                                                                              |

## Common Parameters

All tools share these common parameters:

### Required

| Parameter       | Type   | Description                                |
| --------------- | ------ | ------------------------------------------ |
| `action`        | string | The specific action to perform             |
| `spreadsheetId` | string | Spreadsheet ID (required for most actions) |

### Optional (Safety Rails)

| Parameter       | Type    | Default | Description                       |
| --------------- | ------- | ------- | --------------------------------- |
| `dryRun`        | boolean | `false` | Preview changes without executing |
| `effectScope`   | object  | -       | Limit affected rows/columns       |
| `expectedState` | object  | -       | Validate state before write       |
| `confirm`       | boolean | `false` | Request user confirmation         |

## Response Format

All tools return structured responses:

```typescript
interface ToolResponse {
  success: boolean;
  action: string;
  spreadsheetId: string;
  data?: any;
  metadata?: {
    rowsAffected?: number;
    cellsModified?: number;
    apiCalls?: number;
    duration?: number;
  };
  error?: {
    code: string;
    message: string;
    recovery?: string;
  };
}
```

## Safety Features

### Dry Run Mode

Preview any operation before execution:

```json
{
  "tool": "sheets_data",
  "action": "write",
  "spreadsheetId": "...",
  "range": "A1:B10",
  "values": [["Header", "Value"]],
  "dryRun": true
}
```

Response shows what _would_ happen without making changes.

### Effect Scope Limits

Prevent accidental large operations:

```json
{
  "tool": "sheets_dimensions",
  "action": "delete",
  "spreadsheetId": "...",
  "sheetId": 0,
  "dimension": "ROWS",
  "startIndex": 0,
  "endIndex": 1000,
  "effectScope": {
    "maxRows": 100
  }
}
```

Fails if operation would exceed limits.

### User Confirmations

Request explicit user approval:

```json
{
  "tool": "sheets_data",
  "action": "clear",
  "spreadsheetId": "...",
  "range": "A:Z",
  "confirm": true
}
```

Uses MCP Elicitation to show confirmation dialog.

## Error Handling

Errors include recovery suggestions:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Google API rate limit exceeded",
    "recovery": "Wait 60 seconds and retry. Consider enabling request deduplication."
  }
}
```

Common error codes:

- `INVALID_SPREADSHEET` - Spreadsheet not found or no access
- `INVALID_RANGE` - Range notation error
- `RATE_LIMITED` - API quota exceeded
- `PERMISSION_DENIED` - Insufficient permissions
- `VALIDATION_ERROR` - Schema validation failed

## Next Steps

- [sheets_data](./tools/sheets_data) - Data operations
- [Examples](/examples/) - Usage examples
- [Prompts Guide](/guides/PROMPTS_GUIDE) - Natural language patterns
