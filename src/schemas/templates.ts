/**
 * Tool: sheets_templates
 * Manage reusable spreadsheet templates stored in Google Drive appDataFolder
 *
 * 8 actions: list, get, create, apply, update, delete, preview, import_builtin
 *
 * Storage: Google Drive appDataFolder (hidden, user-specific, auto-cleanup on uninstall)
 * Required scope: https://www.googleapis.com/auth/drive.appdata (non-sensitive)
 *
 * MCP Protocol: 2025-11-25
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  ErrorDetailSchema,
  ResponseMetaSchema,
  type ToolAnnotations,
} from './shared.js';

// Verbosity level for response filtering
const VerbositySchema = z
  .enum(['minimal', 'standard', 'detailed'])
  .optional()
  .default('standard')
  .describe(
    'Response verbosity: minimal (essential info only), standard (balanced), detailed (full metadata)'
  );

// ============================================================================
// TEMPLATE SCHEMA DEFINITIONS
// ============================================================================

/**
 * Sheet definition within a template
 */
const TemplateSheetSchema = z.object({
  name: z.string().describe('Sheet/tab name'),
  headers: z.array(z.string()).optional().describe('Column headers for first row'),
  columnWidths: z.array(z.number().int().positive()).optional().describe('Column widths in pixels'),
  rowCount: z.number().int().positive().optional().default(1000).describe('Initial row count'),
  columnCount: z.number().int().positive().optional().default(26).describe('Initial column count'),
  frozenRowCount: z.number().int().nonnegative().optional().describe('Number of frozen rows'),
  frozenColumnCount: z.number().int().nonnegative().optional().describe('Number of frozen columns'),
});

/**
 * Named range definition within a template
 */
const TemplateNamedRangeSchema = z.object({
  name: z.string().describe('Named range identifier'),
  range: z.string().describe('A1 notation range (e.g., "Sheet1!A1:C10")'),
});

/**
 * Full template definition
 */
const TemplateDefinitionSchema = z.object({
  id: z.string().describe('Unique template ID'),
  name: z.string().min(1).max(255).describe('Template display name'),
  description: z.string().optional().describe('What this template is for'),
  category: z.string().optional().describe('Template category (e.g., "finance", "project")'),
  version: z.string().optional().default('1.0.0').describe('Template version'),
  created: z.string().datetime().optional().describe('ISO timestamp of creation'),
  updated: z.string().datetime().optional().describe('ISO timestamp of last update'),
  sheets: z.array(TemplateSheetSchema).min(1).describe('Sheet definitions'),
  namedRanges: z.array(TemplateNamedRangeSchema).optional().describe('Named ranges to create'),
  metadata: z
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
    .describe('Custom metadata (string, number, boolean, null, array, or object)'),
});

/**
 * Template summary (for list responses)
 */
const TemplateSummarySchema = z.object({
  id: z.string().describe('Template ID'),
  name: z.string().describe('Template name'),
  description: z.string().optional().describe('Template description'),
  category: z.string().optional().describe('Template category'),
  version: z.string().optional().describe('Template version'),
  created: z.string().optional().describe('Creation timestamp'),
  updated: z.string().optional().describe('Last update timestamp'),
  sheetCount: z.number().int().nonnegative().describe('Number of sheets in template'),
});

// ============================================================================
// ACTION SCHEMAS (8 actions)
// ============================================================================

/**
 * List all saved templates
 */
const ListActionSchema = z.object({
  action: z.literal('list').describe('List all saved templates'),
  category: z.string().optional().describe('Filter by category'),
  includeBuiltin: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include builtin templates from knowledge base'),
  verbosity: VerbositySchema,
});

/**
 * Get template details
 */
const GetActionSchema = z.object({
  action: z.literal('get').describe('Get template details by ID'),
  templateId: z.string().describe('Template ID to retrieve'),
  verbosity: VerbositySchema,
});

/**
 * Create template from existing spreadsheet
 */
const CreateActionSchema = z.object({
  action: z.literal('create').describe('Save spreadsheet as a new template'),
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet to save as template'),
  name: z.string().min(1).max(255).describe('Template name'),
  description: z.string().optional().describe('Template description'),
  category: z.string().optional().describe('Template category'),
  includeData: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include cell data (not just structure)'),
  includeFormatting: z.boolean().optional().default(true).describe('Include formatting'),
  verbosity: VerbositySchema,
});

/**
 * Apply template to create new spreadsheet
 */
const ApplyActionSchema = z.object({
  action: z.literal('apply').describe('Create new spreadsheet from template'),
  templateId: z.string().describe('Template ID to apply'),
  title: z.string().min(1).max(255).describe('Title for new spreadsheet'),
  folderId: z.string().optional().describe('Google Drive folder ID to create in'),
  verbosity: VerbositySchema,
});

/**
 * Update existing template
 */
