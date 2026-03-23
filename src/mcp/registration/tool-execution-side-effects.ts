import {
  recordToolCall,
  recordToolCallLatency,
  recordError,
  recordSelfCorrection,
} from '../../observability/metrics.js';
import { getEnv } from '../../config/env.js';
import { getAuditLogger } from '../../services/audit-logger.js';
import { getCacheInvalidationGraph } from '../../services/cache-invalidation-graph.js';
import { getCostTracker } from '../../services/cost-tracker.js';
import { getHistoryService } from '../../services/history-service.js';
import {
  getTraceAggregator,
  TraceAggregatorImpl,
  type RequestTrace,
  type TraceSpan,
} from '../../services/trace-aggregator.js';
import { invalidateContext as invalidateSamplingContext } from '../../services/sampling-context-cache.js';
import { resourceNotifications } from '../../resources/notifications.js';
import type { OperationHistory } from '../../types/history.js';
import { logger } from '../../utils/logger.js';
import { getTracer } from '../../utils/tracing.js';
import {
  extractCellsAffected,
  extractErrorCode,
  extractErrorMessage,
  extractSheetId,
  extractSnapshotId,
  extractSpreadsheetId,
  isSuccessResult,
} from './extraction-helpers.js';
import { getResponseRecord, isPlainRecord } from './tool-response-normalization.js';

type ExecutionStatus = 'success' | 'error';

type RecentFailure = {
  action: string;
  timestampMs: number;
};

export interface SelfCorrectionStore {
  recentFailuresByPrincipal: Map<string, RecentFailure>;
  selfCorrectionWindowMs: number;
}

export interface ToolExecutionSideEffectDeps {
  historyService: {
    record(entry: OperationHistory): void;
  };
  traceAggregator: {
    isEnabled(): boolean;
    recordTrace(trace: {
      requestId: string;
      traceId: string;
      timestamp: number;
      duration: number;
      tool: string;
      action: string;
      success: boolean;
      errorCode?: string;
      errorMessage?: string;
      spans: TraceSpan[];
    }): void;
  };
  costTracker: {
    trackApiCall(tenantId: string, apiType: string): void;
    trackFeatureUsage(tenantId: string, feature: string, amount?: number): void;
  };
  auditLogger: {
    logToolCall(input: {
      tool: string;
      action: string;
      userId: string;
      spreadsheetId?: string;
      outcome: 'success' | 'failure';
      duration: number;
    }): Promise<void> | void;
  };
  envConfig: {
    ENABLE_COST_TRACKING: boolean;
    ENABLE_BILLING_INTEGRATION: boolean;
    ENABLE_AUDIT_LOGGING: boolean;
  };
  log: {
    debug(message: string, meta?: Record<string, unknown>): void;
  };
  recordToolCallMetric: typeof recordToolCall;
  recordToolCallLatencyMetric: typeof recordToolCallLatency;
  recordErrorMetric: typeof recordError;
  recordSelfCorrectionMetric: typeof recordSelfCorrection;
  invalidateSamplingContext: (spreadsheetId: string) => void;
  resourceNotifications: {
    notifyCacheInvalidated(spreadsheetId?: string): void;
    notifySpreadsheetMutation(spreadsheetId: string, reason?: string): void;
  };
  collectTraceSpans: () => Promise<TraceSpan[]>;
}

export interface SuccessfulToolExecutionInput {
  toolName: string;
  action: string;
  args: Record<string, unknown>;
  result: unknown;
  operationId: string;
  timestamp: string;
  startTime: number;
  duration: number;
  requestId?: string;
  traceId?: string;
  principalId: string;
  costTrackingTenantId: string;
}

export interface FailedToolExecutionInput {
  toolName: string;
  action: string;
  args: Record<string, unknown>;
  error: unknown;
  errorCode: string;
  errorMessage: string;
  operationId: string;
  timestamp: string;
  startTime: number;
  duration: number;
  requestId?: string;
  traceId?: string;
  principalId: string;
}

const DEFAULT_SELF_CORRECTION_STORE: SelfCorrectionStore = {
  recentFailuresByPrincipal: new Map<string, RecentFailure>(),
  selfCorrectionWindowMs: 5 * 60 * 1000,
};

function createDefaultDeps(): ToolExecutionSideEffectDeps {
  return {
    historyService: getHistoryService(),
    traceAggregator: getTraceAggregator(),
    costTracker: getCostTracker(),
    auditLogger: getAuditLogger(),
    envConfig: getEnv(),
    log: logger,
    recordToolCallMetric: recordToolCall,
    recordToolCallLatencyMetric: recordToolCallLatency,
    recordErrorMetric: recordError,
    recordSelfCorrectionMetric: recordSelfCorrection,
    invalidateSamplingContext,
    resourceNotifications,
    collectTraceSpans: async () => {
      const tracer = getTracer();
      const recordedSpans = tracer.getSpans();

      return recordedSpans.map((span) => TraceAggregatorImpl.spanToTraceSpan(span));
    },
  };
}

