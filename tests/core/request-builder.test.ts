/**
 * ServalSheets v4 - Request Builder Tests
 *
 * Comprehensive unit tests for RequestBuilder static methods.
 * Tests all 50+ request builder methods with:
 * - Valid input validation
 * - Correct request structure
 * - Edge cases and boundary conditions
 * - Type safety verification
 * - Metadata generation
 */

import { describe, it, expect } from 'vitest';
import {
  RequestBuilder,
  type WrappedRequest,
  type RequestMetadata,
} from '../../src/core/request-builder.js';
import type { sheets_v4 } from 'googleapis';

// ============================================================
// Helper Functions for Common Test Patterns
// ============================================================

const createBaseOptions = (overrides = {}) => ({
  spreadsheetId: 'test-spreadsheet-id',
  sourceTool: 'sheets_data',
  sourceAction: 'updateCells',
  ...overrides,
});

const createGridRange = (overrides = {}): sheets_v4.Schema$GridRange => ({
  sheetId: 0,
  startRowIndex: 0,
  endRowIndex: 10,
  startColumnIndex: 0,
  endColumnIndex: 5,
  ...overrides,
});

const createDimensionRange = (overrides = {}): sheets_v4.Schema$DimensionRange => ({
  sheetId: 0,
  dimension: 'ROWS',
  startIndex: 0,
  endIndex: 10,
  ...overrides,
});

const createRowData = (count: number): sheets_v4.Schema$RowData[] => {
  return Array(count)
    .fill(null)
    .map(() => ({
      values: [
        { userEnteredValue: { stringValue: 'test' } },
        { userEnteredValue: { numberValue: 42 } },
      ],
    }));
};

const createCellData = (): sheets_v4.Schema$CellData => ({
  userEnteredValue: { stringValue: 'test' },
  userEnteredFormat: {
    backgroundColor: {
      red: 1.0,
      green: 0.0,
      blue: 0.0,
    },
  },
});

// ============================================================
// Test Suite: updateCells Method
// ============================================================

describe('RequestBuilder.updateCells', () => {
  it('should create updateCells request with valid inputs', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(2),
      range: createGridRange(),
      fields: 'userEnteredValue',
    };

    const result = RequestBuilder.updateCells(options);

    expect(result).toHaveProperty('request');
    expect(result).toHaveProperty('metadata');
    expect(result.request.updateCells).toBeDefined();
    expect(result.request.updateCells?.rows).toHaveLength(2);
    expect(result.request.updateCells?.range).toEqual(options.range);
    expect(result.request.updateCells?.fields).toBe('userEnteredValue');
  });

  it('should use default fields when not provided', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(1),
      range: createGridRange(),
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.request.updateCells?.fields).toBe('*');
  });

  it('should estimate cells correctly with range', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(1),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 5,
        startColumnIndex: 0,
        endColumnIndex: 3,
      }),
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.metadata.estimatedCells).toBe(15); // 5 rows * 3 columns
  });

  it('should estimate cells correctly without range', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(2),
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.metadata.estimatedCells).toBe(4); // 2 rows * 2 values each
  });

  it('should preserve metadata fields', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(1),
      transactionId: 'tx-123',
      priority: 5,
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.metadata.transactionId).toBe('tx-123');
    expect(result.metadata.priority).toBe(5);
  });

  it('should set destructive flag to false', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(1),
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.metadata.destructive).toBe(false);
    expect(result.metadata.highRisk).toBe(false);
  });

  it('should handle empty rows array', () => {
    const options = {
      ...createBaseOptions(),
      rows: [],
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.request.updateCells?.rows).toHaveLength(0);
    expect(result.metadata.estimatedCells).toBe(0);
  });

  it('should extract sheetId from range', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(1),
      range: createGridRange({ sheetId: 42 }),
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.metadata.sheetId).toBe(42);
  });
});

// ============================================================
// Test Suite: repeatCell Method
// ============================================================

describe('RequestBuilder.repeatCell', () => {
  it('should create repeatCell request with valid inputs', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      cell: createCellData(),
      fields: 'userEnteredFormat.backgroundColor',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.request.repeatCell).toBeDefined();
    expect(result.request.repeatCell?.range).toEqual(options.range);
    expect(result.request.repeatCell?.cell).toEqual(options.cell);
    expect(result.request.repeatCell?.fields).toBe('userEnteredFormat.backgroundColor');
  });

  it('should calculate estimated cells correctly', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 5,
        endRowIndex: 15,
        startColumnIndex: 2,
        endColumnIndex: 8,
      }),
      cell: createCellData(),
      fields: 'userEnteredFormat',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.metadata.estimatedCells).toBe(60); // 10 rows * 6 columns
  });

  it('should handle single cell range', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      }),
      cell: createCellData(),
      fields: 'userEnteredFormat',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.metadata.estimatedCells).toBe(1);
  });

  it('should set non-destructive metadata', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      cell: createCellData(),
      fields: 'userEnteredFormat',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.metadata.destructive).toBe(false);
    expect(result.metadata.highRisk).toBe(false);
  });
});

// ============================================================
// Test Suite: mergeCells and unmergeCells
// ============================================================

describe('RequestBuilder.mergeCells', () => {
  it('should create mergeCells request with MERGE_ALL type', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      mergeType: 'MERGE_ALL' as const,
    };

    const result = RequestBuilder.mergeCells(options);

    expect(result.request.mergeCells).toBeDefined();
    expect(result.request.mergeCells?.range).toEqual(options.range);
    expect(result.request.mergeCells?.mergeType).toBe('MERGE_ALL');
  });

  it('should support MERGE_COLUMNS merge type', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      mergeType: 'MERGE_COLUMNS' as const,
    };

    const result = RequestBuilder.mergeCells(options);

    expect(result.request.mergeCells?.mergeType).toBe('MERGE_COLUMNS');
  });

  it('should support MERGE_ROWS merge type', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      mergeType: 'MERGE_ROWS' as const,
    };

    const result = RequestBuilder.mergeCells(options);

    expect(result.request.mergeCells?.mergeType).toBe('MERGE_ROWS');
  });

  it('should calculate estimated cells for merge', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 3,
        startColumnIndex: 0,
        endColumnIndex: 4,
      }),
      mergeType: 'MERGE_ALL' as const,
    };

    const result = RequestBuilder.mergeCells(options);

    expect(result.metadata.estimatedCells).toBe(12); // 3 rows * 4 columns
  });
});

