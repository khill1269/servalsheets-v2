import { describe, expect, it, vi } from 'vitest';
import type {
  SelfCorrectionStore,
  ToolExecutionSideEffectDeps,
} from '../../src/mcp/registration/tool-execution-side-effects.js';
import {
  extractRowsProcessed,
  recordFailedToolExecution,
  recordSuccessfulToolExecution,
  resolveCostTrackingApiType,
} from '../../src/mcp/registration/tool-execution-side-effects.js';

function createDeps(
  overrides: Partial<ToolExecutionSideEffectDeps> = {}
): ToolExecutionSideEffectDeps {
  return {
    historyService: {
      record: vi.fn(),
    },
    traceAggregator: {
      isEnabled: vi.fn().mockReturnValue(false),
      recordTrace: vi.fn(),
    },
    costTracker: {
      trackApiCall: vi.fn(),
      trackFeatureUsage: vi.fn(),
    },
    auditLogger: {
      logToolCall: vi.fn().mockResolvedValue(undefined),
    },
    envConfig: {
      ENABLE_COST_TRACKING: false,
      ENABLE_BILLING_INTEGRATION: false,
      ENABLE_AUDIT_LOGGING: false,
    },
    log: {
      debug: vi.fn(),
    },
    recordToolCallMetric: vi.fn(),
    recordToolCallLatencyMetric: vi.fn(),
    recordErrorMetric: vi.fn(),
    recordSelfCorrectionMetric: vi.fn(),
    invalidateSamplingContext: vi.fn(),
    resourceNotifications: {
      notifyCacheInvalidated: vi.fn(),
      notifySpreadsheetMutation: vi.fn(),
    },
    collectTraceSpans: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createStore(
  entries: Array<[string, { action: string; timestampMs: number }]> = []
): SelfCorrectionStore {
  return {
    recentFailuresByPrincipal: new Map(entries),
    selfCorrectionWindowMs: 5 * 60 * 1000,
  };
}

describe('tool execution side effects', () => {
  it('resolves cost tracking API types and row counts from handler responses', () => {
    expect(resolveCostTrackingApiType('sheets_bigquery')).toBe('bigquery');
    expect(resolveCostTrackingApiType('sheets_history')).toBe('drive');
    expect(resolveCostTrackingApiType('sheets_data')).toBe('sheets');

    expect(
      extractRowsProcessed({
        response: {
          success: true,
          rowCount: 12,
        },
      })
    ).toBe(12);
    expect(
      extractRowsProcessed({
        response: {
          success: true,
          updatedRows: 4,
        },
      })
    ).toBe(4);
  });

  it('records successful execution side effects and preserves self-correction signals', async () => {
    const deps = createDeps({
      envConfig: {
        ENABLE_COST_TRACKING: true,
        ENABLE_BILLING_INTEGRATION: false,
        ENABLE_AUDIT_LOGGING: true,
      },
    });
    const store = createStore([['alice:sheets_data', { action: 'read', timestampMs: Date.now() }]]);

    await recordSuccessfulToolExecution(
      {
        toolName: 'sheets_data',
        action: 'write',
        args: {
          request: {
            action: 'write',
            spreadsheetId: 'sheet-123',
          },
        },
        result: {
          response: {
            success: true,
            rowCount: 5,
          },
        },
        operationId: 'op-1',
        timestamp: '2026-03-12T00:00:00.000Z',
        startTime: 1000,
        duration: 250,
        requestId: 'req-1',
        traceId: 'trace-1',
        principalId: 'alice',
        costTrackingTenantId: 'tenant-1',
      },
      deps,
      store
    );

    expect(deps.historyService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'sheets_data',
        action: 'write',
        result: 'success',
        spreadsheetId: 'sheet-123',
      })
    );
    expect(deps.recordToolCallMetric).toHaveBeenCalledWith('sheets_data', 'write', 'success', 0.25);
    expect(deps.recordToolCallLatencyMetric).toHaveBeenCalledWith('sheets_data', 'write', 0.25);
    expect(deps.recordSelfCorrectionMetric).toHaveBeenCalledWith('sheets_data', 'read', 'write');
    expect(deps.costTracker.trackApiCall).toHaveBeenCalledWith('tenant-1', 'sheets');
    expect(deps.costTracker.trackFeatureUsage).toHaveBeenCalledWith('tenant-1', 'rowsProcessed', 5);
    expect(deps.auditLogger.logToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'sheets_data',
        action: 'write',
        userId: 'req-1',
        spreadsheetId: 'sheet-123',
        outcome: 'success',
      })
    );
    expect(deps.resourceNotifications.notifyCacheInvalidated).toHaveBeenCalledWith('sheet-123');
    expect(deps.resourceNotifications.notifySpreadsheetMutation).toHaveBeenCalledWith(
      'sheet-123',
      'sheets_data.write mutated spreadsheet sheet-123'
    );
    expect(store.recentFailuresByPrincipal.has('alice:sheets_data')).toBe(false);
  });

  it('swallows trace and audit failures for otherwise successful executions', async () => {
    const deps = createDeps({
      traceAggregator: {
        isEnabled: vi.fn().mockReturnValue(true),
        recordTrace: vi.fn(),
      },
      envConfig: {
        ENABLE_COST_TRACKING: false,
        ENABLE_BILLING_INTEGRATION: false,
        ENABLE_AUDIT_LOGGING: true,
      },
      collectTraceSpans: vi.fn().mockRejectedValue(new Error('trace collector offline')),
      auditLogger: {
        logToolCall: vi.fn().mockRejectedValue(new Error('audit sink offline')),
      },
    });

    await expect(
      recordSuccessfulToolExecution(
        {
          toolName: 'sheets_data',
          action: 'write',
          args: {
            request: {
              action: 'write',
              spreadsheetId: 'sheet-123',
            },
          },
          result: {
            response: {
              success: true,
            },
          },
          operationId: 'op-2',
          timestamp: '2026-03-12T00:00:00.000Z',
          startTime: 1000,
          duration: 100,
          requestId: 'req-2',
          traceId: 'trace-2',
          principalId: 'bob',
          costTrackingTenantId: 'tenant-2',
        },
        deps,
        createStore()
      )
    ).resolves.toBeUndefined();

    expect(deps.historyService.record).toHaveBeenCalledTimes(1);
    expect(deps.log.debug).toHaveBeenCalledWith(
      'Trace aggregation skipped',
      expect.objectContaining({
        tool: 'sheets_data',
        action: 'write',
      })
    );
  });

  it('records failed execution side effects and updates failure memory', async () => {
    const deps = createDeps({
      traceAggregator: {
        isEnabled: vi.fn().mockReturnValue(true),
        recordTrace: vi.fn(),
      },
      collectTraceSpans: vi.fn().mockResolvedValue([{ spanId: 'span-1' }]),
    });
    const store = createStore();
    const error = Object.assign(new TypeError('Bad input'), {
      code: 'INVALID_PARAMS',
    });

    await recordFailedToolExecution(
      {
        toolName: 'sheets_data',
        action: 'write',
        args: {
          request: {
            action: 'write',
            spreadsheetId: 'sheet-456',
          },
        },
        error,
        errorCode: 'INVALID_PARAMS',
        errorMessage: 'Bad input',
        operationId: 'op-3',
        timestamp: '2026-03-12T00:00:00.000Z',
        startTime: 2000,
        duration: 400,
        requestId: 'req-3',
        traceId: 'trace-3',
        principalId: 'carol',
      },
      deps,
      store
    );

    expect(deps.historyService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'sheets_data',
        action: 'write',
        result: 'error',
        errorCode: 'INVALID_PARAMS',
        errorMessage: 'Bad input',
        spreadsheetId: 'sheet-456',
      })
    );
    expect(deps.recordToolCallMetric).toHaveBeenCalledWith('sheets_data', 'write', 'error', 0.4);
    expect(deps.recordErrorMetric).toHaveBeenCalledWith('TypeError', 'sheets_data', 'write');
    expect(deps.traceAggregator.recordTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-3',
        traceId: 'trace-3',
        tool: 'sheets_data',
        action: 'write',
        success: false,
        errorCode: 'INVALID_PARAMS',
        errorMessage: 'Bad input',
        spans: [{ spanId: 'span-1' }],
      })
    );
    expect(store.recentFailuresByPrincipal.get('carol:sheets_data')).toEqual(
      expect.objectContaining({
        action: 'write',
      })
    );
  });
});
