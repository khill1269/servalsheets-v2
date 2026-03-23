---
title: Formula Dependencies Analysis Guide
category: guide
last_updated: 2026-01-31
description: 'Tool: sheetsdependencies'
version: 1.6.0
tags: [sheets]
audience: user
difficulty: intermediate
---

# Formula Dependencies Analysis Guide

**Tool**: `sheets_dependencies`
**Purpose**: Analyze formula dependencies and understand change impact
**Version**: 1.6.0
**Last Updated**: 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Actions](#actions)
4. [Common Workflows](#common-workflows)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The `sheets_dependencies` tool analyzes formula relationships to understand how changes propagate through spreadsheets. It builds dependency graphs, detects circular references, and estimates recalculation costs.

### What is Dependency Analysis?

**Dependency analysis** tracks which cells reference other cells in formulas. This reveals:

- Which cells will recalculate when you change a value
- Circular reference loops (A1 → B1 → C1 → A1)
- Complex formulas that slow down spreadsheet performance
- The "blast radius" of a proposed change

### Key Capabilities

- **Dependency Graph Building**: Map all formula relationships
- **Impact Analysis**: See which cells are affected by a change
- **Cycle Detection**: Find circular dependency loops
- **Complexity Metrics**: Identify formula performance bottlenecks
- **Visualization Export**: Generate DOT files for Graphviz

### Tool Annotations

| Property        | Value | Meaning                                |
| --------------- | ----- | -------------------------------------- |
| readOnlyHint    | true  | No changes to spreadsheet              |
| destructiveHint | false | Analysis only, no modifications        |
| idempotentHint  | true  | Same input → same output               |
| openWorldHint   | false | No external API calls (local analysis) |

---

## Core Concepts

### Dependency vs Dependent

- **Dependencies**: Cells that a formula **reads from**
  - Example: `B1 = A1 + 1` → B1 depends on A1
  - "What cells does B1 need?"

- **Dependents**: Cells that **reference** a cell in their formulas
  - Example: `B1 = A1 + 1` → A1 has B1 as a dependent
  - "What cells need A1?"

### Dependency Chain

```
A1 (value) ──► B1 (=A1*2) ──► C1 (=B1+10) ──► D1 (=C1/2)
  └─────────────────► E1 (=A1+C1)
```

- **Direct dependencies**: B1 depends directly on A1
- **Indirect dependencies**: C1 depends on A1 indirectly (via B1)
- **Depth**: Number of levels (A1 → B1 → C1 is depth 2)

### Circular Dependencies

**Problem**: Formula references itself (directly or indirectly)

```
❌ A1 = B1 + 1
   B1 = C1 * 2
   C1 = A1 / 3
   (A1 → B1 → C1 → A1 - circular!)
```

**Result**: Calculation errors, #REF!, performance issues

### Recalculation Cost

**Complexity factors:**

- Number of affected cells
- Formula complexity (nested functions, array formulas)
- External data sources (IMPORTRANGE, database connections)

**Time estimates:**

- **instant**: < 10 cells, simple formulas
- **fast**: 10-100 cells, moderate complexity
- **moderate**: 100-1,000 cells
- **slow**: 1,000-10,000 cells
- **very_slow**: > 10,000 cells or complex array formulas

---

## Actions

### `build` - Build Dependency Graph

**Analyze all formulas and build dependency graph.**

**Use Case**: First step before any dependency analysis.

**Parameters:**

| Name          | Type    | Required | Description                                  |
| ------------- | ------- | -------- | -------------------------------------------- |
| action        | literal | ✅       | `"build"`                                    |
| spreadsheetId | string  | ✅       | Spreadsheet ID                               |
| sheetNames    | array   | ❌       | Sheet names to analyze (default: all sheets) |

**Example - All Sheets:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

**Example - Specific Sheets:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "sheetNames": ["Dashboard", "Calculations", "Data"]
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cellCount": 1500,
    "formulaCount": 350,
    "message": "Dependency graph built successfully for 1500 cells (350 formulas)"
  }
}
```

---

### `analyze_impact` - Analyze Change Impact

**Determine which cells are affected if you change a specific cell.**

**Use Case**: Before making changes, understand the ripple effects.

**Parameters:**

| Name          | Type    | Required | Description                      |
| ------------- | ------- | -------- | -------------------------------- |
| action        | literal | ✅       | `"analyze_impact"`               |
| spreadsheetId | string  | ✅       | Spreadsheet ID                   |
| cell          | string  | ✅       | Cell address (e.g., "Sheet1!A1") |

**Example:**

```json
{
  "request": {
    "action": "analyze_impact",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Dashboard!B5"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "targetCell": "Dashboard!B5",
    "directDependents": ["Dashboard!C5", "Dashboard!D5", "Summary!A10"],
    "allAffectedCells": [
      "Dashboard!C5",
      "Dashboard!D5",
      "Dashboard!E5",
      "Dashboard!F5",
      "Summary!A10",
      "Summary!B10",
      "Charts!TotalValue"
    ],
    "dependencies": ["Data!A2", "Data!B2"],
    "maxDepth": 3,
    "recalculationCost": {
      "cellCount": 7,
      "complexityScore": 25,
      "timeEstimate": "fast"
    },
    "circularDependencies": []
  }
}
```

**Understanding the Response:**

- **targetCell**: Cell you're analyzing
- **directDependents**: Cells with formulas directly referencing target
- **allAffectedCells**: All cells that will recalculate (includes indirect)
- **dependencies**: Cells the target depends on
- **maxDepth**: Longest chain from target to leaf node
- **recalculationCost**: Performance impact estimate
- **circularDependencies**: Any circular loops detected

---

### `detect_cycles` - Detect Circular Dependencies

**Find all circular dependency loops in the spreadsheet.**

**Use Case**: Troubleshoot #REF! errors, validate spreadsheet integrity.

**Parameters:**

| Name          | Type    | Required | Description       |
| ------------- | ------- | -------- | ----------------- |
| action        | literal | ✅       | `"detect_cycles"` |
| spreadsheetId | string  | ✅       | Spreadsheet ID    |

**Example:**

```json
{
  "request": {
    "action": "detect_cycles",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

**Response - No Cycles:**

```json
{
  "success": true,
  "data": {
    "circularDependencies": []
  }
}
```

**Response - Cycles Detected:**

```json
{
  "success": true,
  "data": {
    "circularDependencies": [
      {
        "cycle": ["Calculations!A1", "Calculations!B1", "Calculations!C1", "Calculations!A1"],
        "chain": "Calculations!A1 → Calculations!B1 → Calculations!C1 → Calculations!A1",
        "severity": "error"
      },
      {
        "cycle": ["Dashboard!E5", "Dashboard!E6", "Dashboard!E5"],
        "chain": "Dashboard!E5 → Dashboard!E6 → Dashboard!E5",
        "severity": "error"
      }
    ]
  }
}
```

---

### `get_dependencies` - Get Cell Dependencies

**Get list of cells that a specific cell depends on.**

**Use Case**: Understand what inputs a formula needs.

**Parameters:**

| Name          | Type    | Required | Description                      |
| ------------- | ------- | -------- | -------------------------------- |
| action        | literal | ✅       | `"get_dependencies"`             |
| spreadsheetId | string  | ✅       | Spreadsheet ID                   |
| cell          | string  | ✅       | Cell address (e.g., "Sheet1!A1") |

**Example:**

```json
{
  "request": {
    "action": "get_dependencies",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Summary!Total"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "dependencies": ["Data!A2:A100", "Data!B2:B100", "Config!TaxRate"]
  }
}
```

**Interpretation**: `Summary!Total` formula references:

- Data columns A and B (rows 2-100)
- A tax rate value in Config sheet

---

### `get_dependents` - Get Cell Dependents

**Get list of cells that depend on a specific cell.**

**Use Case**: See what formulas will break if you delete a cell.

**Parameters:**

| Name          | Type    | Required | Description                      |
| ------------- | ------- | -------- | -------------------------------- |
| action        | literal | ✅       | `"get_dependents"`               |
| spreadsheetId | string  | ✅       | Spreadsheet ID                   |
| cell          | string  | ✅       | Cell address (e.g., "Sheet1!A1") |

**Example:**

```json
{
  "request": {
    "action": "get_dependents",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Config!TaxRate"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "dependents": [
      "Summary!Total",
      "Summary!AfterTax",
      "Dashboard!FinalAmount",
      "Reports!TaxColumn"
    ]
  }
}
```

**Interpretation**: If you delete `Config!TaxRate`, these 4 cells will show #REF! errors.

---

### `get_stats` - Get Statistics

**Get overall dependency graph statistics.**

**Use Case**: Understand spreadsheet complexity, find optimization targets.

**Parameters:**

| Name          | Type    | Required | Description    |
| ------------- | ------- | -------- | -------------- |
| action        | literal | ✅       | `"get_stats"`  |
| spreadsheetId | string  | ✅       | Spreadsheet ID |

**Example:**

```json
{
  "request": {
    "action": "get_stats",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalCells": 1500,
    "formulaCells": 350,
    "valueCells": 1150,
    "totalDependencies": 875,
    "maxDepth": 5,
    "mostComplexCells": [
      {
        "cell": "Dashboard!MasterTotal",
        "dependencyCount": 42
      },
      {
        "cell": "Reports!AggregateView",
        "dependencyCount": 38
      },
      {
        "cell": "Summary!GrandTotal",
        "dependencyCount": 25
      }
    ],
    "mostInfluentialCells": [
      {
        "cell": "Config!TaxRate",
        "dependentCount": 87
      },
      {
        "cell": "Config!Currency",
        "dependentCount": 65
      },
      {
        "cell": "Data!A1",
        "dependentCount": 45
      }
    ]
  }
}
```

**Metrics Explained:**

- **totalCells**: All cells analyzed
- **formulaCells**: Cells with formulas
- **valueCells**: Cells with static values
- **totalDependencies**: Total dependency relationships
- **maxDepth**: Longest dependency chain
- **mostComplexCells**: Formulas with most dependencies (inputs)
- **mostInfluentialCells**: Cells with most dependents (outputs)

---

### `export_dot` - Export DOT Format

**Export dependency graph in DOT format for visualization.**

**Use Case**: Visualize complex dependency relationships with Graphviz.

**Parameters:**

| Name          | Type    | Required | Description    |
| ------------- | ------- | -------- | -------------- |
| action        | literal | ✅       | `"export_dot"` |
| spreadsheetId | string  | ✅       | Spreadsheet ID |

**Example:**

```json
{
  "request": {
    "action": "export_dot",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "dot": "digraph dependencies {\n  \"Data!A1\" -> \"Summary!B5\";\n  \"Data!A2\" -> \"Summary!B5\";\n  \"Summary!B5\" -> \"Dashboard!Total\";\n  \"Config!Rate\" -> \"Summary!B5\";\n}\n"
  }
}
```

**Visualizing with Graphviz:**

1. **Save DOT content to file:**

```bash
echo 'digraph dependencies { ... }' > deps.dot
```

1. **Generate visualization:**

```bash
# PNG image
dot -Tpng deps.dot -o deps.png

# SVG (scalable)
dot -Tsvg deps.dot -o deps.svg

# PDF
dot -Tpdf deps.dot -o deps.pdf
```

1. **View with online tool:**
   - https://dreampuf.github.io/GraphvizOnline/
   - Paste DOT content directly

---

## Common Workflows

### Workflow 1: Pre-Change Impact Assessment

**Goal**: Understand what will break before making changes.

**Scenario**: You want to change a formula in `Config!TaxRate`

**Steps:**

1. **Build dependency graph:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Analyze impact:**

```json
{
  "request": {
    "action": "analyze_impact",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Config!TaxRate"
  }
}
```

1. **Review results:**
   - Check `allAffectedCells` (87 cells will recalculate)
   - Check `recalculationCost.timeEstimate` ("moderate")
   - Check `circularDependencies` (none)

2. **Decision**: Safe to proceed, but expect brief recalculation delay

---

### Workflow 2: Troubleshoot Circular Reference Errors

**Goal**: Find and fix #REF! errors caused by circular dependencies.

**Scenario**: Spreadsheet showing #REF! errors

**Steps:**

1. **Build dependency graph:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Detect cycles:**

```json
{
  "request": {
    "action": "detect_cycles",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Analyze each cycle:**

```json
// Example cycle: A1 → B1 → C1 → A1
{
  "cycle": ["Sheet1!A1", "Sheet1!B1", "Sheet1!C1", "Sheet1!A1"],
  "chain": "Sheet1!A1 → Sheet1!B1 → Sheet1!C1 → Sheet1!A1"
}
```

1. **Fix strategy:**
   - Break the cycle by changing one formula
   - Option 1: Make C1 reference a different cell
   - Option 2: Make A1 a static value instead of formula

2. **Verify fix:**

```json
{
  "request": {
    "action": "detect_cycles",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

---

### Workflow 3: Identify Performance Bottlenecks

**Goal**: Find complex formulas slowing down spreadsheet.

**Steps:**

1. **Build dependency graph:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Get statistics:**

```json
{
  "request": {
    "action": "get_stats",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Review metrics:**
   - **mostComplexCells**: Formulas with many dependencies (inputs)
   - **maxDepth**: Long chains slow down recalculation

2. **Analyze each complex cell:**

```json
{
  "request": {
    "action": "get_dependencies",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Dashboard!MasterTotal"
  }
}
```

1. **Optimization strategies:**
   - Break complex formulas into intermediate steps
   - Cache intermediate results
   - Use helper columns
   - Consider QUERY or FILTER instead of nested IFs

---

### Workflow 4: Safe Cell Deletion

**Goal**: Check if a cell can be safely deleted.

**Scenario**: You want to delete `Data!OldColumn`

**Steps:**

1. **Build dependency graph:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Get dependents:**

```json
{
  "request": {
    "action": "get_dependents",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Data!OldColumn"
  }
}
```

1. **Analyze results:**
   - **No dependents**: Safe to delete
   - **Has dependents**: Review each dependent cell

2. **If dependents exist, update them first:**
   - Modify formulas to remove references
   - Or replace with alternative data source

3. **Delete cell** once dependents updated

---

### Workflow 5: Visualize Complex Relationships

**Goal**: Create visual diagram of formula dependencies.

**Steps:**

1. **Build dependency graph:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Export DOT format:**

```json
{
  "request": {
    "action": "export_dot",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Save to file:**

```bash
# Save DOT content from response
cat > dependencies.dot << 'EOF'
digraph dependencies {
  "Data!A1" -> "Summary!B5";
  "Data!A2" -> "Summary!B5";
  "Summary!B5" -> "Dashboard!Total";
}
EOF
```

1. **Generate visualization:**

```bash
# PNG with hierarchical layout
dot -Tpng -Grankdir=LR dependencies.dot -o deps.png

# Interactive SVG
dot -Tsvg dependencies.dot -o deps.svg
```

1. **Analyze diagram:**
   - Identify hotspots (nodes with many connections)
   - Find long chains (performance risk)
   - Spot circular loops (red flags)

---

## Best Practices

### Performance

1. **Build once, analyze many times**
   - Build dependency graph once
   - Run multiple analyses without rebuilding
   - Graph cached in memory during session

2. **Limit scope when possible**
   - Use `sheetNames` to analyze specific sheets
   - Reduces build time for large spreadsheets

3. **Monitor complexity metrics**
   - **maxDepth > 10**: Consider flattening formulas
   - **dependencyCount > 50**: Break into smaller formulas

### Maintenance

1. **Regular circular dependency checks**
   - Run `detect_cycles` after major formula changes
   - Include in CI/CD pipelines for template spreadsheets

2. **Document complex dependencies**
   - Export DOT diagrams for documentation
   - Annotate critical formulas with comments

3. **Track influential cells**
   - Protect cells with many dependents
   - Test changes to influential cells carefully

### Optimization

1. **Reduce dependency depth**

   ```
   ❌ Bad (depth 5):
   A1 → B1 → C1 → D1 → E1 → F1

   ✅ Better (depth 2):
   A1 → F1
   B1 → F1
   C1 → F1
   ```

2. **Minimize cross-sheet references**
   - Cross-sheet dependencies are slower
   - Consolidate related calculations on same sheet

3. **Use helper columns**

   ```
   ❌ Bad (complex formula):
   =SUMIF(A:A, B1, C:C) / COUNTIF(D:D, E1) * F1

   ✅ Better (intermediate steps):
   G1: =SUMIF(A:A, B1, C:C)
   H1: =COUNTIF(D:D, E1)
   I1: =G1 / H1 * F1
   ```

### Safety

1. **Analyze before major refactors**
   - Always run impact analysis first
   - Save backups before changing influential cells

2. **Test in copy first**
   - Make changes in duplicate spreadsheet
   - Verify no circular dependencies introduced
   - Check recalculation cost acceptable

3. **Monitor after changes**
   - Re-run stats after optimization
   - Verify complexity scores decreased
   - Check maxDepth reduced

---

## Troubleshooting

### Common Issues

#### Issue: "Build taking too long"

**Cause**: Large spreadsheet with many formulas

**Solution**:

1. **Limit scope:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "sheetNames": ["Dashboard", "Summary"]
  }
}
```

1. **Check formula count:**

```json
{
  "request": {
    "action": "get_stats",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **If > 10,000 formulas**: Consider breaking into multiple spreadsheets

---

#### Issue: "Can't find cell in dependency graph"

**Cause**: Cell has no formulas, or graph not built

**Solution**:

1. **Ensure graph is built first:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Verify cell address format:**
   - ✅ Correct: `"Sheet1!A1"`, `"'Sheet Name'!B5"`
   - ❌ Wrong: `"A1"` (missing sheet), `"Sheet1:A1"` (wrong separator)

2. **Check if cell exists:**
   - Use sheets_data tool to read cell value
   - Verify spelling of sheet name

---

#### Issue: "Circular dependencies but can't see error"

**Cause**: Google Sheets may allow some circular references with iterative calculation

**Solution**:

1. **Get cycle details:**

```json
{
  "request": {
    "action": "detect_cycles",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
  }
}
```

1. **Review each cell in cycle:**

```json
// For each cell in cycle
{
  "request": {
    "action": "get_dependencies",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "Sheet1!A1"
  }
}
```

1. **Break cycle** by removing one dependency link

---

#### Issue: "DOT export is huge/unreadable"

**Cause**: Too many cells in visualization

**Solution**:

1. **Filter by sheets:**

```json
{
  "request": {
    "action": "build",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "sheetNames": ["Dashboard"]
  }
}
```

1. **Use Graphviz filtering:**

```bash
# Show only nodes with > 5 connections
dot -Tpng -Gconcentrate=true dependencies.dot -o deps.png
```

1. **Focus on specific cell:**
   - Use `get_dependencies` and `get_dependents` for targeted view
   - Manually create DOT file with subset

---

#### Issue: "Impact analysis shows unexpected cells"

**Cause**: Indirect dependencies through array formulas or IMPORTRANGE

**Solution**:

1. **Get dependencies of affected cell:**

```json
{
  "request": {
    "action": "get_dependencies",
    "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J",
    "cell": "UnexpectedCell"
  }
}
```

1. **Trace chain backwards:**
   - Check each dependency
   - Look for array formulas (A1:Z100)
   - Check for dynamic ranges (INDIRECT, OFFSET)

2. **Review formula source code** in sheets_data

---

### Getting Help

1. **Check graph status:**

   ```json
   {
     "request": {
       "action": "get_stats",
       "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
     }
   }
   ```

2. **Export visualization:**

   ```json
   {
     "request": {
       "action": "export_dot",
       "spreadsheetId": "1A2B3C4D5E6F7G8H9I0J"
     }
   }
   ```

3. **ServalSheets documentation:**
   - [Error Handling Guide](./ERROR_HANDLING.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

---

## Additional Resources

- **Graphviz Documentation**: https://graphviz.org/documentation/
- **Graphviz Online Tool**: https://dreampuf.github.io/GraphvizOnline/
- **DOT Language Guide**: https://graphviz.org/doc/info/lang.html
- **ServalSheets Source**: [src/schemas/dependencies.ts](../../src/schemas/dependencies.ts)
- **Handler Implementation**: [src/handlers/dependencies.ts](../../src/handlers/dependencies.ts)

---

**Last Updated**: 2026-01-30 (v1.6.0)
