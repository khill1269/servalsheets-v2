# Google Sheets Formula Functions Reference

> **Last Updated:** January 4, 2026  
> **Purpose:** Quick reference for common formula functions used in ServalSheets

---

## Table of Contents

1. [Lookup & Reference](#lookup--reference)
2. [Text Functions](#text-functions)
3. [Math & Statistics](#math--statistics)
4. [Date & Time](#date--time)
5. [Logical Functions](#logical-functions)
6. [Array Functions](#array-functions)
7. [Financial Functions](#financial-functions)
8. [Data Manipulation](#data-manipulation)
9. [Error Handling](#error-handling)
10. [Advanced Patterns](#advanced-patterns)

---

## Lookup & Reference

### VLOOKUP / HLOOKUP

```
=VLOOKUP(search_key, range, index, [is_sorted])
=HLOOKUP(search_key, range, index, [is_sorted])
```

| Parameter  | Description                           |
| ---------- | ------------------------------------- |
| search_key | Value to find                         |
| range      | Data range to search                  |
| index      | Column/row number to return (1-based) |
| is_sorted  | FALSE for exact match (recommended)   |

```
// Find price for product "Widget"
=VLOOKUP("Widget", A2:C100, 3, FALSE)

// Return #N/A if not found, or custom message
=IFERROR(VLOOKUP("Widget", A2:C100, 3, FALSE), "Not Found")
```

### INDEX / MATCH (More Flexible)

```
=INDEX(range, MATCH(search_key, lookup_range, [match_type]))
```

```
// Look up in any direction
=INDEX(C2:C100, MATCH("Widget", A2:A100, 0))

// Two-dimensional lookup
=INDEX(B2:E100, MATCH("Widget", A2:A100, 0), MATCH("Q1", B1:E1, 0))

// Return entire row
=INDEX(A2:E100, MATCH("Widget", A2:A100, 0), 0)
```

### XLOOKUP (Modern Alternative)

```
=XLOOKUP(search_key, lookup_range, return_range, [not_found], [match_mode], [search_mode])
```

```
// Basic lookup with default if not found
=XLOOKUP("Widget", A:A, C:C, "Not Found")

// Approximate match (next smaller)
=XLOOKUP(85, A:A, B:B, , -1)

// Search from last (reverse)
=XLOOKUP("Widget", A:A, C:C, , 0, -1)
```

### FILTER

```
=FILTER(range, condition1, [condition2, ...])
```

```
// Filter rows where column A = "Active"
=FILTER(A2:D100, A2:A100="Active")

// Multiple conditions
=FILTER(A2:D100, A2:A100="Active", C2:C100>1000)

// Return message if no results
=IFERROR(FILTER(A2:D100, A2:A100="Active"), "No matches")
```

### UNIQUE

```
=UNIQUE(range, [by_column], [exactly_once])
```

```
// Unique values from column
=UNIQUE(A2:A100)

// Unique rows
=UNIQUE(A2:C100)

// Values that appear exactly once
=UNIQUE(A2:A100, FALSE, TRUE)
```

### INDIRECT / ADDRESS

```
=INDIRECT(cell_reference_as_text)
=ADDRESS(row, column, [abs_rel], [a1_notation], [sheet])
```

```
// Dynamic sheet reference
=INDIRECT("'"&A1&"'!B2")

// Build cell reference
=ADDRESS(5, 3)  // Returns "$C$5"
=ADDRESS(5, 3, 4)  // Returns "C5" (relative)

// Combine for dynamic lookup
=INDIRECT(ADDRESS(MATCH("Widget",A:A,0), 3))
```

---

## Text Functions

### String Manipulation

```
=LEFT(text, num_chars)
=RIGHT(text, num_chars)
=MID(text, start, num_chars)
=LEN(text)
=TRIM(text)
=CLEAN(text)
```

```
// Extract first 3 characters
=LEFT(A1, 3)

// Get last 4 characters
=RIGHT(A1, 4)

// Extract middle portion
=MID(A1, 5, 10)  // Start at position 5, get 10 chars

// Remove extra spaces
=TRIM(A1)

// Remove non-printable characters
=CLEAN(A1)
```

### Search & Replace

```
=FIND(search_for, text, [start])  // Case-sensitive
=SEARCH(search_for, text, [start])  // Case-insensitive
=SUBSTITUTE(text, old_text, new_text, [instance])
=REPLACE(text, position, length, new_text)
```

```
// Find position of "@" in email
=FIND("@", A1)

// Replace all occurrences
=SUBSTITUTE(A1, " ", "_")

// Replace only first occurrence
=SUBSTITUTE(A1, "-", "/", 1)

// Replace by position
=REPLACE(A1, 1, 3, "NEW")  // Replace first 3 chars
```

### Case Conversion

```
=UPPER(text)
=LOWER(text)
=PROPER(text)
```

```
// "HELLO WORLD"
=UPPER("hello world")

// "hello world"
=LOWER("HELLO WORLD")

// "Hello World"
=PROPER("hello world")
```

### Concatenation

```
=CONCATENATE(text1, text2, ...)
=TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])
=CONCAT(text1, text2)
```

```
// Basic join
=CONCATENATE(A1, " ", B1)
=A1 & " " & B1  // Ampersand method

// Join with delimiter
=TEXTJOIN(", ", TRUE, A1:A10)  // "a, b, c, ..."

// Join ignoring empty cells
=TEXTJOIN("-", TRUE, A1:E1)
```

### Formatting

```
=TEXT(value, format)
=VALUE(text)
=FIXED(number, decimals, no_commas)
```

```
// Format number as currency
=TEXT(1234.5, "$#,##0.00")  // "$1,234.50"

// Format date
=TEXT(A1, "YYYY-MM-DD")  // "2024-01-15"
=TEXT(A1, "MMMM D, YYYY")  // "January 15, 2024"

// Convert text to number
=VALUE("1234.56")  // 1234.56

// Fixed decimal places
=FIXED(1234.567, 2)  // "1,234.57"
```

### REGEX Functions

```
=REGEXMATCH(text, regular_expression)
=REGEXEXTRACT(text, regular_expression)
=REGEXREPLACE(text, regular_expression, replacement)
```

```
// Check if email format
=REGEXMATCH(A1, "^[\w.-]+@[\w.-]+\.\w+$")

// Extract domain from email
=REGEXEXTRACT(A1, "@(.+)$")

// Remove non-numeric characters
=REGEXREPLACE(A1, "[^0-9]", "")

// Extract phone number
=REGEXEXTRACT(A1, "\d{3}-\d{3}-\d{4}")
```

---

## Math & Statistics

### Basic Math

```
=SUM(range)
=SUMIF(range, criterion, [sum_range])
=SUMIFS(sum_range, criteria_range1, criterion1, [criteria_range2, criterion2, ...])
=SUMPRODUCT(array1, [array2, ...])
```

```
// Simple sum
=SUM(A1:A100)

// Sum where condition met
=SUMIF(A:A, "Sales", B:B)  // Sum B where A = "Sales"
=SUMIF(B:B, ">1000")  // Sum B where B > 1000

// Multiple conditions
=SUMIFS(C:C, A:A, "Sales", B:B, ">1000")

// Weighted sum / array multiplication
=SUMPRODUCT(A2:A10, B2:B10)
```

### Counting

```
=COUNT(range)  // Numbers only
=COUNTA(range)  // Non-empty cells
=COUNTBLANK(range)
=COUNTIF(range, criterion)
=COUNTIFS(criteria_range1, criterion1, [criteria_range2, criterion2, ...])
=COUNTUNIQUE(range)
```

```
// Count numbers
=COUNT(A:A)

// Count non-empty
=COUNTA(A:A)

// Count matching criterion
=COUNTIF(A:A, "Sales")
=COUNTIF(B:B, ">1000")
=COUNTIF(A:A, "*widget*")  // Contains "widget"

// Multiple conditions
=COUNTIFS(A:A, "Sales", B:B, ">1000", C:C, "<>")
```

### Statistics

```
=AVERAGE(range)
=AVERAGEIF(range, criterion, [average_range])
=AVERAGEIFS(average_range, criteria_range1, criterion1, ...)
=MEDIAN(range)
=MODE(range)
=STDEV(range)  // Sample
=STDEVP(range)  // Population
=VAR(range)
=VARP(range)
```

```
// Average with condition
=AVERAGEIF(A:A, "Sales", B:B)

// Percentile
=PERCENTILE(B:B, 0.9)  // 90th percentile

// Quartiles
=QUARTILE(B:B, 1)  // Q1 (25th percentile)
=QUARTILE(B:B, 2)  // Q2 (median)
=QUARTILE(B:B, 3)  // Q3 (75th percentile)
```

### Min / Max

```
=MIN(range)
=MAX(range)
=MINIFS(range, criteria_range1, criterion1, ...)
=MAXIFS(range, criteria_range1, criterion1, ...)
=LARGE(range, n)
=SMALL(range, n)
```

```
// Max with condition
=MAXIFS(B:B, A:A, "Sales")

// Nth largest/smallest
=LARGE(B:B, 3)  // 3rd largest
=SMALL(B:B, 1)  // Smallest (same as MIN)

// Top 5 sum
=SUM(LARGE(B:B, {1,2,3,4,5}))
```

### Rounding

```
=ROUND(value, places)
=ROUNDUP(value, places)
=ROUNDDOWN(value, places)
=CEILING(value, [factor])
=FLOOR(value, [factor])
=TRUNC(value, [places])
=INT(value)
```

```
// Round to 2 decimals
=ROUND(123.456, 2)  // 123.46

// Round up to nearest 10
=CEILING(123, 10)  // 130

// Round down to nearest 5
=FLOOR(123, 5)  // 120

// Truncate (remove decimals, no rounding)
=TRUNC(123.999)  // 123
```

---

## Date & Time

### Current Date/Time

```
=TODAY()  // Current date
=NOW()    // Current date and time
```

### Date Components

```
=YEAR(date)
=MONTH(date)
=DAY(date)
=WEEKDAY(date, [type])
=WEEKNUM(date, [type])
=HOUR(datetime)
=MINUTE(datetime)
=SECOND(datetime)
```

```
// Extract components
=YEAR(A1)  // 2024
=MONTH(A1)  // 1-12
=DAY(A1)  // 1-31

// Day of week (1=Sunday by default)
=WEEKDAY(A1)
=WEEKDAY(A1, 2)  // 1=Monday

// Week number
=WEEKNUM(A1)
```

### Date Construction

```
=DATE(year, month, day)
=TIME(hour, minute, second)
=DATEVALUE(date_string)
=TIMEVALUE(time_string)
```

```
// Create date
=DATE(2024, 1, 15)  // Jan 15, 2024

// Parse date string
=DATEVALUE("2024-01-15")
=DATEVALUE("January 15, 2024")

// Create time
=TIME(14, 30, 0)  // 2:30 PM
```

### Date Math

```
=DATEDIF(start_date, end_date, unit)
=EDATE(start_date, months)
=EOMONTH(start_date, months)
=NETWORKDAYS(start_date, end_date, [holidays])
=WORKDAY(start_date, num_days, [holidays])
```

```
// Difference in days/months/years
=DATEDIF(A1, B1, "D")  // Days
=DATEDIF(A1, B1, "M")  // Complete months
=DATEDIF(A1, B1, "Y")  // Complete years

// Add months
=EDATE(A1, 3)  // Add 3 months

// End of month
=EOMONTH(A1, 0)  // End of current month
=EOMONTH(A1, 1)  // End of next month

// Business days
=NETWORKDAYS(A1, B1)  // Working days between dates
=WORKDAY(A1, 10)  // Date 10 working days from A1
```

---

## Logical Functions

### Conditionals

```
=IF(condition, value_if_true, value_if_false)
=IFS(condition1, value1, [condition2, value2, ...])
=SWITCH(expression, case1, value1, [case2, value2, ...], [default])
```

```
// Simple IF
=IF(A1>100, "High", "Low")

// Nested IF (old way)
=IF(A1>=90, "A", IF(A1>=80, "B", IF(A1>=70, "C", "F")))

// IFS (cleaner)
=IFS(A1>=90, "A", A1>=80, "B", A1>=70, "C", TRUE, "F")

// SWITCH (exact match)
=SWITCH(A1, "N", "North", "S", "South", "E", "East", "W", "West", "Unknown")
```

### Boolean Logic

```
=AND(condition1, [condition2, ...])
=OR(condition1, [condition2, ...])
=NOT(condition)
=XOR(condition1, [condition2, ...])
```

```
// All conditions must be true
=AND(A1>0, A1<100, B1="Active")

// Any condition true
=OR(A1="Admin", A1="Manager", A1="Owner")

// Negate
=NOT(A1="Inactive")

// Exclusive OR (odd number of TRUE)
=XOR(A1, B1)  // TRUE if exactly one is TRUE
```

### Comparison

```
=EXACT(text1, text2)  // Case-sensitive comparison
```

```
// Case-sensitive equality
=EXACT(A1, "Widget")  // FALSE for "widget"

// Case-insensitive
=UPPER(A1)=UPPER("Widget")  // TRUE for "widget"
```

---

## Array Functions

### ARRAYFORMULA

```
=ARRAYFORMULA(expression)
```

```
// Apply formula to entire column
=ARRAYFORMULA(A2:A * B2:B)

// Conditional array
=ARRAYFORMULA(IF(A2:A="", "", A2:A * 1.1))

// Create array of calculations
=ARRAYFORMULA(YEAR(A2:A100) & "-" & MONTH(A2:A100))
```

### QUERY (Powerful!)

```
=QUERY(data, query_string, [headers])
```

```
// Select columns
=QUERY(A:E, "SELECT A, C, E")

// Filter rows
=QUERY(A:E, "SELECT * WHERE B = 'Sales'")

// Multiple conditions
=QUERY(A:E, "SELECT * WHERE B = 'Sales' AND C > 1000")

// Aggregate
=QUERY(A:E, "SELECT B, SUM(C) GROUP BY B")

// Order
=QUERY(A:E, "SELECT * ORDER BY C DESC")

// Limit
=QUERY(A:E, "SELECT * ORDER BY C DESC LIMIT 10")

// Complex example
=QUERY(A:E, "SELECT A, B, SUM(C) WHERE D = 'Active' GROUP BY A, B ORDER BY SUM(C) DESC LIMIT 20", 1)

// With cell reference
=QUERY(A:E, "SELECT * WHERE B = '"&G1&"'")
```

### SORT

```
=SORT(range, sort_column, is_ascending, [sort_column2, is_ascending2, ...])
```

```
// Sort by single column
=SORT(A2:E100, 3, FALSE)  // Sort by column 3, descending

// Multiple sort columns
=SORT(A2:E100, 2, TRUE, 3, FALSE)  // Sort by col 2 asc, then col 3 desc
```

### TRANSPOSE

```
=TRANSPOSE(range)
```

```
// Flip rows to columns
=TRANSPOSE(A1:E1)  // Horizontal to vertical
=TRANSPOSE(A1:A5)  // Vertical to horizontal
```

### Other Array Functions

```
=FLATTEN(range1, [range2, ...])  // Flatten to single column
=TOCOL(range, [ignore], [scan_by_column])  // Convert to column
=TOROW(range, [ignore], [scan_by_column])  // Convert to row
=WRAPCOL(range, wrap_count, [pad_with])  // Wrap into columns
=WRAPROWS(range, wrap_count, [pad_with])  // Wrap into rows
```

---

## Financial Functions

### Basic Financial

```
=PMT(rate, nper, pv, [fv], [type])  // Payment
=PV(rate, nper, pmt, [fv], [type])  // Present value
=FV(rate, nper, pmt, [pv], [type])  // Future value
=NPV(rate, cashflow1, [cashflow2, ...])  // Net present value
=IRR(cashflow_range, [guess])  // Internal rate of return
```

```
// Monthly payment on $200,000 loan at 5% for 30 years
=PMT(0.05/12, 30*12, 200000)  // -$1,073.64

// Present value of investment
=PV(0.08, 10, -1000)  // $6,710.08

// Future value of savings
=FV(0.05/12, 10*12, -500, -10000)  // $88,037.79
```

### Investment Analysis

```
=XNPV(rate, cashflows, dates)
=XIRR(cashflows, dates, [guess])
```

```
// NPV with irregular dates
=XNPV(0.1, B2:B10, A2:A10)

// IRR with irregular dates
=XIRR(B2:B10, A2:A10)
```

---

## Data Manipulation

### IMPORTRANGE

```
=IMPORTRANGE(spreadsheet_url, range_string)
```

```
// Import from another spreadsheet
=IMPORTRANGE("https://docs.google.com/spreadsheets/d/abc123/edit", "Sheet1!A:D")

// With named range
=IMPORTRANGE("spreadsheet_key", "DataRange")
```

### SPLIT / JOIN

```
=SPLIT(text, delimiter, [split_by_each], [remove_empty])
=JOIN(delimiter, array)
```

```
// Split into columns
=SPLIT("a,b,c", ",")  // Returns [a][b][c] in separate cells

// Join array
=JOIN(", ", A1:A5)  // "a, b, c, d, e"
```

### Pivot-like Functions

```
=SUMPRODUCT((condition1)*(condition2)*values)
=SUMIFS(sum_range, criteria_range1, criterion1, ...)
```

```
// Cross-tab sum
=SUMPRODUCT((A:A=E1)*(B:B=F1)*C:C)
```

---

## Error Handling

### Error Functions

```
=IFERROR(value, value_if_error)
=IFNA(value, value_if_na)
=ISERROR(value)
=ISNA(value)
=ISERR(value)  // Error except #N/A
=ERROR.TYPE(value)
```

```
// Handle any error
=IFERROR(VLOOKUP(A1, Data, 2, FALSE), "Not found")

// Handle only #N/A
=IFNA(VLOOKUP(A1, Data, 2, FALSE), "Not found")

// Check if error
=IF(ISERROR(A1), "Error", A1)

// Error type code
=ERROR.TYPE(A1)  // 1=#NULL!, 2=#DIV/0!, 3=#VALUE!, etc.
```

### Type Checking

```
=ISNUMBER(value)
=ISTEXT(value)
=ISBLANK(value)
=ISLOGICAL(value)
=ISREF(value)
=ISFORMULA(cell)
```

```
// Validate before calculation
=IF(ISNUMBER(A1), A1*2, "Invalid")

// Check if formula
=ISFORMULA(A1)  // TRUE if cell contains formula
```

---

## Advanced Patterns

### Dynamic Range Expansion

```
// Auto-expand to last row with data
=INDIRECT("A1:A"&COUNTA(A:A))

// Using with SUM
=SUM(INDIRECT("B2:B"&COUNTA(A:A)))
```

### Running Total

```
=SUMIF(ROW($A$2:A2),"<="&ROW(A2),$B$2:B2)

// Or simpler:
=SUM($B$2:B2)
```

### Rank / Percentile Rank

```
=RANK(value, data, [order])
=PERCENTRANK(data, value)
```

```
// Rank (1 = highest)
=RANK(B2, $B$2:$B$100, 0)

// Rank (1 = lowest)
=RANK(B2, $B$2:$B$100, 1)

// Percentile rank
=PERCENTRANK($B$2:$B$100, B2)
```

### Dynamic Dropdown Dependencies

```
// Main category in A1 (dropdown)
// Subcategory options based on A1:
=FILTER(SubCategories!B:B, SubCategories!A:A=A1)
```

### Cross-Sheet Summary

```
// Sum across multiple sheets
=Sheet1!B10+Sheet2!B10+Sheet3!B10

// Or with INDIRECT
=SUM(INDIRECT("'"&A1&"'!B10"))  // Where A1 contains sheet name
```

### Year-Over-Year Comparison

```
// Current year value
=SUMIFS(Sales, Year, YEAR(TODAY()))

// Prior year
=SUMIFS(Sales, Year, YEAR(TODAY())-1)

// YoY Growth
=(SUMIFS(Sales,Year,YEAR(TODAY()))-SUMIFS(Sales,Year,YEAR(TODAY())-1))/SUMIFS(Sales,Year,YEAR(TODAY())-1)
```

---

## ServalSheets Formula Writing

When writing formulas via API:

```typescript
const writeCellWithFormula = {
  updateCells: {
    rows: [
      {
        values: [
          {
            userEnteredValue: {
              formulaValue: '=SUM(A1:A100)', // Formula string
            },
          },
        ],
      },
    ],
    start: { sheetId: 0, rowIndex: 0, columnIndex: 5 },
    fields: 'userEnteredValue',
  },
};

// Important: Escape quotes in formulas
const formulaWithQuotes = '=IF(A1="Yes", "Active", "Inactive")';

// For QUERY with embedded quotes
const queryFormula = '=QUERY(A:E, "SELECT * WHERE B = \'Sales\'")';
```

---

_Source: Google Sheets Function Reference_
