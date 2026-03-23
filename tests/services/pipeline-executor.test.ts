/**
 * Integration tests for PipelineExecutor (P16-P4).
 *
 * Covers four pipeline patterns:
 *   1. read → transform → write (sequential with failFast)
 *   2. multi-source federation (parallel READs in same wave)
 *   3. audit → fix → publish (sequential WRITEs with failFast)
 *   4. error handling and cycle detection
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PipelineExecutor,
  type PipelineStep,
  type ToolDispatch,
} from '../../src/services/pipeline-executor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default mock dispatch: returns a success response. */
function makeDispatch(overrides?: Map<string, unknown>): ToolDispatch {
  return vi.fn(async (tool: string, args: Record<string, unknown>) => {
    const req = args['request'] as Record<string, unknown>;
    const action = req?.['action'] as string;
    const key = `${tool}.${action}`;
    if (overrides?.has(key)) {
      const val = overrides.get(key);
      if (val instanceof Error) throw val;
      return val;
    }
    return { response: { success: true, action, data: {} } };
  });
}

/** Returns a dispatch mock that throws for the specified tool+action key. */
function makeFailingDispatch(failKey: string): ToolDispatch {
  return vi.fn(async (tool: string, args: Record<string, unknown>) => {
    const req = args['request'] as Record<string, unknown>;
    const action = req?.['action'] as string;
    if (`${tool}.${action}` === failKey) {
      throw new Error(`Sheet not found`);
    }
    return { response: { success: true, action, data: {} } };
  });
}

// ---------------------------------------------------------------------------
// Pattern 1: read → transform → write
// ---------------------------------------------------------------------------

