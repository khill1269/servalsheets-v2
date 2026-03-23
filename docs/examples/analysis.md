---
title: Data Analysis Workflows
category: example
last_updated: 2026-01-31
description: Master data analysis techniques in Google Sheets using ServalSheets.
version: 1.6.0
tags: [sheets]
---

# Data Analysis Workflows

Master data analysis techniques in Google Sheets using ServalSheets.

## Overview

This guide covers:

- Formula analysis and optimization
- Data quality assessment
- Pattern detection
- Performance analysis
- Dependency tracking
- Sheet health monitoring

## Prerequisites

- ServalSheets v1.6.0 or later
- Spreadsheet with formulas and data
- Understanding of [basic operations](./basic.md)

## Analysis Tools

ServalSheets provides comprehensive analysis through the `sheets_analyze` tool with multiple specialized actions.

### Tool Actions

- `comprehensive` - Full spreadsheet analysis
- `analyze_formulas` - Formula-specific analysis
- `analyze_quality` - Data quality assessment
- `analyze_performance` - Performance bottlenecks
- `analyze_structure` - Sheet structure review

**Note:** Cell dependency tracking is available via the `sheets_dependencies` tool.

## Comprehensive Analysis

### Full Spreadsheet Analysis

**Scenario**: Get complete health report for a spreadsheet

```
Perform comprehensive analysis on spreadsheet "1abc...xyz"
```

**Behind the scenes**: ServalSheets uses `sheets_analyze` tool with `comprehensive` action

**Analysis includes**:

- Formula complexity and errors
- Data quality metrics
- Performance bottlenecks
- Structural issues
- Dependency graphs
- Optimization suggestions

**Sample response**:

```json
{
  "analysisId": "analysis-123",
  "spreadsheetId": "1abc...xyz",
  "timestamp": "2026-01-30T10:00:00Z",
  "summary": {
    "totalSheets": 5,
    "totalCells": 5000,
    "formulaCells": 450,
    "errorCells": 3,
    "healthScore": 92
  },
  "issues": [
    {
      "severity": "WARNING",
      "type": "CIRCULAR_REFERENCE",
      "location": "Sheet1!B5",
      "description": "Circular reference detected"
    }
  ],
  "recommendations": [
    {
      "priority": "HIGH",
      "category": "PERFORMANCE",
      "suggestion": "Replace VLOOKUP with INDEX/MATCH in range A1:A100"
    }
  ]
}
```

### Targeted Analysis

**Scenario**: Analyze specific sheet or range

```
Analyze formulas in range A1:E100 on Sheet1 in spreadsheet "1abc...xyz"
```

**Use when**: You want to focus analysis on specific area

## Formula Analysis

### Detect Formula Errors

**Scenario**: Find all formula errors in spreadsheet

```
Analyze all formulas in spreadsheet "1abc...xyz" and identify errors
```

**Error types detected**:

- `#DIV/0!` - Division by zero
- `#N/A` - Value not available
- `#REF!` - Invalid cell reference
- `#VALUE!` - Wrong value type
- `#NAME?` - Unrecognized function name
- `#NUM!` - Invalid numeric value
- `#NULL!` - Invalid range intersection

### Formula Complexity

**Scenario**: Identify complex formulas that may slow performance

```
Find complex formulas in spreadsheet "1abc...xyz" that may impact performance
```

**Complexity indicators**:

- Nested function depth
- Array formula size
- Volatile function usage
- Cross-sheet references
- Computation load

### Circular References

**Scenario**: Detect circular reference chains

```
Analyze spreadsheet "1abc...xyz" for circular reference dependencies
```

**Response includes**:

- Cells involved in circular reference
- Reference chain path
- Severity assessment
- Resolution suggestions

### Volatile Functions

**Scenario**: Find formulas with volatile functions

```
Identify volatile functions in spreadsheet "1abc...xyz"
```

**Volatile functions**:

- `NOW()` - Current timestamp
- `TODAY()` - Current date
- `RAND()` - Random number
- `RANDBETWEEN()` - Random in range
- `OFFSET()` - Dynamic range reference
- `INDIRECT()` - Dynamic reference

**Impact**: These recalculate on every change, affecting performance

## Data Quality

### Missing Data Detection

**Scenario**: Find empty cells in expected data ranges

```
Analyze data quality in range A1:E1000 in spreadsheet "1abc...xyz" and identify missing values
```

**Analysis includes**:

- Empty cell locations
- Percentage of completeness
- Pattern of missing data
- Impact assessment

### Duplicate Detection