describe('RequestBuilder.unmergeCells', () => {
  it('should create unmergeCells request', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.unmergeCells(options);

    expect(result.request.unmergeCells).toBeDefined();
    expect(result.request.unmergeCells?.range).toEqual(options.range);
  });

  it('should set non-destructive metadata', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.unmergeCells(options);

    expect(result.metadata.destructive).toBe(false);
  });
});

// ============================================================
// Test Suite: copyPaste and cutPaste
// ============================================================

describe('RequestBuilder.copyPaste', () => {
  it('should create copyPaste request with default PASTE_NORMAL', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange({ sheetId: 0, startRowIndex: 0, endRowIndex: 2 }),
      destination: createGridRange({ sheetId: 0, startRowIndex: 5, endRowIndex: 7 }),
    };

    const result = RequestBuilder.copyPaste(options);

    expect(result.request.copyPaste).toBeDefined();
    expect(result.request.copyPaste?.pasteType).toBe('PASTE_NORMAL');
    expect(result.request.copyPaste?.pasteOrientation).toBe('NORMAL');
  });

  it('should support PASTE_VALUES type', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      destination: createGridRange(),
      pasteType: 'PASTE_VALUES' as const,
    };

    const result = RequestBuilder.copyPaste(options);

    expect(result.request.copyPaste?.pasteType).toBe('PASTE_VALUES');
  });

  it('should support TRANSPOSE orientation', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      destination: createGridRange(),
      pasteOrientation: 'TRANSPOSE' as const,
    };

    const result = RequestBuilder.copyPaste(options);

    expect(result.request.copyPaste?.pasteOrientation).toBe('TRANSPOSE');
  });

  it('should estimate destination cells', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      destination: createGridRange({
        startRowIndex: 0,
        endRowIndex: 5,
        startColumnIndex: 0,
        endColumnIndex: 3,
      }),
    };

    const result = RequestBuilder.copyPaste(options);

    expect(result.metadata.estimatedCells).toBe(15); // 5 rows * 3 columns
  });

  it('should use destination sheetId in metadata', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange({ sheetId: 0 }),
      destination: createGridRange({ sheetId: 2 }),
    };

    const result = RequestBuilder.copyPaste(options);

    expect(result.metadata.sheetId).toBe(2);
  });
});

describe('RequestBuilder.cutPaste', () => {
  it('should create cutPaste request', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      destination: { sheetId: 0, rowIndex: 10, columnIndex: 5 },
    };

    const result = RequestBuilder.cutPaste(options);

    expect(result.request.cutPaste).toBeDefined();
    expect(result.request.cutPaste?.source).toEqual(options.source);
    expect(result.request.cutPaste?.destination).toEqual(options.destination);
  });

  it('should set destructive flag to true', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      destination: { sheetId: 0, rowIndex: 10, columnIndex: 5 },
    };

    const result = RequestBuilder.cutPaste(options);

    expect(result.metadata.destructive).toBe(true);
    expect(result.metadata.highRisk).toBe(false);
  });

  it('should estimate source cells', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange({
        startRowIndex: 0,
        endRowIndex: 4,
        startColumnIndex: 0,
        endColumnIndex: 2,
      }),
      destination: { sheetId: 0, rowIndex: 10, columnIndex: 5 },
    };

    const result = RequestBuilder.cutPaste(options);

    expect(result.metadata.estimatedCells).toBe(8); // 4 rows * 2 columns
  });
});

// ============================================================
// Test Suite: Sheet Operations (add, delete, update)
// ============================================================

describe('RequestBuilder.addSheet', () => {
  it('should create addSheet request', () => {
    const properties: sheets_v4.Schema$SheetProperties = {
      title: 'New Sheet',
      index: 0,
      sheetId: 100,
    };

    const options = {
      ...createBaseOptions(),
      properties,
    };

    const result = RequestBuilder.addSheet(options);

    expect(result.request.addSheet).toBeDefined();
    expect(result.request.addSheet?.properties).toEqual(properties);
  });

  it('should set non-destructive metadata', () => {
    const options = {
      ...createBaseOptions(),
      properties: { title: 'New Sheet' },
    };

    const result = RequestBuilder.addSheet(options);

    expect(result.metadata.destructive).toBe(false);
  });
});

describe('RequestBuilder.deleteSheet', () => {
  it('should create deleteSheet request', () => {
    const options = {
      ...createBaseOptions(),
      sheetId: 42,
    };

    const result = RequestBuilder.deleteSheet(options);

    expect(result.request.deleteSheet).toBeDefined();
    expect(result.request.deleteSheet?.sheetId).toBe(42);
  });

  it('should mark as destructive and high-risk', () => {
    const options = {
      ...createBaseOptions(),
      sheetId: 42,
    };

    const result = RequestBuilder.deleteSheet(options);

    expect(result.metadata.destructive).toBe(true);
    expect(result.metadata.highRisk).toBe(true);
  });
});

describe('RequestBuilder.updateSheetProperties', () => {
  it('should create updateSheetProperties request', () => {
    const properties: sheets_v4.Schema$SheetProperties = {
      sheetId: 0,
      title: 'Updated Title',
    };

    const options = {
      ...createBaseOptions(),
      properties,
      fields: 'title',
    };

    const result = RequestBuilder.updateSheetProperties(options);

    expect(result.request.updateSheetProperties).toBeDefined();
    expect(result.request.updateSheetProperties?.properties).toEqual(properties);
    expect(result.request.updateSheetProperties?.fields).toBe('title');
  });
});

