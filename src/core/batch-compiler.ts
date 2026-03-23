/**
 * ServalSheets - Batch Compiler
 *
 * Phase 2.1: Direct Google API Request Compilation
 * Phase 3: Response Metadata Parsing (Eliminates Compensatory Diff Pattern)
 *
 * Compiles WrappedRequests (from RequestBuilder) into batched Google Sheets API calls
 *
 * Architecture Changes:
 * - Phase 2.1: Intents → WrappedRequests (direct Google API format)
 * - Phase 3: Eliminated before/after state captures (3→1 API calls per mutation)
 *
 * OLD Pattern (3 API calls):
 *   1. captureState (before)
 *   2. batchUpdate (mutation)
 *   3. captureState (after)
 *
 * NEW Pattern (1 API call):
 *   1. batchUpdate (mutation) → ResponseParser extracts metadata
 */

import type { sheets_v4 } from 'googleapis';
import { createHash } from 'crypto';
import type { WrappedRequest } from './request-builder.js';
import type { Intent } from './intent.js';
import { INTENT_TO_REQUEST_TYPE, DESTRUCTIVE_INTENTS, HIGH_RISK_INTENTS } from './intent.js';
import type { RateLimiter } from './rate-limiter.js';
import type { DiffEngine, SpreadsheetState } from './diff-engine.js';
import type { PolicyEnforcer } from './policy-enforcer.js';
import type { SnapshotService } from '../services/snapshot.js';
import { validateBatchUpdatePayload } from '../utils/payload-validator.js';
import type { SafetyOptions, DiffResult, ErrorDetail } from '../schemas/shared.js';
import { monitorPayload, type PayloadMetrics } from '../utils/payload-monitor.js';
import { ResponseParser, type ParsedResponseMetadata } from './response-parser.js';
import { getResponseValidator } from '../services/response-validator.js';
import { logger } from '../utils/logger.js';
import { sendProgress, getRequestContext } from '../utils/request-context.js';
import { GOOGLE_SHEETS_MAX_BATCH_REQUESTS } from '../config/constants.js';

export interface CompiledBatch {
  spreadsheetId: string;
  requests: sheets_v4.Schema$Request[];
  estimatedCells: number;
  destructive: boolean;
  highRisk: boolean;
  requestCount: number; // v2.0: renamed from intentCount
}

export interface ExecutionResult {
  success: boolean;
  spreadsheetId: string;
  responses: sheets_v4.Schema$Response[];
  diff?: DiffResult;
  responseMetadata?: ParsedResponseMetadata; // Phase 3: Parsed metadata from ResponseParser
  snapshotId?: string | undefined; // Allow undefined for exactOptionalPropertyTypes
  error?: ErrorDetail;
  dryRun: boolean;
  payloadMetrics?: PayloadMetrics;
}

export interface ProgressEvent {
  phase: 'validating' | 'compiling' | 'executing' | 'capturing_diff';
  current: number;
  total: number;
  message: string;
  spreadsheetId?: string;
}

export interface BatchCompilerOptions {
  rateLimiter: RateLimiter;
  diffEngine: DiffEngine;
  policyEnforcer: PolicyEnforcer;
  snapshotService: SnapshotService;
  sheetsApi: sheets_v4.Sheets;
  onProgress?: (event: ProgressEvent) => void;
}

export interface SafetyExecutionOptions {
  spreadsheetId: string;
  safety?: SafetyOptions;
  estimatedCells?: number;
  destructive?: boolean;
  highRisk?: boolean;
  range?: string;
  operation: () => Promise<void>;
  diffOptions?: {
    tier?: 'METADATA' | 'SAMPLE' | 'FULL';
    sampleSize?: number;
    maxFullDiffCells?: number;
  };
  /** Skip expensive diff capture for simple operations (speeds up writes significantly) */
  skipDiff?: boolean;
}

/**
 * Compiles intents into Google Sheets API requests and executes them
 */
export class BatchCompiler {
  private rateLimiter: RateLimiter;
  private diffEngine: DiffEngine;
  private snapshotService: SnapshotService;
  private sheetsApi: sheets_v4.Sheets;
  private onProgress?: (event: ProgressEvent) => void;

  constructor(options: BatchCompilerOptions) {
    this.rateLimiter = options.rateLimiter;
    this.diffEngine = options.diffEngine;
    // options.policyEnforcer reserved for future policy enforcement wiring
    this.snapshotService = options.snapshotService;
    this.sheetsApi = options.sheetsApi;
    if (options.onProgress) {
      this.onProgress = options.onProgress;
    }
  }

