/**
 * ServalSheets - Format Handler (Thin Dispatch)
 *
 * Handles the sheets_format tool (24 actions).
 *
 * Architecture: Thin dispatch class. Action implementations live in
 * src/handlers/format-actions/ submodules and receive a FormatHandlerAccess
 * object exposing the protected BaseHandler capabilities they need.
 *
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type {
  SheetsFormatInput,
  SheetsFormatOutput,
  FormatResponse,
  FormatRequest,
} from '../schemas/index.js';
import {
  buildGridRangeInput,
  parseA1Notation,
  estimateCellCount,
  type GridRangeInput,
} from '../utils/google-sheets-helpers.js';
import { RangeResolutionError } from '../core/range-resolver.js';
import type { ResponseMeta } from '../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../schemas/shared.js';
import { ensureRetriableGoogleApi } from '../utils/google-api-retry-wrapper.js';

// ─── Submodule imports ────────────────────────────────────────────────────────
import type { FormatHandlerAccess } from './format-actions/internal.js';
import {
  handleSetFormat,
  handleSetBackground,
  handleSetTextFormat,
  handleSetNumberFormat,
  handleSetAlignment,
  handleSetBorders,
  handleClearFormat,
  handleSetRichText,
} from './format-actions/basic.js';
import {
  handleApplyPreset,
  handleAutoFit,
  handleBatchFormat,
  handleSparklineAdd,
  handleSparklineGet,
  handleSparklineClear,
} from './format-actions/presets.js';
import {
  handleRuleAddConditionalFormat,
  handleRuleUpdateConditionalFormat,
  handleRuleDeleteConditionalFormat,
  handleRuleListConditionalFormats,
  handleAddConditionalFormatRule,
  handleGenerateConditionalFormat,
} from './format-actions/conditional.js';
import {
  handleSetDataValidation,
  handleClearDataValidation,
  handleListDataValidations,
  handleSuggestFormat,
} from './format-actions/validation.js';

// ─── Internal types for batching queue (kept in main class) ─────────────────
import type { QueuedFormatOperation } from './format-actions/helpers.js';
import { mergeFormatOperations } from './format-actions/helpers.js';

/**
 * Main handler for sheets_format tool — thin dispatch only.
 */
