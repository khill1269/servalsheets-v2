import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimeTravelDebugger, resetTimeTravelDebugger } from '../../src/services/time-travel.js';
import { HistoryService } from '../../src/services/history-service.js';
import type { OperationHistory } from '../../src/types/history.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

let _opCounter = 0;
function makeOp(overrides: Partial<OperationHistory> = {}): OperationHistory {
  return {
    id: `op-fixed-${String(++_opCounter).padStart(3, '0')}`,
    timestamp: new Date('2024-01-15T00:00:00Z').toISOString(),
    tool: 'sheets_data',
    action: 'write_range',
    params: { range: 'Sheet1!A1:B10' },
    result: 'success',
    duration: 50,
    spreadsheetId: 'ss-1',
    ...overrides,
  };
}

function createMockSnapshotService() {
  return {
    create: vi.fn().mockResolvedValue('snap-1'),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(undefined),
    restore: vi.fn().mockResolvedValue('restored-id'),
    getUrl: vi.fn().mockReturnValue(undefined),
    clearCache: vi.fn(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TimeTravelDebugger', () => {
  let history: HistoryService;
  let snapshotService: ReturnType<typeof createMockSnapshotService>;
  let debugger_: TimeTravelDebugger;

  beforeEach(() => {
    resetTimeTravelDebugger();
    history = new HistoryService({ maxSize: 100 });
    snapshotService = createMockSnapshotService();
    debugger_ = new TimeTravelDebugger({
      historyService: history,
      snapshotService: snapshotService as any,
    });
  });

  // ─── Checkpoint Tests ───────────────────────────────────────────────────

  describe('Checkpoint Management', () => {
    it('creates a checkpoint with snapshot + operation history', async () => {
      const op = makeOp();
      history.record(op);

      const id = await debugger_.createCheckpoint('ss-1', 'Before edit');

      expect(id).toMatch(/^ckpt_/);
      expect(snapshotService.create).toHaveBeenCalledWith('ss-1', 'Before edit');

      const state = debugger_.inspectState(id);
      expect(state.name).toBe('Before edit');
      expect(state.operations).toHaveLength(1);
      expect(state.operations[0].id).toBe(op.id);
    });

    it('lists checkpoints sorted by creation time', async () => {
      await debugger_.createCheckpoint('ss-1', 'First');
      await debugger_.createCheckpoint('ss-1', 'Second');

      const list = debugger_.listCheckpoints('ss-1');
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('First');
      expect(list[1].name).toBe('Second');
    });

    it('deletes checkpoint and its snapshot', async () => {
      const id = await debugger_.createCheckpoint('ss-1', 'Temp');

      await debugger_.deleteCheckpoint(id);

      expect(snapshotService.delete).toHaveBeenCalledWith('snap-1');
      expect(debugger_.listCheckpoints('ss-1')).toHaveLength(0);
    });

    it('throws NotFoundError for missing checkpoint', () => {
      expect(() => debugger_.inspectState('nonexistent')).toThrow('not found');
    });

    it('prunes old checkpoints when exceeding max', async () => {
      const smallDebugger = new TimeTravelDebugger({
        historyService: history,
        snapshotService: snapshotService as any,
        maxCheckpoints: 2,
      });

      await smallDebugger.createCheckpoint('ss-1', 'One');
      await smallDebugger.createCheckpoint('ss-1', 'Two');
      await smallDebugger.createCheckpoint('ss-1', 'Three');

      const list = smallDebugger.listCheckpoints('ss-1');
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('Two');
      expect(list[1].name).toBe('Three');
    });
  });

  // ─── Blame Analysis ─────────────────────────────────────────────────────

  describe('Blame Analysis', () => {
    it('blameCell finds operations that overlap target cell', () => {
      const op1 = makeOp({ params: { range: 'Sheet1!A1:B10' } });
      const op2 = makeOp({ params: { range: 'Sheet1!C1:D5' } });
      const op3 = makeOp({ params: { range: 'Sheet1!A5:A5' } });
      history.record(op1);
      history.record(op2);
      history.record(op3);

      const result = debugger_.blameCell('ss-1', 'Sheet1!A5');

      // op1 (A1:B10) and op3 (A5:A5) overlap A5; op2 (C1:D5) does not
      const ids = result.operations.map((op) => op.id);
      expect(ids).toContain(op1.id);
      expect(ids).toContain(op3.id);
      expect(ids).not.toContain(op2.id);
    });

    it('blameCell returns empty for no matching operations', () => {
      const op = makeOp({ params: { range: 'Sheet1!A1:B2' } });
      history.record(op);

      const result = debugger_.blameCell('ss-1', 'Sheet1!Z99');
      expect(result.operations).toHaveLength(0);
    });

    it('blameOperation finds dependent operations', () => {
      const now = 1704067200000;
      const op1 = makeOp({
        id: 'op-target',
        timestamp: new Date(now).toISOString(),
        params: { range: 'Sheet1!A1:B10' },
      });
      const op2 = makeOp({
        id: 'op-dependent',
        timestamp: new Date(now + 1000).toISOString(),
        params: { range: 'Sheet1!A5:B5' },
      });
      const op3 = makeOp({
        id: 'op-unrelated',
        timestamp: new Date(now + 2000).toISOString(),
        params: { range: 'Sheet1!Z1:Z10' },
      });
      history.record(op1);
      history.record(op2);
      history.record(op3);

      const result = debugger_.blameOperation('ss-1', 'op-target');

      expect(result.operation.id).toBe('op-target');
      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].id).toBe('op-dependent');
    });

    it('blameOperation returns empty dependents when no range', () => {
      const op = makeOp({ id: 'op-no-range', params: {} });
      history.record(op);

      const result = debugger_.blameOperation('ss-1', 'op-no-range');
      expect(result.dependents).toHaveLength(0);
    });
  });

  // ─── Branching ──────────────────────────────────────────────────────────

  describe('Branching', () => {
    it('creates a branch from current history', () => {
      const op = makeOp();
      history.record(op);

      const branch = debugger_.createBranch('ss-1', 'feature-1');

      expect(branch.name).toBe('feature-1');
      expect(branch.operations).toHaveLength(1);
    });

    it('creates a branch from checkpoint', async () => {
      const op1 = makeOp({ id: 'op-1' });
      history.record(op1);
      const cpId = await debugger_.createCheckpoint('ss-1', 'Base');

      // Add more ops after checkpoint
      const op2 = makeOp({ id: 'op-2' });
      history.record(op2);

      const branch = debugger_.createBranch('ss-1', 'from-cp', cpId);
      // Branch should only have op1 (from checkpoint), not op2
      expect(branch.operations).toHaveLength(1);
      expect(branch.operations[0].id).toBe('op-1');
    });

    it('switches active branch', () => {
      debugger_.createBranch('ss-1', 'dev');

      expect(debugger_.getCurrentBranch('ss-1')).toBe('main');
      debugger_.switchBranch('ss-1', 'dev');
      expect(debugger_.getCurrentBranch('ss-1')).toBe('dev');
    });

    it('throws on duplicate branch name', () => {
      debugger_.createBranch('ss-1', 'dup');
      expect(() => debugger_.createBranch('ss-1', 'dup')).toThrow('already exists');
    });

    it('throws on switch to nonexistent branch', () => {
      expect(() => debugger_.switchBranch('ss-1', 'ghost')).toThrow('not found');
    });

    it('merges branch operations into target', () => {
      const op1 = makeOp({ id: 'shared-op' });
      history.record(op1);

      debugger_.createBranch('ss-1', 'source');
      debugger_.createBranch('ss-1', 'target');

      // Add unique op to source
      const sourceBranch = debugger_['branches'].get('ss-1:source')!;
      const newOp = makeOp({ id: 'new-op', params: { range: 'Sheet1!Z1' } });
      sourceBranch.operations.push(newOp);

      const result = debugger_.mergeBranch('ss-1', 'source', 'target');

      expect(result.mergedOperations.map((op) => op.id)).toContain('new-op');
    });

    it('detects merge conflicts on overlapping ranges', () => {
      debugger_.createBranch('ss-1', 'source');
      debugger_.createBranch('ss-1', 'target');

      const sourceBranch = debugger_['branches'].get('ss-1:source')!;
      const targetBranch = debugger_['branches'].get('ss-1:target')!;

      sourceBranch.operations.push(makeOp({ id: 'src-op', params: { range: 'Sheet1!A1:B5' } }));
      targetBranch.operations.push(makeOp({ id: 'tgt-op', params: { range: 'Sheet1!A3:B3' } }));

      const result = debugger_.mergeBranch('ss-1', 'source', 'target');

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].sourceOp.id).toBe('src-op');
      expect(result.conflicts[0].targetOp.id).toBe('tgt-op');
    });
  });

  // ─── Diffing ────────────────────────────────────────────────────────────

  describe('Diffing', () => {
    it('diffs two checkpoints showing added/removed operations', async () => {
      const op1 = makeOp({ id: 'op-1' });
      history.record(op1);
      const cp1 = await debugger_.createCheckpoint('ss-1', 'CP1');

      const op2 = makeOp({ id: 'op-2' });
      history.record(op2);
      const cp2 = await debugger_.createCheckpoint('ss-1', 'CP2');

      const diff = debugger_.diffCheckpoints(cp1, cp2);

      expect(diff.operationsAdded).toHaveLength(1);
      expect(diff.operationsAdded[0].id).toBe('op-2');
      expect(diff.operationsRemoved).toHaveLength(0);
      expect(diff.timeDelta).toBeGreaterThanOrEqual(0);
    });

    it('throws for nonexistent checkpoint in diff', async () => {
      const cpId = await debugger_.createCheckpoint('ss-1', 'Real');
      expect(() => debugger_.diffCheckpoints(cpId, 'fake')).toThrow('not found');
      expect(() => debugger_.diffCheckpoints('fake', cpId)).toThrow('not found');
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('handles empty history gracefully', () => {
      const result = debugger_.blameCell('ss-1', 'Sheet1!A1');
      expect(result.operations).toHaveLength(0);
    });

    it('handles operations without range param', () => {
      const op = makeOp({ params: { action: 'list_sheets' } });
      history.record(op);

      const result = debugger_.blameCell('ss-1', 'Sheet1!A1');
      expect(result.operations).toHaveLength(0);
    });

    it('operations on different sheets do not overlap', () => {
      const op = makeOp({ params: { range: 'Sheet2!A1:B10' } });
      history.record(op);

      const result = debugger_.blameCell('ss-1', 'Sheet1!A5');
      expect(result.operations).toHaveLength(0);
    });

    it('blameOperation throws for missing operation', () => {
      expect(() => debugger_.blameOperation('ss-1', 'nonexistent')).toThrow('not found');
    });
  });
});
