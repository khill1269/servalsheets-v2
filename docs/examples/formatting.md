---
title: Formatting Guide
category: example
last_updated: 2026-01-31
description: Master cell formatting, number formats, colors, and text styling in ServalSheets.
version: 1.6.0
---

# Formatting Guide

Master cell formatting, number formats, colors, and text styling in ServalSheets.

## Overview

This guide covers:

- Cell formatting (colors, borders, alignment)
- Number formats (currency, percentages, dates)
- Text styling (bold, italic, fonts)
- Conditional formatting
- Column and row dimensions

## Prerequisites

- ServalSheets v1.6.0 or later
- Understanding of [basic operations](./basic.md)
- Active spreadsheet with data to format

## Cell Formatting

### Background Colors

**Scenario**: Set cell background to light blue

```
Format cell A1 in spreadsheet "1abc...xyz" with light blue background
```

**Behind the scenes**: ServalSheets uses the `sheets_format` tool with `set_format` action:

```json
{
  "tool": "sheets_format",
  "action": "set_format",
  "spreadsheetId": "1abc...xyz",
  "range": "A1",
  "format": {
    "backgroundColor": {
      "red": 0.8,
      "green": 0.9,
      "blue": 1.0
    }
  }
}
```

**RGB values**: Range from 0.0 to 1.0 (not 0-255)

### Text Colors

**Scenario**: Set text color to dark red

```
Format range A1:A10 in spreadsheet "1abc...xyz" with dark red text
```

**Common colors**:

- Red: `{"red": 1.0, "green": 0.0, "blue": 0.0}`
- Green: `{"red": 0.0, "green": 1.0, "blue": 0.0}`
- Blue: `{"red": 0.0, "green": 0.0, "blue": 1.0}`
- Black: `{"red": 0.0, "green": 0.0, "blue": 0.0}`
- White: `{"red": 1.0, "green": 1.0, "blue": 1.0}`

### Borders

**Scenario**: Add solid border around a range

```
Add a solid black border around range A1:D10 in spreadsheet "1abc...xyz"
```

**Border styles**:

- `SOLID` - Single solid line
- `DOTTED` - Dotted line
- `DASHED` - Dashed line
- `DOUBLE` - Double line

**Border positions**:

- `top`, `bottom`, `left`, `right` - Outer edges
- `innerHorizontal`, `innerVertical` - Internal grid

### Alignment

**Scenario**: Center align text horizontally and vertically

```
Center align cells A1:C5 in spreadsheet "1abc...xyz"
```

**Horizontal alignment**: `LEFT`, `CENTER`, `RIGHT`
**Vertical alignment**: `TOP`, `MIDDLE`, `BOTTOM`

### Text Wrapping

**Scenario**: Enable text wrapping for long content

```
Enable text wrapping for cells A1:A20 in spreadsheet "1abc...xyz"
```

**Wrap strategies**:

- `OVERFLOW_CELL` - Text overflows into adjacent cells (default)
- `WRAP` - Text wraps within the cell
- `CLIP` - Text is clipped at cell boundary

## Number Formats

### Currency Format

**Scenario**: Format as US dollar currency

```
Format range B2:B10 in spreadsheet "1abc...xyz" as USD currency
```

**Behind the scenes**:

```json
{
  "format": {
    "numberFormat": {
      "type": "CURRENCY",
      "pattern": "$#,##0.00"
    }
  }
}
```

**Currency patterns**:

- US Dollar: `$#,##0.00`
- Euro: `€#,##0.00`
- British Pound: `£#,##0.00`
- Japanese Yen: `¥#,##0`

### Percentage Format

**Scenario**: Display values as percentages

```
Format range C2:C10 in spreadsheet "1abc...xyz" as percentages with 2 decimal places
```

**Pattern**: `0.00%`

**Note**: Value 0.25 displays as "25.00%"

### Date and Time Formats

