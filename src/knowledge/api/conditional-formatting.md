# Conditional Formatting Patterns Reference

> **API Version:** Google Sheets API v4  
> **Last Updated:** January 4, 2026  
> **Purpose:** Complete conditional formatting guide for ServalSheets

---

## Table of Contents

1. [Overview](#overview)
2. [Boolean Conditions](#boolean-conditions)
3. [Gradient Rules](#gradient-rules)
4. [Format Specifications](#format-specifications)
5. [Complete Examples](#complete-examples)
6. [Common Patterns](#common-patterns)

---

## Overview

### Conditional Format Rule Structure

```typescript
interface ConditionalFormatRule {
  ranges: GridRange[];
  booleanRule?: BooleanRule;
  gradientRule?: GradientRule;
}

interface BooleanRule {
  condition: BooleanCondition;
  format: CellFormat;
}

interface GradientRule {
  minpoint: InterpolationPoint;
  midpoint?: InterpolationPoint;
  maxpoint: InterpolationPoint;
}
```

### Add Conditional Format Request

```typescript
const request = {
  addConditionalFormatRule: {
    rule: {
      ranges: [
        {
          sheetId: 0,
          startRowIndex: 1,
          endRowIndex: 100,
          startColumnIndex: 0,
          endColumnIndex: 5,
        },
      ],
      booleanRule: {
        condition: {
          type: 'NUMBER_GREATER',
          values: [{ userEnteredValue: '100' }],
        },
        format: {
          backgroundColor: { red: 0.8, green: 1.0, blue: 0.8 },
          textFormat: { bold: true },
        },
      },
    },
    index: 0, // Rule priority (0 = highest)
  },
};
```

---

## Boolean Conditions

### All Condition Types

| Type                     | Description     | Values |
| ------------------------ | --------------- | ------ |
| `NUMBER_GREATER`         | > value         | 1      |
| `NUMBER_GREATER_THAN_EQ` | >= value        | 1      |
| `NUMBER_LESS`            | < value         | 1      |
| `NUMBER_LESS_THAN_EQ`    | <= value        | 1      |
| `NUMBER_EQ`              | = value         | 1      |
| `NUMBER_NOT_EQ`          | ≠ value         | 1      |
| `NUMBER_BETWEEN`         | Between values  | 2      |
| `NUMBER_NOT_BETWEEN`     | Not between     | 2      |
| `TEXT_CONTAINS`          | Contains text   | 1      |
| `TEXT_NOT_CONTAINS`      | Doesn't contain | 1      |
| `TEXT_STARTS_WITH`       | Starts with     | 1      |
| `TEXT_ENDS_WITH`         | Ends with       | 1      |
| `TEXT_EQ`                | Exact match     | 1      |
| `TEXT_IS_EMAIL`          | Is email        | 0      |
| `TEXT_IS_URL`            | Is URL          | 0      |
| `DATE_EQ`                | Equals date     | 1      |
| `DATE_BEFORE`            | Before date     | 1      |
| `DATE_AFTER`             | After date      | 1      |
| `DATE_ON_OR_BEFORE`      | On/before       | 1      |
| `DATE_ON_OR_AFTER`       | On/after        | 1      |
| `DATE_BETWEEN`           | Between dates   | 2      |
| `DATE_NOT_BETWEEN`       | Not between     | 2      |
| `DATE_IS_VALID`          | Valid date      | 0      |
| `BLANK`                  | Is empty        | 0      |
| `NOT_BLANK`              | Is not empty    | 0      |
| `CUSTOM_FORMULA`         | Formula = TRUE  | 1      |

### Number Conditions

```typescript
// Greater than
const greaterThan: BooleanRule = {
  condition: {
    type: 'NUMBER_GREATER',
    values: [{ userEnteredValue: '100' }],
  },
  format: {
    backgroundColor: { red: 0.8, green: 1.0, blue: 0.8 }, // Light green
  },
};

// Less than
const lessThan: BooleanRule = {
  condition: {
    type: 'NUMBER_LESS',
    values: [{ userEnteredValue: '0' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 }, // Light red
    textFormat: { foregroundColor: { red: 0.7, green: 0, blue: 0 } },
  },
};

// Between
const between: BooleanRule = {
  condition: {
    type: 'NUMBER_BETWEEN',
    values: [{ userEnteredValue: '50' }, { userEnteredValue: '100' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 1.0, blue: 0.8 }, // Light yellow
  },
};

// Equal to
const equalTo: BooleanRule = {
  condition: {
    type: 'NUMBER_EQ',
    values: [{ userEnteredValue: '0' }],
  },
  format: {
    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }, // Gray
    textFormat: { strikethrough: true },
  },
};

// Reference cell value
const greaterThanCell: BooleanRule = {
  condition: {
    type: 'NUMBER_GREATER',
    values: [{ userEnteredValue: '=$Z$1' }], // Reference threshold cell
  },
  format: {
    backgroundColor: { red: 0.8, green: 1.0, blue: 0.8 },
  },
};
```

### Text Conditions

```typescript
// Contains text
const containsError: BooleanRule = {
  condition: {
    type: 'TEXT_CONTAINS',
    values: [{ userEnteredValue: 'ERROR' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.6, blue: 0.6 },
    textFormat: { bold: true, foregroundColor: { red: 0.5, green: 0, blue: 0 } },
  },
};

// Starts with
const startsWithPrefix: BooleanRule = {
  condition: {
    type: 'TEXT_STARTS_WITH',
    values: [{ userEnteredValue: 'URGENT:' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.9, blue: 0.7 },
    textFormat: { bold: true },
  },
};

// Exact match
const exactMatch: BooleanRule = {
  condition: {
    type: 'TEXT_EQ',
    values: [{ userEnteredValue: 'Complete' }],
  },
  format: {
    backgroundColor: { red: 0.7, green: 0.9, blue: 0.7 },
    textFormat: { strikethrough: true },
  },
};

// Is email
const isEmail: BooleanRule = {
  condition: {
    type: 'TEXT_IS_EMAIL',
  },
  format: {
    textFormat: {
      foregroundColor: { red: 0, green: 0, blue: 0.8 },
      underline: true,
    },
  },
};
```

### Date Conditions

```typescript
// Past due (before today)
const pastDue: BooleanRule = {
  condition: {
    type: 'DATE_BEFORE',
    values: [{ relativeDate: 'TODAY' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 },
    textFormat: { bold: true },
  },
};

// Due today
const dueToday: BooleanRule = {
  condition: {
    type: 'DATE_EQ',
    values: [{ relativeDate: 'TODAY' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 1.0, blue: 0.7 },
  },
};

// Due this week
const dueThisWeek: BooleanRule = {
  condition: {
    type: 'DATE_BETWEEN',
    values: [{ relativeDate: 'TODAY' }, { userEnteredValue: '=TODAY()+7' }],
  },
  format: {
    backgroundColor: { red: 0.9, green: 0.95, blue: 1.0 },
  },
};

// Future dates
const futureDate: BooleanRule = {
  condition: {
    type: 'DATE_AFTER',
    values: [{ relativeDate: 'TODAY' }],
  },
  format: {
    textFormat: { italic: true },
  },
};
```

### Blank/Not Blank

```typescript
// Highlight empty cells
const isEmpty: BooleanRule = {
  condition: {
    type: 'BLANK',
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.95, blue: 0.9 },
  },
};

// Highlight filled cells
const isFilled: BooleanRule = {
  condition: {
    type: 'NOT_BLANK',
  },
  format: {
    backgroundColor: { red: 0.95, green: 1.0, blue: 0.95 },
  },
};
```

### Custom Formula Conditions

```typescript
// Entire row based on status column
const highlightRow: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=$C1="Complete"' }], // $ anchors column
  },
  format: {
    backgroundColor: { red: 0.9, green: 0.95, blue: 0.9 },
    textFormat: { strikethrough: true },
  },
};

// Alternating rows
const alternatingRows: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=MOD(ROW(),2)=0' }],
  },
  format: {
    backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
  },
};

// Duplicate values
const duplicates: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=COUNTIF(A:A,A1)>1' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.9, blue: 0.7 },
  },
};

// Unique values
const uniqueValues: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=COUNTIF(A:A,A1)=1' }],
  },
  format: {
    backgroundColor: { red: 0.9, green: 1.0, blue: 0.9 },
  },
};

// Max value in row
const maxInRow: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=A1=MAX($A1:$E1)' }],
  },
  format: {
    textFormat: { bold: true },
    backgroundColor: { red: 0.8, green: 1.0, blue: 0.8 },
  },
};

// Above average
const aboveAverage: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=A1>AVERAGE(A:A)' }],
  },
  format: {
    backgroundColor: { red: 0.8, green: 0.9, blue: 1.0 },
  },
};

// Top 10%
const topTenPercent: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=A1>=PERCENTILE(A:A,0.9)' }],
  },
  format: {
    backgroundColor: { red: 0.7, green: 1.0, blue: 0.7 },
    textFormat: { bold: true },
  },
};

// Contains formula error
const hasError: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=ISERROR(A1)' }],
  },
  format: {
    backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 },
    textFormat: { foregroundColor: { red: 0.8, green: 0, blue: 0 } },
  },
};

// Weekend dates
const isWeekend: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=OR(WEEKDAY(A1)=1,WEEKDAY(A1)=7)' }],
  },
  format: {
    backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
  },
};

// Cross-column comparison
const salesAboveTarget: BooleanRule = {
  condition: {
    type: 'CUSTOM_FORMULA',
    values: [{ userEnteredValue: '=$B1>=$C1' }], // Sales >= Target
  },
  format: {
    backgroundColor: { red: 0.8, green: 1.0, blue: 0.8 },
  },
};
```

---

## Gradient Rules

### Gradient Structure

```typescript
interface GradientRule {
  minpoint: InterpolationPoint;
  midpoint?: InterpolationPoint; // Optional middle point
  maxpoint: InterpolationPoint;
}

interface InterpolationPoint {
  color: Color;
  type: 'MIN' | 'MAX' | 'NUMBER' | 'PERCENT' | 'PERCENTILE';
  value?: string; // Required for NUMBER, PERCENT, PERCENTILE
}
```

### Two-Color Gradient

```typescript
// Simple min-max gradient
const twoColorGradient: GradientRule = {
  minpoint: {
    color: { red: 1.0, green: 0.8, blue: 0.8 }, // Light red
    type: 'MIN',
  },
  maxpoint: {
    color: { red: 0.8, green: 1.0, blue: 0.8 }, // Light green
    type: 'MAX',
  },
};

// Fixed value gradient
const fixedValueGradient: GradientRule = {
  minpoint: {
    color: { red: 1.0, green: 0.8, blue: 0.8 },
    type: 'NUMBER',
    value: '0',
  },
  maxpoint: {
    color: { red: 0.8, green: 1.0, blue: 0.8 },
    type: 'NUMBER',
    value: '100',
  },
};

// Percentile gradient
const percentileGradient: GradientRule = {
  minpoint: {
    color: { red: 1.0, green: 0.9, blue: 0.9 },
    type: 'PERCENTILE',
    value: '10', // 10th percentile
  },
  maxpoint: {
    color: { red: 0.9, green: 1.0, blue: 0.9 },
    type: 'PERCENTILE',
    value: '90', // 90th percentile
  },
};
```

### Three-Color Gradient

```typescript
// Red-Yellow-Green gradient
const trafficLightGradient: GradientRule = {
  minpoint: {
    color: { red: 0.96, green: 0.26, blue: 0.21 }, // Red
    type: 'MIN',
  },
  midpoint: {
    color: { red: 1.0, green: 0.92, blue: 0.23 }, // Yellow
    type: 'PERCENT',
    value: '50',
  },
  maxpoint: {
    color: { red: 0.26, green: 0.7, blue: 0.46 }, // Green
    type: 'MAX',
  },
};

// Blue-White-Red (for +/- values)
const divergingGradient: GradientRule = {
  minpoint: {
    color: { red: 0.26, green: 0.52, blue: 0.96 }, // Blue (negative)
    type: 'MIN',
  },
  midpoint: {
    color: { red: 1.0, green: 1.0, blue: 1.0 }, // White (zero)
    type: 'NUMBER',
    value: '0',
  },
  maxpoint: {
    color: { red: 0.96, green: 0.26, blue: 0.21 }, // Red (positive)
    type: 'MAX',
  },
};

// Cool-to-warm gradient
const temperatureGradient: GradientRule = {
  minpoint: {
    color: { red: 0.4, green: 0.6, blue: 0.9 }, // Cool blue
    type: 'NUMBER',
    value: '0',
  },
  midpoint: {
    color: { red: 0.95, green: 0.95, blue: 0.6 }, // Neutral yellow
    type: 'NUMBER',
    value: '50',
  },
  maxpoint: {
    color: { red: 0.9, green: 0.4, blue: 0.3 }, // Warm red
    type: 'NUMBER',
    value: '100',
  },
};
```

### Common Gradient Presets

```typescript
const GRADIENT_PRESETS = {
  // Performance (low=bad, high=good)
  performance: {
    minpoint: { color: { red: 0.96, green: 0.26, blue: 0.21 }, type: 'MIN' },
    midpoint: { color: { red: 1.0, green: 0.92, blue: 0.23 }, type: 'PERCENT', value: '50' },
    maxpoint: { color: { red: 0.26, green: 0.7, blue: 0.46 }, type: 'MAX' },
  },

  // Heat map (white to dark)
  heatmap: {
    minpoint: { color: { red: 1.0, green: 1.0, blue: 1.0 }, type: 'MIN' },
    maxpoint: { color: { red: 0.2, green: 0.4, blue: 0.8 }, type: 'MAX' },
  },

  // Progress (0-100%)
  progress: {
    minpoint: { color: { red: 0.95, green: 0.95, blue: 0.95 }, type: 'NUMBER', value: '0' },
    midpoint: { color: { red: 0.6, green: 0.8, blue: 0.6 }, type: 'NUMBER', value: '50' },
    maxpoint: { color: { red: 0.2, green: 0.7, blue: 0.3 }, type: 'NUMBER', value: '100' },
  },

  // Variance (negative to positive)
  variance: {
    minpoint: { color: { red: 0.96, green: 0.26, blue: 0.21 }, type: 'MIN' },
    midpoint: { color: { red: 1.0, green: 1.0, blue: 1.0 }, type: 'NUMBER', value: '0' },
    maxpoint: { color: { red: 0.26, green: 0.7, blue: 0.46 }, type: 'MAX' },
  },

  // Sequential blue
  sequentialBlue: {
    minpoint: { color: { red: 0.9, green: 0.95, blue: 1.0 }, type: 'MIN' },
    maxpoint: { color: { red: 0.1, green: 0.3, blue: 0.7 }, type: 'MAX' },
  },
};
```

---

## Format Specifications

### CellFormat Structure

```typescript
interface CellFormat {
  backgroundColor?: Color;
  backgroundColorStyle?: ColorStyle;
  borders?: Borders;
  padding?: Padding;
  horizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';
  verticalAlignment?: 'TOP' | 'MIDDLE' | 'BOTTOM';
  wrapStrategy?: 'OVERFLOW_CELL' | 'LEGACY_WRAP' | 'CLIP' | 'WRAP';
  textDirection?: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  textFormat?: TextFormat;
  hyperlinkDisplayType?: 'LINKED' | 'PLAIN_TEXT';
  textRotation?: TextRotation;
  numberFormat?: NumberFormat;
}

interface TextFormat {
  foregroundColor?: Color;
  foregroundColorStyle?: ColorStyle;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: Link;
}
```

### Format Examples

```typescript
// Success format
const successFormat: CellFormat = {
  backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 },
  textFormat: {
    foregroundColor: { red: 0.13, green: 0.55, blue: 0.13 },
    bold: true,
  },
};

// Warning format
const warningFormat: CellFormat = {
  backgroundColor: { red: 1.0, green: 0.98, blue: 0.8 },
  textFormat: {
    foregroundColor: { red: 0.8, green: 0.6, blue: 0 },
    bold: true,
  },
};

// Error format
const errorFormat: CellFormat = {
  backgroundColor: { red: 1.0, green: 0.9, blue: 0.9 },
  textFormat: {
    foregroundColor: { red: 0.7, green: 0.1, blue: 0.1 },
    bold: true,
  },
};

// Highlight format
const highlightFormat: CellFormat = {
  backgroundColor: { red: 1.0, green: 1.0, blue: 0.6 },
};

// Strikethrough (completed items)
const completedFormat: CellFormat = {
  textFormat: {
    strikethrough: true,
    foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 },
  },
};

// Bold with border
const headerFormat: CellFormat = {
  backgroundColor: { red: 0.2, green: 0.4, blue: 0.7 },
  textFormat: {
    foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
    bold: true,
  },
  borders: {
    bottom: {
      style: 'SOLID_MEDIUM',
      color: { red: 0.1, green: 0.2, blue: 0.4 },
    },
  },
};
```

---

## Complete Examples

### Status-Based Row Highlighting

```typescript
// Highlight entire rows based on status column (C)
const statusFormatting = [
  // Complete = green with strikethrough
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: '=$C1="Complete"' }],
          },
          format: {
            backgroundColor: { red: 0.9, green: 0.95, blue: 0.9 },
            textFormat: { strikethrough: true },
          },
        },
      },
      index: 0,
    },
  },
  // In Progress = yellow
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: '=$C1="In Progress"' }],
          },
          format: {
            backgroundColor: { red: 1.0, green: 0.98, blue: 0.85 },
          },
        },
      },
      index: 1,
    },
  },
  // Blocked = red
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: '=$C1="Blocked"' }],
          },
          format: {
            backgroundColor: { red: 1.0, green: 0.9, blue: 0.9 },
            textFormat: { bold: true },
          },
        },
      },
      index: 2,
    },
  },
];
```

### Financial Dashboard Formatting

```typescript
const financialFormatting = [
  // Positive variance = green
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 100,
            startColumnIndex: 4,
            endColumnIndex: 5,
          },
        ],
        booleanRule: {
          condition: {
            type: 'NUMBER_GREATER',
            values: [{ userEnteredValue: '0' }],
          },
          format: {
            textFormat: {
              foregroundColor: { red: 0.13, green: 0.55, blue: 0.13 },
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  },
  // Negative variance = red
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 100,
            startColumnIndex: 4,
            endColumnIndex: 5,
          },
        ],
        booleanRule: {
          condition: {
            type: 'NUMBER_LESS',
            values: [{ userEnteredValue: '0' }],
          },
          format: {
            textFormat: {
              foregroundColor: { red: 0.7, green: 0.1, blue: 0.1 },
              bold: true,
            },
          },
        },
      },
      index: 1,
    },
  },
  // Budget exceeded = red background
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 100,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: '=$C1>$D1' }], // Actual > Budget
          },
          format: {
            backgroundColor: { red: 1.0, green: 0.85, blue: 0.85 },
          },
        },
      },
      index: 2,
    },
  },
  // Performance gradient
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 100,
            startColumnIndex: 5,
            endColumnIndex: 6,
          },
        ],
        gradientRule: {
          minpoint: { color: { red: 0.96, green: 0.26, blue: 0.21 }, type: 'NUMBER', value: '0' },
          midpoint: { color: { red: 1.0, green: 0.92, blue: 0.23 }, type: 'NUMBER', value: '50' },
          maxpoint: { color: { red: 0.26, green: 0.7, blue: 0.46 }, type: 'NUMBER', value: '100' },
        },
      },
      index: 3,
    },
  },
];
```

### Data Quality Highlighting

```typescript
const dataQualityFormatting = [
  // Empty required cells
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 0,
            endColumnIndex: 1,
          }, // Name
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 2,
            endColumnIndex: 3,
          }, // Email
        ],
        booleanRule: {
          condition: { type: 'BLANK' },
          format: {
            backgroundColor: { red: 1.0, green: 0.9, blue: 0.8 },
          },
        },
      },
      index: 0,
    },
  },
  // Invalid email format
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue:
                  '=AND(C1<>"",NOT(REGEXMATCH(C1,"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$")))',
              },
            ],
          },
          format: {
            backgroundColor: { red: 1.0, green: 0.85, blue: 0.85 },
            textFormat: { foregroundColor: { red: 0.7, green: 0, blue: 0 } },
          },
        },
      },
      index: 1,
    },
  },
  // Duplicates
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 1000,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: '=COUNTIF(C:C,C1)>1' }],
          },
          format: {
            backgroundColor: { red: 1.0, green: 0.95, blue: 0.7 },
          },
        },
      },
      index: 2,
    },
  },
];
```

---

## Common Patterns

### Pattern: Traffic Light Status

```typescript
function trafficLightRules(range: GridRange, statusColumn: string) {
  return [
    { status: 'Green', color: { red: 0.8, green: 0.95, blue: 0.8 } },
    { status: 'Yellow', color: { red: 1.0, green: 0.98, blue: 0.8 } },
    { status: 'Red', color: { red: 1.0, green: 0.85, blue: 0.85 } },
  ].map((item, index) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [range],
        booleanRule: {
          condition: {
            type: 'TEXT_EQ',
            values: [{ userEnteredValue: item.status }],
          },
          format: { backgroundColor: item.color },
        },
      },
      index,
    },
  }));
}
```

### Pattern: Due Date Highlighting

```typescript
const dueDateRules = [
  // Overdue
  {
    condition: { type: 'DATE_BEFORE', values: [{ relativeDate: 'TODAY' }] },
    format: { backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 }, textFormat: { bold: true } },
  },
  // Due today
  {
    condition: { type: 'DATE_EQ', values: [{ relativeDate: 'TODAY' }] },
    format: { backgroundColor: { red: 1.0, green: 1.0, blue: 0.7 } },
  },
  // Due tomorrow
  {
    condition: { type: 'DATE_EQ', values: [{ relativeDate: 'TOMORROW' }] },
    format: { backgroundColor: { red: 1.0, green: 0.95, blue: 0.8 } },
  },
  // Due this week
  {
    condition: {
      type: 'CUSTOM_FORMULA',
      values: [{ userEnteredValue: '=AND(A1>TODAY(),A1<=TODAY()+7)' }],
    },
    format: { backgroundColor: { red: 0.9, green: 0.95, blue: 1.0 } },
  },
];
```

### Pattern: Percentage Thresholds

```typescript
function percentageThresholds(range: GridRange) {
  return [
    { min: 90, color: { red: 0.8, green: 0.95, blue: 0.8 } }, // 90%+ = green
    { min: 70, color: { red: 1.0, green: 0.98, blue: 0.8 } }, // 70-89% = yellow
    { min: 50, color: { red: 1.0, green: 0.9, blue: 0.8 } }, // 50-69% = orange
    { min: 0, color: { red: 1.0, green: 0.85, blue: 0.85 } }, // <50% = red
  ].map((threshold, index) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [range],
        booleanRule: {
          condition: {
            type: 'NUMBER_GREATER_THAN_EQ',
            values: [{ userEnteredValue: String(threshold.min) }],
          },
          format: { backgroundColor: threshold.color },
        },
      },
      index, // Higher index = lower priority
    },
  }));
}
```

### Pattern: Checklist Progress

```typescript
// Checkbox column with progress gradient
const checklistFormatting = {
  // Checked items
  checkedFormat: {
    condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'TRUE' }] },
    format: {
      backgroundColor: { red: 0.9, green: 0.95, blue: 0.9 },
      textFormat: { strikethrough: true },
    },
  },
  // Unchecked items
  uncheckedFormat: {
    condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'FALSE' }] },
    format: {
      backgroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
    },
  },
};
```

---

## Batch Operations

### Clear Conditional Formatting

```typescript
// Delete all conditional format rules from a sheet
const clearAllRules = {
  deleteConditionalFormatRule: {
    sheetId: 0,
    // Omit index to delete all, or specify index for specific rule
  },
};

// Delete specific rule by index
const deleteSpecificRule = {
  deleteConditionalFormatRule: {
    sheetId: 0,
    index: 0, // Delete first rule
  },
};
```

### Update Rule Priority

```typescript
// Move rule to different priority
const updateRulePriority = {
  updateConditionalFormatRule: {
    rule: existingRule, // The rule to update
    index: 0, // New priority (0 = highest)
    newIndex: 5, // Move to lower priority
  },
};
```

---

_Source: Google Sheets API v4 Documentation_
