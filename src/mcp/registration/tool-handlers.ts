/**
 * ServalSheets - Tool Handlers
 *
 * Handler mapping and tool call execution logic.
 *
 * @module mcp/registration/tool-handlers
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type {
  CallToolResult,
  RequestInfo,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import { randomUUID } from 'crypto';
import PQueue from 'p-queue';
import {
  recordToolCall,
  recordToolCallLatency,
  recordError,
  recordSelfCorrection,
  updateQueueMetrics,
} from '../../observability/metrics.js';
import { resourceNotifications } from '../../resources/notifications.js';
import { withToolSpan } from '../../utils/tracing.js';
import { z, type ZodSchema, type ZodTypeAny } from 'zod';

import type { Handlers } from '../../handlers/index.js';
import { AuthHandler } from '../../handlers/auth.js';
import {
  handleGenerateTemplateAction,
  handlePreviewGenerationAction,
} from '../../handlers/composite-actions/generation.js';
import { ConfirmHandler } from '../../handlers/confirm.js';
import { SessionHandler } from '../../handlers/session.js';
import type { GoogleApiClient } from '../../services/google-api.js';
import {
  createRequestContext,
  runWithRequestContext,
  getRequestContext,
  createRequestAbortError,
  recordRequestVerbosity,
  type RelatedRequestSender,
  type TaskStatusUpdater,
} from '../../utils/request-context.js';
import { extractIdempotencyKeyFromHeaders } from '../../utils/idempotency-key-generator.js';
import { recordSpreadsheetId, TOOL_ACTIONS } from '../completions.js';
import { TOOL_EXECUTION_CONFIG, TOOL_ICONS } from '../features-2025-11-25.js';
import { getHistoryService } from '../../services/history-service.js';
import { getTraceAggregator } from '../../services/trace-aggregator.js';
import { getCostTracker } from '../../services/cost-tracker.js';
import { getAuditLogger } from '../../services/audit-logger.js';
import { appendAuditLogRow } from '../../services/audit-log-sheet.js';
import { getCacheInvalidationGraph } from '../../services/cache-invalidation-graph.js';
import { createMetadataCache } from '../../services/metadata-cache.js';
import { invalidateContext as invalidateSamplingContext } from '../../services/sampling-context-cache.js';
import { getEnv } from '../../config/env.js';
import { registerServerTaskCancelHandler } from '../../server/control-plane-registration.js';
import { handlePreInitExemptToolCall } from '../../server/preinit-tool-routing.js';
import { resolveCostTrackingTenantId } from '../../utils/tenant-identification.js';
import type { OperationHistory } from '../../types/history.js';
import { wrapInputSchemaForLegacyRequest } from './schema-helpers.js';
import { detectLegacyInvocation, normalizeToolArgs } from './tool-arg-normalization.js';
import { assertValidMcpToolNames } from './tool-name-validation.js';
import type { ToolDefinition } from './tool-definitions.js';
import { ACTIVE_TOOL_DEFINITIONS, isToolCallAuthExempt } from './tool-definitions.js';
import {
  extractAction,
  extractSpreadsheetId,
  extractSheetId,
  extractCellsAffected,
  extractSnapshotId,
  extractErrorMessage,
  extractErrorCode,
  isSuccessResult,
} from './extraction-helpers.js';
import { logger } from '../../utils/logger.js';
import {
  SheetsAuthInputSchema,
  SheetsCoreInputSchema,
  SheetsDataInputSchema,
  SheetsFormatInputSchema,
  SheetsDimensionsInputSchema,
  SheetsVisualizeInputSchema,
  SheetsCollaborateInputSchema,
  SheetsAdvancedInputSchema,
  SheetsTransactionInputSchema,
  SheetsQualityInputSchema,
  SheetsHistoryInputSchema,
  SheetsConfirmInputSchema,
  SheetsAnalyzeInputSchema,
  SheetsFixInputSchema,
  CompositeInputSchema,
  SheetsSessionInputSchema,
  // Tier 7 Enterprise tools
  SheetsTemplatesInputSchema,
  SheetsBigQueryInputSchema,
  SheetsAppsScriptInputSchema,
  SheetsWebhookInputSchema,
  SheetsDependenciesInputSchema,
  SheetsFederationInputSchema,
  SheetsComputeInputSchema,
  SheetsAgentInputSchema,
  SheetsConnectorsInputSchema,
} from '../../schemas/index.js';
import { parseWithCache } from '../../utils/schema-cache.js';
import { registerToolsListCompatibilityHandler } from './tools-list-compat.js';
import { wrapToolMapWithIdempotency } from '../../middleware/idempotency-middleware.js';
import { registerPipelineDispatch } from '../../services/pipeline-registry.js';
import { buildToolExecutionErrorPayload } from './tool-execution-error.js';
import { isLikelyMutationAction, withWriteLock } from '../../middleware/write-lock-middleware.js';
import { checkRateLimit } from '../../middleware/rate-limit-middleware.js';
import { detectMutationSafetyViolation } from '../../middleware/mutation-safety-middleware.js';
import { startKeepalive } from '../../utils/keepalive.js';
import { createTaskAwareSamplingServer } from '../sampling.js';
import {
  buildAuthErrorResponse,
  checkAuthAsync,
  convertGoogleAuthError,
  isGoogleAuthError,
} from '../../utils/auth-guard.js';
import { replaceAvailableToolNames } from '../tool-registry-state.js';
import { ServiceError } from '../../core/errors.js';
import { buildToolResponse as buildNormalizedToolResponse } from './tool-response.js';

// Wrap input schemas for legacy envelopes during validation.
// Keep registration schemas unwrapped to avoid MCP SDK tools/list empty schema bug.
const SheetsAuthInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsAuthInputSchema);
const SheetsCoreInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsCoreInputSchema);
const SheetsDataInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsDataInputSchema);
const SheetsFormatInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsFormatInputSchema);
const SheetsDimensionsInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsDimensionsInputSchema
);
const SheetsVisualizeInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsVisualizeInputSchema
);
const SheetsCollaborateInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsCollaborateInputSchema
);
const SheetsAdvancedInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsAdvancedInputSchema);
const SheetsTransactionInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsTransactionInputSchema
);
const SheetsQualityInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsQualityInputSchema);
const SheetsHistoryInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsHistoryInputSchema);
const SheetsConfirmInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsConfirmInputSchema);
const SheetsAnalyzeInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsAnalyzeInputSchema);
const SheetsFixInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsFixInputSchema);
const CompositeInputSchemaLegacy = wrapInputSchemaForLegacyRequest(CompositeInputSchema);
const SheetsSessionInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsSessionInputSchema);
const SheetsTemplatesInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsTemplatesInputSchema
);
const SheetsBigQueryInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsBigQueryInputSchema);
const SheetsAppsScriptInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsAppsScriptInputSchema
);
const SheetsWebhookInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsWebhookInputSchema);
const SheetsDependenciesInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsDependenciesInputSchema
);
const SheetsFederationInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsFederationInputSchema
);
const SheetsComputeInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsComputeInputSchema);
const SheetsAgentInputSchemaLegacy = wrapInputSchemaForLegacyRequest(SheetsAgentInputSchema);
const SheetsConnectorsInputSchemaLegacy = wrapInputSchemaForLegacyRequest(
  SheetsConnectorsInputSchema
);

const SELF_CORRECTION_WINDOW_MS = 5 * 60 * 1000;
const recentFailuresByPrincipal = new Map<string, { action: string; timestampMs: number }>();
type RegisteredTaskStore = Parameters<typeof registerServerTaskCancelHandler>[0]['taskStore'];
const taskAbortControllersByStore = new WeakMap<
  RegisteredTaskStore,
  Map<string, AbortController>
>();
const taskWatchdogTimersByStore = new WeakMap<RegisteredTaskStore, Map<string, NodeJS.Timeout>>();
const taskCancelHandlersRegistered = new WeakSet<RegisteredTaskStore>();

export interface LegacyToolRegistration {
  dispose(): void;
}

interface LegacyToolRegistrationState {
  disposed: boolean;
  abortController: AbortController;
}

function buildSelfCorrectionKey(toolName: string, principalId: string): string {
  return `${principalId}:${toolName}`;
}

function pruneSelfCorrectionFailures(nowMs: number): void {
  for (const [key, value] of recentFailuresByPrincipal.entries()) {
    if (nowMs - value.timestampMs > SELF_CORRECTION_WINDOW_MS) {
      recentFailuresByPrincipal.delete(key);
    }
  }
}

function mergeAbortSignals(
  requestAbortSignal?: AbortSignal,
  sessionAbortSignal?: AbortSignal
): AbortSignal | undefined {
  if (!requestAbortSignal) {
    return sessionAbortSignal;
  }
  if (!sessionAbortSignal) {
    return requestAbortSignal;
  }

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([requestAbortSignal, sessionAbortSignal]);
  }

  const controller = new AbortController();
  const forwardAbort = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  if (requestAbortSignal.aborted) {
    forwardAbort(requestAbortSignal);
  } else {
    requestAbortSignal.addEventListener('abort', () => forwardAbort(requestAbortSignal), {
      once: true,
    });
  }

  if (sessionAbortSignal.aborted) {
    forwardAbort(sessionAbortSignal);
  } else {
    sessionAbortSignal.addEventListener('abort', () => forwardAbort(sessionAbortSignal), {
      once: true,
    });
  }

  return controller.signal;
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeRequestHeaders(
  headers: unknown
): Record<string, string | string[] | undefined> | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  if (
    'entries' in (headers as Record<string, unknown>) &&
    typeof (headers as { entries?: unknown }).entries === 'function'
  ) {
    return Object.fromEntries(
      Array.from((headers as { entries: () => IterableIterator<[string, string]> }).entries())
    );
  }

  return headers as Record<string, string | string[] | undefined>;
}

function extractAttemptedAction(args: unknown): string | null {
  if (!args || typeof args !== 'object') {
    return null;
  }

  const record = args as Record<string, unknown>;
  if (typeof record['action'] === 'string') {
    return record['action'];
  }

  const request = record['request'];
  if (!request || typeof request !== 'object') {
    return null;
  }

  const requestRecord = request as Record<string, unknown>;
  return typeof requestRecord['action'] === 'string' ? requestRecord['action'] : null;
}

function getIssueCode(issue: z.ZodIssue): string {
  return String((issue as { code?: unknown }).code ?? '');
}

function normalizeIssuePath(path: readonly PropertyKey[]): Array<string | number> {
  return path.map((segment) =>
    typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment)
  );
}

function isActionValidationIssue(issue: z.ZodIssue): boolean {
  const issueRecord = issue as unknown as Record<string, unknown>;
  const issueCode = getIssueCode(issue);
  const hasActionInPath = normalizeIssuePath(issue.path).some((segment) => segment === 'action');
  const isActionDiscriminator = issueRecord['discriminator'] === 'action';

  return (
    (hasActionInPath &&
      (issueCode === 'invalid_union' ||
        issueCode === 'invalid_union_discriminator' ||
        issueCode === 'invalid_literal' ||
        issueCode === 'invalid_value')) ||
    isActionDiscriminator
  );
}

function formatActionValidationMessage(
  path: readonly PropertyKey[],
  availableActions: string[]
): string {
  const normalizedPath = normalizeIssuePath(path);
  const pathStr = normalizedPath.length > 0 ? normalizedPath.join('.') : 'action';
  const preview = availableActions.slice(0, 20).join(', ');
  const more = availableActions.length > 20 ? ` (and ${availableActions.length - 20} more)` : '';
  return `Invalid action at '${pathStr}'. Valid actions: ${preview}${more}`;
}

function shouldEnhanceActionIssue(issue: z.ZodIssue, attemptedAction: string | null): boolean {
  if (isActionValidationIssue(issue)) {
    return true;
  }

  if (!attemptedAction) {
    return false;
  }

  const issueCode = getIssueCode(issue);
  return issueCode === 'invalid_union' || issueCode === 'invalid_union_discriminator';
}

function shouldInvalidateSamplingContext(toolName: string, action: string): boolean {
  const invalidationKeys = getCacheInvalidationGraph().getInvalidationKeys(toolName, action);
  return invalidationKeys.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractSpreadsheetIdFromResult(result: unknown): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  const response = isRecord(result['response']) ? result['response'] : undefined;
  if (!response) {
    return undefined;
  }

  if (typeof response['spreadsheetId'] === 'string') {
    return response['spreadsheetId'];
  }

  if (typeof response['newSpreadsheetId'] === 'string') {
    return response['newSpreadsheetId'];
  }

  const spreadsheet = response['spreadsheet'];
  if (isRecord(spreadsheet) && typeof spreadsheet['spreadsheetId'] === 'string') {
    return spreadsheet['spreadsheetId'];
  }

  const updatedSpreadsheet = response['updatedSpreadsheet'];
  if (isRecord(updatedSpreadsheet) && typeof updatedSpreadsheet['spreadsheetId'] === 'string') {
    return updatedSpreadsheet['spreadsheetId'];
  }

  return undefined;
}

function resolveActionLogSpreadsheetId(
  args: Record<string, unknown>,
  result?: unknown
): string | undefined {
  return extractSpreadsheetId(args) ?? extractSpreadsheetIdFromResult(result);
}

function isActionLogMutation(action: string): boolean {
  return isLikelyMutationAction(action) || action === 'create' || action === 'copy';
}

async function appendActionLogSheetRowIfEnabled(input: {
  envConfig: ReturnType<typeof getEnv>;
  googleClient: GoogleApiClient | null;
  toolName: string;
  action: string;
  args: Record<string, unknown>;
  result?: unknown;
  principalId?: string;
  requestId?: string;
  duration: number;
  success: boolean;
}): Promise<void> {
  if (!input.envConfig.ENABLE_ACTION_LOG_SHEET) {
    return;
  }

  if (!input.envConfig.ACTION_LOG_SPREADSHEET_ID || !input.googleClient?.sheets) {
    return;
  }

  if (!isActionLogMutation(input.action)) {
    return;
  }

  const spreadsheetId = resolveActionLogSpreadsheetId(input.args, input.result);
  if (!spreadsheetId) {
    return;
  }

  try {
    await appendAuditLogRow(
      input.googleClient.sheets,
      input.envConfig.ACTION_LOG_SPREADSHEET_ID,
      input.envConfig.ACTION_LOG_SHEET_NAME,
      {
        timestamp: new Date().toISOString(),
        tool: input.toolName,
        action: input.action,
        spreadsheetId,
        userId: input.principalId ?? input.requestId ?? 'anonymous',
        success: input.success,
        durationMs: input.duration,
      }
    );
  } catch {
    // Action log sheet writes are non-critical — never block tool execution.
  }
}

function getTaskAbortControllers(taskStore: RegisteredTaskStore): Map<string, AbortController> {
  const existing = taskAbortControllersByStore.get(taskStore);
  if (existing) {
    return existing;
  }

  const controllers = new Map<string, AbortController>();
  taskAbortControllersByStore.set(taskStore, controllers);
  return controllers;
}

function getTaskWatchdogTimers(taskStore: RegisteredTaskStore): Map<string, NodeJS.Timeout> {
  const existing = taskWatchdogTimersByStore.get(taskStore);
  if (existing) {
    return existing;
  }

  const timers = new Map<string, NodeJS.Timeout>();
  taskWatchdogTimersByStore.set(taskStore, timers);
  return timers;
}

function ensureTaskCancellationControlPlane(taskStore: RegisteredTaskStore): {
  abortControllers: Map<string, AbortController>;
  watchdogTimers: Map<string, NodeJS.Timeout>;
} {
  const abortControllers = getTaskAbortControllers(taskStore);
  const watchdogTimers = getTaskWatchdogTimers(taskStore);

  if (!taskCancelHandlersRegistered.has(taskStore)) {
    registerServerTaskCancelHandler({
      taskStore,
      taskAbortControllers: abortControllers,
      taskWatchdogTimers: watchdogTimers,
      log: logger,
    });
    taskCancelHandlersRegistered.add(taskStore);
  }

  return { abortControllers, watchdogTimers };
}

const parseForHandler = <T>(
  schema: ZodTypeAny,
  args: unknown,
  schemaName: string,
  toolName?: string
): T => {
  try {
    return parseWithCache(schema as ZodSchema<T>, args, schemaName);
  } catch (error) {
    if (!(error instanceof z.ZodError) || !toolName) {
      throw error;
    }

    const availableActions = TOOL_ACTIONS[toolName] ?? [];
    if (availableActions.length === 0) {
      throw error;
    }

    const attemptedAction = extractAttemptedAction(args);
    const hasActionIssue = error.issues.some((issue) =>
      shouldEnhanceActionIssue(issue, attemptedAction)
    );

    if (!hasActionIssue) {
      throw error;
    }

    const enhancedIssues = error.issues.map((issue) => {
      if (!shouldEnhanceActionIssue(issue, attemptedAction)) {
        return issue;
      }

      const messagePath = issue.path.length > 0 ? issue.path : (['action'] as PropertyKey[]);

      return {
        ...issue,
        message: formatActionValidationMessage(messagePath, availableActions),
        options: availableActions,
      } as unknown as z.ZodIssue;
    });

    if (attemptedAction && attemptedAction.toLowerCase().includes('rename')) {
      enhancedIssues.push({
        code: 'custom',
        path: ['_hint'],
        message: 'Hint: To rename a sheet, use action="update_sheet" with the "title" parameter.',
      } as z.ZodIssue);
    }

    throw new z.ZodError(enhancedIssues);
  }
};

// ============================================================================
// HANDLER MAPPING
// ============================================================================

/**
 * Creates a map of tool names to handler functions
 *
 * Each handler receives validated input and returns structured output.
 * The MCP SDK validates input against inputSchema before calling the handler.
 */
