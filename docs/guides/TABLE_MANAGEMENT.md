---
title: Table Management Guide
category: guide
last_updated: 2026-01-31
description: 'Tool: sheetsadvanced (table actions)'
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Table Management Guide

**Tool**: `sheets_advanced` (table actions)
**API**: Google Sheets Tables API
**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Table Basics](#table-basics)
3. [Actions](#actions)
4. [Examples](#examples)
5. [Column Management](#column-management)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Overview

**Tables** are structured data ranges in Google Sheets with enhanced features like:

- Automatic header rows with filter buttons
- Column type enforcement (TEXT, NUMBER, DATE, etc.)
- Data validation rules (dropdowns, ranges)
- Footer rows for totals/summaries
- Smart appending that respects table structure

### What Are Tables?

Tables convert regular cell ranges into structured datasets with:

- **Column headers** - Automatically formatted with filters
- **Column properties** - Data types, validation, formatting
- **Row properties** - Header row, footer rows
- **Table ID** - Unique identifier for programmatic access

### Supported Operations

| Operation                       | Description                 | Breaking |
| ------------------------------- | --------------------------- | -------- |
| **create_table**                | Create new table from range | No       |
| **delete_table**                | Remove table (keeps data)   | Yes      |
| **list_tables**                 | Find all tables             | No       |
| **update_table**                | Change table range          | No       |
| **rename_table_column**         | Rename column header        | No       |
| **set_table_column_properties** | Set column type/validation  | No       |

---

## Table Basics

### Creating a Table

**Minimum Requirements:**

- Range with at least 2 rows (header + data)
- Unique column names in header row
- Contiguous cell range (no gaps)

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "create_table",
    "spreadsheetId": "1a2b3c4d5e6f",
    "range": "Sales!A1:E100",
    "hasHeaders": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "create_table",
  "table": {
    "tableId": "TABLE_abc123",
    "range": {
      "sheetId": 0,
      "startRowIndex": 0,
      "endRowIndex": 100,
      "startColumnIndex": 0,
      "endColumnIndex": 5
    },
    "hasHeaders": true
  }
}
```

### Table Structure

**Header Row** (first row):

- Contains column names
- Auto-formatted with filter buttons
- Required for table creation

**Data Rows** (middle rows):

- Respect column types
- Validated against column rules
- Can be appended with `sheets_data append`

**Footer Row** (optional):

- Contains totals or summaries
- Not included in data operations
- Preserved during appends

---

## Actions

### `create_table` - Create Table

**Convert a range into a structured table.**

**Parameters:**

| Name           | Type       | Required | Description                                                   |
| -------------- | ---------- | -------- | ------------------------------------------------------------- |
| action         | literal    | ✅       | `"create_table"`                                              |
| spreadsheetId  | string     | ✅       | Spreadsheet ID                                                |
| range          | RangeInput | ✅       | Range to convert (e.g., "Sheet1!A1:C10")                      |
| tableName      | string     | ❌       | Optional table name for easier identification (max 100 chars) |
| hasHeaders     | boolean    | ❌       | First row is header (default: true)                           |
| headerRowCount | number     | ❌       | Number of header rows (1-10, default: 1)                      |

**Example - Create Sales Table:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "create_table",
    "spreadsheetId": "1a2b3c4d5e6f",
    "range": "Sales!A1:E100",
    "hasHeaders": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "table": {
    "tableId": "TABLE_xyz789",
    "range": { ... },
    "hasHeaders": true
  }
}
```

**Example - Create Named Table with Multiple Header Rows:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "create_table",
    "spreadsheetId": "1a2b3c4d5e6f",
    "range": "Dashboard!A1:F50",
    "tableName": "Monthly Sales Report",
    "hasHeaders": true,
    "headerRowCount": 2
  }
}
```

**Response:**

```json
{
  "success": true,
  "table": {
    "tableId": "TABLE_abc123",
    "tableName": "Monthly Sales Report",
    "range": {
      "sheetId": 0,
      "startRowIndex": 0,
      "endRowIndex": 50,
      "startColumnIndex": 0,
      "endColumnIndex": 6
    },
    "hasHeaders": true,
    "headerRowCount": 2
  }
}
```

**Benefits of Named Tables:**

- **Easier identification** - Find tables by name instead of just range
- **Better organization** - Group related tables by naming convention
- **Improved readability** - `"Monthly Sales Report"` vs `TABLE_abc123`
- **Client-side tracking** - Store meaningful names for reference

**Note:** Table names are stored for client-side reference. The Google Sheets API assigns unique `tableId` values for programmatic access.

---

### `list_tables` - List All Tables

**Find all tables in a spreadsheet.**

**Parameters:**

| Name          | Type    | Required | Description     |
| ------------- | ------- | -------- | --------------- |
| action        | literal | ✅       | `"list_tables"` |
| spreadsheetId | string  | ✅       | Spreadsheet ID  |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "list_tables",
    "spreadsheetId": "1a2b3c4d5e6f"
  }
}
```

**Response:**

```json
{
  "success": true,
  "tables": [
    {
      "tableId": "TABLE_abc",
      "range": { "sheetId": 0, "startRowIndex": 0, "endRowIndex": 100, ... }
    },
    {
      "tableId": "TABLE_def",
      "range": { "sheetId": 1, "startRowIndex": 0, "endRowIndex": 50, ... }
    }
  ]
}
```

---

### `update_table` - Update Table Range

**Expand or shrink table range.**

**Parameters:**

| Name          | Type       | Required | Description                    |
| ------------- | ---------- | -------- | ------------------------------ |
| action        | literal    | ✅       | `"update_table"`               |
| spreadsheetId | string     | ✅       | Spreadsheet ID                 |
| tableId       | string     | ✅       | Table ID (from create or list) |
| range         | RangeInput | ❌       | New range for table            |

**Example - Expand Table:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "update_table",
    "spreadsheetId": "1a2b3c4d5e6f",
    "tableId": "TABLE_abc123",
    "range": "Sales!A1:E200"
  }
}
```

**Use Cases:**

- Expand table to include more rows
- Shrink table to exclude outliers
- Add columns to existing table

---

### `rename_table_column` - Rename Column

**Change column header name.**

**Parameters:**

| Name          | Type    | Required | Description             |
| ------------- | ------- | -------- | ----------------------- |
| action        | literal | ✅       | `"rename_table_column"` |
| spreadsheetId | string  | ✅       | Spreadsheet ID          |
| tableId       | string  | ✅       | Table ID                |
| columnIndex   | number  | ✅       | Column index (0-based)  |
| newName       | string  | ✅       | New column name         |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "rename_table_column",
    "spreadsheetId": "1a2b3c4d5e6f",
    "tableId": "TABLE_abc123",
    "columnIndex": 0,
    "newName": "Product ID"
  }
}
```