export function buildSelfCorrectionKey(toolName: string, principalId: string): string {
  return `${principalId}:${toolName}`;
}

export function pruneSelfCorrectionFailures(store: SelfCorrectionStore, nowMs: number): void {
  for (const [key, value] of store.recentFailuresByPrincipal.entries()) {
    if (nowMs - value.timestampMs > store.selfCorrectionWindowMs) {
      store.recentFailuresByPrincipal.delete(key);
    }
  }
}

export function resolveCostTrackingApiType(toolName: string): 'bigquery' | 'drive' | 'sheets' {
  if (toolName === 'sheets_bigquery') {
    return 'bigquery';
  }

  if (toolName === 'sheets_collaborate' || toolName === 'sheets_history') {
    return 'drive';
  }

  return 'sheets';
}

export function extractRowsProcessed(result: unknown): number | undefined {
  if (!isPlainRecord(result)) {
    return undefined;
  }

  const response = getResponseRecord(result);
  if (!response) {
    return undefined;
  }

  return (
    (typeof response['rowCount'] === 'number' ? response['rowCount'] : undefined) ??
    (typeof response['updatedRows'] === 'number' ? response['updatedRows'] : undefined)
  );
}

function shouldInvalidateSamplingContext(toolName: string, action: string): boolean {
  const invalidationKeys = getCacheInvalidationGraph().getInvalidationKeys(toolName, action);
  return invalidationKeys.length > 0;
}

function buildOperationHistoryEntry(input: SuccessfulToolExecutionInput): {
  operation: OperationHistory;
  spreadsheetId: string | undefined;
  status: ExecutionStatus;
} {
  const spreadsheetId = extractSpreadsheetId(input.args);
  const status: ExecutionStatus = isSuccessResult(input.result) ? 'success' : 'error';

  return {
    operation: {
      id: input.operationId,
      timestamp: input.timestamp,
      tool: input.toolName,
      action: input.action,
      params: input.args,
      result: status,
      duration: input.duration,
      cellsAffected: extractCellsAffected(input.result),
      snapshotId: extractSnapshotId(input.result),
      errorMessage: extractErrorMessage(input.result),
      errorCode: extractErrorCode(input.result),
      requestId: input.requestId,
      spreadsheetId,
      sheetId: extractSheetId(input.args),
    },
    spreadsheetId,
    status,
  };
}

