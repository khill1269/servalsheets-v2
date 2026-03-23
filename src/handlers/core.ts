/**
 * ServalSheets - Core Handler (Consolidated)
 *
 * Handles sheets_core tool (15 actions total):
 * - Spreadsheet operations (8): get, create, copy, update_properties, get_url, batch_get, get_comprehensive, list
 * - Sheet/tab operations (7): add_sheet, delete_sheet, duplicate_sheet, update_sheet, copy_sheet_to, list_sheets, get_sheet
 *
 * Consolidates legacy sheets_spreadsheet + sheets_sheet handlers
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4, drive_v3 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type {
  SheetsCoreInput,
  SheetsCoreOutput,
  SheetInfo,
  CoreResponse,
  CoreRequest,
  CoreGetInput,
  CoreCreateInput,
  CoreCopyInput,
  CoreUpdatePropertiesInput,
  CoreGetUrlInput,
  CoreBatchGetInput,
  CoreGetComprehensiveInput,
  CoreListInput,
  CoreAddSheetInput,
  CoreDeleteSheetInput,
  CoreDuplicateSheetInput,
  CoreUpdateSheetInput,
  CoreCopySheetToInput,
  CoreListSheetsInput,
  CoreGetSheetInput,
  CoreBatchDeleteSheetsInput,
  CoreBatchUpdateSheetsInput,
  CoreClearSheetInput,
  CoreMoveSheetInput,
  CoreDescribeWorkbookInput,
  CoreWorkbookFingerprintInput,
  ResponseMeta,
} from '../schemas/index.js';
import { ScopeValidator, IncrementalScopeRequiredError } from '../security/incremental-scope.js';
import {
  handleBatchDeleteSheetsAction,
  handleBatchUpdateSheetsAction,
  handleClearSheetAction,
  handleMoveSheetAction,
} from './core-actions/sheet-batch.js';
import {
  handleGetUrlAction,
  handleBatchGetAction,
  handleListAction,
} from './core-actions/spreadsheet-read.js';
import { handleGetComprehensiveAction } from './core-actions/comprehensive.js';
import {
  handleDescribeWorkbookAction,
  handleWorkbookFingerprintAction,
} from './core-actions/describe-workbook.js';
import {
  handleAddSheetAction,
  handleDeleteSheetAction,
  handleDuplicateSheetAction,
  handleUpdateSheetAction,
  handleCopySheetToAction,
  handleListSheetsAction,
  handleGetSheetAction,
} from './core-actions/sheet-ops.js';
import {
  handleGetAction,
  handleCreateAction,
  handleCopyAction,
  handleUpdatePropertiesAction,
} from './core-actions/spreadsheet-ops.js';

type ResponseFormat = 'full' | 'compact' | 'preview';

export class SheetsCoreHandler extends BaseHandler<SheetsCoreInput, SheetsCoreOutput> {
  private sheetsApi: sheets_v4.Sheets;
  private driveApi: drive_v3.Drive | undefined;

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets, driveApi?: drive_v3.Drive) {
    super('sheets_core', context);
    this.sheetsApi = sheetsApi;
    this.driveApi = driveApi;
  }

  /**
   * Validate scopes for an operation
   * Returns error response if scopes are insufficient, null if valid
   */
  private validateScopes(operation: string): SheetsCoreOutput | null {
    const validator = new ScopeValidator({
      scopes: this.context.auth?.scopes ?? [],
    });

    try {
      validator.validateOperation(operation);
      return null; // Scopes are valid
    } catch (error) {
      if (error instanceof IncrementalScopeRequiredError) {
        return {
          response: this.error({
            code: ErrorCodes.INCREMENTAL_SCOPE_REQUIRED,
            message: error.message,
            category: 'auth',
            retryable: true,
            retryStrategy: 'reauthorize',
            details: {
              operation: error.operation,
              requiredScopes: error.requiredScopes,
              currentScopes: error.currentScopes,
              missingScopes: error.missingScopes,
              authorizationUrl: error.authorizationUrl,
            },
          }),
        };
      }
      throw error; // Re-throw non-scope errors
    }
  }

  private getResponseFormatItemLimit(responseFormat: ResponseFormat): number | null {
    if (responseFormat === 'preview') {
      return 10;
    }
    if (responseFormat === 'compact') {
      return 50;
    }
    return null;
  }

  private shapeListByResponseFormat<T>(
    items: T[],
    responseFormat: ResponseFormat
  ): {
    items: T[];
    originalCount: number;
    returnedCount: number;
    truncated: boolean;
  } {
    const originalCount = items.length;
    const limit = this.getResponseFormatItemLimit(responseFormat);
    if (!limit) {
      return {
        items,
        originalCount,
        returnedCount: originalCount,
        truncated: false,
      };
    }

    const shapedItems = items.slice(0, limit);
    return {
      items: shapedItems,
      originalCount,
      returnedCount: shapedItems.length,
      truncated: originalCount > limit,
    };
  }

  private applyGetResponseFormat(
    responseData: Record<string, unknown>,
    responseFormat: ResponseFormat
  ): Record<string, unknown> {
    const spreadsheetRaw = responseData['spreadsheet'];
    if (!spreadsheetRaw || typeof spreadsheetRaw !== 'object') {
      return { ...responseData, responseFormat: responseFormat };
    }

    const spreadsheet = spreadsheetRaw as Record<string, unknown>;
    const sheets = Array.isArray(spreadsheet['sheets'])
      ? (spreadsheet['sheets'] as SheetInfo[])
      : ([] as SheetInfo[]);
    const shaped = this.shapeListByResponseFormat(sheets, responseFormat);

    const formatted: Record<string, unknown> = {
      ...responseData,
      spreadsheet: {
        ...spreadsheet,
        sheets: shaped.items,
      },
      responseFormat: responseFormat,
      totalSheets: shaped.originalCount,
      returnedSheets: shaped.returnedCount,
    };

    if (shaped.truncated) {
      formatted['truncated'] = true;
      formatted['_responseFormatHint'] =
        `response_format="${responseFormat}" returned ${shaped.returnedCount} of ${shaped.originalCount} sheets. ` +
        'Use response_format:"full" for complete sheet metadata.';
    }

    return formatted;
  }

  private applyBatchGetResponseFormat(
    responseData: Record<string, unknown>,
    responseFormat: ResponseFormat
  ): Record<string, unknown> {
    const spreadsheets = Array.isArray(responseData['spreadsheets'])
      ? (responseData['spreadsheets'] as Record<string, unknown>[])
      : ([] as Record<string, unknown>[]);
    const shaped = this.shapeListByResponseFormat(spreadsheets, responseFormat);

    const formatted: Record<string, unknown> = {
      ...responseData,
      spreadsheets: shaped.items,
      responseFormat: responseFormat,
      totalSpreadsheets: shaped.originalCount,
      returnedSpreadsheets: shaped.returnedCount,
    };

    if (shaped.truncated) {
      formatted['truncated'] = true;
      formatted['_responseFormatHint'] =
        `response_format="${responseFormat}" returned ${shaped.returnedCount} of ${shaped.originalCount} spreadsheets. ` +
        'Use response_format:"full" for complete batch metadata.';
    }

    return formatted;
  }

  private applyListResponseFormat(
    responseData: Record<string, unknown>,
    responseFormat: ResponseFormat
  ): Record<string, unknown> {
    const spreadsheets = Array.isArray(responseData['spreadsheets'])
      ? (responseData['spreadsheets'] as Record<string, unknown>[])
      : ([] as Record<string, unknown>[]);
    const shaped = this.shapeListByResponseFormat(spreadsheets, responseFormat);

    const formatted: Record<string, unknown> = {
      ...responseData,
      spreadsheets: shaped.items,
      responseFormat: responseFormat,
      totalSpreadsheets: shaped.originalCount,
      returnedSpreadsheets: shaped.returnedCount,
    };

    if (shaped.truncated) {
      formatted['truncated'] = true;
      formatted['_responseFormatHint'] =
        `response_format="${responseFormat}" returned ${shaped.returnedCount} of ${shaped.originalCount} spreadsheets. ` +
        'Use response_format:"full" for complete listing results.';
    }

    return formatted;
  }

  private applyListSheetsResponseFormat(
    responseData: Record<string, unknown>,
    responseFormat: ResponseFormat
  ): Record<string, unknown> {
    const sheets = Array.isArray(responseData['sheets'])
      ? (responseData['sheets'] as SheetInfo[])
      : ([] as SheetInfo[]);
    const shaped = this.shapeListByResponseFormat(sheets, responseFormat);

    const formatted: Record<string, unknown> = {
      ...responseData,
      sheets: shaped.items,
      responseFormat: responseFormat,
      totalSheets: shaped.originalCount,
      returnedSheets: shaped.returnedCount,
    };

    if (shaped.truncated) {
      formatted['truncated'] = true;
      formatted['_responseFormatHint'] =
        `response_format="${responseFormat}" returned ${shaped.returnedCount} of ${shaped.originalCount} sheets. ` +
        'Use response_format:"full" for complete sheet list.';
    }

    return formatted;
  }

  private buildResponseFormatMeta(
    action: string,
    responseData: Record<string, unknown>
  ): ResponseMeta {
    const baseMeta = this.generateMeta(action, responseData, responseData);
    if (responseData['truncated'] !== true) {
      return baseMeta;
    }

    return {
      ...baseMeta,
      truncated: true,
      continuationHint:
        typeof responseData['_responseFormatHint'] === 'string'
          ? responseData['_responseFormatHint']
          : 'Use response_format:"full" to retrieve complete data.',
    };
  }

  /**
   * Resolve Drive shortcut IDs to their target spreadsheet IDs.
   * Falls back to the original ID when Drive API is unavailable or lookup fails.
   */
  private async resolveSpreadsheetShortcutId(spreadsheetId: string): Promise<string> {
    if (!this.driveApi) {
      return spreadsheetId;
    }

    try {
      const file = await this.driveApi.files.get({
        fileId: spreadsheetId,
        fields: 'id,mimeType,shortcutDetails(targetId,targetMimeType)',
        supportsAllDrives: true,
      });

      const mimeType = file.data.mimeType;
      const targetId = file.data.shortcutDetails?.targetId;
      const targetMimeType = file.data.shortcutDetails?.targetMimeType;

      if (
        mimeType === 'application/vnd.google-apps.shortcut' &&
        targetId &&
        (!targetMimeType || targetMimeType === 'application/vnd.google-apps.spreadsheet')
      ) {
        this.context.logger?.info?.('Resolved spreadsheet shortcut ID', {
          shortcutId: spreadsheetId,
          targetSpreadsheetId: targetId,
        });
        return targetId;
      }
    } catch (error) {
      this.context.logger?.warn?.('Shortcut resolution skipped due Drive lookup failure', {
        spreadsheetId,
        error: String(error),
      });
    }

    return spreadsheetId;
  }

  async handle(input: SheetsCoreInput): Promise<SheetsCoreOutput> {
    // Extract the request from the wrapper
    const rawReq = unwrapRequest<SheetsCoreInput['request']>(input);
    this.requireAuth();

    // Track spreadsheet ID for better error messages
    const spreadsheetId = 'spreadsheetId' in rawReq ? rawReq.spreadsheetId : undefined;
    this.trackSpreadsheetId(spreadsheetId);

    try {
      // Infer missing parameters from context
      let req = this.inferRequestParameters(rawReq) as CoreRequest;

      if ('spreadsheetId' in req && typeof req.spreadsheetId === 'string') {
        const resolvedSpreadsheetId = await this.resolveSpreadsheetShortcutId(req.spreadsheetId);
        if (resolvedSpreadsheetId !== req.spreadsheetId) {
          req = { ...req, spreadsheetId: resolvedSpreadsheetId } as CoreRequest;
        }
      }

      // Phase 0: Validate scopes for the operation
      const operation = `sheets_core.${req.action}`;
      const scopeError = this.validateScopes(operation);
      if (scopeError) {
        return scopeError;
      }

      // Set verbosity early to skip metadata generation for minimal mode (saves ~400-800 tokens)
      const verbosity = req.verbosity ?? 'standard';
      this.setVerbosity(verbosity);

      const spreadsheetOpsDeps = {
        sheetsApi: this.sheetsApi,
        driveApi: this.driveApi,
        context: this.context,
        deduplicatedApiCall: <T>(key: string, apiCall: () => Promise<T>) =>
          this.deduplicatedApiCall(key, apiCall),
        convertTabColor: (
          tabColor: sheets_v4.Schema$Color | null | undefined,
          tabColorStyle?: sheets_v4.Schema$ColorStyle | null | undefined
        ) => this.convertTabColor(tabColor, tabColorStyle),
        applyGetResponseFormat: (
          responseData: Record<string, unknown>,
          responseFormat: ResponseFormat
        ) => this.applyGetResponseFormat(responseData, responseFormat),
        buildResponseFormatMeta: (action: string, responseData: Record<string, unknown>) =>
          this.buildResponseFormatMeta(action, responseData),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
        mapError: (error: unknown) => this.mapError(error),
      } satisfies Parameters<typeof handleGetAction>[1];

      const spreadsheetReadDeps = {
        sheetsApi: this.sheetsApi,
        driveApi: this.driveApi,
        context: this.context,
        sendProgress: (current: number, total: number, message?: string) =>
          this.sendProgress(current, total, message),
        resolveSpreadsheetShortcutId: (spreadsheetId: string) =>
          this.resolveSpreadsheetShortcutId(spreadsheetId),
        applyBatchGetResponseFormat: (
          responseData: Record<string, unknown>,
          responseFormat: ResponseFormat
        ) => this.applyBatchGetResponseFormat(responseData, responseFormat),
        applyListResponseFormat: (
          responseData: Record<string, unknown>,
          responseFormat: ResponseFormat
        ) => this.applyListResponseFormat(responseData, responseFormat),
        buildResponseFormatMeta: (action: string, responseData: Record<string, unknown>) =>
          this.buildResponseFormatMeta(action, responseData),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
        mapError: (error: unknown) => this.mapError(error),
      } satisfies Parameters<typeof handleGetUrlAction>[1];

      const comprehensiveDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        sendProgress: (current: number, total: number, message?: string) =>
          this.sendProgress(current, total, message),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleGetComprehensiveAction>[1];

      const sheetOpsDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        convertTabColor: (
          tabColor: sheets_v4.Schema$Color | null | undefined,
          tabColorStyle?: sheets_v4.Schema$ColorStyle | null | undefined
        ) => this.convertTabColor(tabColor, tabColorStyle),
        deduplicatedApiCall: <T>(key: string, apiCall: () => Promise<T>) =>
          this.deduplicatedApiCall(key, apiCall),
        applyListSheetsResponseFormat: (
          responseData: Record<string, unknown>,
          responseFormat: ResponseFormat
        ) => this.applyListSheetsResponseFormat(responseData, responseFormat),
        buildResponseFormatMeta: (action: string, responseData: Record<string, unknown>) =>
          this.buildResponseFormatMeta(action, responseData),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleAddSheetAction>[1];

      const sheetBatchDeps = {
        sheetsApi: this.sheetsApi,
        context: this.context,
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleBatchDeleteSheetsAction>[1];

      let response: CoreResponse;
      // Cast to string to allow handler-level aliases (rename_sheet, hide_sheet, etc.)
      // These aliases are intentionally more permissive than the schema
      switch (req.action as string) {
        // Spreadsheet actions (8)
        case 'get':
          response = await handleGetAction(req as CoreGetInput, spreadsheetOpsDeps);
          break;
        case 'create':
          response = await handleCreateAction(req as CoreCreateInput, spreadsheetOpsDeps);
          break;
        case 'copy':
          response = await handleCopyAction(req as CoreCopyInput, spreadsheetOpsDeps);
          break;
        case 'update_properties':
          response = await handleUpdatePropertiesAction(
            req as CoreUpdatePropertiesInput,
            spreadsheetOpsDeps
          );
          break;
        case 'get_url':
          response = await handleGetUrlAction(req as CoreGetUrlInput, spreadsheetReadDeps);
          break;
        case 'batch_get':
          response = await handleBatchGetAction(req as CoreBatchGetInput, spreadsheetReadDeps);
          break;
        case 'get_comprehensive':
          response = await handleGetComprehensiveAction(
            req as CoreGetComprehensiveInput,
            comprehensiveDeps
          );
          break;
        case 'describe_workbook':
          response = await handleDescribeWorkbookAction(req as CoreDescribeWorkbookInput, {
            sheetsApi: this.sheetsApi,
            driveApi: this.driveApi,
            success: this.success.bind(this),
            mapError: this.mapError.bind(this),
            error: this.error.bind(this),
          });
          break;
        case 'workbook_fingerprint':
          response = await handleWorkbookFingerprintAction(req as CoreWorkbookFingerprintInput, {
            sheetsApi: this.sheetsApi,
            success: this.success.bind(this),
            mapError: this.mapError.bind(this),
            error: this.error.bind(this),
          });
          break;
        case 'list':
          response = await handleListAction(req as CoreListInput, spreadsheetReadDeps);
          break;

        // Sheet/tab actions (7)
        case 'add_sheet':
          response = await handleAddSheetAction(req as CoreAddSheetInput, sheetOpsDeps);
          break;
        case 'delete_sheet':
          response = await handleDeleteSheetAction(req as CoreDeleteSheetInput, sheetOpsDeps);
          break;
        case 'duplicate_sheet':
          response = await handleDuplicateSheetAction(req as CoreDuplicateSheetInput, sheetOpsDeps);
          break;
        case 'update_sheet':
          response = await handleUpdateSheetAction(req as CoreUpdateSheetInput, sheetOpsDeps);
          break;
        case 'copy_sheet_to':
          response = await handleCopySheetToAction(req as CoreCopySheetToInput, sheetOpsDeps);
          break;
        case 'list_sheets':
          response = await handleListSheetsAction(req as CoreListSheetsInput, sheetOpsDeps);
          break;
        case 'get_sheet':
          response = await handleGetSheetAction(req as CoreGetSheetInput, sheetOpsDeps);
          break;

        // Batch operations (Issue #2 fix - efficient multi-sheet operations)
        case 'batch_delete_sheets':
          response = await handleBatchDeleteSheetsAction(
            req as CoreBatchDeleteSheetsInput,
            sheetBatchDeps
          );
          break;
        case 'batch_update_sheets':
          response = await handleBatchUpdateSheetsAction(
            req as CoreBatchUpdateSheetsInput,
            sheetBatchDeps
          );
          break;

        // New actions (Issue fix - missing functionality)
        case 'clear_sheet':
          response = await handleClearSheetAction(req as CoreClearSheetInput, sheetBatchDeps);
          break;
        case 'move_sheet':
          response = await handleMoveSheetAction(req as CoreMoveSheetInput, sheetBatchDeps);
          break;

        // ACTION ALIASES - Common variations that map to existing actions
        // These prevent "Unknown action" errors when LLMs guess action names
        case 'rename_sheet':
          // Alias for update_sheet - just changes title
          response = await handleUpdateSheetAction(req as CoreUpdateSheetInput, sheetOpsDeps);
          break;
        case 'hide_sheet':
          // Alias for update_sheet with hidden:true
          response = await handleUpdateSheetAction(
            { ...req, hidden: true } as CoreUpdateSheetInput,
            sheetOpsDeps
          );
          break;
        case 'show_sheet':
        case 'unhide_sheet':
          // Alias for update_sheet with hidden:false
          response = await handleUpdateSheetAction(
            { ...req, hidden: false } as CoreUpdateSheetInput,
            sheetOpsDeps
          );
          break;
        case 'copy_to':
          // Alias for copy_sheet_to
          response = await handleCopySheetToAction(req as CoreCopySheetToInput, sheetOpsDeps);
          break;
        case 'update_sheet_properties':
          // Alias for update_properties (spreadsheet-level)
          response = await handleUpdatePropertiesAction(
            req as CoreUpdatePropertiesInput,
            spreadsheetOpsDeps
          );
          break;

        default: {
          // Note: exhaustiveness check skipped — switch uses `req.action as string`
          // to support handler-level aliases (rename_sheet, hide_sheet, etc.)
          response = this.error({
            code: ErrorCodes.INVALID_PARAMS,
            message: `Unknown action: ${(req as { action: string }).action}. Available actions: get, create, copy, update_properties, get_url, batch_get, get_comprehensive, list, add_sheet, delete_sheet, duplicate_sheet, update_sheet, copy_sheet_to, list_sheets, get_sheet, clear_sheet, move_sheet, batch_delete_sheets, batch_update_sheets`,
            retryable: false,
            suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
          });
        }
      }

      // Track context after successful operation
      if (response.success && 'spreadsheetId' in req) {
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

      // Apply verbosity filtering (LLM optimization) - verbosity already set earlier
      const filteredResponse = this.applyCoreVerbosityFilter(response, verbosity);

      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  /**
   * Apply verbosity filtering with core-specific customization
   * Uses base handler's applyVerbosityFilter and adds spreadsheet-specific logic
   */
  private applyCoreVerbosityFilter(
    response: CoreResponse,
    verbosity: 'minimal' | 'standard' | 'detailed' = 'standard'
  ): CoreResponse {
    // Use base handler's filtering first
    const baseFiltered = super.applyVerbosityFilter(response, verbosity) as CoreResponse;

    // Add core-specific filtering for minimal verbosity
    if (verbosity === 'minimal' && baseFiltered.success) {
      const filtered = { ...baseFiltered };

      // If response has spreadsheet data, minimize it further
      if ('spreadsheet' in filtered && filtered.spreadsheet?.sheets) {
        filtered.spreadsheet = {
          spreadsheetId: filtered.spreadsheet.spreadsheetId,
          title: filtered.spreadsheet.title,
          sheets: filtered.spreadsheet.sheets.map((s: SheetInfo) => ({
            sheetId: s.sheetId,
            title: s.title,
            rowCount: s.rowCount,
            columnCount: s.columnCount,
            // Omit: index, hidden, tabColor
          })) as SheetInfo[],
          // Omit: url, locale, timeZone
        };
      }

      return filtered;
    }

    return baseFiltered;
  }

  protected createIntents(input: SheetsCoreInput): Intent[] {
    // Extract the request from the wrapper
    const req = unwrapRequest<SheetsCoreInput['request']>(input);
    // Create intents for batch compiler
    switch (req.action) {
      // Spreadsheet intents
      case 'update_properties':
        if (req.spreadsheetId) {
          return [
            {
              type: 'UPDATE_SHEET_PROPERTIES',
              target: { spreadsheetId: req.spreadsheetId },
              payload: {
                title: req.title,
                locale: req.locale,
                timeZone: req.timeZone,
                autoRecalc: req.autoRecalc,
              },
              metadata: {
                sourceTool: this.toolName,
                sourceAction: 'update_properties',
                priority: 1,
                destructive: false,
              },
            },
          ];
        }
        break;

      // Sheet/tab intents
      case 'add_sheet':
        return [
          {
            type: 'ADD_SHEET',
            target: { spreadsheetId: req.spreadsheetId! },
            payload: { title: req.title },
            metadata: {
              sourceTool: this.toolName,
              sourceAction: 'add_sheet',
              priority: 1,
              destructive: false,
            },
          },
        ];
      case 'delete_sheet':
        return [
          {
            type: 'DELETE_SHEET',
            target: {
              spreadsheetId: req.spreadsheetId!,
              sheetId: req.sheetId!,
            },
            payload: {},
            metadata: {
              sourceTool: this.toolName,
              sourceAction: 'delete_sheet',
              priority: 1,
              destructive: true,
            },
          },
        ];
      case 'duplicate_sheet':
        return [
          {
            type: 'DUPLICATE_SHEET',
            target: {
              spreadsheetId: req.spreadsheetId!,
              sheetId: req.sheetId!,
            },
            payload: { newTitle: req.newTitle },
            metadata: {
              sourceTool: this.toolName,
              sourceAction: 'duplicate_sheet',
              priority: 1,
              destructive: false,
            },
          },
        ];
      case 'update_sheet':
        return [
          {
            type: 'UPDATE_SHEET_PROPERTIES',
            target: {
              spreadsheetId: req.spreadsheetId!,
              sheetId: req.sheetId!,
            },
            payload: { title: req.title, hidden: req.hidden },
            metadata: {
              sourceTool: this.toolName,
              sourceAction: 'update_sheet',
              priority: 1,
              destructive: false,
            },
          },
        ];
    }
    return [];
  }

  // ===================================================================
  // HELPER METHODS
  // ===================================================================

  /**
   * Convert Google API tab color to our schema format
   */
  private convertTabColor(
    tabColor: sheets_v4.Schema$Color | null | undefined,
    tabColorStyle?: sheets_v4.Schema$ColorStyle | null | undefined
  ): SheetInfo['tabColor'] {
    // Prefer tabColorStyle.rgbColor (non-deprecated) over tabColor (deprecated)
    const color = tabColorStyle?.rgbColor ?? tabColor;
    // OK: Explicit empty - tab color is optional, undefined means no color set
    if (!color) return undefined;
    return {
      red: color.red ?? 0,
      green: color.green ?? 0,
      blue: color.blue ?? 0,
      alpha: color.alpha ?? 1,
    };
  }
}