  /**
   * Compile WrappedRequests into batched API requests
   *
   * Phase 2.1: Simplified architecture - requests are already in Google API format,
   * no transformation needed! Just group, validate, and batch.
   *
   * Backward Compatibility: Also accepts Intent[] for gradual migration
   */
  async compile(requests: WrappedRequest[] | Intent[]): Promise<CompiledBatch[]> {
    // Backward compatibility: Convert Intent[] to WrappedRequest[]
    const wrappedRequests = this.isIntentArray(requests)
      ? this.convertIntentsToWrappedRequests(requests)
      : requests;

    // Note: Batch efficiency analysis and policy validation can be added in future phases
    // if needed for optimization and security checks

    // 1. Group by spreadsheet
    const grouped = this.groupBySpreadsheet(wrappedRequests);

    // 2. Create batches (no transformation needed - requests already in Google API format!)
    const batches: CompiledBatch[] = [];

    for (const [spreadsheetId, group] of Object.entries(grouped)) {
      // Extract raw Google API requests (no transformation!)
      const requests = group.map((wrapped) => wrapped.request);
      const merged = this.mergeCompatibleRequests(requests);
      const chunked = this.chunkRequests(merged, GOOGLE_SHEETS_MAX_BATCH_REQUESTS);

      for (const chunk of chunked) {
        batches.push({
          spreadsheetId,
          requests: chunk,
          estimatedCells: this.estimateCells(group),
          destructive: group.some((w) => w.metadata.destructive),
          highRisk: group.some((w) => w.metadata.highRisk),
          requestCount: group.length,
        });
      }
    }

    return batches;
  }

  /**
   * Execute a compiled batch with safety rails
   */
  async execute(batch: CompiledBatch, safety?: SafetyOptions): Promise<ExecutionResult> {
    const baseResult = {
      spreadsheetId: batch.spreadsheetId,
      dryRun: safety?.dryRun ?? false,
    };

    // Progress: validating
    this.onProgress?.({
      phase: 'validating',
      current: 0,
      total: 4,
      message: 'Validating safety constraints',
      spreadsheetId: batch.spreadsheetId,
    });
    await sendProgress(0, 4, 'Validating safety constraints');

    // 1. Effect scope check (Tighten-up #2)
    if (safety?.effectScope) {
      const maxCells = safety.effectScope.maxCellsAffected ?? 50000;
      if (batch.estimatedCells > maxCells) {
        return {
          ...baseResult,
          success: false,
          responses: [],
          error: {
            code: 'EFFECT_SCOPE_EXCEEDED',
            message: `Operation would affect ~${batch.estimatedCells} cells, limit is ${maxCells}`,
            retryable: false,
            suggestedFix: 'Narrow the range or increase maxCellsAffected limit',
          },
        };
      }
    }

    // 2. Rate limit check
    await this.rateLimiter.acquire('write', batch.requests.length);

    // 3. Expected state check (Tighten-up #1)
    if (safety?.expectedState) {
      const mismatch = await this.checkExpectedState(batch.spreadsheetId, safety.expectedState);
      if (mismatch) {
        return {
          ...baseResult,
          success: false,
          responses: [],
          error: mismatch,
        };
      }
    }

    // 4. Dry run - return estimate
    if (safety?.dryRun) {
      return {
        ...baseResult,
        success: true,
        responses: [],
        diff: {
          tier: 'METADATA',
          before: {
            timestamp: new Date().toISOString(),
            rowCount: 0,
            columnCount: 0,
            checksum: '',
          },
          after: {
            timestamp: new Date().toISOString(),
            rowCount: 0,
            columnCount: 0,
            checksum: '',
          },
          summary: {
            rowsChanged: 0,
            estimatedCellsChanged: batch.estimatedCells,
          },
        },
      };
    }

    // Progress: compiling/preparing
    this.onProgress?.({
      phase: 'compiling',
      current: 1,
      total: 4,
      message: 'Preparing batch request',
      spreadsheetId: batch.spreadsheetId,
    });
    await sendProgress(1, 4, 'Preparing batch request');

    // Phase 3: Eliminated before-state capture
    // OLD (compensatory diff): const beforeState = await this.diffEngine.captureState(...)
    // NEW: ResponseParser will extract metadata directly from API response
    //
    // API Call Reduction: 3 → 1 per mutation
    // - Eliminated: before-state capture (1 API call)
    // - Eliminated: after-state capture (1 API call)
    // - Retained: batchUpdate mutation (1 API call with metadata extraction)

    // 6. Auto-snapshot for high-risk operations
    let snapshotId: string | undefined;
    if (batch.highRisk && safety?.autoSnapshot !== false) {
      snapshotId = await this.snapshotService.create(batch.spreadsheetId);
    }

    // Progress: executing
    this.onProgress?.({
      phase: 'executing',
      current: 2,
      total: 4,
      message: `Executing ${batch.requests.length} request(s)`,
      spreadsheetId: batch.spreadsheetId,
    });
    await sendProgress(2, 4, `Executing ${batch.requests.length} request(s)`);

    // 7. Validate payload size BEFORE execution
    const requestPayload = { requests: batch.requests };
    const payloadValidation = validateBatchUpdatePayload(batch.requests, {
      spreadsheetId: batch.spreadsheetId,
      operationType: 'batchUpdate',
    });

    if (!payloadValidation.withinLimits) {
      return {
        ...baseResult,
        success: false,
        responses: [],
        snapshotId, // Return snapshot ID if already created
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: payloadValidation.message,
          retryable: false,
          suggestedFix:
            payloadValidation.suggestions?.join('; ') || 'Split operation into smaller batches',
          details: {
            payloadSizeMB: payloadValidation.sizeMB,
            limitMB: 9,
            requestCount: batch.requests.length,
            estimatedSplitCount: payloadValidation.estimatedSplitCount,
            breakdown: payloadValidation.breakdown,
          },
        },
      };
    }