describe('RequestBuilder.duplicateSheet', () => {
  it('should create duplicateSheet request with required fields', () => {
    const options = {
      ...createBaseOptions(),
      sourceSheetId: 0,
    };

    const result = RequestBuilder.duplicateSheet(options);

    expect(result.request.duplicateSheet).toBeDefined();
    expect(result.request.duplicateSheet?.sourceSheetId).toBe(0);
  });

  it('should include optional fields when provided', () => {
    const options = {
      ...createBaseOptions(),
      sourceSheetId: 0,
      insertSheetIndex: 1,
      newSheetId: 100,
      newSheetName: 'Copy of Sheet',
    };

    const result = RequestBuilder.duplicateSheet(options);

    expect(result.request.duplicateSheet?.insertSheetIndex).toBe(1);
    expect(result.request.duplicateSheet?.newSheetId).toBe(100);
    expect(result.request.duplicateSheet?.newSheetName).toBe('Copy of Sheet');
  });
});

// ============================================================
// Test Suite: Dimension Operations (rows/columns)
// ============================================================

describe('RequestBuilder.insertDimension', () => {
  it('should create insertDimension request for rows', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange({ dimension: 'ROWS', startIndex: 5, endIndex: 8 }),
    };

    const result = RequestBuilder.insertDimension(options);

    expect(result.request.insertDimension).toBeDefined();
    expect(result.request.insertDimension?.range).toEqual(options.range);
  });

  it('should create insertDimension request for columns', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange({ dimension: 'COLUMNS', startIndex: 2, endIndex: 5 }),
    };

    const result = RequestBuilder.insertDimension(options);

    expect(result.request.insertDimension?.range?.dimension).toBe('COLUMNS');
  });

  it('should calculate estimated cells for dimension insert', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange({ startIndex: 0, endIndex: 5 }),
    };

    const result = RequestBuilder.insertDimension(options);

    expect(result.metadata.estimatedCells).toBe(5000); // 5 * 1000 estimate
  });

  it('should inherit from before when specified', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange(),
      inheritFromBefore: true,
    };

    const result = RequestBuilder.insertDimension(options);

    expect(result.request.insertDimension?.inheritFromBefore).toBe(true);
  });
});

describe('RequestBuilder.deleteDimension', () => {
  it('should create deleteDimension request', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange({ startIndex: 0, endIndex: 3 }),
    };

    const result = RequestBuilder.deleteDimension(options);

    expect(result.request.deleteDimension).toBeDefined();
    expect(result.request.deleteDimension?.range).toEqual(options.range);
  });

  it('should mark as destructive and high-risk', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange(),
    };

    const result = RequestBuilder.deleteDimension(options);

    expect(result.metadata.destructive).toBe(true);
    expect(result.metadata.highRisk).toBe(true);
  });
});

describe('RequestBuilder.moveDimension', () => {
  it('should create moveDimension request', () => {
    const options = {
      ...createBaseOptions(),
      source: createDimensionRange({ startIndex: 0, endIndex: 3 }),
      destinationIndex: 10,
    };

    const result = RequestBuilder.moveDimension(options);

    expect(result.request.moveDimension).toBeDefined();
    expect(result.request.moveDimension?.source).toEqual(options.source);
    expect(result.request.moveDimension?.destinationIndex).toBe(10);
  });
});

describe('RequestBuilder.updateDimensionProperties', () => {
  it('should create updateDimensionProperties request', () => {
    const properties: sheets_v4.Schema$DimensionProperties = {
      hiddenByUser: true,
    };

    const options = {
      ...createBaseOptions(),
      range: createDimensionRange(),
      properties,
      fields: 'hiddenByUser',
    };

    const result = RequestBuilder.updateDimensionProperties(options);

    expect(result.request.updateDimensionProperties).toBeDefined();
    expect(result.request.updateDimensionProperties?.properties).toEqual(properties);
    expect(result.request.updateDimensionProperties?.fields).toBe('hiddenByUser');
  });
});

describe('RequestBuilder.appendDimension', () => {
  it('should create appendDimension request for rows', () => {
    const options = {
      ...createBaseOptions(),
      sheetId: 0,
      dimension: 'ROWS' as const,
      length: 10,
    };

    const result = RequestBuilder.appendDimension(options);

    expect(result.request.appendDimension).toBeDefined();
    expect(result.request.appendDimension?.dimension).toBe('ROWS');
    expect(result.request.appendDimension?.length).toBe(10);
  });

  it('should create appendDimension request for columns', () => {
    const options = {
      ...createBaseOptions(),
      sheetId: 0,
      dimension: 'COLUMNS' as const,
      length: 5,
    };

    const result = RequestBuilder.appendDimension(options);

    expect(result.request.appendDimension?.dimension).toBe('COLUMNS');
  });

  it('should estimate cells based on length', () => {
    const options = {
      ...createBaseOptions(),
      sheetId: 0,
      dimension: 'ROWS' as const,
      length: 10,
    };

    const result = RequestBuilder.appendDimension(options);

    expect(result.metadata.estimatedCells).toBe(10000); // 10 * 1000
  });
});

describe('RequestBuilder.autoResizeDimensions', () => {
  it('should create autoResizeDimensions request', () => {
    const options = {
      ...createBaseOptions(),
      dimensions: createDimensionRange(),
    };

    const result = RequestBuilder.autoResizeDimensions(options);

    expect(result.request.autoResizeDimensions).toBeDefined();
    expect(result.request.autoResizeDimensions?.dimensions).toEqual(options.dimensions);
  });
});

// ============================================================
// Test Suite: Border and Styling Operations
// ============================================================

