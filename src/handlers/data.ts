/**
 * ServalSheets - Data Handler (Thin Dispatch)
 *
 * Handles the sheets_data tool (23 actions).
 *
 * Architecture: Thin dispatch class. Action implementations live in
 * src/handlers/data-actions/ submodules and receive a DataHandlerAccess
 * object exposing the protected BaseHandler capabilities they need.
 *
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type { SheetsDataInput, SheetsDataOutput, DataResponse } from '../schemas/data.js';
import { getEnv } from '../config/env.js';

// Type alias for the request union
type DataRequest = SheetsDataInput['request'];
import type { ResponseMeta } from '../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../schemas/shared.js';

// ─── Submodule imports ────────────────────────────────────────────────────────
import type { DataHandlerAccess, DataFeatureFlags } from './data-actions/internal.js';
import { handleRead, handleWrite, handleAppend, handleClear } from './data-actions/read-write.js';
import {
  handleBatchRead,
  handleBatchWrite,
  handleBatchClear,
  handleFindReplace,
} from './data-actions/batch.js';
import {
  handleAddNote,
  handleGetNote,
  handleClearNote,
  handleSetHyperlink,
  handleClearHyperlink,
} from './data-actions/notes-links.js';
import {
  handleMergeCells,
  handleUnmergeCells,
  handleGetMerges,
  handleCutPaste,
  handleCopyPaste,
  handleDetectSpillRanges,
} from './data-actions/merges.js';
import {
  handleCrossRead,
  handleCrossQuery,
  handleCrossWrite,
  handleCrossCompare,
} from './data-actions/cross.js';
import { handleSmartFill } from './data-actions/smart-fill.js';
import { handleAutoFill } from './data-actions/auto-fill.js';

/**
 * Main handler for sheets_data tool — thin dispatch only.
 */
