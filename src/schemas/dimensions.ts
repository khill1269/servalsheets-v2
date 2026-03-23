/**
 * Tool 6: sheets_dimensions
 * Row and column operations, filtering, and sorting
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  DimensionSchema,
  RangeInputSchema,
  A1NotationSchema,
  GridRangeSchema,
  SortOrderSchema,
  ConditionSchema,
  ColorSchema,
  ColorStyleSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ResponseMetaSchema,
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe(
    'Numeric sheet ID (provide sheetId OR sheetName, not both). Found in the gid= URL parameter.'
  ),
  sheetName: z
    .string()
    .optional()
    .describe(
      'Sheet tab name (provide sheetName OR sheetId, not both). The visible tab label at the bottom of the spreadsheet.'
    ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (summary only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe('Safety options for destructive operations'),
});

// Filter and Sort Schemas (merged from filter-sort.ts)
const FilterCriteriaSchema = z.object({
  hiddenValues: z.array(z.string()).optional(),
  condition: ConditionSchema.optional(),
  visibleBackgroundColor: ColorSchema.optional(),
  visibleForegroundColor: ColorSchema.optional(),
});

// Helper: Convert column letter(s) to zero-based index (A=0, B=1, ..., AA=26, etc.)
const columnLetterToIndex = (letter: string): number => {
  return (
    letter
      .toUpperCase()
      .split('')
      .reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1
  );
};

const SortSpecSchema = z.object({
  columnIndex: z
    .preprocess((val) => {
      // Auto-convert column letters to indices (A=0, B=1, C=2, AA=26, etc.)
      if (typeof val === 'string' && /^[A-Z]+$/i.test(val)) {
        return columnLetterToIndex(val);
      }
      return val;
    }, z.coerce.number().int().min(0))
    .describe(
      'Column to sort by: zero-based index (0, 1, 2) or column letter (A, B, C). Examples: 0 or "A" for first column, 2 or "C" for third column. Note: mapped to Google API "dimensionIndex" internally.'
    ),
  sortOrder: SortOrderSchema.optional()
    .default('ASCENDING')
    .describe('Sort order for this column (default: ASCENDING)'),
  foregroundColor: ColorSchema.optional().describe('Sort by cells with this text color'),
  backgroundColor: ColorSchema.optional().describe('Sort by cells with this background color'),
  foregroundColorStyle: ColorStyleSchema.optional().describe(
    'Sort by foreground color (supports theme colors via { themeColor: "ACCENT1" }; preferred over foregroundColor)'
  ),
  backgroundColorStyle: ColorStyleSchema.optional().describe(
    'Sort by background color (supports theme colors via { themeColor: "ACCENT1" }; preferred over backgroundColor)'
  ),
});

const SlicerPositionSchema = z
  .object({
    anchorCell: A1NotationSchema.describe(
      'Cell anchor like "P1" or "AB5". Simple cell reference (NOT rowIndex/columnIndex object)'
    ),
    offsetX: z.coerce.number().min(0, 'Offset X must be non-negative').optional().default(0),
    offsetY: z.coerce.number().min(0, 'Offset Y must be non-negative').optional().default(0),
    width: z.coerce.number().positive('Width must be positive').optional().default(200),
    height: z.coerce.number().positive('Height must be positive').optional().default(150),
  })
  .describe(
    'Position of slicer. Use simple cell reference for anchorCell (e.g., "P1" NOT {rowIndex, columnIndex})'
  );

// ============================================================================
// Consolidated Dimension Action Schemas (11 actions - reduced from 21)
// LLM Optimization: Merged row/column pairs into single actions with dimension parameter
// ============================================================================

const InsertDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('insert').describe('Insert rows or columns at a specific index'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index where to insert'),
  count: z.coerce.number().int().positive().optional().default(1).describe('Number to insert'),
  inheritFromBefore: z
    .boolean()
    .optional()
    .describe('Inherit formatting from before (false = inherit from after)'),
}).strict();

const DeleteDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete').describe('Delete rows or columns'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to delete'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
  allowMissing: z.boolean().optional().describe("Don't error when range doesn't exist"),
}).strict();

const MoveDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('move').describe('Move rows or columns to a different location'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to move'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
  destinationIndex: z.coerce.number().int().min(0).describe('Zero-based destination index'),
});

const ResizeDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('resize').describe('Resize rows or columns to specific size'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to resize'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
  pixelSize: z
    .number()
    .positive()
    .max(10000, 'Pixel size exceeds 10000 pixel limit')
    .describe('Size in pixels (height for rows, width for columns)'),
});

const AutoResizeActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('auto_resize')
    .describe(
      'Auto-resize rows or columns to fit content. If startIndex/endIndex omitted, resizes all (0 to 1000).'
    ),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Zero-based index of first to resize (default: 0)'),
  endIndex: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .default(1000)
    .describe('Zero-based index after last, exclusive (default: 1000)'),
});

const HideDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('hide').describe('Hide rows or columns'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to hide'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
});

const ShowDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('show').describe('Show hidden rows or columns'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to show'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
});

const FreezeDimensionActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('freeze')
    .describe(
      'Freeze rows or columns. Examples: freeze header row → {dimension:"ROWS",count:1}; freeze first column → {dimension:"COLUMNS",count:1}; unfreeze → {dimension:"ROWS",count:0}. To freeze both rows and columns, make two calls. Do NOT use {rows:N,columns:N} — use separate dimension+count params.'
    ),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  count: z.number().int().min(0).describe('Number to freeze (0 = unfreeze all)'),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('DEPRECATED: Use "count" instead. Auto-converted to count for compatibility.'),
}).transform((val) => {
  // Fix 2.2: Auto-fix common parameter name mistake
  if (val.position !== undefined && val.count === undefined) {
    val.count = val.position;
  }
  // Remove the deprecated field from the output

  const { position: _position, ...rest } = val;
  return rest;
});

const GroupDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('group').describe('Group rows or columns for collapsing'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to group'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
  depth: z.coerce.number().int().min(1).max(8).optional().default(1).describe('Nesting depth 1-8'),
});

const UngroupDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('ungroup').describe('Ungroup rows or columns'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  startIndex: z.coerce.number().int().min(0).describe('Zero-based index of first to ungroup'),
  endIndex: z.coerce.number().int().min(1).describe('Zero-based index after last, exclusive'),
});

const AppendDimensionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('append').describe('Append rows or columns to the end of the sheet'),
  dimension: DimensionSchema.describe('ROWS or COLUMNS'),
  count: z.coerce.number().int().positive().describe('Number to append'),
});

// ============================================================================
// Filter and Sort Action Schemas (14 actions)
// ============================================================================

const SetBasicFilterActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_basic_filter').describe('Set or update basic filter on a sheet'),
  range: RangeInputSchema.optional().describe('Range to filter (optional, defaults to sheet)'),
  criteria: z
    .record(z.coerce.number(), FilterCriteriaSchema)
    .optional()
    .describe(
      'Filter criteria by column index. If columnIndex specified, updates only that column; otherwise replaces entire filter.'
    ),
  columnIndex: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Optional: Column index to update (0-based). If provided, updates only this column's criteria instead of replacing entire filter. Enables incremental filter updates."
    ),
});

const ClearBasicFilterActionSchema = CommonFieldsSchema.extend({
  action: z.literal('clear_basic_filter').describe('Clear basic filter from a sheet'),
});

const GetBasicFilterActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_basic_filter').describe('Get basic filter from a sheet'),
});

// FilterUpdateFilterCriteriaActionSchema removed in v2.0
// Merged into SetBasicFilterActionSchema with optional columnIndex parameter

const SortRangeActionSchema = z.object({
  action: z
    .literal('sort_range')
    .describe(
      'Sort a range by one or more columns. Example: { range: "A1:D100", sortSpecs: [{ columnIndex: 0 }] } sorts by first column ascending.'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  range: RangeInputSchema.describe('Range to sort (e.g., "Sheet1!A1:D100" or "A1:D100")'),
  sortSpecs: z
    .array(SortSpecSchema)
    .min(1)
    .describe(
      'Sort specifications array. REQUIRED: Each spec MUST have columnIndex. Example: [{ columnIndex: 0 }] or [{ columnIndex: "A", sortOrder: "DESCENDING" }]'
    ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

// ============================================================================
// Range Utility Actions (5 operations - Google API coverage completion)
// ============================================================================

const DeleteDuplicatesActionSchema = z.object({
  action: z
    .literal('delete_duplicates')
    .describe('Remove duplicate rows from a range using the Google Sheets deleteDuplicates API'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  range: RangeInputSchema.describe('Range to deduplicate (sheet-qualified, e.g. Sheet1!A1:D100)'),
  comparisonColumns: z
    .array(z.number().int().nonnegative())
    .optional()
    .describe(
      'Zero-based column indices (relative to range start) to use for comparison. Omit to compare all columns.'
    ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options (supports dryRun, snapshot)'),
});

const TrimWhitespaceActionSchema = z.object({
  action: z.literal('trim_whitespace').describe('Trim leading and trailing whitespace from cells'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  range: RangeInputSchema.describe('Range whose cells to trim whitespace'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const RandomizeRangeActionSchema = z.object({
  action: z.literal('randomize_range').describe('Randomize the order of rows in a range'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  range: RangeInputSchema.describe('Range to randomize row order'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const TextToColumnsDelimiterTypeSchema = z
  .enum(['AUTODETECT', 'COMMA', 'SEMICOLON', 'PERIOD', 'SPACE', 'CUSTOM'])
  .describe('The type of delimiter to use');

const TextToColumnsActionSchema = z.object({
  action: z.literal('text_to_columns').describe('Split text in a column into multiple columns'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  source: RangeInputSchema.describe('Source range - must span exactly one column'),
  delimiterType: TextToColumnsDelimiterTypeSchema.optional()
    .default('AUTODETECT')
    .describe('Type of delimiter (AUTODETECT, COMMA, SEMICOLON, PERIOD, SPACE, CUSTOM)'),
  delimiter: z
    .string()
    .max(10)
    .optional()
    .describe('Custom delimiter string (only used when delimiterType is CUSTOM)'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const AutoFillActionSchema = z.object({
  action: z
    .literal('auto_fill')
    .describe(
      'Auto-fill data based on detected patterns. TWO MODES: ' +
        '(1) Fill within range: provide only "range" - detects source data within range and fills the rest. ' +
        '(2) Extend from source: provide "sourceRange" + "fillLength" to extend a pattern beyond the source. ' +
        'Example Mode 1: { range: "A1:A10" } fills A2:A10 based on A1 pattern. ' +
        'Example Mode 2: { sourceRange: "A1:A3", fillLength: 7 } extends pattern in A1:A3 to fill 7 more rows (A4:A10).'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  range: RangeInputSchema.optional().describe(
    'Range to auto-fill (auto-detects source data within range)'
  ),
  sourceRange: RangeInputSchema.optional().describe(
    'Explicit source range (for sourceAndDestination mode)'
  ),
  fillLength: z
    .number()
    .int()
    .optional()
    .describe(
      'Number of rows/columns to fill. Positive = expand after source, negative = expand before'
    ),
  dimension: DimensionSchema.optional()
    .default('ROWS')
    .describe('Direction to fill (ROWS or COLUMNS)'),
  useAlternateSeries: z
    .boolean()
    .optional()
    .describe('Use alternate series pattern (e.g., 1,3,5 instead of 1,2,3)'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const CreateFilterViewActionSchema = CommonFieldsSchema.extend({
  action: z.literal('create_filter_view').describe('Create a filter view'),
  title: z.string().describe('Title for the filter view'),
  range: RangeInputSchema.optional().describe('Range for the filter view'),
  criteria: z
    .record(z.coerce.number(), FilterCriteriaSchema)
    .optional()
    .describe('Filter criteria by column index'),
  sortSpecs: z.array(SortSpecSchema).optional().describe('Sort specifications'),
});

const DuplicateFilterViewActionSchema = z.object({
  action: z.literal('duplicate_filter_view').describe('Duplicate an existing filter view'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  filterViewId: z.coerce.number().int().describe('Filter view ID to duplicate'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const UpdateFilterViewActionSchema = z.object({
  action: z.literal('update_filter_view').describe('Update a filter view'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  filterViewId: z.coerce.number().int().describe('Filter view ID'),
  title: z.string().optional().describe('New title for the filter view'),
  criteria: z
    .record(z.coerce.number(), FilterCriteriaSchema)
    .optional()
    .describe('Filter criteria by column index'),
  sortSpecs: z.array(SortSpecSchema).optional().describe('Sort specifications'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const DeleteFilterViewActionSchema = z.object({
  action: z.literal('delete_filter_view').describe('Delete a filter view'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  filterViewId: z.coerce.number().int().describe('Filter view ID'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const ListFilterViewsActionSchema = z.object({
  action: z.literal('list_filter_views').describe('List all filter views'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID to filter results'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  cursor: z
    .string()
    .optional()
    .describe('Pagination cursor from previous response (numeric offset encoded as string)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Maximum number of filter views to return (default: 50, max: 500)'),
});

const GetFilterViewActionSchema = z.object({
  action: z.literal('get_filter_view').describe('Get a filter view'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  filterViewId: z.coerce.number().int().describe('Filter view ID'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

const CreateSlicerActionSchema = CommonFieldsSchema.extend({
  action: z.literal('create_slicer').describe(
    `Create interactive slicer for filtering data.

⚠️ POSITION FORMAT: Use simple cell reference in anchorCell, NOT overlayPosition object!

✅ CORRECT: {"position": {"anchorCell": "P1", "width": 200, "height": 150}}
❌ WRONG: {"position": {"overlayPosition": {"anchorCell": {sheetId, rowIndex, columnIndex}}}}

⚠️ NOTE: Slicers conflict with basic filters on the same range!
If the range has basic filters, remove them first or use sheets_dimensions.create_filter_view instead.

Alternative: Consider sheets_dimensions.create_filter_view for more reliable filtering.`
  ),
  title: z.string().optional().describe('Title for the slicer'),
  dataRange: RangeInputSchema.describe('Data range for the slicer (e.g., "Sheet1!A1:Z100")'),
  filterColumn: z.coerce.number().int().min(0).describe('0-indexed column number to filter on'),
  position: SlicerPositionSchema.describe(
    'Slicer position. Use simple cell reference like "P1" or "AB5" for anchorCell'
  ),
  filterCriteria: FilterCriteriaSchema.optional().describe(
    'Filter criteria for the slicer (hiddenValues, condition, visibleBackgroundColor, visibleForegroundColor)'
  ),
});

const UpdateSlicerActionSchema = z.object({
  action: z.literal('update_slicer').describe('Update a slicer'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  slicerId: z.coerce.number().int().describe('Slicer ID'),
  title: z.string().optional().describe('New title for the slicer'),
  filterColumn: z.coerce.number().int().min(0).optional().describe('Filter column index'),
  filterCriteria: FilterCriteriaSchema.optional().describe(
    'Updated filter criteria for the slicer (hiddenValues, condition, visibleBackgroundColor, visibleForegroundColor)'
  ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const DeleteSlicerActionSchema = z.object({
  action: z.literal('delete_slicer').describe('Delete a slicer'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID for context'),
  slicerId: z.coerce.number().int().describe('Slicer ID'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

const ListSlicersActionSchema = z.object({
  action: z.literal('list_slicers').describe('List all slicers'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Optional sheet ID to filter results'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

/**
 * All dimension, filter, and sort operation inputs
 *
 * CONSOLIDATED (29 actions - reduced from 39):
 * - Dimension actions: 11 (merged row/column pairs into single actions)
 * - Filter/sort: 4 actions (v2.0: merged filter_update_filter_criteria into set_basic_filter)
 * - Range utility: 4 actions
 * - Filter views: 6 actions
 * - Slicers: 4 actions
 *
 * LLM Optimization: Single action with dimension parameter vs separate row/column actions
 * Example: insert(dimension: 'ROWS', ...) vs insert_rows(...) and insert_columns(...)
 * v2.0: set_basic_filter now handles incremental updates via optional columnIndex parameter
 */
