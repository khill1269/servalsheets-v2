import { checkRateLimit } from '../../middleware/rate-limit-middleware.js';
import {
  detectMutationSafetyViolation,
  type MutationSafetyViolation,
} from '../../middleware/mutation-safety-middleware.js';
import { withWriteLock } from '../../middleware/write-lock-middleware.js';
import { logger } from '../../utils/logger.js';
import type { RequestContext } from '../../utils/request-context.js';
import {
  withToolSpan,
  type Span,
  type SpanAttributes,
  type SpanContext,
} from '../../utils/tracing.js';
import {
  extractAction,
  extractCellsAffected,
  extractSheetId,
  extractSpreadsheetId,
  isSuccessResult,
} from './extraction-helpers.js';
import { detectLegacyInvocation, normalizeToolArgs } from './tool-arg-normalization.js';
import type { ToolDefinition } from './tool-definitions.js';
import type { ToolHandlerMap } from './tool-handler-map.js';
import type { ToolExecutionExtra } from './tool-registration.js';

type ToolHandler = ToolHandlerMap[string];

type ToolSpan = Pick<Span, 'context' | 'parentSpanId'> & {
  setAttributes(attributes: SpanAttributes): unknown;
};

type RateLimitResult = ReturnType<typeof checkRateLimit>;

export interface ToolCallExecutionInput {
  tool: Pick<ToolDefinition, 'name'>;
  args: Record<string, unknown>;
  extra?: ToolExecutionExtra;
  handler: ToolHandler;
  requestContext: RequestContext;
  operationId: string;
  requestId?: string;
}

export interface ToolCallExecutionDependencies {
  runInToolSpan?: <T>(
    toolName: string,
    fn: (span: ToolSpan) => Promise<T>,
    attributes?: SpanAttributes,
    parent?: SpanContext
  ) => Promise<T>;
  checkRateLimit?: (principalId: string) => RateLimitResult;
  normalizeArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  detectMutationSafety?: (
    normalizedArgs: Record<string, unknown>
  ) => MutationSafetyViolation | null;
  executeWithWriteLock?: <T>(
    normalizedArgs: Record<string, unknown>,
    fn: () => Promise<T>
  ) => Promise<T>;
  logLegacyInvocation?: (entry: { tool: string; warning: string; requestId?: string }) => void;
}

function buildToolSpanParentContext(requestContext: RequestContext): SpanContext | undefined {
  if (!requestContext.traceId || !requestContext.spanId) {
    return undefined;
  }

  return {
    traceId: requestContext.traceId,
    spanId: requestContext.spanId,
    traceFlags: 1,
  };
}

function setInitialSpanAttributes(
  span: ToolSpan,
  input: Pick<ToolCallExecutionInput, 'tool' | 'args' | 'operationId' | 'requestId'>,
  requestContext: RequestContext,
  localParentSpanId: string | undefined,
  remoteParentSpanId: string | undefined
): void {
  const action = extractAction(input.args);
  const spreadsheetId = extractSpreadsheetId(input.args);
  const sheetId = extractSheetId(input.args);

  span.setAttributes({
    'tool.name': input.tool.name,
    'tool.action': action,
    'operation.id': input.operationId,
    'request.id': input.requestId || 'unknown',
    ...(localParentSpanId && { 'trace.local_parent_span_id': localParentSpanId }),
    ...(remoteParentSpanId && { 'trace.remote_parent_span_id': remoteParentSpanId }),
    ...(spreadsheetId && { 'spreadsheet.id': spreadsheetId }),
    ...(sheetId !== undefined && { 'sheet.id': sheetId.toString() }),
    ...(requestContext.principalId && { 'principal.id': requestContext.principalId }),
  });
}

