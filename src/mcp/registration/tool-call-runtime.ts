import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createRequestAbortError,
  runWithRequestContext,
  type RequestContext,
} from '../../utils/request-context.js';
import { recordSpreadsheetId } from '../completions.js';
import { convertGoogleAuthError, isGoogleAuthError } from '../../utils/auth-guard.js';
import { startKeepalive, type KeepaliveHandle } from '../../utils/keepalive.js';
import { extractAction } from './extraction-helpers.js';
import { resolveToolCallPreflight, type ToolCallPreflightResult } from './tool-call-preflight.js';
import { executeTracedToolCall } from './tool-call-execution.js';
import { buildToolExecutionErrorPayload } from './tool-execution-error.js';
import {
  recordFailedToolExecution,
  recordSuccessfulToolExecution,
} from './tool-execution-side-effects.js';
import { buildToolResponse } from './tool-response.js';
import type { ToolDefinition } from './tool-definitions.js';
import type { ToolHandlerMap } from './tool-handler-map.js';
import type { ToolExecutionExtra } from './tool-registration.js';
import type { GoogleApiClient } from '../../services/google-api.js';

type ToolHandler = ToolHandlerMap[string];

type ToolDefinitionRuntimeShape = Pick<ToolDefinition, 'name' | 'outputSchema'>;

export interface ToolCallRuntimeInput {
  tool: ToolDefinitionRuntimeShape;
  args: Record<string, unknown>;
  extra?: ToolExecutionExtra;
  handlerMap: ToolHandlerMap | null;
  googleClient: GoogleApiClient | null;
  requestAbortSignal?: AbortSignal;
  requestContext: RequestContext;
  requestId?: string;
  traceId?: string;
  operationId: string;
  startTime: number;
  timestamp: string;
  costTrackingTenantId: string;
}

export interface ToolCallRuntimeDependencies {
  createAbortError?: typeof createRequestAbortError;
  runWithContext?: typeof runWithRequestContext;
  recordSpreadsheet?: typeof recordSpreadsheetId;
  resolvePreflight?: (input: {
    tool: Pick<ToolDefinition, 'name'>;
    args: Record<string, unknown>;
    handlerMap: ToolHandlerMap | null;
    googleClient: GoogleApiClient | null;
    operationId: string;
    timestamp: string;
    startTime: number;
    requestId?: string;
  }) => Promise<ToolCallPreflightResult>;
  startKeepalive?: (options: { operationName: string; debug?: boolean }) => KeepaliveHandle;
  executeToolCall?: (input: {
    tool: Pick<ToolDefinition, 'name'>;
    args: Record<string, unknown>;
    extra?: ToolExecutionExtra;
    handler: ToolHandler;
    requestContext: RequestContext;
    operationId: string;
    requestId?: string;
  }) => Promise<unknown>;
  buildErrorPayload?: typeof buildToolExecutionErrorPayload;
  recordSuccessful?: typeof recordSuccessfulToolExecution;
  recordFailed?: typeof recordFailedToolExecution;
  isGoogleAuthError?: typeof isGoogleAuthError;
  convertGoogleAuthError?: typeof convertGoogleAuthError;
  buildToolResponse?: typeof buildToolResponse;
}

export async function executeToolCallRuntime(
  input: ToolCallRuntimeInput,
  dependencies: ToolCallRuntimeDependencies = {}
): Promise<CallToolResult> {
  const createAbortError = dependencies.createAbortError ?? createRequestAbortError;
  const runWithContext = dependencies.runWithContext ?? runWithRequestContext;
  const recordSpreadsheet = dependencies.recordSpreadsheet ?? recordSpreadsheetId;
  const resolvePreflight = dependencies.resolvePreflight ?? resolveToolCallPreflight;
  const startKeepaliveFn = dependencies.startKeepalive ?? startKeepalive;
  const executeToolCall = dependencies.executeToolCall ?? executeTracedToolCall;
  const buildErrorPayload = dependencies.buildErrorPayload ?? buildToolExecutionErrorPayload;
  const recordSuccessful = dependencies.recordSuccessful ?? recordSuccessfulToolExecution;
  const recordFailed = dependencies.recordFailed ?? recordFailedToolExecution;
  const isGoogleAuthErrorFn = dependencies.isGoogleAuthError ?? isGoogleAuthError;
  const convertGoogleAuthErrorFn = dependencies.convertGoogleAuthError ?? convertGoogleAuthError;
  const buildToolResponseFn = dependencies.buildToolResponse ?? buildToolResponse;

  if (input.requestAbortSignal?.aborted) {
    throw createAbortError(input.requestAbortSignal.reason, 'MCP session closed');
  }

  return runWithContext(input.requestContext, async () => {
    input.requestContext.logger.debug('Tool call queued', {
      toolName: input.tool.name,
      traceId: input.requestContext.traceId,
      spanId: input.requestContext.spanId,
    });

    if (input.requestContext.abortSignal?.aborted) {
      throw createAbortError(input.requestContext.abortSignal.reason);
    }

    recordSpreadsheet(input.args);
    const preflight = await resolvePreflight({
      tool: input.tool,
      args: input.args,
      handlerMap: input.handlerMap,
      googleClient: input.googleClient,
      operationId: input.operationId,
      timestamp: input.timestamp,
      startTime: input.startTime,
      requestId: input.requestId,
    });

    if (preflight.kind === 'response') {
      return preflight.response;
    }

    const keepalive = startKeepaliveFn({
      operationName: input.tool.name,
      debug: process.env['DEBUG_KEEPALIVE'] === 'true',
    });

    try {
      const result = await executeToolCall({
        tool: input.tool,
        args: input.args,
        extra: input.extra,
        handler: preflight.handler,
        requestContext: input.requestContext,
        operationId: input.operationId,
        requestId: input.requestId,
      });

      const duration = Date.now() - input.startTime;
      const action = extractAction(input.args);
      const principalId = input.requestContext.principalId ?? 'anonymous';
      await recordSuccessful({
        toolName: input.tool.name,
        action,
        args: input.args,
        result,
        operationId: input.operationId,
        timestamp: input.timestamp,
        startTime: input.startTime,
        duration,
        requestId: input.requestId,
        traceId: input.traceId,
        principalId,
        costTrackingTenantId: input.costTrackingTenantId,
      });

      return buildToolResponseFn(result, input.tool.name, input.tool.outputSchema);
    } catch (error) {
      const duration = Date.now() - input.startTime;
      const { errorCode, errorMessage, errorPayload } = buildErrorPayload(error, input.tool.name);
      const action = extractAction(input.args);
      const principalId = input.requestContext.principalId ?? 'anonymous';

      await recordFailed({
        toolName: input.tool.name,
        action,
        args: input.args,
        error,
        errorCode,
        errorMessage,
        operationId: input.operationId,
        timestamp: input.timestamp,
        startTime: input.startTime,
        duration,
        requestId: input.requestId,
        traceId: input.traceId,
        principalId,
      });

      if (isGoogleAuthErrorFn(error)) {
        return buildToolResponseFn(convertGoogleAuthErrorFn(error));
      }

      return buildToolResponseFn({
        response: {
          success: false,
          error: errorPayload,
        },
      });
    } finally {
      keepalive.stop();
    }
  });
}
