/**
 * Tool 15: sheets_advanced
 * Advanced features: named ranges, named functions, protected ranges, metadata, banding, tables, and smart chips
 *
 * 31 Actions:
 * Named Ranges (5): add_named_range, update_named_range, delete_named_range, list_named_ranges, get_named_range
 * Named Functions (5): create_named_function, list_named_functions, get_named_function, update_named_function, delete_named_function
 * Protected Ranges (4): add_protected_range, update_protected_range, delete_protected_range, list_protected_ranges
 * Metadata (3): set_metadata, get_metadata, delete_metadata
 * Banding (4): add_banding, update_banding, delete_banding, list_banding
 * Tables (6): create_table, delete_table, list_tables, update_table, rename_table_column, set_table_column_properties
 * Smart Chips (4): add_person_chip, add_drive_chip, add_rich_link_chip, list_chips
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  RangeInputSchema,
  GridRangeSchema,
  ColorSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ResponseMetaSchema,
  type ToolAnnotations,
} from './shared.js';
import { NAMED_RANGE_NAME_MAX_LENGTH } from '../config/google-limits.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe('Safety options (dryRun, createSnapshot, etc.)'),
});

const NamedRangeSchema = z.object({
  namedRangeId: z.string(),
  name: z
    .string()
    .max(
      NAMED_RANGE_NAME_MAX_LENGTH,
      `Named range name exceeds Google Sheets limit of ${NAMED_RANGE_NAME_MAX_LENGTH} characters`
    ),
  range: GridRangeSchema,
});

const ProtectedRangeSchema = z.object({
  protectedRangeId: z.coerce.number().int(),
  range: GridRangeSchema,
  description: z.string().optional(),
  warningOnly: z.boolean(),
  requestingUserCanEdit: z.boolean(),
  editors: z
    .object({
      users: z.array(z.string()).optional(),
      groups: z.array(z.string()).optional(),
      domainUsersCanEdit: z.boolean().optional(),
    })
    .optional(),
});

const BandingPropertiesSchema = z.object({
  headerColor: ColorSchema.optional(),
  firstBandColor: ColorSchema.optional(),
  secondBandColor: ColorSchema.optional(),
  footerColor: ColorSchema.optional(),
});

const EditorsSchema = z.object({
  users: z.array(z.string().email()).optional(),
  groups: z.array(z.string().email()).optional(),
  domainUsersCanEdit: z.boolean().optional(),
});

const MetadataLocationSchema = z.object({
  spreadsheet: z.boolean().optional().describe('If true, metadata applies to entire spreadsheet'),
  sheetId: SheetIdSchema.optional().describe('Sheet ID if metadata applies to a specific sheet'),
  dimensionRange: z
    .object({
      sheetId: SheetIdSchema.describe('Sheet ID containing the dimension'),
      dimension: z.enum(['ROWS', 'COLUMNS']).describe('Apply to rows or columns'),
      startIndex: z.coerce.number().int().min(0).describe('Start index (0-based, inclusive)'),
      endIndex: z.coerce.number().int().min(1).describe('End index (0-based, exclusive)'),
    })
    .optional()
    .describe('Apply metadata to a specific range of rows or columns'),
});

// ============================================================================
// Named Range Action Schemas (5 actions)
// ============================================================================

const AddNamedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_named_range').describe('Add a named range'),
  name: z
    .string()
    .min(1, 'Named range name cannot be empty')
    .max(
      NAMED_RANGE_NAME_MAX_LENGTH,
      `Named range name exceeds Google Sheets limit of ${NAMED_RANGE_NAME_MAX_LENGTH} characters`
    )
    .regex(
      /^[A-Za-z_]\w*$/,
      'Must start with letter/underscore, contain only alphanumeric and underscores'
    )
    .describe('Named range name'),
  range: RangeInputSchema.describe('Range to name'),
});

const UpdateNamedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_named_range').describe('Update a named range'),
  namedRangeId: z.string().describe('Named range ID'),
  name: z
    .string()
    .min(1)
    .max(NAMED_RANGE_NAME_MAX_LENGTH)
    .regex(/^[A-Za-z_]\w*$/)
    .optional()
    .describe('New name'),
  range: RangeInputSchema.optional().describe('New range'),
});

const DeleteNamedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_named_range').describe('Delete a named range'),
  namedRangeId: z.string().describe('Named range ID'),
});

const ListNamedRangesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_named_ranges').describe('List all named ranges'),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('Items per page (default: 100, max: 500)'),
});

const GetNamedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_named_range').describe('Get a named range by name'),
  name: z.string().min(1).describe('Named range name'),
});

// ============================================================================
// Protected Range Action Schemas (4 actions)
// ============================================================================

const AddProtectedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_protected_range').describe('Add a protected range'),
  range: RangeInputSchema.describe('Range to protect'),
  description: z.string().optional().describe('Optional description'),
  warningOnly: z.boolean().optional().default(false).describe('Warning only (no protection)'),
  editors: EditorsSchema.optional().describe('Who can edit (users, groups, domain)'),
});

const UpdateProtectedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_protected_range').describe('Update a protected range'),
  protectedRangeId: z.coerce.number().int().describe('Protected range ID'),
  description: z.string().optional().describe('New description'),
  warningOnly: z.boolean().optional().describe('New warning only setting'),
  editors: EditorsSchema.optional().describe('New editors'),
  range: RangeInputSchema.optional().describe('New range'),
});

const DeleteProtectedRangeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_protected_range').describe('Delete a protected range'),
  protectedRangeId: z.coerce.number().int().describe('Protected range ID'),
});

const ListProtectedRangesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_protected_ranges').describe('List all protected ranges'),
  sheetId: SheetIdSchema.optional().describe('Filter by sheet ID'),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('Items per page (default: 100, max: 500)'),
});

// ============================================================================
// Metadata Action Schemas (3 actions)
// ============================================================================

const SetMetadataActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_metadata').describe('Set developer metadata'),
  metadataKey: z.string().min(1).describe('Metadata key'),
  metadataValue: z.string().describe('Metadata value'),
  visibility: z
    .enum(['DOCUMENT', 'PROJECT'])
    .optional()
    .default('DOCUMENT')
    .describe('Metadata visibility'),
  location: MetadataLocationSchema.optional().describe('Metadata location'),
});

const GetMetadataActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_metadata').describe('Get developer metadata'),
  metadataId: z.coerce.number().int().optional().describe('Metadata ID (omit to list all)'),
  metadataKey: z.string().optional().describe('Filter by key'),
});

const DeleteMetadataActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_metadata').describe('Delete developer metadata'),
  metadataId: z.coerce.number().int().describe('Metadata ID'),
});

// ============================================================================
// Banding Action Schemas (4 actions)
// ============================================================================

const AddBandingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_banding').describe('Add alternating row/column colors'),
  range: RangeInputSchema.describe('Range to apply banding'),
  rowProperties: BandingPropertiesSchema.optional().describe('Row banding properties'),
  columnProperties: BandingPropertiesSchema.optional().describe('Column banding properties'),
});

const UpdateBandingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_banding').describe('Update banding properties'),
  bandedRangeId: z.coerce.number().int().describe('Banded range ID'),
  rowProperties: BandingPropertiesSchema.optional().describe('New row properties'),
  columnProperties: BandingPropertiesSchema.optional().describe('New column properties'),
});

const DeleteBandingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_banding').describe('Delete banding'),
  bandedRangeId: z.coerce.number().int().describe('Banded range ID'),
});

const ListBandingActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_banding').describe('List all banding'),
  sheetId: SheetIdSchema.optional().describe('Filter by sheet ID'),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('Items per page (default: 100, max: 500)'),
});

// ============================================================================
// Table Action Schemas (6 actions)
// ============================================================================

const CreateTableActionSchema = CommonFieldsSchema.extend({
  action: z.literal('create_table').describe('Create a table (structured data range)'),
  range: RangeInputSchema.describe('Range for the table'),
  tableName: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Optional table name for easier identification'),
  hasHeaders: z.boolean().optional().default(true).describe('First row contains headers'),
  headerRowCount: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe('Number of header rows (default: 1)'),
});

const DeleteTableActionSchema = CommonFieldsSchema.extend({
  action: z.literal('delete_table').describe('Delete a table'),
  tableId: z.string().describe('Table ID'),
});

const ListTablesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_tables').describe('List all tables'),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('Items per page (default: 100, max: 500)'),
});

const UpdateTableActionSchema = CommonFieldsSchema.extend({
  action: z.literal('update_table').describe('Update table range or properties'),
  tableId: z.string().describe('Table ID'),
  range: RangeInputSchema.optional().describe('New range for the table (optional)'),
});

const RenameTableColumnActionSchema = CommonFieldsSchema.extend({
  action: z.literal('rename_table_column').describe('Rename a table column'),
  tableId: z.string().describe('Table ID'),
  columnIndex: z.number().int().min(0).describe('Column index (0-based)'),
  newName: z.string().min(1).describe('New column name'),
});

const SetTableColumnPropertiesActionSchema = CommonFieldsSchema.extend({
  action: z.literal('set_table_column_properties').describe('Set table column properties'),
  tableId: z.string().describe('Table ID'),
  columnIndex: z.number().int().min(0).describe('Column index (0-based)'),
  columnType: z
    .enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'CURRENCY', 'DROPDOWN'])
    .optional()
    .describe('Column type for the table'),
  dropdownValues: z
    .array(z.string())
    .optional()
    .describe('Static list of dropdown values (for DROPDOWN column type)'),
  dropdownRange: z
    .string()
    .optional()
    .describe('Range reference for dropdown values (e.g., "Sheet1!A1:A10")'),
  dropdownAllowCustom: z
    .boolean()
    .optional()
    .default(false)
    .describe('Allow custom values not in the dropdown list'),
  dropdownShowDropdown: z.boolean().optional().default(true).describe('Show dropdown UI in cells'),
}).refine(
  (data) => {
    // If columnType is DROPDOWN, require either dropdownValues or dropdownRange
    if (data.columnType === 'DROPDOWN') {
      return data.dropdownValues !== undefined || data.dropdownRange !== undefined;
    }
    return true;
  },
  {
    message: 'DROPDOWN column type requires either dropdownValues or dropdownRange',
  }
);

// ============================================================================
// Smart Chips Action Schemas (4 actions) - NEW June 2025
// ============================================================================

const AddPersonChipActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_person_chip').describe('Add a person chip (@mention)'),
  range: RangeInputSchema.describe('Cell to add the chip to'),
  email: z.string().email().describe('Email address of the person to mention'),
  displayFormat: z
    .enum(['DEFAULT', 'LAST_NAME_COMMA_FIRST_NAME', 'EMAIL'])
    .optional()
    .default('DEFAULT')
    .describe(
      'Display format: DEFAULT (full name), LAST_NAME_COMMA_FIRST_NAME (Last, First), EMAIL (email address)'
    ),
});

const AddDriveChipActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_drive_chip').describe('Add a Google Drive file chip'),
  range: RangeInputSchema.describe('Cell to add the chip to'),
  fileId: z.string().describe('Google Drive file ID'),
  displayText: z.string().optional().describe('Optional display text for the chip'),
});

const AddRichLinkChipActionSchema = CommonFieldsSchema.extend({
  action: z.literal('add_rich_link_chip').describe('Add a rich link chip (URL with preview)'),
  range: RangeInputSchema.describe('Cell to add the chip to'),
  uri: z.string().url().describe('URL for the rich link'),
  displayText: z.string().optional().describe('Optional display text for the chip'),
});

const ListChipsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_chips').describe('List all smart chips in a range'),
  range: RangeInputSchema.optional().describe('Range to search (defaults to entire sheet)'),
  sheetId: SheetIdSchema.optional().describe('Sheet to search'),
  chipType: z
    .enum(['person', 'drive', 'rich_link', 'all'])
    .optional()
    .default('all')
    .describe('Filter by chip type'),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('Items per page (default: 100, max: 500)'),
});

// ============================================================================
// Named Function Action Schemas (5 actions) - Google Sheets LAMBDA-based custom functions
// ============================================================================

const NamedFunctionParamSchema = z.object({
  name: z.string().min(1).describe('Parameter name (used inside the LAMBDA body)'),
  description: z.string().optional().describe('Optional description of what the parameter does'),
});

const CreateNamedFunctionActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('create_named_function')
    .describe(
      'Compatibility action for reusable LAMBDA-based custom functions. Currently returns FEATURE_UNAVAILABLE because the live Sheets API surface is inconsistent here.'
    ),
  functionName: z
    .string()
    .min(1)
    .max(255)
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*$/,
      'Function name must start with a letter and contain only letters, numbers, and underscores'
    )
    .describe('Name for the custom function (e.g., "PROFIT_MARGIN")'),
  functionBody: z
    .string()
    .min(1)
    .describe(
      'The LAMBDA expression or formula body (e.g., "LAMBDA(revenue,cost,(revenue-cost)/revenue)")'
    ),
  description: z
    .string()
    .optional()
    .describe('Optional human-readable description of the function'),
  parameterDefinitions: z
    .array(NamedFunctionParamSchema)
    .optional()
    .describe('Parameter definitions for the function arguments'),
});

const ListNamedFunctionsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('list_named_functions')
    .describe(
      'Compatibility action for listing custom named functions. Currently returns FEATURE_UNAVAILABLE because the live Sheets API surface is inconsistent here.'
    ),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .default(100)
    .describe('Items per page (default: 100, max: 500)'),
});

const GetNamedFunctionActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('get_named_function')
    .describe(
      'Compatibility action for retrieving a named function by name. Currently returns FEATURE_UNAVAILABLE because the live Sheets API surface is inconsistent here.'
    ),
  functionName: z.string().min(1).describe('Name of the function to retrieve'),
});

const UpdateNamedFunctionActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('update_named_function')
    .describe(
      'Compatibility action for updating a named function. Currently returns FEATURE_UNAVAILABLE because the live Sheets API surface is inconsistent here.'
    ),
  functionName: z.string().min(1).describe('Name of the function to update'),
  newFunctionName: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .optional()
    .describe('New function name (to rename)'),
  functionBody: z.string().min(1).optional().describe('New LAMBDA expression or formula body'),
  description: z.string().optional().describe('New description'),
  parameterDefinitions: z
    .array(NamedFunctionParamSchema)
    .optional()
    .describe('New parameter definitions'),
});

const DeleteNamedFunctionActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('delete_named_function')
    .describe(
      'Compatibility action for deleting a named function. Currently returns FEATURE_UNAVAILABLE because the live Sheets API surface is inconsistent here.'
    ),
  functionName: z.string().min(1).describe('Name of the function to delete'),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

/**
 * All advanced operation inputs (26 actions)
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsAdvancedInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    // Named ranges (5)
    AddNamedRangeActionSchema,
    UpdateNamedRangeActionSchema,
    DeleteNamedRangeActionSchema,
    ListNamedRangesActionSchema,
    GetNamedRangeActionSchema,
    // Named functions (5) - LAMBDA-based custom functions
    CreateNamedFunctionActionSchema,
    ListNamedFunctionsActionSchema,
    GetNamedFunctionActionSchema,
    UpdateNamedFunctionActionSchema,
    DeleteNamedFunctionActionSchema,
    // Protected ranges (4)
    AddProtectedRangeActionSchema,
    UpdateProtectedRangeActionSchema,
    DeleteProtectedRangeActionSchema,
    ListProtectedRangesActionSchema,
    // Metadata (3)
    SetMetadataActionSchema,
    GetMetadataActionSchema,
    DeleteMetadataActionSchema,
    // Banding (4)
    AddBandingActionSchema,
    UpdateBandingActionSchema,
    DeleteBandingActionSchema,
    ListBandingActionSchema,
    // Tables (6)
    CreateTableActionSchema,
    DeleteTableActionSchema,
    ListTablesActionSchema,
    UpdateTableActionSchema,
    RenameTableColumnActionSchema,
    SetTableColumnPropertiesActionSchema,
    // Smart Chips (4) - NEW June 2025
    AddPersonChipActionSchema,
    AddDriveChipActionSchema,
    AddRichLinkChipActionSchema,
    ListChipsActionSchema,
  ]),
});

const AdvancedResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // Named range fields
    namedRange: NamedRangeSchema.optional(),
    namedRanges: z.array(NamedRangeSchema).optional(),
    // Protected range fields
    protectedRange: ProtectedRangeSchema.optional(),
    protectedRanges: z.array(ProtectedRangeSchema).optional(),
    // Metadata fields
    metadata: z
      .object({
        metadataId: z.coerce.number().int(),
        metadataKey: z.string(),
        metadataValue: z.string(),
        visibility: z.enum(['DOCUMENT', 'PROJECT']),
        location: MetadataLocationSchema.optional(),
      })
      .optional(),
    metadataList: z
      .array(
        z.object({
          metadataId: z.coerce.number().int(),
          metadataKey: z.string(),
          metadataValue: z.string(),
        })
      )
      .optional(),
    // Banding fields
    bandedRange: z
      .object({
        bandedRangeId: z.coerce.number().int(),
        range: GridRangeSchema,
        rowProperties: BandingPropertiesSchema.optional(),
        columnProperties: BandingPropertiesSchema.optional(),
      })
      .optional(),
    bandedRanges: z
      .array(
        z.object({
          bandedRangeId: z.coerce.number().int(),
          range: GridRangeSchema,
        })
      )
      .optional(),
    // Named function fields
    namedFunction: z
      .object({
        functionName: z.string(),
        functionBody: z.string(),
        description: z.string().optional(),
        parameterDefinitions: z
          .array(z.object({ name: z.string(), description: z.string().optional() }))
          .optional(),
      })
      .optional(),
    namedFunctions: z
      .array(
        z.object({
          functionName: z.string(),
          functionBody: z.string(),
          description: z.string().optional(),
          parameterDefinitions: z
            .array(z.object({ name: z.string(), description: z.string().optional() }))
            .optional(),
        })
      )
      .optional(),
    // Table fields
    table: z
      .object({
        tableId: z.string(),
        tableName: z.string().optional(),
        range: GridRangeSchema,
        hasHeaders: z.boolean(),
        headerRowCount: z.number().int().optional(),
      })
      .optional(),
    tables: z
      .array(
        z.object({
          tableId: z.string(),
          tableName: z.string().optional(),
          range: GridRangeSchema,
          columnCount: z.number().int().optional(),
          rowCount: z.number().int().optional(),
        })
      )
      .optional(),
    // Smart Chip fields (June 2025 API)
    chip: z
      .object({
        type: z.enum(['person', 'drive', 'rich_link']),
        cell: z.string().describe('Cell where chip was added (A1 notation)'),
        email: z.string().optional().describe('Person email (for person chips)'),
        fileId: z.string().optional().describe('Drive file ID (for drive chips)'),
        uri: z.string().optional().describe('URI (for rich link chips)'),
        displayText: z.string().optional().describe('Display text shown for the chip'),
      })
      .optional(),
    chips: z
      .array(
        z.object({
          type: z.enum(['person', 'drive', 'rich_link']),
          cell: z.string(),
          email: z.string().optional(),
          fileId: z.string().optional(),
          uri: z.string().optional(),
          displayText: z.string().optional(),
        })
      )
      .optional(),
    // Pagination fields (list actions: list_named_ranges, list_protected_ranges, list_banding, list_tables, list_named_functions, list_chips)
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for next page — pass as cursor in subsequent request'),
    hasMore: z.boolean().optional().describe('True if more results are available'),
    totalCount: z.number().int().optional().describe('Total number of items (before pagination)'),
    // Common fields
    dryRun: z.boolean().optional(),
    mutation: MutationSummarySchema.optional(),
    snapshotId: z.string().optional().describe('Snapshot ID for rollback (if created)'),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsAdvancedOutputSchema = z.object({
  response: AdvancedResponseSchema,
});

export const SHEETS_ADVANCED_ANNOTATIONS: ToolAnnotations = {
  title: 'Advanced Features',
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export type SheetsAdvancedInput = z.infer<typeof SheetsAdvancedInputSchema>;
export type SheetsAdvancedOutput = z.infer<typeof SheetsAdvancedOutputSchema>;
export type AdvancedResponse = z.infer<typeof AdvancedResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type AdvancedRequest = SheetsAdvancedInput['request'];

// Type narrowing helpers for handler methods (19 action types)
// Named ranges
export type AdvancedAddNamedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'add_named_range';
  spreadsheetId: string;
  name: string;
  range: z.infer<typeof RangeInputSchema>;
};
export type AdvancedUpdateNamedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'update_named_range';
  spreadsheetId: string;
  namedRangeId: string;
};
export type AdvancedDeleteNamedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'delete_named_range';
  spreadsheetId: string;
  namedRangeId: string;
};
export type AdvancedListNamedRangesInput = SheetsAdvancedInput['request'] & {
  action: 'list_named_ranges';
  spreadsheetId: string;
};
export type AdvancedGetNamedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'get_named_range';
  spreadsheetId: string;
  name: string;
};

// Protected ranges
export type AdvancedAddProtectedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'add_protected_range';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
};
export type AdvancedUpdateProtectedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'update_protected_range';
  spreadsheetId: string;
  protectedRangeId: number;
};
export type AdvancedDeleteProtectedRangeInput = SheetsAdvancedInput['request'] & {
  action: 'delete_protected_range';
  spreadsheetId: string;
  protectedRangeId: number;
};
export type AdvancedListProtectedRangesInput = SheetsAdvancedInput['request'] & {
  action: 'list_protected_ranges';
  spreadsheetId: string;
};

// Metadata
export type AdvancedSetMetadataInput = SheetsAdvancedInput['request'] & {
  action: 'set_metadata';
  spreadsheetId: string;
  metadataKey: string;
  metadataValue: string;
};
export type AdvancedGetMetadataInput = SheetsAdvancedInput['request'] & {
  action: 'get_metadata';
  spreadsheetId: string;
};
export type AdvancedDeleteMetadataInput = SheetsAdvancedInput['request'] & {
  action: 'delete_metadata';
  spreadsheetId: string;
  metadataId: number;
};

// Banding
export type AdvancedAddBandingInput = SheetsAdvancedInput['request'] & {
  action: 'add_banding';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
};
export type AdvancedUpdateBandingInput = SheetsAdvancedInput['request'] & {
  action: 'update_banding';
  spreadsheetId: string;
  bandedRangeId: number;
};
export type AdvancedDeleteBandingInput = SheetsAdvancedInput['request'] & {
  action: 'delete_banding';
  spreadsheetId: string;
  bandedRangeId: number;
};
export type AdvancedListBandingInput = SheetsAdvancedInput['request'] & {
  action: 'list_banding';
  spreadsheetId: string;
};

// Tables
export type AdvancedCreateTableInput = SheetsAdvancedInput['request'] & {
  action: 'create_table';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
};
export type AdvancedDeleteTableInput = SheetsAdvancedInput['request'] & {
  action: 'delete_table';
  spreadsheetId: string;
  tableId: string;
};
export type AdvancedListTablesInput = SheetsAdvancedInput['request'] & {
  action: 'list_tables';
  spreadsheetId: string;
};
export type AdvancedUpdateTableInput = SheetsAdvancedInput['request'] & {
  action: 'update_table';
  spreadsheetId: string;
  tableId: string;
  range?: z.infer<typeof RangeInputSchema>;
};
export type AdvancedRenameTableColumnInput = SheetsAdvancedInput['request'] & {
  action: 'rename_table_column';
  spreadsheetId: string;
  tableId: string;
  columnIndex: number;
  newName: string;
};
export type AdvancedSetTableColumnPropertiesInput = SheetsAdvancedInput['request'] & {
  action: 'set_table_column_properties';
  spreadsheetId: string;
  tableId: string;
  columnIndex: number;
  columnType?: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'CURRENCY' | 'DROPDOWN';
};

// Named functions
export type AdvancedCreateNamedFunctionInput = SheetsAdvancedInput['request'] & {
  action: 'create_named_function';
  spreadsheetId: string;
  functionName: string;
  functionBody: string;
};
export type AdvancedListNamedFunctionsInput = SheetsAdvancedInput['request'] & {
  action: 'list_named_functions';
  spreadsheetId: string;
};
export type AdvancedGetNamedFunctionInput = SheetsAdvancedInput['request'] & {
  action: 'get_named_function';
  spreadsheetId: string;
  functionName: string;
};
export type AdvancedUpdateNamedFunctionInput = SheetsAdvancedInput['request'] & {
  action: 'update_named_function';
  spreadsheetId: string;
  functionName: string;
};
export type AdvancedDeleteNamedFunctionInput = SheetsAdvancedInput['request'] & {
  action: 'delete_named_function';
  spreadsheetId: string;
  functionName: string;
};

// Smart Chips (June 2025 API)
export type AdvancedAddPersonChipInput = SheetsAdvancedInput['request'] & {
  action: 'add_person_chip';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
  email: string;
};
export type AdvancedAddDriveChipInput = SheetsAdvancedInput['request'] & {
  action: 'add_drive_chip';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
  fileId: string;
};
export type AdvancedAddRichLinkChipInput = SheetsAdvancedInput['request'] & {
  action: 'add_rich_link_chip';
  spreadsheetId: string;
  range: z.infer<typeof RangeInputSchema>;
  uri: string;
};
export type AdvancedListChipsInput = SheetsAdvancedInput['request'] & {
  action: 'list_chips';
  spreadsheetId: string;
};
