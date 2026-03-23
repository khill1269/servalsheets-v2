/**
 * Structure Analysis Helpers - Cross-Sheet Intelligence
 *
 * Provides advanced structural analysis capabilities:
 * - Header detection with multiple heuristics
 * - Data region boundary detection
 * - Schema inference (types, cardinality, uniqueness)
 * - Cross-sheet reference detection (foreign keys)
 * - Merged cell analysis
 * - Protected range detection
 *
 * Part of Ultimate Analysis Tool - Cross-Sheet Intelligence capability
 */

import type { sheets_v4 } from 'googleapis';

// ============================================================================
// Type Definitions
// ============================================================================

export interface HeaderDetectionResult {
  hasHeaders: boolean;
  headerRow: number; // 0-indexed
  confidence: number; // 0-100
  reasoning: string;
  headers: string[];
}

export interface DataRegion {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  rowCount: number;
  colCount: number;
  cellCount: number;
}

export interface ColumnSchema {
  columnIndex: number;
  columnName: string;
  inferredType: 'string' | 'number' | 'boolean' | 'date' | 'mixed';
  typeConfidence: number; // 0-100
  cardinality: number; // unique value count
  uniqueRatio: number; // unique / total (0-1)
  nullCount: number;
  nullRatio: number; // nulls / total (0-1)
  sampleValues: unknown[];
}

export interface ForeignKeyCandidate {
  sourceSheet: string;
  sourceColumn: string;
  targetSheet: string;
  targetColumn: string;
  matchRatio: number; // 0-1, how many values match
  confidence: number; // 0-100
  reasoning: string;
}

export interface MergedCellInfo {
  range: string; // A1 notation
  rowSpan: number;
  colSpan: number;
  value: unknown;
}

export interface ProtectedRangeInfo {
  range: string;
  description: string;
  warningOnly: boolean;
  editors: string[];
}

// ============================================================================
// Header Detection
// ============================================================================

/**
 * Detect header row using multiple heuristics
 *
 * Heuristics:
 * 1. Type consistency: Headers are typically all strings
 * 2. Uniqueness: Headers should have unique values
 * 3. Non-numeric: Headers are rarely all numbers
 * 4. Data pattern change: Row after headers has different type distribution
 * 5. Common header patterns: "Name", "ID", "Date", etc.
 */