// LLM Action Aliases: Map deprecated row/column-specific actions to consolidated ones
// This allows LLMs to use intuitive names like "freeze_rows" which map to "freeze" + dimension: "ROWS"
const DIMENSION_ACTION_ALIASES: Record<string, { action: string; dimension: 'ROWS' | 'COLUMNS' }> =
  {
    // Freeze aliases
    freeze_rows: { action: 'freeze', dimension: 'ROWS' },
    freeze_columns: { action: 'freeze', dimension: 'COLUMNS' },
    freeze_row: { action: 'freeze', dimension: 'ROWS' },
    freeze_column: { action: 'freeze', dimension: 'COLUMNS' },
    // Insert aliases
    insert_rows: { action: 'insert', dimension: 'ROWS' },
    insert_columns: { action: 'insert', dimension: 'COLUMNS' },
    insert_row: { action: 'insert', dimension: 'ROWS' },
    insert_column: { action: 'insert', dimension: 'COLUMNS' },
    add_rows: { action: 'insert', dimension: 'ROWS' },
    add_columns: { action: 'insert', dimension: 'COLUMNS' },
    // Delete aliases
    delete_rows: { action: 'delete', dimension: 'ROWS' },
    delete_columns: { action: 'delete', dimension: 'COLUMNS' },
    delete_row: { action: 'delete', dimension: 'ROWS' },
    delete_column: { action: 'delete', dimension: 'COLUMNS' },
    remove_rows: { action: 'delete', dimension: 'ROWS' },
    remove_columns: { action: 'delete', dimension: 'COLUMNS' },
    // Resize aliases
    resize_rows: { action: 'resize', dimension: 'ROWS' },
    resize_columns: { action: 'resize', dimension: 'COLUMNS' },
    resize_row: { action: 'resize', dimension: 'ROWS' },
    resize_column: { action: 'resize', dimension: 'COLUMNS' },
    set_row_height: { action: 'resize', dimension: 'ROWS' },
    set_column_width: { action: 'resize', dimension: 'COLUMNS' },
    // Hide/Show aliases
    hide_rows: { action: 'hide', dimension: 'ROWS' },
    hide_columns: { action: 'hide', dimension: 'COLUMNS' },
    hide_row: { action: 'hide', dimension: 'ROWS' },
    hide_column: { action: 'hide', dimension: 'COLUMNS' },
    show_rows: { action: 'show', dimension: 'ROWS' },
    show_columns: { action: 'show', dimension: 'COLUMNS' },
    show_row: { action: 'show', dimension: 'ROWS' },
    show_column: { action: 'show', dimension: 'COLUMNS' },
    unhide_rows: { action: 'show', dimension: 'ROWS' },
    unhide_columns: { action: 'show', dimension: 'COLUMNS' },
    // Auto-resize aliases
    auto_resize_rows: { action: 'auto_resize', dimension: 'ROWS' },
    auto_resize_columns: { action: 'auto_resize', dimension: 'COLUMNS' },
    autofit_rows: { action: 'auto_resize', dimension: 'ROWS' },
    autofit_columns: { action: 'auto_resize', dimension: 'COLUMNS' },
    // Group aliases
    group_rows: { action: 'group', dimension: 'ROWS' },
    group_columns: { action: 'group', dimension: 'COLUMNS' },
    ungroup_rows: { action: 'ungroup', dimension: 'ROWS' },
    ungroup_columns: { action: 'ungroup', dimension: 'COLUMNS' },
    // Append aliases
    append_rows: { action: 'append', dimension: 'ROWS' },
    append_columns: { action: 'append', dimension: 'COLUMNS' },
  };

