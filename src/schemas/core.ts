/**
 * Tool: sheets_core (Consolidated)
 * Core spreadsheet and sheet/tab operations
 *
 * Consolidates legacy sheets_spreadsheet (8 actions) + sheets_sheet (9 actions) + batch (2 actions) = 19 actions
 * MCP Protocol: 2025-11-25
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  SheetInfoSchema,
  SpreadsheetInfoSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ColorSchema,
  ColorStyleSchema,
  ResponseMetaSchema,
  GridRangeSchema,
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (summary only, 80% less tokens), standard (balanced), detailed (full metadata)'
    ),
});

const ResponseFormatSchema = z
  .enum(['full', 'compact', 'preview'])
  .describe(
    'Response format profile for read-heavy metadata actions: full (complete payload), compact (reduced token usage), preview (small sample for quick inspection)'
  );

const SheetSpecSchema = z.object({
  title: z.string().describe('Sheet/tab title'),
  rowCount: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1000)
    .describe('Initial row count (default: 1000)'),
  columnCount: z
    .number()
    .int()
    .positive()
    .optional()
    .default(26)
    .describe('Initial column count (default: 26)'),
  tabColor: ColorSchema.optional().describe(
    'DEPRECATED — prefer tabColorStyle for theme color support. Plain RGB shorthand, ignored if tabColorStyle is set.'
  ),
  tabColorStyle: ColorStyleSchema.optional().describe(
    'Tab color as RGB or theme color (Google Sheets API v4 ColorStyle)'
  ),
});

// ============================================================================
// Spreadsheet Action Schemas (8 actions)
// ============================================================================

const GetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get').describe('Get spreadsheet metadata'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  response_format: ResponseFormatSchema.optional()
    .default('full')
    .describe('Output size profile for returned metadata (full, compact, preview)'),
  includeGridData: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include cell data in response (default: false)'),
  ranges: z
    .array(z.string())
    .optional()
    .describe('Specific ranges to fetch if includeGridData=true'),
})
  .superRefine((data, ctx) => {
    if (data.includeGridData === true && (!data.ranges || data.ranges.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ranges is required when includeGridData is true',
        path: ['ranges'],
      });
    }
  })
  .strict();

const CreateActionSchema = CommonFieldsSchema.extend({
  action: z.literal('create').describe('Create a new spreadsheet'),
  title: z.string().min(1).max(255).describe('Spreadsheet title'),
  locale: z
    .string()
    .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Invalid locale format (expected: en_US, fr_FR, etc.)')
    .optional()
    .default('en_US')
    .describe('Locale for formatting (default: en_US)'),
  timeZone: z
    .string()
    .regex(
      /^[A-Za-z_]+\/[A-Za-z_]+$/,
      'Invalid timezone format (expected: America/New_York, Europe/London, etc.)'
    )
    .optional()
    .describe('Time zone like America/New_York'),
  sheets: z.array(SheetSpecSchema).optional().describe('Initial sheets/tabs to create'),
}).strict();

const CopyActionSchema = CommonFieldsSchema.extend({
  action: z.literal('copy').describe('Copy an entire spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Source spreadsheet ID'),
  newTitle: z.string().optional().describe('Title for the copied spreadsheet'),
  title: z.string().optional().describe('Alias for newTitle — title for the copied spreadsheet'),
  destinationFolderId: z.string().optional().describe('Google Drive folder ID to copy into'),
}).strict();

const UpdatePropertiesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_properties').describe('Update spreadsheet properties'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  title: z.string().min(1).max(255).optional().describe('New spreadsheet title'),
  locale: z
    .string()
    .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Invalid locale format')
    .optional()
    .describe('Locale for formatting'),
  timeZone: z
    .string()
    .regex(/^[A-Za-z_]+\/[A-Za-z_]+$/, 'Invalid timezone format')
    .optional()
    .describe('Time zone'),
  autoRecalc: z
    .enum(['ON_CHANGE', 'MINUTE', 'HOUR'])
    .optional()
    .describe('Automatic recalculation frequency'),
  spreadsheetTheme: z
    .object({
      primaryFontFamily: z.string().optional().describe('Primary font family for the theme'),
      themeColors: z
        .array(
          z.object({
            colorType: z.string().describe('Theme color type (e.g., TEXT, BACKGROUND, ACCENT1)'),
            color: z
              .object({
                red: z.number().min(0).max(1).optional(),
                green: z.number().min(0).max(1).optional(),
                blue: z.number().min(0).max(1).optional(),
              })
              .partial()
              .describe('RGB color values (0-1 range)'),
          })
        )
        .optional()
        .describe('Theme color mappings'),
    })
    .optional()
    .describe('Spreadsheet color theme applied across the entire workbook'),
  iterativeCalculationSettings: z
    .object({
      maxIterations: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .optional()
        .describe('Maximum number of iterations for circular reference resolution'),
      convergenceThreshold: z
        .number()
        .min(0)
        .optional()
        .describe('Convergence threshold for iterative calculation (0-1 range)'),
    })
    .optional()
    .describe('Configure iteration settings for circular references in formulas'),
});

const GetUrlActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_url').describe('Get the URL of a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe(
    'Optional numeric sheet ID to link to a specific tab (e.g., #gid=0)'
  ),
});

const BatchGetActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('batch_get')
    .describe(
      'Fetch metadata from multiple spreadsheets at once. Pass an array of spreadsheetIds. This is NOT for reading multiple ranges from one spreadsheet (use sheets_data:batch_read for that).'
    ),
  response_format: ResponseFormatSchema.optional()
    .default('full')
    .describe('Output size profile for returned spreadsheet list (full, compact, preview)'),
  spreadsheetIds: z
    .array(SpreadsheetIdSchema)
    .min(1)
    .max(100)
    .describe('Array of spreadsheet IDs (1-100)'),
});

const GetComprehensiveActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_comprehensive').describe('Get comprehensive spreadsheet metadata'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  includeGridData: z.boolean().optional().default(false).describe('Include cell data in response'),
  maxRowsPerSheet: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe('Max rows per sheet if includeGridData=true (default: 100)'),
  cursor: z.string().optional().describe('Pagination cursor for large workbooks'),
  maxSheets: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(10)
    .describe('Max sheets per page for pagination (default: 10)'),
});

const DescribeWorkbookActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('describe_workbook')
    .describe(
      'Return a structured metadata summary of a workbook: title, sheet dimensions, formula counts, last modified'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
});

const WorkbookFingerprintActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('workbook_fingerprint')
    .describe(
      'Return a stable SHA-256 fingerprint of a workbook structure (sheet names, dimensions, formula counts). Use to detect structural changes without reading cell data.'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
});

const ListActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list').describe('List user spreadsheets from Google Drive'),
  response_format: ResponseFormatSchema.optional()
    .default('full')
    .describe('Output size profile for returned spreadsheet list (full, compact, preview)'),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .default(100)
    .describe('Maximum number of spreadsheets to return (default: 100)'),
  query: z
    .string()
    .max(500, 'Search query exceeds 500 character limit')
    .optional()
    .describe('Search query to filter spreadsheets'),
  orderBy: z
    .enum(['createdTime', 'modifiedTime', 'name', 'viewedByMeTime'])
    .optional()
    .default('modifiedTime')
    .describe('How to order results (default: modifiedTime)'),
  pageToken: z
    .string()
    .optional()
    .describe('Continuation token from a previous list response to fetch the next page'),
});

// ============================================================================
// Sheet/Tab Action Schemas (7 actions)
// ============================================================================

const AddSheetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_sheet').describe('Add a new sheet/tab to a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  title: z.string().min(1).max(255).describe('Sheet/tab title'),
  index: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Position to insert (0 = first, omit = last)'),
  rowCount: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1000)
    .describe('Initial row count (default: 1000)'),
  columnCount: z
    .number()
    .int()
    .positive()
    .optional()
    .default(26)
    .describe('Initial column count (default: 26)'),
  tabColor: ColorSchema.optional().describe(
    'DEPRECATED — prefer tabColorStyle for theme color support. Plain RGB shorthand, ignored if tabColorStyle is set.'
  ),
  tabColorStyle: ColorStyleSchema.optional().describe(
    'Tab color as RGB or theme color (Google Sheets API v4 ColorStyle)'
  ),
  hidden: z.boolean().optional().default(false).describe('Hide the sheet (default: false)'),
});

const DeleteSheetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_sheet').describe('Delete a sheet/tab from a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID to delete'),
  allowMissing: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, don't error when sheet doesn't exist - makes delete idempotent"),
  safety: SafetyOptionsSchema.optional().describe('Safety options (dryRun, createSnapshot, etc.)'),
});

const DuplicateSheetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('duplicate_sheet').describe('Duplicate a sheet/tab within a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID to duplicate'),
  newTitle: z.string().optional().describe('Title for the duplicated sheet'),
  insertIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Position to insert duplicate (0 = first, omit = after original)'),
});

const UpdateSheetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_sheet').describe('Update sheet/tab properties'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID to update'),
  title: z.string().min(1).max(255).optional().describe('New sheet title'),
  newTitle: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe('Alias for title (deprecated — use title instead)'),
  index: z.coerce.number().int().min(0).optional().describe('New position (0 = first)'),
  tabColor: ColorSchema.optional().describe(
    'DEPRECATED — prefer tabColorStyle for theme color support. Plain RGB shorthand, ignored if tabColorStyle is set.'
  ),
  tabColorStyle: ColorStyleSchema.optional().describe(
    'Tab color as RGB or theme color (Google Sheets API v4 ColorStyle)'
  ),
  hidden: z.boolean().optional().describe('Hide/show the sheet'),
  rightToLeft: z.boolean().optional().describe('Right-to-left text direction'),
  frozenRowCount: z.number().optional(),
  frozenColumnCount: z.number().optional(),
}).superRefine((input, ctx) => {
  if (input.frozenRowCount !== undefined || input.frozenColumnCount !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Use sheets_dimensions action:"freeze" to update frozen rows/columns. The update_sheet action does not support frozenRowCount or frozenColumnCount.',
      path: ['frozenRowCount'],
    });
  }
});

const CopySheetToActionSchema = CommonFieldsSchema.extend({
  action: z.literal('copy_sheet_to').describe('Copy a sheet/tab to another spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Source spreadsheet ID'),
  sheetId: SheetIdSchema.describe('Numeric sheet ID to copy'),
  destinationSpreadsheetId: SpreadsheetIdSchema.describe('Target spreadsheet ID'),
});

const ListSheetsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_sheets').describe('List all sheets/tabs in a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  response_format: ResponseFormatSchema.optional()
    .default('full')
    .describe('Output size profile for returned sheet list (full, compact, preview)'),
});

const GetSheetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_sheet').describe('Get metadata for a specific sheet/tab'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Numeric sheet ID to retrieve (use this OR sheetName)'),
  sheetName: z.string().optional().describe('Sheet name/title to retrieve (use this OR sheetId)'),
});

// ============================================================================
// Batch Sheet Operations (ENHANCED - Issue #2 fix)
// ============================================================================

const BatchDeleteSheetsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('batch_delete_sheets')
    .describe('Delete multiple sheets in one API call (efficient)'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetIds: z
    .array(SheetIdSchema)
    .min(1)
    .max(100)
    .describe('Array of numeric sheet IDs to delete (1-100)'),
  allowMissing: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, skip sheets that don't exist instead of erroring"),
  safety: SafetyOptionsSchema.optional().describe('Safety options (dryRun, createSnapshot, etc.)'),
});

const BatchUpdateSheetsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('batch_update_sheets')
    .describe(
      'Update existing sheet properties (title, color, visibility, position) in one API call. Each item MUST have a sheetId. To add new sheets use add_sheet; to delete use delete_sheet.'
    ),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  updates: z
    .array(
      z
        .object({
          sheetId: SheetIdSchema.describe('Numeric sheet ID to update (required)'),
          title: z.string().min(1).max(255).optional().describe('New sheet title'),
          index: z.coerce.number().int().min(0).optional().describe('New position (0 = first)'),
          tabColor: ColorSchema.optional().describe(
            'DEPRECATED — prefer tabColorStyle for theme color support. Plain RGB shorthand, ignored if tabColorStyle is set.'
          ),
          hidden: z.boolean().optional().describe('Hide/show the sheet'),
        })
        .strict()
    )
    .min(1)
    .max(100)
    .describe('Array of sheet property updates (1-100). Each item needs sheetId.'),
});

// ============================================================================
// New Actions (Issue fix - missing functionality)
// ============================================================================

const ClearSheetActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('clear_sheet')
    .describe('Clear all content from a sheet while preserving the sheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Numeric sheet ID to clear (use this OR sheetName)'),
  sheetName: z.string().optional().describe('Sheet name/title to clear (use this OR sheetId)'),
  clearValues: z.boolean().optional().default(true).describe('Clear cell values (default: true)'),
  clearFormats: z
    .boolean()
    .optional()
    .default(false)
    .describe('Clear cell formatting (default: false)'),
  clearNotes: z.boolean().optional().default(false).describe('Clear cell notes (default: false)'),
});

const MoveSheetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('move_sheet').describe('Move a sheet to a new position within the spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheetId: SheetIdSchema.optional().describe('Numeric sheet ID to move (use this OR sheetName)'),
  sheetName: z.string().optional().describe('Sheet name/title to move (use this OR sheetId)'),
  newIndex: z.number().int().min(0).describe('New 0-based position to move the sheet to'),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

/**
 * All core spreadsheet and sheet/tab operation inputs
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsCoreInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    // Spreadsheet actions (8)
    GetActionSchema,
    CreateActionSchema,
    CopyActionSchema,
    UpdatePropertiesActionSchema,
    GetUrlActionSchema,
    BatchGetActionSchema,
    GetComprehensiveActionSchema,
    DescribeWorkbookActionSchema,
    WorkbookFingerprintActionSchema,
    ListActionSchema,
    // Sheet/tab actions (9 - added clear_sheet, move_sheet)
    AddSheetActionSchema,
    DeleteSheetActionSchema,
    DuplicateSheetActionSchema,
    UpdateSheetActionSchema,
    CopySheetToActionSchema,
    ListSheetsActionSchema,
    GetSheetActionSchema,
    ClearSheetActionSchema,
    MoveSheetActionSchema,
    // Batch operations (Issue #2 fix - efficient multi-sheet operations)
    BatchDeleteSheetsActionSchema,
    BatchUpdateSheetsActionSchema,
  ]),
});

const CoreResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // Spreadsheet responses
    spreadsheet: SpreadsheetInfoSchema.optional(),
    spreadsheets: z.array(SpreadsheetInfoSchema).optional(),
    url: z.string().optional(),
    newSpreadsheetId: z.string().optional(),
    // Sheet responses
    sheet: SheetInfoSchema.optional(),
    sheets: z.array(SheetInfoSchema).optional(),
    responseFormat: z
      .enum(['full', 'compact', 'preview'])
      .optional()
      .describe('Applied response_format profile'),
    truncated: z.boolean().optional().describe('True when response_format returned a partial list'),
    _responseFormatHint: z
      .string()
      .optional()
      .describe('Guidance for fetching complete metadata when response_format truncates payload'),
    totalSheets: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total sheets before response_format shaping'),
    returnedSheets: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Sheets returned after response_format shaping'),
    totalSpreadsheets: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total spreadsheets before response_format shaping'),
    returnedSpreadsheets: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Spreadsheets returned after response_format shaping'),
    copiedSheetId: z.coerce.number().int().optional(),
    /** True if delete was called but sheet was already missing (with allowMissing=true) */
    alreadyDeleted: z.boolean().optional(),
    // Batch operation responses
    /** Number of sheets deleted in batch operation */
    deletedCount: z.coerce.number().int().optional(),
    /** Sheet IDs that were skipped (didn't exist with allowMissing=true) */
    skippedSheetIds: z.array(z.coerce.number().int()).optional(),
    /** Number of sheets updated in batch operation */
    updatedCount: z.coerce.number().int().optional(),
    // Common fields
    dryRun: z.boolean().optional(),
    mutation: MutationSummarySchema.optional(),
    snapshotId: z.string().optional().describe('Snapshot ID for rollback (if created)'),
    // Comprehensive metadata (get_comprehensive action)
    comprehensiveMetadata: z
      .object({
        spreadsheetId: z.string(),
        properties: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Spreadsheet properties (Google API passthrough, may contain nested objects)'),
        namedRanges: z
          .array(
            z.record(
              z.string(),
              z.union([
                z.string(),
                z.number(),
                z.boolean(),
                z.null(),
                z.lazy(() => z.record(z.string(), z.any())),
              ])
            )
          )
          .optional()
          .describe('Named ranges with metadata'),
        sheets: z
          .array(
            z.object({
              properties: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('Sheet properties (Google API passthrough, may contain nested objects)'),
              conditionalFormats: z
                .array(
                  z.object({
                    ranges: z.array(GridRangeSchema).optional(),
                    booleanRule: z
                      .object({
                        condition: z.record(z.string(), z.any()).optional(),
                        format: z.record(z.string(), z.any()).optional(),
                      })
                      .optional(),
                    gradientRule: z
                      .object({
                        minpoint: z.record(z.string(), z.any()).optional(),
                        midpoint: z.record(z.string(), z.any()).optional(),
                        maxpoint: z.record(z.string(), z.any()).optional(),
                      })
                      .optional(),
                  })
                )
                .optional()
                .describe('Conditional formatting rules applied to sheet'),
              protectedRanges: z
                .array(
                  z.object({
                    protectedRangeId: z.number().int().optional(),
                    range: GridRangeSchema.optional(),
                    description: z.string().optional(),
                    warningOnly: z.boolean().optional(),
                    editors: z
                      .object({
                        users: z.array(z.string()).optional(),
                        groups: z.array(z.string()).optional(),
                      })
                      .optional(),
                  })
                )
                .optional()
                .describe('Protected ranges on this sheet'),
              charts: z
                .array(
                  z.object({
                    chartId: z.number().int().optional(),
                    position: z
                      .object({
                        sheetId: z.number().int().optional(),
                        rowIndex: z.number().int().optional(),
                        columnIndex: z.number().int().optional(),
                      })
                      .optional(),
                    title: z.string().optional(),
                    chartType: z.string().optional(),
                  })
                )
                .optional()
                .describe('Charts embedded in this sheet'),
              filterViews: z
                .array(
                  z.object({
                    filterViewId: z.number().int().optional(),
                    title: z.string().optional(),
                    range: GridRangeSchema.optional(),
                    criteria: z.record(z.string(), z.any()).optional(),
                  })
                )
                .optional()
                .describe('Filter views defined on this sheet'),
              basicFilter: z
                .object({
                  range: GridRangeSchema.optional(),
                  sortSpecs: z.array(z.record(z.string(), z.any())).optional(),
                  filterSpecs: z.array(z.record(z.string(), z.any())).optional(),
                })
                .optional()
                .describe('Basic filter configuration if applied'),
              merges: z.array(GridRangeSchema).optional().describe('Merged cell ranges'),
              data: z
                .array(
                  z.object({
                    rowData: z
                      .array(
                        z.object({
                          values: z
                            .array(
                              z.object({
                                userEnteredValue: z.any().optional(),
                                effectiveValue: z.any().optional(),
                                formattedValue: z.string().optional(),
                                userEnteredFormat: z.record(z.string(), z.any()).optional(),
                              })
                            )
                            .optional(),
                        })
                      )
                      .optional(),
                  })
                )
                .optional()
                .describe('Cell data for rows in this sheet'),
            })
          )
          .optional()
          .describe('Sheet metadata including properties and content'),
        stats: z
          .object({
            sheetsCount: z.coerce.number().int().describe('Total number of sheets'),
            namedRangesCount: z.coerce.number().int().describe('Total named ranges'),
            totalCharts: z.coerce.number().int().describe('Total embedded charts'),
            totalConditionalFormats: z.coerce
              .number()
              .int()
              .describe('Total conditional format rules'),
            totalProtectedRanges: z.coerce.number().int().describe('Total protected ranges'),
            cacheHit: z.boolean().describe('True if result came from cache'),
            fetchTime: z.coerce.number().int().describe('Time to fetch metadata in milliseconds'),
          })
          .optional()
          .describe('Statistics about the spreadsheet'),
        pagination: z
          .object({
            hasMore: z.boolean().describe('True if more sheets available'),
            nextCursor: z
              .string()
              .optional()
              .describe('Cursor for next page (undefined = no more sheets)'),
            totalSheets: z.coerce.number().int().describe('Total sheets in workbook'),
            currentPage: z
              .object({
                startIndex: z.coerce.number().int().describe('Index of first sheet in page'),
                endIndex: z.coerce.number().int().describe('Index of last sheet in page'),
                count: z.coerce.number().int().describe('Number of sheets in this page'),
              })
              .optional()
              .describe('Current page information'),
          })
          .optional()
          .describe('Pagination metadata for sheet-level pagination'),
      })
      .optional()
      .describe('Comprehensive metadata including properties, rules, and sheet details'),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsCoreOutputSchema = z.object({
  response: CoreResponseSchema,
});

