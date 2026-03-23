# Array Formulas and Legacy Array Functions

## ARRAYFORMULA

Applies a formula to every row/column in a range without entering it into each cell.

```
=ARRAYFORMULA(formula)
```

Enter with Ctrl+Shift+Enter (on Mac: Cmd+Shift+Enter) which automatically adds `ARRAYFORMULA()`.

### Basic Usage

```
=ARRAYFORMULA(A2:A100 * B2:B100)           -- Row-by-row multiplication
=ARRAYFORMULA(IF(A2:A100 > 0, "Y", "N"))   -- Row-by-row IF
=ARRAYFORMULA(LEN(A2:A100))                 -- Length of each cell
```

### When to Use vs Modern Alternatives

| Scenario | ARRAYFORMULA | Modern Alternative |
|----------|-------------|-------------------|
| Row-by-row calculation | ARRAYFORMULA | MAP (cleaner) |
| Conditional per row | ARRAYFORMULA(IF) | MAP + IF |
| Running totals | ARRAYFORMULA + SCAN-like | SCAN |
| Vertical lookup | ARRAYFORMULA(VLOOKUP) | XLOOKUP or MAP+XLOOKUP |

ARRAYFORMULA is compatible with older spreadsheets and does not require the modern function set.

### Performance Note
- ARRAYFORMULA on 50K+ rows recalculates for the entire range on any data change
- For large ranges: consider breaking into batches or using Apps Script

### Limitations
- Cannot span multiple sheets in one formula
- Some functions don't work in array context (e.g., `VLOOKUP` with multiple results requires workarounds)
- Cannot use functions with side effects

---

## TEXT Functions in Array Context

```
=ARRAYFORMULA(TEXT(A2:A100, "yyyy-MM-dd"))  -- Format dates as strings
=ARRAYFORMULA(TRIM(LOWER(B2:B100)))          -- Clean text column
=ARRAYFORMULA(SUBSTITUTE(C2:C100, "-", "")) -- Strip dashes
```

---

## FILTER Function

`FILTER` is the modern replacement for complex array-in-ARRAYFORMULA patterns:

```
=FILTER(range, condition1, [condition2, ...])
```

```
=FILTER(A2:D100, B2:B100 = "Active")           -- Single condition
=FILTER(A2:D100, B2:B100 > 0, C2:C100 <> "")  -- AND conditions (multiple args)
=FILTER(A2:D100, (B2:B100="X")+(C2:C100="Y"))  -- OR conditions (add booleans)
```

**FILTER returns a dynamic range** — automatically resizes as data changes. Never reference a fixed range that might be too small for FILTER results.

---

## REGEXMATCH, REGEXEXTRACT, REGEXREPLACE

### REGEXMATCH — Test against regex pattern
```
=REGEXMATCH(text, regex)  → TRUE/FALSE
```

```
=REGEXMATCH(A2, "^\d{5}(-\d{4})?$")     -- ZIP code format
=ARRAYFORMULA(REGEXMATCH(A2:A100, "@"))  -- Contains @ symbol
```

### REGEXEXTRACT — Extract first match
```
=REGEXEXTRACT(text, regex)  → matched string or error
```

```
=REGEXEXTRACT("Order #12345", "\d+")        → "12345"
=REGEXEXTRACT(A2, "[a-z]+@[a-z]+\.[a-z]+") -- Extract email
```

Use groups for specific capture:
```
=REGEXEXTRACT("John Smith <john@example.com>", "<(.+)>")  → "john@example.com"
```

If no match: returns `#N/A`. Wrap in IFERROR:
```
=IFERROR(REGEXEXTRACT(A2, pattern), "")
```

### REGEXREPLACE — Replace pattern
```
=REGEXREPLACE(text, regex, replacement)
```

```
=REGEXREPLACE(A2, "\s+", " ")           -- Collapse whitespace
=REGEXREPLACE(A2, "[^0-9]", "")        -- Strip non-digits
=REGEXREPLACE(A2, "(\w+) (\w+)", "$2, $1")  -- "First Last" → "Last, First"
```

### REGEXMATCH in ARRAYFORMULA
```
=ARRAYFORMULA(IF(REGEXMATCH(A2:A100, "pattern"), "match", "no match"))
=FILTER(A2:B100, REGEXMATCH(A2:A100, "^[A-Z]"))  -- Rows starting with uppercase
```

---

## SORT and SORTN

```
=SORT(range, [sort_column], [ascending], [col2], [asc2], ...)
```

```
=SORT(A2:D100, 2, TRUE)                -- Sort by column B, ascending
=SORT(A2:D100, 3, FALSE, 2, TRUE)      -- Sort by C desc, then B asc
```

**SORTN** — Sort and return top N rows:
```
=SORTN(range, n, [ties_mode], [sort_column], [ascending])
```

```
=SORTN(A2:C100, 5, 0, 3, FALSE)  -- Top 5 by column C descending
```

---

## UNIQUE

```
=UNIQUE(range, [by_column], [exactly_once])
```

```
=UNIQUE(A2:A100)               -- Unique values in column A
=UNIQUE(A2:C100)               -- Unique rows across 3 columns
=UNIQUE(A2:C100, TRUE)         -- Unique columns (transpose orientation)
=UNIQUE(A2:A100, FALSE, TRUE)  -- Only values that appear exactly once
```

---

## Dynamic Array Spill

Modern Google Sheets array functions **automatically spill** results into adjacent cells. If cells are occupied, you get a `#SPILL!` error.

```
-- If UNIQUE would output to A2:A20, those cells must be empty
=UNIQUE(B2:B100)   -- Auto-fills A2:A20 (or however many unique values)
```

Reference the entire spill range with `A2#` (spill reference operator):
```
=COUNTA(A2#)           -- Count of spilled values
=SORT(A2#)             -- Sort the spill range
```

---

## XLOOKUP (Modern VLOOKUP Replacement)

```
=XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])
```

```
=XLOOKUP(A2, CustomerID!A:A, CustomerID!B:B, "Unknown")
```

- No column index needed (reference the return column directly)
- Works in any direction (not just left-to-right like VLOOKUP)
- Default: exact match
- `match_mode`: 0=exact, -1=exact or smaller, 1=exact or larger, 2=wildcard
- `search_mode`: 1=first-to-last, -1=last-to-first, 2=binary ascending, -2=binary descending

### Array Context
```
=ARRAYFORMULA(XLOOKUP(A2:A100, Lookup!A:A, Lookup!C:C, "N/A"))
```

---

## Common Patterns

### Pattern: Running Count of Unique
```
=COUNTA(UNIQUE(A2:A100))
```

### Pattern: Deduplicate and Sort
```
=SORT(UNIQUE(A2:A100))
```

### Pattern: Extract Rows Where Column Matches List
```
=FILTER(A2:D100, COUNTIF(AllowedList, B2:B100) > 0)
```

### Pattern: Conditional Running Sum
```
=ARRAYFORMULA(MMULT((ROW(A$2:A100) >= TRANSPOSE(ROW(A$2:A100))) * (B$2:B100 > 0), B$2:B100))
```
(Heavy — prefer SCAN for large ranges)

### Pattern: Dynamic Header Row
```
=ARRAYFORMULA(IFERROR(IF(A2:A100 <> "", "Row " & ROW(A2:A100) - 1, ""), ""))
```
