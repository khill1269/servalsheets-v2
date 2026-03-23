# IMPORTRANGE — Cross-Spreadsheet Data Import

IMPORTRANGE pulls a range from another Google Sheets spreadsheet into the current one.

```
=IMPORTRANGE(spreadsheet_url_or_id, range_string)
```

- `spreadsheet_url_or_id`: Full URL or just the spreadsheet ID (the long alphanumeric string from the URL)
- `range_string`: Range in `"SheetName!A1:D100"` format (sheet name is optional for first sheet)

---

## Authentication Model (Critical)

**IMPORTRANGE requires a one-time interactive permission grant** between spreadsheets.

### First-time setup
1. Enter the IMPORTRANGE formula
2. Sheets shows `#REF!` error with "Allow access" button
3. The user (or file owner) must **click "Allow access"** in the browser
4. Permission is stored per-user, per-source-spreadsheet pair

### Programmatic implications
- **No API to grant this permission** — must be done interactively in the browser UI
- **Cannot be automated** via Apps Script or Google Sheets API
- **Permission is per-user**: if User A grants access, the formula works only when User A's credentials evaluate it
- **Service accounts** can grant access if they own both files (same domain)

### Error states
| Error | Cause |
|-------|-------|
| `#REF!` with "Allow access" | First use — permission not yet granted |
| `#REF!` "You do not have permission" | Source file access revoked or insufficient |
| `#N/A` "Requested range does not exist" | Sheet name wrong or range outside data |
| `#REF!` "Error connecting..." | Temporary Google outage or connectivity issue |
| `Loading...` | Data being fetched (normal, up to 30 seconds) |

---

## Caching Behavior

- IMPORTRANGE caches data for **~30 minutes** (not instant updates)
- Cache is per-user per formula
- No API to force cache invalidation
- For near-real-time data, use Apps Script `IMPORTRANGE`-equivalent with `SpreadsheetApp.openById()`

---

## Limits

| Limit | Value |
|-------|-------|
| Practical row limit | ~20,000 rows (no hard limit, but performance degrades) |
| Cross-spreadsheet references per spreadsheet | 50 max |
| Simultaneous IMPORTRANGE recalculations | Throttled by Google |
| Source cells (including referenced) | Counts toward 10M cell limit |

---

## Performance Patterns

### Minimize referenced range size
```
-- Inefficient: imports entire column
=IMPORTRANGE("1ABC...", "Sheet1!A:A")

-- Better: import only populated range
=IMPORTRANGE("1ABC...", "Sheet1!A1:A500")
```

### Don't nest IMPORTRANGE inside volatile functions
```
-- Bad: recalculates constantly
=SUM(IMPORTRANGE("...", NOW() & "Sheet1!A1:A100"))
```

### Use QUERY to filter before processing
```
=QUERY(IMPORTRANGE("1ABC...", "Data!A1:E5000"),
       "SELECT Col1, Col3 WHERE Col2 = 'Active'", 1)
```
QUERY runs on the imported data locally — much faster than importing then filtering.

---

## Combining with Other Functions

### IMPORTRANGE + QUERY (most common pattern)
```
=QUERY(IMPORTRANGE("1ABC...", "Sales!A:E"),
       "SELECT Col1, SUM(Col4) WHERE Col3 = 'Q1' GROUP BY Col1", 1)
```
Note: When IMPORTRANGE is the data source for QUERY, use `Col1`, `Col2`, ... (not `A`, `B`) because IMPORTRANGE returns an array without named columns.

### IMPORTRANGE + VLOOKUP
```
=VLOOKUP(A2, IMPORTRANGE("1ABC...", "Lookup!A:C"), 2, FALSE)
```
Avoid for large lookups — use QUERY instead for better performance.

### IMPORTRANGE + FILTER
```
=FILTER(IMPORTRANGE("1ABC...", "Sheet1!A:D"),
        IMPORTRANGE("1ABC...", "Sheet1!B:B") = "Active")
```
Both IMPORTRANGE calls must reference the **same spreadsheet ID** to avoid two permission grants.

---

## Referencing by ID vs URL

Both work:
```
-- Full URL
=IMPORTRANGE("https://docs.google.com/spreadsheets/d/1ABCdef123/edit", "Sheet1!A1:D10")

-- Spreadsheet ID only (cleaner)
=IMPORTRANGE("1ABCdef123", "Sheet1!A1:D10")
```

Extracting the ID from a URL: it's the string between `/d/` and `/edit` (or `/view`).

---

## Best Practices

1. **Always specify sheet name** in range_string — `"Sheet1!A1:D100"` not `"A1:D100"` — for clarity and to avoid breaking if sheets are reordered

2. **Import once, reference locally** — use one IMPORTRANGE into a dedicated import area, then reference those cells with regular formulas. This reduces the number of cross-spreadsheet calls.

3. **Handle permission errors gracefully** — wrap in IFERROR for dashboards:
   ```
   =IFERROR(IMPORTRANGE("...", "Sheet1!A1:D100"), "Data unavailable")
   ```

4. **Don't use in array contexts unnecessarily** — IMPORTRANGE in ARRAYFORMULA or as repeated formula arguments increases quota consumption

5. **Document the source** — keep the spreadsheet ID visible (in a cell or comment) for maintenance

---

## Troubleshooting Checklist

- [ ] Permission granted? (first time: look for "Allow access" button)
- [ ] Source spreadsheet shared? (user must have at least Viewer access)
- [ ] Sheet name exact match? (case-sensitive, spaces matter)
- [ ] Range within bounds? (check source data extends to referenced range)
- [ ] Under 50 IMPORTRANGE functions in this file?
- [ ] Result less than ~20K rows?