**Scenario**: Find duplicate rows in dataset

```
Identify duplicate rows in range A1:D100 in spreadsheet "1abc...xyz"
```

**Duplicate handling**:

- Exact duplicates
- Fuzzy matches (similar but not identical)
- Key-based duplicates (specific columns)
- Duplicate counts

### Data Type Consistency

**Scenario**: Verify data types are consistent in columns

```
Analyze data type consistency in range A1:E100 in spreadsheet "1abc...xyz"
```

**Checks**:

- Mixed numbers and text
- Date format inconsistencies
- Currency format variations
- Boolean value consistency

### Outlier Detection

**Scenario**: Find statistical outliers in numeric data

```
Identify outliers in numeric columns B1:D100 in spreadsheet "1abc...xyz"
```

**Methods**:

- Standard deviation (σ) analysis
- Interquartile range (IQR)
- Z-score calculation
- Visual distribution analysis

## Performance Analysis

### Slow Calculation Detection

**Scenario**: Find formulas causing slow recalculation

```
Analyze performance bottlenecks in spreadsheet "1abc...xyz"
```

**Bottleneck indicators**:

- Large array formulas
- Excessive VLOOKUP calls
- Complex nested IFs
- Cross-workbook references
- Volatile function chains

### Optimization Suggestions

**Scenario**: Get actionable optimization recommendations

```
Analyze spreadsheet "1abc...xyz" and provide optimization suggestions
```

**Common suggestions**:

1. Replace VLOOKUP with INDEX/MATCH
2. Use helper columns instead of complex nesting
3. Avoid volatile functions in large ranges
4. Cache frequently used calculations
5. Use structured references in tables

### Memory Usage Analysis

**Scenario**: Assess spreadsheet size and memory impact

```
Analyze memory usage in spreadsheet "1abc...xyz"
```

**Metrics**:

- Total cell count
- Formula cell percentage
- Formatting complexity
- Embedded object count
- Estimated load time

## Structure Analysis

### Sheet Organization

**Scenario**: Review sheet structure and organization

```
Analyze sheet structure in spreadsheet "1abc...xyz"
```

**Analysis includes**:

- Sheet count and purposes
- Named range usage
- Data validation rules
- Protected ranges
- Hidden rows/columns

### Dependency Mapping

**Scenario**: Map dependencies between cells

```
Analyze dependencies for cell B10 in spreadsheet "1abc...xyz"
```

**Dependency types**:

- **Precedents**: Cells that B10 depends on
- **Dependents**: Cells that depend on B10
- **Cross-sheet**: Dependencies across sheets
- **Circular**: Circular dependency chains

**Visual representation**:

```
A1 → B5 → B10 → C20
     ↓      ↑
    C5 ←────┘
```

### Named Range Analysis

**Scenario**: Audit named range usage and health

```
Analyze named ranges in spreadsheet "1abc...xyz"
```

**Checks**:

- Unused named ranges
- Overlapping ranges
- Invalid references
- Naming conflicts

## Pattern Detection

### Data Patterns

**Scenario**: Detect patterns in data series

```
Analyze data patterns in range A1:A100 in spreadsheet "1abc...xyz"
```

**Pattern types**:

- Linear trends
- Seasonal patterns
- Cyclical behavior
- Anomalies
- Growth rates

### Formula Patterns

**Scenario**: Find repeated formula patterns

```
Identify common formula patterns in spreadsheet "1abc...xyz"
```

**Use cases**:

- Template extraction
- Best practice identification
- Consistency checking
- Refactoring opportunities

### Usage Patterns

**Scenario**: Analyze how spreadsheet is typically used

```
Analyze usage patterns in spreadsheet "1abc...xyz"
```

**Patterns include**:

- Frequently accessed ranges
- Common operations
- Edit hot spots
- Collaboration patterns

## Analysis Workflows

### Pre-Deployment Health Check

**Workflow**: Comprehensive check before sharing

```
1. Run comprehensive analysis
2. Fix all ERROR severity issues
3. Review WARNING issues
4. Apply high-priority optimizations
5. Re-analyze to verify improvements
6. Document remaining issues
```

### Performance Troubleshooting

**Workflow**: Diagnose slow spreadsheet

```
1. Run performance analysis
2. Identify top bottlenecks
3. Profile specific formulas
4. Test optimization changes
5. Measure improvement
6. Document changes
```

### Data Quality Audit

**Workflow**: Ensure data integrity

```
1. Run quality analysis
2. Check for missing data
3. Identify duplicates
4. Verify data types
5. Find outliers
6. Generate quality report
```

