---
title: BigQuery and Looker Integration Guide
category: guide
last_updated: 2026-01-31
description: 'Tool: sheetsbigquery'
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# BigQuery and Looker Integration Guide

**Tool**: `sheets_bigquery`
**Purpose**: Connect Google Sheets with BigQuery and Looker data sources
**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication & Permissions](#authentication--permissions)
3. [Actions](#actions)
4. [Common Workflows](#common-workflows)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The `sheets_bigquery` tool enables bidirectional data flow between Google Sheets and BigQuery, plus Looker integration via Connected Sheets.

### What is Connected Sheets?

**Connected Sheets** is Google's native integration that allows Sheets to display live data from BigQuery and Looker. Data refreshes on-demand and supports analysis with Sheets formulas, pivot tables, and charts.

### Key Capabilities

- **BigQuery Connection**: Query BigQuery tables directly from Sheets
- **Looker Integration**: Connect LookML explores to pivot tables
- **Schema Discovery**: Browse datasets, tables, and column schemas
- **Data Transfer**: Export Sheets data to BigQuery tables
- **Query Preview**: Test queries before full execution
- **Refresh Control**: Manual or automatic data refresh

### Tool Annotations

| Property        | Value | Meaning                                           |
| --------------- | ----- | ------------------------------------------------- |
| readOnlyHint    | false | Creates/modifies data connections                 |
| destructiveHint | true  | Can disconnect sources, overwrite BigQuery tables |
| idempotentHint  | false | Queries consume BigQuery quota                    |
| openWorldHint   | true  | Calls BigQuery and Sheets APIs                    |

---

## Authentication & Permissions

### Required APIs

1. **Google Sheets API** - For Connected Sheets management
2. **BigQuery API** - For queries and schema discovery
3. **Looker API** - For Looker connections (optional)

### Required Permissions

**BigQuery Permissions:**

- `bigquery.datasets.get` - List and view datasets
- `bigquery.tables.get` - View table schemas
- `bigquery.tables.getData` - Query tables
- `bigquery.tables.create` - Export to new tables
- `bigquery.tables.update` - Export to existing tables
- `bigquery.jobs.create` - Execute queries

**Sheets Permissions:**

- `https://www.googleapis.com/auth/spreadsheets` - Create data sources

**Looker Permissions** (if using Looker):

- Access to Looker instance
- Read permissions on target models/explores

### GCP Project Configuration

1. **Enable APIs:**

   ```bash
   gcloud services enable bigquery.googleapis.com
   gcloud services enable sheets.googleapis.com
   ```

2. **Set up billing:**
   - BigQuery queries are billed to the project
   - Connected Sheets queries use project quota

3. **Grant access:**
   - Service account: Add BigQuery permissions
   - OAuth user: Must have project access

---

## Actions

### Connection Management (5 actions)

#### `connect` - Create BigQuery Connection

**Connect a BigQuery table or query to a Google Sheet.**

**Parameters:**

| Name           | Type    | Required | Description                                             |
| -------------- | ------- | -------- | ------------------------------------------------------- |
| action         | literal | ✅       | `"connect"`                                             |
| spreadsheetId  | string  | ✅       | Target spreadsheet ID                                   |
| spec           | object  | ✅       | Data source specification                               |
| spec.projectId | string  | ✅       | GCP project ID                                          |
| spec.datasetId | string  | ❌       | Dataset ID (for table connections)                      |
| spec.tableId   | string  | ❌       | Table ID (for table connections)                        |
| spec.query     | string  | ❌       | Custom SQL query (alternative to table)                 |
| sheetId        | number  | ❌       | Target sheet ID (creates new if omitted)                |
| sheetName      | string  | ❌       | Name for new sheet                                      |
| verbosity      | enum    | ❌       | `minimal`, `standard`, `detailed` (default: `standard`) |

**Example - Connect to Table:**

```json
{
  "request": {
    "action": "connect",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "spec": {
      "projectId": "my-gcp-project",
      "datasetId": "sales_data",
      "tableId": "transactions_2024"
    },
    "sheetName": "Sales Data",
    "verbosity": "standard"
  }
}
```

**Example - Connect with Custom Query:**

```json
{
  "request": {
    "action": "connect",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "spec": {
      "projectId": "my-gcp-project",
      "query": "SELECT date, SUM(amount) as total FROM `my-gcp-project.sales_data.transactions_2024` GROUP BY date ORDER BY date DESC"
    },
    "sheetName": "Daily Totals",
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "connect",
  "connection": {
    "dataSourceId": "DS_12345678",
    "type": "bigquery",
    "spec": {
      "projectId": "my-gcp-project",
      "datasetId": "sales_data",
      "tableId": "transactions_2024"
    },
    "sheetId": 0,
    "createdAt": "2026-01-30T10:00:00Z"
  },
  "sheetId": 0,
  "sheetName": "Sales Data"
}
```

---

#### `connect_looker` - Create Looker Connection

**Connect a Looker explore to a Google Sheet.**

⚠️ **Note**: Looker connections support **pivot tables only**, not standard data grids.

**Parameters:**

| Name             | Type    | Required | Description                                              |
| ---------------- | ------- | -------- | -------------------------------------------------------- |
| action           | literal | ✅       | `"connect_looker"`                                       |
| spreadsheetId    | string  | ✅       | Target spreadsheet ID                                    |
| spec             | object  | ✅       | Looker data source specification                         |
| spec.instanceUri | string  | ✅       | Looker instance URI (e.g., `https://company.looker.com`) |
| spec.model       | string  | ✅       | LookML model name                                        |
| spec.explore     | string  | ✅       | Explore name within the model                            |
| sheetId          | number  | ❌       | Target sheet ID (creates new if omitted)                 |
| sheetName        | string  | ❌       | Name for new sheet                                       |
| verbosity        | enum    | ❌       | Response detail level                                    |

**Example:**

```json
{
  "request": {
    "action": "connect_looker",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "spec": {
      "instanceUri": "https://mycompany.looker.com",
      "model": "sales",
      "explore": "orders"
    },
    "sheetName": "Looker Orders",
    "verbosity": "standard"
  }
}
```

---

#### `disconnect` - Remove Connection

**Remove a BigQuery or Looker data source connection.**

⚠️ **Warning**: Disconnecting removes the live link but preserves the last loaded data in the sheet.

**Parameters:**

| Name          | Type    | Required | Description              |
| ------------- | ------- | -------- | ------------------------ |
| action        | literal | ✅       | `"disconnect"`           |
| spreadsheetId | string  | ✅       | Spreadsheet ID           |
| dataSourceId  | string  | ✅       | Data source ID to remove |
| verbosity     | enum    | ❌       | Response detail level    |

**Example:**

```json
{
  "request": {
    "action": "disconnect",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "verbosity": "standard"
  }
}
```

---

#### `list_connections` - List All Connections

**Get all BigQuery and Looker connections in a spreadsheet.**

**Parameters:**

| Name          | Type    | Required | Description           |
| ------------- | ------- | -------- | --------------------- |
| action        | literal | ✅       | `"list_connections"`  |
| spreadsheetId | string  | ✅       | Spreadsheet ID        |
| verbosity     | enum    | ❌       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "list_connections",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "verbosity": "detailed"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "list_connections",
  "connections": [
    {
      "dataSourceId": "DS_12345678",
      "type": "bigquery",
      "spec": {
        "projectId": "my-gcp-project",
        "datasetId": "sales_data",
        "tableId": "transactions_2024"
      },
      "sheetId": 0,
      "createdAt": "2026-01-30T10:00:00Z",
      "lastRefreshed": "2026-01-30T14:30:00Z"
    },
    {
      "dataSourceId": "DS_87654321",
      "type": "looker",
      "lookerSpec": {
        "instanceUri": "https://mycompany.looker.com",
        "model": "sales",
        "explore": "orders"
      },
      "sheetId": 1,
      "createdAt": "2026-01-29T09:00:00Z"
    }
  ]
}
```

---

#### `get_connection` - Get Connection Details

**Retrieve details of a specific connection.**

**Parameters:**

| Name          | Type    | Required | Description           |
| ------------- | ------- | -------- | --------------------- |
| action        | literal | ✅       | `"get_connection"`    |
| spreadsheetId | string  | ✅       | Spreadsheet ID        |
| dataSourceId  | string  | ✅       | Data source ID        |
| verbosity     | enum    | ❌       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "get_connection",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "verbosity": "detailed"
  }
}
```

---

### Query Operations (4 actions)

#### `query` - Execute BigQuery SQL

**Execute a BigQuery SQL query and load results into a sheet.**

**Parameters:**

| Name               | Type    | Required | Description                                                |
| ------------------ | ------- | -------- | ---------------------------------------------------------- |
| action             | literal | ✅       | `"query"`                                                  |
| spreadsheetId      | string  | ✅       | Target spreadsheet ID                                      |
| projectId          | string  | ✅       | GCP project ID (for billing)                               |
| query              | string  | ✅       | SQL query to execute                                       |
| dataSourceId       | string  | ❌       | Existing data source to update                             |
| sheetId            | number  | ❌       | Target sheet (creates new if omitted)                      |
| sheetName          | string  | ❌       | Name for new sheet                                         |
| maxResults         | number  | ❌       | Max rows (1-100,000, default: 10,000)                      |
| timeoutMs          | number  | ❌       | Query timeout in milliseconds (1s-10min, default: 10s)     |
| maximumBytesBilled | string  | ❌       | Maximum bytes billed for cost control (e.g., "1000000000") |
| dryRun             | boolean | ❌       | Validate query without execution (returns cost estimate)   |
| useQueryCache      | boolean | ❌       | Use cached results if available (default: true)            |
| location           | string  | ❌       | Dataset location for execution (e.g., "US", "EU")          |
| verbosity          | enum    | ❌       | Response detail level                                      |

**Example:**

```json
{
  "request": {
    "action": "query",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "projectId": "my-gcp-project",
    "query": "SELECT customer_id, SUM(amount) as total FROM `my-gcp-project.sales.transactions` WHERE date >= '2024-01-01' GROUP BY customer_id ORDER BY total DESC LIMIT 100",
    "sheetName": "Top Customers 2024",
    "maxResults": 100,
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "query",
  "connection": {
    "dataSourceId": "DS_99887766",
    "type": "bigquery",
    "spec": {
      "projectId": "my-gcp-project",
      "query": "SELECT customer_id, ..."
    },
    "sheetId": 2
  },
  "rowCount": 100,
  "bytesProcessed": 1048576,
  "sheetId": 2,
  "sheetName": "Top Customers 2024"
}
```

**Example - Query with Cost Control and Timeout:**

```json
{
  "request": {
    "action": "query",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "projectId": "my-gcp-project",
    "query": "SELECT * FROM `my-gcp-project.analytics.events` WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)",
    "sheetName": "Last 7 Days Events",
    "timeoutMs": 120000,
    "maximumBytesBilled": "10000000000",
    "useQueryCache": true
  }
}
```

**Query Controls Explanation:**

- **`timeoutMs: 120000`** - Allow 2 minutes for query execution (prevents hung queries)
- **`maximumBytesBilled: "10000000000"`** - Limit to 10GB processed (prevents costly runaway queries)
- **`useQueryCache: true`** - Use cached results if query was run recently (faster + free)

**Example - Dry Run (Cost Estimation):**

```json
{
  "request": {
    "action": "query",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "projectId": "my-gcp-project",
    "query": "SELECT * FROM `my-gcp-project.warehouse.large_table`",
    "dryRun": true
  }
}
```

**Response (Dry Run):**

```json
{
  "success": true,
  "action": "query",
  "dryRun": true,
  "bytesProcessed": 524288000,
  "estimatedCostUSD": 0.0026,
  "message": "Query validation successful. No data processed."
}
```

**Use Cases for Query Controls:**

1. **Timeout Protection** - Set `timeoutMs` to prevent queries from running indefinitely
2. **Cost Control** - Set `maximumBytesBilled` to cap query costs (especially in production)
3. **Cost Estimation** - Use `dryRun: true` to validate queries and estimate costs before execution
4. **Performance** - Use `useQueryCache: true` to leverage BigQuery's result caching (default)
5. **Compliance** - Use `location` to ensure data stays in specific regions (e.g., `"EU"` for GDPR)

---

#### `preview` - Preview Query Results

**Preview BigQuery query results without creating a connection.**

**Use Case**: Test queries, validate syntax, estimate result size before full execution.

**Parameters:**

| Name      | Type    | Required | Description                           |
| --------- | ------- | -------- | ------------------------------------- |
| action    | literal | ✅       | `"preview"`                           |
| projectId | string  | ✅       | GCP project ID (for billing)          |
| query     | string  | ✅       | SQL query to preview                  |
| maxRows   | number  | ❌       | Max preview rows (1-100, default: 10) |
| verbosity | enum    | ❌       | Response detail level                 |

**Example:**

```json
{
  "request": {
    "action": "preview",
    "projectId": "my-gcp-project",
    "query": "SELECT * FROM `my-gcp-project.sales.transactions` LIMIT 10",
    "maxRows": 5,
    "verbosity": "detailed"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "preview",
  "rowCount": 5,
  "columns": ["transaction_id", "customer_id", "amount", "date"],
  "rows": [
    ["TX001", "CUST123", 99.99, "2024-01-15"],
    ["TX002", "CUST456", 149.5, "2024-01-15"],
    ["TX003", "CUST789", 75.0, "2024-01-16"],
    ["TX004", "CUST123", 120.0, "2024-01-16"],
    ["TX005", "CUST321", 200.0, "2024-01-17"]
  ],
  "bytesProcessed": 512000
}
```

---

#### `refresh` - Refresh Data Source

**Manually refresh a Connected Sheets data source.**

**Parameters:**

| Name          | Type    | Required | Description                                               |
| ------------- | ------- | -------- | --------------------------------------------------------- |
| action        | literal | ✅       | `"refresh"`                                               |
| spreadsheetId | string  | ✅       | Spreadsheet ID                                            |
| dataSourceId  | string  | ✅       | Data source ID to refresh                                 |
| force         | boolean | ❌       | Force refresh even if recently refreshed (default: false) |
| verbosity     | enum    | ❌       | Response detail level                                     |

**Example:**

```json
{
  "request": {
    "action": "refresh",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "force": true,
    "verbosity": "standard"
  }
}
```

---

#### `cancel_refresh` - Cancel Refresh

**Cancel an in-progress data source refresh.**

**Use Case**: Stop long-running queries (BigQuery or Looker) that are taking too long.

**Parameters:**

| Name          | Type    | Required | Description           |
| ------------- | ------- | -------- | --------------------- |
| action        | literal | ✅       | `"cancel_refresh"`    |
| spreadsheetId | string  | ✅       | Spreadsheet ID        |
| dataSourceId  | string  | ✅       | Data source ID        |
| verbosity     | enum    | ❌       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "cancel_refresh",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "verbosity": "standard"
  }
}
```

---

### Schema Discovery (3 actions)

#### `list_datasets` - List BigQuery Datasets

**List available datasets in a GCP project.**

**Parameters:**

| Name       | Type    | Required | Description                          |
| ---------- | ------- | -------- | ------------------------------------ |
| action     | literal | ✅       | `"list_datasets"`                    |
| projectId  | string  | ✅       | GCP project ID                       |
| maxResults | number  | ❌       | Max datasets (1-1,000, default: 100) |
| verbosity  | enum    | ❌       | Response detail level                |

**Example:**

```json
{
  "request": {
    "action": "list_datasets",
    "projectId": "my-gcp-project",
    "maxResults": 50,
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "list_datasets",
  "datasets": [
    {
      "datasetId": "sales_data",
      "location": "US",
      "description": "Sales transaction data"
    },
    {
      "datasetId": "marketing_data",
      "location": "US",
      "description": "Marketing campaign metrics"
    },
    {
      "datasetId": "analytics_staging",
      "location": "US"
    }
  ]
}
```

---

#### `list_tables` - List Tables in Dataset

**List tables in a BigQuery dataset.**

**Parameters:**

| Name       | Type    | Required | Description                        |
| ---------- | ------- | -------- | ---------------------------------- |
| action     | literal | ✅       | `"list_tables"`                    |
| projectId  | string  | ✅       | GCP project ID                     |
| datasetId  | string  | ✅       | Dataset ID                         |
| maxResults | number  | ❌       | Max tables (1-1,000, default: 100) |
| verbosity  | enum    | ❌       | Response detail level              |

**Example:**

```json
{
  "request": {
    "action": "list_tables",
    "projectId": "my-gcp-project",
    "datasetId": "sales_data",
    "verbosity": "detailed"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "list_tables",
  "tables": [
    {
      "tableId": "transactions_2024",
      "type": "TABLE",
      "rowCount": 1500000,
      "description": "Sales transactions for 2024"
    },
    {
      "tableId": "transactions_2023",
      "type": "TABLE",
      "rowCount": 1200000
    },
    {
      "tableId": "customer_summary",
      "type": "VIEW",
      "description": "Aggregated customer metrics"
    }
  ]
}
```

---

#### `get_table_schema` - Get Table Schema

**Get column definitions for a BigQuery table.**

**Parameters:**

| Name      | Type    | Required | Description           |
| --------- | ------- | -------- | --------------------- |
| action    | literal | ✅       | `"get_table_schema"`  |
| projectId | string  | ✅       | GCP project ID        |
| datasetId | string  | ✅       | Dataset ID            |
| tableId   | string  | ✅       | Table ID              |
| verbosity | enum    | ❌       | Response detail level |

**Example:**

```json
{
  "request": {
    "action": "get_table_schema",
    "projectId": "my-gcp-project",
    "datasetId": "sales_data",
    "tableId": "transactions_2024",
    "verbosity": "detailed"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "get_table_schema",
  "schema": [
    {
      "name": "transaction_id",
      "type": "STRING",
      "mode": "REQUIRED",
      "description": "Unique transaction identifier"
    },
    {
      "name": "customer_id",
      "type": "STRING",
      "mode": "REQUIRED"
    },
    {
      "name": "amount",
      "type": "FLOAT",
      "mode": "REQUIRED",
      "description": "Transaction amount in USD"
    },
    {
      "name": "date",
      "type": "DATE",
      "mode": "REQUIRED"
    },
    {
      "name": "tags",
      "type": "STRING",
      "mode": "REPEATED",
      "description": "Product tags"
    }
  ]
}
```

---

### Data Transfer (2 actions)

#### `export_to_bigquery` - Export Sheet to BigQuery

**Export Google Sheets data to a BigQuery table.**

**Parameters:**

| Name                  | Type          | Required | Description                                                           |
| --------------------- | ------------- | -------- | --------------------------------------------------------------------- |
| action                | literal       | ✅       | `"export_to_bigquery"`                                                |
| spreadsheetId         | string        | ✅       | Source spreadsheet ID                                                 |
| range                 | object/string | ✅       | Source range to export                                                |
| destination           | object        | ✅       | Destination BigQuery table                                            |
| destination.projectId | string        | ✅       | GCP project ID                                                        |
| destination.datasetId | string        | ✅       | Dataset ID                                                            |
| destination.tableId   | string        | ✅       | Table ID                                                              |
| writeDisposition      | enum          | ❌       | `WRITE_TRUNCATE`, `WRITE_APPEND`, `WRITE_EMPTY` (default: `TRUNCATE`) |
| headerRows            | number        | ❌       | Number of header rows to skip (0-10, default: 1)                      |
| autoDetectSchema      | boolean       | ❌       | Auto-detect schema from data (default: true)                          |
| verbosity             | enum          | ❌       | Response detail level                                                 |

**Write Dispositions:**

- `WRITE_TRUNCATE`: Overwrite existing table
- `WRITE_APPEND`: Add rows to existing table
- `WRITE_EMPTY`: Fail if table exists

**Example:**

```json
{
  "request": {
    "action": "export_to_bigquery",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "range": { "a1": "Sheet1!A1:D1000" },
    "destination": {
      "projectId": "my-gcp-project",
      "datasetId": "exports",
      "tableId": "sheet_export_2024"
    },
    "writeDisposition": "WRITE_TRUNCATE",
    "headerRows": 1,
    "autoDetectSchema": true,
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "export_to_bigquery",
  "jobId": "job_abc123xyz789",
  "rowCount": 999,
  "bytesProcessed": 204800
}
```

---

#### `import_from_bigquery` - Import to Sheet

**Import BigQuery query results into a Google Sheet.**

**Parameters:**

| Name           | Type    | Required | Description                            |
| -------------- | ------- | -------- | -------------------------------------- |
| action         | literal | ✅       | `"import_from_bigquery"`               |
| spreadsheetId  | string  | ✅       | Target spreadsheet ID                  |
| projectId      | string  | ✅       | GCP project ID (for billing)           |
| query          | string  | ✅       | SQL query to execute                   |
| sheetId        | number  | ❌       | Target sheet (creates new if omitted)  |
| sheetName      | string  | ❌       | Name for new sheet                     |
| startCell      | string  | ❌       | Starting cell (default: "A1")          |
| includeHeaders | boolean | ❌       | Include column headers (default: true) |
| maxResults     | number  | ❌       | Max rows (1-100,000, default: 10,000)  |
| verbosity      | enum    | ❌       | Response detail level                  |

**Example:**

```json
{
  "request": {
    "action": "import_from_bigquery",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "projectId": "my-gcp-project",
    "query": "SELECT * FROM `my-gcp-project.sales.transactions` WHERE date >= CURRENT_DATE() - 7",
    "sheetName": "Last 7 Days",
    "startCell": "A1",
    "includeHeaders": true,
    "maxResults": 5000,
    "verbosity": "standard"
  }
}
```

**Response:**

```json
{
  "success": true,
  "action": "import_from_bigquery",
  "sheetId": 3,
  "sheetName": "Last 7 Days",
  "rowCount": 4523,
  "columns": ["transaction_id", "customer_id", "amount", "date"],
  "bytesProcessed": 921600
}
```

---

## Common Workflows

### Workflow 1: Explore and Connect to BigQuery Table

**Goal**: Discover available data and connect to a specific table.

**Steps:**

1. **List available datasets:**

```json
{
  "request": {
    "action": "list_datasets",
    "projectId": "my-gcp-project",
    "verbosity": "standard"
  }
}
```

1. **List tables in target dataset:**

```json
{
  "request": {
    "action": "list_tables",
    "projectId": "my-gcp-project",
    "datasetId": "sales_data",
    "verbosity": "detailed"
  }
}
```

1. **Get table schema:**

```json
{
  "request": {
    "action": "get_table_schema",
    "projectId": "my-gcp-project",
    "datasetId": "sales_data",
    "tableId": "transactions_2024",
    "verbosity": "detailed"
  }
}
```

1. **Connect to spreadsheet:**

```json
{
  "request": {
    "action": "connect",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "spec": {
      "projectId": "my-gcp-project",
      "datasetId": "sales_data",
      "tableId": "transactions_2024"
    },
    "sheetName": "Sales Data",
    "verbosity": "standard"
  }
}
```

---

### Workflow 2: Test Query Before Creating Connection

**Goal**: Preview query results, optimize, then create connection.

**Steps:**

1. **Preview initial query:**

```json
{
  "request": {
    "action": "preview",
    "projectId": "my-gcp-project",
    "query": "SELECT customer_id, amount, date FROM `my-gcp-project.sales.transactions` WHERE date >= '2024-01-01'",
    "maxRows": 10,
    "verbosity": "detailed"
  }
}
```

1. **Review results and optimize query** (if needed)

2. **Create connection with optimized query:**

```json
{
  "request": {
    "action": "query",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "projectId": "my-gcp-project",
    "query": "SELECT customer_id, SUM(amount) as total FROM `my-gcp-project.sales.transactions` WHERE date >= '2024-01-01' GROUP BY customer_id ORDER BY total DESC",
    "sheetName": "Customer Totals",
    "maxResults": 1000,
    "verbosity": "standard"
  }
}
```

---

### Workflow 3: Export Sheet Data to BigQuery for Analysis

**Goal**: Move cleaned spreadsheet data to BigQuery.

**Steps:**

1. **Preview data to verify range:**
   (Use sheets_data tool to check range)

2. **Export to BigQuery:**

```json
{
  "request": {
    "action": "export_to_bigquery",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "range": { "a1": "CleanedData!A1:F5000" },
    "destination": {
      "projectId": "my-gcp-project",
      "datasetId": "imported_sheets",
      "tableId": "cleaned_sales_data"
    },
    "writeDisposition": "WRITE_TRUNCATE",
    "headerRows": 1,
    "autoDetectSchema": true,
    "verbosity": "standard"
  }
}
```

1. **Verify export:**

```json
{
  "request": {
    "action": "get_table_schema",
    "projectId": "my-gcp-project",
    "datasetId": "imported_sheets",
    "tableId": "cleaned_sales_data",
    "verbosity": "detailed"
  }
}
```

---

### Workflow 4: Manage Connection Lifecycle

**Goal**: Create, refresh, and disconnect data sources.

**Steps:**

1. **Create connection:**

```json
{
  "request": {
    "action": "connect",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "spec": {
      "projectId": "my-gcp-project",
      "datasetId": "live_data",
      "tableId": "dashboard_metrics"
    },
    "sheetName": "Live Metrics",
    "verbosity": "standard"
  }
}
```

1. **Use connection** (data auto-loads)

2. **Manual refresh when needed:**

```json
{
  "request": {
    "action": "refresh",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "force": true,
    "verbosity": "standard"
  }
}
```

1. **Cancel if query takes too long:**

```json
{
  "request": {
    "action": "cancel_refresh",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "verbosity": "standard"
  }
}
```

1. **Disconnect when done:**

```json
{
  "request": {
    "action": "disconnect",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "dataSourceId": "DS_12345678",
    "verbosity": "standard"
  }
}
```

---

## Best Practices

### Query Performance

1. **Use preview before full queries**
   - Test with `maxRows: 10` first
   - Check `bytesProcessed` to estimate cost

2. **Optimize queries**
   - Use `WHERE` clauses to filter early
   - Select only needed columns
   - Use partitioned tables when available

3. **Limit result size**
   - Set appropriate `maxResults`
   - Use `LIMIT` in SQL
   - Connected Sheets has 10 million cell limit

### Cost Management

1. **Monitor bytes processed**
   - Preview responses include `bytesProcessed`
   - BigQuery charges $5/TB processed (on-demand)

2. **Use table connections when possible**
   - More efficient than custom queries
   - Leverages BigQuery cache

3. **Avoid repeated full scans**
   - Use incremental queries (`WHERE date >= CURRENT_DATE() - 7`)
   - Consider materialized views

### Connection Management

1. **One connection per sheet**
   - Each sheet can have one primary data source
   - Create multiple sheets for multiple sources

2. **Descriptive sheet names**
   - Name sheets clearly: "Daily Sales (Live)", "Q1 2024 Export"
   - Include "(Live)" suffix for connected data

3. **Document queries**
   - Use comments in SQL
   - Store query definitions in a reference sheet

### Data Transfer

1. **Export considerations**
   - Use `WRITE_APPEND` for incremental exports
   - Add timestamp column to track export batches
   - Validate row counts after export

2. **Import considerations**
   - Use `startCell` to preserve existing data
   - Set `includeHeaders: false` when appending
   - Check for duplicate data

### Security

1. **Project access**
   - Use separate projects for dev/staging/prod
   - Grant minimal permissions (principle of least privilege)

2. **Data sensitivity**
   - Be cautious with personally identifiable information (PII)
   - Consider column-level access control in BigQuery
   - Use Views to hide sensitive columns

3. **Query validation**
   - Validate user-provided SQL for injection risks
   - Use parameterized queries when possible

---

## Troubleshooting

### Common Issues

#### Issue: "Permission denied on project"

**Cause**: Service account or user lacks BigQuery permissions

**Solution**:

1. Grant `bigquery.dataViewer` role for read access
2. Grant `bigquery.dataEditor` role for write access
3. Grant `bigquery.jobUser` role for query execution

---

#### Issue: "Dataset not found"

**Cause**: Dataset doesn't exist or wrong project

**Solution**:

1. Verify dataset ID spelling
2. Check project ID is correct
3. Use `list_datasets` to see available datasets

---

#### Issue: "Query syntax error"

**Cause**: Invalid SQL

**Solution**:

1. Use `preview` action to test query
2. Check for:
   - Missing backticks around table names
   - Invalid column names
   - Incorrect aggregation syntax
3. Test in BigQuery console first

**Example - Correct table name syntax:**

```sql
-- ❌ Wrong
SELECT * FROM my-project.dataset.table

-- ✅ Correct
SELECT * FROM `my-project.dataset.table`
```

---

#### Issue: "Quota exceeded"

**Cause**: Hit BigQuery API or query quota limits

**Quotas:**

- BigQuery API: 100 requests/10 seconds/user
- Query: 100 concurrent queries per project
- Slots: Variable based on pricing tier

**Solution**:

1. Implement rate limiting
2. Use batch operations
3. Consider reserved slots for predictable pricing

---

#### Issue: "Results exceed sheet capacity"

**Cause**: Query returns more than 10M cells (Connected Sheets limit)

**Solution**:

1. Reduce `maxResults`
2. Add `LIMIT` clause to query
3. Filter data more aggressively
4. Split across multiple sheets

---

#### Issue: "Connection not refreshing"

**Cause**: Refresh settings or quota issues

**Solution**:

1. Use `force: true` to override recent refresh check
2. Check for errors in `list_connections` response
3. Manually disconnect and reconnect if stuck

---

#### Issue: "Export fails with schema mismatch"

**Cause**: Sheet data doesn't match BigQuery schema

**Solution**:

1. Use `autoDetectSchema: true` for initial exports
2. Check header row is formatted correctly
3. Ensure data types are consistent within columns
4. Remove empty rows/columns before export

---

### Getting Help

1. **Check connection status:**

   ```json
   {
     "request": {
       "action": "list_connections",
       "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
       "verbosity": "detailed"
     }
   }
   ```

2. **Review BigQuery documentation:**
   - [BigQuery SQL Reference](https://cloud.google.com/bigquery/docs/reference/standard-sql)
   - [Connected Sheets Guide](https://support.google.com/docs/answer/9702507)

3. **ServalSheets documentation:**
   - [Error Handling Guide](./ERROR_HANDLING.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

---

## Additional Resources

- **BigQuery Console**: https://console.cloud.google.com/bigquery
- **BigQuery API Reference**: https://cloud.google.com/bigquery/docs/reference/rest
- **Connected Sheets Help**: https://support.google.com/docs/answer/9702507
- **ServalSheets Source**: [src/schemas/bigquery.ts](../../src/schemas/bigquery.ts)
- **Handler Implementation**: [src/handlers/bigquery.ts](../../src/handlers/bigquery.ts)

---

**Last Updated**: 2026-01-30 (v1.6.0)
