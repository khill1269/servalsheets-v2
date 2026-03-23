/**
 * ServalSheets - Composite Operations Handler
 *
 * Handles high-level composite operations
 * 14 Actions:
 * - Original (7): import_csv, smart_append, bulk_update, deduplicate, export_xlsx, import_xlsx, get_form_responses
 * - LLM-Optimized Workflows (3): setup_sheet, import_and_format, clone_structure
 * - NL Sheet Generator (3): generate_sheet, generate_template, preview_generation
 *
 * MCP Protocol: 2025-11-25
 * Google Sheets API: v4
 *
 * @module handlers/composite
 */

import { ErrorCodes } from './error-codes.js';
import { assertNever } from '../utils/type-utils.js';
import type { sheets_v4, drive_v3 } from 'googleapis';
import { BaseHandler, type HandlerContext, type HandlerError, unwrapRequest } from './base.js';
import { getRequestAbortSignal } from '../utils/request-context.js';
import {
  CompositeOperationsService,
  type CsvImportResult,
  type SmartAppendResult,
  type BulkUpdateResult,
  type DeduplicateResult,
} from '../services/composite-operations.js';
import { SheetResolver, initializeSheetResolver } from '../services/sheet-resolver.js';
import type {
  CompositeInput,
  CompositeOutput,
  CompositeImportCsvInput,
  CompositeSmartAppendInput,
  CompositeBulkUpdateInput,
  CompositeDeduplicateInput,
  CompositeExportXlsxInput,
  CompositeImportXlsxInput,
  CompositeGetFormResponsesInput,
  // LLM-optimized workflow types
  CompositeSetupSheetInput,
  CompositeImportAndFormatInput,
  CompositeCloneStructureInput,
  // Streaming types
  CompositeExportLargeDatasetInput,
  // NL Sheet Generator types
  CompositeGenerateSheetInput,
  CompositeGenerateTemplateInput,
  CompositePreviewGenerationInput,
  // P14-C1 Composite Workflow types
  CompositeAuditSheetInput,
  CompositePublishReportInput,
  CompositeDataPipelineInput,
  CompositeInstantiateTemplateInput,
  CompositeMigrateSpreadsheetInput,
  // Orchestration types
  CompositeBatchOperationsInput,
  // Dashboard types
  CompositeBuildDashboardInput,
} from '../schemas/composite.js';
import type { Intent } from '../core/intent.js';
import { getRequestLogger, sendProgress } from '../utils/request-context.js';
import { confirmDestructiveAction } from '../mcp/elicitation.js';
import { getEnv } from '../config/env.js';
import { withTimeout } from '../utils/timeout.js';
import { createSnapshotIfNeeded } from '../utils/safety-helpers.js';
import { ScopeValidator, IncrementalScopeRequiredError } from '../security/incremental-scope.js';
import {
  handleGenerateSheetAction,
  handleGenerateTemplateAction,
  handlePreviewGenerationAction,
} from './composite-actions/generation.js';
import {
  handleExportXlsxAction,
  handleImportXlsxAction,
  handleGetFormResponsesAction,
} from './composite-actions/import-export.js';
import {
  handleSetupSheetAction,
  handleImportAndFormatAction,
  handleCloneStructureAction,
} from './composite-actions/structure.js';
import {
  handleAuditSheetAction,
  handlePublishReportAction,
  handleDataPipelineAction,
  handleInstantiateTemplateAction,
  handleMigrateSpreadsheetAction,
} from './composite-actions/workflow.js';
import { handleBatchOperationsAction } from './composite-actions/batch.js';
import { handleExportLargeDatasetAction } from './composite-actions/streaming.js';
import { ensureRetriableGoogleApi } from '../utils/google-api-retry-wrapper.js';

// ============================================================================
// Handler
// ============================================================================

/**
 * Composite Operations Handler
 *
 * Provides high-level operations that combine multiple API calls.
 */
export class CompositeHandler extends BaseHandler<CompositeInput, CompositeOutput> {
  private sheetsApi: sheets_v4.Sheets;
  private driveApi: drive_v3.Drive | undefined;
  private compositeService: CompositeOperationsService;
  private sheetResolver: SheetResolver;