describe('RequestBuilder.updateBorders', () => {
  it('should create updateBorders request with all border types', () => {
    const border: sheets_v4.Schema$Border = {
      style: 'SOLID',
      width: 1,
      color: { red: 0, green: 0, blue: 0 },
    };

    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      top: border,
      bottom: border,
      left: border,
      right: border,
      innerHorizontal: border,
      innerVertical: border,
    };

    const result = RequestBuilder.updateBorders(options);

    expect(result.request.updateBorders).toBeDefined();
    expect(result.request.updateBorders?.top).toEqual(border);
    expect(result.request.updateBorders?.bottom).toEqual(border);
  });

  it('should create updateBorders request with partial borders', () => {
    const border: sheets_v4.Schema$Border = { style: 'SOLID' };

    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      top: border,
      right: border,
    };

    const result = RequestBuilder.updateBorders(options);

    expect(result.request.updateBorders?.top).toBeDefined();
    expect(result.request.updateBorders?.right).toBeDefined();
    expect(result.request.updateBorders?.bottom).toBeUndefined();
  });

  it('should calculate estimated cells', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: 4,
      }),
      top: { style: 'SOLID' },
    };

    const result = RequestBuilder.updateBorders(options);

    expect(result.metadata.estimatedCells).toBe(8); // 2 rows * 4 columns
  });
});

// ============================================================
// Test Suite: Filter Operations
// ============================================================

describe('RequestBuilder.setBasicFilter', () => {
  it('should create setBasicFilter request', () => {
    const filter: sheets_v4.Schema$BasicFilter = {
      range: createGridRange(),
    };

    const options = {
      ...createBaseOptions(),
      filter,
    };

    const result = RequestBuilder.setBasicFilter(options);

    expect(result.request.setBasicFilter).toBeDefined();
    expect(result.request.setBasicFilter?.filter).toEqual(filter);
  });

  it('should extract sheetId from filter range', () => {
    const filter: sheets_v4.Schema$BasicFilter = {
      range: createGridRange({ sheetId: 5 }),
    };

    const options = {
      ...createBaseOptions(),
      filter,
    };

    const result = RequestBuilder.setBasicFilter(options);

    expect(result.metadata.sheetId).toBe(5);
  });
});

describe('RequestBuilder.clearBasicFilter', () => {
  it('should create clearBasicFilter request', () => {
    const options = {
      ...createBaseOptions(),
      sheetId: 0,
    };

    const result = RequestBuilder.clearBasicFilter(options);

    expect(result.request.clearBasicFilter).toBeDefined();
    expect(result.request.clearBasicFilter?.sheetId).toBe(0);
  });
});

describe('RequestBuilder.addFilterView', () => {
  it('should create addFilterView request', () => {
    const filter: sheets_v4.Schema$FilterView = {
      filterId: 100,
      title: 'Filter View',
      range: createGridRange(),
    };

    const options = {
      ...createBaseOptions(),
      filter,
    };

    const result = RequestBuilder.addFilterView(options);

    expect(result.request.addFilterView).toBeDefined();
    expect(result.request.addFilterView?.filter).toEqual(filter);
  });
});

describe('RequestBuilder.updateFilterView', () => {
  it('should create updateFilterView request', () => {
    const filter: sheets_v4.Schema$FilterView = {
      filterId: 100,
      title: 'Updated Filter',
      range: createGridRange(),
    };

    const options = {
      ...createBaseOptions(),
      filter,
      fields: 'title',
    };

    const result = RequestBuilder.updateFilterView(options);

    expect(result.request.updateFilterView).toBeDefined();
    expect(result.request.updateFilterView?.filter).toEqual(filter);
  });
});

describe('RequestBuilder.deleteFilterView', () => {
  it('should create deleteFilterView request', () => {
    const options = {
      ...createBaseOptions(),
      filterId: 123,
    };

    const result = RequestBuilder.deleteFilterView(options);

    expect(result.request.deleteFilterView).toBeDefined();
    expect(result.request.deleteFilterView?.filterId).toBe(123);
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Data Validation and Conditional Formatting
// ============================================================

describe('RequestBuilder.setDataValidation', () => {
  it('should create setDataValidation request with rule', () => {
    const rule: sheets_v4.Schema$DataValidationRule = {
      allowedValues: {
        values: [{ userEnteredValue: 'Option1' }, { userEnteredValue: 'Option2' }],
      },
    };

    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      rule,
    };

    const result = RequestBuilder.setDataValidation(options);

    expect(result.request.setDataValidation).toBeDefined();
    expect(result.request.setDataValidation?.rule).toEqual(rule);
    expect(result.metadata.destructive).toBe(false);
  });

  it('should mark as destructive when removing validation', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.setDataValidation(options);

    expect(result.metadata.destructive).toBe(true); // No rule = clearing
  });

  it('should estimate cells correctly', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 5,
        startColumnIndex: 0,
        endColumnIndex: 3,
      }),
    };

    const result = RequestBuilder.setDataValidation(options);

    expect(result.metadata.estimatedCells).toBe(15); // 5 rows * 3 columns
  });
});

describe('RequestBuilder.addConditionalFormatRule', () => {
  it('should create addConditionalFormatRule request', () => {
    const rule: sheets_v4.Schema$ConditionalFormatRule = {
      ranges: [createGridRange()],
      booleanRule: {
        condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=A1>5' }] },
        format: { backgroundColor: { red: 1, green: 0, blue: 0 } },
      },
    };

    const options = {
      ...createBaseOptions(),
      rule,
      index: 0,
    };

    const result = RequestBuilder.addConditionalFormatRule(options);

    expect(result.request.addConditionalFormatRule).toBeDefined();
    expect(result.request.addConditionalFormatRule?.rule).toEqual(rule);
  });

  it('should estimate cells from all ranges', () => {
    const rule: sheets_v4.Schema$ConditionalFormatRule = {
      ranges: [
        createGridRange({
          startRowIndex: 0,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 3,
        }),
        createGridRange({
          startRowIndex: 5,
          endRowIndex: 7,
          startColumnIndex: 0,
          endColumnIndex: 3,
        }),
      ],
    };

    const options = {
      ...createBaseOptions(),
      rule,
    };

    const result = RequestBuilder.addConditionalFormatRule(options);

    expect(result.metadata.estimatedCells).toBe(12); // (2*3) + (2*3)
  });

  it('should handle rule without ranges', () => {
    const rule: sheets_v4.Schema$ConditionalFormatRule = {};

    const options = {
      ...createBaseOptions(),
      rule,
    };

    const result = RequestBuilder.addConditionalFormatRule(options);

    expect(result.metadata.estimatedCells).toBe(0);
  });
});