**Use Cases:**

- Fix typos in headers
- Update naming conventions
- Clarify column purposes

---

### `set_table_column_properties` - Set Column Type

**Configure column data type.**

**Parameters:**

| Name          | Type    | Required | Description                                     |
| ------------- | ------- | -------- | ----------------------------------------------- |
| action        | literal | ✅       | `"set_table_column_properties"`                 |
| spreadsheetId | string  | ✅       | Spreadsheet ID                                  |
| tableId       | string  | ✅       | Table ID                                        |
| columnIndex   | number  | ✅       | Column index (0-based)                          |
| columnType    | enum    | ❌       | TEXT, NUMBER, DATE, BOOLEAN, CURRENCY, DROPDOWN |

**Example - Set Column to Number:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "set_table_column_properties",
    "spreadsheetId": "1a2b3c4d5e6f",
    "tableId": "TABLE_abc123",
    "columnIndex": 2,
    "columnType": "NUMBER"
  }
}
```

**Column Types:**

| Type     | Description      | Validation                  |
| -------- | ---------------- | --------------------------- |
| TEXT     | Plain text       | None                        |
| NUMBER   | Numeric values   | Rejects non-numbers         |
| DATE     | Date values      | Validates date format       |
| BOOLEAN  | TRUE/FALSE       | Checkbox rendering          |
| CURRENCY | Monetary values  | Number with currency symbol |
| DROPDOWN | Select from list | Requires dataValidationRule |

---

### `delete_table` - Delete Table

**Remove table structure (keeps cell data).**

**Parameters:**

| Name          | Type    | Required | Description      |
| ------------- | ------- | -------- | ---------------- |
| action        | literal | ✅       | `"delete_table"` |
| spreadsheetId | string  | ✅       | Spreadsheet ID   |
| tableId       | string  | ✅       | Table ID         |

**Example:**

```json
{
  "tool": "sheets_advanced",
  "request": {
    "action": "delete_table",
    "spreadsheetId": "1a2b3c4d5e6f",
    "tableId": "TABLE_abc123"
  }
}
```

**Important:** Deleting a table:

- ✅ Removes table structure and column properties
- ✅ Removes filter buttons
- ❌ Does NOT delete cell data (data remains)

---

## Examples

### Example 1: Create Product Catalog Table

**Goal:** Build a structured product table with typed columns.

```bash
# 1. Create initial data
sheets_data update
  spreadsheetId: "1a2b3c"
  range: "Products!A1:D1"
  values: [["Product ID", "Name", "Price", "In Stock"]]

