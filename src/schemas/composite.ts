/**
 * ServalSheets - Composite Operations Schema
 *
 * Schemas for high-level composite operations.
 * 11 Actions: import_csv, smart_append, bulk_update, deduplicate, export_xlsx, import_xlsx, get_form_responses, quick_report, data_pipeline, conditional_update, stream_append
 *
 * MCP Protocol: 2025-11-25
 * Google Sheets API: v4
 *
 * @module schemas/composite
 */

import { z } from 'zod';
import type { ToolAnnotations } from './shared.js';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  SheetNameSchema,
  ErrorDetailSchema,
  MutationSummarySchema,
  RangeInputSchema,
  ResponseMetaSchema,
  SafetyOptionsSchema,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Sheet reference - name or ID
 */
export const SheetReferenceSchema = z.union([
  SheetNameSchema.describe('Sheet name'),
  SheetIdSchema.describe('Sheet ID'),
]);

/**
 * Verbosity level for responses
 */
export const VerbositySchema = z
  .enum(['minimal', 'standard', 'detailed'])
  .default('standard')
  .describe('Response verbosity level');

const normalizeCompositeRequest = (val: unknown): unknown => {
  if (typeof val !== 'object' || val === null) {
    return val;
  }

  const input = val as Record<string, unknown>;
  if (input['action'] !== 'import_csv') {
    return val;
  }

  const legacySheetName = input['sheetName'];
  if (
    typeof legacySheetName === 'string' &&
    legacySheetName.trim().length > 0 &&
    input['sheet'] === undefined &&
    input['newSheetName'] === undefined
  ) {
    return {
      ...input,
      newSheetName: legacySheetName,
    };
  }

  return val;
};

// ============================================================================
// Import CSV Action
// ============================================================================

export const ImportCsvModeSchema = z.enum(['replace', 'append', 'new_sheet']);

export const ImportCsvInputSchema = z.object({
  action: z.literal('import_csv').describe('Import CSV data into a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheet: SheetReferenceSchema.optional().describe('Target sheet (creates new if not specified)'),
  csvData: z
    .string()
    .min(1)
    .max(10485760, 'CSV data exceeds 10MB limit')
    .describe('CSV data as string (max 10MB)'),
  delimiter: z
    .string()
    .max(5)
    .default(',')
    .describe('Field delimiter (default: , | alternatives: ;, |, tab)'),
  hasHeader: z
    .boolean()
    .default(true)
    .describe('First row is header (default: true | set false if no header row)'),
  mode: ImportCsvModeSchema.default('replace').describe(
    'How to handle existing data (default: replace | alternatives: append, new_sheet)'
  ),
  newSheetName: z
    .string()
    .max(255)
    .optional()
    .describe(
      'Name for new sheet. Used when mode is new_sheet OR when no existing sheet is specified. Defaults to Import_YYYY-MM-DD if omitted.'
    ),
  skipEmptyRows: z
    .boolean()
    .default(true)
    .describe('Skip empty rows (default: true | set false to include empty rows)'),
  trimValues: z
    .boolean()
    .default(true)
    .describe('Trim whitespace from values (default: true | set false to preserve whitespace)'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options: dryRun for preview, autoSnapshot for automatic backups'
  ),
});

export const ImportCsvOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('import_csv'),
  rowsImported: z.coerce.number().int().min(0),
  columnsImported: z.coerce.number().int().min(0),
  range: z.string(),
  sheetId: SheetIdSchema,
  sheetName: SheetNameSchema,
  rowsSkipped: z.coerce.number().int().min(0),
  newSheetCreated: z.boolean(),
  mutation: MutationSummarySchema.optional(),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Smart Append Action
// ============================================================================

export const SmartAppendInputSchema = z.object({
  action: z.literal('smart_append').describe('Append data matching column headers'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheet: SheetReferenceSchema.describe('Target sheet - name or ID'),
  data: z
    .array(
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.any()),
          z.record(z.string(), z.any()),
        ])
      )
    )
    .min(1)
    .describe(
      'MUST be array of objects keyed by header names, e.g. [{"Name": "Alice", "Age": 30}]. Do NOT use arrays of arrays [[val1, val2]] — that format will fail. Values can be string, number, boolean, null, array, or object.'
    ),
  matchHeaders: z
    .boolean()
    .default(true)
    .describe('Match columns by header name (default: true | set false for positional matching)'),
  createMissingColumns: z
    .boolean()
    .default(false)
    .describe(
      'Create columns for unmatched headers (default: false | set true to auto-create columns)'
    ),
  skipEmptyRows: z
    .boolean()
    .default(true)
    .describe('Skip rows with all empty values (default: true | set false to include empty rows)'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options: dryRun for preview, autoSnapshot for automatic backups'
  ),
});

export const SmartAppendOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('smart_append'),
  rowsAppended: z.coerce.number().int().min(0),
  columnsMatched: z.array(z.string()),
  columnsCreated: z.array(z.string()),
  columnsSkipped: z.array(z.string()),
  range: z.string(),
  sheetId: SheetIdSchema,
  mutation: MutationSummarySchema.optional(),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Bulk Update Action
// ============================================================================

export const BulkUpdateInputSchema = z.object({
  action: z.literal('bulk_update').describe('Update rows by matching a key column'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheet: SheetReferenceSchema.describe('Target sheet - name or ID'),
  keyColumn: z.string().min(1).describe('Column header to match rows by'),
  updates: z
    .array(
      z.record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.any()),
          z.record(z.string(), z.any()),
        ])
      )
    )
    .min(1)
    .describe(
      'Array of objects with key column and update values (can be string, number, boolean, null, array, or object)'
    ),
  createUnmatched: z
    .boolean()
    .default(false)
    .describe(
      'Create new rows for unmatched keys (default: false | set true to insert missing rows)'
    ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options: dryRun for preview, autoSnapshot for automatic backups'
  ),
});

export const BulkUpdateOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('bulk_update'),
  rowsUpdated: z.coerce.number().int().min(0),
  rowsCreated: z.coerce.number().int().min(0),
  keysNotFound: z.array(z.string()),
  cellsModified: z.coerce.number().int().min(0),
  snapshotId: z.string().optional(),
  mutation: MutationSummarySchema.optional(),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Deduplicate Action
// ============================================================================

export const DeduplicateKeepSchema = z.enum(['first', 'last']);