describe('RequestBuilder.updateConditionalFormatRule', () => {
  it('should create updateConditionalFormatRule request', () => {
    const rule: sheets_v4.Schema$ConditionalFormatRule = {
      ranges: [createGridRange()],
    };

    const options = {
      ...createBaseOptions(),
      index: 0,
      sheetId: 5,
      rule,
    };

    const result = RequestBuilder.updateConditionalFormatRule(options);

    expect(result.request.updateConditionalFormatRule).toBeDefined();
    expect(result.request.updateConditionalFormatRule?.index).toBe(0);
    expect(result.request.updateConditionalFormatRule?.sheetId).toBe(5);
  });
});

describe('RequestBuilder.deleteConditionalFormatRule', () => {
  it('should create deleteConditionalFormatRule request', () => {
    const options = {
      ...createBaseOptions(),
      index: 0,
      sheetId: 5,
    };

    const result = RequestBuilder.deleteConditionalFormatRule(options);

    expect(result.request.deleteConditionalFormatRule).toBeDefined();
    expect(result.request.deleteConditionalFormatRule?.index).toBe(0);
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Sort, Find/Replace, and Text Operations
// ============================================================

describe('RequestBuilder.sortRange', () => {
  it('should create sortRange request', () => {
    const sortSpecs: sheets_v4.Schema$SortSpec[] = [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }];

    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      sortSpecs,
    };

    const result = RequestBuilder.sortRange(options);

    expect(result.request.sortRange).toBeDefined();
    expect(result.request.sortRange?.sortSpecs).toEqual(sortSpecs);
  });

  it('should estimate cells from range', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 10,
        startColumnIndex: 0,
        endColumnIndex: 5,
      }),
      sortSpecs: [],
    };

    const result = RequestBuilder.sortRange(options);

    expect(result.metadata.estimatedCells).toBe(50); // 10 rows * 5 columns
  });
});

describe('RequestBuilder.findReplace', () => {
  it('should create findReplace request with range', () => {
    const options = {
      ...createBaseOptions(),
      find: 'oldText',
      replacement: 'newText',
      range: createGridRange(),
    };

    const result = RequestBuilder.findReplace(options);

    expect(result.request.findReplace).toBeDefined();
    expect(result.request.findReplace?.find).toBe('oldText');
    expect(result.request.findReplace?.replacement).toBe('newText');
  });

  it('should support allSheets mode', () => {
    const options = {
      ...createBaseOptions(),
      find: 'old',
      replacement: 'new',
      allSheets: true,
    };

    const result = RequestBuilder.findReplace(options);

    expect(result.request.findReplace?.allSheets).toBe(true);
  });

  it('should support search options', () => {
    const options = {
      ...createBaseOptions(),
      find: 'test',
      replacement: 'result',
      matchCase: true,
      matchEntireCell: true,
      searchByRegex: true,
      includeFormulas: true,
    };

    const result = RequestBuilder.findReplace(options);

    expect(result.request.findReplace?.matchCase).toBe(true);
    expect(result.request.findReplace?.matchEntireCell).toBe(true);
    expect(result.request.findReplace?.searchByRegex).toBe(true);
    expect(result.request.findReplace?.includeFormulas).toBe(true);
  });

  it('should mark as destructive', () => {
    const options = {
      ...createBaseOptions(),
      find: 'old',
      replacement: 'new',
    };

    const result = RequestBuilder.findReplace(options);

    expect(result.metadata.destructive).toBe(true);
  });

  it('should estimate range cells when provided', () => {
    const options = {
      ...createBaseOptions(),
      find: 'old',
      replacement: 'new',
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 5,
        startColumnIndex: 0,
        endColumnIndex: 3,
      }),
    };

    const result = RequestBuilder.findReplace(options);

    expect(result.metadata.estimatedCells).toBe(15); // 5 rows * 3 columns
  });

  it('should use default estimate for allSheets', () => {
    const options = {
      ...createBaseOptions(),
      find: 'old',
      replacement: 'new',
      allSheets: true,
    };

    const result = RequestBuilder.findReplace(options);

    expect(result.metadata.estimatedCells).toBe(10000); // Default allSheets estimate
  });
});

// ============================================================
// Test Suite: Charts and Embedded Objects
// ============================================================

describe('RequestBuilder.addChart', () => {
  it('should create addChart request', () => {
    const chart: sheets_v4.Schema$EmbeddedChart = {
      chartId: 1,
      position: {
        overlayPosition: {
          anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 0 },
        },
      },
    };

    const options = {
      ...createBaseOptions(),
      chart,
    };

    const result = RequestBuilder.addChart(options);

    expect(result.request.addChart).toBeDefined();
    expect(result.request.addChart?.chart).toEqual(chart);
  });
});

describe('RequestBuilder.updateChartSpec', () => {
  it('should create updateChartSpec request', () => {
    const spec: sheets_v4.Schema$ChartSpec = {
      title: 'Updated Chart',
    };

    const options = {
      ...createBaseOptions(),
      chartId: 1,
      spec,
    };

    const result = RequestBuilder.updateChartSpec(options);

    expect(result.request.updateChartSpec).toBeDefined();
    expect(result.request.updateChartSpec?.chartId).toBe(1);
    expect(result.request.updateChartSpec?.spec).toEqual(spec);
  });
});