    // 8. Execute the batch
    try {
      // Get trace context from request context for distributed tracing
      const requestContext = getRequestContext();
      const headers: Record<string, string> = {};

      // Propagate W3C Trace Context to Google API
      if (requestContext?.traceId && requestContext?.spanId) {
        headers['traceparent'] = `00-${requestContext.traceId}-${requestContext.spanId}-01`;
        logger.debug('Propagating trace context to Google API', {
          traceId: requestContext.traceId,
          spanId: requestContext.spanId,
        });
      }

      const response = await this.sheetsApi.spreadsheets.batchUpdate(
        {
          spreadsheetId: batch.spreadsheetId,
          requestBody: requestPayload,
        },
        Object.keys(headers).length > 0 ? { headers } : {}
      );

      // Monitor payload sizes
      const payloadMetrics = monitorPayload(
        `batchUpdate:${batch.spreadsheetId}`,
        requestPayload,
        response.data
      );

      // Progress: parsing response
      this.onProgress?.({
        phase: 'capturing_diff',
        current: 3,
        total: 4,
        message: 'Parsing response metadata',
        spreadsheetId: batch.spreadsheetId,
      });
      await sendProgress(3, 4, 'Parsing response metadata');

      // Phase 3: Parse response metadata (eliminates after-state capture)
      // OLD: const afterState = await this.diffEngine.captureState(...) // Extra API call!
      // NEW: Extract metadata directly from response
      const responseMetadata = ResponseParser.parseBatchUpdateResponse(response.data);

      // Phase 3.1: Optional response validation (if enabled)
      const validator = getResponseValidator();
      if (validator.isEnabled()) {
        const validationResult = await validator.validateBatchUpdateResponse(response.data);
        if (validationResult.valid) {
          logger.debug('Response validation passed', {
            spreadsheetId: batch.spreadsheetId,
            repliesValidated: response.data.replies?.length ?? 0,
          });
        } else {
          logger.warn('Response validation detected issues', {
            spreadsheetId: batch.spreadsheetId,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
          });
          // Log detailed validation failures for debugging
          if (validationResult.errors.length > 0) {
            logger.debug('Response validation errors', {
              spreadsheetId: batch.spreadsheetId,
              errorCount: validationResult.errors.length,
              errors: validationResult.errors,
            });
          }
        }
      }

      // Generate DiffResult from parsed metadata (backward compatibility)
      // Using METADATA tier since we don't have before/after full state anymore
      const diff: DiffResult = {
        tier: 'METADATA',
        before: {
          timestamp: new Date().toISOString(),
          rowCount: 0, // Phase 3: No longer tracked (eliminated API calls)
          columnCount: 0, // Phase 3: No longer tracked (eliminated API calls)
          checksum: '',
        },
        after: {
          timestamp: new Date().toISOString(),
          rowCount: responseMetadata.totalRowsAffected,
          columnCount: responseMetadata.totalColumnsAffected,
          checksum: '',
        },
        summary: {
          rowsChanged: responseMetadata.totalRowsAffected,
          estimatedCellsChanged: responseMetadata.totalCellsAffected,
        },
      };

      logger.info('Batch execution completed', {
        spreadsheetId: batch.spreadsheetId,
        requestCount: batch.requests.length,
        totalCellsAffected: responseMetadata.totalCellsAffected,
        totalRowsAffected: responseMetadata.totalRowsAffected,
        summary: responseMetadata.summary,
      });

      // Progress: completion
      this.onProgress?.({
        phase: 'capturing_diff',
        current: 4,
        total: 4,
        message: 'Batch execution completed',
        spreadsheetId: batch.spreadsheetId,
      });
      await sendProgress(4, 4, 'Batch execution completed');

      return {
        ...baseResult,
        success: true,
        responses: response.data.replies ?? [],
        diff,
        responseMetadata, // Phase 3: Include parsed metadata
        snapshotId,
        payloadMetrics,
      };
    } catch (error) {
      return {
        ...baseResult,
        success: false,
        responses: [],
        snapshotId, // Still return snapshot ID for recovery
        error: this.mapGoogleError(error),
      };
    }
  }

  /**
   * Execute a custom operation with safety rails and diff capture
   */
  async executeWithSafety(options: SafetyExecutionOptions): Promise<ExecutionResult> {
    const safety = options.safety;
    const baseResult = {
      spreadsheetId: options.spreadsheetId,
      dryRun: safety?.dryRun ?? false,
    };
    const estimatedCells = options.estimatedCells ?? 0;
    const highRisk = options.highRisk ?? options.destructive ?? false;

    this.onProgress?.({
      phase: 'validating',
      current: 0,
      total: 4,
      message: 'Validating safety constraints',
      spreadsheetId: options.spreadsheetId,
    });
    await sendProgress(0, 4, 'Validating safety constraints');

    if (safety?.effectScope) {
      const maxCells = safety.effectScope.maxCellsAffected ?? 50000;
      if (estimatedCells > maxCells) {
        return {
          ...baseResult,
          success: false,
          responses: [],
          error: {
            code: 'EFFECT_SCOPE_EXCEEDED',
            message: `Operation would affect ~${estimatedCells} cells, limit is ${maxCells}`,
            retryable: false,
            suggestedFix: 'Narrow the range or increase maxCellsAffected limit',
          },
        };
      }

      if (safety.effectScope.requireExplicitRange && !options.range) {
        return {
          ...baseResult,
          success: false,
          responses: [],
          error: {
            code: 'EXPLICIT_RANGE_REQUIRED',
            message: 'Explicit range required for this operation',
            retryable: false,
            suggestedFix: 'Provide an explicit A1 range',
          },
        };
      }
    }

    await this.rateLimiter.acquire('write', 1);

    if (safety?.expectedState) {
      const mismatch = await this.checkExpectedState(options.spreadsheetId, safety.expectedState);
      if (mismatch) {
        return {
          ...baseResult,
          success: false,
          responses: [],
          error: mismatch,
        };
      }
    }

    if (safety?.dryRun) {
      return {
        ...baseResult,
        success: true,
        responses: [],
        diff: {
          tier: 'METADATA',
          before: {
            timestamp: new Date().toISOString(),
            rowCount: 0,
            columnCount: 0,
            checksum: '',
          },
          after: {
            timestamp: new Date().toISOString(),
            rowCount: 0,
            columnCount: 0,
            checksum: '',
          },
          summary: {
            rowsChanged: 0,
            estimatedCellsChanged: estimatedCells,
          },
        },
      };
    }

    // Skip diff capture for simple operations (major performance improvement)
    const skipDiff = options.skipDiff === true;

    let beforeState: SpreadsheetState | undefined;
    let diffTier: 'METADATA' | 'SAMPLE' | 'FULL' | undefined;

    if (!skipDiff) {
      this.onProgress?.({
        phase: 'compiling',
        current: 1,
        total: 4,
        message: 'Capturing current state',
        spreadsheetId: options.spreadsheetId,
      });
      await sendProgress(1, 4, 'Capturing current state');

      // Use provided diffOptions or fall back to default tier
      diffTier = options.diffOptions?.tier ?? this.diffEngine.getDefaultTier();
      beforeState = await this.diffEngine.captureState(options.spreadsheetId, {
        tier: diffTier,
        sampleSize: options.diffOptions?.sampleSize,
        maxFullDiffCells: options.diffOptions?.maxFullDiffCells,
      });
    }

    let snapshotId: string | undefined;
    if (highRisk && safety?.autoSnapshot !== false) {
      snapshotId = await this.snapshotService.create(options.spreadsheetId);
    }

    this.onProgress?.({
      phase: 'executing',
      current: skipDiff ? 1 : 2,
      total: skipDiff ? 2 : 4,
      message: 'Executing operation',
      spreadsheetId: options.spreadsheetId,
    });
    await sendProgress(skipDiff ? 1 : 2, skipDiff ? 2 : 4, 'Executing operation');

    try {
      await options.operation();
    } catch (error) {
      return {
        ...baseResult,
        success: false,
        responses: [],
        snapshotId,
        error: this.mapGoogleError(error),
      };
    }

    // Skip diff capture after operation for simple writes
    if (skipDiff) {
      return {
        ...baseResult,
        success: true,
        responses: [],
        snapshotId,
      };
    }

    this.onProgress?.({
      phase: 'capturing_diff',
      current: 3,
      total: 4,
      message: 'Capturing changes',
      spreadsheetId: options.spreadsheetId,
    });
    await sendProgress(3, 4, 'Capturing changes');

    const afterState = await this.diffEngine.captureState(options.spreadsheetId, {
      tier: diffTier!,
      sampleSize: options.diffOptions?.sampleSize,
      maxFullDiffCells: options.diffOptions?.maxFullDiffCells,
    });
    const diff = await this.diffEngine.diff(beforeState!, afterState);

    return {
      ...baseResult,
      success: true,
      responses: [],
      diff,
      snapshotId,
    };
  }

  /**
   * Execute multiple batches with parallelization by spreadsheet
   * Batches for different spreadsheets run in parallel
   * Batches for the same spreadsheet run sequentially (maintains safety)
   */
  async executeAll(batches: CompiledBatch[], safety?: SafetyOptions): Promise<ExecutionResult[]> {
    // Group batches by spreadsheetId for parallel execution
    const batchesBySpreadsheet = new Map<string, Array<{ batch: CompiledBatch; index: number }>>();

    batches.forEach((batch, index) => {
      const spreadsheetId = batch.spreadsheetId;
      if (!batchesBySpreadsheet.has(spreadsheetId)) {
        batchesBySpreadsheet.set(spreadsheetId, []);
      }
      batchesBySpreadsheet.get(spreadsheetId)!.push({ batch, index });
    });

    // Execute each spreadsheet's batches sequentially, but different spreadsheets in parallel
    const spreadsheetResults = await Promise.all(
      Array.from(batchesBySpreadsheet.values()).map(async (spreadsheetBatches) => {
        const groupResults: Array<{
          result: ExecutionResult;
          index: number;
        }> = [];

        for (const { batch, index } of spreadsheetBatches) {
          const result = await this.execute(batch, safety);
          groupResults.push({ result, index });

          // Stop on first failure within this spreadsheet's batches
          if (!result.success) {
            break;
          }
        }

        return groupResults;
      })
    );

    // Flatten and sort results by original index to maintain order
    const allResults = spreadsheetResults
      .flat()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.result);

    return allResults;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Group WrappedRequests by spreadsheet ID
   *
   * Phase 2.1: Updated to work with WrappedRequest metadata instead of Intent
   */
  private groupBySpreadsheet(wrappedRequests: WrappedRequest[]): Record<string, WrappedRequest[]> {
    return wrappedRequests.reduce(
      (acc, wrapped) => {
        const id = wrapped.metadata.spreadsheetId;
        acc[id] ??= [];
        acc[id].push(wrapped);
        return acc;
      },
      {} as Record<string, WrappedRequest[]>
    );
  }

  /**
   * Check if input is Intent[] (for backward compatibility)
   */
  private isIntentArray(requests: WrappedRequest[] | Intent[]): requests is Intent[] {
    if (requests.length === 0) return false;
    const first = requests[0];
    return !!(first && 'type' in first && 'target' in first);
  }

  /**
   * Convert Intent[] to WrappedRequest[] for backward compatibility
   *
   * Phase 2.1: Temporary bridge during migration. Handlers will gradually
   * switch to using RequestBuilder directly.
   */
  private convertIntentsToWrappedRequests(intents: Intent[]): WrappedRequest[] {
    return intents.map((intent) => {
      const requestType = INTENT_TO_REQUEST_TYPE[intent.type];
      return {
        request: { [requestType]: intent.payload } as sheets_v4.Schema$Request,
        metadata: {
          sourceTool: intent.metadata.sourceTool,
          sourceAction: intent.metadata.sourceAction,
          transactionId: intent.metadata.transactionId,
          priority: intent.metadata.priority ?? 0,
          destructive: DESTRUCTIVE_INTENTS.has(intent.type),
          highRisk: HIGH_RISK_INTENTS.has(intent.type),
          estimatedCells: intent.metadata.estimatedCells,
          spreadsheetId: intent.target.spreadsheetId,
          sheetId: intent.target.sheetId,
          range: intent.target.range,
        },
      };
    });
  }

  private mergeCompatibleRequests(
    requests: sheets_v4.Schema$Request[]
  ): sheets_v4.Schema$Request[] {
    if (requests.length <= 1) {
      return requests;
    }

    const merged: sheets_v4.Schema$Request[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < requests.length; i++) {
      if (processed.has(i)) continue;

      const request = requests[i]!;
      const requestType = Object.keys(request)[0];

      // Try to merge updateCells requests
      if (requestType === 'updateCells' && request.updateCells) {
        const mergeResult = this.mergeUpdateCells(requests, i, processed);
        if (mergeResult) {
          merged.push(mergeResult);
          continue;
        }
      }

      // Try to merge repeatCell requests
      if (requestType === 'repeatCell' && request.repeatCell) {
        const mergeResult = this.mergeRepeatCell(requests, i, processed);
        if (mergeResult) {
          merged.push(mergeResult);
          continue;
        }
      }

      // No merge possible, add original request
      merged.push(request);
      processed.add(i);
    }

    const originalCount = requests.length;
    const mergedCount = merged.length;
    if (mergedCount < originalCount) {
      logger.debug('Merged compatible requests', {
        originalCount,
        mergedCount,
        reduction: ((1 - mergedCount / originalCount) * 100).toFixed(1) + '%',
      });
    }

    return merged;
  }

  /**
   * Merge multiple updateCells requests for adjacent/overlapping ranges
   */
  private mergeUpdateCells(
    requests: sheets_v4.Schema$Request[],
    startIndex: number,
    processed: Set<number>
  ): sheets_v4.Schema$Request | null {
    const startReq = requests[startIndex]!.updateCells!;
    if (!startReq.range || !startReq.rows) {
      processed.add(startIndex);
      return null;
    }

    const sheetId = startReq.range.sheetId;
    const fields = startReq.fields;
    const candidates: Array<{ index: number; request: sheets_v4.Schema$UpdateCellsRequest }> = [
      { index: startIndex, request: startReq },
    ];

    // Find adjacent updateCells for same sheet and fields
    for (let j = startIndex + 1; j < requests.length; j++) {
      if (processed.has(j)) continue;

      const req = requests[j]!;
      if (!req.updateCells?.range || !req.updateCells.rows) continue;

      // Must be same sheet, same fields
      if (req.updateCells.range.sheetId === sheetId && req.updateCells.fields === fields) {
        // Check if ranges are adjacent (consecutive rows)
        const lastCandidate = candidates.at(-1)!;
        const lastEndRow =
          (lastCandidate.request.range?.startRowIndex ?? 0) +
          (lastCandidate.request.rows?.length ?? 0);
        const currentStartRow = req.updateCells.range.startRowIndex ?? 0;

        if (currentStartRow === lastEndRow) {
          candidates.push({ index: j, request: req.updateCells });
        }
      }
    }

    // Only merge if we found at least 2 compatible requests
    if (candidates.length < 2) {
      processed.add(startIndex);
      return null;
    }

    // Mark all merged requests as processed
    candidates.forEach((c) => processed.add(c.index));

    // Combine all rows
    const allRows = candidates.flatMap((c) => c.request.rows || []);

    return {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: startReq.range.startRowIndex,
          endRowIndex: (startReq.range.startRowIndex ?? 0) + allRows.length,
          startColumnIndex: startReq.range.startColumnIndex,
          endColumnIndex: startReq.range.endColumnIndex,
        },
        rows: allRows,
        fields: startReq.fields,
      },
    };
  }

  /**
   * Merge multiple repeatCell requests for same format
   */
  private mergeRepeatCell(
    requests: sheets_v4.Schema$Request[],
    startIndex: number,
    processed: Set<number>
  ): sheets_v4.Schema$Request | null {
    const startReq = requests[startIndex]!.repeatCell!;
    if (!startReq.range || !startReq.cell) {
      processed.add(startIndex);
      return null;
    }

    const sheetId = startReq.range.sheetId;
    const fields = startReq.fields;
    const cellJSON = JSON.stringify(startReq.cell);
    const candidates: Array<{ index: number; request: sheets_v4.Schema$RepeatCellRequest }> = [
      { index: startIndex, request: startReq },
    ];

    // Pre-compute cell JSON strings to avoid repeated stringify in loop
    const cellJSONCache = new Map<number, string>();
    for (let k = startIndex + 1; k < requests.length; k++) {
      const req = requests[k];
      if (req?.repeatCell?.cell && !processed.has(k)) {
        cellJSONCache.set(k, JSON.stringify(req.repeatCell.cell));
      }
    }

    // Find repeatCell requests with same cell format
    for (let j = startIndex + 1; j < requests.length; j++) {
      if (processed.has(j)) continue;

      const req = requests[j]!;
      if (!req.repeatCell?.range || !req.repeatCell.cell) continue;

      // Must be same sheet, same fields, same cell format
      const cachedCellJSON = cellJSONCache.get(j);
      if (
        cachedCellJSON &&
        req.repeatCell.range.sheetId === sheetId &&
        req.repeatCell.fields === fields &&
        cachedCellJSON === cellJSON
      ) {
        // Check if ranges are adjacent
        const lastCandidate = candidates.at(-1)!;
        const lastEndRow = lastCandidate.request.range?.endRowIndex ?? 0;
        const currentStartRow = req.repeatCell.range.startRowIndex ?? 0;

        if (currentStartRow === lastEndRow) {
          candidates.push({ index: j, request: req.repeatCell });
        }
      }
    }

    // Only merge if we found at least 2 compatible requests
    if (candidates.length < 2) {
      processed.add(startIndex);
      return null;
    }

    // Mark all merged requests as processed
    candidates.forEach((c) => processed.add(c.index));

    // Calculate combined range
    const firstRange = candidates[0]!.request.range!;
    const lastRange = candidates.at(-1)!.request.range!;

    return {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: firstRange.startRowIndex,
          endRowIndex: lastRange.endRowIndex,
          startColumnIndex: firstRange.startColumnIndex,
          endColumnIndex: firstRange.endColumnIndex,
        },
        cell: startReq.cell,
        fields: startReq.fields,
      },
    };
  }

  private chunkRequests<T>(array: T[], size: number): T[][] {
    // Validate against Google Sheets API limit (100 requests per batchUpdate)
    const maxSize = GOOGLE_SHEETS_MAX_BATCH_REQUESTS;
    if (size > maxSize) {
      logger.warn(
        `Requested batch size ${size} exceeds Google Sheets API limit ${maxSize}, using ${maxSize}`
      );
      size = maxSize;
    }

    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
  }

  /**
   * Estimate total cells affected by a group of WrappedRequests
   *
   * Phase 2.1: Updated to use WrappedRequest metadata
   */
  private estimateCells(wrappedRequests: WrappedRequest[]): number {
    return wrappedRequests.reduce((sum, wrapped) => {
      return sum + (wrapped.metadata.estimatedCells ?? 100);
    }, 0);
  }

  private async checkExpectedState(
    spreadsheetId: string,
    expected: NonNullable<SafetyOptions['expectedState']>
  ): Promise<ErrorDetail | null> {
    try {
      const response = await this.sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties',
      });

      const sheets = response.data.sheets ?? [];

      // Check row count
      if (expected.rowCount !== undefined) {
        const totalRows = sheets.reduce(
          (sum, s) => sum + (s.properties?.gridProperties?.rowCount ?? 0),
          0
        );
        if (totalRows !== expected.rowCount) {
          return {
            code: 'PRECONDITION_FAILED',
            message: `Expected ${expected.rowCount} rows, found ${totalRows}`,
            retryable: true,
            suggestedFix: 'Re-read the spreadsheet and try again',
          };
        }
      }

      // Check sheet title
      if (expected.sheetTitle !== undefined) {
        const found = sheets.some((s) => s.properties?.title === expected.sheetTitle);
        if (!found) {
          return {
            code: 'PRECONDITION_FAILED',
            message: `Sheet "${expected.sheetTitle}" not found`,
            retryable: true,
            suggestedFix: 'Verify the sheet exists and try again',
          };
        }
      }

      // Check checksum of range values
      if (expected.checksum !== undefined) {
        const checksumRange = expected.checksumRange ?? 'A1:J10';
        try {
          const valuesResponse = await this.sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: checksumRange,
            valueRenderOption: 'UNFORMATTED_VALUE',
          });
          const values = valuesResponse.data.values ?? [];
          const actualChecksum = createHash('md5').update(JSON.stringify(values)).digest('hex');

          if (actualChecksum !== expected.checksum) {
            return {
              code: 'PRECONDITION_FAILED',
              message: `Checksum mismatch: expected ${expected.checksum.slice(0, 8)}..., got ${actualChecksum.slice(0, 8)}...`,
              retryable: true,
              suggestedFix: 'Data changed since last read. Re-read and retry.',
            };
          }
        } catch (error) {
          logger.error('Checksum validation failed', {
            error,
            spreadsheetId,
            checksumRange: expected.checksumRange,
          });
          return {
            code: 'INTERNAL_ERROR',
            message: 'Failed to validate checksum',
            retryable: true,
          };
        }
      }

      // Check first row values (headers)
      if (expected.firstRowValues !== undefined) {
        try {
          const sheetPrefix = expected.sheetTitle
            ? `'${expected.sheetTitle.replace(/'/g, "''")}'!`
            : '';
          const headerResponse = await this.sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetPrefix}1:1`,
            valueRenderOption: 'FORMATTED_VALUE',
          });

          const actualValues = (headerResponse.data.values?.[0] ?? []) as string[];
          for (let i = 0; i < expected.firstRowValues.length; i++) {
            if (actualValues[i] !== expected.firstRowValues[i]) {
              return {
                code: 'PRECONDITION_FAILED',
                message: `Header mismatch at column ${i + 1}: expected "${expected.firstRowValues[i]}", got "${actualValues[i] ?? '(empty)'}"`,
                retryable: true,
                suggestedFix: 'Column structure changed. Verify headers.',
              };
            }
          }
        } catch (error) {
          logger.error('Header validation failed', {
            error,
            spreadsheetId,
            sheetTitle: expected.sheetTitle,
          });
          return {
            code: 'INTERNAL_ERROR',
            message: 'Failed to validate headers',
            retryable: true,
          };
        }
      }

      return null;
    } catch (error) {
      logger.error('Expected state check failed', {
        error,
        spreadsheetId,
      });
      return {
        code: 'INTERNAL_ERROR',
        message: 'Failed to check expected state',
        retryable: true,
      };
    }
  }

  private mapGoogleError(error: unknown): ErrorDetail {
    if (error instanceof Error) {
      const messageLower = error.message.toLowerCase();

      // Rate limit (check before quota — real Google errors like
      // "rate limit exceeded for quota group ..." contain both patterns)
      if (messageLower.includes('429') || messageLower.includes('rate limit')) {
        // Dynamically throttle rate limiter for 60 seconds
        this.rateLimiter.throttle(60000);

        return {
          code: 'RATE_LIMITED',
          message: 'API rate limit exceeded. Rate limiter automatically throttled for 60 seconds.',
          retryable: true,
          retryAfterMs: 60000,
          suggestedFix: 'Wait a minute and try again. Rate limits have been temporarily reduced.',
        };
      }

      // Permission
      if (messageLower.includes('403') || messageLower.includes('permission')) {
        return {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied',
          retryable: false,
          suggestedFix: 'Check that you have edit access to the spreadsheet',
        };
      }

      // Not found — distinguish sheet-level from spreadsheet-level
      // Use word-boundary match (\bsheet\b) to avoid matching "spreadsheet"
      if (messageLower.includes('404') || messageLower.includes('not found')) {
        if (/\bsheet\b/.test(messageLower) || messageLower.includes('tab')) {
          return {
            code: 'SHEET_NOT_FOUND',
            message: 'Sheet not found',
            retryable: false,
            suggestedFix: 'Check the sheet name or tab name',
          };
        }
        return {
          code: 'SPREADSHEET_NOT_FOUND',
          message: 'Spreadsheet not found',
          retryable: false,
          suggestedFix: 'Check the spreadsheet ID',
        };
      }

      // Quota
      if (messageLower.includes('quota')) {
        return {
          code: 'QUOTA_EXCEEDED',
          message: 'API quota exceeded',
          retryable: true,
          retryAfterMs: 3600000,
          suggestedFix: 'Wait an hour or request quota increase',
        };
      }

      return {
        code: 'UNKNOWN_ERROR',
        message: error.message,
        retryable: false,
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      retryable: false,
    };
  }
}
