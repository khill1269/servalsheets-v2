# Data Validation Patterns Complete Reference

> **API Version:** Google Sheets API v4  
> **Last Updated:** January 4, 2026  
> **Purpose:** Complete data validation rule catalog for ServalSheets

---

## Table of Contents

1. [Overview](#overview)
2. [Validation Types](#validation-types)
3. [Condition Types](#condition-types)
4. [Complete Examples](#complete-examples)
5. [Batch Operations](#batch-operations)
6. [Common Patterns](#common-patterns)

---

## Overview

### Data Validation Structure

```typescript
interface DataValidationRule {
  condition: BooleanCondition;
  inputMessage?: string; // Help text shown on cell focus
  strict?: boolean; // true = reject invalid, false = warning only
  showCustomUi?: boolean; // Show dropdown for lists
}

interface BooleanCondition {
  type: ConditionType;
  values?: ConditionValue[]; // Arguments for the condition
}

interface ConditionValue {
  userEnteredValue?: string; // Literal value or formula
  relativeDate?: RelativeDate; // For date conditions
}

type RelativeDate = 'PAST_YEAR' | 'PAST_MONTH' | 'PAST_WEEK' | 'YESTERDAY' | 'TODAY' | 'TOMORROW';
```

### SetDataValidation Request

```typescript
interface SetDataValidationRequest {
  range: GridRange;
  rule?: DataValidationRule; // Omit to clear validation
}

// Example
const request = {
  setDataValidation: {
    range: {
      sheetId: 0,
      startRowIndex: 1,
      endRowIndex: 100,
      startColumnIndex: 0,
      endColumnIndex: 1,
    },
    rule: {
      condition: {
        type: 'NUMBER_GREATER',
        values: [{ userEnteredValue: '0' }],
      },
      strict: true,
      inputMessage: 'Enter a positive number',
    },
  },
};
```

---

## Validation Types

### All Condition Types

| Type                     | Description               | Values Required |
| ------------------------ | ------------------------- | --------------- |
| `NUMBER_GREATER`         | > value                   | 1               |
| `NUMBER_GREATER_THAN_EQ` | >= value                  | 1               |
| `NUMBER_LESS`            | < value                   | 1               |
| `NUMBER_LESS_THAN_EQ`    | <= value                  | 1               |
| `NUMBER_EQ`              | = value                   | 1               |
| `NUMBER_NOT_EQ`          | ≠ value                   | 1               |
| `NUMBER_BETWEEN`         | Between min and max       | 2               |
| `NUMBER_NOT_BETWEEN`     | Not between min and max   | 2               |
| `TEXT_CONTAINS`          | Contains substring        | 1               |
| `TEXT_NOT_CONTAINS`      | Doesn't contain substring | 1               |
| `TEXT_STARTS_WITH`       | Starts with prefix        | 1               |
| `TEXT_ENDS_WITH`         | Ends with suffix          | 1               |
| `TEXT_EQ`                | Exact text match          | 1               |
| `TEXT_IS_EMAIL`          | Valid email format        | 0               |
| `TEXT_IS_URL`            | Valid URL format          | 0               |
| `DATE_EQ`                | Equals date               | 1               |
| `DATE_BEFORE`            | Before date               | 1               |
| `DATE_AFTER`             | After date                | 1               |
| `DATE_ON_OR_BEFORE`      | On or before date         | 1               |
| `DATE_ON_OR_AFTER`       | On or after date          | 1               |
| `DATE_BETWEEN`           | Between dates             | 2               |
| `DATE_NOT_BETWEEN`       | Not between dates         | 2               |
| `DATE_IS_VALID`          | Any valid date            | 0               |
| `ONE_OF_RANGE`           | Value in range            | 1 (range ref)   |
| `ONE_OF_LIST`            | Value in list             | N (list items)  |
| `BLANK`                  | Cell is empty             | 0               |
| `NOT_BLANK`              | Cell is not empty         | 0               |
| `CUSTOM_FORMULA`         | Custom formula            | 1 (formula)     |
| `BOOLEAN`                | Checkbox                  | 0               |

---

## Condition Types

### Number Validations

```typescript
// Greater than
const greaterThan: DataValidationRule = {
  condition: {
    type: 'NUMBER_GREATER',
    values: [{ userEnteredValue: '0' }],
  },
  strict: true,
  inputMessage: 'Value must be greater than 0',
};

// Greater than or equal
const greaterOrEqual: DataValidationRule = {
  condition: {
    type: 'NUMBER_GREATER_THAN_EQ',
    values: [{ userEnteredValue: '1' }],
  },
  strict: true,
};

// Less than
const lessThan: DataValidationRule = {
  condition: {
    type: 'NUMBER_LESS',
    values: [{ userEnteredValue: '100' }],
  },
  strict: true,
};

// Less than or equal
const lessOrEqual: DataValidationRule = {
  condition: {
    type: 'NUMBER_LESS_THAN_EQ',
    values: [{ userEnteredValue: '999' }],
  },
  strict: true,
};

// Equal to
const equalTo: DataValidationRule = {
  condition: {
    type: 'NUMBER_EQ',
    values: [{ userEnteredValue: '42' }],
  },
  strict: true,
};

// Not equal to
const notEqual: DataValidationRule = {
  condition: {
    type: 'NUMBER_NOT_EQ',
    values: [{ userEnteredValue: '0' }],
  },
  strict: true,
};

// Between (inclusive)
const between: DataValidationRule = {
  condition: {
    type: 'NUMBER_BETWEEN',
    values: [{ userEnteredValue: '1' }, { userEnteredValue: '100' }],
  },
  strict: true,
  inputMessage: 'Enter a number between 1 and 100',
};

// Not between
const notBetween: DataValidationRule = {
  condition: {
    type: 'NUMBER_NOT_BETWEEN',
    values: [{ userEnteredValue: '0' }, { userEnteredValue: '10' }],
  },
  strict: true,
};

// Reference another cell
const greaterThanCell: DataValidationRule = {
  condition: {
    type: 'NUMBER_GREATER',
    values: [{ userEnteredValue: '=A1' }], // Formula reference
  },
  strict: true,
};
```

### Text Validations

```typescript
// Contains text
const contains: DataValidationRule = {
  condition: {
    type: 'TEXT_CONTAINS',
    values: [{ userEnteredValue: '@' }],
  },
  strict: true,
  inputMessage: 'Text must contain @',
};

// Does not contain
const notContains: DataValidationRule = {
  condition: {
    type: 'TEXT_NOT_CONTAINS',
    values: [{ userEnteredValue: 'spam' }],
  },
  strict: true,
};

// Starts with
const startsWith: DataValidationRule = {
  condition: {
    type: 'TEXT_STARTS_WITH',
    values: [{ userEnteredValue: 'SKU-' }],
  },
  strict: true,
  inputMessage: 'Must start with SKU-',
};

// Ends with
const endsWith: DataValidationRule = {
  condition: {
    type: 'TEXT_ENDS_WITH',
    values: [{ userEnteredValue: '.com' }],
  },
  strict: true,
};

// Exact match
const exactMatch: DataValidationRule = {
  condition: {
    type: 'TEXT_EQ',
    values: [{ userEnteredValue: 'APPROVED' }],
  },
  strict: true,
};

// Valid email
const email: DataValidationRule = {
  condition: {
    type: 'TEXT_IS_EMAIL',
  },
  strict: true,
  inputMessage: 'Enter a valid email address',
};

// Valid URL
const url: DataValidationRule = {
  condition: {
    type: 'TEXT_IS_URL',
  },
  strict: true,
  inputMessage: 'Enter a valid URL',
};
```

### Date Validations

```typescript
// Specific date
const onDate: DataValidationRule = {
  condition: {
    type: 'DATE_EQ',
    values: [{ userEnteredValue: '2024-12-31' }],
  },
  strict: true,
};

// Before date
const beforeDate: DataValidationRule = {
  condition: {
    type: 'DATE_BEFORE',
    values: [{ userEnteredValue: '2024-01-01' }],
  },
  strict: true,
};

// After date
const afterDate: DataValidationRule = {
  condition: {
    type: 'DATE_AFTER',
    values: [{ userEnteredValue: '=TODAY()' }], // After today
  },
  strict: true,
  inputMessage: 'Date must be in the future',
};

// On or before
const onOrBefore: DataValidationRule = {
  condition: {
    type: 'DATE_ON_OR_BEFORE',
    values: [{ userEnteredValue: '=TODAY()' }],
  },
  strict: true,
};

// On or after
const onOrAfter: DataValidationRule = {
  condition: {
    type: 'DATE_ON_OR_AFTER',
    values: [{ userEnteredValue: '2024-01-01' }],
  },
  strict: true,
};

// Between dates
const betweenDates: DataValidationRule = {
  condition: {
    type: 'DATE_BETWEEN',
    values: [{ userEnteredValue: '2024-01-01' }, { userEnteredValue: '2024-12-31' }],
  },
  strict: true,
  inputMessage: 'Date must be in 2024',
};

// Any valid date
const validDate: DataValidationRule = {
  condition: {
    type: 'DATE_IS_VALID',
  },
  strict: true,
  inputMessage: 'Enter a valid date',
};

// Relative dates
const pastWeek: DataValidationRule = {
  condition: {
    type: 'DATE_AFTER',
    values: [{ relativeDate: 'PAST_WEEK' }],
  },
  strict: true,
};

const today: DataValidationRule = {
  condition: {
    type: 'DATE_EQ',
    values: [{ relativeDate: 'TODAY' }],
  },
  strict: true,
};
```

### List/Dropdown Validations

```typescript
// Static list (dropdown)
const staticList: DataValidationRule = {
  condition: {
    type: 'ONE_OF_LIST',
    values: [
      { userEnteredValue: 'High' },
      { userEnteredValue: 'Medium' },
      { userEnteredValue: 'Low' },
    ],
  },
  showCustomUi: true, // Show dropdown
  strict: true,
  inputMessage: 'Select priority level',
};

// List from range
const rangeList: DataValidationRule = {
  condition: {
    type: 'ONE_OF_RANGE',
    values: [{ userEnteredValue: '=Categories!A:A' }],
  },
  showCustomUi: true,
  strict: true,
};

// List from named range
const namedRangeList: DataValidationRule = {
  condition: {
    type: 'ONE_OF_RANGE',
    values: [{ userEnteredValue: '=StatusOptions' }], // Named range
  },
  showCustomUi: true,
  strict: true,
};

// Dynamic list based on another cell
const dependentList: DataValidationRule = {
  condition: {
    type: 'ONE_OF_RANGE',
    values: [{ userEnteredValue: '=INDIRECT(A1&"Options")' }],
  },
  showCustomUi: true,
  strict: true,
};

// Yes/No dropdown
const yesNo: DataValidationRule = {
  condition: {
    type: 'ONE_OF_LIST',
    values: [{ userEnteredValue: 'Yes' }, { userEnteredValue: 'No' }],
  },
  showCustomUi: true,
  strict: true,
};
```

### Checkbox Validation

```typescript
// Standard checkbox (TRUE/FALSE)
const checkbox: DataValidationRule = {
  condition: {
    type: 'BOOLEAN',
  },
};

// Custom checkbox values
const customCheckbox: DataValidationRule = {
  condition: {
    type: 'ONE_OF_LIST',
    values: [{ userEnteredValue: 'Complete' }, { userEnteredValue: 'Incomplete' }],
  },
  showCustomUi: false, // Renders as checkbox
};
```

### Blank/Not Blank

```typescript
// Required field (not blank)
const required: DataValidationRule = {
  condition: {
    type: 'NOT_BLANK',
  },
  strict: true,
  inputMessage: 'This field is required',
};

// Must be empty
const mustBeBlank: DataValidationRule = {
  condition: {
    type: 'BLANK',
  },
  strict: true,
};
```

### Custom Formula Validations

```typescript
// Custom formula (must return TRUE)
const customFormula: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=LEN(A1)<=50' }],
  },
  strict: true,
  inputMessage: 'Maximum 50 characters',
};

// Unique values in column
const unique: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=COUNTIF(A:A,A1)=1' }],
  },
  strict: true,
  inputMessage: 'Value must be unique',
};

// Phone number format
const phoneNumber: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=REGEXMATCH(A1,"^\\d{3}-\\d{3}-\\d{4}$")' }],
  },
  strict: true,
  inputMessage: 'Format: 000-000-0000',
};

// Age validation (18+)
const adultAge: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=AND(A1>=18,A1<=120)' }],
  },
  strict: true,
  inputMessage: 'Age must be 18 or older',
};

// Depends on another cell
const conditionalRequired: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=OR(B1<>"Yes",A1<>"")' }],
  },
  strict: true,
  inputMessage: 'Required when B is "Yes"',
};

// Sum validation
const budgetLimit: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=SUM($B$2:$B$10)<=10000' }],
  },
  strict: true,
  inputMessage: 'Total budget cannot exceed $10,000',
};

// Alphanumeric only
const alphanumeric: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=REGEXMATCH(A1,"^[A-Za-z0-9]+$")' }],
  },
  strict: true,
  inputMessage: 'Letters and numbers only',
};

// Decimal places limit
const twoDecimals: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=A1=ROUND(A1,2)' }],
  },
  strict: true,
  inputMessage: 'Maximum 2 decimal places',
};
```

---

## Complete Examples

### Form Validation Setup

```typescript
const formValidationRequests = [
  // Name: Required, max 100 chars
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      rule: {
        condition: {
          type: 'CUSTOM_FORMULA',
          values: [{ userEnteredValue: '=AND(A1<>"",LEN(A1)<=100)' }],
        },
        strict: true,
        inputMessage: 'Name is required (max 100 characters)',
      },
    },
  },

  // Email: Valid format
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 1,
        endColumnIndex: 2,
      },
      rule: {
        condition: { type: 'TEXT_IS_EMAIL' },
        strict: true,
        inputMessage: 'Enter a valid email address',
      },
    },
  },

  // Age: 18-120
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 2,
        endColumnIndex: 3,
      },
      rule: {
        condition: {
          type: 'NUMBER_BETWEEN',
          values: [{ userEnteredValue: '18' }, { userEnteredValue: '120' }],
        },
        strict: true,
        inputMessage: 'Age must be between 18 and 120',
      },
    },
  },

  // Status: Dropdown
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: 'Active' },
            { userEnteredValue: 'Inactive' },
            { userEnteredValue: 'Pending' },
          ],
        },
        showCustomUi: true,
        strict: true,
        inputMessage: 'Select status',
      },
    },
  },

  // Start Date: Today or future
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 4,
        endColumnIndex: 5,
      },
      rule: {
        condition: {
          type: 'DATE_ON_OR_AFTER',
          values: [{ userEnteredValue: '=TODAY()' }],
        },
        strict: true,
        inputMessage: 'Start date must be today or later',
      },
    },
  },

  // End Date: After Start Date
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 5,
        endColumnIndex: 6,
      },
      rule: {
        condition: {
          type: 'CUSTOM_FORMULA',
          values: [{ userEnteredValue: '=F1>E1' }],
        },
        strict: true,
        inputMessage: 'End date must be after start date',
      },
    },
  },

  // Amount: Positive number
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 6,
        endColumnIndex: 7,
      },
      rule: {
        condition: {
          type: 'NUMBER_GREATER',
          values: [{ userEnteredValue: '0' }],
        },
        strict: true,
        inputMessage: 'Amount must be positive',
      },
    },
  },

  // Checkbox: Confirmed
  {
    setDataValidation: {
      range: {
        sheetId: 0,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 7,
        endColumnIndex: 8,
      },
      rule: {
        condition: { type: 'BOOLEAN' },
      },
    },
  },
];
```

### Dependent Dropdowns

```typescript
// Setup for dependent dropdowns (Category -> Subcategory)

// Step 1: Create lookup sheet with categories and subcategories
// Sheet "Lookups":
// A1: Category    B1: Electronics    C1: Clothing    D1: Food
// A2: Phone       B2: Shirt          C2: Fruit
// A3: Laptop      B3: Pants          C3: Vegetable
// A4: Tablet      B4: Dress          C4: Meat

// Step 2: Create named ranges for each category
const namedRangeRequests = [
  {
    addNamedRange: {
      namedRange: {
        name: 'Electronics',
        range: {
          sheetId: 1,
          startRowIndex: 1,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
      },
    },
  },
  {
    addNamedRange: {
      namedRange: {
        name: 'Clothing',
        range: {
          sheetId: 1,
          startRowIndex: 1,
          endRowIndex: 4,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
      },
    },
  },
  {
    addNamedRange: {
      namedRange: {
        name: 'Food',
        range: {
          sheetId: 1,
          startRowIndex: 1,
          endRowIndex: 4,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
      },
    },
  },
];

// Step 3: Set validation for main category
const categoryValidation = {
  setDataValidation: {
    range: {
      sheetId: 0,
      startRowIndex: 1,
      endRowIndex: 100,
      startColumnIndex: 0,
      endColumnIndex: 1,
    },
    rule: {
      condition: {
        type: 'ONE_OF_LIST',
        values: [
          { userEnteredValue: 'Electronics' },
          { userEnteredValue: 'Clothing' },
          { userEnteredValue: 'Food' },
        ],
      },
      showCustomUi: true,
      strict: true,
    },
  },
};

// Step 4: Set dependent validation for subcategory
const subcategoryValidation = {
  setDataValidation: {
    range: {
      sheetId: 0,
      startRowIndex: 1,
      endRowIndex: 100,
      startColumnIndex: 1,
      endColumnIndex: 2,
    },
    rule: {
      condition: {
        type: 'ONE_OF_RANGE',
        values: [{ userEnteredValue: '=INDIRECT(A1)' }], // Dynamic reference
      },
      showCustomUi: true,
      strict: true,
    },
  },
};
```

---

## Batch Operations

### Clear Validation

```typescript
// Clear validation from range
const clearValidation = {
  setDataValidation: {
    range: {
      sheetId: 0,
      startRowIndex: 0,
      endRowIndex: 100,
      startColumnIndex: 0,
      endColumnIndex: 10,
    },
    // Omit rule to clear
  },
};
```

### Copy Validation

```typescript
// Copy validation using copyPaste
const copyValidation = {
  copyPaste: {
    source: {
      sheetId: 0,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 5,
    },
    destination: {
      sheetId: 0,
      startRowIndex: 1,
      endRowIndex: 100,
      startColumnIndex: 0,
      endColumnIndex: 5,
    },
    pasteType: 'PASTE_DATA_VALIDATION',
    pasteOrientation: 'NORMAL',
  },
};
```

### Batch Set Multiple Validations

```typescript
async function setValidations(
  spreadsheetId: string,
  validations: Array<{ range: GridRange; rule: DataValidationRule }>
): Promise<void> {
  const requests = validations.map((v) => ({
    setDataValidation: {
      range: v.range,
      rule: v.rule,
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}
```

---

## Common Patterns

### Pattern: Percentage (0-100)

```typescript
const percentage: DataValidationRule = {
  condition: {
    type: 'NUMBER_BETWEEN',
    values: [{ userEnteredValue: '0' }, { userEnteredValue: '100' }],
  },
  strict: true,
  inputMessage: 'Enter percentage (0-100)',
};
```

### Pattern: Currency (Positive)

```typescript
const currency: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=AND(A1>=0,A1=ROUND(A1,2))' }],
  },
  strict: true,
  inputMessage: 'Enter positive amount (max 2 decimals)',
};
```

### Pattern: ZIP Code (US)

```typescript
const zipCode: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=REGEXMATCH(TEXT(A1,"@"),"^\\d{5}(-\\d{4})?$")' }],
  },
  strict: true,
  inputMessage: 'Enter valid ZIP code (12345 or 12345-6789)',
};
```

### Pattern: SKU Format

```typescript
const sku: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=REGEXMATCH(A1,"^[A-Z]{3}-\\d{4}-[A-Z]$")' }],
  },
  strict: true,
  inputMessage: 'Format: ABC-1234-X',
};
```

### Pattern: No Duplicates in Column

```typescript
const noDuplicates: DataValidationRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=COUNTIF(A:A,A1)<=1' }],
  },
  strict: true,
  inputMessage: 'Value must be unique in column',
};
```

### Pattern: Rating (1-5 Stars)

```typescript
const rating: DataValidationRule = {
  condition: {
    type: 'ONE_OF_LIST',
    values: [
      { userEnteredValue: '⭐' },
      { userEnteredValue: '⭐⭐' },
      { userEnteredValue: '⭐⭐⭐' },
      { userEnteredValue: '⭐⭐⭐⭐' },
      { userEnteredValue: '⭐⭐⭐⭐⭐' },
    ],
  },
  showCustomUi: true,
  strict: true,
};

// Or numeric 1-5
const numericRating: DataValidationRule = {
  condition: {
    type: 'NUMBER_BETWEEN',
    values: [{ userEnteredValue: '1' }, { userEnteredValue: '5' }],
  },
  strict: true,
  inputMessage: 'Rate 1-5',
};
```

### Pattern: Time Slot Selection

```typescript
const timeSlot: DataValidationRule = {
  condition: {
    type: 'ONE_OF_LIST',
    values: [
      { userEnteredValue: '9:00 AM' },
      { userEnteredValue: '10:00 AM' },
      { userEnteredValue: '11:00 AM' },
      { userEnteredValue: '12:00 PM' },
      { userEnteredValue: '1:00 PM' },
      { userEnteredValue: '2:00 PM' },
      { userEnteredValue: '3:00 PM' },
      { userEnteredValue: '4:00 PM' },
    ],
  },
  showCustomUi: true,
  strict: true,
};
```

---

_Source: Google Sheets API v4 Documentation_
