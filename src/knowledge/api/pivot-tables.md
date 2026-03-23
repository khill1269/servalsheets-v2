# Pivot Tables Complete Reference

> **API Version:** Google Sheets API v4  
> **Last Updated:** January 4, 2026  
> **Purpose:** Complete pivot table guide for ServalSheets

---

## Table of Contents

1. [Overview](#overview)
2. [Pivot Table Structure](#pivot-table-structure)
3. [Creating Pivot Tables](#creating-pivot-tables)
4. [Row & Column Groups](#row--column-groups)
5. [Value Aggregations](#value-aggregations)
6. [Filters](#filters)
7. [Sorting & Display](#sorting--display)
8. [Complete Examples](#complete-examples)
9. [Common Patterns](#common-patterns)

---

## Overview

### What is a Pivot Table?

A pivot table summarizes data by grouping rows/columns and applying aggregation functions. In Google Sheets API, pivot tables are created via `updateCells` with `pivotTable` in `CellData`.

### Key Components

| Component   | Purpose                              |
| ----------- | ------------------------------------ |
| **Source**  | Data range to analyze                |
| **Rows**    | Fields to group by (vertical)        |
| **Columns** | Fields to group by (horizontal)      |
| **Values**  | Aggregations (SUM, COUNT, AVG, etc.) |
| **Filters** | Criteria to include/exclude data     |

---

## Pivot Table Structure

### Complete Schema

```typescript
interface PivotTable {
  source: GridRange;
  rows?: PivotGroup[];
  columns?: PivotGroup[];
  values?: PivotValue[];
  criteria?: Record<number, PivotFilterCriteria>; // Column offset -> filter
  filterSpecs?: PivotFilterSpec[];
  valueLayout?: 'HORIZONTAL' | 'VERTICAL';
  dataExecutionStatus?: DataExecutionStatus;
}

interface PivotGroup {
  sourceColumnOffset: number; // Column index in source data (0-based)
  showTotals?: boolean; // Show group totals
  sortOrder?: 'ASCENDING' | 'DESCENDING';
  valueBucket?: PivotGroupSortValueBucket;
  valueMetadata?: PivotGroupValueMetadata[];
  repeatHeadings?: boolean;
  label?: string; // Custom group label
  groupRule?: PivotGroupRule; // Date/histogram grouping
  groupLimit?: PivotGroupLimit; // Limit displayed groups
  dataSourceColumnReference?: DataSourceColumnReference;
}

interface PivotValue {
  summarizeFunction: PivotValueSummarizeFunction;
  sourceColumnOffset?: number; // Column to aggregate
  name?: string; // Custom display name
  calculatedDisplayType?: PivotValueCalculatedDisplayType;
  formula?: string; // For CUSTOM function
  dataSourceColumnReference?: DataSourceColumnReference;
}

type PivotValueSummarizeFunction =
  | 'SUM'
  | 'COUNTA'
  | 'COUNT'
  | 'COUNTUNIQUE'
  | 'AVERAGE'
  | 'MAX'
  | 'MIN'
  | 'MEDIAN'
  | 'PRODUCT'
  | 'STDEV'
  | 'STDEVP'
  | 'VAR'
  | 'VARP'
  | 'CUSTOM';

type PivotValueCalculatedDisplayType =
  | 'PIVOT_VALUE_CALCULATED_DISPLAY_TYPE_UNSPECIFIED'
  | 'PERCENT_OF_ROW_TOTAL'
  | 'PERCENT_OF_COLUMN_TOTAL'
  | 'PERCENT_OF_GRAND_TOTAL';
```

---

## Creating Pivot Tables

### Basic Creation Request

```typescript
// Pivot table is created by updating a cell with pivotTable data
const createPivotTableRequest = {
  updateCells: {
    rows: [
      {
        values: [
          {
            pivotTable: {
              source: {
                sheetId: 0, // Source data sheet
                startRowIndex: 0,
                endRowIndex: 100,
                startColumnIndex: 0,
                endColumnIndex: 5,
              },
              rows: [
                { sourceColumnOffset: 0, showTotals: true }, // Group by column A
              ],
              values: [
                { summarizeFunction: 'SUM', sourceColumnOffset: 2 }, // Sum column C
              ],
            },
          },
        ],
      },
    ],
    start: {
      sheetId: 1, // Destination sheet
      rowIndex: 0,
      columnIndex: 0,
    },
    fields: 'pivotTable',
  },
};
```

### Using Dedicated Sheet

```typescript
// Create pivot table on a new sheet
const requests = [
  // 1. Add new sheet for pivot table
  {
    addSheet: {
      properties: {
        title: 'Sales Pivot',
        gridProperties: { rowCount: 100, columnCount: 20 },
      },
    },
  },
  // 2. Create pivot table (use reply to get sheet ID)
];

// After getting sheetId from addSheet reply
const pivotRequest = {
  updateCells: {
    rows: [
      {
        values: [
          {
            pivotTable: {
              source: {
                sheetId: 0, // Data source
                startRowIndex: 0,
                endRowIndex: 1000,
                startColumnIndex: 0,
                endColumnIndex: 10,
              },
              rows: [
                { sourceColumnOffset: 1, showTotals: true, label: 'Region' },
                { sourceColumnOffset: 2, showTotals: true, label: 'Product' },
              ],
              columns: [{ sourceColumnOffset: 0, showTotals: true, label: 'Year' }],
              values: [
                { summarizeFunction: 'SUM', sourceColumnOffset: 4, name: 'Total Sales' },
                { summarizeFunction: 'COUNT', sourceColumnOffset: 4, name: 'Order Count' },
              ],
            },
          },
        ],
      },
    ],
    start: {
      sheetId: newSheetId, // From addSheet reply
      rowIndex: 0,
      columnIndex: 0,
    },
    fields: 'pivotTable',
  },
};
```

---

## Row & Column Groups

### Simple Grouping

```typescript
// Group by single column
const singleGroup: PivotGroup = {
  sourceColumnOffset: 0, // First column in source
  showTotals: true,
  sortOrder: 'ASCENDING',
};

// Multiple row groups (nested)
const nestedGroups: PivotGroup[] = [
  { sourceColumnOffset: 0, showTotals: true, label: 'Category' }, // Outer group
  { sourceColumnOffset: 1, showTotals: true, label: 'Subcategory' }, // Inner group
];
```

### Date Grouping

```typescript
// Group dates by month
const monthGroup: PivotGroup = {
  sourceColumnOffset: 3, // Date column
  showTotals: true,
  groupRule: {
    dateTimeRule: {
      type: 'MONTH',
    },
  },
};

// Available date grouping types
type DateTimeRuleType =
  | 'SECOND'
  | 'MINUTE'
  | 'HOUR'
  | 'HOUR_MINUTE'
  | 'HOUR_MINUTE_AMPM'
  | 'DAY_OF_YEAR'
  | 'DAY_OF_MONTH'
  | 'DAY_OF_WEEK'
  | 'MONTH'
  | 'QUARTER'
  | 'YEAR'
  | 'YEAR_MONTH'
  | 'YEAR_QUARTER'
  | 'YEAR_MONTH_DAY';

// Group by year and quarter
const yearQuarterGroups: PivotGroup[] = [
  {
    sourceColumnOffset: 3,
    groupRule: { dateTimeRule: { type: 'YEAR' } },
    label: 'Year',
  },
  {
    sourceColumnOffset: 3,
    groupRule: { dateTimeRule: { type: 'QUARTER' } },
    label: 'Quarter',
  },
];
```

### Numeric Histogram Grouping

```typescript
// Group numbers into buckets
const histogramGroup: PivotGroup = {
  sourceColumnOffset: 4, // Numeric column
  showTotals: true,
  groupRule: {
    histogramRule: {
      interval: 100, // Bucket size
      start: 0, // Start value
      end: 1000, // End value
    },
  },
};

// Example: Age brackets
const ageGroup: PivotGroup = {
  sourceColumnOffset: 2,
  groupRule: {
    histogramRule: {
      interval: 10, // 10-year brackets
      start: 0,
      end: 100,
    },
  },
  label: 'Age Group',
};
```

### Manual Grouping (Value Metadata)

```typescript
// Manually specify group order/visibility
const manualGroup: PivotGroup = {
  sourceColumnOffset: 0,
  showTotals: true,
  valueMetadata: [
    { value: { stringValue: 'High' }, collapsed: false },
    { value: { stringValue: 'Medium' }, collapsed: false },
    { value: { stringValue: 'Low' }, collapsed: true }, // Collapsed by default
  ],
};
```

### Limiting Groups (Top N)

```typescript
// Show only top 10 by value
const topNGroup: PivotGroup = {
  sourceColumnOffset: 0,
  showTotals: true,
  groupLimit: {
    countLimit: 10,
    applyOrder: 'VALUE', // Limit by value aggregation
  },
  valueBucket: {
    buckets: [{ stringValue: '' }],
    valuesIndex: 0, // Index of value to sort by
  },
  sortOrder: 'DESCENDING',
};
```

---

## Value Aggregations

### Summarize Functions

```typescript
// Sum
const sumValue: PivotValue = {
  summarizeFunction: 'SUM',
  sourceColumnOffset: 4,
  name: 'Total Revenue',
};

// Count (non-empty cells)
const countValue: PivotValue = {
  summarizeFunction: 'COUNTA',
  sourceColumnOffset: 0,
  name: 'Record Count',
};

// Count (numeric only)
const countNumeric: PivotValue = {
  summarizeFunction: 'COUNT',
  sourceColumnOffset: 4,
  name: 'Numeric Count',
};

// Count unique
const countUnique: PivotValue = {
  summarizeFunction: 'COUNTUNIQUE',
  sourceColumnOffset: 1,
  name: 'Unique Customers',
};

// Average
const avgValue: PivotValue = {
  summarizeFunction: 'AVERAGE',
  sourceColumnOffset: 4,
  name: 'Avg Order Value',
};

// Max
const maxValue: PivotValue = {
  summarizeFunction: 'MAX',
  sourceColumnOffset: 4,
  name: 'Highest Sale',
};

// Min
const minValue: PivotValue = {
  summarizeFunction: 'MIN',
  sourceColumnOffset: 4,
  name: 'Lowest Sale',
};

// Median
const medianValue: PivotValue = {
  summarizeFunction: 'MEDIAN',
  sourceColumnOffset: 4,
  name: 'Median Sale',
};

// Standard deviation (sample)
const stdevValue: PivotValue = {
  summarizeFunction: 'STDEV',
  sourceColumnOffset: 4,
  name: 'Std Dev',
};

// Variance
const varValue: PivotValue = {
  summarizeFunction: 'VAR',
  sourceColumnOffset: 4,
  name: 'Variance',
};
```

### Calculated Display Types

```typescript
// Show as percentage of row total
const percentOfRow: PivotValue = {
  summarizeFunction: 'SUM',
  sourceColumnOffset: 4,
  name: '% of Row',
  calculatedDisplayType: 'PERCENT_OF_ROW_TOTAL',
};

// Show as percentage of column total
const percentOfColumn: PivotValue = {
  summarizeFunction: 'SUM',
  sourceColumnOffset: 4,
  name: '% of Column',
  calculatedDisplayType: 'PERCENT_OF_COLUMN_TOTAL',
};

// Show as percentage of grand total
const percentOfGrand: PivotValue = {
  summarizeFunction: 'SUM',
  sourceColumnOffset: 4,
  name: '% of Total',
  calculatedDisplayType: 'PERCENT_OF_GRAND_TOTAL',
};
```

### Custom Formulas

```typescript
// Custom calculated field
const customValue: PivotValue = {
  summarizeFunction: 'CUSTOM',
  formula: '=SUM(Sales)/SUM(Quantity)', // Average price
  name: 'Avg Price',
};
```

### Multiple Values

```typescript
// Multiple aggregations
const multipleValues: PivotValue[] = [
  { summarizeFunction: 'SUM', sourceColumnOffset: 4, name: 'Total Sales' },
  { summarizeFunction: 'COUNT', sourceColumnOffset: 4, name: 'Order Count' },
  { summarizeFunction: 'AVERAGE', sourceColumnOffset: 4, name: 'Avg Order' },
  {
    summarizeFunction: 'SUM',
    sourceColumnOffset: 4,
    name: '% of Total',
    calculatedDisplayType: 'PERCENT_OF_GRAND_TOTAL',
  },
];
```

### Value Layout

```typescript
// Horizontal: values side by side
const horizontalLayout: PivotTable = {
  source: {
    /* ... */
  },
  rows: [{ sourceColumnOffset: 0 }],
  values: [
    { summarizeFunction: 'SUM', sourceColumnOffset: 1 },
    { summarizeFunction: 'SUM', sourceColumnOffset: 2 },
  ],
  valueLayout: 'HORIZONTAL', // Default
};

// Vertical: values stacked
const verticalLayout: PivotTable = {
  source: {
    /* ... */
  },
  rows: [{ sourceColumnOffset: 0 }],
  values: [
    { summarizeFunction: 'SUM', sourceColumnOffset: 1 },
    { summarizeFunction: 'SUM', sourceColumnOffset: 2 },
  ],
  valueLayout: 'VERTICAL',
};
```

---

## Filters

### Filter by Values

```typescript
// Filter specific values
const filterByValues: PivotFilterCriteria = {
  visibleValues: ['North', 'South'], // Only show these
};

// Using criteria map (column offset -> filter)
const pivotWithFilter: PivotTable = {
  source: {
    /* ... */
  },
  rows: [{ sourceColumnOffset: 1 }],
  values: [{ summarizeFunction: 'SUM', sourceColumnOffset: 3 }],
  criteria: {
    0: {
      // Filter column at offset 0
      visibleValues: ['2024', '2023'],
    },
  },
};
```

### Filter by Condition

```typescript
// Using filterSpecs (more flexible)
const filterByCondition: PivotFilterSpec = {
  columnOffsetIndex: 4, // Column to filter
  filterCriteria: {
    condition: {
      type: 'NUMBER_GREATER',
      values: [{ userEnteredValue: '1000' }],
    },
  },
};

// Multiple filter conditions
const multipleFilters: PivotFilterSpec[] = [
  {
    columnOffsetIndex: 0,
    filterCriteria: {
      visibleValues: ['Active'],
    },
  },
  {
    columnOffsetIndex: 3,
    filterCriteria: {
      condition: {
        type: 'DATE_AFTER',
        values: [{ userEnteredValue: '2024-01-01' }],
      },
    },
  },
  {
    columnOffsetIndex: 4,
    filterCriteria: {
      condition: {
        type: 'NUMBER_GREATER_THAN_EQ',
        values: [{ userEnteredValue: '100' }],
      },
    },
  },
];
```

### Available Filter Conditions

| Type                     | Description        |
| ------------------------ | ------------------ |
| `NUMBER_GREATER`         | > value            |
| `NUMBER_GREATER_THAN_EQ` | >= value           |
| `NUMBER_LESS`            | < value            |
| `NUMBER_LESS_THAN_EQ`    | <= value           |
| `NUMBER_EQ`              | = value            |
| `NUMBER_NOT_EQ`          | ≠ value            |
| `NUMBER_BETWEEN`         | Between two values |
| `TEXT_CONTAINS`          | Contains substring |
| `TEXT_NOT_CONTAINS`      | Doesn't contain    |
| `TEXT_STARTS_WITH`       | Starts with        |
| `TEXT_ENDS_WITH`         | Ends with          |
| `TEXT_EQ`                | Exact match        |
| `DATE_EQ`                | Equals date        |
| `DATE_BEFORE`            | Before date        |
| `DATE_AFTER`             | After date         |
| `BLANK`                  | Is empty           |
| `NOT_BLANK`              | Is not empty       |

---

## Sorting & Display

### Sorting Groups

```typescript
// Sort by group value (alphabetically)
const alphabeticalSort: PivotGroup = {
  sourceColumnOffset: 0,
  sortOrder: 'ASCENDING',
};

// Sort by aggregated value
const sortByValue: PivotGroup = {
  sourceColumnOffset: 0,
  sortOrder: 'DESCENDING',
  valueBucket: {
    buckets: [], // Empty for simple sort
    valuesIndex: 0, // Sort by first value aggregation
  },
};

// Sort by specific value when multiple values exist
const sortBySpecificValue: PivotGroup = {
  sourceColumnOffset: 0,
  sortOrder: 'DESCENDING',
  valueBucket: {
    buckets: [],
    valuesIndex: 1, // Sort by second value (index 1)
  },
};
```

### Show/Hide Totals

```typescript
// Row totals
const withRowTotals: PivotGroup = {
  sourceColumnOffset: 0,
  showTotals: true, // Show subtotals for this group
};

// No totals
const withoutTotals: PivotGroup = {
  sourceColumnOffset: 0,
  showTotals: false,
};
```

### Repeating Headers

```typescript
// Repeat row headers on each row
const repeatHeaders: PivotGroup = {
  sourceColumnOffset: 0,
  repeatHeadings: true, // Repeat value in each row
};
```

---

## Complete Examples

### Sales Analysis Pivot

```typescript
// Source data columns:
// A: Date, B: Region, C: Product, D: Salesperson, E: Quantity, F: Revenue

const salesPivot: PivotTable = {
  source: {
    sheetId: 0,
    startRowIndex: 0,
    endRowIndex: 10000,
    startColumnIndex: 0,
    endColumnIndex: 6,
  },
  rows: [
    {
      sourceColumnOffset: 1, // Region
      showTotals: true,
      sortOrder: 'ASCENDING',
      label: 'Region',
    },
    {
      sourceColumnOffset: 2, // Product
      showTotals: true,
      sortOrder: 'DESCENDING',
      valueBucket: { valuesIndex: 0 }, // Sort by revenue
      label: 'Product',
    },
  ],
  columns: [
    {
      sourceColumnOffset: 0, // Date
      showTotals: true,
      groupRule: {
        dateTimeRule: { type: 'QUARTER' },
      },
      label: 'Quarter',
    },
  ],
  values: [
    {
      summarizeFunction: 'SUM',
      sourceColumnOffset: 5, // Revenue
      name: 'Total Revenue',
    },
    {
      summarizeFunction: 'SUM',
      sourceColumnOffset: 4, // Quantity
      name: 'Units Sold',
    },
    {
      summarizeFunction: 'COUNTUNIQUE',
      sourceColumnOffset: 3, // Salesperson
      name: 'Active Reps',
    },
  ],
  filterSpecs: [
    {
      columnOffsetIndex: 0,
      filterCriteria: {
        condition: {
          type: 'DATE_ON_OR_AFTER',
          values: [{ userEnteredValue: '2024-01-01' }],
        },
      },
    },
  ],
  valueLayout: 'HORIZONTAL',
};

// Create request
const createSalesPivot = {
  updateCells: {
    rows: [
      {
        values: [
          {
            pivotTable: salesPivot,
          },
        ],
      },
    ],
    start: {
      sheetId: 1, // Pivot sheet
      rowIndex: 0,
      columnIndex: 0,
    },
    fields: 'pivotTable',
  },
};
```

### Customer Cohort Analysis

```typescript
// Source: A: CustomerID, B: SignupDate, C: OrderDate, D: OrderValue

const cohortPivot: PivotTable = {
  source: {
    sheetId: 0,
    startRowIndex: 0,
    endRowIndex: 50000,
    startColumnIndex: 0,
    endColumnIndex: 4,
  },
  rows: [
    {
      sourceColumnOffset: 1, // Signup date
      showTotals: true,
      groupRule: {
        dateTimeRule: { type: 'YEAR_MONTH' },
      },
      label: 'Cohort',
    },
  ],
  columns: [
    {
      sourceColumnOffset: 2, // Order date
      showTotals: true,
      groupRule: {
        dateTimeRule: { type: 'YEAR_MONTH' },
      },
      label: 'Order Month',
    },
  ],
  values: [
    {
      summarizeFunction: 'COUNTUNIQUE',
      sourceColumnOffset: 0, // Customer ID
      name: 'Active Customers',
    },
    {
      summarizeFunction: 'SUM',
      sourceColumnOffset: 3, // Order value
      name: 'Revenue',
    },
  ],
};
```

### Employee Performance Summary

```typescript
// Source: A: Name, B: Department, C: Role, D: Sales, E: Quota, F: Rating

const performancePivot: PivotTable = {
  source: {
    sheetId: 0,
    startRowIndex: 0,
    endRowIndex: 500,
    startColumnIndex: 0,
    endColumnIndex: 6,
  },
  rows: [
    {
      sourceColumnOffset: 1, // Department
      showTotals: true,
      sortOrder: 'ASCENDING',
    },
    {
      sourceColumnOffset: 2, // Role
      showTotals: true,
    },
  ],
  values: [
    {
      summarizeFunction: 'COUNTA',
      sourceColumnOffset: 0,
      name: 'Headcount',
    },
    {
      summarizeFunction: 'SUM',
      sourceColumnOffset: 3,
      name: 'Total Sales',
    },
    {
      summarizeFunction: 'SUM',
      sourceColumnOffset: 4,
      name: 'Total Quota',
    },
    {
      summarizeFunction: 'AVERAGE',
      sourceColumnOffset: 5,
      name: 'Avg Rating',
    },
  ],
  criteria: {
    5: {
      // Filter by rating >= 3
      condition: {
        type: 'NUMBER_GREATER_THAN_EQ',
        values: [{ userEnteredValue: '3' }],
      },
    },
  },
};
```

---

## Common Patterns

### Pattern: Year-over-Year Comparison

```typescript
const yoyPivot: PivotTable = {
  source: {
    /* date, category, value */
  },
  rows: [
    { sourceColumnOffset: 1, showTotals: true }, // Category
  ],
  columns: [
    {
      sourceColumnOffset: 0,
      groupRule: { dateTimeRule: { type: 'YEAR' } },
    },
  ],
  values: [{ summarizeFunction: 'SUM', sourceColumnOffset: 2, name: 'Total' }],
};
```

### Pattern: Top N Analysis

```typescript
const topNPivot: PivotTable = {
  source: {
    /* ... */
  },
  rows: [
    {
      sourceColumnOffset: 0, // Entity to rank
      showTotals: false,
      sortOrder: 'DESCENDING',
      valueBucket: { valuesIndex: 0 },
      groupLimit: { countLimit: 10 }, // Top 10
    },
  ],
  values: [{ summarizeFunction: 'SUM', sourceColumnOffset: 1 }],
};
```

### Pattern: Distribution Analysis

```typescript
const distributionPivot: PivotTable = {
  source: {
    /* ... with numeric values */
  },
  rows: [
    {
      sourceColumnOffset: 2, // Numeric column
      showTotals: true,
      groupRule: {
        histogramRule: {
          interval: 1000, // $1000 buckets
          start: 0,
          end: 10000,
        },
      },
    },
  ],
  values: [
    { summarizeFunction: 'COUNTA', sourceColumnOffset: 0, name: 'Count' },
    {
      summarizeFunction: 'COUNTA',
      sourceColumnOffset: 0,
      name: '% of Total',
      calculatedDisplayType: 'PERCENT_OF_GRAND_TOTAL',
    },
  ],
};
```

### Pattern: Cross-Tab Analysis

```typescript
const crossTabPivot: PivotTable = {
  source: {
    /* ... */
  },
  rows: [
    { sourceColumnOffset: 0, showTotals: true }, // Dimension 1
  ],
  columns: [
    { sourceColumnOffset: 1, showTotals: true }, // Dimension 2
  ],
  values: [{ summarizeFunction: 'COUNTA', sourceColumnOffset: 0, name: 'Count' }],
};
```

---

## Update & Delete Pivot Tables

### Update Pivot Table

```typescript
// Update by replacing pivotTable in cell
const updatePivot = {
  updateCells: {
    rows: [
      {
        values: [
          {
            pivotTable: updatedPivotTable, // New configuration
          },
        ],
      },
    ],
    start: {
      sheetId: 1,
      rowIndex: 0,
      columnIndex: 0,
    },
    fields: 'pivotTable',
  },
};
```

### Delete Pivot Table

```typescript
// Clear the cell containing pivot table
const deletePivot = {
  updateCells: {
    rows: [
      {
        values: [
          {
            // Empty cell data clears pivot
          },
        ],
      },
    ],
    start: {
      sheetId: 1,
      rowIndex: 0,
      columnIndex: 0,
    },
    fields: 'pivotTable',
  },
};
```

---

_Source: Google Sheets API v4 Documentation_