describe('Pattern 1: read → transform → write', () => {
  const steps: PipelineStep[] = [
    {
      id: 'A',
      tool: 'sheets_data',
      action: 'read', // READ_EXACT
      params: { spreadsheetId: 'ss1', range: 'Sheet1!A1:C10' },
    },
    {
      id: 'B',
      tool: 'sheets_analyze',
      action: 'scout', // READ_EXACT
      params: { spreadsheetId: 'ss1' },
      dependsOn: ['A'],
    },
    {
      id: 'C',
      tool: 'sheets_data',
      action: 'write', // WRITE (no READ prefix/exact match)
      params: { spreadsheetId: 'ss1', range: 'Sheet1!E1', values: [['done']] },
      dependsOn: ['B'],
    },
  ];

  it('executes all three steps and returns success', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(result.stepsTotal).toBe(3);
    expect(result.failedAt).toBeUndefined();
  });

  it('dispatches all three steps with correct tool and action', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    await executor.executePipeline(steps);

    const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, Record<string, unknown>]
    >;
    expect(calls).toHaveLength(3);

    const toolActions = calls.map(([tool, args]) => {
      const req = args['request'] as Record<string, unknown>;
      return `${tool}.${req['action']}`;
    });
    expect(toolActions).toContain('sheets_data.read');
    expect(toolActions).toContain('sheets_analyze.scout');
    expect(toolActions).toContain('sheets_data.write');
  });

  it('all step results have status success', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    for (const r of result.results) {
      expect(r.status).toBe('success');
    }
  });

  it('step C result is present in final results array', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    const stepC = result.results.find((r) => r.id === 'C');
    expect(stepC).toBeDefined();
    expect(stepC!.status).toBe('success');
    expect(stepC!.tool).toBe('sheets_data');
    expect(stepC!.action).toBe('write');
  });

  it('A fails with failFast:true → B and C are skipped, failedAt is A', async () => {
    const dispatch = makeFailingDispatch('sheets_data.read');
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps, { failFast: true });

    expect(result.success).toBe(false);
    expect(result.failedAt).toBe('A');
    expect(result.stepsCompleted).toBe(0);

    const stepA = result.results.find((r) => r.id === 'A');
    const stepB = result.results.find((r) => r.id === 'B');
    const stepC = result.results.find((r) => r.id === 'C');

    expect(stepA!.status).toBe('error');
    expect(stepB!.status).toBe('skipped');
    expect(stepC!.status).toBe('skipped');
  });

  it('dispatch is called exactly once before failure when A fails', async () => {
    const dispatch = makeFailingDispatch('sheets_data.read');
    const executor = new PipelineExecutor(dispatch);
    await executor.executePipeline(steps, { failFast: true });

    // Only A's dispatch was attempted; B and C are skipped before dispatch
    expect((dispatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pattern 2: multi-source federation (parallel READs)
// ---------------------------------------------------------------------------

describe('Pattern 2: multi-source federation (parallel READs)', () => {
  const steps: PipelineStep[] = [
    {
      id: 'A',
      tool: 'sheets_data',
      action: 'read', // READ_EXACT — no deps → wave 1
      params: { spreadsheetId: 'ss-source1', range: 'Sheet1!A1:Z100' },
    },
    {
      id: 'B',
      tool: 'sheets_data',
      action: 'read', // READ_EXACT — no deps → wave 1
      params: { spreadsheetId: 'ss-source2', range: 'Sheet1!A1:Z100' },
    },
    {
      id: 'C',
      tool: 'sheets_data',
      action: 'write', // WRITE (not in READ_EXACT / READ_PREFIXES) — dependsOn [A, B] → wave 2
      params: { spreadsheetId: 'ss-dest', range: 'Merged!A1', values: [[]] },
      dependsOn: ['A', 'B'],
    },
  ];

  it('executes all three steps and returns success', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(result.stepsTotal).toBe(3);
  });

  it('A and B are dispatched before C', async () => {
    const callOrder: string[] = [];
    const dispatch = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      const req = args['request'] as Record<string, unknown>;
      const action = req?.['action'] as string;
      const spreadsheetId = req?.['spreadsheetId'] as string | undefined;
      callOrder.push(`${tool}.${action}${spreadsheetId ? `:${spreadsheetId}` : ''}`);
      return { response: { success: true, action, data: {} } };
    }) as ToolDispatch;

    const executor = new PipelineExecutor(dispatch);
    await executor.executePipeline(steps);

    // C must come after both A and B
    const indexA = callOrder.findIndex((k) => k.includes('ss-source1'));
    const indexB = callOrder.findIndex((k) => k.includes('ss-source2'));
    const indexC = callOrder.findIndex((k) => k.includes('ss-dest'));

    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexC).toBeGreaterThan(indexA);
    expect(indexC).toBeGreaterThan(indexB);
  });

  it('total dispatch calls equals 3 (A, B, C)', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    await executor.executePipeline(steps);

    expect((dispatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('both A and B results are present in final results array', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    const ids = result.results.map((r) => r.id);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
    expect(ids).toContain('C');
  });

  it('A and B results both have status success', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    const stepA = result.results.find((r) => r.id === 'A')!;
    const stepB = result.results.find((r) => r.id === 'B')!;
    expect(stepA.status).toBe('success');
    expect(stepB.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Pattern 3: audit → fix → publish
// ---------------------------------------------------------------------------

describe('Pattern 3: audit → fix → publish', () => {
  const steps: PipelineStep[] = [
    {
      id: 'A',
      tool: 'sheets_composite',
      action: 'audit_sheet', // WRITE (no READ match)
      params: { spreadsheetId: 'ss1' },
    },
    {
      id: 'B',
      tool: 'sheets_fix',
      action: 'clean', // WRITE
      params: { spreadsheetId: 'ss1', range: 'Sheet1!A1:Z100' },
      dependsOn: ['A'],
    },
    {
      id: 'C',
      tool: 'sheets_composite',
      action: 'publish_report', // WRITE
      params: { spreadsheetId: 'ss1', title: 'Audit Report' },
      dependsOn: ['B'],
    },
  ];

  it('executes all three steps in sequence and returns success', async () => {
    const dispatch = makeDispatch();
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps);

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(result.stepsTotal).toBe(3);
    expect(result.failedAt).toBeUndefined();
  });

  it('dispatch is called exactly three times in sequence', async () => {
    const callOrder: string[] = [];
    const dispatch = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      const req = args['request'] as Record<string, unknown>;
      const action = req?.['action'] as string;
      callOrder.push(`${tool}.${action}`);
      return { response: { success: true, action, data: {} } };
    }) as ToolDispatch;

    const executor = new PipelineExecutor(dispatch);
    await executor.executePipeline(steps);

    expect(callOrder).toStrictEqual([
      'sheets_composite.audit_sheet',
      'sheets_fix.clean',
      'sheets_composite.publish_report',
    ]);
  });

  it('B (WRITE) fails → C is skipped, failedAt is B, stepsCompleted is 1', async () => {
    const dispatch = makeFailingDispatch('sheets_fix.clean');
    const executor = new PipelineExecutor(dispatch);
    const result = await executor.executePipeline(steps, { failFast: true });

    expect(result.success).toBe(false);
    expect(result.failedAt).toBe('B');
    expect(result.stepsCompleted).toBe(1); // only A completed

    const stepA = result.results.find((r) => r.id === 'A')!;
    const stepB = result.results.find((r) => r.id === 'B')!;
    const stepC = result.results.find((r) => r.id === 'C')!;

    expect(stepA.status).toBe('success');
    expect(stepB.status).toBe('error');
    expect(stepC.status).toBe('skipped');
  });

  it('C dispatch is never called when B fails with failFast:true', async () => {
    const dispatch = makeFailingDispatch('sheets_fix.clean');
    const executor = new PipelineExecutor(dispatch);
    await executor.executePipeline(steps, { failFast: true });

    // A and B were dispatched; C was not
    expect((dispatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Pattern 4: error handling and cycle detection
// ---------------------------------------------------------------------------

describe('Pattern 4: error handling and cycle detection', () => {
  describe('cycle detection', () => {
    it('A depends on B and B depends on A → returns success:false with cycle message', async () => {
      const steps: PipelineStep[] = [
        {
          id: 'A',
          tool: 'sheets_data',
          action: 'read',
          params: {},
          dependsOn: ['B'],
        },
        {
          id: 'B',
          tool: 'sheets_data',
          action: 'write',
          params: {},
          dependsOn: ['A'],
        },
      ];

      const dispatch = makeDispatch();
      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline(steps);

      expect(result.success).toBe(false);
      expect(result.stepsCompleted).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.failedAt).toMatch(/cycle/i);
    });

    it('self-referencing step → returns success:false', async () => {
      const steps: PipelineStep[] = [
        {
          id: 'X',
          tool: 'sheets_data',
          action: 'read',
          params: {},
          dependsOn: ['X'],
        },
      ];

      const dispatch = makeDispatch();
      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline(steps);

      expect(result.success).toBe(false);
      expect(result.stepsCompleted).toBe(0);
      expect(result.failedAt).toBeDefined();
    });
  });

  describe('unknown dependsOn', () => {
    it('step references non-existent step ID → returns success:false', async () => {
      const steps: PipelineStep[] = [
        {
          id: 'A',
          tool: 'sheets_data',
          action: 'read',
          params: {},
          dependsOn: ['NONEXISTENT'],
        },
      ];

      const dispatch = makeDispatch();
      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline(steps);

      expect(result.success).toBe(false);
      expect(result.stepsCompleted).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.failedAt).toMatch(/NONEXISTENT/);
    });
  });

  describe('failFast: false', () => {
    it('independent step still runs after an unrelated step fails', async () => {
      // A and B are in the same wave (no deps); A fails.
      // With failFast:false, B should still run.
      const steps: PipelineStep[] = [
        {
          id: 'A',
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'fail-me' },
        },
        {
          id: 'B',
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'succeed-me' },
        },
      ];

      const callOrder: string[] = [];
      const dispatch = vi.fn(async (tool: string, args: Record<string, unknown>) => {
        const req = args['request'] as Record<string, unknown>;
        const spreadsheetId = req?.['spreadsheetId'] as string;
        const action = req?.['action'] as string;
        callOrder.push(spreadsheetId);
        if (spreadsheetId === 'fail-me') {
          throw new Error('Sheet not found');
        }
        return { response: { success: true, action, data: {} } };
      }) as ToolDispatch;

      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline(steps, { failFast: false });

      // Both A and B should have been dispatched
      expect(callOrder).toContain('fail-me');
      expect(callOrder).toContain('succeed-me');

      const stepA = result.results.find((r) => r.id === 'A')!;
      const stepB = result.results.find((r) => r.id === 'B')!;

      expect(stepA.status).toBe('error');
      expect(stepB.status).toBe('success');
    });

    it('failed step has status error, non-dependent succeeded step has status success', async () => {
      const steps: PipelineStep[] = [
        {
          id: 'A',
          tool: 'sheets_fix',
          action: 'clean',
          params: { spreadsheetId: 'ss1' },
        },
        {
          id: 'B',
          tool: 'sheets_data',
          action: 'read',
          params: { spreadsheetId: 'ss2' },
        },
      ];

      const dispatch = makeFailingDispatch('sheets_fix.clean');
      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline(steps, { failFast: false });

      const stepA = result.results.find((r) => r.id === 'A')!;
      const stepB = result.results.find((r) => r.id === 'B')!;

      expect(stepA.status).toBe('error');
      expect(stepB.status).toBe('success');
    });
  });

  describe('empty pipeline', () => {
    it('returns success with stepsCompleted:0 and empty results', async () => {
      const dispatch = makeDispatch();
      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline([]);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toBe(0);
      expect(result.stepsTotal).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.failedAt).toBeUndefined();
    });

    it('dispatch is never called for an empty pipeline', async () => {
      const dispatch = makeDispatch();
      const executor = new PipelineExecutor(dispatch);
      await executor.executePipeline([]);

      expect((dispatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  describe('duplicate step IDs', () => {
    it('returns success:false when two steps share an ID', async () => {
      const steps: PipelineStep[] = [
        { id: 'A', tool: 'sheets_data', action: 'read', params: {} },
        { id: 'A', tool: 'sheets_data', action: 'write', params: {} },
      ];

      const dispatch = makeDispatch();
      const executor = new PipelineExecutor(dispatch);
      const result = await executor.executePipeline(steps);

      expect(result.success).toBe(false);
      expect(result.stepsCompleted).toBe(0);
    });
  });
});
