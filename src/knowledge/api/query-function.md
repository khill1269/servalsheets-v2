# QUERY Function — Complete GQL Reference

The QUERY function uses Google's Visualization Query Language (GQL), a SQL-like syntax for in-sheet data transformation.

```
=QUERY(data, query, [headers])
```

- `data`: Range (e.g. `A1:E100`) or array
- `query`: GQL string (case-sensitive keywords in UPPERCASE)
- `headers`: Number of header rows to treat as labels (default: auto-detect)

---

## Column References

Columns are referenced by letter position: `Col1`, `Col2`, ... or `A`, `B`, `C`, ...

```
=QUERY(A1:D10, "SELECT A, C WHERE B > 100")
```

**Important**: Use letter identifiers (`A`, `B`) not column names from headers. If you want to use header names, wrap QUERY in a named range or use the `label` clause.

---

## SELECT Clause

```sql
SELECT *                    -- all columns
SELECT A, C, D              -- specific columns
SELECT A, SUM(B)            -- column + aggregate
SELECT A, B, SUM(C) GROUP BY A, B  -- required when mixing
```

### Aggregate Functions
- `SUM(col)` — numeric only
- `AVG(col)` — numeric only
- `COUNT(col)` — counts non-null
- `MAX(col)` — numeric or date
- `MIN(col)` — numeric or date

---

## WHERE Clause

```sql
WHERE B > 100
WHERE C = 'Status'          -- string literals use single quotes
WHERE A IS NOT NULL
WHERE B >= 50 AND C < 100
WHERE A STARTS WITH 'Project'
WHERE B MATCHES '.*pattern.*'   -- regex
WHERE B CONTAINS 'text'         -- substring
WHERE A IN ('opt1', 'opt2')
WHERE A NOT IN ('skip1')
WHERE B BETWEEN 10 AND 100
```

### Date/DateTime Literals
```sql
WHERE A > date '2024-01-01'          -- ISO format
WHERE A > datetime '2024-01-15 09:00:00'
WHERE A > time '14:30:00'
```

**Critical**: Must use `date`, `datetime`, or `time` keyword before the string literal. Plain strings do NOT work for date comparisons.

---

## GROUP BY

```sql
SELECT A, SUM(B) GROUP BY A
SELECT A, B, COUNT(C) GROUP BY A, B
```

All non-aggregate columns in SELECT must appear in GROUP BY.

**No HAVING clause** — filter aggregates using outer QUERY or helper column:
```
=QUERY(QUERY(A1:C100, "SELECT A, SUM(B) GROUP BY A"), "WHERE Col2 > 100")
```

---

## PIVOT

```sql
SELECT A, SUM(C) GROUP BY A PIVOT B
```

Creates a cross-tabulation: unique values of B become column headers.

**Limitation**: PIVOT values must be known/finite. Dynamic pivoting on high-cardinality columns generates too many columns.

---

## ORDER BY

```sql
ORDER BY B DESC
ORDER BY A ASC, B DESC
ORDER BY SUM(C) DESC        -- valid after GROUP BY
```

---

## LIMIT and OFFSET

```sql
LIMIT 10
LIMIT 100 OFFSET 50         -- rows 51-150
```

---

## LABEL Clause (Rename Columns)

```sql
LABEL B 'Amount', SUM(C) 'Total'
LABEL A 'Name', B ''       -- empty string removes header
```

Appears after ORDER BY and before FORMAT.

---

## FORMAT Clause (Display Formatting)

```sql
FORMAT B '#,##0.00', A 'yyyy-MM-dd'
```

Applies display format to query result columns. Does not affect underlying values.

---

## OPTIONS Clause

```sql
OPTIONS no_values           -- return column types only (no data rows)
OPTIONS no_format           -- return raw values (no display formatting)
```

---

## Scalar Functions

### Numeric
- `year(col)` — extracts year from date
- `month(col)` — extracts month (**0-based**: January = 0, December = 11)
- `day(col)` — extracts day of month (1-based)
- `hour(col)`, `minute(col)`, `second(col)` — time components
- `quarter(col)` — 1–4
- `dayOfWeek(col)` — 1 = Sunday, 7 = Saturday
- `toDate(col)` — convert datetime to date
- `lower(col)` — lowercase string
- `upper(col)` — uppercase string
- `now()` — current timestamp

### String
- `lower(col)`, `upper(col)`
- No trim, substring, or replace functions in GQL

---

## Critical Gotchas

### 1. month() is 0-based
```
WHERE month(A) = 0   → January
WHERE month(A) = 11  → December
```

### 2. Case-sensitive string comparisons
```
WHERE C = 'Active'   -- matches 'Active', NOT 'active'
```
Use `lower(C) = 'active'` for case-insensitive matching.

### 3. No HAVING — use nested QUERY
```
-- WRONG:
=QUERY(A1:B100, "SELECT A, SUM(B) GROUP BY A HAVING SUM(B) > 1000")

-- CORRECT:
=QUERY(QUERY(A1:B100, "SELECT A, SUM(B) GROUP BY A"), "WHERE Col2 > 1000")
```

### 4. NULL handling
`IS NULL` / `IS NOT NULL` work. Empty string "" ≠ NULL in GQL.

### 5. Mixed data types in column
QUERY tries to infer column type. Mixed text/numbers in a column cause QUERY to treat it as string, breaking numeric comparisons. Clean data first.

### 6. Headers parameter matters
- `0` or omitted: auto-detect (first row treated as header if it contains strings)
- `1`: first row is always header
- `-1`: no headers, all rows are data

### 7. No subqueries in WHERE
```
-- INVALID:
WHERE A IN (SELECT A FROM ...)
```

### 8. Performance
- QUERY recalculates on any data change
- Large ranges (> 50K rows) with complex WHERE can cause visible lag
- Consider FILTER + aggregate functions for performance-critical cases

---

## Common Patterns

### Pattern: Filtered Table with Header
```
=QUERY(Sheet1!A1:E100, "SELECT A, B, D WHERE C = 'Active' ORDER BY B")
```

### Pattern: Summary by Category
```
=QUERY(A2:C100, "SELECT A, COUNT(B), SUM(C) GROUP BY A ORDER BY COUNT(B) DESC LABEL COUNT(B) 'Count', SUM(C) 'Revenue'", 0)
```

### Pattern: Date Range Filter
```
=QUERY(A1:C100, "SELECT * WHERE A >= date '2024-01-01' AND A < date '2025-01-01'")
```

### Pattern: Dynamic Query with Cell Reference
```
=QUERY(A1:C100, "SELECT * WHERE B > " & E1)
=QUERY(A1:C100, "SELECT * WHERE C = '" & F1 & "'")
```

**Important**: For string cell references, wrap in single quotes within the concatenated query string.

### Pattern: Top N by Group (Simulated)
```
=ARRAYFORMULA(QUERY(SORT(A1:C100,3,FALSE), "SELECT * LIMIT 5"))
```

### Pattern: Cross-Sheet Query
```
=QUERY(ImportedData!A:D, "SELECT A, SUM(D) WHERE B = 'West' GROUP BY A")
```
