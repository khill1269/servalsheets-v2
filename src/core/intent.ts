/**
 * ServalSheets - Intent System
 *
 * Defines the intent types for the BatchCompiler
 * Tighten-up #8: Intent-based architecture
 */

import { z } from 'zod';

export const IntentTypeSchema = z.enum([
  // Values
  'SET_VALUES',
  'CLEAR_VALUES',
  'APPEND_VALUES',

  // Structure - Sheet
  'ADD_SHEET',
  'DELETE_SHEET',
  'UPDATE_SHEET_PROPERTIES',
  'DUPLICATE_SHEET',

  // Structure - Dimensions
  'INSERT_DIMENSION',
  'DELETE_DIMENSION',
  'MOVE_DIMENSION',
  'UPDATE_DIMENSION_PROPERTIES',
  'APPEND_DIMENSION',

  // Formatting
  'UPDATE_CELLS',
  'REPEAT_CELL',
  'UPDATE_BORDERS',
  'MERGE_CELLS',
  'UNMERGE_CELLS',
  'AUTO_RESIZE_DIMENSIONS',

  // Conditional Formatting
  'ADD_CONDITIONAL_FORMAT',
  'UPDATE_CONDITIONAL_FORMAT',
  'DELETE_CONDITIONAL_FORMAT',

  // Data Validation
  'SET_DATA_VALIDATION',
  'CLEAR_DATA_VALIDATION',

  // Charts
  'ADD_CHART',
  'UPDATE_CHART',
  'DELETE_CHART',

  // Pivot Tables
  'ADD_PIVOT_TABLE',
  'UPDATE_PIVOT_TABLE',
  'DELETE_PIVOT_TABLE',

  // Filters
  'SET_BASIC_FILTER',
  'CLEAR_BASIC_FILTER',
  'SORT_RANGE',
  'ADD_FILTER_VIEW',
  'UPDATE_FILTER_VIEW',
  'DELETE_FILTER_VIEW',
  'ADD_SLICER',
  'UPDATE_SLICER',
  'DELETE_SLICER',

  // Named Ranges
  'ADD_NAMED_RANGE',
  'UPDATE_NAMED_RANGE',
  'DELETE_NAMED_RANGE',

  // Protected Ranges
  'ADD_PROTECTED_RANGE',
  'UPDATE_PROTECTED_RANGE',
  'DELETE_PROTECTED_RANGE',

  // Metadata
  'CREATE_DEVELOPER_METADATA',
  'UPDATE_DEVELOPER_METADATA',
  'DELETE_DEVELOPER_METADATA',

  // Banding
  'ADD_BANDING',
  'UPDATE_BANDING',
  'DELETE_BANDING',

  // Cut/Copy/Paste
  'CUT_PASTE',
  'COPY_PASTE',

  // Find/Replace
  'FIND_REPLACE',

  // Groups
  'ADD_DIMENSION_GROUP',
  'DELETE_DIMENSION_GROUP',
  'UPDATE_DIMENSION_GROUP',
]);

export const IntentSchema = z.object({
  type: IntentTypeSchema,
  target: z.object({
    spreadsheetId: z.string(),
    sheetId: z.number().int().optional(),
    range: z.string().optional(),
  }),
  payload: z.record(z.string(), z.unknown()),
  metadata: z.object({
    sourceTool: z.string(),
    sourceAction: z.string(),
    transactionId: z.string().optional(),
    priority: z.number().optional().default(0),
    destructive: z.boolean().optional().default(false),
    estimatedCells: z.number().int().optional(),
  }),
});

export type IntentType = z.infer<typeof IntentTypeSchema>;
export type Intent = z.infer<typeof IntentSchema>;

/**
 * Maps intent types to Google Sheets batchUpdate request types
 */
