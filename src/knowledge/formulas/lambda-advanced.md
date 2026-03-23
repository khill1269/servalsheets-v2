# LAMBDA and Modern Array Functions

Google Sheets LAMBDA functions (2022+) enable custom reusable functions and functional-style array processing without Apps Script.

## LAMBDA — Define Reusable Functions

```
=LAMBDA(param1, param2, ..., formula)
```

Creates a named function when assigned to a Named Range. Can also be called immediately (IIFE style):

```
=LAMBDA(x, x^2)(5)          → 25 (immediately invoked)
```

**Named Range assignment (preferred)**:
In Named Ranges manager, name `DOUBLE` with formula `=LAMBDA(x, x*2)`.
Then use `=DOUBLE(A1)` anywhere.

### Limitations
- **No recursion** — LAMBDA cannot call itself by name
- **No side effects** — cannot write to other cells
- **No external references** — cannot reference cells inside LAMBDA body (only params)
- **50K cell performance limit** — applying over large arrays degrades significantly
- Parameter names must be identifiers (no spaces, no special chars)

---

## LET — Named Intermediate Values

```
=LET(name1, value1, name2, value2, ..., formula)
```

Avoids repeating expensive sub-expressions:

```
=LET(
  total, SUM(A1:A100),
  avg, AVERAGE(A1:A100),
  IF(total > 0, avg/total, 0)
)
```

- Up to 126 name/value pairs
- Values are computed once (not re-evaluated per reference)
- Names are local scope only — not visible outside LET
- **Best for**: complex formulas where sub-expressions appear 2+ times

---

## MAP — Apply Function Over Array

```
=MAP(array1, [array2, ...], LAMBDA(params, formula))
```

Applies LAMBDA to each element, returns same-shape array:

```
=MAP(A1:A10, LAMBDA(x, IF(x > 0, "positive", "negative")))
```

Multi-array MAP (arrays must be same size):
```
=MAP(A1:A10, B1:B10, LAMBDA(a, b, a * b))
```

---

## REDUCE — Accumulate Array to Scalar

```
=REDUCE(initial_value, array, LAMBDA(accumulator, current_value, formula))
```

```
=REDUCE(0, A1:A10, LAMBDA(acc, x, acc + IF(x > 0, x, 0)))
→ Sum of only positive values
```

**Pattern: Running product**
```
=REDUCE(1, A1:A5, LAMBDA(acc, x, acc * x))
```

---

## SCAN — Accumulate Array, Return Intermediate Values

```
=SCAN(initial_value, array, LAMBDA(accumulator, current_value, formula))
```

Like REDUCE but returns all intermediate accumulator values (running total):

```
=SCAN(0, A1:A10, LAMBDA(acc, x, acc + x))
→ Returns running sum array (same length as input)
```

---

## BYROW and BYCOL — Row/Column Aggregation

```
=BYROW(array, LAMBDA(row, formula))
=BYCOL(array, LAMBDA(col, formula))
```

Apply a function that receives a full row/column vector:

```
=BYROW(A1:D10, LAMBDA(row, SUM(row)))
→ Row sums (returns 10-element column)

=BYCOL(A1:D10, LAMBDA(col, AVERAGE(col)))
→ Column averages (returns 4-element row)
```

**Critical**: The LAMBDA receives an entire row/column as a range, so use aggregate functions (SUM, MAX, CONCATENATE, etc.) — not scalar operations.

---

## MAKEARRAY — Generate Array from Indices

```
=MAKEARRAY(rows, cols, LAMBDA(row_idx, col_idx, formula))
```

Row and column indices are 1-based:

```
=MAKEARRAY(5, 5, LAMBDA(r, c, r * c))
→ Multiplication table (5×5)

=MAKEARRAY(1, 12, LAMBDA(r, m, TEXT(DATE(2025, m, 1), "MMM")))
→ Month name row header
```

---

## ISOMITTED — Check for Optional Parameters

```
=LAMBDA(required, [optional], IF(ISOMITTED(optional), default, optional))
```

Use `[]` brackets around optional parameter names (documentation convention — Sheets doesn't enforce brackets, but ISOMITTED detects absence):

```
=LAMBDA(x, multiplier, IF(ISOMITTED(multiplier), x, x * multiplier))
```

---

## Common Patterns

### Pattern: Conditional Column Processing
```
=MAP(A2:A100, LAMBDA(val,
  LET(
    clean, TRIM(LOWER(val)),
    IF(clean = "", "unknown", clean)
  )
))
```

### Pattern: Pairwise Comparison
```
=MAP(A2:A100, B2:B100, LAMBDA(a, b,
  IF(ABS(a - b) < 0.01, "match", "mismatch")
))
```

### Pattern: Running Maximum
```
=SCAN(A1, A1:A20, LAMBDA(acc, x, MAX(acc, x)))
```

### Pattern: Custom SUMIF Logic
```
=REDUCE(0, A1:A20,
  LAMBDA(acc, x, acc + IF(x > 0, x^2, 0)))
→ Sum of squares of positive values
```

### Pattern: BYROW with Multi-Column Conditions
```
=BYROW(A2:C100, LAMBDA(row,
  IF(INDEX(row,,1) > 0, INDEX(row,,2) * INDEX(row,,3), 0)
))
```

---

## Performance Guidelines

| Row Count | LAMBDA Usage | Expected Performance |
|-----------|-------------|---------------------|
| < 1,000   | Any pattern  | < 100ms             |
| 1,000–10,000 | Simple MAP/SCAN | 100ms–1s       |
| 10,000–50,000 | Simple only | 1s–10s             |
| > 50,000  | Avoid LAMBDA | Use helper columns  |

**For large datasets**: Break into helper columns or use Google Apps Script.

---

## Named Function vs Named Range

- **Named Range** = cell reference alias (`Budget` → `Sheet1!B5:B20`)
- **Named Function** (via "Named Functions" in Data menu) = LAMBDA without explicit LAMBDA wrapper
  - Body uses parameter names directly
  - No `=LAMBDA(...)` needed in the body formula
  - Visible in formula autocomplete with description

```
Named Function: TAXED_PRICE
Parameters: price, rate
Formula: price * (1 + rate)

Usage: =TAXED_PRICE(A2, 0.08)
```