export function detectHeaderRow(data: unknown[][]): HeaderDetectionResult {
  if (data.length === 0) {
    return {
      hasHeaders: false,
      headerRow: 0,
      confidence: 0,
      reasoning: 'No data provided',
      headers: [],
    };
  }

  if (data.length === 1) {
    // Single row - assume it's headers if all strings
    const allStrings = data[0]!.every(
      (cell) => typeof cell === 'string' || cell === null || cell === ''
    );
    return {
      hasHeaders: allStrings,
      headerRow: 0,
      confidence: allStrings ? 60 : 30,
      reasoning: allStrings ? 'Single row with all string values' : 'Single row with mixed types',
      headers: data[0]!.map(String),
    };
  }

  // Analyze first 3 rows for header detection
  const maxCheckRows = Math.min(3, data.length);
  const scores: number[] = [];

  for (let rowIdx = 0; rowIdx < maxCheckRows; rowIdx++) {
    let score = 0;
    const row = data[rowIdx];
    const nextRow = data[rowIdx + 1];

    if (!row || row.length === 0) continue;

    // Heuristic 1: Type consistency (all strings or nulls)
    const stringCount = row.filter(
      (cell) => typeof cell === 'string' || cell === null || cell === ''
    ).length;
    const stringRatio = stringCount / row.length;
    score += stringRatio * 25;

    // Heuristic 2: Uniqueness
    const uniqueValues = new Set(row.map(String));
    const uniqueRatio = uniqueValues.size / row.length;
    score += uniqueRatio * 20;

    // Heuristic 3: Non-numeric (headers are rarely all numbers)
    const numericCount = row.filter(
      (cell) => typeof cell === 'number' || !isNaN(Number(cell))
    ).length;
    const nonNumericRatio = 1 - numericCount / row.length;
    score += nonNumericRatio * 15;

    // Heuristic 4: Common header patterns
    const commonHeaderPatterns = [
      /^(name|id|date|time|type|status|count|total|amount|price|value)/i,
      /^(created|updated|modified|deleted)(_at|_by)?$/i,
      /^(first|last)_?(name)?$/i,
      /^(email|phone|address|city|state|zip|country)/i,
    ];
    const patternMatches = row.filter((cell) => {
      const str = String(cell);
      return commonHeaderPatterns.some((pattern) => pattern.test(str));
    }).length;
    score += (patternMatches / row.length) * 20;

    // Heuristic 5: Data pattern change in next row
    if (nextRow) {
      const rowTypes = row.map((cell) => typeof cell);
      const nextRowTypes = nextRow.map((cell) => typeof cell);
      let typeChanges = 0;
      for (let i = 0; i < Math.min(rowTypes.length, nextRowTypes.length); i++) {
        if (rowTypes[i] !== nextRowTypes[i]) typeChanges++;
      }
      const changeRatio = typeChanges / Math.min(rowTypes.length, nextRowTypes.length);
      score += changeRatio * 20;
    }

    scores.push(score);
  }

  // Find row with highest score
  const maxScore = Math.max(...scores);
  const headerRowIndex = scores.indexOf(maxScore);

  const hasHeaders = maxScore > 50; // Threshold
  const headers = hasHeaders
    ? data[headerRowIndex]!.map((cell) =>
        String(cell || `Column ${data[headerRowIndex]!.indexOf(cell) + 1}`)
      )
    : data[0]!.map((_, idx) => `Column ${idx + 1}`);

  return {
    hasHeaders,
    headerRow: headerRowIndex,
    confidence: Math.min(maxScore, 100),
    reasoning: hasHeaders
      ? `Row ${headerRowIndex + 1} detected as headers (score: ${maxScore.toFixed(1)})`
      : 'No clear header row detected',
    headers,
  };
}

// ============================================================================
// Data Region Detection
// ============================================================================

/**
 * Detect the boundary of the data region
 *
 * Identifies the rectangular region containing actual data,
 * excluding empty rows/columns at edges.
 */
export function detectDataRegion(data: unknown[][]): DataRegion {
  if (data.length === 0 || data[0]!.length === 0) {
    return {
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
      rowCount: 0,
      colCount: 0,
      cellCount: 0,
    };
  }

  // Find first non-empty row
  let startRow = 0;
  for (let r = 0; r < data.length; r++) {
    if (data[r]!.some((cell) => cell !== null && cell !== '' && cell !== undefined)) {
      startRow = r;
      break;
    }
  }

  // Find last non-empty row
  let endRow = data.length - 1;
  for (let r = data.length - 1; r >= 0; r--) {
    if (data[r]!.some((cell) => cell !== null && cell !== '' && cell !== undefined)) {
      endRow = r;
      break;
    }
  }

  // Find first non-empty column
  let startCol = 0;
  for (let c = 0; c < data[0]!.length; c++) {
    if (data.some((row) => row[c] !== null && row[c] !== '' && row[c] !== undefined)) {
      startCol = c;
      break;
    }
  }

  // Find last non-empty column
  let endCol = data[0]!.length - 1;
  for (let c = data[0]!.length - 1; c >= 0; c--) {
    if (data.some((row) => row[c] !== null && row[c] !== '' && row[c] !== undefined)) {
      endCol = c;
      break;
    }
  }

  const rowCount = endRow - startRow + 1;
  const colCount = endCol - startCol + 1;

  return {
    startRow,
    endRow,
    startCol,
    endCol,
    rowCount,
    colCount,
    cellCount: rowCount * colCount,
  };
}

// ============================================================================
// Schema Inference
// ============================================================================

