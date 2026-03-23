# BigQuery Connected Sheets Integration

## Overview

BigQuery Connected Sheets allows analyzing BigQuery datasets directly in Google Sheets without writing SQL for every operation. For programmatic access, the ServalSheets `sheets_bigquery` tool wraps the Google Sheets API's BigQuery integration and the BigQuery REST API.

---

## Two Integration Modes

### Mode 1: Connected Sheets (Interactive)
- User connects a BigQuery table to a Sheet via Data → Data Connectors
- Creates a special "Connected Sheet" with a locked data source
- Supports pivot tables, charts, and extracts over BigQuery data
- Cannot be fully automated via API — requires UI setup

### Mode 2: API-Driven (sheets_bigquery tool)
- `export_to_bigquery`: Write Sheet range → BigQuery table
- `query`: Run BigQuery SQL → return results to Sheet
- `import_from_bigquery`: BigQuery query → Sheet range
- Fully automatable, no UI required

---

## Export Sheet Data to BigQuery

### When to Use
- Sheet has > 50,000 rows that exceed Sheets processing limits
- Need permanent archival of Sheet snapshots
- Joining Sheet data with existing BigQuery datasets

### API Pattern

```typescript
// sheets_bigquery export_to_bigquery
{
  action: "export_to_bigquery",
  spreadsheetId: "1ABC...",
  range: "Sheet1!A1:F1000",
  projectId: "my-gcp-project",
  datasetId: "sheets_exports",
  tableId: "my_export",
  createDisposition: "CREATE_IF_NEEDED",  // or CREATE_NEVER
  writeDisposition: "WRITE_TRUNCATE",     // or WRITE_APPEND, WRITE_EMPTY
  schema: {
    fields: [
      { name: "date", type: "DATE" },
      { name: "product", type: "STRING" },
      { name: "amount", type: "NUMERIC" }
    ]
  }
}
```

### Schema Auto-Detection
If `schema` is omitted, BigQuery infers types. Auto-detection is less reliable for:
- Date columns stored as strings (e.g., "2024-01-15")
- Numbers stored with currency symbols ("$1,234.00")
- Mixed-type columns

**Best practice**: Always specify schema explicitly for production exports.

### Write Dispositions
| `writeDisposition` | Behavior |
|-------------------|----------|
| `WRITE_TRUNCATE` | Replace existing table data |
| `WRITE_APPEND` | Add rows to existing table |
| `WRITE_EMPTY` | Fail if table has data |

---

## Query BigQuery, Import to Sheet

### Pattern: Aggregated Report
```typescript
{
  action: "query",
  projectId: "my-gcp-project",
  query: `
    SELECT
      DATE_TRUNC(order_date, MONTH) as month,
      product_category,
      SUM(revenue) as total_revenue,
      COUNT(*) as order_count
    FROM \`my-project.sales.orders\`
    WHERE order_date >= '2024-01-01'
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  `,
  targetSpreadsheetId: "1ABC...",
  targetRange: "Report!A1",
  writeHeaders: true
}
```

### Pattern: Lookup Enrichment
```typescript
{
  action: "query",
  projectId: "my-gcp-project",
  query: `
    SELECT customer_id, customer_name, tier, lifetime_value
    FROM \`my-project.crm.customers\`
    WHERE customer_id IN (${customerIds.join(',')})
  `,
  targetSpreadsheetId: "1ABC...",
  targetRange: "Enrichment!A1"
}
```

---

## Performance Guidelines

| Dataset Size | Recommended Approach |
|-------------|---------------------|
| < 50K rows | Use Sheets functions (QUERY, FILTER, etc.) |
| 50K–500K rows | BigQuery query → aggregated result to Sheet |
| > 500K rows | Keep in BigQuery, export summary tables only |
| All sizes, recurring reports | Schedule via Apps Script trigger |

---

## Cost Considerations

BigQuery charges per query (bytes scanned). Strategies to minimize cost:

1. **Partition pruning**: Always include partition filter in WHERE clause
   ```sql
   WHERE DATE(_PARTITIONTIME) >= '2024-01-01'
   ```

2. **Column selection**: Use `SELECT col1, col2` not `SELECT *`

3. **Preview with LIMIT**: Test queries with `LIMIT 100` first

4. **Use BQ table clustering**: For repeated filtered queries on same columns

5. **Cache results**: Write BigQuery results to a Sheet; refresh only when needed (not on every open)

---

## Authentication Requirements

The servalsheets BigQuery tool requires OAuth scopes:
- `https://www.googleapis.com/auth/bigquery` (query/export)
- `https://www.googleapis.com/auth/bigquery.insertdata` (streaming inserts)
- `https://www.googleapis.com/auth/spreadsheets` (write results back)

Service accounts require BigQuery Job User + BigQuery Data Viewer/Editor roles.

---

## BigQuery → Sheets Data Types Mapping

| BigQuery Type | Sheets Type | Notes |
|--------------|------------|-------|
| STRING | Text | |
| INTEGER, INT64 | Number | |
| FLOAT, FLOAT64, NUMERIC | Number | Precision may vary |
| BOOLEAN | Boolean | TRUE/FALSE |
| DATE | Date | Formatted as MM/DD/YYYY by default |
| DATETIME | DateTime | |
| TIMESTAMP | DateTime | Converted to local timezone |
| TIME | Time | |
| ARRAY | Text (JSON) | Arrays flattened to JSON string |
| STRUCT, RECORD | Text (JSON) | Nested objects as JSON |
| BYTES | Text (base64) | |
| GEOGRAPHY | Text (WKT) | |

---

## Common Patterns

### Pattern: Daily Report Refresh
```typescript
// In Apps Script (triggered daily):
async function refreshReport() {
  const bq = BigQuery.Jobs.query({
    query: `SELECT * FROM \`project.dataset.daily_summary\` WHERE date = CURRENT_DATE()`,
    useLegacySql: false
  }, projectId);

  // Write to sheet
  SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName('Daily')
    .clearContents()
    .getRange(1, 1, results.length, results[0].length)
    .setValues(results);
}
```

### Pattern: Sheet as BigQuery Source
Export sheet data → BQ → join with production tables → import summary:

```
Sheet (raw input)
  → sheets_bigquery.export_to_bigquery (Sheet → BQ table)
  → sheets_bigquery.query (JOIN with production BQ tables)
  → sheets_bigquery.import_from_bigquery (summary → Sheet)
```

### Pattern: Schema Validation Before Export
```typescript
// Validate schema matches before export to avoid BQ schema mismatch errors
const analysis = await sheets_analyze.scout({ spreadsheetId, range });
const columns = analysis.columns;
// Check types match expected BQ schema
```

---

## Limits

| Limit | Value |
|-------|-------|
| Max cells in Sheet → BQ export | 10M (Sheets cell limit) |
| Max rows per BQ → Sheet import | 500K (practical; more causes timeout) |
| BigQuery query timeout | 600 seconds |
| Concurrent exports per project | 100 |
| Free tier queries | 1TB/month scanned |