export const DeduplicateInputSchema = z.object({
  action: z.literal('deduplicate').describe('Remove duplicate rows based on key columns'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  sheet: SheetReferenceSchema.describe('Target sheet - name or ID'),
  keyColumns: z.array(z.string().min(1)).min(1).describe('Columns to check for duplicates'),
  keep: DeduplicateKeepSchema.default('first').describe(
    'Which duplicate to keep (default: first | alternative: last)'
  ),
  preview: z
    .boolean()
    .default(false)
    .describe("Preview only, don't delete duplicates (default: false | set true for dry run)"),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options: dryRun for preview, autoSnapshot for automatic backups'
  ),
});

export const DuplicatePreviewItemSchema = z.object({
  rowNumber: z.coerce.number().int().min(1),
  keyValues: z.record(
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
  keepStatus: z.enum(['keep', 'delete']),
});

export const DeduplicateOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('deduplicate'),
  totalRows: z.coerce.number().int().min(0),
  uniqueRows: z.coerce.number().int().min(0),
  duplicatesFound: z.coerce.number().int().min(0),
  rowsDeleted: z.coerce.number().int().min(0),
  duplicatePreview: z.array(DuplicatePreviewItemSchema).optional(),
  snapshotId: z.string().optional(),
  mutation: MutationSummarySchema.optional(),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Export XLSX Action
// ============================================================================

export const ExportXlsxInputSchema = z.object({
  action: z.literal('export_xlsx').describe('Export spreadsheet as XLSX (Excel) file'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID to export'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const ExportXlsxOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('export_xlsx'),
  fileContent: z.string().describe('Base64-encoded XLSX file content'),
  mimeType: z
    .literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .describe('MIME type of exported file'),
  filename: z.string().describe('Suggested filename for download'),
  sizeBytes: z.coerce.number().int().describe('File size in bytes'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Import XLSX Action
// ============================================================================

export const ImportXlsxInputSchema = z.object({
  action: z.literal('import_xlsx').describe('Import XLSX (Excel) file as new spreadsheet'),
  fileContent: z.string().describe('Base64-encoded XLSX file content'),
  title: z.string().max(255).optional().describe('Title for the new spreadsheet'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

export const ImportXlsxOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('import_xlsx'),
  spreadsheetId: SpreadsheetIdSchema.describe('ID of created spreadsheet'),
  spreadsheetUrl: z.string().describe('URL to the new spreadsheet'),
  sheetsImported: z.coerce.number().int().describe('Number of sheets imported'),
  sheetNames: z.array(z.string()).describe('Names of imported sheets'),
  mutation: MutationSummarySchema.optional(),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Get Form Responses Action (via linked sheet)
// ============================================================================

export const GetFormResponsesInputSchema = z.object({
  action: z
    .literal('get_form_responses')
    .describe('Read Google Form responses from a form-linked spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID linked to a Google Form'),
  formResponsesSheet: z
    .string()
    .optional()
    .default('Form Responses 1')
    .describe('Sheet name containing form responses (default: "Form Responses 1")'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const GetFormResponsesOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('get_form_responses'),
  responseCount: z.coerce.number().int().describe('Total number of form responses'),
  columnHeaders: z.array(z.string()).describe('Form question headers'),
  latestResponse: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    )
    .optional()
    .describe(
      'Most recent form response (values can be string, number, boolean, null, array, or object)'
    ),
  oldestResponse: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
      ])
    )
    .optional()
    .describe(
      'First form response (values can be string, number, boolean, null, array, or object)'
    ),
  formLinked: z.boolean().describe('Whether the sheet appears to be form-linked'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// LLM-Optimized Workflow Actions (3 new - reduces multiple calls to 1)
// ============================================================================

/**
 * Setup Sheet - Creates a sheet with headers, formatting, and validation in one call
 * LLM Optimization: Saves 70-80% API calls vs manual setup
 */
export const SetupSheetInputSchema = z.object({
  action: z.literal('setup_sheet').describe('Create and configure a new sheet in one operation'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID'),
  sheetName: z.string().max(255).describe('Name for the new sheet'),
  headers: z.array(z.string()).min(1).max(100).describe('Column header names'),
  columnWidths: z
    .array(z.coerce.number().int().min(20).max(500))
    .optional()
    .describe('Column widths in pixels (same order as headers)'),
  headerFormat: z
    .object({
      bold: z.boolean().optional().default(true),
      backgroundColor: z
        .object({
          red: z.number().min(0).max(1),
          green: z.number().min(0).max(1),
          blue: z.number().min(0).max(1),
        })
        .optional(),
      textColor: z
        .object({
          red: z.number().min(0).max(1),
          green: z.number().min(0).max(1),
          blue: z.number().min(0).max(1),
        })
        .optional(),
    })
    .optional()
    .describe('Header row formatting'),
  alternatingRows: z
    .object({
      headerColor: z
        .object({
          red: z.number().min(0).max(1),
          green: z.number().min(0).max(1),
          blue: z.number().min(0).max(1),
        })
        .optional()
        .describe('Header row background color'),
      firstBandColor: z
        .object({
          red: z.number().min(0).max(1),
          green: z.number().min(0).max(1),
          blue: z.number().min(0).max(1),
        })
        .optional()
        .describe('First band row background color'),
      secondBandColor: z
        .object({
          red: z.number().min(0).max(1),
          green: z.number().min(0).max(1),
          blue: z.number().min(0).max(1),
        })
        .optional()
        .describe('Second band row background color'),
    })
    .optional()
    .describe('Optional alternating row banding colors'),
  data: z
    .array(z.array(z.string()))
    .optional()
    .describe('Optional initial data rows to write (beyond headers) in same call'),
  freezeHeaderRow: z.boolean().optional().default(true).describe('Freeze the header row'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const SetupSheetOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('setup_sheet'),
  sheetId: SheetIdSchema,
  sheetName: SheetNameSchema,
  columnCount: z.coerce.number().int(),
  rowsCreated: z.coerce.number().int().describe('Number of data rows created (beyond header)'),
  apiCallsSaved: z.coerce.number().int().describe('Number of API calls saved vs manual setup'),
  _meta: ResponseMetaSchema.optional(),
});

/**
 * Import and Format - Import CSV and apply formatting in one operation
 * LLM Optimization: Saves 60-70% API calls vs import + format separately
 */
export const ImportAndFormatInputSchema = z.object({
  action: z
    .literal('import_and_format')
    .describe('Import CSV data and apply formatting in one operation'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID'),
  sheet: SheetReferenceSchema.optional().describe('Target sheet (creates new if not specified)'),
  csvData: z.string().min(1).max(10485760).describe('CSV data as string (max 10MB)'),
  delimiter: z.string().max(5).default(',').describe('Field delimiter'),
  hasHeader: z.boolean().default(true).describe('First row is header'),
  newSheetName: z.string().max(255).optional().describe('Name for new sheet'),
  headerFormat: z
    .object({
      bold: z.boolean().optional().default(true),
      backgroundColor: z
        .object({
          red: z.number().min(0).max(1),
          green: z.number().min(0).max(1),
          blue: z.number().min(0).max(1),
        })
        .optional(),
    })
    .optional()
    .describe('Header row formatting'),
  freezeHeaderRow: z.boolean().optional().default(true).describe('Freeze the header row'),
  autoResizeColumns: z.boolean().optional().default(true).describe('Auto-resize columns to fit'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
});

export const ImportAndFormatOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('import_and_format'),
  rowsImported: z.coerce.number().int().min(0),
  columnsImported: z.coerce.number().int().min(0),
  sheetId: SheetIdSchema,
  sheetName: SheetNameSchema,
  range: z.string(),
  apiCallsSaved: z.coerce.number().int().describe('Number of API calls saved vs manual process'),
  mutation: MutationSummarySchema.optional(),
  _meta: ResponseMetaSchema.optional(),
});

/**
 * Clone Structure - Copy sheet structure without data
 * LLM Optimization: Saves 50-60% API calls vs manual copy + clear
 */
export const CloneStructureInputSchema = z.object({
  action: z
    .literal('clone_structure')
    .describe('Clone sheet structure (headers, formats) without data'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID'),
  sourceSheet: SheetReferenceSchema.describe('Source sheet to clone from'),
  newSheetName: z.string().max(255).describe('Name for the cloned sheet'),
  includeFormatting: z.boolean().optional().default(true).describe('Copy cell formatting'),
  includeConditionalFormatting: z
    .boolean()
    .optional()
    .default(true)
    .describe('Copy conditional formatting rules'),
  includeDataValidation: z
    .boolean()
    .optional()
    .default(true)
    .describe('Copy data validation rules'),
  headerRowCount: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe('Number of header rows to preserve'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const CloneStructureOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('clone_structure'),
  newSheetId: SheetIdSchema,
  newSheetName: SheetNameSchema,
  columnCount: z.coerce.number().int(),
  headerRowsPreserved: z.coerce.number().int(),
  formattingCopied: z.boolean(),
  validationCopied: z.boolean(),
  apiCallsSaved: z.coerce.number().int().describe('Number of API calls saved vs manual process'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Export Large Dataset Action (Streaming)
// ============================================================================

export const ExportLargeDatasetInputSchema = z.object({
  action: z
    .literal('export_large_dataset')
    .describe('Export large dataset with streaming (100K+ rows)'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID to export'),
  range: RangeInputSchema.describe('Range to export (e.g., "Sheet1!A:Z" or named range)'),
  chunkSize: z.coerce
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .default(1000)
    .describe('Rows per chunk (default: 1000)'),
  format: z
    .enum(['json', 'csv'])
    .optional()
    .default('json')
    .describe('Output format (default: json)'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const ExportLargeDatasetOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('export_large_dataset'),
  format: z.enum(['json', 'csv']).describe('Output format used'),
  chunkSize: z.coerce.number().int().optional().describe('Chunk size used for export'),
  totalRows: z.coerce.number().int().describe('Total rows exported'),
  totalColumns: z.coerce.number().int().describe('Total columns exported'),
  chunksProcessed: z.coerce.number().int().describe('Number of chunks processed'),
  bytesProcessed: z.coerce.number().int().describe('Total bytes processed'),
  durationMs: z.coerce.number().int().describe('Export duration in milliseconds'),
  streamed: z.boolean().describe('Whether streaming was used'),
  data: z.string().describe('Exported data (JSON string or CSV string)'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// P14-C1: New Composite Workflow Actions (5 new)
// ============================================================================

/**
 * audit_sheet — Generate a comprehensive audit report for a spreadsheet
 */
export const AuditSheetInputSchema = z.object({
  action: z
    .literal('audit_sheet')
    .describe('Generate a comprehensive audit report for a spreadsheet'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID to audit'),
  sheetName: z
    .string()
    .optional()
    .describe('Audit a specific sheet (audits all sheets if omitted)'),
  includeFormulas: z.boolean().optional().default(true).describe('Count and report formula cells'),
  includeStats: z.boolean().optional().default(true).describe('Include per-column statistics'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const AuditIssueSchema = z.object({
  type: z.string().describe('Issue type (e.g., empty_header, mixed_types, potential_circular_ref)'),
  location: z.string().describe('Cell or range where the issue was found'),
  message: z.string().describe('Human-readable description of the issue'),
});

export const AuditResultSchema = z.object({
  totalCells: z.coerce.number().int().min(0),
  formulaCells: z.coerce.number().int().min(0),
  blankCells: z.coerce.number().int().min(0),
  dataCells: z.coerce.number().int().min(0),
  sheetsAudited: z.coerce.number().int().min(1),
  issues: z.array(AuditIssueSchema),
});

export const AuditSheetOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('audit_sheet'),
  audit: AuditResultSchema,
  _meta: ResponseMetaSchema.optional(),
});

/**
 * publish_report — Export a sheet/range as a formatted report
 */
export const PublishReportInputSchema = z.object({
  action: z.literal('publish_report').describe('Export a sheet/range as a formatted report'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID to export'),
  range: z
    .string()
    .optional()
    .describe('Range to export (e.g., "Sheet1!A1:D100"); uses first sheet if omitted'),
  format: z.enum(['pdf', 'xlsx', 'csv']).default('pdf').describe('Export format'),
  title: z.string().optional().describe('Report title to include in metadata'),
  includeDate: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include generation timestamp in metadata'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const ReportResultSchema = z.object({
  format: z.enum(['pdf', 'xlsx', 'csv']),
  title: z.string().optional(),
  generatedAt: z.string().describe('ISO 8601 timestamp of when the report was generated'),
  fileId: z.string().optional().describe('Drive file ID if exported to Drive'),
  content: z.string().optional().describe('Report content (CSV text or base64-encoded binary)'),
  sizeBytes: z.coerce.number().int().optional(),
});

export const PublishReportOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('publish_report'),
  report: ReportResultSchema,
  _meta: ResponseMetaSchema.optional(),
});

/**
 * data_pipeline — Execute a sequence of data transformation steps on a range
 */
export const PipelineStepTypeSchema = z.enum([
  'filter',
  'sort',
  'deduplicate',
  'transform',
  'aggregate',
]);

export const PipelineStepSchema = z.object({
  type: PipelineStepTypeSchema.describe('Transformation step type'),
  config: z
    .record(z.string(), z.unknown())
    .describe('Step-specific configuration (column, value, order, formula, etc.)'),
});

export const DataPipelineInputSchema = z.object({
  action: z
    .literal('data_pipeline')
    .describe('Execute a sequence of data transformation steps on a range'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID'),
  sourceRange: RangeInputSchema.describe(
    'Source range to read (e.g., "Sheet1!A1:D100" or named range)'
  ),
  steps: z.array(PipelineStepSchema).describe('Ordered list of transformation steps to apply'),
  outputRange: RangeInputSchema.optional().describe(
    'Write results to this range (writes back if provided and not dryRun)'
  ),
  dryRun: z.boolean().optional().default(false).describe('Preview results without writing'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const PipelineResultSchema = z.object({
  stepsExecuted: z.coerce.number().int().min(0),
  rowsIn: z.coerce.number().int().min(0),
  rowsOut: z.coerce.number().int().min(0),
  preview: z
    .array(z.array(z.unknown()))
    .describe('First 5 rows of transformed output (including header)'),
});

export const DataPipelineOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('data_pipeline'),
  pipeline: PipelineResultSchema,
  _meta: ResponseMetaSchema.optional(),
});

/**
 * instantiate_template — Apply a saved template with variable substitution
 */
export const InstantiateTemplateInputSchema = z.object({
  action: z
    .literal('instantiate_template')
    .describe('Apply a saved template with variable substitution'),
  templateId: z
    .string()
    .describe('Template spreadsheet ID (from sheets_templates or a known Google Sheets file)'),
  variables: z
    .record(z.string(), z.string())
    .describe(
      'Key-value map of placeholder names to replacement values (e.g., { "companyName": "Acme Corp" })'
    ),
  targetSpreadsheetId: SpreadsheetIdSchema.optional().describe(
    'Write substituted values here (creates new spreadsheet if omitted)'
  ),
  targetSheetName: z
    .string()
    .optional()
    .describe('Target sheet name (uses first sheet if omitted)'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options: dryRun for preview'),
});

export const InstantiationResultSchema = z.object({
  spreadsheetId: z.string().describe('Spreadsheet where substituted data was written'),
  sheetName: z.string().describe('Sheet where substituted data was written'),
  substitutionsApplied: z.coerce
    .number()
    .int()
    .min(0)
    .describe('Total placeholder substitutions made'),
  cellsUpdated: z.coerce
    .number()
    .int()
    .min(0)
    .describe('Total cells updated (including those with substitutions)'),
});

export const InstantiateTemplateOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('instantiate_template'),
  instantiation: InstantiationResultSchema,
  _meta: ResponseMetaSchema.optional(),
});

/**
 * migrate_spreadsheet — Migrate data from one spreadsheet to another with column mapping
 */
export const ColumnMappingSchema = z.object({
  sourceColumn: z.string().describe('Source column header name'),
  destinationColumn: z.string().describe('Destination column header name'),
  transform: z
    .enum(['none', 'uppercase', 'lowercase', 'number', 'date'])
    .optional()
    .default('none')
    .describe('Value transformation to apply'),
});

export const MigrateSpreadsheetInputSchema = z.object({
  action: z
    .literal('migrate_spreadsheet')
    .describe('Migrate data from one spreadsheet to another with column mapping'),
  sourceSpreadsheetId: SpreadsheetIdSchema.describe('Source spreadsheet ID'),
  sourceRange: RangeInputSchema.describe(
    'Source range to read (e.g., "Sheet1!A1:D100" or named range)'
  ),
  destinationSpreadsheetId: SpreadsheetIdSchema.describe('Destination spreadsheet ID'),
  destinationRange: RangeInputSchema.describe(
    'Destination range to write to (e.g., "Sheet1!A1" or named range)'
  ),
  columnMapping: z
    .array(ColumnMappingSchema)
    .min(1)
    .describe('Column mapping from source to destination'),
  appendMode: z
    .boolean()
    .optional()
    .default(true)
    .describe('Append rows to destination (true) or overwrite (false)'),
  dryRun: z.boolean().optional().default(false).describe('Preview migration without writing'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe('Safety options: dryRun for preview'),
});

export const MigrationResultSchema = z.object({
  rowsMigrated: z.coerce.number().int().min(0),
  columnsMapped: z.coerce.number().int().min(0),
  destinationRange: z.string().describe('Actual destination range written to'),
  preview: z
    .array(z.array(z.unknown()))
    .describe('First 3 rows of migrated data (preview of what was or would be written)'),
});

export const MigrateSpreadsheetOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('migrate_spreadsheet'),
  migration: MigrationResultSchema,
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Natural Language Sheet Generator Actions (F1)
// ============================================================================

/**
 * Style preset for generated sheets
 */
export const GenerationStyleSchema = z
  .enum(['minimal', 'professional', 'dashboard'])
  .default('professional')
  .describe(
    'Visual style preset: minimal (clean, no colors), professional (headers, borders, number formats), dashboard (conditional formatting, charts-ready)'
  );

/**
 * Column definition in a generated sheet
 */
export const GeneratedColumnSchema = z.object({
  header: z.string().describe('Column header text'),
  type: z
    .enum(['text', 'number', 'currency', 'percentage', 'date', 'boolean', 'formula'])
    .describe('Data type for formatting and validation'),
  width: z.coerce.number().int().min(30).max(500).optional().describe('Column width in pixels'),
  formula: z.string().optional().describe('Row-level formula template (use {row} for current row)'),
  numberFormat: z.string().optional().describe('Custom number format pattern'),
  description: z
    .string()
    .optional()
    .describe('Column description (used for data validation tooltip)'),
});

/**
 * Row data in a generated sheet
 */
export const GeneratedRowSchema = z.object({
  values: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .describe('Cell values in column order'),
  formulas: z
    .array(z.string().nullable())
    .optional()
    .describe('Override formulas for specific cells (null = use value)'),
});

/**
 * Conditional formatting rule for generated sheets
 */
export const GeneratedConditionalRuleSchema = z.object({
  range: z.string().describe('A1 notation range to apply the rule'),
  rule: z
    .enum([
      'negative_red',
      'positive_green',
      'zero_gray',
      'above_average_green',
      'below_average_red',
      'color_scale',
      'data_bar',
    ])
    .describe('Preset conditional formatting rule'),
});

/**
 * Formatting specification for generated sheets
 */
export const GeneratedFormattingSchema = z.object({
  headerStyle: z
    .enum(['bold_blue_background', 'bold_gray_background', 'bold_underline', 'bold_border_bottom'])
    .optional()
    .default('bold_blue_background')
    .describe('Header row style preset'),
  numberFormat: z.string().optional().describe('Default number format for currency/number columns'),
  conditionalRules: z
    .array(GeneratedConditionalRuleSchema)
    .optional()
    .describe('Conditional formatting rules'),
  freezeRows: z.coerce
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(1)
    .describe('Rows to freeze'),
  freezeColumns: z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .default(0)
    .describe('Columns to freeze'),
  alternatingRows: z.boolean().optional().default(false).describe('Enable alternating row colors'),
});

/**
 * Sheet definition within a generated spreadsheet
 */
export const GeneratedSheetDefinitionSchema = z.object({
  name: z.string().max(255).describe('Sheet/tab name'),
  columns: z.array(GeneratedColumnSchema).min(1).max(50).describe('Column definitions'),
  rows: z.array(GeneratedRowSchema).optional().describe('Sample data rows'),
  formatting: GeneratedFormattingSchema.optional().describe('Formatting specification'),
});

/**
 * Full sheet generation result
 */
export const SheetDefinitionSchema = z.object({
  title: z.string().describe('Spreadsheet title'),
  sheets: z.array(GeneratedSheetDefinitionSchema).min(1).max(10).describe('Sheet definitions'),
});

/**
 * generate_sheet — Create a fully structured spreadsheet from a natural language description
 */
export const GenerateSheetInputSchema = z.object({
  action: z
    .literal('generate_sheet')
    .describe('Create a structured, formatted spreadsheet from a natural language description'),
  description: z
    .string()
    .min(10)
    .max(2000)
    .describe(
      'Natural language description of the spreadsheet to create (e.g., "Q1 budget tracker with revenue by month, expense categories, and profit margin formulas")'
    ),
  context: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Additional context: industry, company size, specific requirements, or data constraints'
    ),
  style: GenerationStyleSchema.optional().describe('Visual style preset'),
  spreadsheetId: SpreadsheetIdSchema.optional().describe(
    'Existing spreadsheet to add sheet to (creates new spreadsheet if omitted)'
  ),
  sheetName: SheetNameSchema.optional().describe(
    'Sheet name (auto-generated from description if omitted)'
  ),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  safety: SafetyOptionsSchema.optional().describe(
    'Safety options: dryRun for preview, autoSnapshot for automatic backups'
  ),
});

export const GenerateSheetOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('generate_sheet'),
  spreadsheetId: SpreadsheetIdSchema,
  spreadsheetUrl: z.string().url().describe('URL to open the generated spreadsheet'),
  title: z.string().describe('Spreadsheet title'),
  sheetsCreated: z.coerce.number().int().min(1).describe('Number of sheets/tabs created'),
  columnsCreated: z.coerce.number().int().min(1).describe('Total columns across all sheets'),
  rowsCreated: z.coerce.number().int().min(0).describe('Total data rows (excluding headers)'),
  formulasApplied: z.coerce.number().int().min(0).describe('Number of formula cells created'),
  formattingApplied: z.boolean().describe('Whether formatting was applied'),
  definition: SheetDefinitionSchema.optional().describe(
    'Full sheet definition (included at detailed verbosity)'
  ),
  _meta: ResponseMetaSchema.optional(),
});

/**
 * generate_template — Create a reusable template from a natural language description
 */
export const GenerateTemplateInputSchema = z.object({
  action: z
    .literal('generate_template')
    .describe(
      'Create a reusable template definition from a natural language description (saved via sheets_templates)'
    ),
  description: z
    .string()
    .min(10)
    .max(2000)
    .describe('Natural language description of the template to create'),
  parameterize: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, replace sample values with {{placeholder}} tokens for parameterized filling'
    ),
  style: GenerationStyleSchema.optional().describe('Visual style preset'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const GenerateTemplateOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('generate_template'),
  templateId: z.string().describe('Template ID for later use with sheets_templates.apply'),
  name: z.string().describe('Template name (derived from description)'),
  sheetsCount: z.coerce.number().int().min(1).describe('Number of sheet definitions in template'),
  columnsCount: z.coerce.number().int().min(1).describe('Total columns across all sheets'),
  parameters: z
    .array(z.string())
    .optional()
    .describe('Parameterized placeholder names (if parameterize=true)'),
  definition: SheetDefinitionSchema.optional().describe(
    'Full template definition (included at standard+ verbosity)'
  ),
  _meta: ResponseMetaSchema.optional(),
});

/**
 * preview_generation — Dry-run: see proposed structure without creating anything
 */
export const PreviewGenerationInputSchema = z.object({
  action: z
    .literal('preview_generation')
    .describe(
      'Preview the structure that would be generated from a description without creating anything'
    ),
  description: z
    .string()
    .min(10)
    .max(2000)
    .describe('Natural language description of the spreadsheet to preview'),
  context: z.string().max(2000).optional().describe('Additional context for generation'),
  style: GenerationStyleSchema.optional().describe('Visual style preset'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const PreviewGenerationOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('preview_generation'),
  definition: SheetDefinitionSchema.describe('Proposed sheet structure (not yet created)'),
  estimatedCells: z.coerce.number().int().describe('Estimated total cells to be created'),
  estimatedFormulas: z.coerce.number().int().describe('Estimated formula cells'),
  formattingPreview: z
    .array(z.string())
    .describe('Human-readable list of formatting that would be applied'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Batch Operations Action - Execute multiple actions in a single call
// ============================================================================

export const BatchOperationRequestSchema = z.object({
  tool: z.string().min(1).describe('Target tool name (e.g., "sheets_data")'),
  action: z.string().min(1).describe('Action name (e.g., "write")'),
  params: z
    .record(z.string(), z.unknown())
    .describe('Action-specific parameters (spreadsheetId auto-injected)'),
});

export const BatchOperationsInputSchema = z.object({
  action: z.literal('batch_operations').describe('Execute multiple actions in a single tool call'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID (auto-injected into each operation)'),
  operations: z
    .array(BatchOperationRequestSchema)
    .min(1)
    .max(20)
    .describe('Operations to execute sequentially (max 20)'),
  atomic: z
    .boolean()
    .default(false)
    .describe('If true, all operations succeed or all roll back (requires active session)'),
  stopOnError: z
    .boolean()
    .default(true)
    .describe('If true, halt on first failure; if false, continue and report all results'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

export const BatchOperationResultSchema = z.object({
  index: z.coerce.number().int().min(0).describe('Operation index in request'),
  tool: z.string().describe('Tool that was called'),
  action: z.string().describe('Action that was called'),
  success: z.boolean().describe('Whether this operation succeeded'),
  data: z.unknown().optional().describe('Operation result (if successful)'),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .optional()
    .describe('Error details (if failed)'),
});

export const BatchOperationsOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('batch_operations'),
  total: z.coerce.number().int().min(0).describe('Total operations requested'),
  succeeded: z.coerce.number().int().min(0).describe('Number of successful operations'),
  failed: z.coerce.number().int().min(0).describe('Number of failed operations'),
  results: z.array(BatchOperationResultSchema).describe('Results for each operation'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Build Dashboard Action
// ============================================================================

/**
 * build_dashboard — Create an analytics dashboard sheet with KPIs, charts, and slicers
 */
export const BuildDashboardInputSchema = z
  .object({
    action: z.literal('build_dashboard'),
    spreadsheetId: SpreadsheetIdSchema.describe(
      'ID of the spreadsheet containing the data source. ' +
        'Example: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"'
    ),
    dataSheet: z
      .string()
      .describe(
        'Name of the sheet tab containing the source data to visualize. ' +
          'This sheet must already exist with data. Example: "Sales Data"'
      ),
    dashboardSheet: z
      .string()
      .default('Dashboard')
      .describe(
        'Name for the new dashboard sheet tab to create. ' +
          'Will be created if it does not exist. Default: "Dashboard"'
      ),
    layout: z
      .enum(['kpi_header', 'full_analytics', 'executive_summary'])
      .default('full_analytics')
      .describe(
        'Dashboard layout style. ' +
          '"kpi_header": KPI metrics row at top only. ' +
          '"full_analytics": KPIs + charts + slicers (recommended). ' +
          '"executive_summary": Condensed single-page summary.'
      ),
    kpis: z
      .array(
        z.object({
          label: z.string().describe('Display label for the KPI. Example: "Total Revenue"'),
          formula: z
            .string()
            .describe(
              'Google Sheets formula for the KPI value. Must include = prefix. ' +
                'Example: "=SUM(\'Sales Data\'!B:B)"'
            ),
          format: z
            .enum(['currency', 'percentage', 'number', 'date'])
            .default('number')
            .describe('Number format for the KPI value display.'),
        })
      )
      .optional()
      .describe(
        'KPI metrics to display in the header row. Each becomes a labeled metric cell. ' +
          'Example: [{ label: "Revenue", formula: "=SUM(B:B)", format: "currency" }]'
      ),
    charts: z
      .array(
        z.object({
          type: z.string().describe('Chart type. Examples: BAR, LINE, PIE, COLUMN, SCATTER'),
          dataRange: z
            .string()
            .describe('A1 notation range for chart data. Example: "\'Sales Data\'!A1:B12"'),
          title: z.string().describe('Chart title. Example: "Monthly Revenue"'),
        })
      )
      .optional()
      .describe('Charts to embed in the dashboard.'),
    slicers: z
      .array(
        z.object({
          filterColumn: z
            .number()
            .int()
            .min(0)
            .describe('0-based column index to filter on. Column A = 0, B = 1, etc.'),
          title: z.string().describe('Slicer title. Example: "Filter by Region"'),
        })
      )
      .optional()
      .describe('Interactive filter slicers to add below charts.'),
    verbosity: z
      .enum(['minimal', 'standard', 'detailed'])
      .optional()
      .default('standard')
      .describe('Response detail level'),
  })
  .describe(
    'Build a complete analytics dashboard sheet with KPI metrics, charts, and optional slicers. ' +
      'Creates a new sheet tab with formatted KPI row, embedded charts, and filter controls. ' +
      'Example: build_dashboard dataSheet:"Sales" layout:"full_analytics" kpis:[{ label:"Revenue", formula:"=SUM(\'Sales\'!B:B)", format:"currency" }]'
  );

export const BuildDashboardOutputSchema = z.object({
  success: z.literal(true),
  action: z.literal('build_dashboard'),
  dashboardSheet: z.string().describe('Name of the created dashboard sheet'),
  kpisAdded: z.coerce.number().int().min(0).describe('Number of KPI metrics added'),
  chartsAdded: z.coerce.number().int().min(0).describe('Number of charts embedded'),
  slicersAdded: z.coerce.number().int().min(0).describe('Number of slicers added'),
  message: z.string().describe('Summary of the dashboard creation'),
  _meta: ResponseMetaSchema.optional(),
});

// ============================================================================
// Combined Composite Input/Output
// ============================================================================

/**
 * All composite operation inputs (21 actions)
 *
 * Original (7): import_csv, smart_append, bulk_update, deduplicate, export_xlsx, import_xlsx, get_form_responses
 * LLM-Optimized Workflows (3): setup_sheet, import_and_format, clone_structure
 * Streaming (1): export_large_dataset
 * NL Sheet Generator (3): generate_sheet, generate_template, preview_generation
 * P14-C1 Composite Workflows (5): audit_sheet, publish_report, data_pipeline, instantiate_template, migrate_spreadsheet
 * Orchestration (1): batch_operations
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 */
export const CompositeInputSchema = z.object({
  request: z.preprocess(
    normalizeCompositeRequest,
    z.discriminatedUnion('action', [
      // Original composite actions (7)
      ImportCsvInputSchema,
      SmartAppendInputSchema,
      BulkUpdateInputSchema,
      DeduplicateInputSchema,
      ExportXlsxInputSchema,
      ImportXlsxInputSchema,
      GetFormResponsesInputSchema,
      // LLM-optimized workflow actions (3)
      SetupSheetInputSchema,
      ImportAndFormatInputSchema,
      CloneStructureInputSchema,
      // Streaming actions (1)
      ExportLargeDatasetInputSchema,
      // NL Sheet Generator actions (3) — F1
      GenerateSheetInputSchema,
      GenerateTemplateInputSchema,
      PreviewGenerationInputSchema,
      // P14-C1 Composite Workflow actions (5)
      AuditSheetInputSchema,
      PublishReportInputSchema,
      DataPipelineInputSchema,
      InstantiateTemplateInputSchema,
      MigrateSpreadsheetInputSchema,
      // Orchestration actions (1)
      BatchOperationsInputSchema,
      // Dashboard (1)
      BuildDashboardInputSchema,
    ])
  ),
});

/**
 * Success outputs (20 actions)
 *
 * Using z.union() (not discriminated union) because output schemas
 * are only used for runtime validation, not for LLM guidance.
 * The discriminator field 'action' is already present in each schema.
 */
export const CompositeSuccessOutputSchema = z.union([
  ImportCsvOutputSchema,
  SmartAppendOutputSchema,
  BulkUpdateOutputSchema,
  DeduplicateOutputSchema,
  ExportXlsxOutputSchema,
  ImportXlsxOutputSchema,
  GetFormResponsesOutputSchema,
  // LLM-optimized workflow outputs
  SetupSheetOutputSchema,
  ImportAndFormatOutputSchema,
  CloneStructureOutputSchema,
  // Streaming outputs
  ExportLargeDatasetOutputSchema,
  // NL Sheet Generator outputs (F1)
  GenerateSheetOutputSchema,
  GenerateTemplateOutputSchema,
  PreviewGenerationOutputSchema,
  // P14-C1 Composite Workflow outputs
  AuditSheetOutputSchema,
  PublishReportOutputSchema,
  DataPipelineOutputSchema,
  InstantiateTemplateOutputSchema,
  MigrateSpreadsheetOutputSchema,
  // Orchestration outputs
  BatchOperationsOutputSchema,
  // Dashboard outputs
  BuildDashboardOutputSchema,
]);

/**
 * Error output
 */
export const CompositeErrorOutputSchema = z.object({
  success: z.literal(false),
  error: ErrorDetailSchema,
});

/**
 * Combined composite response
 */
export const CompositeResponseSchema = z.discriminatedUnion('success', [
  ImportCsvOutputSchema,
  SmartAppendOutputSchema,
  BulkUpdateOutputSchema,
  DeduplicateOutputSchema,
  ExportXlsxOutputSchema,
  ImportXlsxOutputSchema,
  GetFormResponsesOutputSchema,
  SetupSheetOutputSchema,
  ImportAndFormatOutputSchema,
  CloneStructureOutputSchema,
  ExportLargeDatasetOutputSchema,
  // NL Sheet Generator outputs (F1)
  GenerateSheetOutputSchema,
  GenerateTemplateOutputSchema,
  PreviewGenerationOutputSchema,
  // P14-C1 Composite Workflow outputs
  AuditSheetOutputSchema,
  PublishReportOutputSchema,
  DataPipelineOutputSchema,
  InstantiateTemplateOutputSchema,
  MigrateSpreadsheetOutputSchema,
  // Orchestration outputs
  BatchOperationsOutputSchema,
  // Dashboard outputs
  BuildDashboardOutputSchema,
  CompositeErrorOutputSchema,
]);

/**
 * Full composite output with response wrapper
 */
export const CompositeOutputSchema = z.object({
  response: CompositeResponseSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

export type SheetReference = z.infer<typeof SheetReferenceSchema>;
export type VerbosityLevel = z.infer<typeof VerbositySchema>;

export type ImportCsvInput = z.infer<typeof ImportCsvInputSchema>;
export type ImportCsvOutput = z.infer<typeof ImportCsvOutputSchema>;

export type SmartAppendInput = z.infer<typeof SmartAppendInputSchema>;
export type SmartAppendOutput = z.infer<typeof SmartAppendOutputSchema>;

export type BulkUpdateInput = z.infer<typeof BulkUpdateInputSchema>;
export type BulkUpdateOutput = z.infer<typeof BulkUpdateOutputSchema>;

export type DeduplicateInput = z.infer<typeof DeduplicateInputSchema>;
export type DeduplicateOutput = z.infer<typeof DeduplicateOutputSchema>;

export type ExportXlsxInput = z.infer<typeof ExportXlsxInputSchema>;
export type ExportXlsxOutput = z.infer<typeof ExportXlsxOutputSchema>;

export type ImportXlsxInput = z.infer<typeof ImportXlsxInputSchema>;
export type ImportXlsxOutput = z.infer<typeof ImportXlsxOutputSchema>;

export type GetFormResponsesInput = z.infer<typeof GetFormResponsesInputSchema>;
export type GetFormResponsesOutput = z.infer<typeof GetFormResponsesOutputSchema>;

export type ExportLargeDatasetInput = z.infer<typeof ExportLargeDatasetInputSchema>;
export type ExportLargeDatasetOutput = z.infer<typeof ExportLargeDatasetOutputSchema>;

// LLM-optimized workflow types
export type SetupSheetInput = z.infer<typeof SetupSheetInputSchema>;
export type SetupSheetOutput = z.infer<typeof SetupSheetOutputSchema>;
export type ImportAndFormatInput = z.infer<typeof ImportAndFormatInputSchema>;
export type ImportAndFormatOutput = z.infer<typeof ImportAndFormatOutputSchema>;
export type CloneStructureInput = z.infer<typeof CloneStructureInputSchema>;
export type CloneStructureOutput = z.infer<typeof CloneStructureOutputSchema>;

// NL Sheet Generator types (F1)
export type GenerationStyle = z.infer<typeof GenerationStyleSchema>;
export type GeneratedColumn = z.infer<typeof GeneratedColumnSchema>;
export type GeneratedRow = z.infer<typeof GeneratedRowSchema>;
export type GeneratedConditionalRule = z.infer<typeof GeneratedConditionalRuleSchema>;
export type GeneratedFormatting = z.infer<typeof GeneratedFormattingSchema>;
export type GeneratedSheetDefinition = z.infer<typeof GeneratedSheetDefinitionSchema>;
export type SheetDefinition = z.infer<typeof SheetDefinitionSchema>;
export type GenerateSheetInput = z.infer<typeof GenerateSheetInputSchema>;
export type GenerateSheetOutput = z.infer<typeof GenerateSheetOutputSchema>;
export type GenerateTemplateInput = z.infer<typeof GenerateTemplateInputSchema>;
export type GenerateTemplateOutput = z.infer<typeof GenerateTemplateOutputSchema>;
export type PreviewGenerationInput = z.infer<typeof PreviewGenerationInputSchema>;
export type PreviewGenerationOutput = z.infer<typeof PreviewGenerationOutputSchema>;

export type CompositeInput = z.infer<typeof CompositeInputSchema>;
export type CompositeSuccessOutput = z.infer<typeof CompositeSuccessOutputSchema>;
export type CompositeOutput = z.infer<typeof CompositeOutputSchema>;

// Type narrowing helpers for handler methods
// These provide type safety similar to discriminated union Extract<>
export type CompositeImportCsvInput = CompositeInput['request'] & {
  action: 'import_csv';
  spreadsheetId: string;
  csvData: string;
};
export type CompositeSmartAppendInput = CompositeInput['request'] & {
  action: 'smart_append';
  spreadsheetId: string;
  sheet: SheetReference;
  data: Array<Record<string, unknown>>;
};
export type CompositeBulkUpdateInput = CompositeInput['request'] & {
  action: 'bulk_update';
  spreadsheetId: string;
  sheet: SheetReference;
  keyColumn: string;
  updates: Array<Record<string, unknown>>;
};
export type CompositeDeduplicateInput = CompositeInput['request'] & {
  action: 'deduplicate';
  spreadsheetId: string;
  sheet: SheetReference;
  keyColumns: string[];
};
export type CompositeExportXlsxInput = CompositeInput['request'] & {
  action: 'export_xlsx';
  spreadsheetId: string;
};
export type CompositeImportXlsxInput = CompositeInput['request'] & {
  action: 'import_xlsx';
  fileContent: string;
};
export type CompositeGetFormResponsesInput = CompositeInput['request'] & {
  action: 'get_form_responses';
  spreadsheetId: string;
};
export type CompositeExportLargeDatasetInput = CompositeInput['request'] & {
  action: 'export_large_dataset';
  spreadsheetId: string;
  range: string;
};

// LLM-optimized workflow type helpers
export type CompositeSetupSheetInput = CompositeInput['request'] & {
  action: 'setup_sheet';
  spreadsheetId: string;
  sheetName: string;
  headers: string[];
};
export type CompositeImportAndFormatInput = CompositeInput['request'] & {
  action: 'import_and_format';
  spreadsheetId: string;
  csvData: string;
};
export type CompositeCloneStructureInput = CompositeInput['request'] & {
  action: 'clone_structure';
  spreadsheetId: string;
  sourceSheet: SheetReference;
  newSheetName: string;
};

// NL Sheet Generator type helpers (F1)
export type CompositeGenerateSheetInput = CompositeInput['request'] & {
  action: 'generate_sheet';
  description: string;
};
export type CompositeGenerateTemplateInput = CompositeInput['request'] & {
  action: 'generate_template';
  description: string;
};
export type CompositePreviewGenerationInput = CompositeInput['request'] & {
  action: 'preview_generation';
  description: string;
};

// P14-C1 Composite Workflow types
export type AuditIssue = z.infer<typeof AuditIssueSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
export type AuditSheetInput = z.infer<typeof AuditSheetInputSchema>;
export type AuditSheetOutput = z.infer<typeof AuditSheetOutputSchema>;

export type ReportResult = z.infer<typeof ReportResultSchema>;
export type PublishReportInput = z.infer<typeof PublishReportInputSchema>;
export type PublishReportOutput = z.infer<typeof PublishReportOutputSchema>;

export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type PipelineResult = z.infer<typeof PipelineResultSchema>;
export type DataPipelineInput = z.infer<typeof DataPipelineInputSchema>;
export type DataPipelineOutput = z.infer<typeof DataPipelineOutputSchema>;

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type InstantiationResult = z.infer<typeof InstantiationResultSchema>;
export type InstantiateTemplateInput = z.infer<typeof InstantiateTemplateInputSchema>;
export type InstantiateTemplateOutput = z.infer<typeof InstantiateTemplateOutputSchema>;

export type MigrationResult = z.infer<typeof MigrationResultSchema>;
export type MigrateSpreadsheetInput = z.infer<typeof MigrateSpreadsheetInputSchema>;
export type MigrateSpreadsheetOutput = z.infer<typeof MigrateSpreadsheetOutputSchema>;

// Type narrowing helpers for new P14-C1 actions
export type CompositeAuditSheetInput = CompositeInput['request'] & {
  action: 'audit_sheet';
  spreadsheetId: string;
};
export type CompositePublishReportInput = CompositeInput['request'] & {
  action: 'publish_report';
  spreadsheetId: string;
};
export type CompositeDataPipelineInput = CompositeInput['request'] & {
  action: 'data_pipeline';
  spreadsheetId: string;
  sourceRange: string;
  steps: PipelineStep[];
};
export type CompositeInstantiateTemplateInput = CompositeInput['request'] & {
  action: 'instantiate_template';
  templateId: string;
  variables: Record<string, string>;
};
export type CompositeMigrateSpreadsheetInput = CompositeInput['request'] & {
  action: 'migrate_spreadsheet';
  sourceSpreadsheetId: string;
  sourceRange: string;
  destinationSpreadsheetId: string;
  destinationRange: string;
  columnMapping: ColumnMapping[];
};

// Orchestration types
export type BatchOperationRequest = z.infer<typeof BatchOperationRequestSchema>;
export type BatchOperationResult = z.infer<typeof BatchOperationResultSchema>;
export type BatchOperationsInput = z.infer<typeof BatchOperationsInputSchema>;
export type BatchOperationsOutput = z.infer<typeof BatchOperationsOutputSchema>;

export type CompositeBatchOperationsInput = CompositeInput['request'] & {
  action: 'batch_operations';
  spreadsheetId: string;
  operations: BatchOperationRequest[];
};

// Dashboard types
export type BuildDashboardInput = z.infer<typeof BuildDashboardInputSchema>;
export type BuildDashboardOutput = z.infer<typeof BuildDashboardOutputSchema>;

export type CompositeBuildDashboardInput = CompositeInput['request'] & {
  action: 'build_dashboard';
  spreadsheetId: string;
  dataSheet: string;
};

// ============================================================================
// Tool Annotations
// ============================================================================

export const SHEETS_COMPOSITE_ANNOTATIONS: ToolAnnotations = {
  title: 'Composite Operations',
  readOnlyHint: false,
  destructiveHint: true, // Can overwrite/modify data
  idempotentHint: false, // Import/append operations are not idempotent
  openWorldHint: true,
};
