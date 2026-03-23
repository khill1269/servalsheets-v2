# Slicers and Tables API Reference

## Slicers

Slicers are interactive filter controls displayed as floating UI elements on a sheet. They filter charts and pivot tables that share the same data range.

### Create a Slicer

```json
{
  "addSlicer": {
    "slicer": {
      "spec": {
        "dataRange": {
          "sheetId": 0,
          "startRowIndex": 0,
          "endRowIndex": 100,
          "startColumnIndex": 0,
          "endColumnIndex": 5
        },
        "columnIndex": 2,
        "filterCriteria": {
          "condition": {
            "type": "TEXT_EQ",
            "values": [{ "userEnteredValue": "Active" }]
          }
        },
        "title": "Status Filter",
        "applyToPivotTables": true
      },
      "position": {
        "overlayPosition": {
          "anchorCell": {
            "sheetId": 0,
            "rowIndex": 2,
            "columnIndex": 7
          },
          "widthPixels": 200,
          "heightPixels": 50
        }
      }
    }
  }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `spec.dataRange` | GridRange the slicer filters (must match the chart/pivot dataRange) |
| `spec.columnIndex` | Zero-based column index within dataRange to filter on |
| `spec.filterCriteria` | Filter condition (same structure as column filter criteria) |
| `spec.title` | Display title shown on the slicer widget |
| `spec.applyToPivotTables` | Whether to filter pivot tables (default: true) |
| `position.overlayPosition` | Where to place the slicer on the sheet |

### How Slicers Connect to Charts/Pivots

**Slicers do NOT have an explicit chart list.** They apply to all charts/pivots that:
1. Are on the **same sheet** as the slicer
2. Have a `dataRange` that **overlaps** with the slicer's `spec.dataRange`

To make a slicer control a chart, ensure the chart's source range overlaps the slicer's dataRange. There is no `chartIds` field — the linkage is implicit via range overlap.

### Update a Slicer

```json
{
  "updateSlicer": {
    "slicer": {
      "slicerId": 12345,
      "spec": {
        "filterCriteria": {
          "condition": {
            "type": "TEXT_EQ",
            "values": [{ "userEnteredValue": "Inactive" }]
          }
        }
      }
    },
    "fields": "spec.filterCriteria"
  }
}
```

Always include `fields` mask with `updateSlicer` to avoid clearing other properties.

### Delete a Slicer

Slicers are embedded objects. Use `deleteEmbeddedObject`:

```json
{
  "deleteEmbeddedObject": {
    "objectId": 12345
  }
}
```

The `slicerId` from the slicer spec IS the `objectId` for deletion.

### Filter Condition Types (same as column filters)

```
TEXT_EQ, TEXT_NOT_EQ, TEXT_CONTAINS, TEXT_NOT_CONTAINS
TEXT_STARTS_WITH, TEXT_ENDS_WITH
NUMBER_EQ, NUMBER_NOT_EQ, NUMBER_GREATER, NUMBER_GREATER_THAN_EQ
NUMBER_LESS, NUMBER_LESS_THAN_EQ, NUMBER_BETWEEN, NUMBER_NOT_BETWEEN
DATE_EQ, DATE_BEFORE, DATE_AFTER, DATE_ON_OR_BEFORE, DATE_ON_OR_AFTER
DATE_BETWEEN, DATE_NOT_BETWEEN
BLANK, NOT_BLANK
CUSTOM_FORMULA
ONE_OF_LIST, ONE_OF_RANGE
```

### Get Existing Slicers

From a `spreadsheets.get` response, slicers appear in `sheets[].slicers[]`:

```json
{
  "slicerId": 12345,
  "spec": { ... },
  "position": { ... }
}
```

---

## Tables (Google Sheets Tables API — 2025)

Tables provide structured data with typed columns, auto-filtering headers, and banded styling. Introduced 2025.

### Create a Table

```json
{
  "addTable": {
    "table": {
      "range": {
        "sheetId": 0,
        "startRowIndex": 0,
        "endRowIndex": 50,
        "startColumnIndex": 0,
        "endColumnIndex": 4
      },
      "name": "SalesData",
      "columnProperties": [
        {
          "columnIndex": 0,
          "name": "Date",
          "columnType": "DATE"
        },
        {
          "columnIndex": 1,
          "name": "Product",
          "columnType": "TEXT"
        },
        {
          "columnIndex": 2,
          "name": "Amount",
          "columnType": "CURRENCY"
        },
        {
          "columnIndex": 3,
          "name": "Status",
          "columnType": "DROPDOWN",
          "dataValidationRule": {
            "condition": {
              "type": "ONE_OF_LIST",
              "values": [
                { "userEnteredValue": "Pending" },
                { "userEnteredValue": "Approved" },
                { "userEnteredValue": "Rejected" }
              ]
            },
            "showCustomUi": true,
            "strict": true
          }
        }
      ]
    }
  }
}
```

### Column Type Values

| `columnType` | Description |
|-------------|-------------|
| `TEXT` | Plain text |
| `NUMBER` | Numeric |
| `CURRENCY` | Monetary value |
| `DATE` | Date only |
| `DATETIME` | Date + time |
| `TIME` | Time only |
| `BOOLEAN` | Checkbox |
| `DROPDOWN` | Dropdown (requires `dataValidationRule`) |
| `PERSON` | Person/user chip |
| `SMART_CHIP` | Smart chip (Drive file, etc.) |

### Critical: Field Names

- Use `columnProperties` (NOT `tableColumns` — that field does not exist)
- Each entry requires `columnIndex` (0-based within the table range)
- `name` is the column header displayed

### DROPDOWN Type Requirement

For `columnType: "DROPDOWN"`, you **must** include `dataValidationRule`:

```json
{
  "columnIndex": 3,
  "columnType": "DROPDOWN",
  "dataValidationRule": {
    "condition": {
      "type": "ONE_OF_LIST",
      "values": [
        { "userEnteredValue": "Option A" },
        { "userEnteredValue": "Option B" }
      ]
    },
    "showCustomUi": true,
    "strict": false
  }
}
```

Setting `strict: true` prevents users from entering values outside the list. `showCustomUi: true` shows the dropdown arrow.

### Update a Table

```json
{
  "updateTable": {
    "table": {
      "tableId": "table_abc123",
      "name": "NewTableName",
      "columnProperties": [
        {
          "columnIndex": 2,
          "columnType": "NUMBER"
        }
      ]
    },
    "fields": "name,columnProperties"
  }
}
```

Use field masks to update only specific properties.

### Delete a Table

```json
{
  "deleteTable": {
    "tableId": "table_abc123"
  }
}
```

Deleting a table removes the table structure but **does not delete the cell data**.

### Get Existing Tables

From `spreadsheets.get`, tables appear in `sheets[].tables[]`:

```json
{
  "tableId": "table_abc123",
  "name": "SalesData",
  "range": { ... },
  "columnProperties": [ ... ]
}
```

---

## Comparison: Slicer vs Filter vs Table Filter

| Feature | Slicer | Basic Filter | Table Auto-filter |
|---------|--------|-------------|-------------------|
| UI widget | Floating button | In-cell dropdown | Column header dropdown |
| Filters charts | Yes | No | No |
| Filters pivots | Yes | No | No |
| Shareable state | No (per-view) | Yes (saved) | Yes (saved) |
| API control | Yes (addSlicer) | Yes (setBasicFilter) | Yes (via table) |
| Multiple users | Separate states | Shared | Shared |