export function createToolHandlerMap(
  handlers: Handlers,
  authHandler?: AuthHandler,
  googleClient?: GoogleApiClient | null
): Record<string, (args: unknown, extra?: unknown) => Promise<unknown>> {
  const map: Record<string, (args: unknown, extra?: unknown) => Promise<unknown>> = {
    sheets_core: (args) =>
      handlers.core.handle(
        parseForHandler<Parameters<Handlers['core']['handle']>[0]>(
          SheetsCoreInputSchemaLegacy,
          args,
          'SheetsCoreInput',
          'sheets_core'
        )
      ),
    sheets_data: (args) =>
      handlers.data.handle(
        parseForHandler<Parameters<Handlers['data']['handle']>[0]>(
          SheetsDataInputSchemaLegacy,
          args,
          'SheetsDataInput',
          'sheets_data'
        )
      ),
    sheets_format: (args) =>
      handlers.format.handle(
        parseForHandler<Parameters<Handlers['format']['handle']>[0]>(
          SheetsFormatInputSchemaLegacy,
          args,
          'SheetsFormatInput',
          'sheets_format'
        )
      ),
    sheets_dimensions: (args) =>
      handlers.dimensions.handle(
        parseForHandler<Parameters<Handlers['dimensions']['handle']>[0]>(
          SheetsDimensionsInputSchemaLegacy,
          args,
          'SheetsDimensionsInput',
          'sheets_dimensions'
        )
      ),
    sheets_visualize: (args) =>
      handlers.visualize.handle(
        parseForHandler<Parameters<Handlers['visualize']['handle']>[0]>(
          SheetsVisualizeInputSchemaLegacy,
          args,
          'SheetsVisualizeInput',
          'sheets_visualize'
        )
      ),
    sheets_collaborate: (args) =>
      handlers.collaborate.handle(
        parseForHandler<Parameters<Handlers['collaborate']['handle']>[0]>(
          SheetsCollaborateInputSchemaLegacy,
          args,
          'SheetsCollaborateInput',
          'sheets_collaborate'
        )
      ),
    sheets_advanced: (args) =>
      handlers.advanced.handle(
        parseForHandler<Parameters<Handlers['advanced']['handle']>[0]>(
          SheetsAdvancedInputSchemaLegacy,
          args,
          'SheetsAdvancedInput',
          'sheets_advanced'
        )
      ),
    sheets_transaction: (args) =>
      handlers.transaction.handle(
        parseForHandler<Parameters<Handlers['transaction']['handle']>[0]>(
          SheetsTransactionInputSchemaLegacy,
          args,
          'SheetsTransactionInput',
          'sheets_transaction'
        )
      ),
    sheets_quality: (args) =>
      handlers.quality.handle(
        parseForHandler<Parameters<Handlers['quality']['handle']>[0]>(
          SheetsQualityInputSchemaLegacy,
          args,
          'SheetsQualityInput',
          'sheets_quality'
        )
      ),
    sheets_history: (args) =>
      handlers.history.handle(
        parseForHandler<Parameters<Handlers['history']['handle']>[0]>(
          SheetsHistoryInputSchemaLegacy,
          args,
          'SheetsHistoryInput',
          'sheets_history'
        )
      ),
    // MCP-native tools (use Server instance from context for Elicitation/Sampling)
    sheets_confirm: (args) =>
      handlers.confirm.handle(
        parseForHandler<Parameters<Handlers['confirm']['handle']>[0]>(
          SheetsConfirmInputSchemaLegacy,
          args,
          'SheetsConfirmInput',
          'sheets_confirm'
        )
      ),
    sheets_analyze: (args) =>
      handlers.analyze.handle(
        parseForHandler<Parameters<Handlers['analyze']['handle']>[0]>(
          SheetsAnalyzeInputSchemaLegacy,
          args,
          'SheetsAnalyzeInput',
          'sheets_analyze'
        )
      ),
    sheets_fix: (args) =>
      handlers.fix.handle(
        parseForHandler<Parameters<Handlers['fix']['handle']>[0]>(
          SheetsFixInputSchemaLegacy,
          args,
          'SheetsFixInput',
          'sheets_fix'
        )
      ),
    // Composite operations
    sheets_composite: (args) =>
      handlers.composite.handle(
        parseForHandler<Parameters<Handlers['composite']['handle']>[0]>(
          CompositeInputSchemaLegacy,
          args,
          'CompositeInput',
          'sheets_composite'
        )
      ),
    // Session context for NL excellence
    sheets_session: (args) =>
      handlers.session.handle(
        parseForHandler<Parameters<Handlers['session']['handle']>[0]>(
          SheetsSessionInputSchemaLegacy,
          args,
          'SheetsSessionInput',
          'sheets_session'
        )
      ),
    // Tier 7 Enterprise tools
    sheets_templates: (args) =>
      handlers.templates.handle(
        parseForHandler<Parameters<Handlers['templates']['handle']>[0]>(
          SheetsTemplatesInputSchemaLegacy,
          args,
          'SheetsTemplatesInput',
          'sheets_templates'
        )
      ),
    sheets_bigquery: (args) =>
      handlers.bigquery.handle(
        parseForHandler<Parameters<Handlers['bigquery']['handle']>[0]>(
          SheetsBigQueryInputSchemaLegacy,
          args,
          'SheetsBigQueryInput',
          'sheets_bigquery'
        )
      ),
    sheets_appsscript: (args) =>
      handlers.appsscript.handle(
        parseForHandler<Parameters<Handlers['appsscript']['handle']>[0]>(
          SheetsAppsScriptInputSchemaLegacy,
          args,
          'SheetsAppsScriptInput',
          'sheets_appsscript'
        )
      ),
    sheets_webhook: (args) =>
      handlers.webhooks.handle(
        parseForHandler<Parameters<Handlers['webhooks']['handle']>[0]>(
          SheetsWebhookInputSchemaLegacy,
          args,
          'SheetsWebhookInput',
          'sheets_webhook'
        )
      ),
    sheets_dependencies: (args) =>
      handlers.dependencies.handle(
        parseForHandler<Parameters<Handlers['dependencies']['handle']>[0]>(
          SheetsDependenciesInputSchemaLegacy,
          args,
          'SheetsDependenciesInput',
          'sheets_dependencies'
        )
      ),
    sheets_federation: (args) =>
      handlers.federation.handle(
        parseForHandler<Parameters<Handlers['federation']['handle']>[0]>(
          SheetsFederationInputSchemaLegacy,
          args,
          'SheetsFederationInput',
          'sheets_federation'
        )
      ),
    // Phase 5: Computation Engine
    sheets_compute: (args) =>
      handlers.compute.handle(
        parseForHandler<Parameters<Handlers['compute']['handle']>[0]>(
          SheetsComputeInputSchemaLegacy,
          args,
          'SheetsComputeInput',
          'sheets_compute'
        )
      ),
    // Phase 6: Agent Loop
    sheets_agent: (args) =>
      handlers.agent.handle(
        parseForHandler<Parameters<Handlers['agent']['handle']>[0]>(
          SheetsAgentInputSchemaLegacy,
          args,
          'SheetsAgentInput',
          'sheets_agent'
        )
      ),
    // Wave 6: Live Data Connectors
    sheets_connectors: (args) =>
      handlers.connectors.handle(
        parseForHandler<Parameters<Handlers['connectors']['handle']>[0]>(
          SheetsConnectorsInputSchemaLegacy,
          args,
          'SheetsConnectorsInput',
          'sheets_connectors'
        )
      ),
  };

  if (authHandler) {
    map['sheets_auth'] = (args) =>
      authHandler.handle(
        parseForHandler<Parameters<AuthHandler['handle']>[0]>(
          SheetsAuthInputSchemaLegacy,
          args,
          'SheetsAuthInput',
          'sheets_auth'
        )
      );
  }

  const withRequestMetadataCache = (
    fn: (args: unknown, extra?: unknown) => Promise<unknown>
  ): ((args: unknown, extra?: unknown) => Promise<unknown>) => {
    if (!googleClient?.sheets) {
      return fn;
    }

    return async (args: unknown, extra?: unknown) => {
      const requestContext = getRequestContext();
      if (requestContext?.metadataCache) {
        return fn(args, extra);
      }

      const metadataCache = createMetadataCache(googleClient.sheets);
      if (requestContext) {
        requestContext.metadataCache = metadataCache;
      }

      try {
        return await fn(args, extra);
      } finally {
        if (requestContext?.metadataCache === metadataCache) {
          delete requestContext.metadataCache;
        }
        metadataCache.clear();
      }
    };
  };

  for (const [toolName, fn] of Object.entries(map)) {
    map[toolName] = withRequestMetadataCache(fn);
  }

  // Build final map (with optional idempotency wrapping)
  const finalMap = getEnv().ENABLE_IDEMPOTENCY ? wrapToolMapWithIdempotency(map) : map;

  // Register pipeline dispatcher so SessionHandler.execute_pipeline can call other tools.
  // Using a registry module avoids circular imports between tool-handlers ↔ session.
  registerPipelineDispatch((tool: string, args: Record<string, unknown>) => {
    const fn = finalMap[tool];
    if (!fn) return Promise.reject(new Error(`Unknown tool in pipeline: ${tool}`));
    return fn(args) as Promise<unknown>;
  });

  return finalMap;
}