export const INTENT_TO_REQUEST_TYPE: Record<IntentType, string> = {
  SET_VALUES: 'updateCells',
  CLEAR_VALUES: 'updateCells',
  APPEND_VALUES: 'appendCells',
  ADD_SHEET: 'addSheet',
  DELETE_SHEET: 'deleteSheet',
  UPDATE_SHEET_PROPERTIES: 'updateSheetProperties',
  DUPLICATE_SHEET: 'duplicateSheet',
  INSERT_DIMENSION: 'insertDimension',
  DELETE_DIMENSION: 'deleteDimension',
  MOVE_DIMENSION: 'moveDimension',
  UPDATE_DIMENSION_PROPERTIES: 'updateDimensionProperties',
  APPEND_DIMENSION: 'appendDimension',
  UPDATE_CELLS: 'updateCells',
  REPEAT_CELL: 'repeatCell',
  UPDATE_BORDERS: 'updateBorders',
  MERGE_CELLS: 'mergeCells',
  UNMERGE_CELLS: 'unmergeCells',
  AUTO_RESIZE_DIMENSIONS: 'autoResizeDimensions',
  ADD_CONDITIONAL_FORMAT: 'addConditionalFormatRule',
  UPDATE_CONDITIONAL_FORMAT: 'updateConditionalFormatRule',
  DELETE_CONDITIONAL_FORMAT: 'deleteConditionalFormatRule',
  SET_DATA_VALIDATION: 'setDataValidation',
  CLEAR_DATA_VALIDATION: 'setDataValidation',
  ADD_CHART: 'addChart',
  UPDATE_CHART: 'updateChartSpec',
  DELETE_CHART: 'deleteEmbeddedObject',
  ADD_PIVOT_TABLE: 'updateCells',
  UPDATE_PIVOT_TABLE: 'updateCells',
  DELETE_PIVOT_TABLE: 'updateCells',
  SET_BASIC_FILTER: 'setBasicFilter',
  CLEAR_BASIC_FILTER: 'clearBasicFilter',
  SORT_RANGE: 'sortRange',
  ADD_FILTER_VIEW: 'addFilterView',
  UPDATE_FILTER_VIEW: 'updateFilterView',
  DELETE_FILTER_VIEW: 'deleteFilterView',
  ADD_SLICER: 'addSlicer',
  UPDATE_SLICER: 'updateSlicerSpec',
  DELETE_SLICER: 'deleteEmbeddedObject',
  ADD_NAMED_RANGE: 'addNamedRange',
  UPDATE_NAMED_RANGE: 'updateNamedRange',
  DELETE_NAMED_RANGE: 'deleteNamedRange',
  ADD_PROTECTED_RANGE: 'addProtectedRange',
  UPDATE_PROTECTED_RANGE: 'updateProtectedRange',
  DELETE_PROTECTED_RANGE: 'deleteProtectedRange',
  CREATE_DEVELOPER_METADATA: 'createDeveloperMetadata',
  UPDATE_DEVELOPER_METADATA: 'updateDeveloperMetadata',
  DELETE_DEVELOPER_METADATA: 'deleteDeveloperMetadata',
  ADD_BANDING: 'addBanding',
  UPDATE_BANDING: 'updateBanding',
  DELETE_BANDING: 'deleteBanding',
  CUT_PASTE: 'cutPaste',
  COPY_PASTE: 'copyPaste',
  FIND_REPLACE: 'findReplace',
  ADD_DIMENSION_GROUP: 'addDimensionGroup',
  DELETE_DIMENSION_GROUP: 'deleteDimensionGroup',
  UPDATE_DIMENSION_GROUP: 'updateDimensionGroup',
};

/**
 * Destructive intent types (require safety rails)
 */
export const DESTRUCTIVE_INTENTS = new Set<IntentType>([
  'DELETE_SHEET',
  'DELETE_DIMENSION',
  'CLEAR_VALUES',
  'DELETE_CONDITIONAL_FORMAT',
  'DELETE_CHART',
  'DELETE_PIVOT_TABLE',
  'DELETE_FILTER_VIEW',
  'DELETE_SLICER',
  'DELETE_NAMED_RANGE',
  'DELETE_PROTECTED_RANGE',
  'DELETE_DEVELOPER_METADATA',
  'DELETE_BANDING',
  'DELETE_DIMENSION_GROUP',
  'CUT_PASTE',
  'FIND_REPLACE',
]);

/**
 * High-risk intent types (require auto-snapshot)
 */
export const HIGH_RISK_INTENTS = new Set<IntentType>([
  'DELETE_SHEET',
  'DELETE_DIMENSION',
  'CLEAR_VALUES',
]);
