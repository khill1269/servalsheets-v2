---
title: Charts & Visualizations
category: example
last_updated: 2026-01-31
description: Create professional charts and visualizations in Google Sheets using ServalSheets.
version: 1.6.0
tags: [sheets]
---

# Charts & Visualizations

Create professional charts and visualizations in Google Sheets using ServalSheets.

## Overview

This guide covers:

- Creating charts (column, line, pie, scatter)
- Customizing chart appearance
- Positioning and sizing charts
- Updating chart data
- Managing multiple charts

## Prerequisites

- ServalSheets v1.6.0 or later
- Spreadsheet with data to visualize
- Understanding of [basic operations](./basic.md)

## Chart Basics

### Chart Components

Every chart has:

- **Data source**: Range of cells to visualize
- **Chart type**: Column, line, pie, bar, scatter, etc.
- **Title**: Optional chart title
- **Position**: Where chart appears on sheet
- **Size**: Width and height in pixels

### Supported Chart Types

- `COLUMN` - Vertical bars
- `BAR` - Horizontal bars
- `LINE` - Line graph
- `AREA` - Filled area under line
- `PIE` - Circular pie chart
- `SCATTER` - XY scatter plot
- `COMBO` - Combined column and line
- `HISTOGRAM` - Distribution bars
- `CANDLESTICK` - Financial OHLC chart

## Creating Charts

### Basic Column Chart

**Scenario**: Create chart showing monthly sales

```
Create a column chart in spreadsheet "1abc...xyz" using data from range A1:B13 with:
- Title: "Monthly Sales 2026"
- Position at row 15, column 4
```

**Behind the scenes**: ServalSheets uses `sheets_visualize` tool with `chart_create` action:

```json
{
  "tool": "sheets_visualize",
  "action": "create",
  "spreadsheetId": "1abc...xyz",
  "sheetId": 0,
  "chartType": "COLUMN",
  "sourceRanges": ["A1:B13"],
  "title": "Monthly Sales 2026",
  "position": {
    "overlayPosition": {
      "anchorCell": {
        "sheetId": 0,
        "rowIndex": 14,
        "columnIndex": 3
      }
    }
  }
}
```

**Data format**:

```
| Month     | Sales |
|-----------|-------|
| January   | 1500  |
| February  | 1800  |
| March     | 2200  |
```

### Line Chart

**Scenario**: Create line chart showing trends over time

```
Create a line chart in spreadsheet "1abc...xyz" showing revenue trend from range A1:B25 with title "Revenue Trend Q1 2026"
```

**Best for**: Time series data, trends, continuous data

### Pie Chart

**Scenario**: Show market share distribution

```
Create a pie chart in spreadsheet "1abc...xyz" from range A1:B6 showing market share by region
```

**Best for**: Part-to-whole relationships, percentages, proportions

**Data format**:

```
| Region        | Share |
|---------------|-------|
| North America | 45%   |
| Europe        | 30%   |
| Asia Pacific  | 20%   |
| Other         | 5%    |
```

### Scatter Plot

**Scenario**: Show correlation between two variables

```
Create a scatter plot in spreadsheet "1abc...xyz" from range A1:B50 showing correlation between advertising spend and sales
```

**Best for**: Correlations, distributions, outlier detection

### Combo Chart

**Scenario**: Show columns and line together

```
Create a combo chart in spreadsheet "1abc...xyz" with:
- Columns for monthly revenue (B2:B13)
- Line for target goal (C2:C13)
- X-axis categories from A2:A13
```

**Best for**: Comparing actuals vs targets, multiple metrics

## Chart Customization

### Colors

**Scenario**: Set custom colors for chart series

```
Update chart with ID 123 in spreadsheet "1abc...xyz" to use:
- First series: blue (#0000FF)
- Second series: red (#FF0000)
```

**Behind the scenes**:

```json
{
  "action": "update",
  "chartId": 123,
  "spec": {
    "series": [
      {
        "color": {
          "red": 0.0,
          "green": 0.0,
          "blue": 1.0
        }
      },
      {
        "color": {
          "red": 1.0,
          "green": 0.0,
          "blue": 0.0
        }
      }
    ]
  }
}
```