/**
 * Infer schema for each column
 *
 * Analyzes column types, cardinality, uniqueness, and provides sample values.
 */
export function inferSchema(data: unknown[][], headerRow?: number): ColumnSchema[] {
  if (data.length === 0) return [];

  const hasHeaders = headerRow !== undefined;
  const dataStartRow = hasHeaders ? headerRow + 1 : 0;
  const headers = hasHeaders
    ? data[headerRow]!.map(String)
    : data[0]!.map((_, idx) => `Column ${idx + 1}`);

  const numCols = data[0]!.length;
  const schemas: ColumnSchema[] = [];

  for (let colIdx = 0; colIdx < numCols; colIdx++) {
    const columnValues = data
      .slice(dataStartRow)
      .map((row) => row[colIdx])
      .filter((val) => val !== null && val !== '' && val !== undefined);

    // Type inference
    const types: Record<string, number> = {
      string: 0,
      number: 0,
      boolean: 0,
      date: 0,
    };

    for (const val of columnValues) {
      if (typeof val === 'boolean') {
        types['boolean'] = (types['boolean'] || 0) + 1;
      } else if (typeof val === 'number') {
        types['number'] = (types['number'] || 0) + 1;
      } else if (typeof val === 'string') {
        // Check if it's a date string
        const datePattern = /^\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/;
        if (datePattern.test(val)) {
          types['date'] = (types['date'] || 0) + 1;
        } else {
          types['string'] = (types['string'] || 0) + 1;
        }
      }
    }

    // Determine dominant type
    let inferredType: ColumnSchema['inferredType'] = 'string';
    let maxCount = 0;
    for (const [type, count] of Object.entries(types)) {
      if (count > maxCount) {
        maxCount = count;
        inferredType = type as ColumnSchema['inferredType'];
      }
    }

    // If no clear dominant type, mark as mixed
    const totalTyped = Object.values(types).reduce((sum, count) => sum + count, 0);
    const dominantRatio = maxCount / totalTyped;
    if (dominantRatio < 0.8 && totalTyped > 0) {
      inferredType = 'mixed';
    }

    // Cardinality and uniqueness
    const uniqueValues = new Set(columnValues.map(String));
    const cardinality = uniqueValues.size;
    const uniqueRatio = columnValues.length > 0 ? cardinality / columnValues.length : 0;

    // Nulls
    const totalRows = data.length - dataStartRow;
    const nullCount = totalRows - columnValues.length;
    const nullRatio = totalRows > 0 ? nullCount / totalRows : 0;

    // Sample values (up to 5)
    const sampleValues = Array.from(uniqueValues).slice(0, 5);

    schemas.push({
      columnIndex: colIdx,
      columnName: headers[colIdx] || `Column ${colIdx + 1}`,
      inferredType,
      typeConfidence: Math.round(dominantRatio * 100),
      cardinality,
      uniqueRatio: Math.round(uniqueRatio * 100) / 100,
      nullCount,
      nullRatio: Math.round(nullRatio * 100) / 100,
      sampleValues,
    });
  }

  return schemas;
}

// ============================================================================
// Foreign Key Detection
// ============================================================================

/**
 * Detect potential foreign key relationships between sheets
 *
 * Looks for columns in different sheets where values overlap significantly,
 * suggesting a relationship.
 */
