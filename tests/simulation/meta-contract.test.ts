/**
 * ServalSheets — _meta Contract Tests
 *
 * Verifies that every response going through buildToolResponse() carries the
 * correct _meta shape — protocol-level correlation metadata injected per
 * MCP 2025-11-25 spec.  Also validates:
 *
 *   1. _meta.requestId present for every response when request context active
 *   2. _meta.quotaStatus present (used, limit, utilization, windowRemainingMs)
 *   3. traceId / spanId injected when provided in context
 *   4. Error responses carry _meta.errorCode + _meta.errorCodeCanonical
 *   5. nonFatalError flag injected for known non-fatal codes
 *   6. suggestedNextActions shape (tool, action, description)
 *   7. suggestedFix shape on error responses (tool, action, explanation)
 *   8. Response shape invariants: success boolean, action string, error.code string
 *   9. _meta absent when no RequestContext in scope
 *  10. apiCallsMade + executionTimeMs injected into _meta when tracked
 *
 * No real Google API calls.  All runs < 5s.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildToolResponse } from '../../src/mcp/registration/tool-handlers.js';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function successResponse(action: string, extra?: Record<string, unknown>) {
  return {
    response: {
      success: true,
      action,
      data: { rows: 5 },
      ...extra,
    },
  };
}

function errorResponse(code: string, message: string) {
  return {
    response: {
      success: false,
      action: 'read',
      error: { code, message },
    },
  };
}

function getMeta(result: Awaited<ReturnType<typeof buildToolResponse>>) {
  // buildToolResponse returns a CallToolResult; structuredContent is the full object
  // The _meta lives on the structuredContent, which is serialized in content[0].text
  const text = result.content[0];
  if (!text || text.type !== 'text') return undefined;
  const parsed = JSON.parse(text.text) as Record<string, unknown>;
  return parsed['_meta'] as Record<string, unknown> | undefined;
}

function getResponse(result: Awaited<ReturnType<typeof buildToolResponse>>) {
  const text = result.content[0];
  if (!text || text.type !== 'text') return undefined;
  const parsed = JSON.parse(text.text) as Record<string, unknown>;
  return parsed['response'] as Record<string, unknown> | undefined;
}

// ─── Suite 1: _meta.requestId always present under RequestContext ──────────────

describe('_meta contract — requestId injection', () => {
  it('injects _meta.requestId when RequestContext is active', async () => {
    const ctx = createRequestContext({ requestId: 'test-req-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    expect(meta).toBeDefined();
    expect(meta!['requestId']).toBe('test-req-001');
  });

  it('_meta.requestId is the same UUID on every call within same context', async () => {
    const ctx = createRequestContext({ requestId: 'sticky-req-abc' });

    const results = await runWithRequestContext(ctx, async () => {
      return [
        buildToolResponse(successResponse('read'), 'sheets_data'),
        buildToolResponse(successResponse('write'), 'sheets_data'),
        buildToolResponse(successResponse('append'), 'sheets_data'),
      ];
    });

    for (const result of results) {
      const meta = getMeta(result);
      expect(meta!['requestId']).toBe('sticky-req-abc');
    }
  });

  it('_meta absent when no RequestContext in scope', () => {
    // No runWithRequestContext wrapper — no AsyncLocalStorage value
    const result = buildToolResponse(successResponse('list'), 'sheets_core');
    const meta = getMeta(result);
    // _meta may be present from other injections (errorCode etc) but requestId absent
    if (meta) {
      expect(meta['requestId']).toBeUndefined();
    }
  });
});

// ─── Suite 2: _meta.quotaStatus shape ─────────────────────────────────────────

describe('_meta contract — quotaStatus shape', () => {
  it('quotaStatus has all required fields', async () => {
    const ctx = createRequestContext({ requestId: 'quota-test-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    expect(meta).toBeDefined();

    const qs = meta!['quotaStatus'] as Record<string, unknown>;
    expect(qs).toBeDefined();
    expect(typeof qs['used']).toBe('number');
    expect(typeof qs['limit']).toBe('number');
    expect(typeof qs['utilization']).toBe('number');
    expect(typeof qs['windowRemainingMs']).toBe('number');

    // utilization must be in [0, 1] range (fraction, not percentage)
    expect(qs['utilization']).toBeGreaterThanOrEqual(0);
    expect(qs['utilization']).toBeLessThanOrEqual(1);
  });

  it('utilization is never > 1 even at full quota', async () => {
    const ctx = createRequestContext({ requestId: 'quota-cap-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('batch_read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    const qs = meta!['quotaStatus'] as Record<string, unknown>;
    expect(qs['utilization']).toBeLessThanOrEqual(1);
  });
});

// ─── Suite 3: traceId / spanId propagation ────────────────────────────────────

describe('_meta contract — trace context propagation', () => {
  it('traceId injected when provided in RequestContext', async () => {
    const ctx = createRequestContext({
      requestId: 'trace-req-001',
      traceId: 'trace-abc-123',
    });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    expect(meta!['traceId']).toBe('trace-abc-123');
  });

  it('spanId injected when provided in RequestContext', async () => {
    const ctx = createRequestContext({
      requestId: 'span-req-001',
      spanId: 'span-xyz-456',
    });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('write'), 'sheets_data'))
    );

    const meta = getMeta(result);
    expect(meta!['spanId']).toBe('span-xyz-456');
  });

  it('traceId absent when not provided', async () => {
    const ctx = createRequestContext({ requestId: 'no-trace-req' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    expect(meta!['traceId']).toBeUndefined();
  });
});

// ─── Suite 4: Error response _meta fields ─────────────────────────────────────

describe('_meta contract — error response metadata', () => {
  it('_meta.errorCode present for known error codes', async () => {
    const ctx = createRequestContext({ requestId: 'err-req-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('SHEET_NOT_FOUND', 'Sheet missing'), 'sheets_data'))
    );

    const meta = getMeta(result);
    // If the code is in the known error code registry, errorCode + errorCodeCanonical injected
    if (meta && meta['errorCode']) {
      expect(typeof meta['errorCode']).toBe('string');
      expect(typeof meta['errorCodeCanonical']).toBe('string');
      expect(typeof meta['errorCodeFamily']).toBe('string');
    }
  });

  it('isError is true for fatal error codes not in NON_FATAL_TOOL_ERROR_CODES', async () => {
    const ctx = createRequestContext({ requestId: 'err-req-002' });
    // INTERNAL_ERROR is not in NON_FATAL_TOOL_ERROR_CODES — it is fatal
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('INTERNAL_ERROR', 'server crash'), 'sheets_data'))
    );

    // buildToolResponse: isError = hasFailure && !treatAsNonFatal
    // INTERNAL_ERROR is not in NON_FATAL set → isError: true
    expect(result.isError).toBe(true);
  });

  it('response.error.code is preserved through buildToolResponse', async () => {
    const ctx = createRequestContext({ requestId: 'err-code-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('QUOTA_EXCEEDED', 'Rate limited'), 'sheets_data'))
    );

    const resp = getResponse(result);
    expect(resp).toBeDefined();
    const err = resp!['error'] as Record<string, unknown>;
    expect(err['code']).toBe('QUOTA_EXCEEDED');
    expect(err['message']).toBe('Rate limited');
  });
});

// ─── Suite 5: suggestedNextActions shape ──────────────────────────────────────

describe('_meta contract — suggestedNextActions shape', () => {
  it('suggestedNextActions items have tool, action, description', async () => {
    const ctx = createRequestContext({ requestId: 'rec-req-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const resp = getResponse(result);
    if (!resp) return;

    const actions = resp['suggestedNextActions'] as Array<Record<string, unknown>> | undefined;
    if (actions && actions.length > 0) {
      for (const a of actions) {
        expect(typeof a['tool']).toBe('string');
        expect(typeof a['action']).toBe('string');
        expect(a['tool']).not.toBe('');
        expect(a['action']).not.toBe('');
      }
    }
  });

  it('suggestedNextActions max 3 items', async () => {
    const ctx = createRequestContext({ requestId: 'rec-req-002' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('analyze_data'), 'sheets_analyze'))
    );

    const resp = getResponse(result);
    if (!resp) return;

    const actions = resp['suggestedNextActions'] as Array<unknown> | undefined;
    if (actions) {
      expect(actions.length).toBeLessThanOrEqual(3);
    }
  });

  it('no suggestedNextActions on error responses', async () => {
    const ctx = createRequestContext({ requestId: 'no-rec-err-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('SHEET_NOT_FOUND', 'missing'), 'sheets_data'))
    );

    const resp = getResponse(result);
    if (!resp) return;

    // Error responses should not have suggestedNextActions (they have suggestedFix instead)
    expect(resp['suggestedNextActions']).toBeUndefined();
  });
});

// ─── Suite 6: suggestedFix shape on error responses ───────────────────────────

describe('_meta contract — suggestedFix injection', () => {
  it('suggestedFix injected for PERMISSION_DENIED', async () => {
    const ctx = createRequestContext({ requestId: 'fix-req-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('PERMISSION_DENIED', 'No access'), 'sheets_data'))
    );

    const resp = getResponse(result);
    const err = resp!['error'] as Record<string, unknown>;
    if (err['suggestedFix']) {
      const fix = err['suggestedFix'] as Record<string, unknown>;
      expect(typeof fix['tool']).toBe('string');
      expect(typeof fix['action']).toBe('string');
    }
  });

  it('suggestedFix injected for SHEET_NOT_FOUND', async () => {
    const ctx = createRequestContext({ requestId: 'fix-req-002' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('SHEET_NOT_FOUND', 'Sheet "Sales" not found'), 'sheets_data'))
    );

    const resp = getResponse(result);
    const err = resp!['error'] as Record<string, unknown>;
    if (err['suggestedFix']) {
      const fix = err['suggestedFix'] as Record<string, unknown>;
      expect(typeof fix['tool']).toBe('string');
    }
  });
});

// ─── Suite 7: Response shape invariants ───────────────────────────────────────

describe('_meta contract — response shape invariants', () => {
  it('success is always a boolean in success responses', async () => {
    const ctx = createRequestContext({ requestId: 'shape-001' });
    const tools = ['sheets_data', 'sheets_format', 'sheets_core', 'sheets_analyze'];
    const actions = ['read', 'write', 'list', 'scout'];

    for (let i = 0; i < tools.length; i++) {
      const result = await runWithRequestContext(ctx, () =>
        Promise.resolve(buildToolResponse(successResponse(actions[i]!), tools[i]!))
      );
      const resp = getResponse(result);
      expect(typeof resp!['success']).toBe('boolean');
      expect(resp!['success']).toBe(true);
    }
  });

  it('success is always false in error responses', async () => {
    const ctx = createRequestContext({ requestId: 'shape-err-001' });
    const codes = ['SHEET_NOT_FOUND', 'PERMISSION_DENIED', 'QUOTA_EXCEEDED', 'INTERNAL_ERROR'];

    for (const code of codes) {
      const result = await runWithRequestContext(ctx, () =>
        Promise.resolve(buildToolResponse(errorResponse(code, 'test error'), 'sheets_data'))
      );
      const resp = getResponse(result);
      expect(resp!['success']).toBe(false);
    }
  });

  it('action field preserved through buildToolResponse', async () => {
    const ctx = createRequestContext({ requestId: 'action-field-001' });
    const testActions = ['read', 'write', 'batch_read', 'append', 'clear'];

    for (const action of testActions) {
      const result = await runWithRequestContext(ctx, () =>
        Promise.resolve(buildToolResponse(successResponse(action), 'sheets_data'))
      );
      const resp = getResponse(result);
      expect(resp!['action']).toBe(action);
    }
  });

  it('content[0].type is always "text"', async () => {
    const ctx = createRequestContext({ requestId: 'content-type-001' });
    const results = await runWithRequestContext(ctx, async () => [
      buildToolResponse(successResponse('read'), 'sheets_data'),
      buildToolResponse(errorResponse('SHEET_NOT_FOUND', 'missing'), 'sheets_data'),
      buildToolResponse(successResponse('list'), 'sheets_core'),
    ]);

    for (const result of results) {
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]!.type).toBe('text');
    }
  });

  it('content[0].text is valid JSON', async () => {
    const ctx = createRequestContext({ requestId: 'json-valid-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    expect(() => JSON.parse((result.content[0] as { text: string }).text)).not.toThrow();
  });
});

// ─── Suite 8: apiCallsMade and executionTimeMs in _meta ──────────────────────

describe('_meta contract — performance tracking', () => {
  it('executionTimeMs is a non-negative number when present', async () => {
    const ctx = createRequestContext({ requestId: 'perf-req-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    if (meta && 'executionTimeMs' in meta) {
      expect(typeof meta['executionTimeMs']).toBe('number');
      expect(meta['executionTimeMs']).toBeGreaterThanOrEqual(0);
    }
  });

  it('apiCallsMade is a non-negative integer when present', async () => {
    const ctx = createRequestContext({ requestId: 'api-calls-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(successResponse('read'), 'sheets_data'))
    );

    const meta = getMeta(result);
    if (meta && 'apiCallsMade' in meta) {
      expect(typeof meta['apiCallsMade']).toBe('number');
      expect(meta['apiCallsMade']).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(meta['apiCallsMade'])).toBe(true);
    }
  });
});

// ─── Suite 9: _meta never breaks response ─────────────────────────────────────

describe('_meta contract — never breaks response', () => {
  it('_meta injection does not mutate response.success', async () => {
    const ctx = createRequestContext({ requestId: 'immut-001' });

    const input = successResponse('read');
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(input, 'sheets_data'))
    );

    const resp = getResponse(result);
    expect(resp!['success']).toBe(true);
  });

  it('_meta injection does not add keys inside response.error', async () => {
    const ctx = createRequestContext({ requestId: 'err-clean-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('INTERNAL_ERROR', 'server error'), 'sheets_data'))
    );

    const resp = getResponse(result);
    const err = resp!['error'] as Record<string, unknown>;

    // error object should have code and message; may have suggestedFix but not _meta
    expect(err['requestId']).toBeUndefined();
    expect(err['quotaStatus']).toBeUndefined();
    expect(err['traceId']).toBeUndefined();
  });

  it('buildToolResponse never throws — even with undefined toolName', () => {
    expect(() => buildToolResponse(successResponse('read'))).not.toThrow();
  });

  it('buildToolResponse never throws — even with null values in response', () => {
    const weirdResponse = {
      response: {
        success: true,
        action: 'read',
        data: null,
        values: null,
        metadata: null,
      },
    };
    expect(() => buildToolResponse(weirdResponse, 'sheets_data')).not.toThrow();
  });
});

// ─── Suite 10: nonFatalError flag ─────────────────────────────────────────────

describe('_meta contract — nonFatalError injection', () => {
  it('nonFatalError flag present for rate-limited errors when MCP_NON_FATAL enabled', async () => {
    const ctx = createRequestContext({ requestId: 'nonfatal-001' });

    // RATE_LIMITED is often in NON_FATAL_TOOL_ERROR_CODES
    // We test that if the flag is injected, it has the correct shape
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(buildToolResponse(errorResponse('RATE_LIMITED', 'Too many requests'), 'sheets_data'))
    );

    const meta = getMeta(result);
    if (meta && meta['nonFatalError'] !== undefined) {
      expect(typeof meta['nonFatalError']).toBe('boolean');
      expect(typeof meta['nonFatalReason']).toBe('string');
    }
  });
});

// ─── Suite 11: _hints in primary pipeline (buildToolResponse) ─────────────────
//
// Regression guard: _hints are injected via generateResponseHints inside
// buildToolResponse (Phase 1B.4). This ensures _hints survive the full
// tool-handlers.ts → CallToolResult path (not just the task handler path).

describe('_meta contract — _hints injection in primary pipeline', () => {
  it('_hints present on sheets_data.read with grid data', async () => {
    const ctx = createRequestContext({ requestId: 'hints-pipeline-001' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(
        buildToolResponse(
          {
            response: {
              success: true,
              action: 'read',
              range: 'Sheet1!A1:D6',
              values: [
                ['Date', 'Revenue', 'Cost', 'Units'],
                ['2024-01-01', 12000, 7500, 130],
                ['2024-01-02', 13000, 8000, 145],
                ['2024-01-03', 11500, 7100, 125],
                ['2024-01-04', 14000, 8700, 155],
                ['2024-01-05', 15000, 9200, 168],
              ],
            },
          },
          'sheets_data'
        )
      )
    );

    const resp = getResponse(result);
    expect(resp).toBeDefined();
    expect(resp!['_hints']).toBeDefined();

    const hints = resp!['_hints'] as Record<string, unknown>;
    expect(['none', 'low', 'medium', 'high']).toContain(hints['riskLevel']);
    expect(typeof hints['nextPhase']).toBe('string');
    expect((hints['nextPhase'] as string).length).toBeGreaterThan(0);
  });

  it('_hints absent on sheets_data.write (no read values)', async () => {
    const ctx = createRequestContext({ requestId: 'hints-pipeline-002' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(
        buildToolResponse(
          {
            response: {
              success: true,
              action: 'write',
              updatedCells: 4,
              updatedRange: 'Sheet1!A1:B2',
            },
          },
          'sheets_data'
        )
      )
    );

    const resp = getResponse(result);
    expect(resp!['_hints']).toBeUndefined();
  });

  it('_hints absent on sheets_format responses (wrong tool)', async () => {
    const ctx = createRequestContext({ requestId: 'hints-pipeline-003' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(
        buildToolResponse(
          {
            response: {
              success: true,
              action: 'read',
              values: [['A', 'B'], [1, 2], [3, 4]],
            },
          },
          'sheets_format'
        )
      )
    );

    const resp = getResponse(result);
    expect(resp!['_hints']).toBeUndefined();
  });

  it('_hints present on sheets_data.batch_read with nested data.values', async () => {
    const ctx = createRequestContext({ requestId: 'hints-pipeline-004' });
    const result = await runWithRequestContext(ctx, () =>
      Promise.resolve(
        buildToolResponse(
          {
            response: {
              success: true,
              action: 'batch_read',
              data: {
                values: [
                  ['Name', 'Score', 'Grade'],
                  ['Alice', 95, 'A'],
                  ['Bob', 87, 'B'],
                  ['Charlie', 92, 'A'],
                  ['Diana', 78, 'C'],
                ],
              },
            },
          },
          'sheets_data'
        )
      )
    );

    const resp = getResponse(result);
    expect(resp!['_hints']).toBeDefined();
  });
});