describe('RequestBuilder.deleteEmbeddedObject', () => {
  it('should create deleteEmbeddedObject request', () => {
    const options = {
      ...createBaseOptions(),
      objectId: 123,
    };

    const result = RequestBuilder.deleteEmbeddedObject(options);

    expect(result.request.deleteEmbeddedObject).toBeDefined();
    expect(result.request.deleteEmbeddedObject?.objectId).toBe(123);
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Slicers
// ============================================================

describe('RequestBuilder.addSlicer', () => {
  it('should create addSlicer request', () => {
    const slicer: sheets_v4.Schema$Slicer = {
      slicerId: 1,
      title: 'Date Slicer',
      position: {
        overlayPosition: {
          anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 0 },
        },
      },
    };

    const options = {
      ...createBaseOptions(),
      slicer,
    };

    const result = RequestBuilder.addSlicer(options);

    expect(result.request.addSlicer).toBeDefined();
    expect(result.request.addSlicer?.slicer).toEqual(slicer);
  });
});

describe('RequestBuilder.updateSlicerSpec', () => {
  it('should create updateSlicerSpec request', () => {
    const spec: sheets_v4.Schema$SlicerSpec = {
      title: 'Updated Slicer',
    };

    const options = {
      ...createBaseOptions(),
      slicerId: 1,
      spec,
      fields: 'title',
    };

    const result = RequestBuilder.updateSlicerSpec(options);

    expect(result.request.updateSlicerSpec).toBeDefined();
    expect(result.request.updateSlicerSpec?.slicerId).toBe(1);
    expect(result.request.updateSlicerSpec?.spec).toEqual(spec);
  });
});

// ============================================================
// Test Suite: Named Ranges
// ============================================================

describe('RequestBuilder.addNamedRange', () => {
  it('should create addNamedRange request', () => {
    const namedRange: sheets_v4.Schema$NamedRange = {
      namedRangeId: 'range-1',
      name: 'MyRange',
      range: createGridRange(),
    };

    const options = {
      ...createBaseOptions(),
      namedRange,
    };

    const result = RequestBuilder.addNamedRange(options);

    expect(result.request.addNamedRange).toBeDefined();
    expect(result.request.addNamedRange?.namedRange).toEqual(namedRange);
  });

  it('should extract sheetId from named range', () => {
    const namedRange: sheets_v4.Schema$NamedRange = {
      name: 'MyRange',
      range: createGridRange({ sheetId: 7 }),
    };

    const options = {
      ...createBaseOptions(),
      namedRange,
    };

    const result = RequestBuilder.addNamedRange(options);

    expect(result.metadata.sheetId).toBe(7);
  });
});

describe('RequestBuilder.updateNamedRange', () => {
  it('should create updateNamedRange request', () => {
    const namedRange: sheets_v4.Schema$NamedRange = {
      namedRangeId: 'range-1',
      name: 'UpdatedRange',
    };

    const options = {
      ...createBaseOptions(),
      namedRange,
      fields: 'name',
    };

    const result = RequestBuilder.updateNamedRange(options);

    expect(result.request.updateNamedRange).toBeDefined();
    expect(result.request.updateNamedRange?.namedRange).toEqual(namedRange);
  });
});

describe('RequestBuilder.deleteNamedRange', () => {
  it('should create deleteNamedRange request', () => {
    const options = {
      ...createBaseOptions(),
      namedRangeId: 'range-1',
    };

    const result = RequestBuilder.deleteNamedRange(options);

    expect(result.request.deleteNamedRange).toBeDefined();
    expect(result.request.deleteNamedRange?.namedRangeId).toBe('range-1');
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Protected Ranges
// ============================================================

describe('RequestBuilder.addProtectedRange', () => {
  it('should create addProtectedRange request', () => {
    const protectedRange: sheets_v4.Schema$ProtectedRange = {
      protectedRangeId: 1,
      description: 'Protected Data',
      range: createGridRange(),
    };

    const options = {
      ...createBaseOptions(),
      protectedRange,
    };

    const result = RequestBuilder.addProtectedRange(options);

    expect(result.request.addProtectedRange).toBeDefined();
    expect(result.request.addProtectedRange?.protectedRange).toEqual(protectedRange);
  });
});

describe('RequestBuilder.updateProtectedRange', () => {
  it('should create updateProtectedRange request', () => {
    const protectedRange: sheets_v4.Schema$ProtectedRange = {
      protectedRangeId: 1,
      description: 'Updated Protection',
    };

    const options = {
      ...createBaseOptions(),
      protectedRange,
      fields: 'description',
    };

    const result = RequestBuilder.updateProtectedRange(options);

    expect(result.request.updateProtectedRange).toBeDefined();
    expect(result.request.updateProtectedRange?.protectedRange).toEqual(protectedRange);
  });
});

describe('RequestBuilder.deleteProtectedRange', () => {
  it('should create deleteProtectedRange request', () => {
    const options = {
      ...createBaseOptions(),
      protectedRangeId: 1,
    };

    const result = RequestBuilder.deleteProtectedRange(options);

    expect(result.request.deleteProtectedRange).toBeDefined();
    expect(result.request.deleteProtectedRange?.protectedRangeId).toBe(1);
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Banding
// ============================================================

describe('RequestBuilder.addBanding', () => {
  it('should create addBanding request', () => {
    const bandedRange: sheets_v4.Schema$BandedRange = {
      bandedRangeId: 1,
      range: createGridRange(),
    };

    const options = {
      ...createBaseOptions(),
      bandedRange,
    };

    const result = RequestBuilder.addBanding(options);

    expect(result.request.addBanding).toBeDefined();
    expect(result.request.addBanding?.bandedRange).toEqual(bandedRange);
  });
});

describe('RequestBuilder.updateBanding', () => {
  it('should create updateBanding request', () => {
    const bandedRange: sheets_v4.Schema$BandedRange = {
      bandedRangeId: 1,
      range: createGridRange(),
      columnProperties: {
        headerColor: { red: 0.9, green: 0.9, blue: 0.9 },
      },
    };

    const options = {
      ...createBaseOptions(),
      bandedRange,
      fields: 'columnProperties',
    };

    const result = RequestBuilder.updateBanding(options);

    expect(result.request.updateBanding).toBeDefined();
    expect(result.request.updateBanding?.bandedRange).toEqual(bandedRange);
  });
});

describe('RequestBuilder.deleteBanding', () => {
  it('should create deleteBanding request', () => {
    const options = {
      ...createBaseOptions(),
      bandedRangeId: 1,
    };

    const result = RequestBuilder.deleteBanding(options);

    expect(result.request.deleteBanding).toBeDefined();
    expect(result.request.deleteBanding?.bandedRangeId).toBe(1);
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Developer Metadata
// ============================================================

describe('RequestBuilder.createDeveloperMetadata', () => {
  it('should create createDeveloperMetadata request', () => {
    const metadata: sheets_v4.Schema$DeveloperMetadata = {
      metadataId: 1,
      metadataKey: 'mykey',
      metadataValue: 'myvalue',
    };

    const options = {
      ...createBaseOptions(),
      developerMetadata: metadata,
    };

    const result = RequestBuilder.createDeveloperMetadata(options);

    expect(result.request.createDeveloperMetadata).toBeDefined();
    expect(result.request.createDeveloperMetadata?.developerMetadata).toEqual(metadata);
  });
});

describe('RequestBuilder.updateDeveloperMetadata', () => {
  it('should create updateDeveloperMetadata request', () => {
    const metadata: sheets_v4.Schema$DeveloperMetadata = {
      metadataKey: 'mykey',
      metadataValue: 'newvalue',
    };

    const dataFilters: sheets_v4.Schema$DataFilter[] = [{ a1Range: 'A1:B10' }];

    const options = {
      ...createBaseOptions(),
      dataFilters,
      developerMetadata: metadata,
      fields: 'metadataValue',
    };

    const result = RequestBuilder.updateDeveloperMetadata(options);

    expect(result.request.updateDeveloperMetadata).toBeDefined();
    expect(result.request.updateDeveloperMetadata?.developerMetadata).toEqual(metadata);
  });
});

describe('RequestBuilder.deleteDeveloperMetadata', () => {
  it('should create deleteDeveloperMetadata request', () => {
    const dataFilter: sheets_v4.Schema$DataFilter = { a1Range: 'A1:B10' };

    const options = {
      ...createBaseOptions(),
      dataFilter,
    };

    const result = RequestBuilder.deleteDeveloperMetadata(options);

    expect(result.request.deleteDeveloperMetadata).toBeDefined();
    expect(result.request.deleteDeveloperMetadata?.dataFilter).toEqual(dataFilter);
    expect(result.metadata.destructive).toBe(true);
  });
});

// ============================================================
// Test Suite: Dimension Groups
// ============================================================

describe('RequestBuilder.addDimensionGroup', () => {
  it('should create addDimensionGroup request', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange({ dimension: 'ROWS', startIndex: 0, endIndex: 5 }),
    };

    const result = RequestBuilder.addDimensionGroup(options);

    expect(result.request.addDimensionGroup).toBeDefined();
    expect(result.request.addDimensionGroup?.range).toEqual(options.range);
  });
});

describe('RequestBuilder.deleteDimensionGroup', () => {
  it('should create deleteDimensionGroup request', () => {
    const options = {
      ...createBaseOptions(),
      range: createDimensionRange(),
    };

    const result = RequestBuilder.deleteDimensionGroup(options);

    expect(result.request.deleteDimensionGroup).toBeDefined();
    expect(result.metadata.destructive).toBe(true);
  });
});

describe('RequestBuilder.updateDimensionGroup', () => {
  it('should create updateDimensionGroup request', () => {
    const dimensionGroup: sheets_v4.Schema$DimensionGroup = {
      range: createDimensionRange(),
      depth: 1,
      collapsedState: [{ dimension: 'ROWS', hiddenByUser: true }],
    };

    const options = {
      ...createBaseOptions(),
      dimensionGroup,
      fields: 'collapsedState',
    };

    const result = RequestBuilder.updateDimensionGroup(options);

    expect(result.request.updateDimensionGroup).toBeDefined();
    expect(result.request.updateDimensionGroup?.dimensionGroup).toEqual(dimensionGroup);
  });
});

// ============================================================
// Test Suite: Range Utility Operations
// ============================================================

describe('RequestBuilder.trimWhitespace', () => {
  it('should create trimWhitespace request', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.trimWhitespace(options);

    expect(result.request.trimWhitespace).toBeDefined();
    expect(result.request.trimWhitespace?.range).toEqual(options.range);
  });

  it('should estimate cells with reasonable defaults', () => {
    const options = {
      ...createBaseOptions(),
      range: { sheetId: 0 }, // Minimal range
    };

    const result = RequestBuilder.trimWhitespace(options);

    expect(result.metadata.estimatedCells).toBe(26000); // 1000 rows * 26 columns default
  });
});

describe('RequestBuilder.randomizeRange', () => {
  it('should create randomizeRange request', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.randomizeRange(options);

    expect(result.request.randomizeRange).toBeDefined();
    expect(result.request.randomizeRange?.range).toEqual(options.range);
  });

  it('should mark as high-risk', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.randomizeRange(options);

    expect(result.metadata.highRisk).toBe(true);
    expect(result.metadata.destructive).toBe(false);
  });
});

describe('RequestBuilder.textToColumns', () => {
  it('should create textToColumns request with delimiter type', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      delimiterType: 'COMMA',
    };

    const result = RequestBuilder.textToColumns(options);

    expect(result.request.textToColumns).toBeDefined();
    expect(result.request.textToColumns?.delimiterType).toBe('COMMA');
  });

  it('should use DETECT as default delimiter type', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
    };

    const result = RequestBuilder.textToColumns(options);

    expect(result.request.textToColumns?.delimiterType).toBe('DETECT');
  });

  it('should support custom delimiter', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
      delimiter: '|',
    };

    const result = RequestBuilder.textToColumns(options);

    expect(result.request.textToColumns?.delimiter).toBe('|');
  });

  it('should mark as destructive and high-risk', () => {
    const options = {
      ...createBaseOptions(),
      source: createGridRange(),
    };

    const result = RequestBuilder.textToColumns(options);

    expect(result.metadata.destructive).toBe(true);
    expect(result.metadata.highRisk).toBe(true);
  });
});

describe('RequestBuilder.autoFill', () => {
  it('should create autoFill request with range', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.autoFill(options);

    expect(result.request.autoFill).toBeDefined();
    expect(result.request.autoFill?.range).toEqual(options.range);
  });

  it('should create autoFill request with sourceAndDestination', () => {
    const sourceAndDestination: sheets_v4.Schema$SourceAndDestination = {
      source: createGridRange(),
      destination: createGridRange(),
      fillLength: 5,
    };

    const options = {
      ...createBaseOptions(),
      sourceAndDestination,
    };

    const result = RequestBuilder.autoFill(options);

    expect(result.request.autoFill?.sourceAndDestination).toEqual(sourceAndDestination);
  });

  it('should support useAlternateSeries option', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
      useAlternateSeries: true,
    };

    const result = RequestBuilder.autoFill(options);

    expect(result.request.autoFill?.useAlternateSeries).toBe(true);
  });

  it('should mark as destructive', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange(),
    };

    const result = RequestBuilder.autoFill(options);

    expect(result.metadata.destructive).toBe(true);
  });

  it('should extract sheetId from range or sourceAndDestination', () => {
    const sourceAndDestination: sheets_v4.Schema$SourceAndDestination = {
      source: createGridRange({ sheetId: 3 }),
    };

    const options = {
      ...createBaseOptions(),
      sourceAndDestination,
    };

    const result = RequestBuilder.autoFill(options);

    expect(result.metadata.sheetId).toBe(3);
  });
});