async function recordTraceIfEnabled(
  deps: ToolExecutionSideEffectDeps,
  trace: {
    requestId?: string;
    traceId?: string;
    operationId: string;
    startTime: number;
    duration: number;
    toolName: string;
    action: string;
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }
): Promise<void> {
  if (!deps.traceAggregator.isEnabled()) {
    return;
  }

  try {
    const spans = await deps.collectTraceSpans();

    const requestTrace: RequestTrace = {
      requestId: trace.requestId || trace.operationId,
      traceId: trace.traceId || trace.operationId,
      timestamp: trace.startTime,
      duration: trace.duration,
      tool: trace.toolName,
      action: trace.action,
      success: trace.success,
      errorCode: trace.errorCode,
      errorMessage: trace.errorMessage,
      spans,
    };

    deps.traceAggregator.recordTrace(requestTrace);
  } catch (error) {
    deps.log.debug('Trace aggregation skipped', {
      tool: trace.toolName,
      action: trace.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function trackCostIfEnabled(
  input: SuccessfulToolExecutionInput,
  status: ExecutionStatus,
  deps: ToolExecutionSideEffectDeps
): Promise<void> {
  if (!deps.envConfig.ENABLE_COST_TRACKING && !deps.envConfig.ENABLE_BILLING_INTEGRATION) {
    return;
  }

  try {
    deps.costTracker.trackApiCall(
      input.costTrackingTenantId,
      resolveCostTrackingApiType(input.toolName)
    );

    if (status !== 'success') {
      return;
    }

    const rowsProcessed = extractRowsProcessed(input.result);
    if (typeof rowsProcessed === 'number' && rowsProcessed > 0) {
      deps.costTracker.trackFeatureUsage(
        input.costTrackingTenantId,
        'rowsProcessed',
        rowsProcessed
      );
    }

    if (input.toolName === 'sheets_transaction' && input.action === 'commit') {
      deps.costTracker.trackFeatureUsage(input.costTrackingTenantId, 'transactionsExecuted');
    }
  } catch {
    // Cost tracking is non-critical — never block tool execution.
  }
}

async function logAuditIfEnabled(
  deps: ToolExecutionSideEffectDeps,
  input: {
    toolName: string;
    action: string;
    requestId?: string;
    spreadsheetId?: string;
    duration: number;
    status: ExecutionStatus;
  }
): Promise<void> {
  if (!deps.envConfig.ENABLE_AUDIT_LOGGING) {
    return;
  }

  try {
    await Promise.resolve(
      deps.auditLogger.logToolCall({
        tool: input.toolName,
        action: input.action,
        userId: input.requestId || 'anonymous',
        spreadsheetId: input.spreadsheetId,
        outcome: input.status === 'success' ? 'success' : 'failure',
        duration: input.duration,
      })
    );
  } catch {
    // Audit logging is non-critical — never block tool execution.
  }
}

export async function recordSuccessfulToolExecution(
  input: SuccessfulToolExecutionInput,
  deps: ToolExecutionSideEffectDeps = createDefaultDeps(),
  store: SelfCorrectionStore = DEFAULT_SELF_CORRECTION_STORE
): Promise<void> {
  const nowMs = Date.now();
  const { operation, spreadsheetId, status } = buildOperationHistoryEntry(input);
  const correctionKey = buildSelfCorrectionKey(input.toolName, input.principalId);

  pruneSelfCorrectionFailures(store, nowMs);
  deps.historyService.record(operation);

  const durationSeconds = input.duration / 1000;
  deps.recordToolCallMetric(input.toolName, input.action, status, durationSeconds);
  deps.recordToolCallLatencyMetric(input.toolName, input.action, durationSeconds);

  if (status === 'error') {
    store.recentFailuresByPrincipal.set(correctionKey, {
      action: input.action,
      timestampMs: nowMs,
    });
  } else {
    const priorFailure = store.recentFailuresByPrincipal.get(correctionKey);
    if (priorFailure && nowMs - priorFailure.timestampMs <= store.selfCorrectionWindowMs) {
      deps.recordSelfCorrectionMetric(input.toolName, priorFailure.action, input.action);
      store.recentFailuresByPrincipal.delete(correctionKey);
    }
  }

  await recordTraceIfEnabled(deps, {
    requestId: input.requestId,
    traceId: input.traceId,
    operationId: input.operationId,
    startTime: input.startTime,
    duration: input.duration,
    toolName: input.toolName,
    action: input.action,
    success: status === 'success',
    errorCode: extractErrorCode(input.result) ?? undefined,
    errorMessage: extractErrorMessage(input.result) ?? undefined,
  });

  await trackCostIfEnabled(input, status, deps);
  await logAuditIfEnabled(deps, {
    toolName: input.toolName,
    action: input.action,
    requestId: input.requestId,
    spreadsheetId,
    duration: input.duration,
    status,
  });

  if (status === 'success' && shouldInvalidateSamplingContext(input.toolName, input.action)) {
    deps.resourceNotifications.notifyCacheInvalidated(spreadsheetId);

    if (spreadsheetId) {
      try {
        deps.invalidateSamplingContext(spreadsheetId);
      } catch (error) {
        deps.log.debug('Sampling context invalidation skipped', {
          tool: input.toolName,
          action: input.action,
          spreadsheetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      deps.resourceNotifications.notifySpreadsheetMutation(
        spreadsheetId,
        `${input.toolName}.${input.action} mutated spreadsheet ${spreadsheetId}`
      );
    }
  }
}

export async function recordFailedToolExecution(
  input: FailedToolExecutionInput,
  deps: ToolExecutionSideEffectDeps = createDefaultDeps(),
  store: SelfCorrectionStore = DEFAULT_SELF_CORRECTION_STORE
): Promise<void> {
  const nowMs = Date.now();
  const correctionKey = buildSelfCorrectionKey(input.toolName, input.principalId);

  deps.historyService.record({
    id: input.operationId,
    timestamp: input.timestamp,
    tool: input.toolName,
    action: input.action,
    params: input.args,
    result: 'error',
    duration: input.duration,
    errorMessage: input.errorMessage,
    errorCode: input.errorCode,
    requestId: input.requestId,
    spreadsheetId: extractSpreadsheetId(input.args),
  });

  deps.recordToolCallMetric(input.toolName, input.action, 'error', input.duration / 1000);
  deps.recordErrorMetric(
    input.error instanceof Error ? input.error.name : 'UnknownError',
    input.toolName,
    input.action
  );

  pruneSelfCorrectionFailures(store, nowMs);
  store.recentFailuresByPrincipal.set(correctionKey, {
    action: input.action,
    timestampMs: nowMs,
  });

  await recordTraceIfEnabled(deps, {
    requestId: input.requestId,
    traceId: input.traceId,
    operationId: input.operationId,
    startTime: input.startTime,
    duration: input.duration,
    toolName: input.toolName,
    action: input.action,
    success: false,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  });
}
