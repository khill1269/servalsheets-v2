# Dynamic Ranges with DataFilter

Hard-coded ranges (A1:B10) break when rows/columns are inserted or deleted. DataFilter provides resilient alternatives.

## 1. Developer Metadata Lookup (RECOMMENDED for production)

Tag your data ranges first (use `sheets_advanced.set_metadata`), then query by metadata instead of A1 notation. The metadata moves with your data!

### Tag a range:

```json
{
  "tool": "sheets_advanced",
  "action": "set_metadata",
  "spreadsheetId": "1ABC...",
  "metadataKey": "dataset:sales_2024",
  "metadataValue": "Q1 revenue data",
  "location": {
    "sheetId": 0,
    "dimensionRange": {
      "dimension": "ROWS",
      "startIndex": 0,
      "endIndex": 100
    }
  }
}
```

### Read by metadata:

```json
{
  "action": "read",
  "spreadsheetId": "1ABC...",
  "dataFilter": {
    "developerMetadataLookup": {
      "metadataKey": "dataset:sales_2024",
      "locationType": "SHEET"
    }
  }
}
```

### Write by metadata:

```json
{
  "action": "write",
  "spreadsheetId": "1ABC...",
  "dataFilter": {
    "developerMetadataLookup": {
      "metadataKey": "summary:totals"
    }
  },
  "values": [["Total Sales", 1250000]]
}
```

## 2. Grid Range (row/column indices, 0-indexed)

```json
{
  "action": "read",
  "spreadsheetId": "1ABC...",
  "dataFilter": {
    "gridRange": {
      "sheetId": 0,
      "startRowIndex": 0,
      "endRowIndex": 100,
      "startColumnIndex": 0,
      "endColumnIndex": 5
    }
  }
}
```

## 3. A1 Range (fallback for dynamic batch operations)

```json
{
  "action": "batch_read",
  "spreadsheetId": "1ABC...",
  "dataFilters": [{ "a1Range": "Sheet1!A1:D10" }]
}
```

## When to Use DataFilter

**Use when:**

- Production systems with frequent structural changes (rows/columns inserted/deleted)
- Multi-user spreadsheets where data grows dynamically
- Semantic data organization (tag ranges by purpose: "current_month", "totals_row")
- Automated reports that need to find "Q4 sales data" or "summary section"

**Don't use when:**

- Static templates with fixed structure (A1 notation is simpler)
- One-time scripts or ad-hoc queries (overhead not justified)
- You need specific cell references (dataFilter returns matched ranges)

## Prerequisites

DataFilter requires `sheets_advanced.set_metadata` to tag ranges first. Use `sheets_advanced.get_metadata` to list all tagged ranges.
