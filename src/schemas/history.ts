/**
 * Tool: sheets_history
 * Operation history tracking for debugging and undo foundation.
 */

import { z } from 'zod';
import {
  ErrorDetailSchema,
  RangeInputSchema,
  ResponseMetaSchema,
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
      'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
    ),
});

// ============================================================================
// Individual Action Schemas
// ============================================================================

const ListActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list').describe('List operation history'),
  spreadsheetId: z
    .string()
    .min(1, 'Spreadsheet ID cannot be empty')
    .optional()
    .describe('Filter by spreadsheet ID (omit to show all)'),
  count: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10)
    .describe('Number of operations to return (default: 10)'),
  failuresOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe('Show only failed operations (default: false)'),
  cursor: z.string().optional().describe('Opaque pagination cursor from previous response'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Maximum number of items per page (default: 100, max: 1000)'),
});

const GetActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get').describe('Get details of a specific operation'),
  operationId: z.string().min(1).describe('Operation ID to retrieve'),
});

const StatsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('stats').describe('Get operation history statistics'),
});

const UndoActionSchema = CommonFieldsSchema.extend({
  action: z.literal('undo').describe('Undo the last operation on a spreadsheet'),
  spreadsheetId: z
    .string()
    .min(1, 'Spreadsheet ID cannot be empty')
    .describe('Spreadsheet ID from URL'),
});

const RedoActionSchema = CommonFieldsSchema.extend({
  action: z.literal('redo').describe('Redo the last undone operation on a spreadsheet'),
  spreadsheetId: z
    .string()
    .min(1, 'Spreadsheet ID cannot be empty')
    .describe('Spreadsheet ID from URL'),
});

const RevertToActionSchema = CommonFieldsSchema.extend({
  action: z.literal('revert_to').describe('Revert to a specific operation in history'),
  operationId: z.string().min(1).describe('Operation ID to revert to'),
  safety: z
    .object({
      dryRun: z
        .boolean()
        .optional()
        .describe(
          'If true, compute and return the diff of what would be reverted without executing'
        ),
    })
    .optional(),
});

const ClearActionSchema = CommonFieldsSchema.extend({
  action: z.literal('clear').describe('Clear operation history'),
  spreadsheetId: z
    .string()
    .min(1, 'Spreadsheet ID cannot be empty')
    .optional()
    .describe('Filter by spreadsheet ID (omit to clear all history)'),
});

// ============================================================================
// F5: Time-Travel Debugger (3 actions)
// ============================================================================

const TimelineActionSchema = CommonFieldsSchema.extend({
  action: z.literal('timeline').describe('View chronological change history for a spreadsheet'),
  spreadsheetId: z.string().min(1).describe('Spreadsheet ID'),
  range: RangeInputSchema.optional().describe('Focus on specific range'),
  since: z.string().optional().describe('ISO date — only show changes after this time'),
  until: z.string().optional().describe('ISO date — only show changes before this time'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50).describe('Max revisions'),
});

const DiffRevisionsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('diff_revisions').describe('Compare two revisions to see cell-level changes'),
  spreadsheetId: z.string().min(1).describe('Spreadsheet ID'),
  revisionId1: z.string().min(1).describe('First revision ID (older)'),
  revisionId2: z.string().min(1).describe('Second revision ID (newer)'),
  range: RangeInputSchema.optional().describe('Focus diff on specific range'),
});

const RestoreCellsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('restore_cells')
    .describe('Restore specific cells from a past revision (surgical restore, not full rollback)'),
  spreadsheetId: z.string().min(1).describe('Spreadsheet ID'),
  revisionId: z.string().min(1).describe('Source revision to restore from'),
  cells: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .describe('Cell references to restore (A1 notation, e.g. ["Sheet1!A1", "Sheet1!D15"])'),
  safety: z
    .object({
      dryRun: z.boolean().optional().describe('Preview what would be restored without writing'),
      createSnapshot: z
        .boolean()
        .optional()
        .default(true)
        .describe('Create backup before restoring'),
    })
    .optional(),
});

// ============================================================================
// Combined Input Schema
// ============================================================================

/**
 * All history operation inputs
 *
 * Proper discriminated union using Zod v4's z.discriminatedUnion() for:
 * - Better type safety at compile-time
 * - Clearer error messages for LLMs
 * - Each action has only its required fields (no optional field pollution)
 * - JSON Schema conversion handled by src/utils/schema-compat.ts
 */
export const SheetsHistoryInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    ListActionSchema,
    GetActionSchema,
    StatsActionSchema,
    UndoActionSchema,
    RedoActionSchema,
    RevertToActionSchema,
    ClearActionSchema,
    TimelineActionSchema,
    DiffRevisionsActionSchema,
    RestoreCellsActionSchema,
  ]),
});

const HistoryResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // list response
    operations: z
      .array(
        z.object({
          id: z.string(),
          tool: z.string(),
          action: z.string(),
          spreadsheetId: z.string().optional(),
          range: z.string().optional(),
          success: z.boolean(),
          duration: z.coerce.number(),
          timestamp: z.coerce.number(),
          error: z.string().optional(),
          snapshotId: z.string().optional(),
        })
      )
      .optional(),
    // Pagination (MCP 2025-11-25)
    nextCursor: z.string().optional().describe('Cursor for next page (null = no more data)'),
    hasMore: z.boolean().optional().describe('True if more history items available'),
    totalCount: z.coerce.number().int().optional().describe('Total number of history items'),
    // get response
    operation: z
      .object({
        id: z.string(),
        tool: z.string(),
        action: z.string(),
        params: z.record(
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
        result: z
          .union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
          ])
          .optional(),
        spreadsheetId: z.string().optional(),
        range: z.string().optional(),
        success: z.boolean(),
        duration: z.coerce.number(),
        timestamp: z.coerce.number(),
        error: z.string().optional(),
        snapshotId: z.string().optional(),
      })
      .optional(),
    // stats response
    stats: z
      .object({
        totalOperations: z.coerce.number(),
        successfulOperations: z.coerce.number(),
        failedOperations: z.coerce.number(),
        successRate: z.coerce.number(),
        avgDuration: z.coerce.number(),
        operationsByTool: z.record(z.string(), z.coerce.number()),
        recentFailures: z.coerce.number(),
      })
      .optional(),
    // undo/redo/revert response
    restoredSpreadsheetId: z
      .string()
      .optional()
      .describe('ID of restored spreadsheet (for undo/redo/revert)'),
    operationRestored: z
      .object({
        id: z.string(),
        tool: z.string(),
        action: z.string(),
        timestamp: z.coerce.number(),
      })
      .optional()
      .describe('Details of operation that was undone/redone'),
    // clear response
    operationsCleared: z.coerce.number().optional().describe('Number of operations cleared'),
    // F5: timeline response
    timeline: z
      .array(
        z.object({
          revisionId: z.string(),
          timestamp: z.string().describe('ISO timestamp'),
          user: z.string().optional().describe('Email of user who made the change'),
          displayName: z.string().optional(),
          sizeBytes: z.coerce.number().optional(),
          activityType: z.string().optional().describe('Drive Activity API event type (Phase 3)'),
        })
      )
      .optional()
      .describe('Chronological list of revisions'),
    activityAvailable: z
      .boolean()
      .optional()
      .describe('True if Drive Activity API provided WHO/WHEN attribution data'),
    totalFetched: z.coerce
      .number()
      .int()
      .optional()
      .describe('Total number of revisions fetched before local filtering/limits'),
    truncated: z
      .boolean()
      .optional()
      .describe('True if the Drive revisions history was truncated due to pagination caps'),
    nextPageToken: z
      .string()
      .optional()
      .describe('Opaque Drive revisions page token when history truncation occurred'),
    // F5: diff_revisions response
    diff: z
      .object({
        revision1: z.object({
          id: z.string(),
          timestamp: z.string().optional(),
          user: z.string().optional(),
        }),
        revision2: z.object({
          id: z.string(),
          timestamp: z.string().optional(),
          user: z.string().optional(),
        }),
        cellChanges: z
          .array(
            z.object({
              cell: z.string().describe('A1 reference'),
              oldValue: z.union([z.string(), z.number(), z.null()]).optional(),
              newValue: z.union([z.string(), z.number(), z.null()]).optional(),
              changeType: z.enum(['added', 'removed', 'modified']),
            })
          )
          .optional()
          .describe('Cell-level changes (null if content comparison unavailable)'),
        summary: z
          .object({
            metadataOnly: z.boolean().describe('True if only metadata comparison was possible'),
            rev1Size: z.coerce.number().optional(),
            rev2Size: z.coerce.number().optional(),
          })
          .optional(),
      })
      .optional(),
    // F5: restore_cells response
    restored: z
      .array(
        z.object({
          cell: z.string(),
          restoredValue: z.union([z.string(), z.number(), z.null()]).optional(),
        })
      )
      .optional()
      .describe('Cells that were restored'),
    snapshotId: z.string().optional().describe('Backup snapshot ID (for undo)'),
    // ISSUE-011: dryRun response fields for revert_to
    dryRun: z.boolean().optional().describe('True when request was a dry run (no changes made)'),
    wouldRevert: z
      .object({
        operationId: z.string(),
        tool: z.string(),
        action: z.string(),
        timestamp: z.coerce.number(),
        snapshotId: z.string().optional(),
        spreadsheetId: z.string().optional(),
      })
      .optional()
      .describe('What would be reverted (only present in dryRun responses)'),
    message: z.string().optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsHistoryOutputSchema = z.object({
  response: HistoryResponseSchema,
});

export const SHEETS_HISTORY_ANNOTATIONS: ToolAnnotations = {
  title: 'Operation History & Undo',
  readOnlyHint: false, // undo/redo are write operations
  destructiveHint: false,
  idempotentHint: false, // undo/redo change state
  openWorldHint: false,
};

export type SheetsHistoryInput = z.infer<typeof SheetsHistoryInputSchema>;
export type SheetsHistoryOutput = z.infer<typeof SheetsHistoryOutputSchema>;

export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// Type narrowing helpers for handler methods
// These provide type safety similar to discriminated union Extract<>
export type HistoryListInput = SheetsHistoryInput['request'] & { action: 'list' };
export type HistoryGetInput = SheetsHistoryInput['request'] & {
  action: 'get';
  operationId: string;
};
export type HistoryStatsInput = SheetsHistoryInput['request'] & { action: 'stats' };
export type HistoryUndoInput = SheetsHistoryInput['request'] & {
  action: 'undo';
  spreadsheetId: string;
};
export type HistoryRedoInput = SheetsHistoryInput['request'] & {
  action: 'redo';
  spreadsheetId: string;
};
export type HistoryRevertToInput = SheetsHistoryInput['request'] & {
  action: 'revert_to';
  operationId: string;
};
export type HistoryClearInput = SheetsHistoryInput['request'] & { action: 'clear' };
export type HistoryTimelineInput = SheetsHistoryInput['request'] & {
  action: 'timeline';
  spreadsheetId: string;
};
export type HistoryDiffRevisionsInput = SheetsHistoryInput['request'] & {
  action: 'diff_revisions';
  spreadsheetId: string;
  revisionId1: string;
  revisionId2: string;
};
export type HistoryRestoreCellsInput = SheetsHistoryInput['request'] & {
  action: 'restore_cells';
  spreadsheetId: string;
  revisionId: string;
  cells: string[];
};
