import { describe, expect, it } from 'vitest';
import {
  buildToolCallExecutionContext,
  mergeAbortSignals,
} from '../../src/mcp/registration/tool-call-context.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

describe('tool call context', () => {
  it('derives trace, principal, idempotency, and progress metadata from request headers', () => {
    const sessionAbortController = new AbortController();
    const notificationSender = async (): Promise<void> => undefined;

    const result = buildToolCallExecutionContext(
      {
        requestId: 'req-123',
        requestInfo: {
          headers: {
            'x-trace-id': '0123456789abcdef0123456789abcdef',
            'x-span-id': '0123456789abcdef',
            'x-parent-span-id': 'fedcba9876543210',
            'x-session-id': 'session-abc',
            'x-idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
          },
        },
        progressToken: 'progress-1',
        sendNotification: notificationSender,
      },
      sessionAbortController.signal
    );

    expect(result.requestId).toBe('req-123');
    expect(result.traceId).toBe('0123456789abcdef0123456789abcdef');
    expect(result.requestContext).toMatchObject({
      requestId: 'req-123',
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      parentSpanId: 'fedcba9876543210',
      principalId: 'session-abc',
      progressToken: 'progress-1',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      sendNotification: notificationSender,
      abortSignal: sessionAbortController.signal,
    });
    expect(result.costTrackingTenantId).toBe('default');
    expect(result.operationId).toBeTruthy();
    expect(result.timestamp).toContain('T');
  });

  it('inherits ambient request context values when explicit headers are absent', async () => {
    const result = await runWithRequestContext(
      createRequestContext({
        requestId: 'ambient-req',
        traceId: 'ambient-trace',
        spanId: 'ambient-span',
        parentSpanId: 'ambient-parent',
        principalId: 'ambient-user',
        idempotencyKey: 'ambient-idempotency',
      }),
      async () => buildToolCallExecutionContext(undefined)
    );

    expect(result.requestId).toBe('ambient-req');
    expect(result.traceId).toBe('ambient-trace');
    expect(result.requestContext).toMatchObject({
      requestId: 'ambient-req',
      traceId: 'ambient-trace',
      spanId: 'ambient-span',
      parentSpanId: 'ambient-parent',
      principalId: 'ambient-user',
      idempotencyKey: 'ambient-idempotency',
    });
  });

  it('merges request and session abort signals', () => {
    const requestAbortController = new AbortController();
    const sessionAbortController = new AbortController();
    const merged = mergeAbortSignals(
      requestAbortController.signal,
      sessionAbortController.signal
    );

    expect(merged?.aborted).toBe(false);

    requestAbortController.abort('request aborted');
    expect(merged?.aborted).toBe(true);
    expect(merged?.reason).toBe('request aborted');
  });
});
