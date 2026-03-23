import { randomUUID } from 'crypto';
import type { RequestInfo, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { extractIdempotencyKeyFromHeaders } from '../../utils/idempotency-key-generator.js';
import {
  createRequestContext,
  getRequestContext,
  type RelatedRequestSender,
  type RequestContext,
  type TaskStatusUpdater,
} from '../../utils/request-context.js';
import { resolveCostTrackingTenantId } from '../../utils/tenant-identification.js';
import {
  getHeaderValue,
  normalizeRequestHeaders,
  type NormalizedRequestHeaders,
} from './tool-arg-normalization.js';

export interface ToolCallContextExtra {
  requestId?: string | number;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
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
  requestHeaders?: NormalizedRequestHeaders;
}

export interface ToolCallContextEnvelope {
  requestAbortSignal?: AbortSignal;
  requestHeaders?: NormalizedRequestHeaders;
  requestContext: RequestContext;
  requestId?: string;
  traceId?: string;
  operationId: string;
  startTime: number;
  timestamp: string;
  costTrackingTenantId: string;
}

export function mergeAbortSignals(
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

export function buildToolCallExecutionContext(
  extra: ToolCallContextExtra | undefined,
  sessionAbortSignal?: AbortSignal
): ToolCallContextEnvelope {
  const parentRequestContext = getRequestContext();
  const requestId =
    extra?.requestId !== undefined ? String(extra.requestId) : parentRequestContext?.requestId;
  const requestHeaders =
    extra?.requestHeaders ?? normalizeRequestHeaders(extra?.requestInfo?.headers);
  const progressToken = extra?._meta?.progressToken ?? extra?.progressToken;
  const requestAbortSignal = mergeAbortSignals(
    extra?.abortSignal ?? extra?.signal,
    sessionAbortSignal
  );

  const traceId =
    extra?.traceId ||
    getHeaderValue(requestHeaders?.['x-trace-id']) ||
    parentRequestContext?.traceId;
  const spanId =
    extra?.spanId || getHeaderValue(requestHeaders?.['x-span-id']) || parentRequestContext?.spanId;
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

  const startTime = Date.now();

  return {
    requestAbortSignal,
    requestHeaders,
    requestContext,
    requestId,
    traceId,
    operationId: randomUUID(),
    startTime,
    timestamp: new Date(startTime).toISOString(),
    costTrackingTenantId: resolveCostTrackingTenantId({
      headers: requestHeaders,
    }),
  };
}
