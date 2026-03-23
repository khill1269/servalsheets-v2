/**
 * ServalSheets - Dimensions Handler
 *
 * Handles sheets_dimensions tool (row/column operations, filtering, and sorting)
 * MCP Protocol: 2025-11-25
 *
 * 29 Actions (LLM Optimized - reduced from 39):
 * Consolidated dimension operations (11):
 * - insert, delete, move, resize, auto_resize, hide, show, freeze, group, ungroup, append
 *   (all accept dimension: 'ROWS' | 'COLUMNS' parameter)
 * Filter/Sort (4): set_basic_filter, clear_basic_filter, get_basic_filter, sort_range
 * Range utility (4): trim_whitespace, randomize_range, text_to_columns, auto_fill
 * Filter views (6): create_filter_view, duplicate_filter_view, update_filter_view, delete_filter_view, list_filter_views, get_filter_view
 * Slicers (4): create_slicer, update_slicer, delete_slicer, list_slicers
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import { recordFilterViewId, recordSlicerId } from '../mcp/completions.js';
import type {
  SheetsDimensionsInput,
  SheetsDimensionsOutput,
  DimensionsResponse,
  DimensionsRequest,
  // Consolidated dimension types (11)
  DimensionsInsertInput,
  DimensionsDeleteInput,
  DimensionsMoveInput,
  DimensionsResizeInput,
  DimensionsAutoResizeInput,
  DimensionsHideInput,
  DimensionsShowInput,
  DimensionsFreezeInput,
  DimensionsGroupInput,
  DimensionsUngroupInput,
  DimensionsAppendInput,
  // Filter/Sort types (4)
  DimensionsSetBasicFilterInput,
  DimensionsClearBasicFilterInput,
  DimensionsGetBasicFilterInput,
  DimensionsSortRangeInput,
  // Range utility types (4)
  DimensionsTrimWhitespaceInput,
  DimensionsRandomizeRangeInput,
  DimensionsTextToColumnsInput,
  DimensionsAutoFillInput,
  // Filter view types (6)
  DimensionsCreateFilterViewInput,
  DimensionsDuplicateFilterViewInput,
  DimensionsUpdateFilterViewInput,
  DimensionsDeleteFilterViewInput,
  DimensionsListFilterViewsInput,
  DimensionsGetFilterViewInput,
  // Slicer types (4)
  DimensionsCreateSlicerInput,
  DimensionsUpdateSlicerInput,
  DimensionsDeleteSlicerInput,
  DimensionsListSlicersInput,
  // Range utility (delete duplicates)
  DimensionsDeleteDuplicatesInput,
} from '../schemas/index.js';
import { handleDeleteDuplicates } from './dimensions-actions/filter-sort-operations.js';
import { parseCellReference, toGridRange } from '../utils/google-sheets-helpers.js';
import {
  confirmDestructiveAction,
  safeElicit,
  FILTER_SETTINGS_SCHEMA,
} from '../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../utils/safety-helpers.js';
import { getBackgroundAnalyzer } from '../services/background-analyzer.js';
import { getBackgroundAnalysisConfig } from '../config/env.js';
import {
  collectFilterViewSummaries,
  findFilterViewSummaryById,
  mapDimensionsCriteria,
  paginateFilterViews,
  toApiSlicerFilterCriteria,
} from './dimensions-filter-helpers.js';

export class DimensionsHandler extends BaseHandler<SheetsDimensionsInput, SheetsDimensionsOutput> {
  private sheetsApi: sheets_v4.Sheets;
  private static readonly ACTIONS_REQUIRING_SHEET_ID = new Set<string>([
    'insert',
    'delete',
    'move',
    'resize',
    'auto_resize',
    'hide',
    'show',
    'freeze',
    'group',
    'ungroup',
    'append',
    'clear_basic_filter',
    'get_basic_filter',
  ]);
  private static readonly ACTIONS_REQUIRING_EXPLICIT_TARGET = new Set<string>([
    'set_basic_filter',
    'clear_basic_filter',
    'get_basic_filter',
    'sort_range',
  ]);

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets) {
    super('sheets_dimensions', context);
    this.sheetsApi = sheetsApi;
  }

  /**
   * Override to add count-to-endIndex conversion (BUG FIX 0.6)
   */
  protected inferRequestParameters<T extends Record<string, unknown>>(request: T): T {
    // First, do standard parameter inference from context
    const inferredReq = super.inferRequestParameters(request);
    const action = inferredReq['action'] as string;

    // Filter/sort operations must not borrow stale range or sheet targets from context.
    if (DimensionsHandler.ACTIONS_REQUIRING_EXPLICIT_TARGET.has(action)) {
      const requestHasExplicitRange = request['range'] !== undefined;
      const requestHasExplicitSheetTarget =
        request['sheetId'] !== undefined || request['sheetName'] !== undefined;

      if (!requestHasExplicitRange && 'range' in inferredReq) {
        const { range: _range, ...rest } = inferredReq;
        if (!requestHasExplicitSheetTarget && 'sheetId' in rest && action !== 'sort_range') {
          const { sheetId: _sheetId, ...withoutSheetId } = rest;
          return withoutSheetId as T;
        }
        return rest as T;
      }

      if (!requestHasExplicitSheetTarget && 'sheetId' in inferredReq && action !== 'sort_range') {
        const { sheetId: _sheetId, ...rest } = inferredReq;
        return rest as T;
      }
    }

    // BUG FIX 0.6: Convert count parameter to endIndex for range-based actions
    const rangeActions = new Set(['delete', 'move', 'resize', 'hide', 'show', 'group', 'ungroup']);
    if (rangeActions.has(action)) {
      const count = inferredReq['count'];
      const startIndex = inferredReq['startIndex'];
      const endIndex = inferredReq['endIndex'];

      // If count is provided but endIndex is not, convert count to endIndex
      if (count !== undefined && endIndex === undefined && startIndex !== undefined) {
        const countNum = typeof count === 'number' ? count : Number(count);
        const startNum = typeof startIndex === 'number' ? startIndex : Number(startIndex);

        if (!isNaN(countNum) && !isNaN(startNum)) {
          // Create new object with endIndex and without count
          const { count: _c, ...rest } = inferredReq;
          return {
            ...rest,
            endIndex: startNum + countNum,
          } as unknown as T;
        }
      }

      // Remove count field if it exists (even if conversion didn't happen)
      if ('count' in inferredReq) {
        const { count: _c, ...rest } = inferredReq;
        return rest as unknown as T;
      }
    }

    return inferredReq;
  }

  async handle(input: SheetsDimensionsInput): Promise<SheetsDimensionsOutput> {
    // Extract the request from the wrapper
    const rawReq = unwrapRequest<SheetsDimensionsInput['request']>(input);
    // Phase 1, Task 1.4: Infer missing parameters from context (includes count-to-endIndex conversion)
    const req = this.inferRequestParameters(rawReq) as DimensionsRequest;

    try {
      const sheetResolutionError = await this.resolveSheetIdIfNeeded(req);
      if (sheetResolutionError) {
        return { response: sheetResolutionError };
      }

      let response: DimensionsResponse;
      switch (req.action) {
        // Consolidated dimension actions (11)
        case 'insert':
          response = await this.handleInsert(req as DimensionsInsertInput);
          break;
        case 'delete':
          response = await this.handleDelete(req as DimensionsDeleteInput);
          break;
        case 'move':
          response = await this.handleMove(req as DimensionsMoveInput);
          break;
        case 'resize':
          response = await this.handleResize(req as DimensionsResizeInput);
          break;
        case 'auto_resize':
          response = await this.handleAutoResize(req as DimensionsAutoResizeInput);
          break;
        case 'hide':
          response = await this.handleHide(req as DimensionsHideInput);
          break;
        case 'show':
          response = await this.handleShow(req as DimensionsShowInput);
          break;
        case 'freeze':
          response = await this.handleFreeze(req as DimensionsFreezeInput);
          break;
        case 'group':
          response = await this.handleGroup(req as DimensionsGroupInput);
          break;
        case 'ungroup':
          response = await this.handleUngroup(req as DimensionsUngroupInput);
          break;
        case 'append':
          response = await this.handleAppend(req as DimensionsAppendInput);
          break;
        // Filter/Sort actions (5)
        case 'set_basic_filter':
          response = await this.handleSetBasicFilter(req as DimensionsSetBasicFilterInput);
          break;
        case 'clear_basic_filter':
          response = await this.handleClearBasicFilter(req as DimensionsClearBasicFilterInput);
          break;
        case 'get_basic_filter':
          response = await this.handleGetBasicFilter(req as DimensionsGetBasicFilterInput);
          break;
        case 'sort_range':
          response = await this.handleSortRange(req as DimensionsSortRangeInput);
          break;
        // Range utility operations (5)
        case 'delete_duplicates':
          response = await handleDeleteDuplicates(
            this.buildHandlerAccess(),
            req as DimensionsDeleteDuplicatesInput
          );
          break;
        case 'trim_whitespace':
          response = await this.handleTrimWhitespace(req as DimensionsTrimWhitespaceInput);
          break;
        case 'randomize_range':
          response = await this.handleRandomizeRange(req as DimensionsRandomizeRangeInput);
          break;
        case 'text_to_columns':
          response = await this.handleTextToColumns(req as DimensionsTextToColumnsInput);
          break;
        case 'auto_fill':
          response = await this.handleAutoFill(req as DimensionsAutoFillInput);
          break;
        case 'create_filter_view':
          response = await this.handleCreateFilterView(req as DimensionsCreateFilterViewInput);
          break;
        case 'duplicate_filter_view':
          response = await this.handleDuplicateFilterView(
            req as DimensionsDuplicateFilterViewInput
          );
          break;
        case 'update_filter_view':
          response = await this.handleUpdateFilterView(req as DimensionsUpdateFilterViewInput);
          break;
        case 'delete_filter_view':
          response = await this.handleDeleteFilterView(req as DimensionsDeleteFilterViewInput);
          break;
        case 'list_filter_views':
          response = await this.handleListFilterViews(req as DimensionsListFilterViewsInput);
          break;
        case 'get_filter_view':
          response = await this.handleGetFilterView(req as DimensionsGetFilterViewInput);
          break;
        case 'create_slicer':
          response = await this.handleCreateSlicer(req as DimensionsCreateSlicerInput);
          break;
        case 'update_slicer':
          response = await this.handleUpdateSlicer(req as DimensionsUpdateSlicerInput);
          break;
        case 'delete_slicer':
          response = await this.handleDeleteSlicer(req as DimensionsDeleteSlicerInput);
          break;
        case 'list_slicers':
          response = await this.handleListSlicers(req as DimensionsListSlicersInput);
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
        });
      }

      // Apply verbosity filtering (LLM optimization) - uses base handler implementation
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = super.applyVerbosityFilter(
        response,
        verbosity
      ) as DimensionsResponse;

      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  private async resolveSheetIdIfNeeded(req: DimensionsRequest): Promise<DimensionsResponse | null> {
    const request = req as Record<string, unknown>;
    const hasSheetId = typeof request['sheetId'] === 'number';
    const actionNeedsSheetId =
      DimensionsHandler.ACTIONS_REQUIRING_SHEET_ID.has(req.action) ||
      (req.action === 'set_basic_filter' && request['range'] === undefined) ||
      (req.action === 'create_filter_view' && request['range'] === undefined);

    if (!actionNeedsSheetId || hasSheetId) {
      return null;
    }

    const sheetName = request['sheetName'];
    if (typeof sheetName !== 'string' || sheetName.trim().length === 0) {
      if (req.action === 'set_basic_filter' && request['range'] === undefined) {
        return this.error({
          code: ErrorCodes.INVALID_PARAMS,
          message:
            'set_basic_filter requires an explicit range or sheetId/sheetName. Context-inferred targets are not used for filter operations.',
          retryable: false,
          suggestedFix:
            'Provide range like "Sheet1!A1:D100" or a valid sheetId/sheetName from sheets_core.list_sheets.',
        });
      }

      return this.error({
        code: ErrorCodes.INVALID_PARAMS,
        message: 'Either sheetId (number) or sheetName (string) is required',
        retryable: false,
        suggestedFix: 'Provide sheetId from sheets_core.list_sheets or a valid sheetName',
      });
    }

    const resolvedSheetId = await this.getSheetId(req.spreadsheetId, sheetName, this.sheetsApi);
    request['sheetId'] = resolvedSheetId;
    return null;
  }

  protected createIntents(input: SheetsDimensionsInput): Intent[] {
    // Extract the request from the wrapper
    const req = unwrapRequest<SheetsDimensionsInput['request']>(input);

    // Filter operations execute directly; no batch compiler intents needed
    if (req.action.startsWith('filter_')) {
      return [];
    }

    const destructiveActions = ['delete', 'move'];
    return [
      {
        type:
          req.action === 'delete'
            ? 'DELETE_DIMENSION'
            : req.action === 'insert' || req.action === 'append'
              ? 'INSERT_DIMENSION'
              : 'UPDATE_DIMENSION_PROPERTIES',
        target: {
          spreadsheetId: req.spreadsheetId!,
          sheetId: (req as { sheetId?: number }).sheetId!,
        },
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

  // ============================================================
  // Consolidated Dimension Operations (11 actions)
  // LLM Optimized: Single method per operation type with dimension parameter
  // ============================================================

  private async handleInsert(input: DimensionsInsertInput): Promise<DimensionsResponse> {
    const count = input.count ?? 1;
    const isRows = input.dimension === 'ROWS';

    // Create snapshot before mutating (allows rollback)
    await this.createSafetySnapshot(
      {
        operationType: 'insert',
        isDestructive: false,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    // Request confirmation for larger inserts
    if (this.context.elicitationServer && count > 10) {
      try {
        const confirmation = await confirmDestructiveAction(
          this.context.elicitationServer,
          `Insert ${isRows ? 'Rows' : 'Columns'}`,
          `You are about to insert ${count} ${isRows ? 'rows' : 'columns'} at index ${input.startIndex + 1}. This will shift existing data.`
        );

        if (!confirmation.confirmed) {
          return this.error({
            code: ErrorCodes.PRECONDITION_FAILED,
            message: `${isRows ? 'Row' : 'Column'} insertion cancelled by user`,
            retryable: false,
            suggestedFix: 'Review the operation requirements and try again',
          });
        }
      } catch (err) {
        this.context.logger?.warn(`Elicitation failed for insert, proceeding with operation`, {
          error: err,
        });
      }
    }

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.startIndex + count,
              },
              inheritFromBefore: input.inheritFromBefore ?? false,
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'insert',
          spreadsheetId: input.spreadsheetId,
          description: `Inserted ${count} ${input.dimension === 'ROWS' ? 'rows' : 'columns'} at index ${input.startIndex}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success(
      'insert',
      input.dimension === 'ROWS' ? { rowsAffected: count } : { columnsAffected: count }
    );
  }

  private async handleDelete(input: DimensionsDeleteInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';
    const label = isRows ? 'rows' : 'columns';
    const threshold = isRows ? 5 : 3;

    // Generate safety warnings
    const safetyContext = {
      [isRows ? 'affectedRows' : 'affectedColumns']: count,
      isDestructive: true,
      operationType: `delete`,
      spreadsheetId: input.spreadsheetId,
    };
    const warnings = this.getSafetyWarnings(safetyContext, input.safety);

    // Request confirmation for destructive operation if elicitation is supported
    if (this.context.elicitationServer && count > threshold) {
      try {
        const confirmation = await confirmDestructiveAction(
          this.context.elicitationServer,
          `Delete ${isRows ? 'Rows' : 'Columns'}`,
          `You are about to delete ${count} ${label} (${label} ${input.startIndex + 1}-${input.endIndex}).\n\nAll data, formatting, and formulas will be permanently removed.`
        );

        if (!confirmation.confirmed) {
          return this.error({
            code: ErrorCodes.PRECONDITION_FAILED,
            message: `${isRows ? 'Row' : 'Column'} deletion cancelled by user`,
            retryable: false,
            suggestedFix: 'Review the operation requirements and try again',
          });
        }
      } catch (err) {
        this.context.logger?.warn(`Elicitation failed for delete, proceeding with operation`, {
          error: err,
        });
      }
    }

    if (input.safety?.dryRun) {
      const meta = this.generateMeta('delete', input, undefined, { cellsAffected: count });
      if (warnings.length > 0) {
        meta.warnings = this.formatWarnings(warnings);
      }
      return this.success(
        'delete',
        isRows ? { rowsAffected: count } : { columnsAffected: count },
        undefined,
        true,
        meta
      );
    }

    // Create snapshot if requested
    const snapshot = await this.createSafetySnapshot(safetyContext, input.safety);

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
            },
          },
        ],
      },
    });

    // Trigger background quality analysis after destructive operation
    const analysisConfig = getBackgroundAnalysisConfig();
    if (analysisConfig.enabled && count >= analysisConfig.minCells) {
      const analyzer = getBackgroundAnalyzer();
      // Estimate affected cells (conservative: rows * 26 columns OR columns * 1000 rows)
      const estimatedCells = isRows ? count * 26 : count * 1000;
      analyzer.analyzeInBackground(
        input.spreadsheetId,
        'A1', // Full sheet analysis since dimensions changed
        estimatedCells,
        this.sheetsApi,
        {
          qualityThreshold: 70,
          minCellsChanged: analysisConfig.minCells,
          debounceMs: analysisConfig.debounceMs,
        }
      );
    }

    // Build response with snapshot info if created
    const meta = this.generateMeta(
      'delete',
      input,
      isRows ? { rowsAffected: count } : { columnsAffected: count },
      { cellsAffected: count }
    );
    if (snapshot) {
      const snapshotInfo = this.snapshotInfo(snapshot);
      if (snapshotInfo) {
        const metaWithSnapshot = meta as Record<string, unknown>;
        metaWithSnapshot['snapshot'] = snapshotInfo;
      }
    }
    if (warnings.length > 0) {
      meta.warnings = this.formatWarnings(warnings);
    }

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'delete',
          spreadsheetId: input.spreadsheetId,
          description: `Deleted ${count} ${input.dimension === 'ROWS' ? 'rows' : 'columns'} from index ${input.startIndex}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success(
      'delete',
      isRows ? { rowsAffected: count } : { columnsAffected: count },
      undefined,
      false,
      meta
    );
  }

  private async handleMove(input: DimensionsMoveInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';

    if (input.safety?.dryRun) {
      return this.success(
        'move',
        isRows ? { rowsAffected: count } : { columnsAffected: count },
        undefined,
        true
      );
    }

    // Create snapshot before mutating (allows rollback)
    await this.createSafetySnapshot(
      {
        operationType: 'move',
        isDestructive: false,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    // Request confirmation for move operations
    if (this.context.elicitationServer) {
      try {
        const confirmation = await confirmDestructiveAction(
          this.context.elicitationServer,
          `Move ${isRows ? 'Rows' : 'Columns'}`,
          `You are about to move ${count} ${isRows ? 'rows' : 'columns'} (indices ${input.startIndex + 1}-${input.endIndex}) to index ${input.destinationIndex + 1}. This will reorder existing data.`
        );

        if (!confirmation.confirmed) {
          return this.error({
            code: ErrorCodes.PRECONDITION_FAILED,
            message: `${isRows ? 'Row' : 'Column'} move cancelled by user`,
            retryable: false,
            suggestedFix: 'Review the operation requirements and try again',
          });
        }
      } catch (err) {
        this.context.logger?.warn(`Elicitation failed for move, proceeding with operation`, {
          error: err,
        });
      }
    }

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            moveDimension: {
              source: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
              destinationIndex: input.destinationIndex,
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'move',
          spreadsheetId: input.spreadsheetId,
          description: `Moved ${count} ${input.dimension === 'ROWS' ? 'rows' : 'columns'} to index ${input.destinationIndex}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('move', isRows ? { rowsAffected: count } : { columnsAffected: count });
  }

  private async handleResize(input: DimensionsResizeInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
              properties: {
                pixelSize: input.pixelSize,
              },
              fields: 'pixelSize',
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'resize',
          spreadsheetId: input.spreadsheetId,
          description: `Resized ${input.dimension === 'ROWS' ? 'rows' : 'columns'} to ${input.pixelSize}px`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('resize', isRows ? { rowsAffected: count } : { columnsAffected: count });
  }

  private async handleAutoResize(input: DimensionsAutoResizeInput): Promise<DimensionsResponse> {
    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
            },
          },
        ],
      },
    });

    const count = input.endIndex - input.startIndex;
    return this.success(
      'auto_resize',
      input.dimension === 'ROWS' ? { rowsAffected: count } : { columnsAffected: count }
    );
  }

  private async handleHide(input: DimensionsHideInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';

    // Create snapshot before mutating (hide is reversible but snapshot enables rollback)
    await this.createSafetySnapshot(
      {
        operationType: 'hide',
        isDestructive: false,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
              properties: {
                hiddenByUser: true,
              },
              fields: 'hiddenByUser',
            },
          },
        ],
      },
    });

    const result = this.success(
      'hide',
      isRows ? { rowsAffected: count } : { columnsAffected: count }
    );

    // Wire session context: track hidden rows/cols
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'hide',
          spreadsheetId: input.spreadsheetId,
          description: `Hidden ${count} ${isRows ? 'row(s)' : 'column(s)'} (${input.dimension} ${input.startIndex}–${input.endIndex}) on sheet ${input.sheetId}`,
          undoable: true,
          cellsAffected: count,
        });
      }
    } catch {
      /* non-blocking */
    }

    return result;
  }

  private async handleShow(input: DimensionsShowInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';

    // Create snapshot before mutating (show is reversible but snapshot enables rollback)
    await this.createSafetySnapshot(
      {
        operationType: 'show',
        isDestructive: false,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
              properties: {
                hiddenByUser: false,
              },
              fields: 'hiddenByUser',
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'show',
          spreadsheetId: input.spreadsheetId,
          description: `Unhid ${count} ${input.dimension === 'ROWS' ? 'rows' : 'columns'}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('show', isRows ? { rowsAffected: count } : { columnsAffected: count });
  }

  private async handleFreeze(input: DimensionsFreezeInput): Promise<DimensionsResponse> {
    const isRows = input.dimension === 'ROWS';
    const propertyPath = isRows ? 'frozenRowCount' : 'frozenColumnCount';

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: input.sheetId,
                gridProperties: {
                  [propertyPath]: input.count,
                },
              },
              fields: `gridProperties.${propertyPath}`,
            },
          },
        ],
      },
    });

    const result = this.success(
      'freeze',
      isRows ? { rowsAffected: input.count } : { columnsAffected: input.count }
    );

    // Wire session context: update sheet schema state with freeze info
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'freeze',
          spreadsheetId: input.spreadsheetId,
          description: `Froze ${input.count} ${isRows ? 'row(s)' : 'column(s)'} on sheet ${input.sheetId}`,
          undoable: true,
          cellsAffected: input.count,
        });
      }
    } catch {
      /* non-blocking */
    }

    return result;
  }

  private async handleGroup(input: DimensionsGroupInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            addDimensionGroup: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'group',
          spreadsheetId: input.spreadsheetId,
          description: `Grouped ${count} ${input.dimension === 'ROWS' ? 'rows' : 'columns'}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('group', isRows ? { rowsAffected: count } : { columnsAffected: count });
  }

  private async handleUngroup(input: DimensionsUngroupInput): Promise<DimensionsResponse> {
    const count = input.endIndex - input.startIndex;
    const isRows = input.dimension === 'ROWS';

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimensionGroup: {
              range: {
                sheetId: input.sheetId,
                dimension: input.dimension,
                startIndex: input.startIndex,
                endIndex: input.endIndex,
              },
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'ungroup',
          spreadsheetId: input.spreadsheetId,
          description: `Ungrouped ${count} ${input.dimension === 'ROWS' ? 'rows' : 'columns'}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('ungroup', isRows ? { rowsAffected: count } : { columnsAffected: count });
  }

  private async handleAppend(input: DimensionsAppendInput): Promise<DimensionsResponse> {
    const isRows = input.dimension === 'ROWS';

    // Create snapshot before mutating (allows rollback)
    await this.createSafetySnapshot(
      {
        operationType: 'append',
        isDestructive: false,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    // Request confirmation for larger appends
    if (this.context.elicitationServer && (input.count ?? 1) > 10) {
      try {
        const confirmation = await confirmDestructiveAction(
          this.context.elicitationServer,
          `Append ${isRows ? 'Rows' : 'Columns'}`,
          `You are about to append ${input.count} ${isRows ? 'rows' : 'columns'} to the sheet. This will increase the sheet dimensions.`
        );

        if (!confirmation.confirmed) {
          return this.error({
            code: ErrorCodes.PRECONDITION_FAILED,
            message: `${isRows ? 'Row' : 'Column'} append cancelled by user`,
            retryable: false,
            suggestedFix: 'Review the operation requirements and try again',
          });
        }
      } catch (err) {
        this.context.logger?.warn(`Elicitation failed for append, proceeding with operation`, {
          error: err,
        });
      }
    }

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            appendDimension: {
              sheetId: input.sheetId,
              dimension: input.dimension,
              length: input.count,
            },
          },
        ],
      },
    });

    return this.success(
      'append',
      isRows ? { rowsAffected: input.count } : { columnsAffected: input.count }
    );
  }

  // ============================================================
  // Filter Operations (merged from filter-sort.ts)
  // ============================================================

  private async handleSetBasicFilter(
    input: DimensionsSetBasicFilterInput
  ): Promise<DimensionsResponse> {
    const rawInput = input as Record<string, unknown>;
    const hasExplicitSheetTarget =
      typeof rawInput['sheetId'] === 'number' ||
      (typeof rawInput['sheetName'] === 'string' && rawInput['sheetName'].trim().length > 0);

    if (input.range === undefined && !hasExplicitSheetTarget) {
      return this.error({
        code: ErrorCodes.INVALID_PARAMS,
        message:
          'set_basic_filter requires an explicit range or sheetId/sheetName. Context-inferred targets are not used for filter operations.',
        category: 'client',
        severity: 'medium',
        retryable: false,
        suggestedFix:
          'Provide range like "Sheet1!A1:D100" or a valid sheetId/sheetName from sheets_core.list_sheets.',
      });
    }

    // v2.0: Enhanced to support incremental updates via optional columnIndex parameter
    // If columnIndex provided: update only that column's criteria (incremental)
    // If columnIndex omitted: replace entire filter (original behavior)

    if (input.columnIndex !== undefined) {
      // Incremental update: merge criteria for specific column
      const currentFilterResponse = await this.handleGetBasicFilter({
        action: 'get_basic_filter',
        spreadsheetId: input.spreadsheetId,
        sheetId: input.sheetId,
        verbosity: 'minimal',
      });

      if (!currentFilterResponse.success || !currentFilterResponse.filter) {
        return this.error({
          code: ErrorCodes.FAILED_PRECONDITION,
          message: 'Cannot update filter criteria: No basic filter exists on this sheet',
          category: 'client',
          severity: 'medium',
          retryable: false,
          suggestedFix: 'Ensure all preconditions are met before retrying',
          resolution:
            'Create a filter first using set_basic_filter without columnIndex, then add criteria',
        });
      }

      // Merge new criteria for the specific column
      // Extract the criteria for the target column: try exact column key first, then take the first entry
      const columnCriteria =
        input.criteria?.[input.columnIndex] ??
        (input.criteria ? Object.values(input.criteria)[0] : undefined) ??
        {};
      const updatedCriteria = {
        ...currentFilterResponse.filter.criteria,
        [input.columnIndex]: columnCriteria,
      };

      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [
            {
              setBasicFilter: {
                filter: {
                  range: currentFilterResponse.filter.range,
                  criteria: mapDimensionsCriteria(updatedCriteria),
                },
              },
            },
          ],
        },
      });

      // Record operation in session context for LLM follow-up references
      try {
        if (this.context.sessionContext) {
          this.context.sessionContext.recordOperation({
            tool: 'sheets_dimensions',
            action: 'set_basic_filter',
            spreadsheetId: input.spreadsheetId,
            description: `Set basic filter criteria`,
            undoable: false,
          });
        }
      } catch {
        // Non-blocking: session context recording is best-effort
      }

      return this.success('set_basic_filter', {
        message: `Updated filter criteria for column ${input.columnIndex}`,
        columnIndex: input.columnIndex,
      });
    }

    // Full filter replacement (original behavior)
    const gridRange = input.range
      ? await this.rangeToGridRange(input.spreadsheetId, input.range, this.sheetsApi)
      : { sheetId: input.sheetId };

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            setBasicFilter: {
              filter: {
                range: toGridRange(gridRange),
                criteria: input.criteria ? mapDimensionsCriteria(input.criteria) : undefined,
              },
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'set_basic_filter',
          spreadsheetId: input.spreadsheetId,
          description: `Set basic filter`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('set_basic_filter', {});
  }

  private async handleClearBasicFilter(
    input: DimensionsClearBasicFilterInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('clear_basic_filter', {}, undefined, true);
    }

    if (this.context.elicitationServer) {
      const confirmation = await confirmDestructiveAction(
        this.context.elicitationServer,
        'clear_basic_filter',
        `Remove the basic filter from sheet ${input.sheetId} in spreadsheet ${input.spreadsheetId}. Filtered rows will become visible again.`
      );
      if (!confirmation.confirmed) {
        return this.error({
          code: ErrorCodes.PRECONDITION_FAILED,
          message: confirmation.reason || 'User cancelled the operation',
          retryable: false,
          suggestedFix: 'Review the operation requirements and try again',
        });
      }
    }

    // Safety: snapshot before clearing filter
    await createSnapshotIfNeeded(
      this.context.snapshotService,
      {
        operationType: 'clear_basic_filter',
        isDestructive: true,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            clearBasicFilter: { sheetId: input.sheetId },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'clear_basic_filter',
          spreadsheetId: input.spreadsheetId,
          description: `Cleared basic filter`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('clear_basic_filter', {});
  }

  private async handleGetBasicFilter(
    input: DimensionsGetBasicFilterInput
  ): Promise<DimensionsResponse> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.basicFilter',
    });

    for (const sheet of response.data.sheets ?? []) {
      if (sheet.properties?.sheetId === input.sheetId && sheet.basicFilter) {
        return this.success('get_basic_filter', {
          filter: {
            range: this.gridRangeToOutput(sheet.basicFilter.range ?? { sheetId: input.sheetId }),
            criteria: sheet.basicFilter.criteria ?? {},
          },
        });
      }
    }

    return this.success('get_basic_filter', {});
  }

  // ============================================================
  // Sort Operations (merged from filter-sort.ts)
  // ============================================================

  /** Build a DimensionsHandlerAccess adapter for sub-module functions */
  private buildHandlerAccess(): import('./dimensions-actions/internal.js').DimensionsHandlerAccess {
    return {
      success: this.success.bind(
        this
      ) as import('./dimensions-actions/internal.js').DimensionsHandlerAccess['success'],
      error: this.error.bind(this),
      notFoundError: (t: string, id: string | number) => this.notFoundError(t, String(id)),
      generateMeta: this.generateMeta.bind(this),
      getSafetyWarnings: this.getSafetyWarnings.bind(this),
      formatWarnings: this.formatWarnings.bind(this),
      createSafetySnapshot: this.createSafetySnapshot.bind(this),
      snapshotInfo: this.snapshotInfo.bind(
        this
      ) as import('./dimensions-actions/internal.js').DimensionsHandlerAccess['snapshotInfo'],
      rangeToGridRange: this.rangeToGridRange.bind(this),
      gridRangeToOutput: this.gridRangeToOutput.bind(this),
      getSheetId: this.getSheetId.bind(this),
      sendProgress: this.sendProgress.bind(this),
      context: this.context,
      sheetsApi: this.sheetsApi,
    };
  }

  private async handleSortRange(input: DimensionsSortRangeInput): Promise<DimensionsResponse> {
    if (input.range === undefined) {
      return this.error({
        code: ErrorCodes.INVALID_PARAMS,
        message:
          'sort_range requires an explicit range. Context-inferred ranges are not used for sort operations.',
        category: 'client',
        severity: 'medium',
        retryable: false,
        suggestedFix: 'Provide range like "Sheet1!A1:D100" explicitly.',
      });
    }

    let resolvedInput = input;

    // Wizard: If range is provided but sortSpecs is missing, elicit sort direction
    if (resolvedInput.range && (!resolvedInput.sortSpecs || resolvedInput.sortSpecs.length === 0)) {
      if (this.context?.server?.elicitInput) {
        try {
          const wizard = await this.context.server.elicitInput({
            message: 'Range ready to sort. Which direction?',
            requestedSchema: {
              type: 'object',
              properties: {
                direction: {
                  type: 'string',
                  title: 'Sort direction',
                  description: 'Sort ascending (A→Z) or descending (Z→A)?',
                  enum: ['ASCENDING', 'DESCENDING'],
                },
              },
            },
          });
          const wizardContent = wizard?.content as Record<string, unknown> | undefined;
          const direction =
            wizardContent?.['direction'] === 'ASCENDING' ||
            wizardContent?.['direction'] === 'DESCENDING'
              ? wizardContent['direction']
              : undefined;
          if (wizard?.action === 'accept' && direction) {
            // Create default sort spec for first column with chosen direction
            resolvedInput = {
              ...resolvedInput,
              sortSpecs: [
                {
                  columnIndex: 0,
                  sortOrder: direction,
                },
              ],
            };
          }
        } catch {
          // Elicitation not available — use default ascending if still missing
          if (!resolvedInput.sortSpecs || resolvedInput.sortSpecs.length === 0) {
            resolvedInput = {
              ...resolvedInput,
              sortSpecs: [{ columnIndex: 0, sortOrder: 'ASCENDING' as const }],
            };
          }
        }
      }
    }

    // Fallback: ensure sortSpecs is always defined
    if (!resolvedInput.sortSpecs || resolvedInput.sortSpecs.length === 0) {
      resolvedInput = {
        ...resolvedInput,
        sortSpecs: [{ columnIndex: 0, sortOrder: 'ASCENDING' as const }],
      };
    }

    const gridRange = await this.rangeToGridRange(
      resolvedInput.spreadsheetId,
      resolvedInput.range,
      this.sheetsApi
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: resolvedInput.spreadsheetId,
      requestBody: {
        requests: [
          {
            sortRange: {
              range: toGridRange(gridRange),
              sortSpecs: resolvedInput.sortSpecs.map((spec) => ({
                dimensionIndex: spec.columnIndex,
                sortOrder: spec.sortOrder ?? 'ASCENDING',
                foregroundColor: spec.foregroundColor,
                backgroundColor: spec.backgroundColor,
              })),
            },
          },
        ],
      },
    });

    const rangeStr =
      typeof resolvedInput.range === 'string'
        ? resolvedInput.range
        : ((resolvedInput.range as { a1?: string }).a1 ?? '');

    // Wire session context: note that data was sorted
    try {
      if (this.context.sessionContext) {
        const sortDesc = resolvedInput.sortSpecs
          .map((s) => `col ${s.columnIndex} ${s.sortOrder ?? 'ASCENDING'}`)
          .join(', ');
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'sort_range',
          spreadsheetId: resolvedInput.spreadsheetId,
          range: rangeStr,
          description: `Sorted range ${rangeStr} by: ${sortDesc}`,
          undoable: true,
        });
      }
    } catch {
      /* non-blocking */
    }

    return this.success('sort_range', {});
  }

  // ============================================================
  // Range Utility Operations (4 new - Google API coverage completion)
  // ============================================================

  private async handleTrimWhitespace(
    input: DimensionsTrimWhitespaceInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('trim_whitespace', { cellsAffected: 0 }, undefined, true);
    }

    const gridRange = await this.rangeToGridRange(input.spreadsheetId, input.range, this.sheetsApi);

    const response = await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            trimWhitespace: {
              range: toGridRange(gridRange),
            },
          },
        ],
      },
    });

    const cellsAffected = response.data?.replies?.[0]?.trimWhitespace?.cellsChangedCount ?? 0;

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'trim_whitespace',
          spreadsheetId: input.spreadsheetId,
          description: `Trimmed whitespace in range ${input.range}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('trim_whitespace', { cellsAffected });
  }

  private async handleRandomizeRange(
    input: DimensionsRandomizeRangeInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('randomize_range', {}, undefined, true);
    }

    const gridRange = await this.rangeToGridRange(input.spreadsheetId, input.range, this.sheetsApi);

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            randomizeRange: {
              range: toGridRange(gridRange),
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'randomize_range',
          spreadsheetId: input.spreadsheetId,
          description: `Randomized range ${input.range}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('randomize_range', {});
  }

  private async handleTextToColumns(
    input: DimensionsTextToColumnsInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('text_to_columns', {}, undefined, true);
    }

    const gridRange = await this.rangeToGridRange(
      input.spreadsheetId,
      input.source,
      this.sheetsApi
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            textToColumns: {
              source: toGridRange(gridRange),
              delimiterType: input.delimiterType ?? 'AUTODETECT',
              delimiter: input.delimiterType === 'CUSTOM' ? input.delimiter : undefined,
            },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'text_to_columns',
          spreadsheetId: input.spreadsheetId,
          description: `Split text to columns in range ${input.source}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('text_to_columns', {});
  }

  private async handleAutoFill(input: DimensionsAutoFillInput): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('auto_fill', {}, undefined, true);
    }

    // Build the request based on which parameters are provided
    const autoFillRequest: sheets_v4.Schema$AutoFillRequest = {
      useAlternateSeries: input.useAlternateSeries,
    };

    if (input.sourceRange && input.fillLength !== undefined) {
      // SourceAndDestination mode: explicit source and fill direction
      const sourceGridRange = await this.rangeToGridRange(
        input.spreadsheetId,
        input.sourceRange,
        this.sheetsApi
      );
      autoFillRequest.sourceAndDestination = {
        source: toGridRange(sourceGridRange),
        dimension: input.dimension ?? 'ROWS',
        fillLength: input.fillLength,
      };
    } else if (input.range) {
      // Range mode: auto-detect source data within range
      const gridRange = await this.rangeToGridRange(
        input.spreadsheetId,
        input.range,
        this.sheetsApi
      );
      autoFillRequest.range = toGridRange(gridRange);
    } else {
      return this.error({
        code: ErrorCodes.INVALID_PARAMS,
        message:
          'auto_fill requires one of two modes: ' +
          '(1) "range" only - fills within range using first row/column as pattern. Example: { "range": "A1:A10" } ' +
          '(2) "sourceRange" + "fillLength" - extends pattern beyond source. Example: { "sourceRange": "A1:A3", "fillLength": 7 }',
        retryable: false,
        suggestedFix: 'Check the parameter format and ensure all required parameters are provided',
      });
    }

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [{ autoFill: autoFillRequest }],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        const rangeDesc = input.range || input.sourceRange || 'range';
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'auto_fill',
          spreadsheetId: input.spreadsheetId,
          description: `Auto-filled range ${rangeDesc}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('auto_fill', {});
  }

  // ============================================================
  // Filter View Operations (merged from filter-sort.ts)
  // ============================================================

  private async handleCreateFilterView(
    input: DimensionsCreateFilterViewInput
  ): Promise<DimensionsResponse> {
    let resolvedTitle = input.title;
    let resolvedCriteria = input.criteria;

    // Interactive wizard: collect filter settings when title is absent
    if (!resolvedTitle && this.context.server) {
      try {
        const wizardResult = await safeElicit(
          this.context.server,
          {
            mode: 'form',
            message: 'Configure your filter view: enter a name and optionally a column filter',
            requestedSchema: FILTER_SETTINGS_SCHEMA,
          },
          null
        );
        if (wizardResult) {
          const wiz = wizardResult as {
            filterName?: string;
            columnToFilter: string;
            filterType: string;
            filterValue?: string;
          };
          if (wiz.filterName) resolvedTitle = wiz.filterName;
          if (wiz.columnToFilter && wiz.filterType && !resolvedCriteria) {
            // Convert column letter to 0-based index (A=0, B=1, ...)
            const colIndex =
              wiz.columnToFilter
                .toUpperCase()
                .trim()
                .split('')
                .reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
            const typeMap: Record<string, string> = {
              equals: 'TEXT_EQ',
              contains: 'TEXT_CONTAINS',
              greater_than: 'NUMBER_GREATER',
              less_than: 'NUMBER_LESS',
              between: 'NUMBER_BETWEEN',
              is_empty: 'BLANK',
              is_not_empty: 'NOT_BLANK',
            };
            const conditionType = (typeMap[wiz.filterType] ?? 'TEXT_CONTAINS') as
              | 'TEXT_EQ'
              | 'TEXT_CONTAINS'
              | 'NUMBER_GREATER'
              | 'NUMBER_LESS'
              | 'NUMBER_BETWEEN'
              | 'BLANK'
              | 'NOT_BLANK';
            const noValueTypes = new Set<string>(['BLANK', 'NOT_BLANK']);
            resolvedCriteria = {
              [colIndex]: {
                condition: {
                  type: conditionType,
                  ...(noValueTypes.has(conditionType) || !wiz.filterValue
                    ? {}
                    : { values: [wiz.filterValue] }),
                },
              },
            };
          }
        }
      } catch {
        // non-blocking: wizard failure does not prevent filter creation
      }
      if (!resolvedTitle) resolvedTitle = 'Filter View';
    }

    const gridRange = input.range
      ? await this.rangeToGridRange(input.spreadsheetId, input.range, this.sheetsApi)
      : { sheetId: input.sheetId };

    const response = await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            addFilterView: {
              filter: {
                title: resolvedTitle ?? input.title,
                range: toGridRange(gridRange),
                criteria: resolvedCriteria ? mapDimensionsCriteria(resolvedCriteria) : undefined,
                sortSpecs: input.sortSpecs?.map((spec) => ({
                  dimensionIndex: spec.columnIndex,
                  sortOrder: spec.sortOrder ?? 'ASCENDING',
                })),
              },
            },
          },
        ],
      },
    });

    const filterViewId = response.data?.replies?.[0]?.addFilterView?.filter?.filterViewId;

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'create_filter_view',
          spreadsheetId: input.spreadsheetId,
          description: `Created filter view`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('create_filter_view', {
      filterViewId: filterViewId ?? undefined,
    });
  }

  private async handleDuplicateFilterView(
    input: DimensionsDuplicateFilterViewInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('duplicate_filter_view', {}, undefined, true);
    }

    const response = await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateFilterView: {
              filterId: input.filterViewId,
            },
          },
        ],
      },
    });

    const duplicatedFilterViewId =
      response.data?.replies?.[0]?.duplicateFilterView?.filter?.filterViewId;
    return this.success('duplicate_filter_view', {
      filterViewId: duplicatedFilterViewId ?? undefined,
    });
  }

  private async handleUpdateFilterView(
    input: DimensionsUpdateFilterViewInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('update_filter_view', {}, undefined, true);
    }

    const filter: sheets_v4.Schema$FilterView = {
      filterViewId: input.filterViewId,
      title: input.title,
      criteria: input.criteria ? mapDimensionsCriteria(input.criteria) : undefined,
      sortSpecs: input.sortSpecs?.map((spec) => ({
        dimensionIndex: spec.columnIndex,
        sortOrder: spec.sortOrder ?? 'ASCENDING',
      })),
    };

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateFilterView: {
              filter,
              fields:
                [
                  input.title !== undefined ? 'title' : '',
                  input.criteria ? 'criteria' : '',
                  input.sortSpecs ? 'sortSpecs' : '',
                ]
                  .filter(Boolean)
                  .join(',') || 'title',
            },
          },
        ],
      },
    });

    return this.success('update_filter_view', {});
  }

  private async handleDeleteFilterView(
    input: DimensionsDeleteFilterViewInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('delete_filter_view', {}, undefined, true);
    }

    if (this.context.elicitationServer) {
      const confirmation = await confirmDestructiveAction(
        this.context.elicitationServer,
        'delete_filter_view',
        `Delete filter view ${input.filterViewId} from spreadsheet ${input.spreadsheetId}. This cannot be undone.`
      );
      if (!confirmation.confirmed) {
        return this.error({
          code: ErrorCodes.PRECONDITION_FAILED,
          message: confirmation.reason || 'User cancelled the operation',
          retryable: false,
          suggestedFix: 'Review the operation requirements and try again',
        });
      }
    }

    // Safety: snapshot before deleting filter view
    await createSnapshotIfNeeded(
      this.context.snapshotService,
      {
        operationType: 'delete_filter_view',
        isDestructive: true,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteFilterView: { filterId: input.filterViewId },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'delete_filter_view',
          spreadsheetId: input.spreadsheetId,
          description: `Deleted filter view`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('delete_filter_view', {});
  }

  private async handleListFilterViews(
    input: DimensionsListFilterViewsInput
  ): Promise<DimensionsResponse> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.filterViews,sheets.properties.sheetId',
    });

    const filterViews = collectFilterViewSummaries({
      sheets: response.data.sheets,
      sheetId: input.sheetId,
      gridRangeToOutput: (range) => this.gridRangeToOutput(range),
    });
    const paginated = paginateFilterViews(
      filterViews,
      (input as { limit?: number }).limit ?? 50,
      (input as { cursor?: string }).cursor
    );

    for (const fv of paginated.filterViews) {
      recordFilterViewId(fv.filterViewId);
    }

    return this.success('list_filter_views', {
      filterViews: paginated.filterViews,
      totalCount: paginated.totalCount,
      hasMore: paginated.hasMore,
      ...(paginated.nextCursor !== undefined && { nextCursor: paginated.nextCursor }),
    });
  }

  private async handleGetFilterView(
    input: DimensionsGetFilterViewInput
  ): Promise<DimensionsResponse> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.filterViews',
    });

    const filterView = findFilterViewSummaryById({
      sheets: response.data.sheets,
      filterViewId: input.filterViewId,
      gridRangeToOutput: (range) => this.gridRangeToOutput(range),
    });

    if (filterView) {
      return this.success('get_filter_view', { filterViews: [filterView] });
    }

    return this.notFoundError('Filter view', input.filterViewId);
  }

  // ============================================================
  // Slicer Operations (merged from filter-sort.ts)
  // ============================================================

  private async handleCreateSlicer(
    input: DimensionsCreateSlicerInput
  ): Promise<DimensionsResponse> {
    const dataRange = await this.rangeToGridRange(
      input.spreadsheetId,
      input.dataRange,
      this.sheetsApi
    );

    // Slicer Position Enhancement: Convert simple anchorCell format to Google API's overlayPosition
    // User provides: anchorCell: "P1" (string)
    // Google API expects: overlayPosition.anchorCell: {sheetId, rowIndex, columnIndex} (object)
    // This conversion allows simpler AI instruction format while maintaining API compatibility
    const anchor = parseCellReference(input.position.anchorCell);

    const batchResponse = await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSlicer: {
              slicer: {
                spec: {
                  title: input.title,
                  dataRange: toGridRange(dataRange),
                  columnIndex: input.filterColumn,
                  ...(input.filterCriteria
                    ? { filterCriteria: toApiSlicerFilterCriteria(input.filterCriteria) }
                    : {}),
                },
                position: {
                  overlayPosition: {
                    anchorCell: {
                      sheetId: dataRange.sheetId,
                      rowIndex: anchor.row,
                      columnIndex: anchor.col,
                    },
                    offsetXPixels: input.position.offsetX ?? 0,
                    offsetYPixels: input.position.offsetY ?? 0,
                    widthPixels: input.position.width ?? 200,
                    heightPixels: input.position.height ?? 150,
                  },
                },
              },
            },
          },
        ],
      },
    });

    const replies = 'data' in batchResponse ? batchResponse.data?.replies : undefined;
    const slicerId = replies?.[0]?.addSlicer?.slicer?.slicerId ?? undefined;

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'create_slicer',
          spreadsheetId: input.spreadsheetId,
          description: `Created slicer`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('create_slicer', { slicerId });
  }

  private async handleUpdateSlicer(
    input: DimensionsUpdateSlicerInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('update_slicer', {}, undefined, true);
    }

    const spec: sheets_v4.Schema$SlicerSpec = {
      title: input.title,
      columnIndex: input.filterColumn,
      ...(input.filterCriteria
        ? { filterCriteria: toApiSlicerFilterCriteria(input.filterCriteria) }
        : {}),
    };

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSlicerSpec: {
              slicerId: input.slicerId,
              spec,
              fields:
                [
                  input.title !== undefined ? 'title' : '',
                  input.filterColumn !== undefined ? 'columnIndex' : '',
                  input.filterCriteria !== undefined ? 'filterCriteria' : '',
                ]
                  .filter(Boolean)
                  .join(',') || 'title',
            },
          },
        ],
      },
    });

    return this.success('update_slicer', {});
  }

  private async handleDeleteSlicer(
    input: DimensionsDeleteSlicerInput
  ): Promise<DimensionsResponse> {
    if (input.safety?.dryRun) {
      return this.success('delete_slicer', {}, undefined, true);
    }

    if (this.context.elicitationServer) {
      const confirmation = await confirmDestructiveAction(
        this.context.elicitationServer,
        'delete_slicer',
        `Delete slicer ${input.slicerId} from spreadsheet ${input.spreadsheetId}. This cannot be undone.`
      );
      if (!confirmation.confirmed) {
        return this.error({
          code: ErrorCodes.PRECONDITION_FAILED,
          message: confirmation.reason || 'User cancelled the operation',
          retryable: false,
          suggestedFix: 'Review the operation requirements and try again',
        });
      }
    }

    // Safety: snapshot before deleting slicer
    await createSnapshotIfNeeded(
      this.context.snapshotService,
      { operationType: 'delete_slicer', isDestructive: true, spreadsheetId: input.spreadsheetId },
      input.safety
    );

    await this.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteEmbeddedObject: { objectId: input.slicerId },
          },
        ],
      },
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_dimensions',
          action: 'delete_slicer',
          spreadsheetId: input.spreadsheetId,
          description: `Deleted slicer`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('delete_slicer', {});
  }

  private async handleListSlicers(input: DimensionsListSlicersInput): Promise<DimensionsResponse> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: 'sheets.slicers,sheets.properties.sheetId',
    });

    const slicers = [];
    for (const sheet of response.data.sheets ?? []) {
      if (input.sheetId !== undefined && sheet.properties?.sheetId !== input.sheetId) continue;
      for (const slicer of sheet.slicers ?? []) {
        slicers.push({
          slicerId: slicer.slicerId ?? 0,
          sheetId: sheet.properties?.sheetId ?? 0,
          title: slicer.spec?.title ?? undefined,
          // Full slicer spec (ISSUE-180: was previously omitted)
          columnIndex: slicer.spec?.columnIndex ?? undefined,
          dataRange: slicer.spec?.dataRange ?? undefined,
          filterCriteria: slicer.spec?.filterCriteria ?? undefined,
          horizontalAlignment: slicer.spec?.horizontalAlignment ?? undefined,
          textFormat: slicer.spec?.textFormat ?? undefined,
          backgroundColorStyle: slicer.spec?.backgroundColorStyle ?? undefined,
        });
      }
    }

    for (const slicer of slicers) {
      recordSlicerId(slicer.slicerId);
    }

    return this.success('list_slicers', { slicers });
  }
}