sheets_data update
  spreadsheetId: "1a2b3c"
  range: "Products!A2:D3"
  values: [
    ["P001", "Widget", "19.99", "TRUE"],
    ["P002", "Gadget", "29.99", "FALSE"]
  ]

# 2. Create table
sheets_advanced create_table
  spreadsheetId: "1a2b3c"
  range: "Products!A1:D100"
  hasHeaders: true
# → Returns tableId: "TABLE_products"

# 3. Set column types
sheets_advanced set_table_column_properties
  spreadsheetId: "1a2b3c"
  tableId: "TABLE_products"
  columnIndex: 2
  columnType: "CURRENCY"

sheets_advanced set_table_column_properties
  spreadsheetId: "1a2b3c"
  tableId: "TABLE_products"
  columnIndex: 3
  columnType: "BOOLEAN"
```

**Result:** Structured product catalog with currency formatting and checkboxes.

---

### Example 2: Expand Table as Data Grows

**Goal:** Dynamically resize table to accommodate new data.

```bash
# 1. List tables to get current range
sheets_advanced list_tables
  spreadsheetId: "1a2b3c"
# → TABLE_products range: A1:D100

# 2. Expand table to 200 rows
sheets_advanced update_table
  spreadsheetId: "1a2b3c"
  tableId: "TABLE_products"
  range: "Products!A1:D200"
```

**Result:** Table now includes rows 1-200 instead of 1-100.

---

### Example 3: Rename Columns for Clarity

**Goal:** Update column headers to match new naming conventions.

```bash
# Rename "Price" to "Unit Price"
sheets_advanced rename_table_column
  spreadsheetId: "1a2b3c"
  tableId: "TABLE_products"
  columnIndex: 2
  newName: "Unit Price"

# Rename "In Stock" to "Available"
sheets_advanced rename_table_column
  spreadsheetId: "1a2b3c"
  tableId: "TABLE_products"
  columnIndex: 3
  newName: "Available"
```

**Result:** Updated column headers without recreating table.

---

## Column Management

### Column Types

**TEXT** - Default type for all columns:

```json
{ "columnType": "TEXT" }
```

- No validation
- Displays as plain text
- Accepts any input

**NUMBER** - Numeric values only:

```json
{ "columnType": "NUMBER" }
```

- Validates numeric input
- Right-aligned in cells
- Supports arithmetic operations

**DATE** - Date values:

```json
{ "columnType": "DATE" }
```

- Validates date format
- Supports date arithmetic
- Displays with locale formatting

**BOOLEAN** - TRUE/FALSE values:

```json
{ "columnType": "BOOLEAN" }
```

- Renders as checkbox
- Accepts TRUE/FALSE or 1/0
- Useful for flags and toggles

**CURRENCY** - Monetary values:

```json
{ "columnType": "CURRENCY" }
```

- Number with currency symbol
- Decimal precision (typically 2)
- Locale-specific formatting

**DROPDOWN** - Select from list:

```json
{ "columnType": "DROPDOWN" }
```

- Requires `dataValidationRule`
- Shows dropdown in cells
- Restricts to allowed values

### Column Index

**Important:** Column indices are **0-based** and **relative to the table**:

```
Table Range: C1:F10
Column Index 0 = Column C (first table column)
Column Index 1 = Column D (second table column)
Column Index 2 = Column E (third table column)
Column Index 3 = Column F (fourth table column)
```

**Not the same as sheet column index!**

---

## Best Practices

### 1. Create Tables for Structured Data

**Good:**

```json
{ "action": "create_table", "range": "Sales!A1:E1000", "hasHeaders": true }
```

**Why:** Tables provide:

- Automatic filtering
- Column type enforcement
- Smart appending
- Professional appearance

### 2. Always Include Headers

**Good:**

```json
{ "hasHeaders": true }
```

**Why:** Headers enable:

- Filter buttons
- Column name references
- Better readability
- Proper sorting

### 3. Set Column Types Early

**Good:**

```bash
# Create table
create_table → TABLE_id

# Immediately set column types
set_table_column_properties columnIndex=2 columnType=NUMBER
set_table_column_properties columnIndex=3 columnType=DATE
```

**Why:** Column types:

- Prevent data entry errors
- Enable proper sorting
- Support calculations
- Improve data quality

### 4. Use Descriptive Column Names

**Good:**

```json
{ "action": "rename_table_column", "newName": "Customer Email Address" }
```

**Bad:**

```json
{ "newName": "Col3" } // Unclear what this column contains
```

### 5. Expand Tables Before Appending Large Datasets

**Good:**

```bash
# 1. Expand table to accommodate new data
update_table range=A1:E5000