**Scenario**: Format dates as "MM/DD/YYYY"

```
Format range D2:D10 in spreadsheet "1abc...xyz" as dates in MM/DD/YYYY format
```

**Common date patterns**:

- `MM/DD/YYYY` - 01/30/2026
- `YYYY-MM-DD` - 2026-01-30
- `DD-MMM-YYYY` - 30-Jan-2026
- `MMMM D, YYYY` - January 30, 2026

**Time patterns**:

- `HH:MM:SS` - 14:30:45
- `HH:MM AM/PM` - 02:30 PM
- `HH:MM:SS.000` - 14:30:45.123

### Custom Number Formats

**Scenario**: Format with custom thousands separator and decimals

```
Format range E2:E10 in spreadsheet "1abc...xyz" with pattern "#,##0.000"
```

**Pattern components**:

- `#` - Optional digit
- `0` - Required digit (shows zero if empty)
- `,` - Thousands separator
- `.` - Decimal separator
- `"text"` - Literal text
- `[Color]` - Color specification

**Example**: `[Red]-$#,##0.00;[Green]$#,##0.00` - Negative numbers in red, positive in green

## Text Styling

### Bold, Italic, Underline

**Scenario**: Make header row bold

```
Make range A1:E1 in spreadsheet "1abc...xyz" bold
```

**Text styles**:

- Bold: `"bold": true`
- Italic: `"italic": true`
- Underline: `"underline": true`
- Strikethrough: `"strikethrough": true`

### Font Family and Size

**Scenario**: Change font to Arial 12pt

```
Format range A1:E1 in spreadsheet "1abc...xyz" with Arial font at 12pt size
```

**Common fonts**:

- Arial
- Times New Roman
- Courier New
- Calibri
- Verdana

**Font sizes**: Typically 8pt to 36pt

### Combined Text Formatting

**Scenario**: Create formatted header

```
Format header row A1:E1 in spreadsheet "1abc...xyz" with:
- Bold text
- 14pt size
- Dark blue background
- White text color
- Center alignment
```

## Conditional Formatting

### Value-Based Rules

**Scenario**: Highlight cells greater than 100 in green

```
Apply conditional formatting to range B2:B10 in spreadsheet "1abc...xyz":
- If value > 100, background color green
```

**Behind the scenes**: Uses `sheets_advanced` tool with `add_conditional_format` action

### Text Contains Rules

**Scenario**: Highlight cells containing "ERROR" in red

```
Apply conditional formatting to range A1:A20 in spreadsheet "1abc...xyz":
- If text contains "ERROR", background color red
```

### Color Scale Rules

**Scenario**: Apply color gradient based on values

```
Apply color scale to range C2:C10 in spreadsheet "1abc...xyz":
- Lowest values: red
- Middle values: yellow
- Highest values: green
```

### Date-Based Rules

**Scenario**: Highlight dates in the past

```
Apply conditional formatting to range D2:D10 in spreadsheet "1abc...xyz":
- If date is in the past, background color gray
```

## Column and Row Dimensions

### Set Column Width

**Scenario**: Set column A width to 200 pixels

```
Set column A width to 200 pixels in spreadsheet "1abc...xyz"
```

**Behind the scenes**: Uses `sheets_dimensions` tool with `set_column_width` action

### Set Row Height

**Scenario**: Set row 1 height to 50 pixels

```
Set row 1 height to 50 pixels in spreadsheet "1abc...xyz"
```

### Auto-Resize Columns

**Scenario**: Auto-fit column widths to content

```
Auto-resize columns A through E in spreadsheet "1abc...xyz" to fit content
```

### Hide Rows/Columns

**Scenario**: Hide column B

```
Hide column B in spreadsheet "1abc...xyz"
```

## Advanced Formatting

### Format Entire Sheet

**Scenario**: Apply consistent formatting to entire sheet

```
Format entire Sheet1 in spreadsheet "1abc...xyz" with:
- Arial 10pt font
- White background
- Black text
- Left alignment
```