### Axis Configuration

**Scenario**: Customize axis labels and range

```
Update chart 123 in spreadsheet "1abc...xyz" with:
- Y-axis label: "Sales ($)"
- Y-axis range: 0 to 10000
- X-axis label: "Month"
```

**Axis options**:

- `title` - Axis label text
- `format` - Number format pattern
- `viewWindowMin` - Minimum value
- `viewWindowMax` - Maximum value

### Legend

**Scenario**: Position legend at bottom of chart

```
Update chart 123 in spreadsheet "1abc...xyz" to show legend at bottom
```

**Legend positions**: `BOTTOM`, `TOP`, `LEFT`, `RIGHT`, `NONE`

### Grid Lines

**Scenario**: Customize grid line appearance

```
Update chart 123 in spreadsheet "1abc...xyz" with:
- Major grid lines: light gray
- Minor grid lines: very light gray
```

### Chart Title and Subtitle

**Scenario**: Add detailed chart titles

```
Update chart 123 in spreadsheet "1abc...xyz" with:
- Title: "Q1 2026 Sales Performance"
- Subtitle: "By Region and Product Category"
```

## Chart Positioning

### Absolute Position

**Scenario**: Place chart at specific row/column

```
Move chart 123 in spreadsheet "1abc...xyz" to position row 20, column 5
```

**Position object**:

```json
{
  "overlayPosition": {
    "anchorCell": {
      "sheetId": 0,
      "rowIndex": 19, // 0-indexed
      "columnIndex": 4
    }
  }
}
```

### Chart Size

**Scenario**: Set chart dimensions

```
Resize chart 123 in spreadsheet "1abc...xyz" to 600x400 pixels
```

**Size options**:

```json
{
  "overlayPosition": {
    "widthPixels": 600,
    "heightPixels": 400
  }
}
```

### Embedded vs Sheet Object

Charts can be:

- **Embedded**: Overlay positioned on sheet
- **Sheet object**: Separate chart sheet

**Create chart sheet**:

```
Create a new chart sheet in spreadsheet "1abc...xyz" with column chart from data A1:B10
```

## Updating Charts

### Update Data Source

**Scenario**: Change the data range being charted

```
Update chart 123 in spreadsheet "1abc...xyz" to use new data range A1:B20 instead of A1:B13
```

### Add Series

**Scenario**: Add another data series to existing chart

```
Add a new series to chart 123 in spreadsheet "1abc...xyz" from range C2:C13
```

### Remove Series

**Scenario**: Remove a data series from chart

```
Remove the second series from chart 123 in spreadsheet "1abc...xyz"
```

### Change Chart Type

**Scenario**: Convert column chart to line chart

```
Change chart 123 in spreadsheet "1abc...xyz" from column chart to line chart
```

## Managing Charts

### List All Charts

**Scenario**: Get all charts in a spreadsheet

```
List all charts in spreadsheet "1abc...xyz"
```

**Response includes**: Chart IDs, types, positions, data ranges

### Get Chart Details

**Scenario**: Get specific chart configuration

```
Get details for chart 123 in spreadsheet "1abc...xyz"
```

### Delete Chart

**Scenario**: Remove a chart

```
Delete chart 123 from spreadsheet "1abc...xyz"
```

### Duplicate Chart

**Scenario**: Copy chart to another sheet

```
Duplicate chart 123 from Sheet1 to Sheet2 in spreadsheet "1abc...xyz"
```

## Advanced Techniques

### Dynamic Data Ranges

**Scenario**: Chart automatically includes new data

```
Create a chart in spreadsheet "1abc...xyz" with data range A1:B using open-ended range notation
```

**Note**: `A1:B` includes all rows in columns A and B

### Multiple Data Sources

**Scenario**: Chart combines data from different ranges

```
Create a chart in spreadsheet "1abc...xyz" combining:
- Series 1 from Sheet1!A1:B10
- Series 2 from Sheet2!A1:B10
```

### Chart with Filters

**Scenario**: Chart shows filtered subset of data