export class SheetsDataHandler extends BaseHandler<SheetsDataInput, SheetsDataOutput> {
  private sheetsApi: sheets_v4.Sheets;
  private featureFlags: DataFeatureFlags;

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets) {
    super('sheets_data', context);
    this.sheetsApi = sheetsApi;
    const env = getEnv();
    const contextFlags = (context as HandlerContext & { featureFlags?: Record<string, unknown> })
      .featureFlags;
    this.featureFlags = {
      enableDataFilterBatch:
        (contextFlags?.['enableDataFilterBatch'] as boolean | undefined) ??
        env.ENABLE_DATAFILTER_BATCH,
      enableTableAppends:
        (contextFlags?.['enableTableAppends'] as boolean | undefined) ?? env.ENABLE_TABLE_APPENDS,
      enablePayloadValidation:
        (contextFlags?.['enablePayloadValidation'] as boolean | undefined) ??
        env.ENABLE_PAYLOAD_VALIDATION,
    };
  }

  async handle(input: SheetsDataInput): Promise<SheetsDataOutput> {
    this.requireAuth();

    const inferredRequest = this.inferRequestParameters(
      unwrapRequest<SheetsDataInput['request']>(input)
    ) as DataRequest;

    const verbosity = inferredRequest.verbosity ?? 'standard';
    this.setVerbosity(verbosity);

    if ('spreadsheetId' in inferredRequest) {
      this.trackSpreadsheetId(inferredRequest.spreadsheetId);
    }

    try {
      const response = await this.executeAction(inferredRequest);

      if (response.success && 'spreadsheetId' in inferredRequest) {
        this.trackContextFromRequest({
          spreadsheetId: inferredRequest.spreadsheetId,
          sheetId:
            'sheetId' in inferredRequest
              ? typeof inferredRequest.sheetId === 'number'
                ? inferredRequest.sheetId
                : undefined
              : undefined,
          range:
            'range' in inferredRequest
              ? typeof inferredRequest.range === 'string'
                ? inferredRequest.range
                : undefined
              : undefined,
        });
      }

      const filteredResponse = super.applyVerbosityFilter(response, verbosity);
      return { response: filteredResponse } as SheetsDataOutput;
    } catch (err) {
      return { response: this.mapError(err) } as SheetsDataOutput;
    }
  }

  protected createIntents(input: SheetsDataInput): Intent[] {
    const req = unwrapRequest<SheetsDataInput['request']>(input);
    if (!('spreadsheetId' in req)) {
      return [];
    }
    const baseIntent = {
      target: {
        spreadsheetId: req.spreadsheetId,
      },
      metadata: {
        sourceTool: this.toolName,
        sourceAction: req.action,
        priority: 1,
        destructive: false,
      },
    };

    switch (req.action) {
      case 'write':
        return [
          {
            ...baseIntent,
            type: 'SET_VALUES' as const,
            payload: { values: req.values },
            metadata: {
              ...baseIntent.metadata,
              estimatedCells: req.values.reduce((sum, row) => sum + row.length, 0),
            },
          },
        ];
      case 'append':
        return [
          {
            ...baseIntent,
            type: 'APPEND_VALUES' as const,
            payload: { values: req.values },
            metadata: {
              ...baseIntent.metadata,
              estimatedCells: req.values.reduce((sum, row) => sum + row.length, 0),
            },
          },
        ];
      case 'clear':
        return [
          {
            ...baseIntent,
            type: 'CLEAR_VALUES' as const,
            payload: {},
            metadata: {
              ...baseIntent.metadata,
              destructive: true,
            },
          },
        ];
      default:
        return [];
    }
  }

  // ─── Public delegates for submodule access ────────────────────────────────

  public _makeError(e: ErrorDetail): DataResponse {
    return this.error(e);
  }

  public _makeSuccess(
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ): DataResponse {
    return this.success(action, data, mutation, dryRun, meta);
  }

  public _generateMeta(
    action: string,
    input: Record<string, unknown>,
    result?: Record<string, unknown>,
    options?: { cellsAffected?: number; apiCallsMade?: number; duration?: number }
  ): ResponseMeta {
    return this.generateMeta(action, input, result, options);
  }

  public _getSheetId(
    spreadsheetId: string,
    sheetName?: string,
    api?: sheets_v4.Sheets
  ): Promise<number> {
    return this.getSheetId(spreadsheetId, sheetName, api);
  }

  public _deduplicatedApiCall<T>(key: string, call: () => Promise<T>): Promise<T> {
    return this.deduplicatedApiCall(key, call);
  }

  public _recordAccessAndPrefetch(params: {
    spreadsheetId: string;
    sheetId?: number;
    range?: string;
    action?: 'read' | 'write' | 'open';
  }): void {
    return this.recordAccessAndPrefetch(params);
  }

  public _sendProgress(completed: number, total: number, message?: string): Promise<void> {
    return this.sendProgress(completed, total, message);
  }

  public _withCircuitBreaker<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return this.withCircuitBreaker(operation, fn);
  }

  public _columnToLetter(index: number): string {
    return this.columnToLetter(index);
  }

  // ─── Handler access builder ───────────────────────────────────────────────

  private createHandlerAccess(): DataHandlerAccess {
    return {
      makeError: (e) => this._makeError(e),
      makeSuccess: (action, data, mutation, dryRun, meta) =>
        this._makeSuccess(action, data, mutation, dryRun, meta),
      generateMeta: (action, input, result, options) =>
        this._generateMeta(action, input, result, options),
      getSheetId: (spreadsheetId, sheetName, api) =>
        this._getSheetId(spreadsheetId, sheetName, api),
      resolveRange: (spreadsheetId, range) =>
        this.resolveRange(spreadsheetId, range as Parameters<typeof this.resolveRange>[1]),
      deduplicatedApiCall: (key, call) => this._deduplicatedApiCall(key, call),
      recordAccessAndPrefetch: (params) => this._recordAccessAndPrefetch(params),
      sendProgress: (completed, total, message) => this._sendProgress(completed, total, message),
      withCircuitBreaker: (operation, fn) => this._withCircuitBreaker(operation, fn),
      columnToLetter: (index) => this._columnToLetter(index),
      context: this.context,
      api: this.sheetsApi,
      featureFlags: this.featureFlags,
      toolName: this.toolName,
      currentSpreadsheetId: this.currentSpreadsheetId,
    };
  }

  // ─── Action dispatch ──────────────────────────────────────────────────────

  private async executeAction(request: DataRequest): Promise<DataResponse> {
    const ha = this.createHandlerAccess();

    switch (request.action) {
      case 'read':
        return handleRead(ha, request);
      case 'write':
        return handleWrite(ha, request);
      case 'append':
        return handleAppend(ha, request);
      case 'clear':
        return handleClear(ha, request);
      case 'batch_read':
        return handleBatchRead(ha, request);
      case 'batch_write':
        return handleBatchWrite(ha, request);
      case 'batch_clear':
        return handleBatchClear(ha, request);
      case 'find_replace':
        return handleFindReplace(ha, request);
      case 'add_note':
        return handleAddNote(ha, request);
      case 'get_note':
        return handleGetNote(ha, request);
      case 'clear_note':
        return handleClearNote(ha, request);
      case 'set_hyperlink':
        return handleSetHyperlink(ha, request);
      case 'clear_hyperlink':
        return handleClearHyperlink(ha, request);
      case 'merge_cells':
        return handleMergeCells(ha, request);
      case 'unmerge_cells':
        return handleUnmergeCells(ha, request);
      case 'get_merges':
        return handleGetMerges(ha, request);
      case 'cut_paste':
        return handleCutPaste(ha, request);
      case 'copy_paste':
        return handleCopyPaste(ha, request);
      case 'detect_spill_ranges':
        return handleDetectSpillRanges(ha, request);
      case 'cross_read':
        return handleCrossRead(ha, request as DataRequest & { action: 'cross_read' });
      case 'cross_query':
        return handleCrossQuery(ha, request as DataRequest & { action: 'cross_query' });
      case 'cross_write':
        return handleCrossWrite(ha, request as DataRequest & { action: 'cross_write' });
      case 'cross_compare':
        return handleCrossCompare(ha, request as DataRequest & { action: 'cross_compare' });
      case 'smart_fill':
        return handleSmartFill(
          ha,
          request as unknown as import('../schemas/data.js').DataSmartFillInput
        );
      case 'auto_fill':
        return handleAutoFill(
          ha,
          request as unknown as import('../schemas/data.js').DataAutoFillInput
        );

      default: {
        const action = (request as { action: string }).action;
        if (action === 'set_note' || action === 'notes') {
          return handleAddNote(ha, request as unknown as DataRequest & { action: 'add_note' });
        }
        if (action === 'add_hyperlink' || action === 'hyperlink' || action === 'hyperlinks') {
          return handleSetHyperlink(
            ha,
            request as unknown as DataRequest & { action: 'set_hyperlink' }
          );
        }
        if (action === 'merge') {
          return handleMergeCells(
            ha,
            request as unknown as DataRequest & { action: 'merge_cells' }
          );
        }
        if (action === 'unmerge') {
          return handleUnmergeCells(
            ha,
            request as unknown as DataRequest & { action: 'unmerge_cells' }
          );
        }

        return this.error({
          code: ErrorCodes.INVALID_PARAMS,
          message: `Unknown action: ${action}. Available actions: read, write, append, clear, batch_read, batch_write, batch_clear, find_replace, add_note, get_note, clear_note, set_hyperlink, clear_hyperlink, merge_cells, unmerge_cells, get_merges, cut_paste, copy_paste, cross_read, cross_query, cross_write, cross_compare`,
          retryable: false,
          suggestedFix:
            'Check the parameter format and ensure all required parameters are provided',
        });
      }
    }
  }
}