export function detectForeignKeys(
  sheets: Array<{
    name: string;
    data: unknown[][];
    schema: ColumnSchema[];
  }>
): ForeignKeyCandidate[] {
  const candidates: ForeignKeyCandidate[] = [];

  // Compare each sheet with every other sheet
  for (let i = 0; i < sheets.length; i++) {
    for (let j = i + 1; j < sheets.length; j++) {
      const sheet1 = sheets[i]!;
      const sheet2 = sheets[j]!;

      // Compare each column in sheet1 with each column in sheet2
      for (const col1 of sheet1.schema) {
        for (const col2 of sheet2.schema) {
          // Skip if types don't match
          if (col1.inferredType !== col2.inferredType) continue;

          // Skip if cardinality is too different
          const cardinalityRatio =
            Math.min(col1.cardinality, col2.cardinality) /
            Math.max(col1.cardinality, col2.cardinality);
          if (cardinalityRatio < 0.3) continue;

          // Extract values from both columns
          const values1 = new Set(
            sheet1.data
              .slice(1)
              .map((row) => String(row[col1.columnIndex]))
              .filter((v) => v && v !== '')
          );

          const values2 = new Set(
            sheet2.data
              .slice(1)
              .map((row) => String(row[col2.columnIndex]))
              .filter((v) => v && v !== '')
          );

          // Calculate match ratio
          const intersection = new Set([...values1].filter((x) => values2.has(x)));
          const matchRatio = intersection.size / Math.min(values1.size, values2.size);

          // If significant overlap, it's a candidate
          if (matchRatio > 0.5) {
            const confidence = Math.round(matchRatio * 100);
            candidates.push({
              sourceSheet: sheet1.name,
              sourceColumn: col1.columnName,
              targetSheet: sheet2.name,
              targetColumn: col2.columnName,
              matchRatio: Math.round(matchRatio * 100) / 100,
              confidence,
              reasoning: `${intersection.size} of ${values1.size} values match (${confidence}%)`,
            });
          }
        }
      }
    }
  }

  // Sort by confidence (highest first)
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// Merged Cell Analysis
// ============================================================================

/**
 * Analyze merged cells in a sheet
 */
export function findMergedCells(sheetData: sheets_v4.Schema$Sheet): MergedCellInfo[] {
  const mergedCells: MergedCellInfo[] = [];

  if (!sheetData.merges) return mergedCells;

  for (const merge of sheetData.merges) {
    if (
      !merge.startRowIndex ||
      !merge.endRowIndex ||
      !merge.startColumnIndex ||
      !merge.endColumnIndex
    ) {
      continue;
    }

    const rowSpan = merge.endRowIndex - merge.startRowIndex;
    const colSpan = merge.endColumnIndex - merge.startColumnIndex;

    // Get value from merged cell (top-left corner)
    let value: unknown = null;
    if (sheetData.data?.[0]?.rowData?.[merge.startRowIndex]?.values?.[merge.startColumnIndex]) {
      const cellData =
        sheetData.data![0]!.rowData![merge.startRowIndex]!.values![merge.startColumnIndex]!;
      value =
        cellData!.formattedValue ||
        cellData!.effectiveValue?.stringValue ||
        cellData!.effectiveValue?.numberValue;
    }

    // Convert to A1 notation
    const startCol = String.fromCharCode(65 + merge.startColumnIndex);
    const endCol = String.fromCharCode(65 + merge.endColumnIndex - 1);
    const range = `${startCol}${merge.startRowIndex + 1}:${endCol}${merge.endRowIndex}`;

    mergedCells.push({
      range,
      rowSpan,
      colSpan,
      value,
    });
  }

  return mergedCells;
}

// ============================================================================
// Protected Range Detection
// ============================================================================

/**
 * Detect protected ranges in a sheet
 */
export function findProtectedRanges(sheetData: sheets_v4.Schema$Sheet): ProtectedRangeInfo[] {
  const protectedRanges: ProtectedRangeInfo[] = [];

  if (!sheetData.protectedRanges) return protectedRanges;

  for (const protection of sheetData.protectedRanges) {
    const range = protection.range
      ? `${String.fromCharCode(65 + (protection.range.startColumnIndex || 0))}${(protection.range.startRowIndex || 0) + 1}:${String.fromCharCode(65 + ((protection.range.endColumnIndex || 1) - 1))}${protection.range.endRowIndex || 1}`
      : 'Entire Sheet';

    const editors = protection.editors?.users?.map((user) => user) || [];

    protectedRanges.push({
      range,
      description: protection.description || 'No description',
      warningOnly: protection.warningOnly || false,
      editors,
    });
  }

  return protectedRanges;
}