// ============================================================
// Test Suite: Edge Cases and Error Conditions
// ============================================================

describe('Edge Cases and Common Patterns', () => {
  it('should handle metadata with all optional fields', () => {
    const options = {
      ...createBaseOptions(),
      rows: createRowData(1),
      transactionId: 'tx-456',
      priority: 10,
    };

    const result = RequestBuilder.updateCells(options);

    expect(result.metadata).toEqual(
      expect.objectContaining({
        sourceTool: 'sheets_data',
        sourceAction: 'updateCells',
        transactionId: 'tx-456',
        priority: 10,
        spreadsheetId: 'test-spreadsheet-id',
      })
    );
  });

  it('should preserve spreadsheet ID across all methods', () => {
    const spreadsheetId = 'unique-id-12345';
    const options = { ...createBaseOptions({ spreadsheetId }) };

    const results = [
      RequestBuilder.addSheet({ ...options, properties: { title: 'Sheet' } }),
      RequestBuilder.deleteSheet({ ...options, sheetId: 0 }),
      RequestBuilder.autoResizeDimensions({ ...options, dimensions: createDimensionRange() }),
    ];

    results.forEach((result) => {
      expect(result.metadata.spreadsheetId).toBe(spreadsheetId);
    });
  });

  it('should handle large estimated cells', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 0,
        endRowIndex: 1000,
        startColumnIndex: 0,
        endColumnIndex: 100,
      }),
      cell: createCellData(),
      fields: 'userEnteredFormat',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.metadata.estimatedCells).toBe(100000); // 1000 * 100
  });

  it('should handle zero-length ranges', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({
        startRowIndex: 5,
        endRowIndex: 5, // Zero height
        startColumnIndex: 3,
        endColumnIndex: 3, // Zero width
      }),
      cell: createCellData(),
      fields: 'userEnteredFormat',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.metadata.estimatedCells).toBe(0);
  });

  it('should handle undefined optional sheetId', () => {
    const options = {
      ...createBaseOptions(),
      range: createGridRange({ sheetId: undefined }),
      cell: createCellData(),
      fields: 'userEnteredFormat',
    };

    const result = RequestBuilder.repeatCell(options);

    expect(result.metadata.sheetId).toBeUndefined();
  });

  it('should handle multiple paste type options', () => {
    const pasteTypes = [
      'PASTE_NORMAL',
      'PASTE_VALUES',
      'PASTE_FORMAT',
      'PASTE_NO_BORDERS',
      'PASTE_FORMULA',
      'PASTE_DATA_VALIDATION',
      'PASTE_CONDITIONAL_FORMATTING',
    ] as const;

    pasteTypes.forEach((pasteType) => {
      const options = {
        ...createBaseOptions(),
        source: createGridRange(),
        destination: createGridRange(),
        pasteType,
      };

      const result = RequestBuilder.copyPaste(options);

      expect(result.request.copyPaste?.pasteType).toBe(pasteType);
    });
  });

  it('should handle dimension types correctly', () => {
    const dimensions = ['ROWS', 'COLUMNS'] as const;

    dimensions.forEach((dimension) => {
      const options = {
        ...createBaseOptions(),
        sheetId: 0,
        dimension,
        length: 5,
      };

      const result = RequestBuilder.appendDimension(options);

      expect(result.request.appendDimension?.dimension).toBe(dimension);
    });
  });
});

