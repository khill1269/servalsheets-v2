# Named Ranges & Protected Ranges Reference

> **API Version:** Google Sheets API v4  
> **Last Updated:** January 4, 2026  
> **Purpose:** Complete guide for named ranges and protection in ServalSheets

---

## Table of Contents

1. [Named Ranges](#named-ranges)
2. [Protected Ranges](#protected-ranges)
3. [Sheet Protection](#sheet-protection)
4. [Common Patterns](#common-patterns)

---

## Named Ranges

### Overview

Named ranges provide human-readable references to cell ranges, making formulas more readable and easier to maintain.

### Schema

```typescript
interface NamedRange {
  namedRangeId: string; // Unique ID (read-only, auto-generated)
  name: string; // Name (must be valid identifier)
  range: GridRange; // The range this name refers to
}

interface GridRange {
  sheetId: number;
  startRowIndex?: number; // 0-based, inclusive
  endRowIndex?: number; // 0-based, exclusive
  startColumnIndex?: number; // 0-based, inclusive
  endColumnIndex?: number; // 0-based, exclusive
}
```

### Naming Rules

| Rule                                      | Example           | Valid? |
| ----------------------------------------- | ----------------- | ------ |
| Must start with letter or underscore      | `Sales_2024`      | ✅     |
| Can contain letters, numbers, underscores | `Q1_Revenue`      | ✅     |
| Cannot start with number                  | `2024_Sales`      | ❌     |
| Cannot contain spaces                     | `Sales Data`      | ❌     |
| Cannot be cell reference                  | `A1`              | ❌     |
| Cannot be R1C1 notation                   | `R1C1`            | ❌     |
| Case insensitive (stored as entered)      | `SALES` = `sales` | ⚠️     |
| Max 250 characters                        | -                 | -      |

### Create Named Range

```typescript
const addNamedRange = {
  addNamedRange: {
    namedRange: {
      name: 'SalesData',
      range: {
        sheetId: 0,
        startRowIndex: 1, // Row 2 (skip header)
        endRowIndex: 101, // Row 101
        startColumnIndex: 0, // Column A
        endColumnIndex: 5, // Column E
      },
    },
  },
};

// Multiple named ranges in one request
const addMultipleNamedRanges = {
  requests: [
    {
      addNamedRange: {
        namedRange: {
          name: 'Revenue',
          range: { sheetId: 0, startColumnIndex: 3, endColumnIndex: 4 },
        },
      },
    },
    {
      addNamedRange: {
        namedRange: {
          name: 'Expenses',
          range: { sheetId: 0, startColumnIndex: 4, endColumnIndex: 5 },
        },
      },
    },
    {
      addNamedRange: {
        namedRange: {
          name: 'Profit',
          range: { sheetId: 0, startColumnIndex: 5, endColumnIndex: 6 },
        },
      },
    },
  ],
};
```

### Update Named Range

```typescript
const updateNamedRange = {
  updateNamedRange: {
    namedRange: {
      namedRangeId: 'existing-id-here', // Required
      name: 'UpdatedName', // New name (optional)
      range: {
        // New range (optional)
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 200,
        startColumnIndex: 0,
        endColumnIndex: 10,
      },
    },
    fields: 'name,range', // Specify which fields to update
  },
};

// Update only the range, keep the name
const updateRangeOnly = {
  updateNamedRange: {
    namedRange: {
      namedRangeId: 'existing-id',
      range: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 500, // Extended range
        startColumnIndex: 0,
        endColumnIndex: 10,
      },
    },
    fields: 'range',
  },
};
```

### Delete Named Range

```typescript
const deleteNamedRange = {
  deleteNamedRange: {
    namedRangeId: 'range-id-to-delete',
  },
};
```

### List Named Ranges

```typescript
// Named ranges are returned in spreadsheet metadata
const response = await sheets.spreadsheets.get({
  spreadsheetId: 'your-spreadsheet-id',
  fields: 'namedRanges',
});

// Response structure
interface SpreadsheetResponse {
  namedRanges: NamedRange[];
}

// Example response
{
  namedRanges: [
    {
      namedRangeId: 'abc123',
      name: 'SalesData',
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 101,
        startColumnIndex: 0,
        endColumnIndex: 5,
      },
    },
    {
      namedRangeId: 'def456',
      name: 'Revenue',
      range: {
        sheetId: 0,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
    },
  ],
}
```

### Using Named Ranges in Formulas

```typescript
// Write formula using named range
const writeFormula = {
  updateCells: {
    rows: [
      {
        values: [
          {
            userEnteredValue: {
              formulaValue: '=SUM(Revenue)', // Uses named range
            },
          },
        ],
      },
    ],
    start: { sheetId: 0, rowIndex: 0, columnIndex: 10 },
    fields: 'userEnteredValue',
  },
};

// Complex formula with named ranges
const complexFormula = {
  updateCells: {
    rows: [
      {
        values: [
          {
            userEnteredValue: {
              formulaValue: '=SUMIF(Categories,"Electronics",Revenue)',
            },
          },
        ],
      },
    ],
    start: { sheetId: 0, rowIndex: 0, columnIndex: 11 },
    fields: 'userEnteredValue',
  },
};
```

---

## Protected Ranges

### Overview

Protected ranges restrict who can edit specific cells. Two types:

1. **Range Protection**: Protects specific cells
2. **Sheet Protection**: Protects entire sheet with optional unprotected ranges

### Schema

```typescript
interface ProtectedRange {
  protectedRangeId?: number; // Auto-generated ID
  range?: GridRange; // Range to protect (for range protection)
  namedRangeId?: string; // Use named range instead of GridRange
  description?: string; // User-visible description
  warningOnly?: boolean; // Show warning vs block edits
  requestingUserCanEdit?: boolean; // Can the requesting user edit?
  unprotectedRanges?: GridRange[]; // Exceptions within protected sheet
  editors?: Editors; // Who can edit
}

interface Editors {
  users?: string[]; // Email addresses
  groups?: string[]; // Group email addresses
  domainUsersCanEdit?: boolean; // Anyone in domain can edit
}
```

### Add Protected Range

```typescript
// Basic protection - only owner can edit
const addBasicProtection = {
  addProtectedRange: {
    protectedRange: {
      range: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 1, // Protect header row
        startColumnIndex: 0,
        endColumnIndex: 10,
      },
      description: 'Header row - do not modify',
      warningOnly: false,
    },
  },
};

// Protection with specific editors
const addProtectionWithEditors = {
  addProtectedRange: {
    protectedRange: {
      range: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 100,
        startColumnIndex: 4, // Protect column E (formulas)
        endColumnIndex: 5,
      },
      description: 'Formula column - finance team only',
      editors: {
        users: ['finance@company.com', 'cfo@company.com'],
        groups: ['finance-team@company.com'],
      },
      warningOnly: false,
    },
  },
};

// Warning only (shows warning but allows edit)
const addWarningProtection = {
  addProtectedRange: {
    protectedRange: {
      range: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 10,
        startColumnIndex: 0,
        endColumnIndex: 5,
      },
      description: 'Important data - edit with caution',
      warningOnly: true,
    },
  },
};

// Protect using named range
const protectNamedRange = {
  addProtectedRange: {
    protectedRange: {
      namedRangeId: 'formula-cells-named-range-id',
      description: 'Protected formula cells',
      warningOnly: false,
    },
  },
};

// Domain-wide editing permission
const domainEditors = {
  addProtectedRange: {
    protectedRange: {
      range: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 50,
        startColumnIndex: 0,
        endColumnIndex: 10,
      },
      description: 'Company data - domain users can edit',
      editors: {
        domainUsersCanEdit: true, // Anyone in organization
      },
    },
  },
};
```

### Update Protected Range

```typescript
const updateProtection = {
  updateProtectedRange: {
    protectedRange: {
      protectedRangeId: 12345, // Required
      description: 'Updated description',
      editors: {
        users: ['new-user@company.com'],
      },
    },
    fields: 'description,editors',
  },
};

// Change from warning to blocking
const changeToBlocking = {
  updateProtectedRange: {
    protectedRange: {
      protectedRangeId: 12345,
      warningOnly: false,
    },
    fields: 'warningOnly',
  },
};

// Add editor to existing protection
const addEditor = {
  updateProtectedRange: {
    protectedRange: {
      protectedRangeId: 12345,
      editors: {
        users: [
          'existing@company.com',
          'new-editor@company.com', // Add this user
        ],
      },
    },
    fields: 'editors',
  },
};
```

### Delete Protected Range

```typescript
const deleteProtection = {
  deleteProtectedRange: {
    protectedRangeId: 12345,
  },
};
```

### List Protected Ranges

```typescript
// Protected ranges are in sheet properties
const response = await sheets.spreadsheets.get({
  spreadsheetId: 'your-spreadsheet-id',
  fields: 'sheets.protectedRanges',
});

// Response structure
{
  sheets: [{
    protectedRanges: [
      {
        protectedRangeId: 12345,
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
        description: 'Header protection',
        warningOnly: false,
        editors: {
          users: ['owner@company.com'],
        },
      },
    ],
  }],
}
```

---

## Sheet Protection

### Protect Entire Sheet

```typescript
// Protect entire sheet (no range specified = whole sheet)
const protectSheet = {
  addProtectedRange: {
    protectedRange: {
      range: {
        sheetId: 0, // Only sheetId, no row/column indices
      },
      description: 'Protected sheet - admins only',
      editors: {
        users: ['admin@company.com'],
      },
    },
  },
};
```

### Protect Sheet with Unprotected Ranges

```typescript
// Protect sheet but allow editing in specific areas
const protectSheetWithExceptions = {
  addProtectedRange: {
    protectedRange: {
      range: {
        sheetId: 0, // Protect entire sheet
      },
      description: 'Template sheet - only input cells editable',
      unprotectedRanges: [
        // Allow editing in these ranges
        {
          sheetId: 0,
          startRowIndex: 5,
          endRowIndex: 20,
          startColumnIndex: 1, // Column B
          endColumnIndex: 4, // Through Column D
        },
        {
          sheetId: 0,
          startRowIndex: 25,
          endRowIndex: 30,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
      ],
    },
  },
};
```

### Form-Style Protection Pattern

```typescript
// Common pattern: Protect everything except input cells
const formProtection = {
  requests: [
    // First, add named ranges for input cells
    {
      addNamedRange: {
        namedRange: {
          name: 'UserInputs',
          range: {
            sheetId: 0,
            startRowIndex: 5,
            endRowIndex: 15,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        },
      },
    },
    // Then protect entire sheet with unprotected input area
    {
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: 0 },
          description: 'Data entry form - only input cells editable',
          unprotectedRanges: [
            {
              sheetId: 0,
              startRowIndex: 5,
              endRowIndex: 15,
              startColumnIndex: 2,
              endColumnIndex: 3,
            },
          ],
        },
      },
    },
  ],
};
```

---

## Common Patterns

### Pattern: Dynamic Named Range

```typescript
// Create a named range that auto-expands
// (Use INDIRECT in formulas for truly dynamic behavior)

// Initial setup
const dynamicRange = {
  addNamedRange: {
    namedRange: {
      name: 'DataTable',
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000, // Set large initial size
        startColumnIndex: 0,
        endColumnIndex: 10,
      },
    },
  },
};

// Formula that uses dynamic lookup
// =OFFSET(DataTable,0,0,COUNTA(A:A),10)
```

### Pattern: Protect Formulas Only

```typescript
// Identify and protect all formula cells
// Step 1: Read to find formulas
// Step 2: Create protection for each formula range

const protectFormulaRanges = {
  requests: [
    {
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 100,
            startColumnIndex: 5, // Column F (formulas)
            endColumnIndex: 10, // Through Column J
          },
          description: 'Calculated columns - do not edit',
          warningOnly: true, // Allow override with warning
        },
      },
    },
  ],
};
```

### Pattern: Team-Based Permissions

```typescript
// Different teams can edit different sections
const teamPermissions = {
  requests: [
    // Sales team section
    {
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 50,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
          description: 'Sales data',
          editors: {
            groups: ['sales@company.com'],
          },
        },
      },
    },
    // Finance team section
    {
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 50,
            startColumnIndex: 5,
            endColumnIndex: 10,
          },
          description: 'Financial calculations',
          editors: {
            groups: ['finance@company.com'],
          },
        },
      },
    },
    // Header row - admin only
    {
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
          description: 'Headers - admin only',
          editors: {
            users: ['admin@company.com'],
          },
        },
      },
    },
  ],
};
```

### Pattern: Audit Log with Protection

```typescript
// Protected audit log that only system can write to
const auditLogSetup = {
  requests: [
    // Create named range for audit log
    {
      addNamedRange: {
        namedRange: {
          name: 'AuditLog',
          range: {
            sheetId: 1, // Separate sheet for audit
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
        },
      },
    },
    // Protect audit log - no editors (only owner/service account)
    {
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId: 1,
          },
          description: 'System audit log - read only',
          // Empty editors = only owner can edit
        },
      },
    },
  ],
};
```

### Pattern: Named Ranges for Data Validation

```typescript
// Create named ranges for dropdown sources
const dropdownSources = {
  requests: [
    {
      addNamedRange: {
        namedRange: {
          name: 'StatusOptions',
          range: {
            sheetId: 2, // Config sheet
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        },
      },
    },
    {
      addNamedRange: {
        namedRange: {
          name: 'CategoryOptions',
          range: {
            sheetId: 2,
            startRowIndex: 0,
            endRowIndex: 10,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        },
      },
    },
    {
      addNamedRange: {
        namedRange: {
          name: 'PriorityOptions',
          range: {
            sheetId: 2,
            startRowIndex: 0,
            endRowIndex: 4,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        },
      },
    },
    // Use in data validation
    // =StatusOptions, =CategoryOptions, =PriorityOptions
  ],
};
```

---

## Error Handling

### Common Errors

| Error                         | Cause                        | Solution                                   |
| ----------------------------- | ---------------------------- | ------------------------------------------ |
| `Invalid named range name`    | Name violates naming rules   | Use valid identifier                       |
| `Named range already exists`  | Duplicate name               | Use unique name or update existing         |
| `Named range not found`       | Invalid ID for update/delete | Get current list first                     |
| `Cannot edit protected range` | User lacks permission        | Add user to editors or use service account |
| `Invalid range`               | Range outside sheet bounds   | Check sheet dimensions                     |

### Error Response Examples

```typescript
// Duplicate named range error
{
  error: {
    code: 400,
    message: "Invalid requests[0].addNamedRange: A named range with the name 'SalesData' already exists.",
    status: 'INVALID_ARGUMENT',
  },
}

// Protection permission error
{
  error: {
    code: 403,
    message: "The caller does not have permission to edit the protected range.",
    status: 'PERMISSION_DENIED',
  },
}
```

---

_Source: Google Sheets API v4 Documentation_
