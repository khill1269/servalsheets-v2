/**
 * ServalSheets - Advanced Handler
 *
 * Handles sheets_advanced tool (named ranges, protections, metadata, banding)
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type {
  SheetsAdvancedInput,
  SheetsAdvancedOutput,
  AdvancedResponse,
  AdvancedRequest,
} from '../schemas/index.js';
import type { RangeInput } from '../schemas/shared.js';
import {
  handleAddNamedRangeAction,
  handleUpdateNamedRangeAction,
  handleDeleteNamedRangeAction,
  handleListNamedRangesAction,
  handleGetNamedRangeAction,
} from './advanced-actions/named-ranges.js';
import {
  handleCreateNamedFunctionAction,
  handleListNamedFunctionsAction,
  handleGetNamedFunctionAction,
  handleUpdateNamedFunctionAction,
  handleDeleteNamedFunctionAction,
} from './advanced-actions/named-functions.js';
import {
  handleAddProtectedRangeAction,
  handleUpdateProtectedRangeAction,
  handleDeleteProtectedRangeAction,
  handleListProtectedRangesAction,
} from './advanced-actions/protected-ranges.js';
import {
  handleSetMetadataAction,
  handleGetMetadataAction,
  handleDeleteMetadataAction,
} from './advanced-actions/metadata.js';
import {
  handleAddBandingAction,
  handleUpdateBandingAction,
  handleDeleteBandingAction,
  handleListBandingAction,
} from './advanced-actions/banding.js';
import {
  handleCreateTableAction,
  handleDeleteTableAction,
  handleListTablesAction,
  handleUpdateTableAction,
  handleRenameTableColumnAction,
  handleSetTableColumnPropertiesAction,
} from './advanced-actions/tables.js';
import {
  handleAddPersonChipAction,
  handleAddDriveChipAction,
  handleAddRichLinkChipAction,
  handleListChipsAction,
} from './advanced-actions/chips.js';

export class AdvancedHandler extends BaseHandler<SheetsAdvancedInput, SheetsAdvancedOutput> {
  private sheetsApi: sheets_v4.Sheets;

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets) {
    super('sheets_advanced', context);
    this.sheetsApi = sheetsApi;
  }

  /** Apply cursor-based pagination to an array of items (offset encoded as base64). */
  private paginateItems<T>(
    items: T[],
    cursor: string | undefined,
    pageSize: number
  ): { page: T[]; nextCursor: string | undefined; hasMore: boolean; totalCount: number } {
    const offset = cursor ? parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10) : 0;
    const start = isNaN(offset) ? 0 : offset;
    const page = items.slice(start, start + pageSize);
    const nextOffset = start + pageSize;
    const hasMore = nextOffset < items.length;
    return {
      page,
      nextCursor: hasMore ? Buffer.from(String(nextOffset)).toString('base64') : undefined,
      hasMore,
      totalCount: items.length,
    };
  }

  async handle(input: SheetsAdvancedInput): Promise<SheetsAdvancedOutput> {
    // Phase 1, Task 1.4: Infer missing parameters from context
    const req = this.inferRequestParameters(unwrapRequest<SheetsAdvancedInput['request']>(input));

    try {
      const namedRangesDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        rangeToGridRange: (spreadsheetId: string, range: RangeInput) =>
          this.rangeToGridRange(spreadsheetId, range, this.sheetsApi),
        gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => this.gridRangeToOutput(range),
        paginateItems: <T>(items: T[], cursor: string | undefined, pageSize: number) =>
          this.paginateItems(items, cursor, pageSize),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
        notFoundError: (resourceType: string, resourceId: string | number) =>
          this.notFoundError(resourceType, resourceId),
      } satisfies Parameters<typeof handleAddNamedRangeAction>[1];

      const namedFunctionsDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        paginateItems: <T>(items: T[], cursor: string | undefined, pageSize: number) =>
          this.paginateItems(items, cursor, pageSize),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleCreateNamedFunctionAction>[1];

      const protectedRangesDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        rangeToGridRange: (spreadsheetId: string, range: RangeInput) =>
          this.rangeToGridRange(spreadsheetId, range, this.sheetsApi),
        gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => this.gridRangeToOutput(range),
        paginateItems: <T>(items: T[], cursor: string | undefined, pageSize: number) =>
          this.paginateItems(items, cursor, pageSize),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleAddProtectedRangeAction>[1];

      const metadataDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleSetMetadataAction>[1];

      const bandingDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        rangeToGridRange: (spreadsheetId: string, range: RangeInput) =>
          this.rangeToGridRange(spreadsheetId, range, this.sheetsApi),
        gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => this.gridRangeToOutput(range),
        paginateItems: <T>(items: T[], cursor: string | undefined, pageSize: number) =>
          this.paginateItems(items, cursor, pageSize),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleAddBandingAction>[1];

      const tablesDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        resolveRange: (spreadsheetId: string, range: RangeInput) =>
          this.resolveRange(spreadsheetId, range),
        getSheetId: (spreadsheetId: string, sheetName?: string) =>
          this.getSheetId(spreadsheetId, sheetName, this.sheetsApi),
        gridRangeToOutput: (range: sheets_v4.Schema$GridRange) => this.gridRangeToOutput(range),
        paginateItems: <T>(items: T[], cursor: string | undefined, pageSize: number) =>
          this.paginateItems(items, cursor, pageSize),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleCreateTableAction>[1];

      const chipsDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        sendProgress: (current: number, total: number, message?: string) =>
          this.sendProgress(current, total, message),
        rangeToGridRange: (spreadsheetId: string, range: RangeInput) =>
          this.rangeToGridRange(spreadsheetId, range, this.sheetsApi),
        resolveRange: (spreadsheetId: string, range: RangeInput) =>
          this.resolveRange(spreadsheetId, range),
        validateGridDataSize: (spreadsheetId: string, sheetId?: number) =>
          this.validateGridDataSize(spreadsheetId, this.sheetsApi, sheetId),
        paginateItems: <T>(items: T[], cursor: string | undefined, pageSize: number) =>
          this.paginateItems(items, cursor, pageSize),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleAddPersonChipAction>[1];

      let response: AdvancedResponse;
      switch (req.action) {
        case 'add_named_range':
          response = await handleAddNamedRangeAction(req, namedRangesDeps);
          break;
        case 'update_named_range':
          response = await handleUpdateNamedRangeAction(req, namedRangesDeps);
          break;
        case 'delete_named_range':
          response = await handleDeleteNamedRangeAction(req, namedRangesDeps);
          break;
        case 'list_named_ranges':
          response = await handleListNamedRangesAction(req, namedRangesDeps);
          break;
        case 'get_named_range':
          response = await handleGetNamedRangeAction(req, namedRangesDeps);
          break;

        // Named functions (LAMBDA-based custom functions)
        case 'create_named_function':
          response = await handleCreateNamedFunctionAction(req, namedFunctionsDeps);
          break;
        case 'list_named_functions':
          response = await handleListNamedFunctionsAction(req, namedFunctionsDeps);
          break;
        case 'get_named_function':
          response = await handleGetNamedFunctionAction(req, namedFunctionsDeps);
          break;
        case 'update_named_function':
          response = await handleUpdateNamedFunctionAction(req, namedFunctionsDeps);
          break;
        case 'delete_named_function':
          response = await handleDeleteNamedFunctionAction(req, namedFunctionsDeps);
          break;

        case 'add_protected_range':
          response = await handleAddProtectedRangeAction(req, protectedRangesDeps);
          break;
        case 'update_protected_range':
          response = await handleUpdateProtectedRangeAction(req, protectedRangesDeps);
          break;
        case 'delete_protected_range':
          response = await handleDeleteProtectedRangeAction(req, protectedRangesDeps);
          break;
        case 'list_protected_ranges':
          response = await handleListProtectedRangesAction(req, protectedRangesDeps);
          break;

        case 'set_metadata':
          response = await handleSetMetadataAction(req, metadataDeps);
          break;
        case 'get_metadata':
          response = await handleGetMetadataAction(req, metadataDeps);
          break;
        case 'delete_metadata':
          response = await handleDeleteMetadataAction(req, metadataDeps);
          break;

        case 'add_banding':
          response = await handleAddBandingAction(req, bandingDeps);
          break;
        case 'update_banding':
          response = await handleUpdateBandingAction(req, bandingDeps);
          break;
        case 'delete_banding':
          response = await handleDeleteBandingAction(req, bandingDeps);
          break;
        case 'list_banding':
          response = await handleListBandingAction(req, bandingDeps);
          break;

        case 'create_table':
          response = await handleCreateTableAction(req, tablesDeps);
          break;
        case 'delete_table':
          response = await handleDeleteTableAction(req, tablesDeps);
          break;
        case 'list_tables':
          response = await handleListTablesAction(req, tablesDeps);
          break;
        case 'update_table':
          response = await handleUpdateTableAction(req, tablesDeps);
          break;
        case 'rename_table_column':
          response = await handleRenameTableColumnAction(req, tablesDeps);
          break;
        case 'set_table_column_properties':
          response = await handleSetTableColumnPropertiesAction(req, tablesDeps);
          break;

        // Smart Chips (June 2025 API)
        case 'add_person_chip':
          response = await handleAddPersonChipAction(req, chipsDeps);
          break;
        case 'add_drive_chip':
          response = await handleAddDriveChipAction(req, chipsDeps);
          break;
        case 'add_rich_link_chip':
          response = await handleAddRichLinkChipAction(req, chipsDeps);
          break;
        case 'list_chips':
          response = await handleListChipsAction(req, chipsDeps);
          break;

        default: {
          const _exhaustiveCheck: never = req;
          response = this.error({
            code: ErrorCodes.INVALID_PARAMS,
            message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
            retryable: false,
            suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
          });
        }
      }

      // Track context on success
      if (response.success) {
        this.trackContextFromRequest({
          spreadsheetId: req.spreadsheetId,
          sheetId:
            'sheetId' in req
              ? typeof req.sheetId === 'number'
                ? req.sheetId
                : undefined
              : undefined,
          range:
            'range' in req ? (typeof req.range === 'string' ? req.range : undefined) : undefined,
        });
      }

      // Apply verbosity filtering (LLM optimization) - uses base handler implementation
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = super.applyVerbosityFilter(response, verbosity) as AdvancedResponse;

      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  protected createIntents(input: SheetsAdvancedInput): Intent[] {
    const req = unwrapRequest<SheetsAdvancedInput['request']>(input);
    if ('spreadsheetId' in req) {
      const intentByAction: Record<
        SheetsAdvancedInput['request']['action'],
        Intent['type'] | null
      > = {
        add_named_range: 'ADD_NAMED_RANGE',
        update_named_range: 'UPDATE_NAMED_RANGE',
        delete_named_range: 'DELETE_NAMED_RANGE',
        list_named_ranges: null,
        get_named_range: null,
        create_named_function: null,
        list_named_functions: null,
        get_named_function: null,
        update_named_function: null,
        delete_named_function: null,
        add_protected_range: 'ADD_PROTECTED_RANGE',
        update_protected_range: 'UPDATE_PROTECTED_RANGE',
        delete_protected_range: 'DELETE_PROTECTED_RANGE',
        list_protected_ranges: null,
        set_metadata: 'CREATE_DEVELOPER_METADATA',
        get_metadata: null,
        delete_metadata: 'DELETE_DEVELOPER_METADATA',
        add_banding: 'ADD_BANDING',
        update_banding: 'UPDATE_BANDING',
        delete_banding: 'DELETE_BANDING',
        list_banding: null,
        create_table: null,
        delete_table: null,
        list_tables: null,
        update_table: null,
        rename_table_column: null,
        set_table_column_properties: null,
        // Smart Chips
        add_person_chip: 'SET_VALUES',
        add_drive_chip: 'SET_VALUES',
        add_rich_link_chip: 'SET_VALUES',
        list_chips: null,
      };

      const intentType = intentByAction[req.action];
      if (!intentType) {
        return [];
      }

      const destructiveActions: AdvancedRequest['action'][] = [
        'delete_named_range',
        'delete_named_function',
        'delete_protected_range',
        'delete_metadata',
        'delete_banding',
        'delete_table',
      ];
      return [
        {
          type: intentType,
          target: { spreadsheetId: req.spreadsheetId! },
          payload: {},
          metadata: {
            sourceTool: this.toolName,
            sourceAction: req.action,
            priority: 1,
            destructive: destructiveActions.includes(req.action),
          },
        },
      ];
    }
    return [];
  }
}