export const SheetsDimensionsInputSchema = z.object({
  request: z.preprocess(
    (val) => {
      if (typeof val !== 'object' || val === null) return val;
      const req = val as Record<string, unknown>;
      const action = req['action'];
      if (typeof action !== 'string') return val;

      // Check if this is an aliased action
      const alias = DIMENSION_ACTION_ALIASES[action.toLowerCase()];
      if (alias) {
        req['action'] = alias.action;
        req['dimension'] = req['dimension'] ?? alias.dimension; // Don't override if explicitly set
      }

      // BUG FIX 0.6: Convert count parameter to endIndex for range-based actions
      // Actions that use startIndex + endIndex: delete, move, resize, hide, show, group, ungroup
      const rangeActions = new Set([
        'delete',
        'move',
        'resize',
        'hide',
        'show',
        'group',
        'ungroup',
      ]);

      if (rangeActions.has(req['action'] as string)) {
        const count = req['count'];
        const startIndex = req['startIndex'];
        const endIndex = req['endIndex'];

        // If count is provided but endIndex is not, convert count to endIndex
        if (count !== undefined && endIndex === undefined && startIndex !== undefined) {
          const countNum = typeof count === 'number' ? count : Number(count);
          const startNum = typeof startIndex === 'number' ? startIndex : Number(startIndex);

          if (!isNaN(countNum) && !isNaN(startNum)) {
            // Create new object with endIndex and without count
            const { count: _c, ...rest } = req;
            return {
              ...rest,
              endIndex: startNum + countNum,
            };
          }
        }

        // Remove count field if it exists (even if conversion didn't happen)
        if ('count' in req) {
          const { count: _c, ...rest } = req;
          return rest;
        }
      }

      return req;
    },
    z.discriminatedUnion('action', [
      // Consolidated dimension actions (11 - was 21)
      InsertDimensionActionSchema,
      DeleteDimensionActionSchema,
      MoveDimensionActionSchema,
      ResizeDimensionActionSchema,
      AutoResizeActionSchema,
      HideDimensionActionSchema,
      ShowDimensionActionSchema,
      FreezeDimensionActionSchema,
      GroupDimensionActionSchema,
      UngroupDimensionActionSchema,
      AppendDimensionActionSchema,
      // Filter and sort actions (4 - v2.0: merged filter_update_filter_criteria into set_basic_filter)
      SetBasicFilterActionSchema, // Now handles both full and incremental updates via columnIndex
      ClearBasicFilterActionSchema,
      GetBasicFilterActionSchema,
      // FilterUpdateFilterCriteriaActionSchema removed - merged into set_basic_filter
      SortRangeActionSchema,
      // Range utility actions (5)
      DeleteDuplicatesActionSchema,
      TrimWhitespaceActionSchema,
      RandomizeRangeActionSchema,
      TextToColumnsActionSchema,
      AutoFillActionSchema,
      // Filter view actions (6)
      CreateFilterViewActionSchema,
      DuplicateFilterViewActionSchema,
      UpdateFilterViewActionSchema,
      DeleteFilterViewActionSchema,
      ListFilterViewsActionSchema,
      GetFilterViewActionSchema,
      // Slicer actions (4)
      CreateSlicerActionSchema,
      UpdateSlicerActionSchema,
      DeleteSlicerActionSchema,
      ListSlicersActionSchema,
    ])
  ),
});

const DimensionsResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // Dimension response fields
    rowsAffected: z.coerce.number().int().optional(),
    columnsAffected: z.coerce.number().int().optional(),
    newSize: z
      .object({
        rowCount: z.coerce.number().int(),
        columnCount: z.coerce.number().int(),
      })
      .optional(),
    alreadyMissing: z.boolean().optional(),
    // Filter and sort response fields
    filter: z
      .object({
        range: GridRangeSchema,
        criteria: z.record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
          ])
        ),
      })
      .optional(),
    filterViews: z
      .array(
        z.object({
          filterViewId: z.coerce.number().int(),
          title: z.string(),
          range: GridRangeSchema,
        })
      )
      .optional(),
    filterViewId: z.coerce.number().int().optional(),
    slicers: z
      .array(
        z.object({
          slicerId: z.coerce.number().int(),
          sheetId: z.coerce.number().int(),
          title: z.string().optional(),
        })
      )
      .optional(),
    slicerId: z.coerce.number().int().optional(),
    // Pagination fields (list_filter_views)
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for next page (pass as cursor in next request)'),
    hasMore: z.boolean().optional().describe('True if more results are available'),
    totalCount: z.coerce.number().int().optional().describe('Total number of filter views found'),
    // Range utility response fields
    cellsChanged: z
      .number()
      .int()
      .optional()
      .describe('Number of cells modified (for trim_whitespace)'),
    // Common fields
    dryRun: z.boolean().optional(),
    mutation: MutationSummarySchema.optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsDimensionsOutputSchema = z.object({
  response: DimensionsResponseSchema,
});