### Copy Format

**Scenario**: Copy formatting from one range to another

```
Copy formatting from A1:A10 to B1:B10 in spreadsheet "1abc...xyz"
```

**Note**: ServalSheets preserves source formatting when copying.

### Clear Formatting

**Scenario**: Remove all formatting but keep values

```
Clear all formatting from range A1:E10 in spreadsheet "1abc...xyz" while keeping the data
```

### Alternating Row Colors

**Scenario**: Create zebra-striped rows

```
Apply alternating row colors to range A1:E20 in spreadsheet "1abc...xyz":
- Odd rows: white background
- Even rows: light gray background
```

## Format Templates

### Professional Header Style

```
Format: Bold, 12pt, dark blue background, white text, center aligned
Use for: Table headers, section titles
```

### Currency Table Style

```
Format: Currency pattern, right aligned, alternating row colors
Use for: Financial data, budgets, pricing tables
```

### Status Indicator Style

```
Format: Conditional formatting (Green=Active, Yellow=Pending, Red=Error)
Use for: Status columns, health indicators
```

### Date Column Style

```
Format: YYYY-MM-DD pattern, center aligned, light blue background
Use for: Date tracking, timelines, schedules
```

## Best Practices

### Performance

1. **Batch format operations** - Update multiple ranges in single request
2. **Use conditional formatting** for dynamic styling
3. **Avoid excessive colors** - Too many colors reduce readability
4. **Cache format requests** - Don't re-apply identical formats

### Consistency

1. **Define format standards** - Use consistent styles across sheets
2. **Use named styles** - Create reusable format templates
3. **Document formats** - Keep format guide for team
4. **Test accessibility** - Ensure good contrast ratios

### Maintenance

1. **Review formatting regularly** - Remove unused formats
2. **Update formats together** - Keep related ranges synchronized
3. **Version format changes** - Track format updates over time
4. **Test before applying** - Preview formats on sample data

## Common Patterns

### Financial Report Formatting

```
1. Header row: Bold, colored background
2. Data rows: Currency format, right aligned
3. Total row: Bold, double top border
4. Alternating row colors for readability
```

### Dashboard Formatting

```
1. KPI cells: Large font, center aligned, colored background
2. Conditional formats for thresholds
3. Clear section dividers with borders
4. Consistent color scheme throughout
```

### Data Entry Form Formatting

```
1. Label columns: Bold, light background
2. Input columns: White background, data validation
3. Required fields: Yellow background
4. Calculated fields: Gray background, protected
```

## Troubleshooting

### Format Not Applying

**Check**: Verify range notation is correct
**Check**: Ensure sufficient permissions
**Check**: Confirm no conflicting formats

### Colors Look Wrong

**Issue**: Using 0-255 RGB instead of 0.0-1.0
**Solution**: Convert to decimal (e.g., 255 → 1.0, 128 → 0.502)

### Number Format Not Working

**Check**: Verify pattern syntax
**Check**: Ensure cells contain numbers not text
**Check**: Review locale settings for separators

### Conditional Format Not Updating

**Issue**: Rules may be in wrong order
**Solution**: Check rule priority (first match wins)

## Reference Files

For advanced formatting examples, see:

- `format-examples.json` - Complete formatting specifications
- `advanced-examples.json` - Complex formatting patterns
- `dimensions-examples.json` - Row/column dimension examples

## Next Steps

- **Charts**: Learn [chart creation](./charts.md)
- **Analysis**: Explore [data analysis](./analysis.md)
- **Advanced**: See [advanced formatting patterns](../examples/)

## Related Resources

- [Usage Guide](../guides/USAGE_GUIDE.md) - General usage patterns
- [Action Reference](../guides/ACTION_REFERENCE.md) - Complete action documentation
- [Performance Guide](../guides/PERFORMANCE.md) - Optimization tips