# 2. Append large dataset
sheets_data append tableId=TABLE_id values=[...]
```

**Why:** Prevents automatic range expansion issues and ensures footer rows stay at bottom.

---

## Appending to Tables

### Using tableId with append

**Standard append:**

```json
{
  "tool": "sheets_data",
  "request": {
    "action": "append",
    "spreadsheetId": "1a2b3c",
    "range": "Sales!A:E",
    "values": [["New", "Row", "Data", "Here", "123"]]
  }
}
```

**Table-aware append:**

```json
{
  "tool": "sheets_data",
  "request": {
    "action": "append",
    "spreadsheetId": "1a2b3c",
    "tableId": "TABLE_abc123",
    "values": [["New", "Row", "Data", "Here", "123"]]
  }
}
```

**Difference:**

- Regular append: Adds rows at end of range
- Table append: Respects footer rows, inserts before footer
- Uses `appendCells` API instead of `values.append`

**Implementation:** [src/handlers/data.ts:880-984](../../src/handlers/data.ts#L880-L984)

---

## Troubleshooting

### "NOT_FOUND" Error

**Cause:** Table ID doesn't exist or was deleted.

**Solution:**

```bash
# List all tables to find correct ID
sheets_advanced list_tables
  spreadsheetId: "1a2b3c"
```

### "INVALID_PARAMS" - Column Index Out of Range

**Cause:** Column index exceeds number of columns in table.

**Solution:**

```bash
# Get table info first
sheets_advanced list_tables
  spreadsheetId: "1a2b3c"
# → Check table range to count columns

# Use valid column index (0-based)
sheets_advanced rename_table_column
  tableId: "TABLE_id"
  columnIndex: 2  # Third column (0-indexed)
```

### Table Range Not Updating

**Cause:** Invalid range or overlapping with another table.

**Solution:**

- Ensure new range is contiguous
- Check for overlapping tables on same sheet
- Verify range syntax (e.g., "Sheet!A1:E200")

### Column Type Not Enforced

**Cause:** Setting column type doesn't retroactively validate existing data.

**Solution:**

- Set column types BEFORE adding data
- Or manually clean existing data after setting type
- Use data validation for strict enforcement

### Footer Row Overwritten During Append

**Cause:** Using regular `sheets_data append` without `tableId`.

**Solution:**

```json
{
  "action": "append",
  "tableId": "TABLE_abc123",  // Include tableId
  "values": [[...]]
}
```

**Why:** Table-aware append uses `appendCells` which respects footer rows.

---

## Production Deployment

### Environment Configuration

```bash
# Enable table appends (if feature-flagged)
ENABLE_TABLE_APPENDS=true
```

### Performance Considerations

**Table Creation:**

- ~200-500ms for small tables (<100 rows)
- ~1-2s for large tables (1000+ rows)
- Batching system reduces API calls by 20-40%

**Column Operations:**

- Each operation requires fetching full table metadata
- Consider caching table metadata for repeated operations
- Use batch updates for multiple column changes

### Limitations

**Google Sheets API Limits:**

- Max table size: 10 million cells (same as spreadsheet limit)
- Max columns: 18,278 (ZZZ in A1 notation)
- Column names must be unique within table
- Cannot have overlapping tables on same sheet

---

## API Reference

### Table Schema

```typescript
{
  tableId: string;                          // Unique identifier
  name?: string;                            // Optional table name
  range: GridRange;                         // Table cell range
  columnProperties?: TableColumnProperties[]; // Column definitions
  rowsProperties?: TableRowsProperties;     // Header/footer config
}
```

### TableColumnProperties Schema

```typescript
{
  columnIndex: number;                      // 0-based column index (relative to table)
  columnName: string;                       // Column header text
  columnType?: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'CURRENCY' | 'DROPDOWN';
  dataValidationRule?: TableColumnDataValidationRule;  // For DROPDOWN type
}
```

### updateTable Request

```typescript
{
  updateTable: {
    table: {
      tableId: string;                      // Required: table to update
      range?: GridRange;                    // Optional: new range
      columnProperties?: TableColumnProperties[]; // Optional: update columns
    },
    fields: string;                         // Field mask (e.g., "range", "columnProperties")
  }
}
```

---

## References

- [Google Sheets Tables API](https://developers.google.com/workspace/sheets/api/guides/tables)
- [Managing Tables with Apps Script](https://medium.com/google-cloud/managing-tables-on-google-sheets-using-google-apps-script-02138f132781)
- [ServalSheets Advanced Handler](../../src/handlers/advanced.ts)
- [sheets_advanced Action Reference](./ACTION_REFERENCE.md#sheets_advanced)