### Refactoring Analysis

**Workflow**: Plan formula improvements

```
1. Analyze formula complexity
2. Map dependencies
3. Identify refactoring candidates
4. Plan incremental changes
5. Test refactored formulas
6. Validate results match
```

## Best Practices

### Regular Analysis

1. **Schedule routine checks** - Weekly or monthly analysis
2. **Track metrics over time** - Monitor health score trends
3. **Act on high-priority issues** - Don't ignore warnings
4. **Document improvements** - Record what worked

### Analysis Scope

1. **Start comprehensive** - Get full picture first
2. **Drill down as needed** - Focus on problem areas
3. **Analyze incrementally** - After major changes
4. **Compare results** - Before/after analysis

### Performance

1. **Limit analysis scope** - Analyze specific sheets if slow
2. **Schedule during off-hours** - Don't impact users
3. **Cache analysis results** - Avoid redundant analysis
4. **Use sampling** - For very large datasets

### Collaboration

1. **Share analysis reports** - Keep team informed
2. **Explain recommendations** - Help others understand
3. **Track issue resolution** - Close the loop
4. **Build analysis into process** - Make it routine

## Analysis Metrics

### Health Score

**Range**: 0-100

- **90-100**: Excellent health
- **70-89**: Good, minor issues
- **50-69**: Fair, needs attention
- **Below 50**: Poor, urgent fixes needed

**Factors**:

- Error count and severity
- Performance bottlenecks
- Data quality issues
- Structural problems
- Formula complexity

### Performance Score

**Range**: 0-100

- **90-100**: Optimal performance
- **70-89**: Good performance
- **50-69**: Noticeable lag
- **Below 50**: Significant performance issues

**Factors**:

- Calculation time
- Formula efficiency
- Memory usage
- Volatile function count
- Cross-sheet references

### Quality Score

**Range**: 0-100

- **90-100**: High quality data
- **70-89**: Good with minor gaps
- **50-69**: Moderate quality issues
- **Below 50**: Poor data quality

**Factors**:

- Completeness percentage
- Duplicate count
- Type consistency
- Outlier frequency
- Validation coverage

## Advanced Techniques

### Custom Analysis Scripts

**Scenario**: Build reusable analysis templates

```
Create custom analysis for budget spreadsheets that checks:
- All totals match sum formulas
- No negative budget values
- All categories have allocations
- Variance calculations are correct
```

### Automated Monitoring

**Scenario**: Set up automated health checks

```
Schedule daily analysis of production spreadsheet "1abc...xyz" and alert on:
- Health score drops below 80
- New ERROR severity issues appear
- Performance score decreases by >10%
```

### Comparative Analysis

**Scenario**: Compare two versions of spreadsheet

```
Compare spreadsheet versions before and after optimization in "1abc...xyz" focusing on:
- Formula count changes
- Performance improvements
- Error reduction
- Health score delta
```

### Batch Analysis

**Scenario**: Analyze multiple related spreadsheets

```
Perform analysis on all budget spreadsheets for Q1 2026 and generate:
- Individual health reports
- Comparative summary
- Common issues across all
- Best practices from highest scoring
```

## Troubleshooting

### Analysis Times Out

**Issue**: Large spreadsheet takes too long
**Solution**: Analyze specific sheets or ranges

### Unexpected Issues Reported

**Issue**: Analysis flags false positives
**Solution**: Review issue severity, may be informational

### Missing Expected Issues

**Issue**: Known problems not detected
**Solution**: Use specific analysis type (formula, quality, etc.)

### Analysis Results Unclear

**Issue**: Hard to understand recommendations
**Solution**: Check `description` and `suggestion` fields for details

## Reference Files

For detailed analysis examples, see:

- `analysis-examples.json` - Complete analysis workflows
- `advanced-examples.json` - Complex analysis patterns
- `error-handling-examples.json` - Error analysis examples

## Next Steps

- **Optimization**: Apply [performance tips](../guides/PERFORMANCE.md)
- **Quality**: Implement [data validation](./basic.md)
- **Monitoring**: Set up [ongoing monitoring](../guides/MONITORING.md)

## Related Resources

- [Usage Guide](../guides/USAGE_GUIDE.md) - General usage patterns
- [Action Reference](../guides/ACTION_REFERENCE.md) - Complete action documentation
- [Performance Guide](../guides/PERFORMANCE.md) - Optimization strategies
- [Troubleshooting](../guides/TROUBLESHOOTING.md) - Common issues