// ============================================================
// Test Suite: Type Safety Verification
// ============================================================

describe('Type Safety Verification', () => {
  it('should maintain WrappedRequest interface', () => {
    const result = RequestBuilder.updateCells({
      ...createBaseOptions(),
      rows: createRowData(1),
    });

    expect(result).toHaveProperty('request');
    expect(result).toHaveProperty('metadata');

    // Type check - these should exist
    const request = result.request;
    const metadata = result.metadata;

    expect(request).toBeDefined();
    expect(metadata).toBeDefined();
  });

  it('should maintain RequestMetadata interface for all methods', () => {
    const metadataChecks = [
      RequestBuilder.addSheet({ ...createBaseOptions(), properties: { title: 'Sheet' } }),
      RequestBuilder.autoResizeDimensions({
        ...createBaseOptions(),
        dimensions: createDimensionRange(),
      }),
      RequestBuilder.setBasicFilter({
        ...createBaseOptions(),
        filter: { range: createGridRange() },
      }),
    ];

    metadataChecks.forEach((result) => {
      const metadata = result.metadata as RequestMetadata;

      expect(metadata).toHaveProperty('sourceTool');
      expect(metadata).toHaveProperty('sourceAction');
      expect(metadata).toHaveProperty('destructive');
      expect(metadata).toHaveProperty('highRisk');
      expect(metadata).toHaveProperty('spreadsheetId');
    });
  });
});
