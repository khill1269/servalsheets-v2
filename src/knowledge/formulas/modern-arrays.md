# Modern Array Formulas & Dynamic Arrays in Google Sheets

## Dynamic Array Functions (Spill Ranges)

Google Sheets supports dynamic array formulas that automatically spill results into adjacent cells. Use `sheets_data.detect_spill_ranges` to locate them.

### FILTER — Conditional Array Extraction

```
=FILTER(range, condition1, [condition2], ...)
```

**Examples:**

```
=FILTER(A2:C100, B2:B100="Active")
=FILTER(A2:C100, (B2:B100="Active")*(C2:C100>1000))
```

**Use case:** Return only rows where status is Active AND revenue > 1000.

---

### SORT / SORTBY — Sort Arrays

```
=SORT(range, [sort_column], [ascending], ...)
=SORTBY(range, sort_array1, [sort_order1], ...)
```

**Examples:**

```
=SORT(A2:C100, 2, FALSE)              // Sort by column B, descending
=SORTBY(A2:C100, B2:B100, -1, C2:C100, 1)  // Multi-column sort
```

---

### UNIQUE — Deduplicate

```
=UNIQUE(range, [by_column], [exactly_once])
```

**Examples:**

```
=UNIQUE(A2:A100)                      // Unique values in column A
=UNIQUE(A2:C100)                      // Unique rows across 3 columns
=UNIQUE(A2:A100, FALSE, TRUE)         // Values appearing exactly once
```

---

### SEQUENCE — Number Series

```
=SEQUENCE(rows, [columns], [start], [step])
```

**Examples:**

```
=SEQUENCE(10)                         // 1 to 10 vertically
=SEQUENCE(1, 12, 1, 1)               // 1 to 12 horizontally (months)
=SEQUENCE(5, 5)                       // 5x5 grid of sequential numbers
```

---

### XLOOKUP — Flexible Lookup (replaces VLOOKUP)

```
=XLOOKUP(search_key, lookup_range, result_range, [if_not_found], [match_mode], [search_mode])
```

**Parameters:**

- `match_mode`: 0=exact, -1=next smaller, 1=next larger, 2=wildcard
- `search_mode`: 1=first-to-last, -1=last-to-first, 2=binary asc, -2=binary desc

**Examples:**

```
=XLOOKUP(D2, A2:A100, B2:B100)                    // Basic: find D2 in A, return B
=XLOOKUP(D2, A2:A100, B2:D100)                    // Return multiple columns
=XLOOKUP(D2, A2:A100, B2:B100, "Not found")       // With fallback
=XLOOKUP(D2, A2:A100, B2:B100, , -1)              // Approximate match (next smaller)
```

**vs VLOOKUP:**

- XLOOKUP can search left-to-right OR right-to-left
- Returns the entire matched row when result_range spans multiple columns
- No column index number (less brittle when inserting columns)
- Handles missing values natively

---

### XMATCH — Position Lookup

```
=XMATCH(search_key, lookup_range, [match_mode], [search_mode])
```

**Examples:**

```
=XMATCH("Smith", A2:A100)            // Position of "Smith" in range
=XMATCH(MAX(B2:B100), B2:B100)       // Position of maximum value
```

---

### BYROW / BYCOL — Row/Column Iteration

```
=BYROW(array, LAMBDA(row, formula))
=BYCOL(array, LAMBDA(col, formula))
```

**Examples:**

```
=BYROW(A2:C10, LAMBDA(row, SUM(row)))           // Sum each row
=BYCOL(A2:J10, LAMBDA(col, AVERAGE(col)))        // Average each column
=BYROW(A2:C10, LAMBDA(row, TEXTJOIN(", ",TRUE,row)))  // Join each row
```

---

## Named Functions (LAMBDA-based Custom Functions)

Named Functions let you define reusable formulas with custom names. ServalSheets currently exposes named-function actions for compatibility, but the live Google Sheets API surface does not support creating or listing them reliably through this server path. Create them in the Google Sheets UI instead.

### Creating a Named Function

```
Function name: PROFIT_MARGIN
Parameters: revenue, cost
Body: LAMBDA(revenue, cost, (revenue-cost)/revenue)
```

**Usage in sheet:** `=PROFIT_MARGIN(B2, C2)`

### More Examples

```
// Convert Celsius to Fahrenheit
Name: TO_FAHRENHEIT
Body: LAMBDA(celsius, celsius * 9/5 + 32)

// Calculate compound interest
Name: COMPOUND_INTEREST
Body: LAMBDA(principal, rate, periods, principal * (1 + rate)^periods)

// Extract domain from email
Name: EMAIL_DOMAIN
Body: LAMBDA(email, MID(email, FIND("@", email)+1, LEN(email)))

// Weighted average
Name: WAVG
Body: LAMBDA(values, weights, SUMPRODUCT(values, weights) / SUM(weights))
```

### LET — Variable Binding (Intermediate Variables)

```
=LET(name1, value1, [name2, value2, ...], formula)
```

**Example:**

```
=LET(
  revenue, B2,
  cost, C2,
  margin, (revenue-cost)/revenue,
  IF(margin > 0.3, "High", IF(margin > 0.1, "Medium", "Low"))
)
```

---

## Spill Range Interactions with Tables

- **Dynamic arrays + Tables**: Google Sheets tables (created via `sheets_advanced.create_table`) automatically expand when a spill formula is placed adjacent to a table
- **Spill blocking**: If a cell in the spill range is non-empty, the formula returns a `#SPILL!` error
- **Referencing spill ranges**: Use `A1#` syntax to reference an entire spill range starting at A1
- **Use `detect_spill_ranges`** to find existing spill formulas before restructuring data

---

## Performance Considerations

| Formula         | Best For                        | Avoid When                                      |
| --------------- | ------------------------------- | ----------------------------------------------- |
| XLOOKUP         | Most lookups, replacing VLOOKUP | Legacy compatibility required                   |
| FILTER          | Conditional row extraction      | >100K rows (use BigQuery)                       |
| UNIQUE          | Deduplication up to 50K rows    | Extremely large datasets                        |
| BYROW/BYCOL     | Row/col aggregations            | Simple SUM/AVERAGE (use array formulas instead) |
| SEQUENCE        | Generating number/date series   | Static data                                     |
| Named Functions | Reusable complex formulas       | Simple one-time calculations                    |

## Formula Builder via sheets_analyze.generate_formula

Use `sheets_analyze` with `action: "generate_formula"` and `formulaType` to get AI-generated modern formulas:

```json
{
  "action": "generate_formula",
  "spreadsheetId": "...",
  "description": "Look up customer name by ID and return their purchase total",
  "formulaType": "xlookup",
  "range": "Sheet1!A1:D100",
  "targetCell": "F2"
}
```

Available `formulaType` values:

- `auto` — AI chooses the best formula type
- `xlookup` — Flexible lookup replacing VLOOKUP/HLOOKUP
- `xmatch` — Position-based matching
- `filter_array` — Conditional array extraction
- `unique` — Deduplication
- `sort_array` — Sorted arrays
- `sequence` — Number/date series
- `let_formula` — Variable binding for complex calculations
- `lambda` — Reusable function definition
- `byrow` / `bycol` — Row/column iteration