  constructor(context: HandlerContext, sheetsApi: sheets_v4.Sheets, driveApi?: drive_v3.Drive) {
    super('sheets_composite', context);
    this.sheetsApi = ensureRetriableGoogleApi(sheetsApi) as sheets_v4.Sheets;
    this.driveApi = ensureRetriableGoogleApi(driveApi) as drive_v3.Drive | undefined;

    // Initialize sheet resolver
    this.sheetResolver = initializeSheetResolver(this.sheetsApi);

    // Initialize composite operations service
    this.compositeService = new CompositeOperationsService(this.sheetsApi, this.sheetResolver);
  }

  /**
   * Validate scopes for an operation
   * Returns error response if scopes are insufficient, null if valid
   */
  private validateScopes(operation: string): CompositeOutput | null {
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

  async handle(input: CompositeInput): Promise<CompositeOutput> {
    const req = unwrapRequest<CompositeInput['request']>(input);
    const logger = getRequestLogger();
    // Track spreadsheetId if present (import_xlsx creates a new spreadsheet, so it doesn't have one)
    if ('spreadsheetId' in req) {
      this.trackSpreadsheetId(req.spreadsheetId);
    }

    // Phase 0: Validate scopes for the operation
    const operation = `sheets_composite.${req.action}`;
    const scopeError = this.validateScopes(operation);
    if (scopeError) {
      return scopeError;
    }

    try {
      let response: CompositeOutput['response'];
      const requestAbortSignal = getRequestAbortSignal() ?? this.context.abortSignal;

      switch (req.action) {
        case 'import_csv':
          response = await this.handleImportCsv(req as CompositeImportCsvInput);
          break;
        case 'smart_append':
          response = await this.handleSmartAppend(req as CompositeSmartAppendInput);
          break;
        case 'bulk_update':
          response = await this.handleBulkUpdate(req as CompositeBulkUpdateInput);
          break;
        case 'deduplicate':
          response = await this.handleDeduplicate(req as CompositeDeduplicateInput);
          break;
        case 'export_xlsx':
          response = await handleExportXlsxAction(req as CompositeExportXlsxInput, {
            sheetsApi: this.sheetsApi,
            driveApi: this.driveApi,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
            error: (error) => this.error(error),
          });
          break;
        case 'import_xlsx':
          response = await handleImportXlsxAction(req as CompositeImportXlsxInput, {
            sheetsApi: this.sheetsApi,
            driveApi: this.driveApi,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
            error: (error) => this.error(error),
          });
          break;
        case 'get_form_responses':
          response = await handleGetFormResponsesAction(req as CompositeGetFormResponsesInput, {
            sheetsApi: this.sheetsApi,
            driveApi: this.driveApi,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
            error: (error) => this.error(error),
          });
          break;
        // LLM-optimized workflow actions (3)
        case 'setup_sheet':
          response = await handleSetupSheetAction(req as CompositeSetupSheetInput, {
            sheetsApi: this.sheetsApi,
            invalidateSheetCache: (spreadsheetId) =>
              this.context.sheetResolver?.invalidate(spreadsheetId),
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'import_and_format':
          response = await handleImportAndFormatAction(req as CompositeImportAndFormatInput, {
            sheetsApi: this.sheetsApi,
            compositeService: this.compositeService,
            invalidateSheetCache: (spreadsheetId) =>
              this.context.sheetResolver?.invalidate(spreadsheetId),
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'clone_structure':
          response = await handleCloneStructureAction(req as CompositeCloneStructureInput, {
            sheetsApi: this.sheetsApi,
            sheetResolver: this.sheetResolver,
            invalidateSheetCache: (spreadsheetId) =>
              this.context.sheetResolver?.invalidate(spreadsheetId),
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'export_large_dataset':
          response = await handleExportLargeDatasetAction(req as CompositeExportLargeDatasetInput, {
            sheetsApi: this.sheetsApi,
            taskStore: this.context.taskStore,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
            mapError: (error) => this.mapError(error),
          });
          break;
        case 'generate_sheet':
          response = await handleGenerateSheetAction(req as CompositeGenerateSheetInput, {
            sheetsApi: this.sheetsApi,
            samplingServer: this.context.samplingServer,
            abortSignal: requestAbortSignal,
          });
          break;
        case 'generate_template':
          response = await handleGenerateTemplateAction(req as CompositeGenerateTemplateInput, {
            sheetsApi: this.sheetsApi,
            samplingServer: this.context.samplingServer,
            abortSignal: requestAbortSignal,
          });
          break;
        case 'preview_generation':
          response = await handlePreviewGenerationAction(req as CompositePreviewGenerationInput, {
            sheetsApi: this.sheetsApi,
            samplingServer: this.context.samplingServer,
            abortSignal: requestAbortSignal,
          });
          break;
        // P14-C1 Composite Workflow actions (5)
        case 'audit_sheet':
          response = await handleAuditSheetAction(req as CompositeAuditSheetInput, {
            sheetsApi: this.sheetsApi,
            samplingServer: this.context.samplingServer,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'publish_report':
          response = await handlePublishReportAction(req as CompositePublishReportInput, {
            sheetsApi: this.sheetsApi,
            driveApi: this.driveApi,
            samplingServer: this.context.samplingServer,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'data_pipeline':
          response = await handleDataPipelineAction(req as CompositeDataPipelineInput, {
            sheetsApi: this.sheetsApi,
            samplingServer: this.context.samplingServer,
            snapshotService: this.context.snapshotService,
            sessionContext: this.context.sessionContext,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'instantiate_template':
          response = await handleInstantiateTemplateAction(
            req as CompositeInstantiateTemplateInput,
            {
              sheetsApi: this.sheetsApi,
              snapshotService: this.context.snapshotService,
              sessionContext: this.context.sessionContext,
              generateMeta: (action, i, output, options) =>
                this.generateMeta(action, i, output, options),
            }
          );
          break;
        case 'migrate_spreadsheet':
          response = await handleMigrateSpreadsheetAction(req as CompositeMigrateSpreadsheetInput, {
            sheetsApi: this.sheetsApi,
            snapshotService: this.context.snapshotService,
            sessionContext: this.context.sessionContext,
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'batch_operations':
          response = await handleBatchOperationsAction(req as CompositeBatchOperationsInput, {
            context: this.context,
            sheetsApi: this.sheetsApi,
            driveApi: this.driveApi,
            sendProgress: (current: number, total: number, message?: string) =>
              this.sendProgress(current, total, message),
            generateMeta: (action, i, output, options) =>
              this.generateMeta(action, i, output, options),
          });
          break;
        case 'build_dashboard':
          response = await this.handleBuildDashboard(req as CompositeBuildDashboardInput);
          break;
        default:
          assertNever(req);
      }

      // Track context (skip for import_xlsx which creates a new spreadsheet)
      if ('spreadsheetId' in req) {
        this.trackContextFromRequest({
          spreadsheetId: req.spreadsheetId,
        });
      }

      // Apply verbosity filtering - all actions now have verbosity field
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = super.applyVerbosityFilter(
        response,
        verbosity
      ) as CompositeOutput['response'];

      return { response: filteredResponse };
    } catch (error) {
      logger.error('Composite operation failed', {
        action: req.action,
        error: error instanceof Error ? error.message : String(error),
      });
      return { response: this.mapError(error) as HandlerError };
    }
  }

  protected createIntents(_input: CompositeInput): Intent[] {
    // Composite operations use services directly, not intents
    return [];
  }

  // ==========================================================================
  // Action Handlers
  // ==========================================================================

  private async handleImportCsv(
    input: CompositeImportCsvInput
  ): Promise<CompositeOutput['response']> {
    let resolvedInput = input;
    const legacySheetName =
      typeof (input as { sheetName?: unknown }).sheetName === 'string'
        ? ((input as { sheetName?: string }).sheetName ?? '').trim()
        : '';

    if (
      legacySheetName.length > 0 &&
      resolvedInput.sheet === undefined &&
      resolvedInput.newSheetName === undefined
    ) {
      resolvedInput = {
        ...resolvedInput,
        newSheetName: legacySheetName,
      };
    }

    // Wizard: If csvData is provided but delimiter is missing, elicit delimiter
    if (resolvedInput.csvData && !resolvedInput.delimiter && this.context?.server?.elicitInput) {
      try {
        const wizard = await this.context.server.elicitInput({
          message: 'CSV data detected. What delimiter separates fields?',
          requestedSchema: {
            type: 'object',
            properties: {
              delimiter: {
                type: 'string',
                title: 'CSV delimiter',
                description: 'Character separating fields (comma, semicolon, tab, or pipe)',
                enum: [',', ';', '\t', '|'],
              },
            },
          },
        });
        const wizardContent = wizard?.content as Record<string, unknown> | undefined;
        const delimiter =
          typeof wizardContent?.['delimiter'] === 'string' ? wizardContent['delimiter'] : undefined;
        if (wizard?.action === 'accept' && delimiter) {
          resolvedInput = { ...resolvedInput, delimiter };
        }
      } catch {
        // Elicitation not available — continue with default comma delimiter
        if (!resolvedInput.delimiter) {
          resolvedInput = { ...resolvedInput, delimiter: ',' };
        }
      }
    }

    // BUG-025 FIX: CSV imports can take >30s on large files (>10K rows)
    // This operation processes large amounts of data and naturally exceeds MCP's 30s timeout
    // For long-running imports, set COMPOSITE_TIMEOUT_MS env var to extend timeout
    // Default is 120 seconds (2 minutes) which handles most CSV imports
    // Send progress notification for long-running import
    const env = getEnv();
    if (env.ENABLE_GRANULAR_PROGRESS) {
      await sendProgress(0, 2, 'Starting CSV import...');
    }

    const result: CsvImportResult = await withTimeout(
      () =>
        this.compositeService.importCsv({
          spreadsheetId: resolvedInput.spreadsheetId,
          sheet:
            resolvedInput.sheet !== undefined
              ? typeof resolvedInput.sheet === 'string'
                ? resolvedInput.sheet
                : resolvedInput.sheet
              : undefined,
          csvData: resolvedInput.csvData,
          delimiter: resolvedInput.delimiter ?? ',',
          hasHeader: resolvedInput.hasHeader,
          mode: resolvedInput.mode,
          newSheetName: resolvedInput.newSheetName,
          skipEmptyRows: resolvedInput.skipEmptyRows,
          trimValues: resolvedInput.trimValues,
        }),
      env.COMPOSITE_TIMEOUT_MS,
      'import_csv'
    );

    const cellsAffected = result.rowsImported * result.columnsImported;

    if (env.ENABLE_GRANULAR_PROGRESS) {
      await sendProgress(2, 2, `Imported ${result.rowsImported} rows`);
    }

    // Fix: Invalidate sheet cache after CSV import (may create new sheet)
    this.context.sheetResolver?.invalidate(resolvedInput.spreadsheetId);

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_composite',
          action: 'import_csv',
          spreadsheetId: resolvedInput.spreadsheetId,
          description: `Imported CSV: ${result.rowsImported} rows, ${result.columnsImported} columns`,
          undoable: false,
          cellsAffected,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('import_csv', {
      ...result,
      mutation: {
        cellsAffected,
        reversible: false,
      },
    });
  }

  private async handleSmartAppend(
    input: CompositeSmartAppendInput
  ): Promise<CompositeOutput['response']> {
    const result: SmartAppendResult = await this.compositeService.smartAppend({
      spreadsheetId: input.spreadsheetId,
      sheet: input.sheet,
      data: input.data,
      matchHeaders: input.matchHeaders,
      createMissingColumns: input.createMissingColumns,
      skipEmptyRows: input.skipEmptyRows,
    });

    const cellsAffected = result.rowsAppended * result.columnsMatched.length;

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_composite',
          action: 'smart_append',
          spreadsheetId: input.spreadsheetId,
          description: `Smart-appended ${result.rowsAppended} rows (${result.columnsMatched.length} columns matched)`,
          undoable: false,
          cellsAffected,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return this.success('smart_append', {
      ...result,
      mutation: {
        cellsAffected,
        reversible: false,
      },
    });
  }

  private async handleBulkUpdate(
    input: CompositeBulkUpdateInput
  ): Promise<CompositeOutput['response']> {
    // Safety check: dry-run mode
    if (input.safety?.dryRun) {
      return {
        success: true as const,
        action: 'bulk_update' as const,
        rowsUpdated: 0,
        rowsCreated: 0,
        keysNotFound: [],
        cellsModified: 0,
        mutation: {
          cellsAffected: 0,
          reversible: false,
        },
        _meta: this.generateMeta(
          'bulk_update',
          input as unknown as Record<string, unknown>,
          {} as Record<string, unknown>,
          { cellsAffected: 0 }
        ),
      };
    }

    // Request confirmation if elicitation available and large update
    const estimatedUpdates = input.updates.length;
    if (estimatedUpdates > 10 && this.context.elicitationServer) {
      const confirmation = await confirmDestructiveAction(
        this.context.elicitationServer,
        'bulk_update',
        `Perform bulk update of ${estimatedUpdates} records in spreadsheet ${input.spreadsheetId}. This will modify multiple cells based on key column matches. This action cannot be easily undone.`
      );

      if (!confirmation.confirmed) {
        return {
          success: false,
          error: {
            code: ErrorCodes.PRECONDITION_FAILED,
            message: confirmation.reason || 'User cancelled the operation',
            retryable: false,
          },
        } as CompositeOutput['response'];
      }
    }

    // Create snapshot if requested
    const snapshot = await createSnapshotIfNeeded(
      this.context.snapshotService,
      {
        operationType: 'bulk_update',
        isDestructive: true,
        spreadsheetId: input.spreadsheetId,
        affectedCells: estimatedUpdates * Object.keys(input.updates[0] || {}).length,
      },
      input.safety
    );

    // BUG-022 FIX: Wrap service call in try-catch and map Google API errors
    let result: BulkUpdateResult;
    try {
      result = await this.compositeService.bulkUpdate({
        spreadsheetId: input.spreadsheetId,
        sheet: input.sheet,
        keyColumn: input.keyColumn,
        updates: input.updates,
        createUnmatched: input.createUnmatched,
      });
    } catch (err) {
      // ISSUE-184: Log operation context so callers can identify which update set failed
      const requestLogger = getRequestLogger();
      requestLogger.error('bulk_update failed', {
        spreadsheetId: input.spreadsheetId,
        sheet: input.sheet,
        keyColumn: input.keyColumn,
        updateCount: input.updates.length,
      });
      return this.mapError(err);
    }

    return {
      success: true as const,
      action: 'bulk_update' as const,
      ...result,
      mutation: {
        cellsAffected: result.cellsModified,
        reversible: false,
      },
      snapshotId: snapshot?.snapshotId,
      _meta: this.generateMeta(
        'bulk_update',
        input as unknown as Record<string, unknown>,
        result as unknown as Record<string, unknown>,
        {
          cellsAffected: result.cellsModified,
        }
      ),
    };
  }

  private async handleDeduplicate(
    input: CompositeDeduplicateInput
  ): Promise<CompositeOutput['response']> {
    let resolvedInput = input;

    // Wizard: If range is provided but keyColumns is missing, elicit key column
    if (
      resolvedInput.sheet &&
      (!resolvedInput.keyColumns || resolvedInput.keyColumns.length === 0)
    ) {
      if (this.context?.server?.elicitInput) {
        try {
          const wizard = await this.context.server.elicitInput({
            message: 'Which column(s) identify duplicates? (Column letter like A, or header name)',
            requestedSchema: {
              type: 'object',
              properties: {
                keyColumn: {
                  type: 'string',
                  title: 'Key column',
                  description: 'Column letter (A, B, C...) or header name (Email, ID, Name...)',
                },
              },
            },
          });
          const wizardContent = wizard?.content as Record<string, unknown> | undefined;
          const keyColumn =
            typeof wizardContent?.['keyColumn'] === 'string'
              ? wizardContent['keyColumn']
              : undefined;
          if (wizard?.action === 'accept' && keyColumn) {
            resolvedInput = {
              ...resolvedInput,
              keyColumns: [keyColumn],
            };
          }
        } catch {
          // Elicitation not available — continue without specific key columns
        }
      }
    }

    // Safety check: preview mode (dry-run equivalent)
    if (resolvedInput.preview) {
      const result: DeduplicateResult = await this.compositeService.deduplicate({
        spreadsheetId: resolvedInput.spreadsheetId,
        sheet: resolvedInput.sheet,
        keyColumns: resolvedInput.keyColumns,
        keep: resolvedInput.keep,
        preview: true,
      });

      return {
        success: true as const,
        action: 'deduplicate' as const,
        ...result,
        mutation:
          result.rowsDeleted > 0
            ? {
                cellsAffected: result.rowsDeleted,
                reversible: false,
              }
            : undefined,
        _meta: this.generateMeta(
          'deduplicate',
          resolvedInput as unknown as Record<string, unknown>,
          result as unknown as Record<string, unknown>,
          { cellsAffected: result.rowsDeleted }
        ),
      };
    }

    // Safety check: dry-run mode
    if (resolvedInput.safety?.dryRun) {
      return {
        success: true as const,
        action: 'deduplicate' as const,
        totalRows: 0,
        uniqueRows: 0,
        duplicatesFound: 0,
        rowsDeleted: 0,
        _meta: this.generateMeta(
          'deduplicate',
          resolvedInput as unknown as Record<string, unknown>,
          {} as Record<string, unknown>,
          { cellsAffected: 0 }
        ),
      };
    }

    // First run in preview mode to get count
    const previewResult: DeduplicateResult = await this.compositeService.deduplicate({
      spreadsheetId: resolvedInput.spreadsheetId,
      sheet: resolvedInput.sheet,
      keyColumns: resolvedInput.keyColumns,
      keep: resolvedInput.keep,
      preview: true,
    });

    // Request confirmation if elicitation available and many duplicates found
    if (previewResult.duplicatesFound > 0 && this.context.elicitationServer) {
      const confirmation = await confirmDestructiveAction(
        this.context.elicitationServer,
        'deduplicate',
        `Remove ${previewResult.duplicatesFound} duplicate rows from spreadsheet ${resolvedInput.spreadsheetId}. Keeping ${resolvedInput.keep || 'first'} occurrence of each duplicate. This action cannot be undone.`
      );

      if (!confirmation.confirmed) {
        return {
          success: false,
          error: {
            code: ErrorCodes.PRECONDITION_FAILED,
            message: confirmation.reason || 'User cancelled the operation',
            retryable: false,
          },
        } as CompositeOutput['response'];
      }
    }

    // Create snapshot if requested
    const snapshot = await createSnapshotIfNeeded(
      this.context.snapshotService,
      {
        operationType: 'deduplicate',
        isDestructive: true,
        spreadsheetId: resolvedInput.spreadsheetId,
        affectedRows: previewResult.duplicatesFound,
      },
      resolvedInput.safety
    );

    // Send progress notification for long-running dedupe
    const env = getEnv();
    if (env.ENABLE_GRANULAR_PROGRESS) {
      await sendProgress(0, 2, `Deduplicating ${previewResult.totalRows} rows...`);
    }

    // Execute the actual deduplication (reuse preview scan to skip redundant API fetch)
    const result: DeduplicateResult = await this.compositeService.deduplicate({
      spreadsheetId: resolvedInput.spreadsheetId,
      sheet: resolvedInput.sheet,
      keyColumns: resolvedInput.keyColumns,
      keep: resolvedInput.keep,
      preview: false,
      _preComputedDuplicateRows: previewResult._duplicateRowSet,
      _preComputedTotalRows: previewResult.totalRows,
      _preComputedUniqueRows: previewResult.uniqueRows,
    });

    if (env.ENABLE_GRANULAR_PROGRESS) {
      await sendProgress(2, 2, `Removed ${result.rowsDeleted} duplicate rows`);
    }

    return {
      success: true as const,
      action: 'deduplicate' as const,
      ...result,
      mutation:
        result.rowsDeleted > 0
          ? {
              cellsAffected: result.rowsDeleted,
              reversible: false,
            }
          : undefined,
      snapshotId: snapshot?.snapshotId,
      _meta: this.generateMeta(
        'deduplicate',
        input as unknown as Record<string, unknown>,
        result as unknown as Record<string, unknown>,
        { cellsAffected: result.rowsDeleted }
      ),
    };
  }

  // ==========================================================================
  // build_dashboard
  // ==========================================================================

  private async handleBuildDashboard(
    input: CompositeBuildDashboardInput
  ): Promise<CompositeOutput['response']> {
    const { spreadsheetId, dataSheet, dashboardSheet, layout, kpis, charts, slicers } = input;
    const logger = getRequestLogger();

    logger.info('Building dashboard', { spreadsheetId, dataSheet, dashboardSheet, layout });

    this.sendProgress(0, 10, 'Setting up dashboard sheet');

    // Step 1: Ensure dashboard sheet exists (add it if missing)
    const spreadsheet = await this.sheetsApi.spreadsheets.get({ spreadsheetId });
    const existingSheets = spreadsheet.data.sheets ?? [];
    const dashboardExists = existingSheets.some((s) => s.properties?.title === dashboardSheet);

    if (!dashboardExists) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: dashboardSheet } } }],
        },
      });
    }

    this.sendProgress(3, 10, 'Writing KPI metrics');

    // Step 2: Write KPIs if provided
    if (kpis && kpis.length > 0) {
      const labelRow = kpis.map((k) => k.label);
      const formulaRow = kpis.map((k) => k.formula);
      const kpiRange = `${dashboardSheet}!A1:${String.fromCharCode(65 + kpis.length - 1)}2`;
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range: kpiRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [labelRow, formulaRow] },
      });
    }

    this.sendProgress(5, 10, 'Applying formatting');

    // Step 3: Bold the label row via batchUpdate if KPIs present
    if (kpis && kpis.length > 0) {
      const dashboardSheetObj = (
        await this.sheetsApi.spreadsheets.get({ spreadsheetId })
      ).data.sheets?.find((s) => s.properties?.title === dashboardSheet);
      const dashboardSheetId = dashboardSheetObj?.properties?.sheetId ?? 0;
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: dashboardSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: kpis.length,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                  },
                },
                fields: 'userEnteredFormat.textFormat.bold',
              },
            },
          ],
        },
      });
    }

    this.sendProgress(7, 10, 'Adding charts');

    // Step 4: Create charts if provided (simplified — charts use addChart request)
    let chartsAddedCount = 0;
    if (charts && charts.length > 0 && layout !== 'kpi_header') {
      const dashboardSheetObj2 = (
        await this.sheetsApi.spreadsheets.get({ spreadsheetId })
      ).data.sheets?.find((s) => s.properties?.title === dashboardSheet);
      const dashboardSheetId2 = dashboardSheetObj2?.properties?.sheetId ?? 0;

      for (const [i, chart] of charts.entries()) {
        const anchorRow = (kpis ? 4 : 1) + i * 20;
        await this.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addChart: {
                  chart: {
                    spec: {
                      title: chart.title,
                      basicChart: {
                        chartType: chart.type,
                        series: [{ series: { sourceRange: { sources: [] } } }],
                      },
                    },
                    position: {
                      overlayPosition: {
                        anchorCell: {
                          sheetId: dashboardSheetId2,
                          rowIndex: anchorRow,
                          columnIndex: 0,
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        });
        chartsAddedCount++;
      }
    }

    this.sendProgress(9, 10, 'Adding slicers');

    // Step 5: Create slicers if provided and layout includes them
    let slicersAddedCount = 0;
    if (slicers && slicers.length > 0 && layout === 'full_analytics') {
      const dataSheetObj = (
        await this.sheetsApi.spreadsheets.get({ spreadsheetId })
      ).data.sheets?.find((s) => s.properties?.title === dataSheet);
      const dataSheetId = dataSheetObj?.properties?.sheetId ?? 0;
      const dashboardSheetObj3 = (
        await this.sheetsApi.spreadsheets.get({ spreadsheetId })
      ).data.sheets?.find((s) => s.properties?.title === dashboardSheet);
      const dashboardSheetId3 = dashboardSheetObj3?.properties?.sheetId ?? 0;

      for (const slicer of slicers) {
        await this.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSlicer: {
                  slicer: {
                    spec: {
                      dataRange: {
                        sheetId: dataSheetId,
                        startRowIndex: 0,
                        endRowIndex: 1000,
                        startColumnIndex: slicer.filterColumn,
                        endColumnIndex: slicer.filterColumn + 1,
                      },
                      columnIndex: slicer.filterColumn,
                      title: slicer.title,
                    },
                    position: {
                      overlayPosition: {
                        anchorCell: {
                          sheetId: dashboardSheetId3,
                          rowIndex: 0,
                          columnIndex: 0,
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        });
        slicersAddedCount++;
      }
    }

    this.sendProgress(10, 10, 'Dashboard complete');

    const kpisAdded = kpis?.length ?? 0;
    const chartsAdded = chartsAddedCount;
    const slicersAdded = slicersAddedCount;

    return {
      success: true as const,
      action: 'build_dashboard' as const,
      dashboardSheet,
      kpisAdded,
      chartsAdded,
      slicersAdded,
      message: `Dashboard "${dashboardSheet}" created with ${kpisAdded} KPIs, ${chartsAdded} charts`,
    };
  }
}