// ============================================================================
// RESPONSE BUILDING
// ============================================================================

export function buildToolResponse(
  result: unknown,
  toolName?: string,
  outputSchema?: ZodTypeAny
): CallToolResult {
  return buildNormalizedToolResponse(result, toolName, outputSchema);
}

// ============================================================================
// HISTORY RECORDING HELPERS
// ============================================================================
// Note: Extraction helpers moved to extraction-helpers.ts for reusability

// ============================================================================
// TOOL CALL HANDLER
// ============================================================================

export { normalizeToolArgs } from './tool-arg-normalization.js';

function createToolCallHandler(
  tool: ToolDefinition,
  handlerMap: Record<string, (args: unknown, extra?: unknown) => Promise<unknown>> | null,
  googleClient: GoogleApiClient | null,
  requestQueue: PQueue,
  registrationState: LegacyToolRegistrationState
): (
  args: Record<string, unknown>,
  extra?: {
    requestId?: string | number;
    elicit?: unknown;
    sample?: unknown;
    sendNotification?: (
      notification: import('@modelcontextprotocol/sdk/types.js').ServerNotification
    ) => Promise<void>;
    sendRequest?: RelatedRequestSender;
    taskId?: string;
    taskStore?: TaskStatusUpdater;
    abortSignal?: AbortSignal;
    signal?: AbortSignal;
    progressToken?: string | number;
    requestInfo?: Pick<RequestInfo, 'headers'>;
    _meta?: { progressToken?: string | number };
  }
) => Promise<CallToolResult> {
  return async (
    args: Record<string, unknown>,
    extra?: {
      requestId?: string | number;
      elicit?: unknown;
      sample?: unknown;
      sendNotification?: (
        notification: import('@modelcontextprotocol/sdk/types.js').ServerNotification
      ) => Promise<void>;
      sendRequest?: RelatedRequestSender;
      taskId?: string;
      taskStore?: TaskStatusUpdater;
      abortSignal?: AbortSignal;
      signal?: AbortSignal;
      progressToken?: string | number;
      requestInfo?: Pick<RequestInfo, 'headers'>;
      _meta?: { progressToken?: string | number };
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
      requestHeaders?: Record<string, string | string[] | undefined>;
    }
  ) => {
    const parentRequestContext = getRequestContext();
    const requestId =
      extra?.requestId !== undefined ? String(extra.requestId) : parentRequestContext?.requestId;
    const requestHeaders =
      extra?.requestHeaders ?? normalizeRequestHeaders(extra?.requestInfo?.headers);
    const progressToken = extra?._meta?.progressToken ?? extra?.progressToken;
    const requestAbortSignal = mergeAbortSignals(
      extra?.abortSignal ?? extra?.signal,
      registrationState.abortController.signal
    );

    // Extract trace context from extra params or headers (W3C Trace Context support)
    // Auto-generate if not provided to ensure all requests have traceId for correlation
    const traceId =
      extra?.traceId ||
      getHeaderValue(requestHeaders?.['x-trace-id']) ||
      parentRequestContext?.traceId ||
      randomUUID();
    const spanId =
      extra?.spanId ||
      getHeaderValue(requestHeaders?.['x-span-id']) ||
      parentRequestContext?.spanId ||
      randomUUID();
    const parentSpanId =
      extra?.parentSpanId ||
      getHeaderValue(requestHeaders?.['x-parent-span-id']) ||
      parentRequestContext?.parentSpanId;
    const principalId =
      getHeaderValue(requestHeaders?.['x-user-id']) ||
      getHeaderValue(requestHeaders?.['x-session-id']) ||
      getHeaderValue(requestHeaders?.['x-client-id']) ||
      parentRequestContext?.principalId;

    const requestContext = createRequestContext({
      requestId,
      traceId,
      spanId,
      parentSpanId,
      principalId,
      abortSignal: requestAbortSignal,
      sendNotification: extra?.sendNotification,
      sendRequest: extra?.sendRequest,
      taskId: extra?.taskId,
      taskStore: extra?.taskStore,
      progressToken,
      idempotencyKey: requestHeaders
        ? extractIdempotencyKeyFromHeaders(requestHeaders)
        : parentRequestContext?.idempotencyKey,
      sessionContext: parentRequestContext?.sessionContext,
    });
    const costTrackingTenantId = resolveCostTrackingTenantId({
      headers: requestHeaders,
    });

    // Generate operation ID and start time for history tracking
    const operationId = randomUUID();
    const startTime = Date.now();
    const timestamp = new Date(startTime).toISOString();

    if (registrationState.disposed) {
      return buildToolResponse({
        response: {
          success: false,
          error: {
            code: 'OPERATION_CANCELLED',
            message: 'MCP session closed',
            retryable: false,
          },
        },
      });
    }

    updateQueueMetrics(requestQueue.size, requestQueue.pending);

    return requestQueue.add(async () => {
      if (requestAbortSignal?.aborted) {
        throw createRequestAbortError(requestAbortSignal.reason, 'MCP session closed');
      }

      return runWithRequestContext(requestContext, async () => {
        requestContext.logger.debug('Tool call queued', {
          toolName: tool.name,
          queueSize: requestQueue.size,
          pendingCount: requestQueue.pending,
          traceId: requestContext.traceId,
          spanId: requestContext.spanId,
        });

        if (requestContext.abortSignal?.aborted) {
          throw createRequestAbortError(requestContext.abortSignal.reason);
        }

        recordSpreadsheetId(args);
        const rawArgs = args as Record<string, unknown>;
        const rawAction = ((rawArgs['request'] as Record<string, unknown> | undefined)?.[
          'action'
        ] ?? rawArgs['action']) as string | undefined;
        const isExempt = isToolCallAuthExempt(tool.name, rawAction);

        if (!isExempt) {
          const authResult = await checkAuthAsync(googleClient);
          if (!authResult.authenticated) {
            return buildToolResponse(buildAuthErrorResponse(authResult.error!));
          }
        }

        if (!handlerMap) {
          if (isExempt) {
            const preInitResult = await handlePreInitExemptToolCall(tool.name, rawArgs);
            if (preInitResult) {
              return buildToolResponse(preInitResult as Record<string, unknown>);
            }
          }

          const errorResponse = {
            response: {
              success: false,
              error: {
                code: 'AUTHENTICATION_REQUIRED',
                message: 'Google API client not initialized. Please provide credentials.',
                retryable: false,
                suggestedFix: 'Set GOOGLE_APPLICATION_CREDENTIALS or configure OAuth',
              },
            },
          };

          // Record failed operation in history
          const historyService = getHistoryService();
          historyService.record({
            id: operationId,
            timestamp,
            tool: tool.name,
            action: extractAction(args),
            params: args,
            result: 'error',
            duration: Date.now() - startTime,
            errorMessage: 'Google API client not initialized. Please provide credentials.',
            errorCode: 'AUTHENTICATION_REQUIRED',
            requestId,
            spreadsheetId: extractSpreadsheetId(args),
          });

          return buildToolResponse(errorResponse);
        }

        const handler = handlerMap[tool.name];
        if (!handler) {
          if (isExempt) {
            const preInitResult = await handlePreInitExemptToolCall(tool.name, rawArgs);
            if (preInitResult) {
              return buildToolResponse(preInitResult as Record<string, unknown>);
            }
          }

          const errorResponse = {
            response: {
              success: false,
              error: {
                code: 'NOT_IMPLEMENTED',
                message: `Handler for ${tool.name} not yet implemented`,
                retryable: false,
                suggestedFix: 'This tool is planned for a future release',
              },
            },
          };

          // Record failed operation in history
          const historyService = getHistoryService();
          historyService.record({
            id: operationId,
            timestamp,
            tool: tool.name,
            action: extractAction(args),
            params: args,
            result: 'error',
            duration: Date.now() - startTime,
            errorMessage: `Handler for ${tool.name} not yet implemented`,
            errorCode: 'NOT_IMPLEMENTED',
            requestId,
            spreadsheetId: extractSpreadsheetId(args),
          });

          return buildToolResponse(errorResponse);
        }

        const keepalive = startKeepalive({
          operationName: tool.name,
          debug: process.env['DEBUG_KEEPALIVE'] === 'true',
        });

        try {
          const localParentSpanId = requestContext.spanId;
          const remoteParentSpanId = requestContext.parentSpanId;
          const toolSpanParent =
            requestContext.traceId && requestContext.spanId
              ? {
                  traceId: requestContext.traceId,
                  spanId: requestContext.spanId,
                  traceFlags: 1,
                }
              : undefined;

          // Execute handler with distributed tracing
          const result = await withToolSpan(
            tool.name,
            async (span) => {
              const previousTraceId = requestContext.traceId;
              const previousSpanId = requestContext.spanId;
              const previousParentSpanId = requestContext.parentSpanId;

              // Propagate active tool span for downstream API traceparent headers.
              requestContext.traceId = span.context.traceId;
              requestContext.spanId = span.context.spanId;
              requestContext.parentSpanId = span.parentSpanId ?? previousParentSpanId;

              // Add span attributes for observability
              const action = extractAction(args);
              const spreadsheetId = extractSpreadsheetId(args);
              const sheetId = extractSheetId(args);

              span.setAttributes({
                'tool.name': tool.name,
                'tool.action': action,
                'operation.id': operationId,
                'request.id': requestId || 'unknown',
                ...(localParentSpanId && { 'trace.local_parent_span_id': localParentSpanId }),
                ...(remoteParentSpanId && { 'trace.remote_parent_span_id': remoteParentSpanId }),
                ...(spreadsheetId && { 'spreadsheet.id': spreadsheetId }),
                ...(sheetId && { 'sheet.id': sheetId.toString() }),
              });

              // ISSUE-107: Detect legacy invocation patterns before normalizing
              const legacyWarning = detectLegacyInvocation(args);
              if (legacyWarning) {
                logger.debug('Legacy MCP invocation pattern detected', {
                  tool: tool.name,
                  warning: legacyWarning,
                  requestId,
                });
              }

              try {
                // Per-user rate limiting (token bucket, configured via RATE_LIMIT_*)
                const principalId = requestContext.principalId ?? 'anonymous';
                const rateCheck = checkRateLimit(principalId);
                if (!rateCheck.allowed) {
                  return {
                    response: {
                      success: false,
                      error: {
                        code: 'RATE_LIMITED',
                        message: `Rate limit exceeded. Retry after ${rateCheck.retryAfterMs}ms.`,
                        retryable: true,
                        retryAfterMs: rateCheck.retryAfterMs,
                      },
                    },
                  };
                }

                // Execute handler - pass extra context for MCP-native tools
                // Write lock: serialize mutations per spreadsheetId (reads bypass)
                const normalizedArgs = normalizeToolArgs(args);

                // Extract verbosity from input args and record on request context
                // for pipeline-level verbosity filtering in tool-response.ts
                const reqBody = (normalizedArgs as Record<string, unknown>)['request'] as
                  | Record<string, unknown>
                  | undefined;
                const rawVerbosity = reqBody?.['verbosity'] ?? (normalizedArgs as Record<string, unknown>)['verbosity'];
                if (
                  rawVerbosity === 'minimal' ||
                  rawVerbosity === 'standard' ||
                  rawVerbosity === 'detailed'
                ) {
                  recordRequestVerbosity(rawVerbosity);
                }

                const mutationSafetyViolation = detectMutationSafetyViolation(normalizedArgs);
                if (mutationSafetyViolation) {
                  return {
                    response: {
                      success: false,
                      error: {
                        code: 'FORMULA_INJECTION_BLOCKED',
                        message:
                          `Dangerous formula detected at ${mutationSafetyViolation.path}: ` +
                          `${mutationSafetyViolation.preview}. ` +
                          'Set safety.sanitizeFormulas=false to allow.',
                        retryable: false,
                        suggestedFix:
                          'Remove formulas containing IMPORTDATA, IMPORTRANGE, IMPORTFEED, IMPORTHTML, IMPORTXML, GOOGLEFINANCE, or QUERY from mutation payloads.',
                      },
                    },
                  };
                }
                const handlerResult = await withWriteLock(normalizedArgs, () =>
                  handler(normalizedArgs, extra)
                );

                // ISSUE-107: Inject protocol version (always) + deprecation warning (if legacy)
                if (
                  handlerResult &&
                  typeof handlerResult === 'object' &&
                  'response' in handlerResult &&
                  handlerResult.response &&
                  typeof handlerResult.response === 'object'
                ) {
                  const response = handlerResult.response as Record<string, unknown>;
                  const existingMeta =
                    response['_meta'] && typeof response['_meta'] === 'object'
                      ? (response['_meta'] as Record<string, unknown>)
                      : {};
                  response['_meta'] = {
                    ...existingMeta,
                    protocolVersion: '2025-11-25',
                    ...(legacyWarning ? { deprecationWarning: legacyWarning } : {}),
                  };
                }

                // Add result attributes to span
                span.setAttributes({
                  'result.success': isSuccessResult(handlerResult),
                  'cells.affected': extractCellsAffected(handlerResult) || 0,
                });

                return handlerResult;
              } finally {
                requestContext.traceId = previousTraceId;
                requestContext.spanId = previousSpanId;
                requestContext.parentSpanId = previousParentSpanId;
              }
            },
            {
              'mcp.protocol.version': '2025-11-25',
              'service.name': 'servalsheets',
            },
            toolSpanParent
          );

          const duration = Date.now() - startTime;
          const spreadsheetId = resolveActionLogSpreadsheetId(args, result);
          const action = extractAction(args);
          const status = isSuccessResult(result) ? 'success' : 'error';
          const principalId = requestContext.principalId ?? 'anonymous';
          const nowMs = Date.now();
          pruneSelfCorrectionFailures(nowMs);
          const correctionKey = buildSelfCorrectionKey(tool.name, principalId);

          // Record operation in history
          const historyService = getHistoryService();
          const operation: OperationHistory = {
            id: operationId,
            timestamp,
            tool: tool.name,
            action,
            params: args,
            result: status,
            duration,
            cellsAffected: extractCellsAffected(result),
            snapshotId: extractSnapshotId(result),
            errorMessage: extractErrorMessage(result),
            errorCode: extractErrorCode(result),
            requestId,
            spreadsheetId,
            sheetId: extractSheetId(args),
          };

          historyService.record(operation);

          // Record metrics for observability
          const durationSeconds = duration / 1000;
          recordToolCall(tool.name, action, status, durationSeconds);
          recordToolCallLatency(tool.name, action, durationSeconds);
          if (status === 'error') {
            recentFailuresByPrincipal.set(correctionKey, { action, timestampMs: nowMs });
          } else {
            const priorFailure = recentFailuresByPrincipal.get(correctionKey);
            if (priorFailure && nowMs - priorFailure.timestampMs <= SELF_CORRECTION_WINDOW_MS) {
              recordSelfCorrection(tool.name, priorFailure.action, action);
              recentFailuresByPrincipal.delete(correctionKey);
            }
          }

          // Record trace for debugging/performance analysis
          const traceAggregator = getTraceAggregator();
          if (traceAggregator.isEnabled()) {
            // Collect spans from the tracer for this request
            const { getTracer } = await import('../../utils/tracing.js');
            const tracer = getTracer();
            const recordedSpans = tracer.getSpans();

            // Convert Span objects to TraceSpan format
            const { TraceAggregatorImpl } = await import('../../services/trace-aggregator.js');
            const convertedSpans = recordedSpans.map((span) =>
              TraceAggregatorImpl.spanToTraceSpan(span)
            );

            traceAggregator.recordTrace({
              requestId: requestId || operationId,
              traceId: traceId || operationId,
              timestamp: startTime,
              duration,
              tool: tool.name,
              action,
              success: status === 'success',
              errorCode: extractErrorCode(result) ?? undefined,
              errorMessage: extractErrorMessage(result) ?? undefined,
              spans: convertedSpans,
            });
          }

          // Track cost per tenant (opt-in via ENABLE_COST_TRACKING)
          const envConfig = getEnv();
          if (envConfig.ENABLE_COST_TRACKING || envConfig.ENABLE_BILLING_INTEGRATION) {
            try {
              // COST-01: Disaggregate API type by tool (bigquery/drive/sheets)
              const apiType =
                tool.name === 'sheets_bigquery'
                  ? 'bigquery'
                  : tool.name === 'sheets_collaborate' || tool.name === 'sheets_history'
                    ? 'drive'
                    : 'sheets';
              getCostTracker().trackApiCall(costTrackingTenantId, apiType);

              // COST-01: Track feature-level usage (rows, transactions)
              if (status === 'success') {
                const resp = (result as Record<string, unknown>)?.['response'] as
                  | Record<string, unknown>
                  | undefined;
                if (resp) {
                  const rowsProcessed =
                    (typeof resp['rowCount'] === 'number' ? resp['rowCount'] : undefined) ??
                    (typeof resp['updatedRows'] === 'number' ? resp['updatedRows'] : undefined);
                  if (typeof rowsProcessed === 'number' && rowsProcessed > 0) {
                    getCostTracker().trackFeatureUsage(
                      costTrackingTenantId,
                      'rowsProcessed',
                      rowsProcessed
                    );
                  }
                  if (tool.name === 'sheets_transaction' && action === 'commit') {
                    getCostTracker().trackFeatureUsage(
                      costTrackingTenantId,
                      'transactionsExecuted'
                    );
                  }
                }
              }
            } catch {
              // Cost tracking is non-critical — never block tool execution
            }
          }

          // Audit logging for compliance (opt-in via ENABLE_AUDIT_LOGGING)
          if (envConfig.ENABLE_AUDIT_LOGGING) {
            try {
              void getAuditLogger().logToolCall({
                tool: tool.name,
                action,
                userId: requestId || 'anonymous',
                spreadsheetId: spreadsheetId || undefined,
                outcome: status === 'success' ? 'success' : 'failure',
                duration,
              });
            } catch {
              // Audit logging is non-critical — never block tool execution
            }
          }

          await appendActionLogSheetRowIfEnabled({
            envConfig,
            googleClient,
            toolName: tool.name,
            action,
            args,
            result,
            principalId,
            requestId,
            duration,
            success: status === 'success',
          });

          // Invalidate sampling context cache after successful mutating operations.
          if (
            status === 'success' &&
            spreadsheetId &&
            shouldInvalidateSamplingContext(tool.name, action)
          ) {
            try {
              invalidateSamplingContext(spreadsheetId);
            } catch (error) {
              logger.debug('Sampling context invalidation skipped', {
                tool: tool.name,
                action,
                spreadsheetId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          return buildToolResponse(result, tool.name, tool.outputSchema);
        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorCodeFromThrown =
            typeof (error as { code?: unknown } | null)?.code === 'string'
              ? String((error as { code?: unknown }).code)
              : undefined;

          const { errorCode: normalizedErrorCode, errorPayload } = buildToolExecutionErrorPayload(
            error,
            tool.name,
            args
          );
          const errorCode = errorCodeFromThrown ?? normalizedErrorCode;

          // Record failed operation in history
          const historyService = getHistoryService();
          historyService.record({
            id: operationId,
            timestamp,
            tool: tool.name,
            action: extractAction(args),
            params: args,
            result: 'error',
            duration,
            errorMessage,
            errorCode,
            requestId,
            spreadsheetId: extractSpreadsheetId(args),
          });

          // Record error metrics
          const action = extractAction(args);
          recordToolCall(tool.name, action, 'error', duration / 1000);
          recordError(error instanceof Error ? error.name : 'UnknownError', tool.name, action);
          const principalId = requestContext.principalId ?? 'anonymous';
          pruneSelfCorrectionFailures(Date.now());
          const correctionKey = buildSelfCorrectionKey(tool.name, principalId);
          recentFailuresByPrincipal.set(correctionKey, { action, timestampMs: Date.now() });

          // Record error trace for debugging
          const traceAggregator = getTraceAggregator();
          if (traceAggregator.isEnabled()) {
            // Collect spans from the tracer for error cases too
            const { getTracer } = await import('../../utils/tracing.js');
            const tracer = getTracer();
            const recordedSpans = tracer.getSpans();

            // Convert Span objects to TraceSpan format
            const { TraceAggregatorImpl } = await import('../../services/trace-aggregator.js');
            const convertedSpans = recordedSpans.map((span) =>
              TraceAggregatorImpl.spanToTraceSpan(span)
            );

            traceAggregator.recordTrace({
              requestId: requestId || operationId,
              traceId: traceId || operationId,
              timestamp: startTime,
              duration,
              tool: tool.name,
              action,
              success: false,
              errorCode,
              errorMessage,
              spans: convertedSpans,
            });
          }

          await appendActionLogSheetRowIfEnabled({
            envConfig: getEnv(),
            googleClient,
            toolName: tool.name,
            action,
            args,
            principalId,
            requestId,
            duration,
            success: false,
          });

          if (isGoogleAuthError(error)) {
            return buildToolResponse(convertGoogleAuthError(error));
          }

          // Return structured error instead of throwing (Task 1.2)
          // buildToolResponse classifies recoverable error codes as non-fatal MCP results.
          const errorResponse = {
            response: {
              success: false,
              error: errorPayload,
            },
          };

          return buildToolResponse(errorResponse);
        } finally {
          keepalive.stop();
        }
      });
    });
  };
}

export function createToolTaskHandler(
  toolName: string,
  runTool: (
    args: Record<string, unknown>,
    extra?:
      | (Record<string, unknown> & {
          requestId?: string | number;
          abortSignal?: AbortSignal;
          signal?: AbortSignal;
        })
      | undefined
  ) => Promise<CallToolResult>
): ToolTaskHandler<AnySchema> {
  const buildCancelledTaskResult = (message: string): CallToolResult =>
    buildToolResponse({
      response: {
        success: false,
        error: {
          code: 'TASK_CANCELLED',
          message,
          retryable: false,
        },
      },
    });

  return {
    createTask: async (args, extra) => {
      if (!extra.taskStore) {
        throw new ServiceError(
          `[${toolName}] Task store not configured`,
          'INTERNAL_ERROR',
          toolName
        );
      }

      const task = await extra.taskStore.createTask({
        ttl: extra.taskRequestedTtl ?? undefined,
      });

      const taskStore = extra.taskStore as unknown as RegisteredTaskStore;
      const { abortControllers, watchdogTimers } = ensureTaskCancellationControlPlane(taskStore);
      const abortController = new AbortController();
      abortControllers.set(task.taskId, abortController);

      const TASK_WATCHDOG_MS = getEnv().TASK_WATCHDOG_MS;
      const watchdogTimer = setTimeout(() => {
        if (abortControllers.has(task.taskId)) {
          logger.warn('Task watchdog: aborting hung task', {
            taskId: task.taskId,
            toolName,
            maxLifetimeMs: TASK_WATCHDOG_MS,
          });
          abortController.abort(
            `Task exceeded maximum runtime of ${(TASK_WATCHDOG_MS / 60000).toFixed(1)} minutes`
          );
          abortControllers.delete(task.taskId);
          watchdogTimers.delete(task.taskId);
        }
      }, TASK_WATCHDOG_MS);
      watchdogTimers.set(task.taskId, watchdogTimer);

      const isTaskStoreCancelled = async (): Promise<boolean> => {
        if (!('isTaskCancelled' in taskStore) || typeof taskStore.isTaskCancelled !== 'function') {
          return false;
        }
        return await taskStore.isTaskCancelled(task.taskId);
      };
      const getCancellationReason = async (): Promise<string> => {
        if (
          'getCancellationReason' in taskStore &&
          typeof taskStore.getCancellationReason === 'function'
        ) {
          return (await taskStore.getCancellationReason(task.taskId)) || 'Task was cancelled';
        }
        return 'Task was cancelled';
      };
      const storeCancelledTaskResult = async (message: string): Promise<void> => {
        // C11: SDK storeTaskResult only accepts 'completed'|'failed'; use 'failed' for
        // cancelled tasks (the task store preserves cancelled status and the payload carries TASK_CANCELLED).
        await taskStore.storeTaskResult(task.taskId, 'failed', buildCancelledTaskResult(message));
      };

      void (async () => {
        try {
          if (await isTaskStoreCancelled()) {
            await storeCancelledTaskResult(await getCancellationReason());
            return;
          }

          const result = await runTool(args as Record<string, unknown>, {
            ...(extra as unknown as Record<string, unknown>),
            taskId: task.taskId,
            taskStore,
            abortSignal: abortController.signal,
            signal: abortController.signal,
          });

          if (await isTaskStoreCancelled()) {
            await storeCancelledTaskResult(await getCancellationReason());
            return;
          }

          await taskStore.storeTaskResult(task.taskId, 'completed', result);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            try {
              await storeCancelledTaskResult(error.message);
            } catch (storeError) {
              // Use structured logging to avoid corrupting stdio transport
              import('../../utils/logger.js')
                .then(({ logger }) => {
                  logger.error('Failed to store cancelled task result', {
                    toolName,
                    error: storeError,
                  });
                })
                .catch(() => {
                  // Fallback if logger import fails
                });
            }
            return;
          }

          if (await isTaskStoreCancelled()) {
            try {
              await storeCancelledTaskResult(await getCancellationReason());
            } catch (storeError) {
              import('../../utils/logger.js')
                .then(({ logger }) => {
                  logger.error('Failed to store cancelled task result', {
                    toolName,
                    error: storeError,
                  });
                })
                .catch(() => {
                  // Fallback if logger import fails
                });
            }
            return;
          }

          const errorResult = buildToolResponse({
            response: {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
            },
          });
          try {
            await taskStore.storeTaskResult(task.taskId, 'failed', errorResult);
          } catch (storeError) {
            // Use structured logging to avoid corrupting stdio transport
            import('../../utils/logger.js')
              .then(({ logger }) => {
                logger.error('Failed to store task result', {
                  toolName,
                  error: storeError,
                });
              })
              .catch(() => {
                // Fallback if logger import fails
              });
          }
        } finally {
          abortControllers.delete(task.taskId);
          clearTimeout(watchdogTimers.get(task.taskId));
          watchdogTimers.delete(task.taskId);
        }
      })();

      return { task };
    },
    getTask: async (_args, extra) => {
      if (!extra.taskStore) {
        throw new ServiceError(
          `[${toolName}] Task store not configured`,
          'INTERNAL_ERROR',
          toolName
        );
      }
      return await extra.taskStore.getTask(extra.taskId);
    },
    getTaskResult: async (_args, extra) => {
      if (!extra.taskStore) {
        throw new ServiceError(
          `[${toolName}] Task store not configured`,
          'INTERNAL_ERROR',
          toolName
        );
      }
      return (await extra.taskStore.getTaskResult(extra.taskId)) as CallToolResult;
    },
  };
}

// ============================================================================
// TOOL REGISTRATION
// ============================================================================

/**
 * Registers all ServalSheets tools with the MCP server
 *
 * Handles SDK compatibility for discriminated union schemas.
 *
 * @param server - McpServer instance
 * @param handlers - Tool handlers (null if not authenticated)
 */
export async function registerServalSheetsTools(
  server: McpServer,
  handlers: Handlers | null,
  options?: { googleClient?: GoogleApiClient | null }
): Promise<LegacyToolRegistration> {
  const requestQueue = new PQueue({
    concurrency: getEnv().MAX_CONCURRENT_REQUESTS,
  });
  const registrationState: LegacyToolRegistrationState = {
    disposed: false,
    abortController: new AbortController(),
  };

  const authHandler = new AuthHandler({
    googleClient: options?.googleClient ?? null,
    elicitationServer: server.server,
  });

  const handlerMap = handlers
    ? createToolHandlerMap(handlers, authHandler, options?.googleClient ?? null)
    : (() => {
        // Pre-auth: only sheets_auth (for login) and local-only tools available
        const sessionHandler = new SessionHandler();
        const samplingServer = createTaskAwareSamplingServer(server.server);
        const preAuthHandlerMap: Record<
          string,
          (args: unknown, extra?: unknown) => Promise<unknown>
        > = {
          sheets_auth: (args: unknown, _extra?: unknown) =>
            authHandler.handle(
              parseForHandler<Parameters<AuthHandler['handle']>[0]>(
                SheetsAuthInputSchema,
                args,
                'SheetsAuthInput',
                'sheets_auth'
              )
            ),
          sheets_confirm: (args: unknown, extra?: unknown) => {
            const requestExtra = extra as { requestId?: string | number } | undefined;
            return new ConfirmHandler({
              context: {
                batchCompiler: {} as never,
                rangeResolver: {} as never,
                server: server.server,
                elicitationServer: server.server,
                samplingServer,
                requestId: requestExtra?.requestId ? String(requestExtra.requestId) : undefined,
              },
            }).handle(
              parseForHandler<Parameters<ConfirmHandler['handle']>[0]>(
                SheetsConfirmInputSchemaLegacy,
                args,
                'SheetsConfirmInput',
                'sheets_confirm'
              )
            );
          },
          sheets_composite: async (args: unknown, _extra?: unknown) => {
            const parsed = parseForHandler<{ request: { action: string } }>(
              CompositeInputSchemaLegacy,
              args,
              'CompositeInput',
              'sheets_composite'
            );

            if (parsed.request.action === 'generate_template') {
              return {
                response: await handleGenerateTemplateAction(parsed.request as never, {
                  samplingServer,
                }),
              };
            }

            if (parsed.request.action === 'preview_generation') {
              return {
                response: await handlePreviewGenerationAction(parsed.request as never, {
                  samplingServer,
                }),
              };
            }

            return {
              response: {
                success: false,
                error: {
                  code: 'AUTHENTICATION_REQUIRED',
                  message: 'Google authentication is required for this sheets_composite action.',
                  retryable: false,
                },
              },
            };
          },
          sheets_session: (args: unknown, _extra?: unknown) =>
            sessionHandler.handle(
              parseForHandler<Parameters<SessionHandler['handle']>[0]>(
                SheetsSessionInputSchemaLegacy,
                args,
                'SheetsSessionInput',
                'sheets_session'
              )
            ),
        };
        return preAuthHandlerMap;
      })();

  assertValidMcpToolNames(ACTIVE_TOOL_DEFINITIONS);

  for (const tool of ACTIVE_TOOL_DEFINITIONS) {
    // Live SDK registration must stay on native Zod schemas. tools/list uses a
    // separate compatibility layer for deferred and compact JSON Schema output.
    const inputSchemaForRegistration = tool.inputSchema;
    const outputSchemaForRegistration = tool.outputSchema;

    // Register tool with prepared schemas
    // Type assertion needed due to TypeScript's deep type instantiation limits
    const execution = TOOL_EXECUTION_CONFIG[tool.name];
    const supportsTasks = execution?.taskSupport && execution.taskSupport !== 'forbidden';
    const runTool = createToolCallHandler(
      tool,
      handlerMap as Record<string, (args: unknown, extra?: unknown) => Promise<unknown>> | null,
      options?.googleClient ?? null,
      requestQueue,
      registrationState
    );

    if (supportsTasks) {
      const taskHandler = createToolTaskHandler(tool.name, runTool);
      const taskSupport = execution?.taskSupport === 'required' ? 'required' : 'optional';
      const taskExecution = {
        ...(execution ?? {}),
        taskSupport,
      };

      server.experimental.tasks.registerToolTask<AnySchema, AnySchema>(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: inputSchemaForRegistration as AnySchema,
          outputSchema: outputSchemaForRegistration as AnySchema,
          annotations: tool.annotations,
          execution: taskExecution,
        } as Parameters<typeof server.experimental.tasks.registerToolTask<AnySchema, AnySchema>>[1],
        taskHandler
      );
      continue;
    }

    (
      server.registerTool as (
        name: string,
        config: {
          title?: string;
          description?: string;
          inputSchema?: unknown;
          outputSchema?: unknown;
          annotations?: ToolAnnotations;
          icons?: import('@modelcontextprotocol/sdk/types.js').Icon[];
          execution?: import('@modelcontextprotocol/sdk/types.js').ToolExecution;
        },
        cb: (
          args: Record<string, unknown>,
          extra?: {
            requestId?: string | number;
            elicit?: unknown;
            sample?: unknown;
          }
        ) => Promise<CallToolResult>
      ) => void
    )(
      tool.name,
      {
        title: tool.annotations.title,
        description: tool.description,
        inputSchema: inputSchemaForRegistration,
        outputSchema: outputSchemaForRegistration,
        annotations: tool.annotations,
        icons: TOOL_ICONS[tool.name],
        execution,
      },
      runTool
    );
  }

  // Override tools/list to safely serialize schemas with transforms/pipes.
  registerToolsListCompatibilityHandler(server);

  if (getEnv().ENABLE_TOOLS_LIST_CHANGED_NOTIFICATIONS) {
    resourceNotifications.syncToolList(
      ACTIVE_TOOL_DEFINITIONS.map((tool) => tool.name),
      {
        emitOnFirstSet: false,
        reason: 'registered active tool definitions',
      }
    );
  }

  replaceAvailableToolNames(ACTIVE_TOOL_DEFINITIONS.map((tool) => tool.name));

  // NOTE: We register unwrapped object schemas for tools/list compatibility.
  // Legacy request envelopes are handled during validation via wrapInputSchemaForLegacyRequest.

  return {
    dispose: () => {
      if (registrationState.disposed) {
        return;
      }

      registrationState.disposed = true;
      registrationState.abortController.abort('MCP session closed');
      requestQueue.clear();
      updateQueueMetrics(requestQueue.size, requestQueue.pending);
    },
  };
}