export const SHEETS_DIMENSIONS_ANNOTATIONS: ToolAnnotations = {
  title: 'Rows, Columns, Filters & Sort',
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export type SheetsDimensionsInput = z.infer<typeof SheetsDimensionsInputSchema>;
export type SheetsDimensionsOutput = z.infer<typeof SheetsDimensionsOutputSchema>;
export type DimensionsResponse = z.infer<typeof DimensionsResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type DimensionsRequest = SheetsDimensionsInput['request'];

// Type narrowing helpers for handler methods (30 action types - consolidated)
// Consolidated dimension actions (11)
export type DimensionsInsertInput = SheetsDimensionsInput['request'] & {
  action: 'insert';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
};
export type DimensionsDeleteInput = SheetsDimensionsInput['request'] & {
  action: 'delete';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
};
export type DimensionsMoveInput = SheetsDimensionsInput['request'] & {
  action: 'move';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
  destinationIndex: number;
};
export type DimensionsResizeInput = SheetsDimensionsInput['request'] & {
  action: 'resize';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
  pixelSize: number;
};
export type DimensionsAutoResizeInput = SheetsDimensionsInput['request'] & {
  action: 'auto_resize';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
};
export type DimensionsHideInput = SheetsDimensionsInput['request'] & {
  action: 'hide';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
};
export type DimensionsShowInput = SheetsDimensionsInput['request'] & {
  action: 'show';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
};
export type DimensionsFreezeInput = SheetsDimensionsInput['request'] & {
  action: 'freeze';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  count: number;
};
export type DimensionsGroupInput = SheetsDimensionsInput['request'] & {
  action: 'group';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
};
export type DimensionsUngroupInput = SheetsDimensionsInput['request'] & {
  action: 'ungroup';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
};
export type DimensionsAppendInput = SheetsDimensionsInput['request'] & {
  action: 'append';
  spreadsheetId: string;
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  count: number;
};

// Filter and Sort type helpers (merged from filter-sort.ts)
export type DimensionsSetBasicFilterInput = SheetsDimensionsInput['request'] & {
  action: 'set_basic_filter';
  spreadsheetId: string;
  sheetId: number;
};
export type DimensionsClearBasicFilterInput = SheetsDimensionsInput['request'] & {
  action: 'clear_basic_filter';
  spreadsheetId: string;
  sheetId: number;
};
export type DimensionsGetBasicFilterInput = SheetsDimensionsInput['request'] & {
  action: 'get_basic_filter';
  spreadsheetId: string;
  sheetId: number;
};
export type DimensionsFilterUpdateFilterCriteriaInput = SheetsDimensionsInput['request'] & {
  action: 'filter_update_filter_criteria';
  spreadsheetId: string;
  sheetId: number;
  columnIndex: number;
  criteria: Record<number, z.infer<typeof FilterCriteriaSchema>>;
};
export type DimensionsSortRangeInput = SheetsDimensionsInput['request'] & {
  action: 'sort_range';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
  sortSpecs: Array<z.infer<typeof SortSpecSchema>>;
};
// Range utility type helpers (4 new operations)
export type DimensionsTrimWhitespaceInput = SheetsDimensionsInput['request'] & {
  action: 'trim_whitespace';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
};
export type DimensionsRandomizeRangeInput = SheetsDimensionsInput['request'] & {
  action: 'randomize_range';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
};
export type DimensionsTextToColumnsInput = SheetsDimensionsInput['request'] & {
  action: 'text_to_columns';
  spreadsheetId: string;
  source: z.infer<typeof RangeInputSchema>;
  delimiterType?: 'AUTODETECT' | 'COMMA' | 'SEMICOLON' | 'PERIOD' | 'SPACE' | 'CUSTOM';
  delimiter?: string;
};
export type DimensionsAutoFillInput = SheetsDimensionsInput['request'] & {
  action: 'auto_fill';
  spreadsheetId: string;
  range?: z.infer<typeof RangeInputSchema>;
  sourceRange?: z.infer<typeof RangeInputSchema>;
  fillLength?: number;
  dimension?: 'ROWS' | 'COLUMNS';
  useAlternateSeries?: boolean;
};
export type DimensionsCreateFilterViewInput = SheetsDimensionsInput['request'] & {
  action: 'create_filter_view';
  spreadsheetId: string;
  sheetId: number;
  title: string;
};
export type DimensionsDuplicateFilterViewInput = SheetsDimensionsInput['request'] & {
  action: 'duplicate_filter_view';
  spreadsheetId: string;
  filterViewId: number;
};
export type DimensionsUpdateFilterViewInput = SheetsDimensionsInput['request'] & {
  action: 'update_filter_view';
  spreadsheetId: string;
  filterViewId: number;
};
export type DimensionsDeleteFilterViewInput = SheetsDimensionsInput['request'] & {
  action: 'delete_filter_view';
  spreadsheetId: string;
  filterViewId: number;
};
export type DimensionsListFilterViewsInput = SheetsDimensionsInput['request'] & {
  action: 'list_filter_views';
  spreadsheetId: string;
};
export type DimensionsGetFilterViewInput = SheetsDimensionsInput['request'] & {
  action: 'get_filter_view';
  spreadsheetId: string;
  filterViewId: number;
};
export type DimensionsCreateSlicerInput = SheetsDimensionsInput['request'] & {
  action: 'create_slicer';
  spreadsheetId: string;
  sheetId: number;
  dataRange: z.infer<typeof RangeInputSchema>;
  filterColumn: number;
  position: z.infer<typeof SlicerPositionSchema>;
};
export type DimensionsUpdateSlicerInput = SheetsDimensionsInput['request'] & {
  action: 'update_slicer';
  spreadsheetId: string;
  slicerId: number;
};
export type DimensionsDeleteSlicerInput = SheetsDimensionsInput['request'] & {
  action: 'delete_slicer';
  spreadsheetId: string;
  slicerId: number;
};
export type DimensionsListSlicersInput = SheetsDimensionsInput['request'] & {
  action: 'list_slicers';
  spreadsheetId: string;
};
export type DimensionsDeleteDuplicatesInput = SheetsDimensionsInput['request'] & {
  action: 'delete_duplicates';
  spreadsheetId: string;
  range: string;
  comparisonColumns?: number[];
};