const UpdateActionSchema = z.object({
  action: z.literal('update').describe('Update template definition'),
  templateId: z.string().describe('Template ID to update'),
  name: z.string().min(1).max(255).optional().describe('New template name'),
  description: z.string().optional().describe('New description'),
  category: z.string().optional().describe('New category'),
  sheets: z.array(TemplateSheetSchema).optional().describe('Updated sheet definitions'),
  namedRanges: z.array(TemplateNamedRangeSchema).optional().describe('Updated named ranges'),
  metadata: z
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
    .describe('Updated metadata (string, number, boolean, null, array, or object)'),
  verbosity: VerbositySchema,
});

/**
 * Delete template
 */
const DeleteActionSchema = z.object({
  action: z.literal('delete').describe('Delete a saved template'),
  templateId: z.string().describe('Template ID to delete'),
  verbosity: VerbositySchema,
});

/**
 * Preview template structure
 */
const PreviewActionSchema = z.object({
  action: z.literal('preview').describe('Preview template structure without applying'),
  templateId: z.string().describe('Template ID to preview'),
  verbosity: VerbositySchema,
});

/**
 * Import builtin template to user's collection
 */
const ImportBuiltinActionSchema = z.object({
  action: z.literal('import_builtin').describe('Import a builtin template to your collection'),
  builtinName: z.string().describe('Name of builtin template (from knowledge base)'),
  customName: z.string().optional().describe('Custom name for imported template'),
  verbosity: VerbositySchema,
});

// ============================================================================
// INPUT SCHEMA (discriminated union wrapped in request)
// ============================================================================

const TemplatesRequestSchema = z.discriminatedUnion('action', [
  ListActionSchema,
  GetActionSchema,
  CreateActionSchema,
  ApplyActionSchema,
  UpdateActionSchema,
  DeleteActionSchema,
  PreviewActionSchema,
  ImportBuiltinActionSchema,
]);

export const SheetsTemplatesInputSchema = z.object({
  request: TemplatesRequestSchema,
});

// ============================================================================
// OUTPUT SCHEMA (response union)
// ============================================================================

const TemplatesResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // List response
    templates: z.array(TemplateSummarySchema).optional().describe('List of templates'),
    // Single template response
    template: TemplateDefinitionSchema.optional().describe('Template details'),
    // Apply response
    spreadsheetId: z.string().optional().describe('Created spreadsheet ID'),
    spreadsheetUrl: z.string().optional().describe('URL to new spreadsheet'),
    // Preview response
    preview: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        sheets: z.array(
          z.object({
            name: z.string(),
            headers: z.array(z.string()).optional(),
            rowCount: z.number().optional(),
            columnCount: z.number().optional(),
          })
        ),
        namedRanges: z.array(z.string()).optional(),
      })
      .optional()
      .describe('Template preview'),
    // Delete confirmation
    deleted: z.boolean().optional().describe('True if template was deleted'),
    // Import result
    importedTemplateId: z.string().optional().describe('ID of imported template'),
    // Counts
    totalTemplates: z.number().int().nonnegative().optional().describe('Total template count'),
    builtinCount: z.number().int().nonnegative().optional().describe('Builtin template count'),
    // Standard fields
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsTemplatesOutputSchema = z.object({
  response: TemplatesResponseSchema,
});

// ============================================================================
// ANNOTATIONS
// ============================================================================

/**
 * Tool annotations for MCP protocol
 *
 * - readOnlyHint: false (can create/update/delete templates)
 * - destructiveHint: true (delete action removes templates)
 * - idempotentHint: false (create/apply create new resources)
 * - openWorldHint: true (interacts with Google Drive API)
 */
export const SHEETS_TEMPLATES_ANNOTATIONS: ToolAnnotations = {
  title: 'Templates',
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type SheetsTemplatesInput = z.infer<typeof SheetsTemplatesInputSchema>;
export type SheetsTemplatesOutput = z.infer<typeof SheetsTemplatesOutputSchema>;
export type TemplatesResponse = z.infer<typeof TemplatesResponseSchema>;
export type TemplatesRequest = SheetsTemplatesInput['request'];
export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;
export type TemplateSheet = z.infer<typeof TemplateSheetSchema>;

// Type narrowing helpers for handler methods
export type TemplatesListInput = SheetsTemplatesInput['request'] & { action: 'list' };
export type TemplatesGetInput = SheetsTemplatesInput['request'] & {
  action: 'get';
  templateId: string;
};
export type TemplatesCreateInput = SheetsTemplatesInput['request'] & {
  action: 'create';
  spreadsheetId: string;
  name: string;
};
export type TemplatesApplyInput = SheetsTemplatesInput['request'] & {
  action: 'apply';
  templateId: string;
  title: string;
};
export type TemplatesUpdateInput = SheetsTemplatesInput['request'] & {
  action: 'update';
  templateId: string;
};
export type TemplatesDeleteInput = SheetsTemplatesInput['request'] & {
  action: 'delete';
  templateId: string;
};
export type TemplatesPreviewInput = SheetsTemplatesInput['request'] & {
  action: 'preview';
  templateId: string;
};
export type TemplatesImportBuiltinInput = SheetsTemplatesInput['request'] & {
  action: 'import_builtin';
  builtinName: string;
};
