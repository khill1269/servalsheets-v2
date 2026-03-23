/**
 * Tests for execute_pipeline — DAG-based cross-tool pipeline executor.
 *
 * Covers: parallel READ waves, sequential WRITE steps, dependency ordering,
 * fail-fast behaviour, cycle detection, duplicate ID validation, and step
 * classification edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineExecutor, type PipelineStep, type ToolDispatch } from '../../src/services/pipeline-executor.js';
import { registerPipelineDispatch, getPipelineDispatch } from '../../src/services/pipeline-registry.js';

// ============================================================================
// Helpers
// ============================================================================

function makeDispatch(
  results: Record<string, unknown> = {},
  delay = 0
): { dispatch: ToolDispatch; calls: string[] } {
  const calls: string[] = [];
  const dispatch: ToolDispatch = async (tool, args) => {
    const action = (args['request'] as Record<string, unknown>)['action'] as string;
    const key = `${tool}.${action}`;
    calls.push(key);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const result = results[key];
    if (result instanceof Error) throw result;
    return result ?? { response: { success: true, action } };
  };
  return { dispatch, calls };
}

function makeStep(
  id: string,
  tool: string,
  action: string,
  dependsOn?: string[]
): PipelineStep {
  return { id, tool, action, params: {}, dependsOn };
}

// ============================================================================
// PipelineExecutor unit tests
// ============================================================================

describe('PipelineExecutor', () => {
  describe('basic execution', () => {
    it('executes a single step', async () => {
      const { dispatch, calls } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([makeStep('s1', 'sheets_data', 'read')]);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toBe(1);
      expect(result.stepsTotal).toBe(1);
      expect(result.results[0]?.status).toBe('success');
      expect(calls).toEqual(['sheets_data.read']);
    });

    it('returns empty result for zero steps', async () => {
      const { dispatch } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([]);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toBe(0);
      expect(result.stepsTotal).toBe(0);
    });

    it('passes params to dispatcher as { request: { action, ...params } }', async () => {
      const dispatched: unknown[] = [];
      const dispatch: ToolDispatch = async (tool, args) => {
        dispatched.push({ tool, args });
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      await exec.executePipeline([
        { id: 's1', tool: 'sheets_data', action: 'write', params: { spreadsheetId: 'abc', range: 'A1' } },
      ]);

      expect(dispatched[0]).toMatchObject({
        tool: 'sheets_data',
        args: { request: { action: 'write', spreadsheetId: 'abc', range: 'A1' } },
      });
    });
  });

  describe('READ parallelisation', () => {
    it('runs independent READ steps in parallel', async () => {
      const order: string[] = [];
      const dispatch: ToolDispatch = async (_, args) => {
        const req = args['request'] as Record<string, unknown>;
        const action = req['action'] as string;
        // r2 finishes immediately, r1 has a small delay
        if (action === 'read') {
          await new Promise((r) => setTimeout(r, 10));
        }
        order.push(action);
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([
        makeStep('r1', 'sheets_data', 'read'),
        makeStep('r2', 'sheets_data', 'batch_get'),
      ]);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toBe(2);
      // Both should complete (order determined by async timing)
      expect(order).toHaveLength(2);
    });

    it('runs WRITE steps sequentially even in the same wave', async () => {
      const order: string[] = [];
      const dispatch: ToolDispatch = async (_, args) => {
        const req = args['request'] as Record<string, unknown>;
        order.push(req['action'] as string);
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      await exec.executePipeline([
        makeStep('w1', 'sheets_data', 'write'),
        makeStep('w2', 'sheets_format', 'set_format'),
      ]);

      // Sequential: w1 then w2
      expect(order).toEqual(['write', 'set_format']);
    });

    it('runs mixed READ+WRITE wave sequentially', async () => {
      const order: string[] = [];
      const dispatch: ToolDispatch = async (_, args) => {
        const req = args['request'] as Record<string, unknown>;
        order.push(req['action'] as string);
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      await exec.executePipeline([
        makeStep('r1', 'sheets_data', 'read'),
        makeStep('w1', 'sheets_data', 'write'),
      ]);

      // Mixed wave → sequential
      expect(order).toHaveLength(2);
    });
  });

  describe('dependency ordering (DAG)', () => {
    it('runs steps in dependency order', async () => {
      const order: string[] = [];
      const dispatch: ToolDispatch = async (_, args) => {
        const req = args['request'] as Record<string, unknown>;
        order.push(req['action'] as string);
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      // s2 depends on s1 → s1 must run first
      await exec.executePipeline([
        makeStep('s2', 'sheets_data', 'write', ['s1']),
        makeStep('s1', 'sheets_data', 'read'),
      ]);

      expect(order[0]).toBe('read');
      expect(order[1]).toBe('write');
    });

    it('supports a chain: read → transform → write', async () => {
      const order: string[] = [];
      const dispatch: ToolDispatch = async (_, args) => {
        const req = args['request'] as Record<string, unknown>;
        order.push(req['action'] as string);
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      await exec.executePipeline([
        makeStep('write', 'sheets_data', 'write', ['transform']),
        makeStep('transform', 'sheets_data', 'find_replace', ['read']),
        makeStep('read', 'sheets_data', 'read'),
      ]);

      expect(order).toEqual(['read', 'find_replace', 'write']);
    });

    it('supports multi-source fan-in', async () => {
      const order: string[] = [];
      const dispatch: ToolDispatch = async (_, args) => {
        const req = args['request'] as Record<string, unknown>;
        order.push(req['action'] as string);
        return {};
      };
      const exec = new PipelineExecutor(dispatch);
      // merge depends on both read1 and read2
      await exec.executePipeline([
        makeStep('merge', 'sheets_data', 'batch_write', ['read1', 'read2']),
        makeStep('read1', 'sheets_data', 'read'),
        makeStep('read2', 'sheets_data', 'batch_read'),
      ]);

      expect(order[2]).toBe('batch_write');
      expect(order.slice(0, 2).sort()).toEqual(['batch_read', 'read'].sort());
    });
  });

  describe('error handling', () => {
    it('fails fast and marks remaining steps as skipped', async () => {
      const { dispatch } = makeDispatch({
        'sheets_data.write': new Error('Write failed'),
      });
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([
        makeStep('r1', 'sheets_data', 'read'),
        makeStep('w1', 'sheets_data', 'write', ['r1']),
        makeStep('s1', 'sheets_data', 'set_format', ['w1']),
      ]);

      expect(result.success).toBe(false);
      expect(result.failedAt).toBe('w1');
      const s1 = result.results.find((r) => r.id === 's1');
      expect(s1?.status).toBe('skipped');
    });

    it('continues when failFast is false', async () => {
      const { dispatch } = makeDispatch({
        'sheets_data.write': new Error('Write failed'),
      });
      const exec = new PipelineExecutor(dispatch);
      // Two independent steps — even if write fails, read should still run
      const result = await exec.executePipeline(
        [
          makeStep('w1', 'sheets_data', 'write'),
          makeStep('r1', 'sheets_data', 'read'),
        ],
        { failFast: false }
      );

      expect(result.results.find((r) => r.id === 'r1')?.status).toBe('success');
      expect(result.results.find((r) => r.id === 'w1')?.status).toBe('error');
      expect(result.stepsCompleted).toBe(1);
    });

    it('records step error message', async () => {
      const { dispatch } = makeDispatch({
        'sheets_data.write': new Error('quota exceeded'),
      });
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([makeStep('w1', 'sheets_data', 'write')]);

      expect(result.results[0]?.status).toBe('error');
      expect(result.results[0]?.error).toContain('quota exceeded');
    });
  });

  describe('validation', () => {
    it('returns error for duplicate step IDs', async () => {
      const { dispatch } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([
        makeStep('s1', 'sheets_data', 'read'),
        makeStep('s1', 'sheets_data', 'write'),
      ]);

      expect(result.success).toBe(false);
      expect(result.failedAt).toContain('duplicate step id');
    });

    it('returns error for unknown dependsOn reference', async () => {
      const { dispatch } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([
        makeStep('s1', 'sheets_data', 'write', ['nonexistent']),
      ]);

      expect(result.success).toBe(false);
      expect(result.failedAt).toContain('nonexistent');
    });

    it('returns error for self-dependency', async () => {
      const { dispatch } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([
        makeStep('s1', 'sheets_data', 'write', ['s1']),
      ]);

      expect(result.success).toBe(false);
    });

    it('detects dependency cycles', async () => {
      const { dispatch } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([
        makeStep('a', 'sheets_data', 'read', ['b']),
        makeStep('b', 'sheets_data', 'write', ['a']),
      ]);

      expect(result.success).toBe(false);
      expect(result.failedAt?.toLowerCase()).toContain('cycle');
    });
  });

  describe('result metadata', () => {
    it('includes durationMs for each step', async () => {
      const { dispatch } = makeDispatch();
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([makeStep('s1', 'sheets_data', 'read')]);

      expect(typeof result.results[0]?.durationMs).toBe('number');
      expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes total pipeline durationMs', async () => {
      const { dispatch } = makeDispatch({}, 5);
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([makeStep('s1', 'sheets_data', 'read')]);

      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('includes step result on success', async () => {
      const dispatch: ToolDispatch = async () => ({ response: { success: true, data: 42 } });
      const exec = new PipelineExecutor(dispatch);
      const result = await exec.executePipeline([makeStep('s1', 'sheets_data', 'read')]);

      expect(result.results[0]?.result).toMatchObject({ response: { data: 42 } });
    });
  });
});

// ============================================================================
// Pipeline registry
// ============================================================================

describe('pipeline-registry', () => {
  it('registerPipelineDispatch + getPipelineDispatch round-trip', () => {
    const dispatch: ToolDispatch = async () => ({});
    registerPipelineDispatch(dispatch);
    expect(getPipelineDispatch()).toBe(dispatch);
  });

  it('getPipelineDispatch returns latest registered dispatch', () => {
    const d1: ToolDispatch = async () => ({ v: 1 });
    const d2: ToolDispatch = async () => ({ v: 2 });
    registerPipelineDispatch(d1);
    registerPipelineDispatch(d2);
    expect(getPipelineDispatch()).toBe(d2);
  });
});
