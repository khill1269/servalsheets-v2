---
title: ServalSheets API Consistency Reference
category: reference
last_updated: 2026-01-31
description: 'Version: 1.6.0'
version: 1.6.0
tags: [api, sheets]
stability: stable
---

# ServalSheets API Consistency Reference

**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Parameter Naming Conventions](#parameter-naming-conventions)
2. [Verbosity Levels](#verbosity-levels)
3. [Range Notation](#range-notation)
4. [Response Format Standards](#response-format-standards)
5. [Error Codes Reference](#error-codes-reference)
6. [Enum Values](#enum-values)
7. [Color Specifications](#color-specifications)

---

## Parameter Naming Conventions

### Range Parameters

**Single Range:**
Use `range` (singular) when the action operates on **one range**:

```json
{
  "action": "read",
  "spreadsheetId": "...",
  "range": "Sheet1!A1:B10"
}
```

**Tools using `range` (singular):**

- `sheets_data`: read, write, append, clear
- `sheets_format`: Most formatting actions
- `sheets_dimensions`: insert_rows, insert_columns, delete_rows, delete_columns

**Multiple Ranges:**
Use `ranges` (plural) when the action operates on **multiple ranges**:

```json
{
  "action": "batch_read",
  "spreadsheetId": "...",
  "ranges": ["Sheet1!A1:B10", "Sheet2!C5:D20"]
}
```

**Tools using `ranges` (plural):**

- `sheets_data`: batch_read, batch_write, batch_clear

### Sheet Identification

**sheetId vs sheetName:**

- **sheetId** (number): Numeric identifier (e.g., `0`, `123456789`)
  - Found in URL: `#gid=123456789`
  - Stable across renames
  - Required for most actions

- **sheetName** (string): Human-readable name (e.g., `"Sales Data"`)
  - Used in A1 notation: `"Sales Data!A1:B10"`
  - Changes if sheet is renamed
  - Optional in most actions (defaults to first sheet)

**Example - Using sheetId:**

```json
{
  "action": "format_cells",
  "spreadsheetId": "...",
  "sheetId": 0,
  "range": { "a1": "A1:B10" }
}
```

**Example - Using sheetName in A1 notation:**

```json
{
  "action": "read",
  "spreadsheetId": "...",
  "range": "'Sales Data'!A1:B10"
}
```

### spreadsheetId Consistency

**Always use `spreadsheetId` (camelCase):**

```json
{
  "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
}
```

❌ **Never:**

- `spreadsheet_id` (snake_case)
- `id`
- `fileId`

**Extracting from URL:**

```
https://docs.google.com/spreadsheets/d/1A2B3C4D5E6F7G8H9I0J/edit
                                        └──────┬──────┘
                                          spreadsheetId
```

---

## Verbosity Levels

All tools support a `verbosity` parameter to control response detail:

### `minimal` - Essential Info Only

**Use Case**: High-frequency operations, reducing token usage

**Returns:**

- Operation success/failure
- Critical IDs (spreadsheet, sheet, range)
- Essential result data only

**Example Response:**

```json
{
  "success": true,
  "action": "write",
  "updatedCells": 100
}
```

**Token Savings:** ~30-50% vs standard

### `standard` - Balanced (Default)

**Use Case**: Most operations, good balance of detail

**Returns:**

- Everything from `minimal`
- Operation summary
- Affected ranges
- Basic metadata

**Example Response:**

```json
{
  "success": true,
  "action": "write",
  "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
  "updatedRange": "Sheet1!A1:B100",
  "updatedCells": 100,
  "updatedRows": 100,
  "updatedColumns": 2
}
```

**Token Savings:** Baseline (0%)

### `verbose` - Full Details

**Use Case**: Debugging, auditing, detailed logging

**Returns:**

- Everything from `standard`
- Full metadata
- Request details
- Timing information
- Warning messages

**Example Response:**

```json
{
  "success": true,
  "action": "write",
  "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
  "updatedRange": "Sheet1!A1:B100",
  "updatedCells": 100,
  "updatedRows": 100,
  "updatedColumns": 2,
  "_meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-01-30T10:00:00Z",
    "processingTimeMs": 125,
    "apiCallCount": 1,
    "cacheHit": false,
    "warnings": []
  }
}
```

**Token Cost:** +50-100% vs standard

### Choosing Verbosity

| Scenario                      | Recommended | Reason                              |
| ----------------------------- | ----------- | ----------------------------------- |
| Batch operations (100+ calls) | `minimal`   | Reduce token costs significantly    |
| Production automation         | `standard`  | Good balance of info and efficiency |
| Development/testing           | `verbose`   | Full visibility for debugging       |
| Error troubleshooting         | `verbose`   | Need detailed context               |
| User-facing operations        | `standard`  | Adequate feedback without noise     |

---

## Range Notation

### A1 Notation Formats

#### Single Cell

```
"A1"              → Row 1, Column A
"B5"              → Row 5, Column B
"AA100"           → Row 100, Column AA
```

#### Cell Range

```
"A1:B10"          → 10 rows × 2 columns
"C5:F15"          → 11 rows × 4 columns
"A1:Z1000"        → 1000 rows × 26 columns
```

#### Full Rows

```
"1:1"             → Row 1 (all columns)
"5:10"            → Rows 5-10 (all columns)
"100:100"         → Row 100 (all columns)
```

#### Full Columns

```
"A:A"             → Column A (all rows)
"B:D"             → Columns B-D (all rows)
"AA:AZ"           → Columns AA-AZ (all rows)
```

#### With Sheet Name

```
"Sheet1!A1:B10"                → Sheet named "Sheet1"
"'Sales Data'!A1:B10"          → Sheet with spaces (quoted)
"'Q1-2024'!C5:D20"             → Sheet with special chars (quoted)
```

### When to Quote Sheet Names

**Quote Required:**

- Contains spaces: `'Sales Data'!A1`
- Contains special chars: `'Q1-2024'!A1`, `'[Draft]'!A1`
- Starts with number: `'2024'!A1`

**Quote Optional (but safe):**

- Simple names: `Sheet1!A1` or `'Sheet1'!A1`

### Range Input Object

For programmatic range specification:

```json
{
  "range": {
    "a1": "Sheet1!A1:B10"
  }
}
```

**Alternative formats:**

```json
{
  "range": {
    "namedRange": "MyDataRange"
  }
}
```

```json
{
  "range": {
    "grid": {
      "sheetId": 0,
      "startRowIndex": 0,
      "endRowIndex": 10,
      "startColumnIndex": 0,
      "endColumnIndex": 2
    }
  }
}
```

---

## Response Format Standards

### Success Response

All tools return responses with this structure:

```json
{
  "response": {
    "success": true,
    "action": "action_name",
    // Action-specific data fields
    "data": { ... },
    // Optional metadata (verbose mode)
    "_meta": {
      "requestId": "req_abc123",
      "timestamp": "2026-01-30T10:00:00Z",
      "processingTimeMs": 125
    }
  }
}
```

### Error Response

```json
{
  "response": {
    "success": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "Human-readable error message",
      "category": "client | server | auth | quota | network",
      "severity": "low | medium | high | critical",
      "retryable": true,
      "retryStrategy": "exponential_backoff | wait_for_reset | manual | none",
      "resolution": "How to fix this error",
      "resolutionSteps": ["1. First step", "2. Second step"],
      "suggestedTools": ["tool_name"],
      "details": {
        // Error-specific context
      }
    }
  }
}
```

### Common Response Fields

| Field     | Type    | Always Present      | Description                 |
| --------- | ------- | ------------------- | --------------------------- |
| `success` | boolean | ✅                  | Operation success indicator |
| `action`  | string  | ✅                  | Action that was performed   |
| `error`   | object  | ❌ (only if failed) | Error details               |
| `_meta`   | object  | ❌ (verbose only)   | Response metadata           |

---

## Error Codes Reference

### MCP Standard Codes (5)

| Code               | HTTP | Category | Retryable | Description                 |
| ------------------ | ---- | -------- | --------- | --------------------------- |
| `PARSE_ERROR`      | -    | client   | ❌        | Invalid JSON in request     |
| `INVALID_REQUEST`  | 400  | client   | ❌        | Malformed request structure |
| `METHOD_NOT_FOUND` | 404  | client   | ❌        | Unknown tool/action         |
| `INVALID_PARAMS`   | 400  | client   | ❌        | Invalid parameter values    |
| `INTERNAL_ERROR`   | 500  | server   | ✅        | Unexpected server error     |

### Authentication & Authorization (4)

| Code                       | HTTP | Category | Retryable | Description                |
| -------------------------- | ---- | -------- | --------- | -------------------------- |
| `UNAUTHENTICATED`          | 401  | auth     | ❌        | No authentication provided |
| `PERMISSION_DENIED`        | 403  | auth     | ❌        | Insufficient permissions   |
| `INVALID_CREDENTIALS`      | 401  | auth     | ❌        | Invalid access token       |
| `INSUFFICIENT_PERMISSIONS` | 403  | auth     | ❌        | Missing required scopes    |

### Quota & Rate Limiting (3)

| Code                 | HTTP | Category | Retryable | Description                |
| -------------------- | ---- | -------- | --------- | -------------------------- |
| `QUOTA_EXCEEDED`     | 429  | quota    | ✅        | API quota limit reached    |
| `RATE_LIMITED`       | 429  | quota    | ✅        | Too many requests          |
| `RESOURCE_EXHAUSTED` | 429  | quota    | ✅        | Quota temporarily depleted |

**Retry Strategy:** Wait for `retryAfterMs` (from error details), then retry.

### Spreadsheet Errors (8)

| Code                    | HTTP | Category | Retryable | Description                            |
| ----------------------- | ---- | -------- | --------- | -------------------------------------- |
| `SPREADSHEET_NOT_FOUND` | 404  | client   | ❌        | Spreadsheet doesn't exist or no access |
| `SPREADSHEET_TOO_LARGE` | 413  | client   | ❌        | Spreadsheet exceeds size limits        |
| `SHEET_NOT_FOUND`       | 404  | client   | ❌        | Sheet (tab) not found in spreadsheet   |
| `INVALID_SHEET_ID`      | 400  | client   | ❌        | Sheet ID is not a valid number         |
| `DUPLICATE_SHEET_NAME`  | 409  | client   | ❌        | Sheet name already exists              |
| `INVALID_RANGE`         | 400  | client   | ❌        | Invalid A1 notation or range format    |
| `RANGE_NOT_FOUND`       | 404  | client   | ❌        | Range doesn't exist in sheet           |
| `PROTECTED_RANGE`       | 403  | auth     | ❌        | Cannot modify protected range          |

### Data & Formula Errors (4)

| Code                      | HTTP | Category | Retryable | Description                         |
| ------------------------- | ---- | -------- | --------- | ----------------------------------- |
| `FORMULA_ERROR`           | 400  | client   | ❌        | Invalid formula syntax              |
| `CIRCULAR_REFERENCE`      | 400  | client   | ❌        | Formula creates circular dependency |
| `INVALID_DATA_VALIDATION` | 400  | client   | ❌        | Invalid validation rule             |
| `MERGE_CONFLICT`          | 409  | client   | ✅        | Concurrent modification detected    |

### Feature-Specific Errors (7)

| Code                       | HTTP | Category | Retryable | Description                         |
| -------------------------- | ---- | -------- | --------- | ----------------------------------- |
| `CONDITIONAL_FORMAT_ERROR` | 400  | client   | ❌        | Invalid conditional formatting rule |
| `PIVOT_TABLE_ERROR`        | 400  | client   | ❌        | Invalid pivot table configuration   |
| `CHART_ERROR`              | 400  | client   | ❌        | Invalid chart configuration         |
| `FILTER_VIEW_ERROR`        | 400  | client   | ❌        | Invalid filter view                 |
| `NAMED_RANGE_ERROR`        | 400  | client   | ❌        | Named range issue                   |
| `DEVELOPER_METADATA_ERROR` | 400  | client   | ❌        | Metadata operation failed           |
| `DIMENSION_ERROR`          | 400  | client   | ❌        | Invalid row/column operation        |

### Operation Errors (7)

| Code                 | HTTP | Category | Retryable | Description                     |
| -------------------- | ---- | -------- | --------- | ------------------------------- |
| `BATCH_UPDATE_ERROR` | 400  | client   | ❌        | Batch operation failed          |
| `TRANSACTION_ERROR`  | 409  | client   | ✅        | Transaction conflict            |
| `SNAPSHOT_ERROR`     | 500  | server   | ❌        | Snapshot creation failed        |
| `VALIDATION_ERROR`   | 400  | client   | ❌        | Input validation failed         |
| `TIMEOUT`            | 504  | network  | ✅        | Operation timed out             |
| `DEADLINE_EXCEEDED`  | 504  | network  | ✅        | Request took too long           |
| `UNAVAILABLE`        | 503  | server   | ✅        | Service temporarily unavailable |

### Network & Misc (4)

| Code                | HTTP | Category | Retryable | Description                |
| ------------------- | ---- | -------- | --------- | -------------------------- |
| `NETWORK_ERROR`     | -    | network  | ✅        | Network connectivity issue |
| `PAYLOAD_TOO_LARGE` | 413  | client   | ❌        | Request payload too large  |
| `NOT_FOUND`         | 404  | client   | ❌        | Generic resource not found |
| `UNKNOWN`           | -    | unknown  | Maybe     | Unclassified error         |

### Error Categories

| Category  | Description                     | Typical Retry Strategy   |
| --------- | ------------------------------- | ------------------------ |
| `client`  | Client-side error (fix request) | None - fix and retry     |
| `server`  | Server-side error               | Exponential backoff      |
| `auth`    | Authentication/authorization    | Manual (re-authenticate) |
| `quota`   | Rate/quota limits               | Wait for reset time      |
| `network` | Network connectivity            | Exponential backoff      |
| `unknown` | Unclassified                    | Depends on context       |

---

## Enum Values

### Case Handling

**Case-Insensitive Enums:**
These enums accept any case and normalize to uppercase:

- `ValueRenderOption`: `formatted_value`, `FORMATTED_VALUE` → `FORMATTED_VALUE`
- `ValueInputOption`: `raw`, `RAW` → `RAW`
- `MajorDimension`: `rows`, `ROWS` → `ROWS`
- `Dimension`: `columns`, `COLUMNS` → `COLUMNS`
- `ChartType`: `line`, `LINE` → `LINE`
- `LegendPosition`: `bottom_legend`, `BOTTOM_LEGEND` → `BOTTOM_LEGEND`
- `SortOrder`: `ascending`, `ASCENDING` → `ASCENDING`

**Case-Sensitive Enums:**
These require exact case match:

- `HorizontalAlign`: `LEFT`, `CENTER`, `RIGHT` (uppercase only)
- `VerticalAlign`: `TOP`, `MIDDLE`, `BOTTOM` (uppercase only)
- `WrapStrategy`: `WRAP`, `CLIP`, `OVERFLOW_CELL` (uppercase only)

### ValueRenderOption

How to render cell values in responses:

| Value                       | Description    | Example                       |
| --------------------------- | -------------- | ----------------------------- |
| `FORMATTED_VALUE` (default) | Display format | `"$1,234.56"`, `"2024-01-30"` |
| `UNFORMATTED_VALUE`         | Raw value      | `1234.56`, `45321`            |
| `FORMULA`                   | Show formula   | `"=SUM(A1:A10)"`              |

### ValueInputOption

How to interpret input values:

| Value                    | Description   | Example                                           |
| ------------------------ | ------------- | ------------------------------------------------- |
| `USER_ENTERED` (default) | Parse like UI | `"=SUM(A1:A10)"` → formula, `"2024-01-30"` → date |
| `RAW`                    | Store as-is   | `"=SUM(A1:A10)"` → literal text                   |

### InsertDataOption

How to handle existing data when appending:

| Value                   | Description                      |
| ----------------------- | -------------------------------- |
| `INSERT_ROWS` (default) | Add new rows after last data row |
| `OVERWRITE`             | Replace existing data in range   |

### MajorDimension

Data array orientation:

| Value            | Description              | Example                        |
| ---------------- | ------------------------ | ------------------------------ |
| `ROWS` (default) | `data[0]` = first row    | `[["A1", "B1"], ["A2", "B2"]]` |
| `COLUMNS`        | `data[0]` = first column | `[["A1", "A2"], ["B1", "B2"]]` |

---

## Color Specifications

### RGB Object (0-1 Scale)

**Google Sheets API format:**

```json
{
  "red": 1.0,
  "green": 0.0,
  "blue": 0.0,
  "alpha": 1.0
}
```

**Conversion from 0-255:**

```javascript
apiColor = {
  red: rgbValue.red / 255,
  green: rgbValue.green / 255,
  blue: rgbValue.blue / 255,
};
```

### Hex String

**Accepted formats:**

```json
"#FF0000"    → Red
"FF0000"     → Red (# optional)
"#4285F4"    → Google Blue
```

**Automatic conversion to RGB (0-1 scale):**

```
#FF0000 → { red: 1.0, green: 0.0, blue: 0.0, alpha: 1.0 }
```

### Named Colors

**Supported color names:**

**Basic Colors:**

- `red`, `green`, `blue`
- `white`, `black`
- `yellow`, `orange`, `purple`, `pink`
- `gray` / `grey`

**Google Brand Colors:**

- `google-blue` → `#4285F4`
- `google-red` → `#EA4335`
- `google-green` → `#34A853`
- `google-yellow` → `#FBBC04`

**Example:**

```json
{
  "backgroundColor": "google-blue"
}
```

**Converted to:**

```json
{
  "backgroundColor": {
    "red": 0.26,
    "green": 0.52,
    "blue": 0.96,
    "alpha": 1.0
  }
}
```

---

## Best Practices

### Parameter Consistency

1. **Use consistent naming across all calls**
   - Always `spreadsheetId`, never `id` or `spreadsheet_id`
   - Always `sheetId` for numeric IDs, `sheetName` for names

2. **Choose appropriate verbosity**
   - Batch operations: `minimal`
   - Normal operations: `standard`
   - Debugging: `verbose`

3. **Use proper range notation**
   - Quote sheet names with spaces: `'Sales Data'!A1`
   - Use full notation for clarity: `Sheet1!A1:B10`

### Error Handling

1. **Check `success` field first**

```javascript
if (result.response.success) {
  // Process data
} else {
  // Handle error
  console.error(result.response.error.message);
}
```

1. **Use error categories for logic**

```javascript
if (error.category === 'quota') {
  // Wait and retry
  await sleep(error.retryAfterMs);
  return retry();
} else if (error.category === 'auth') {
  // Re-authenticate
  return authenticate();
}
```

1. **Follow resolution steps**

```javascript
if (!result.response.success) {
  const steps = result.response.error.resolutionSteps;
  console.log('To fix this error:');
  steps.forEach((step) => console.log(step));
}
```

### Response Processing

1. **Always check response structure**
   - Don't assume fields exist
   - Use optional chaining: `result.response?.data?.value`

2. **Handle metadata appropriately**
   - `_meta` only present in verbose mode
   - Don't rely on `_meta` for business logic

3. **Validate before using**
   - Check `success === true` before accessing data
   - Verify expected fields are present

---

## Additional Resources

- [Error Handling Guide](../guides/ERROR_HANDLING.md)
- [Error Recovery Guide](../guides/ERROR_RECOVERY.md)
- [Usage Guide](../guides/USAGE_GUIDE.md)
- [Action Reference](../guides/ACTION_REFERENCE.md)

---

**Last Updated**: 2026-01-30 (v1.6.0)