/**
 * Tool annotations for MCP protocol
 *
 * Combines annotations from spreadsheet and sheet tools:
 * - readOnlyHint: false (can modify data)
 * - destructiveHint: true (delete_sheet is destructive)
 * - idempotentHint: false (create, add, duplicate create new entities; delete without allowMissing fails)
 * - openWorldHint: true (interacts with Google Sheets API)
 */
export const SHEETS_CORE_ANNOTATIONS: ToolAnnotations = {
  title: 'Core Operations',
  readOnlyHint: false,
  destructiveHint: true, // delete_sheet action is destructive
  idempotentHint: false, // create/add create new entities
  openWorldHint: true,
};

export type SheetsCoreInput = z.infer<typeof SheetsCoreInputSchema>;
export type SheetsCoreOutput = z.infer<typeof SheetsCoreOutputSchema>;
export type CoreResponse = z.infer<typeof CoreResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type CoreRequest = SheetsCoreInput['request'];

// Type narrowing helpers for handler methods (19 action types)
// Spreadsheet actions
export type CoreGetInput = SheetsCoreInput['request'] & {
  action: 'get';
  spreadsheetId: string;
};
export type CoreCreateInput = SheetsCoreInput['request'] & {
  action: 'create';
  title: string;
};
export type CoreCopyInput = SheetsCoreInput['request'] & {
  action: 'copy';
  spreadsheetId: string;
};
export type CoreUpdatePropertiesInput = SheetsCoreInput['request'] & {
  action: 'update_properties';
  spreadsheetId: string;
};
export type CoreGetUrlInput = SheetsCoreInput['request'] & {
  action: 'get_url';
  spreadsheetId: string;
  sheetId?: number;
};
export type CoreBatchGetInput = SheetsCoreInput['request'] & {
  action: 'batch_get';
  spreadsheetIds: string[];
};
export type CoreGetComprehensiveInput = SheetsCoreInput['request'] & {
  action: 'get_comprehensive';
  spreadsheetId: string;
};
export type CoreListInput = SheetsCoreInput['request'] & {
  action: 'list';
  pageToken?: string;
  maxResults?: number;
};