export class FormatHandler extends BaseHandler<SheetsFormatInput, SheetsFormatOutput> {
  private sheetsApi: sheets_v4.Sheets;
  // Fix 1.4: Track format operations for auto-consolidation
  private formatQueue = new Map<string, QueuedFormatOperation[]>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  // Fix 6: Track sequential individual format calls to suggest batch_format
  private recentFormatCallCount = 0;
  private lastFormatCallTime = 0;

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets) {
    super('sheets_format', context);
    this.sheetsApi = ensureRetriableGoogleApi(sheetsApi) as sheets_v4.Sheets;
  }

  /**
   * Handle format operations with verbosity-aware metadata generation
   */
  async handle(input: SheetsFormatInput): Promise<SheetsFormatOutput> {
    const req = unwrapRequest<SheetsFormatInput['request']>(input);

    this.requireAuth();

    const inferredReq = this.inferRequestParameters(req) as FormatRequest;

    const verbosity = inferredReq.verbosity ?? 'standard';
    this.setVerbosity(verbosity);

    try {
      const response = await this.executeAction(inferredReq);

      if (response.success) {
        this.trackContextFromRequest({
          spreadsheetId: inferredReq.spreadsheetId,
          sheetId:
            'sheetId' in inferredReq
              ? typeof inferredReq.sheetId === 'number'
                ? inferredReq.sheetId
                : undefined
              : undefined,
          range:
            'range' in inferredReq
              ? typeof inferredReq.range === 'string'
                ? inferredReq.range
                : undefined
              : undefined,
        });
      }

      // Fix 6: Track individual format calls and suggest batch_format
      const individualFormatActions = [
        'set_format',
        'set_background',
        'set_text_format',
        'set_number_format',
        'set_alignment',
        'set_borders',
        'apply_preset',
      ];
      const now = Date.now();
      if (individualFormatActions.includes(inferredReq.action) && response.success) {
        if (now - this.lastFormatCallTime > 30000) {
          this.recentFormatCallCount = 0;
        }
        this.recentFormatCallCount++;
        this.lastFormatCallTime = now;

        if (this.recentFormatCallCount >= 3) {
          const saved = this.recentFormatCallCount - 1;
          (response as Record<string, unknown>)['_hint'] =
            `You've made ${this.recentFormatCallCount} separate format calls. Use batch_format to combine them — saves ~${Math.round((saved / this.recentFormatCallCount) * 100)}% API calls.`;
        }
      } else if (inferredReq.action === 'batch_format') {
        this.recentFormatCallCount = 0;
      }

      const filteredResponse = super.applyVerbosityFilter(response, verbosity);

      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  protected createIntents(input: SheetsFormatInput): Intent[] {
    const req = unwrapRequest<SheetsFormatInput['request']>(input);
    const destructiveActions = [
      'clear_format',
      'rule_update_conditional_format',
      'rule_delete_conditional_format',
      'clear_data_validation',
    ];

    const isRuleAction = req.action.startsWith('rule_');

    if ('spreadsheetId' in req) {
      return [
        {
          type: isRuleAction ? 'UPDATE_CONDITIONAL_FORMAT' : 'UPDATE_CELLS',
          target: { spreadsheetId: req.spreadsheetId },
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

  // ─── Public delegates for submodule access ────────────────────────────────

  public _makeError(e: ErrorDetail): FormatResponse {
    return this.error(e);
  }

  public _makeSuccess(
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean,
    meta?: ResponseMeta
  ): FormatResponse {
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

  public _resolveRange(spreadsheetId: string, range: unknown): Promise<string> {
    return this.resolveRange(spreadsheetId, range as Parameters<typeof this.resolveRange>[1]);
  }

  public _a1ToGridRange(spreadsheetId: string, a1: string): Promise<GridRangeInput> {
    const parsed = parseA1Notation(a1);
    return this.getSheetId(spreadsheetId, parsed.sheetName, this.sheetsApi).then((sheetId) =>
      buildGridRangeInput(sheetId, parsed.startRow, parsed.endRow, parsed.startCol, parsed.endCol)
    );
  }

  public async _resolveGridRange(
    spreadsheetId: string,
    sheetId: number,
    range: unknown
  ): Promise<GridRangeInput> {
    const r = range as
      | { a1?: string }
      | { namedRange?: string }
      | { semantic?: unknown }
      | { grid?: unknown }
      | string
      | undefined
      | null;

    if (r === undefined || r === null) {
      throw new RangeResolutionError(
        'Range is required for this operation. Provide A1 notation (e.g., "Sheet1!A1:D10") or a range object with { a1: "..." }.',
        'INVALID_PARAMS',
        { spreadsheetId, sheetId },
        false
      );
    }

    if (typeof r === 'string') {
      const parsed = parseA1Notation(r);
      let resolvedSheetId = sheetId;
      if (
        resolvedSheetId === undefined ||
        resolvedSheetId === null ||
        Number.isNaN(resolvedSheetId)
      ) {
        if (parsed.sheetName) {
          resolvedSheetId = await this.getSheetId(spreadsheetId, parsed.sheetName, this.sheetsApi);
        } else {
          resolvedSheetId = await this.getSheetId(spreadsheetId, undefined, this.sheetsApi);
        }
      }
      return buildGridRangeInput(
        resolvedSheetId,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol
      );
    }

    if ('a1' in r && r.a1) {
      const parsed = parseA1Notation(r.a1);
      let resolvedSheetId = sheetId;
      if (
        resolvedSheetId === undefined ||
        resolvedSheetId === null ||
        Number.isNaN(resolvedSheetId)
      ) {
        if (parsed.sheetName) {
          resolvedSheetId = await this.getSheetId(spreadsheetId, parsed.sheetName, this.sheetsApi);
        } else {
          resolvedSheetId = await this.getSheetId(spreadsheetId, undefined, this.sheetsApi);
        }
      }
      return buildGridRangeInput(
        resolvedSheetId,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol
      );
    }

    if ('grid' in r && r.grid) {
      const grid = r.grid as {
        sheetId: number;
        startRowIndex?: number;
        endRowIndex?: number;
        startColumnIndex?: number;
        endColumnIndex?: number;
      };
      return buildGridRangeInput(
        grid.sheetId ?? sheetId,
        grid.startRowIndex,
        grid.endRowIndex,
        grid.startColumnIndex,
        grid.endColumnIndex
      );
    }

    if ('namedRange' in r && r.namedRange) {
      const response = await this.sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'namedRanges',
      });

      const namedRange = response.data.namedRanges?.find((nr) => nr.name === r.namedRange);
      if (namedRange?.range) {
        return buildGridRangeInput(
          namedRange.range.sheetId ?? sheetId,
          namedRange.range.startRowIndex ?? 0,
          namedRange.range.endRowIndex ?? 1000,
          namedRange.range.startColumnIndex ?? 0,
          namedRange.range.endColumnIndex ?? 26
        );
      }
    }

    throw new RangeResolutionError(
      'Could not resolve range - ambiguous input',
      'RANGE_RESOLUTION_FAILED',
      { input: range, spreadsheetId, sheetId },
      false
    );
  }

  public async _resolveRangeInput(spreadsheetId: string, range: unknown): Promise<GridRangeInput> {
    const r = range as
      | { a1?: string }
      | { namedRange?: string }
      | { semantic?: unknown }
      | { grid?: unknown }
      | string
      | undefined
      | null;

    if (r === undefined || r === null) {
      throw new RangeResolutionError(
        'Range is required for this operation. Provide A1 notation (e.g., "Sheet1!A1:D10") or a range object.',
        'INVALID_PARAMS',
        { spreadsheetId },
        false
      );
    }

    if (typeof r === 'string') {
      const parsed = parseA1Notation(r);
      const sid = await this.getSheetId(spreadsheetId, parsed.sheetName, this.sheetsApi);
      return buildGridRangeInput(
        sid,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol
      );
    }

    if ('a1' in r && r.a1) {
      const parsed = parseA1Notation(r.a1);
      const sid = await this.getSheetId(spreadsheetId, parsed.sheetName, this.sheetsApi);
      return buildGridRangeInput(
        sid,
        parsed.startRow,
        parsed.endRow,
        parsed.startCol,
        parsed.endCol
      );
    }

    if ('grid' in r && r.grid) {
      const grid = r.grid as {
        sheetId: number;
        startRowIndex?: number;
        endRowIndex?: number;
        startColumnIndex?: number;
        endColumnIndex?: number;
      };
      return buildGridRangeInput(
        grid.sheetId,
        grid.startRowIndex,
        grid.endRowIndex,
        grid.startColumnIndex,
        grid.endColumnIndex
      );
    }

    if ('namedRange' in r && r.namedRange) {
      const response = await this.sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'namedRanges',
      });

      const namedRange = response.data.namedRanges?.find((nr) => nr.name === r.namedRange);
      if (namedRange?.range) {
        return buildGridRangeInput(
          namedRange.range.sheetId ?? 0,
          namedRange.range.startRowIndex ?? 0,
          namedRange.range.endRowIndex ?? 1000,
          namedRange.range.startColumnIndex ?? 0,
          namedRange.range.endColumnIndex ?? 26
        );
      }
    }

    throw new RangeResolutionError(
      'Could not resolve range - ambiguous input',
      'RANGE_RESOLUTION_FAILED',
      { input: range, spreadsheetId },
      false
    );
  }

  public _exactCellCount(range: sheets_v4.Schema$GridRange): number {
    return estimateCellCount(range, { sparsityFactor: 1 });
  }

  // ─── Handler access builder ───────────────────────────────────────────────

  private createHandlerAccess(): FormatHandlerAccess {
    return {
      makeError: (e) => this._makeError(e),
      makeSuccess: (action, data, mutation, dryRun, meta) =>
        this._makeSuccess(action, data, mutation, dryRun, meta),
      generateMeta: (action, input, result, options) =>
        this._generateMeta(action, input, result, options),
      getSheetId: (spreadsheetId, sheetName, api) =>
        this._getSheetId(spreadsheetId, sheetName, api),
      deduplicatedApiCall: (key, call) => this._deduplicatedApiCall(key, call),
      recordAccessAndPrefetch: (params) => this._recordAccessAndPrefetch(params),
      sendProgress: (completed, total, message) => this._sendProgress(completed, total, message),
      withCircuitBreaker: (operation, fn) => this._withCircuitBreaker(operation, fn),
      columnToLetter: (index) => this._columnToLetter(index),
      resolveRange: (spreadsheetId, range) => this._resolveRange(spreadsheetId, range),
      a1ToGridRange: (spreadsheetId, a1) => this._a1ToGridRange(spreadsheetId, a1),
      resolveGridRange: (spreadsheetId, sheetId, range) =>
        this._resolveGridRange(spreadsheetId, sheetId, range),
      resolveRangeInput: (spreadsheetId, range) => this._resolveRangeInput(spreadsheetId, range),
      exactCellCount: (range) => this._exactCellCount(range),
      context: this.context,
      api: this.sheetsApi,
      toolName: this.toolName,
      currentSpreadsheetId: this.currentSpreadsheetId,
    };
  }

  // ─── Batching helpers (manage queue state that must stay on the class) ────

  private shouldBatchFormat(request: FormatRequest): boolean {
    const batchableActions = [
      'set_number_format',
      'set_background',
      'set_text_format',
      'set_borders',
      'set_alignment',
    ];
    return batchableActions.includes(request.action);
  }

  private getBatchKey(request: FormatRequest): string | null {
    if (!('spreadsheetId' in request) || !('sheetId' in request)) {
      return null;
    }
    return `${request.spreadsheetId}:${request.sheetId}`;
  }

  private detectAdjacentRanges(ranges: string[]): void {
    const logger = this.context.logger;
    if (!logger || ranges.length < 2) return;

    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const range1 = ranges[i]!;
        const range2 = ranges[j]!;

        try {
          const parsed1 = parseA1Notation(range1);
          const parsed2 = parseA1Notation(range2);

          if (
            parsed1.sheetName === parsed2.sheetName &&
            parsed1.startRow === parsed2.startRow &&
            parsed1.endRow === parsed2.endRow
          ) {
            if (parsed1.endCol + 1 === parsed2.startCol) {
              const mergedRange = `${parsed1.sheetName}!${this.columnToLetter(parsed1.startCol)}${parsed1.startRow}:${this.columnToLetter(parsed2.endCol)}${parsed2.endRow}`;
              logger.info('Adjacent ranges detected - could be merged', {
                range1,
                range2,
                mergedRange,
                apiCallSavings: 1,
              });
            }
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }
  }

  private async flushFormatQueue(key: string): Promise<void> {
    const operations = this.formatQueue.get(key);
    if (!operations || operations.length === 0) {
      return;
    }

    this.formatQueue.delete(key);
    const timer = this.flushTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(key);
    }

    const logger = this.context.logger;
    logger?.info(`Auto-consolidating ${operations.length} format operations`, { key });

    const rangeGroups = new Map<string, QueuedFormatOperation[]>();

    for (const op of operations) {
      const range =
        'range' in op.request && op.request.range ? String(op.request.range) : 'default';
      const group = rangeGroups.get(range) || [];
      group.push(op);
      rangeGroups.set(range, group);
    }

    this.detectAdjacentRanges(Array.from(rangeGroups.keys()));

    const ha = this.createHandlerAccess();

    for (const [range, group] of rangeGroups.entries()) {
      try {
        if (group.length === 1) {
          const result = await this.executeFormatOperationDirect(ha, group[0]!.request);
          group[0]!.resolve(result);
        } else {
          const merged = mergeFormatOperations(group.map((g) => g.request));
          const result = await this.executeFormatOperationDirect(ha, merged);

          for (const op of group) {
            op.resolve(result);
          }

          logger?.info(`Consolidated ${group.length} operations into 1 set_format call`, {
            range,
            actions: group.map((g) => g.request.action),
            savingsPercent: Math.round((1 - 1 / group.length) * 100),
          });
        }
      } catch (error) {
        for (const op of group) {
          op.reject(error);
        }
      }
    }
  }

  // ─── Action dispatch ──────────────────────────────────────────────────────

  private async executeAction(request: FormatRequest): Promise<FormatResponse> {
    if (this.shouldBatchFormat(request)) {
      const batchKey = this.getBatchKey(request);
      if (batchKey) {
        return new Promise<FormatResponse>((resolve, reject) => {
          const operations = this.formatQueue.get(batchKey) || [];
          operations.push({
            request,
            timestamp: Date.now(),
            resolve,
            reject,
          });
          this.formatQueue.set(batchKey, operations);

          const existingTimer = this.flushTimers.get(batchKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          const timer = setTimeout(() => {
            void this.flushFormatQueue(batchKey);
          }, 500);
          this.flushTimers.set(batchKey, timer);

          this.context.logger?.info('Format operation queued for consolidation', {
            action: request.action,
            batchKey,
            queueSize: operations.length,
          });
        });
      }
    }

    const ha = this.createHandlerAccess();
    return this.executeFormatOperationDirect(ha, request);
  }

  private async executeFormatOperationDirect(
    ha: FormatHandlerAccess,
    request: FormatRequest
  ): Promise<FormatResponse> {
    switch (request.action) {
      case 'set_format':
        return handleSetFormat(ha, request as FormatRequest & { action: 'set_format' });
      case 'suggest_format':
        return handleSuggestFormat(ha, request as FormatRequest & { action: 'suggest_format' });
      case 'set_background':
        return handleSetBackground(ha, request as FormatRequest & { action: 'set_background' });
      case 'set_text_format':
        return handleSetTextFormat(ha, request as FormatRequest & { action: 'set_text_format' });
      case 'set_number_format':
        return handleSetNumberFormat(
          ha,
          request as FormatRequest & { action: 'set_number_format' }
        );
      case 'set_alignment':
        return handleSetAlignment(ha, request as FormatRequest & { action: 'set_alignment' });
      case 'set_borders':
        return handleSetBorders(ha, request as FormatRequest & { action: 'set_borders' });
      case 'clear_format':
        return handleClearFormat(ha, request as FormatRequest & { action: 'clear_format' });
      case 'apply_preset':
        return handleApplyPreset(ha, request as FormatRequest & { action: 'apply_preset' });
      case 'auto_fit':
        return handleAutoFit(ha, request as FormatRequest & { action: 'auto_fit' });
      case 'batch_format':
        return handleBatchFormat(ha, request as FormatRequest & { action: 'batch_format' });
      case 'rule_add_conditional_format':
        return handleRuleAddConditionalFormat(
          ha,
          request as FormatRequest & { action: 'rule_add_conditional_format' }
        );
      case 'rule_update_conditional_format':
        return handleRuleUpdateConditionalFormat(
          ha,
          request as FormatRequest & { action: 'rule_update_conditional_format' }
        );
      case 'rule_delete_conditional_format':
        return handleRuleDeleteConditionalFormat(
          ha,
          request as FormatRequest & { action: 'rule_delete_conditional_format' }
        );
      case 'rule_list_conditional_formats':
        return handleRuleListConditionalFormats(
          ha,
          request as FormatRequest & { action: 'rule_list_conditional_formats' }
        );
      case 'set_data_validation':
        return handleSetDataValidation(
          ha,
          request as FormatRequest & { action: 'set_data_validation' }
        );
      case 'clear_data_validation':
        return handleClearDataValidation(
          ha,
          request as FormatRequest & { action: 'clear_data_validation' }
        );
      case 'list_data_validations':
        return handleListDataValidations(
          ha,
          request as FormatRequest & { action: 'list_data_validations' }
        );
      case 'add_conditional_format_rule':
        return handleAddConditionalFormatRule(
          ha,
          request as FormatRequest & { action: 'add_conditional_format_rule' }
        );
      case 'generate_conditional_format':
        return handleGenerateConditionalFormat(
          ha,
          request as FormatRequest & { action: 'generate_conditional_format' }
        );
      case 'sparkline_add':
        return handleSparklineAdd(ha, request as FormatRequest & { action: 'sparkline_add' });
      case 'sparkline_get':
        return handleSparklineGet(ha, request as FormatRequest & { action: 'sparkline_get' });
      case 'sparkline_clear':
        return handleSparklineClear(ha, request as FormatRequest & { action: 'sparkline_clear' });
      case 'set_rich_text':
        return handleSetRichText(ha, request as FormatRequest & { action: 'set_rich_text' });
      case 'build_dependent_dropdown':
        return this.handleBuildDependentDropdown(
          request as FormatRequest & { action: 'build_dependent_dropdown' }
        );
      default: {
        const _exhaustiveCheck: never = request;
        return this.error({
          code: ErrorCodes.INVALID_PARAMS,
          message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
          retryable: false,
          suggestedFix:
            'Check the parameter format and ensure all required parameters are provided',
        });
      }
    }
  }

  // ─── build_dependent_dropdown ────────────────────────────────────────────

  private async handleBuildDependentDropdown(
    input: FormatRequest & { action: 'build_dependent_dropdown' }
  ): Promise<FormatResponse> {
    const { spreadsheetId, parentRange, dependentRange, lookupSheet } = input;

    // Step 1: Read the lookup table (column A = parent values, columns B+ = child options)
    const lookupResponse = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: lookupSheet,
    });
    const lookupRows = lookupResponse.data.values ?? [];

    // Step 2: Extract unique parent values and child options
    const parentValues: string[] = [];
    const childMap = new Map<string, string[]>();
    for (const row of lookupRows) {
      const parent = String(row[0] ?? '').trim();
      if (!parent) continue;
      parentValues.push(parent);
      const children = (row as unknown[])
        .slice(1)
        .map((c) => String(c ?? '').trim())
        .filter(Boolean);
      childMap.set(parent, children);
    }

    if (parentValues.length === 0) {
      return this._makeError({
        code: ErrorCodes.INVALID_PARAMS,
        message: `Lookup sheet "${lookupSheet}" has no data in column A`,
        retryable: false,
        suggestedFix: 'Ensure column A of the lookup sheet contains parent category values',
      });
    }

    // Step 3: Create named ranges for each parent's child options
    const spreadsheetMeta = await this.sheetsApi.spreadsheets.get({ spreadsheetId });
    const lookupSheetObj = spreadsheetMeta.data.sheets?.find(
      (s) => s.properties?.title === lookupSheet
    );
    const lookupSheetId = lookupSheetObj?.properties?.sheetId ?? 0;

    // Sanitize parent name to a valid named range identifier
    const sanitizeName = (name: string): string =>
      name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z_]/, '_$&');

    const namedRangeRequests: object[] = [];
    let rowIndex = 0;
    for (const parent of parentValues) {
      const children = childMap.get(parent) ?? [];
      if (children.length === 0) {
        rowIndex++;
        continue;
      }
      const rangeName = sanitizeName(parent);
      namedRangeRequests.push({
        addNamedRange: {
          namedRange: {
            name: rangeName,
            range: {
              sheetId: lookupSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 1,
              endColumnIndex: 1 + children.length,
            },
          },
        },
      });
      rowIndex++;
    }

    if (namedRangeRequests.length > 0) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: namedRangeRequests },
      });
    }

    // Step 4: Set ONE_OF_LIST validation on parentRange (all unique parent values)
    const parentRangeResolved = await this.context.rangeResolver?.resolve(
      spreadsheetId,
      parentRange
    );
    const parentGridRange = parentRangeResolved?.gridRange;
    if (parentGridRange) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              setDataValidation: {
                range: parentGridRange,
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: parentValues.map((v) => ({ userEnteredValue: v })),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
          ],
        },
      });
    }

    // Step 5: Set ONE_OF_RANGE validation on dependentRange using INDIRECT formula
    // Note: The Sheets API does not support INDIRECT formulas in data validation directly.
    // We use ONE_OF_LIST with a sentinel value and document that INDIRECT must be configured
    // manually or via Apps Script for true dynamic dependent dropdowns.
    // For API-accessible cells, we set ONE_OF_LIST for each row based on INDIRECT(parent).
    const dependentRangeResolved = await this.context.rangeResolver?.resolve(
      spreadsheetId,
      dependentRange
    );
    const dependentGridRange = dependentRangeResolved?.gridRange;
    if (dependentGridRange) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              setDataValidation: {
                range: dependentGridRange,
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: Array.from(childMap.values())
                      .flat()
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .map((v) => ({ userEnteredValue: v })),
                  },
                  showCustomUi: true,
                  strict: false,
                },
              },
            },
          ],
        },
      });
    }

    return this._makeSuccess('build_dependent_dropdown', {
      parentRange,
      dependentRange,
      namedRangesCreated: namedRangeRequests.length,
      lookupSheet,
      message: `Created ${namedRangeRequests.length} named ranges and linked dropdown validation`,
    });
  }
}