```
Create a chart in spreadsheet "1abc...xyz" showing only rows where Status="Active" from range A1:C100
```

### Sparkline Alternative

**Scenario**: Create inline mini-charts in cells

```
Add sparkline formula to cell D2 in spreadsheet "1abc...xyz" charting values from A2:A10
```

**Sparkline formula**: `=SPARKLINE(A2:A10, {"charttype","line"})`

## Chart Templates

### Sales Dashboard Chart

```
Type: Combo chart
Data: Monthly actual vs target
Customization: Blue columns, red target line
Position: Top right of dashboard
Size: 600x400px
```

### Performance Gauge

```
Type: Pie chart (half donut)
Data: Current vs remaining percentage
Customization: Green for progress, gray for remaining
Position: Center of summary section
Size: 300x300px
```

### Trend Analysis Chart

```
Type: Line chart with area fill
Data: Time series over 12 months
Customization: Smooth line, gradient fill
Grid: Light gray horizontal lines
Size: 800x400px
```

### Comparison Bar Chart

```
Type: Horizontal bar chart
Data: Category comparisons (5-10 items)
Customization: Sorted by value, data labels
Legend: None (categories as axis labels)
Size: 500x350px
```

## Best Practices

### Data Preparation

1. **Clean data** - Remove empty rows, fix formatting
2. **Headers** - Include clear column headers
3. **Consistent types** - Don't mix text and numbers
4. **Sort logically** - Order data meaningfully

### Chart Selection

1. **Match chart to data type**:
   - Time series → Line chart
   - Categories → Column/Bar chart
   - Parts of whole → Pie chart
   - Correlation → Scatter plot

2. **Limit series** - Maximum 5-7 series per chart
3. **Consider audience** - Choose familiar chart types
4. **Test readability** - Ensure labels are legible

### Design

1. **Use consistent colors** - Match brand/theme
2. **Minimize decoration** - Focus on data
3. **Label clearly** - Title, axes, series names
4. **Appropriate scale** - Don't exaggerate trends

### Performance

1. **Limit data points** - 1000-2000 maximum per series
2. **Aggregate if needed** - Daily → Monthly for large datasets
3. **Cache chart specs** - Reuse configurations
4. **Batch updates** - Update multiple charts together

## Common Patterns

### Dashboard Creation

```
1. Design layout on paper
2. Prepare data ranges
3. Create all charts at once
4. Position and size consistently
5. Apply unified color scheme
6. Add interactivity (filters)
```

### Report Automation

```
1. Template spreadsheet with charts
2. Update data ranges
3. Charts auto-refresh
4. Export as PDF
5. Email to stakeholders
```

### Interactive Analysis

```
1. Multiple views of same data
2. Linked filters
3. Drill-down capabilities
4. Dynamic chart types
5. User-selected parameters
```

## Troubleshooting

### Chart Not Appearing

**Check**: Verify chart was created (check response)
**Check**: Ensure position is within sheet bounds
**Check**: Verify data range contains values

### Wrong Data Displayed

**Issue**: Headers included in data
**Solution**: Exclude header row from series range

**Issue**: Empty cells in range
**Solution**: Use contiguous data or filter empty cells

### Chart Looks Distorted

**Check**: Aspect ratio of width:height
**Check**: Axis scale ranges
**Check**: Font sizes are appropriate

### Performance Issues

**Issue**: Too many data points
**Solution**: Aggregate or sample data

**Issue**: Complex chart with many series
**Solution**: Simplify or split into multiple charts

## Reference Files

For advanced chart examples, see:

- `advanced-examples.json` - Complex chart configurations
- `analysis-examples.json` - Charts for data analysis
- See JSON files in `/docs/examples/` directory

## Next Steps

- **Analysis**: Learn [data analysis](./analysis.md)
- **Formatting**: See [formatting guide](./formatting.md)
- **Advanced**: Explore combo charts and custom themes

## Related Resources

- [Usage Guide](../guides/USAGE_GUIDE.md) - General usage patterns
- [Action Reference](../guides/ACTION_REFERENCE.md) - Complete chart actions
- [Performance Guide](../guides/PERFORMANCE.md) - Optimization tips
