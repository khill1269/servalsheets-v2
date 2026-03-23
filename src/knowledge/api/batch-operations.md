# Batch Operations Patterns Guide

> **API Version:** Google Sheets API v4  
> **Last Updated:** January 4, 2026  
> **Purpose:** Optimize API usage with efficient batch patterns for ServalSheets

---

## Table of Contents

1. [Overview](#overview)
2. [BatchUpdate Fundamentals](#batchupdate-fundamentals)
3. [Combining Operations](#combining-operations)
4. [Request Ordering](#request-ordering)
5. [Performance Patterns](#performance-patterns)
6. [Common Batch Recipes](#common-batch-recipes)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## Overview

### Why Batch?

| Approach            | API Calls | Quota Cost | Speed |
| ------------------- | --------- | ---------- | ----- |
| Individual requests | N         | N × cost   | Slow  |
| Batch requests      | 1         | 1 × cost   | Fast  |

**Benefits:**

- Reduced quota consumption (60 req/min/user limit)
- Faster execution (single round-trip)
- Atomic operations (all-or-nothing)
- Consistent state (no intermediate states visible)

### Batch Limits

| Limit              | Value                   |
| ------------------ | ----------------------- |
| Requests per batch | 500 (recommended: <100) |
| Cells per write    | 10,000,000              |
| Request size       | 10 MB                   |
| Values per write   | Varies by cell count    |

---

## BatchUpdate Fundamentals

### Basic Structure

```typescript
const batchUpdateRequest = {
  requests: [
    { requestType1: { /* parameters */ } },
    { requestType2: { /* parameters */ } },
    // ... more requests
  ],
  includeSpreadsheetInResponse?: boolean,
  responseRanges?: string[],
  responseIncludeGridData?: boolean,
};
```

### Request Types

All batchUpdate request types:

| Category     | Request Types                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Sheets       | `addSheet`, `deleteSheet`, `updateSheetProperties`, `duplicateSheet`                                       |
| Cells        | `updateCells`, `repeatCell`, `appendCells`                                                                 |
| Dimensions   | `insertDimension`, `deleteDimension`, `updateDimensionProperties`, `moveDimension`, `autoResizeDimensions` |
| Merges       | `mergeCells`, `unmergeCells`                                                                               |
| Formatting   | `updateBorders`, `addConditionalFormatRule`, `updateConditionalFormatRule`, `deleteConditionalFormatRule`  |
| Data         | `sortRange`, `setBasicFilter`, `clearBasicFilter`, `addFilterView`, `updateFilterView`, `deleteFilterView` |
| Charts       | `addChart`, `updateChartSpec`, `deleteEmbeddedObject`, `moveEmbeddedObjectToSheet`                         |
| Protection   | `addProtectedRange`, `updateProtectedRange`, `deleteProtectedRange`                                        |
| Named Ranges | `addNamedRange`, `updateNamedRange`, `deleteNamedRange`                                                    |
| Validation   | `setDataValidation`                                                                                        |
| Other        | `copyPaste`, `cutPaste`, `pasteData`, `textToColumns`, `findReplace`, `duplicateFilterView`                |

---

## Combining Operations

### Create Sheet with Data & Formatting

```typescript
const createCompleteSheet = {
  requests: [
    // 1. Create sheet
    {
      addSheet: {
        properties: {
          title: 'Q4 Report',
          gridProperties: {
            rowCount: 100,
            columnCount: 10,
            frozenRowCount: 1,
          },
          tabColor: { red: 0.2, green: 0.6, blue: 0.8 },
        },
      },
    },
    // Note: Need to use the reply to get sheetId for subsequent operations
    // Alternative: Use a specific sheetId in addSheet if you know it's available
  ],
};

// After getting sheetId from reply, continue with:
const populateSheet = (sheetId: number) => ({
  requests: [
    // 2. Add headers
    {
      updateCells: {
        rows: [
          {
            values: [
              { userEnteredValue: { stringValue: 'Date' } },
              { userEnteredValue: { stringValue: 'Category' } },
              { userEnteredValue: { stringValue: 'Amount' } },
              { userEnteredValue: { stringValue: 'Status' } },
            ],
          },
        ],
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        fields: 'userEnteredValue',
      },
    },
    // 3. Format headers
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.2, green: 0.2, blue: 0.3 },
            textFormat: {
              bold: true,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    // 4. Set column widths
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: 1,
        },
        properties: { pixelSize: 120 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 2,
          endIndex: 3,
        },
        properties: { pixelSize: 100 },
        fields: 'pixelSize',
      },
    },
    // 5. Add data validation
    {
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Pending' },
              { userEnteredValue: 'Approved' },
              { userEnteredValue: 'Rejected' },
            ],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },
    // 6. Add conditional formatting
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 1,
              endRowIndex: 100,
              startColumnIndex: 3,
              endColumnIndex: 4,
            },
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_EQ',
              values: [{ userEnteredValue: 'Approved' }],
            },
            format: {
              backgroundColor: { red: 0.8, green: 1, blue: 0.8 },
            },
          },
        },
        index: 0,
      },
    },
  ],
});
```

### Bulk Data Update with Formatting

```typescript
const bulkDataWithFormat = {
  requests: [
    // Update values
    {
      updateCells: {
        rows: [
          {
            values: [
              { userEnteredValue: { stringValue: '2024-01-01' } },
              { userEnteredValue: { stringValue: 'Sales' } },
              { userEnteredValue: { numberValue: 15000 } },
            ],
          },
          {
            values: [
              { userEnteredValue: { stringValue: '2024-01-02' } },
              { userEnteredValue: { stringValue: 'Marketing' } },
              { userEnteredValue: { numberValue: 8500 } },
            ],
          },
          // ... more rows
        ],
        start: { sheetId: 0, rowIndex: 1, columnIndex: 0 },
        fields: 'userEnteredValue',
      },
    },
    // Format date column
    {
      repeatCell: {
        range: {
          sheetId: 0,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'DATE',
              pattern: 'yyyy-mm-dd',
            },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    // Format currency column
    {
      repeatCell: {
        range: {
          sheetId: 0,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: 'CURRENCY',
              pattern: '"$"#,##0.00',
            },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
  ],
};
```

---

## Request Ordering

### Dependencies Matter

Some operations depend on others:

```typescript
// ✅ CORRECT: Create sheet before using it
const correctOrder = {
  requests: [
    { addSheet: { properties: { title: 'New', sheetId: 999 } } },
    { updateCells: { start: { sheetId: 999, rowIndex: 0, columnIndex: 0 } /* ... */ } },
  ],
};

// ❌ WRONG: Using sheet before it exists
const wrongOrder = {
  requests: [
    { updateCells: { start: { sheetId: 999, rowIndex: 0, columnIndex: 0 } /* ... */ } },
    { addSheet: { properties: { title: 'New', sheetId: 999 } } },
  ],
};
```

### Common Dependency Chains

```
1. addSheet → updateCells → addConditionalFormatRule
2. addNamedRange → setDataValidation (using named range)
3. insertDimension → updateCells (in new rows/columns)
4. addChart → updateChartSpec
```

### Using Reply References

When you need IDs from created objects:

```typescript
// Request with response
const response = await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [{ addSheet: { properties: { title: 'Dashboard' } } }],
    includeSpreadsheetInResponse: true,
  },
});

// Get new sheet ID from reply
const newSheetId = response.data.replies[0].addSheet.properties.sheetId;

// Use in subsequent batch
await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [{ updateCells: { start: { sheetId: newSheetId /* ... */ } } }],
  },
});
```

---

## Performance Patterns

### Pattern: Chunk Large Data

```typescript
// Split large updates into chunks
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function writeInChunks(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  data: any[][],
  chunkSize = 1000
) {
  const chunks = chunkArray(data, chunkSize);

  for (let i = 0; i < chunks.length; i++) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateCells: {
              rows: chunks[i].map((row) => ({
                values: row.map((cell) => ({
                  userEnteredValue: { stringValue: String(cell) },
                })),
              })),
              start: {
                sheetId,
                rowIndex: i * chunkSize,
                columnIndex: 0,
              },
              fields: 'userEnteredValue',
            },
          },
        ],
      },
    });
  }
}
```

### Pattern: Parallel Batches for Independent Sheets

```typescript
// Update multiple independent sheets in parallel
async function updateMultipleSheets(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetUpdates: Array<{ sheetId: number; data: any[][] }>
) {
  // Create separate batch requests
  const batchRequests = sheetUpdates.map((update) => ({
    requests: [
      {
        updateCells: {
          rows: update.data.map((row) => ({
            values: row.map((cell) => ({
              userEnteredValue: { stringValue: String(cell) },
            })),
          })),
          start: { sheetId: update.sheetId, rowIndex: 0, columnIndex: 0 },
          fields: 'userEnteredValue',
        },
      },
    ],
  }));

  // Execute in parallel
  await Promise.all(
    batchRequests.map((requestBody) =>
      sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody })
    )
  );
}
```

### Pattern: Efficient Formatting with RepeatCell

```typescript
// Instead of formatting each cell individually
// ❌ Inefficient
const inefficient = {
  requests: data.map((_, i) => ({
    updateCells: {
      rows: [
        {
          values: [
            {
              userEnteredFormat: { textFormat: { bold: true } },
            },
          ],
        },
      ],
      start: { sheetId: 0, rowIndex: i, columnIndex: 0 },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  })),
};

// ✅ Efficient - single repeatCell
const efficient = {
  requests: [
    {
      repeatCell: {
        range: {
          sheetId: 0,
          startRowIndex: 0,
          endRowIndex: data.length,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: { textFormat: { bold: true } },
        },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
  ],
};
```

---

## Common Batch Recipes

### Recipe: Initialize Dashboard

```typescript
const initializeDashboard = (sheetId: number) => ({
  requests: [
    // Set up grid structure
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 2,
            hideGridlines: true,
          },
        },
        fields: 'gridProperties(frozenRowCount,hideGridlines)',
      },
    },
    // Create title
    {
      updateCells: {
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: 'Sales Dashboard' },
                userEnteredFormat: {
                  textFormat: { fontSize: 24, bold: true },
                  horizontalAlignment: 'CENTER',
                },
              },
            ],
          },
        ],
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        fields: 'userEnteredValue,userEnteredFormat',
      },
    },
    // Merge title cells
    {
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        mergeType: 'MERGE_ALL',
      },
    },
    // Set column widths
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 6 },
        properties: { pixelSize: 150 },
        fields: 'pixelSize',
      },
    },
  ],
});
```

### Recipe: Create Report Template

```typescript
const createReportTemplate = (sheetId: number) => ({
  requests: [
    // Headers
    {
      updateCells: {
        rows: [
          {
            values: ['Month', 'Revenue', 'Expenses', 'Profit', 'Margin %'].map((h) => ({
              userEnteredValue: { stringValue: h },
              userEnteredFormat: {
                backgroundColor: { red: 0.1, green: 0.2, blue: 0.4 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: 'CENTER',
              },
            })),
          },
        ],
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        fields: 'userEnteredValue,userEnteredFormat',
      },
    },
    // Data rows with formulas
    {
      updateCells: {
        rows: Array.from({ length: 12 }, (_, i) => ({
          values: [
            {
              userEnteredValue: {
                stringValue: new Date(2024, i, 1).toLocaleDateString('en-US', {
                  month: 'short',
                  year: 'numeric',
                }),
              },
            },
            { userEnteredValue: { numberValue: 0 } }, // Revenue input
            { userEnteredValue: { numberValue: 0 } }, // Expenses input
            { userEnteredValue: { formulaValue: `=B${i + 2}-C${i + 2}` } }, // Profit
            { userEnteredValue: { formulaValue: `=IF(B${i + 2}=0,0,D${i + 2}/B${i + 2})` } }, // Margin
          ],
        })),
        start: { sheetId, rowIndex: 1, columnIndex: 0 },
        fields: 'userEnteredValue',
      },
    },
    // Number formats
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 13,
          startColumnIndex: 1,
          endColumnIndex: 4,
        },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"$"#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 13,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    // Alternating row colors
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            { sheetId, startRowIndex: 1, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 5 },
          ],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=ISEVEN(ROW())' }] },
            format: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } },
          },
        },
        index: 0,
      },
    },
    // Totals row
    {
      updateCells: {
        rows: [
          {
            values: [
              { userEnteredValue: { stringValue: 'TOTAL' } },
              { userEnteredValue: { formulaValue: '=SUM(B2:B13)' } },
              { userEnteredValue: { formulaValue: '=SUM(C2:C13)' } },
              { userEnteredValue: { formulaValue: '=SUM(D2:D13)' } },
              { userEnteredValue: { formulaValue: '=IF(B14=0,0,D14/B14)' } },
            ],
          },
        ],
        start: { sheetId, rowIndex: 13, columnIndex: 0 },
        fields: 'userEnteredValue',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 13,
          endRowIndex: 14,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
            textFormat: { bold: true },
            borders: {
              top: { style: 'SOLID_MEDIUM', color: { red: 0, green: 0, blue: 0 } },
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,borders)',
      },
    },
  ],
});
```

### Recipe: Clean Up Sheet

```typescript
const cleanUpSheet = (sheetId: number) => ({
  requests: [
    // Clear all content
    {
      updateCells: {
        range: { sheetId },
        fields: 'userEnteredValue,userEnteredFormat,dataValidation,note',
      },
    },
    // Remove all merges
    {
      unmergeCells: {
        range: { sheetId },
      },
    },
    // Clear basic filter
    {
      clearBasicFilter: {
        sheetId,
      },
    },
    // Reset column widths
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 26 },
        properties: { pixelSize: 100 },
        fields: 'pixelSize',
      },
    },
    // Reset row heights
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 100 },
        properties: { pixelSize: 21 },
        fields: 'pixelSize',
      },
    },
  ],
});
```

---

## Error Handling

### Batch Error Response

```typescript
// Errors stop entire batch - all or nothing
{
  error: {
    code: 400,
    message: "Invalid requests[2].updateCells: Range out of bounds",
    status: "INVALID_ARGUMENT",
    details: [{
      "@type": "type.googleapis.com/google.rpc.BadRequest",
      fieldViolations: [{
        field: "requests[2].updateCells.range",
        description: "Range out of bounds",
      }],
    }],
  },
}
```

### Validation Before Batch

```typescript
function validateBatchRequest(requests: any[]): string[] {
  const errors: string[] = [];

  requests.forEach((req, i) => {
    const type = Object.keys(req)[0];
    const params = req[type];

    // Check for common issues
    if (params.range) {
      if (params.range.startRowIndex < 0) {
        errors.push(`Request ${i} (${type}): startRowIndex cannot be negative`);
      }
      if (params.range.endRowIndex <= params.range.startRowIndex) {
        errors.push(`Request ${i} (${type}): endRowIndex must be > startRowIndex`);
      }
    }

    // Validate color values
    if (params.cell?.userEnteredFormat?.backgroundColor) {
      const bg = params.cell.userEnteredFormat.backgroundColor;
      if (bg.red > 1 || bg.green > 1 || bg.blue > 1) {
        errors.push(`Request ${i} (${type}): Color values must be 0-1, not 0-255`);
      }
    }
  });

  return errors;
}
```

### Retry Strategy

```typescript
async function batchWithRetry(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  requests: any[],
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
    } catch (error: any) {
      if (error.code === 429) {
        // Rate limited - exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (error.code >= 500) {
        // Server error - retry
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw error; // Client error - don't retry
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Best Practices

### Do's

1. **Combine related operations** - One batch for sheet setup
2. **Order requests by dependency** - Create before reference
3. **Use repeatCell for bulk formatting** - Not individual updateCells
4. **Validate before sending** - Catch errors client-side
5. **Include response fields sparingly** - Only what you need
6. **Chunk large data** - Keep batches manageable

### Don'ts

1. **Don't exceed 500 requests** - Split into multiple batches
2. **Don't mix unrelated operations** - Harder to debug failures
3. **Don't ignore reply order** - Index matches request order
4. **Don't use 0-255 colors** - Always 0-1 scale
5. **Don't forget field masks** - Explicit updates only

### Request Size Guidelines

| Operation           | Recommended Limit |
| ------------------- | ----------------- |
| updateCells rows    | 1,000 per request |
| Formatting requests | 50 per batch      |
| Chart operations    | 10 per batch      |
| Total requests      | <100 per batch    |

---

_Source: Google Sheets API v4 Best Practices_