function buildRateLimitedResponse(retryAfterMs?: number): {
  response: {
    success: false;
    error: {
      code: 'RATE_LIMITED';
      message: string;
      retryable: true;
      retryAfterMs?: number;
    };
  };
} {
  return {
    response: {
      success: false as const,
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded. Retry after ${retryAfterMs}ms.`,
        retryable: true,
        retryAfterMs,
      },
    },
  };
}

function buildMutationSafetyResponse(violation: MutationSafetyViolation): {
  response: {
    success: false;
    error: {
      code: 'FORMULA_INJECTION_BLOCKED';
      message: string;
      retryable: false;
      suggestedFix: string;
    };
  };
} {
  return {
    response: {
      success: false as const,
      error: {
        code: 'FORMULA_INJECTION_BLOCKED',
        message:
          `Dangerous formula detected at ${violation.path}: ` +
          `${violation.preview}. ` +
          'Set safety.sanitizeFormulas=false to allow.',
        retryable: false,
        suggestedFix:
          'Remove formulas containing IMPORTDATA, IMPORTRANGE, IMPORTFEED, IMPORTHTML, IMPORTXML, GOOGLEFINANCE, or QUERY from mutation payloads.',
      },
    },
  };
}

function injectProtocolMetadata(handlerResult: unknown, legacyWarning?: string | null): void {
  if (
    !handlerResult ||
    typeof handlerResult !== 'object' ||
    !('response' in handlerResult) ||
    !handlerResult.response ||
    typeof handlerResult.response !== 'object'
  ) {
    return;
  }

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

export async function executeTracedToolCall(
  input: ToolCallExecutionInput,
  dependencies: ToolCallExecutionDependencies = {}
): Promise<unknown> {
  const runInToolSpan = dependencies.runInToolSpan ?? withToolSpan;
  const rateLimitCheck = dependencies.checkRateLimit ?? checkRateLimit;
  const normalizeArgs = dependencies.normalizeArgs ?? normalizeToolArgs;
  const detectMutationSafety = dependencies.detectMutationSafety ?? detectMutationSafetyViolation;
  const executeWithWriteLock = dependencies.executeWithWriteLock ?? withWriteLock;
  const logLegacyInvocation =
    dependencies.logLegacyInvocation ??
    ((entry: { tool: string; warning: string; requestId?: string }) => {
      logger.debug('Legacy MCP invocation pattern detected', entry);
    });

  const localParentSpanId = input.requestContext.spanId;
  const remoteParentSpanId = input.requestContext.parentSpanId;

  return runInToolSpan(
    input.tool.name,
    async (span) => {
      const previousTraceId = input.requestContext.traceId;
      const previousSpanId = input.requestContext.spanId;
      const previousParentSpanId = input.requestContext.parentSpanId;

      input.requestContext.traceId = span.context.traceId;
      input.requestContext.spanId = span.context.spanId;
      input.requestContext.parentSpanId = span.parentSpanId ?? previousParentSpanId;

      setInitialSpanAttributes(
        span,
        input,
        input.requestContext,
        localParentSpanId,
        remoteParentSpanId
      );

      const legacyWarning = detectLegacyInvocation(input.args);
      if (legacyWarning) {
        logLegacyInvocation({
          tool: input.tool.name,
          warning: legacyWarning,
          requestId: input.requestId,
        });
      }

      try {
        const principalId = input.requestContext.principalId ?? 'anonymous';
        const rateCheck = rateLimitCheck(principalId);
        if (!rateCheck.allowed) {
          return buildRateLimitedResponse(rateCheck.retryAfterMs);
        }

        const normalizedArgs = normalizeArgs(input.args);
        const mutationSafetyViolation = detectMutationSafety(normalizedArgs);
        if (mutationSafetyViolation) {
          return buildMutationSafetyResponse(mutationSafetyViolation);
        }

        const handlerResult = await executeWithWriteLock(normalizedArgs, () =>
          input.handler(normalizedArgs, input.extra)
        );

        injectProtocolMetadata(handlerResult, legacyWarning);

        span.setAttributes({
          'result.success': isSuccessResult(handlerResult),
          'cells.affected': extractCellsAffected(handlerResult) || 0,
        });

        return handlerResult;
      } finally {
        input.requestContext.traceId = previousTraceId;
        input.requestContext.spanId = previousSpanId;
        input.requestContext.parentSpanId = previousParentSpanId;
      }
    },
    {
      'mcp.protocol.version': '2025-11-25',
      'service.name': 'servalsheets',
    },
    buildToolSpanParentContext(input.requestContext)
  );
}