// Sheet/tab actions
export type CoreAddSheetInput = SheetsCoreInput['request'] & {
  action: 'add_sheet';
  spreadsheetId: string;
  title: string;
};
export type CoreDeleteSheetInput = SheetsCoreInput['request'] & {
  action: 'delete_sheet';
  spreadsheetId: string;
  sheetId: number;
};
export type CoreDuplicateSheetInput = SheetsCoreInput['request'] & {
  action: 'duplicate_sheet';
  spreadsheetId: string;
  sheetId: number;
};
export type CoreUpdateSheetInput = SheetsCoreInput['request'] & {
  action: 'update_sheet';
  spreadsheetId: string;
  sheetId: number;
};
export type CoreCopySheetToInput = SheetsCoreInput['request'] & {
  action: 'copy_sheet_to';
  spreadsheetId: string;
  sheetId: number;
  destinationSpreadsheetId: string;
};
export type CoreListSheetsInput = SheetsCoreInput['request'] & {
  action: 'list_sheets';
  spreadsheetId: string;
};
export type CoreGetSheetInput = SheetsCoreInput['request'] & {
  action: 'get_sheet';
  spreadsheetId: string;
  sheetId?: number;
  sheetName?: string;
};

// Batch operations (Issue #2 fix)
export type CoreBatchDeleteSheetsInput = SheetsCoreInput['request'] & {
  action: 'batch_delete_sheets';
  spreadsheetId: string;
  sheetIds: number[];
};
export type CoreBatchUpdateSheetsInput = SheetsCoreInput['request'] & {
  action: 'batch_update_sheets';
  spreadsheetId: string;
  updates: Array<{
    sheetId: number;
    title?: string;
    index?: number;
    tabColor?: { red: number; green: number; blue: number; alpha?: number };
    hidden?: boolean;
  }>;
};
export type CoreClearSheetInput = SheetsCoreInput['request'] & {
  action: 'clear_sheet';
  spreadsheetId: string;
  sheetId?: number;
  sheetName?: string;
  clearValues?: boolean;
  clearFormats?: boolean;
  clearNotes?: boolean;
};
export type CoreMoveSheetInput = SheetsCoreInput['request'] & {
  action: 'move_sheet';
  spreadsheetId: string;
  sheetId?: number;
  sheetName?: string;
  newIndex: number;
};
export type CoreDescribeWorkbookInput = SheetsCoreInput['request'] & {
  action: 'describe_workbook';
  spreadsheetId: string;
};
export type CoreWorkbookFingerprintInput = SheetsCoreInput['request'] & {
  action: 'workbook_fingerprint';
  spreadsheetId: string;
};
