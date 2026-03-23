/**
 * Time Travel Debugger
 *
 * Provides checkpoint-based debugging with branching, blame analysis, and diffing.
 * Combines snapshots from SnapshotService with operation history from HistoryService.
 */

import type { HistoryService } from './history-service.js';
import { getHistoryService } from './history-service.js';
import type { SnapshotService } from './snapshot.js';
import type { OperationHistory } from '../types/history.js';
import { NotFoundError, ValidationError } from '../core/errors.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  spreadsheetId: string;
  name: string;
  snapshotId: string;
  createdAt: string;
  operations: OperationHistory[];
}

export interface CheckpointState {
  id: string;
  name: string;
  operations: OperationHistory[];
  snapshotId: string;
}

export interface BlameResult {
  cell: string;
  operations: OperationHistory[];
}

export interface BlameOperationResult {
  operation: OperationHistory;
  dependents: OperationHistory[];
}

export interface Branch {
  name: string;
  operations: OperationHistory[];
  createdAt: string;
}

export interface MergeResult {
  success: boolean;
  mergedOperations: OperationHistory[];
  conflicts: Array<{
    sourceOp: OperationHistory;
    targetOp: OperationHistory;
    reason: string;
  }>;
}

export interface CheckpointDiff {
  operationsAdded: OperationHistory[];
  operationsRemoved: OperationHistory[];
  timeDelta: number;
}

export interface TimeTravelDebuggerOptions {
  historyService: HistoryService;
  snapshotService: SnapshotService;
  maxCheckpoints?: number;
}

// ─── Singleton State ────────────────────────────────────────────────────────

let globalInstance: TimeTravelDebugger | null = null;

export function resetTimeTravelDebugger(): void {
  globalInstance = null;
}

/**
 * Get or create a singleton TimeTravelDebugger for read-only resource access.
 * Uses the HistoryService singleton. SnapshotService is unused for read operations.
 */
export function getTimeTravelDebugger(): TimeTravelDebugger {
  if (!globalInstance) {
    globalInstance = new TimeTravelDebugger({
      historyService: getHistoryService(),
      // snapshotService is only called by createCheckpoint/deleteCheckpoint (write ops).
      // Resource access is read-only so this parameter is never invoked.
      snapshotService: null as unknown as SnapshotService,
    });
  }
  return globalInstance;
}

// ─── Range Overlap Helpers ──────────────────────────────────────────────────

/**
 * Parse A1 notation into sheet, row, col components.
 * Examples: "Sheet1!A5" -> {sheet: "Sheet1", row: 5, col: 0}
 */
function parseA1(a1: string): { sheet: string; row: number; col: number } | null {
  const match = a1.match(/^([^!]+)!([A-Z]+)(\d+)$/);
  if (!match) return null;

  const sheet = match[1]!;
  const colLetters = match[2]!;
  const row = parseInt(match[3]!, 10);

  // Convert column letters to 0-indexed number (A=0, B=1, ..., Z=25, AA=26, etc.)
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  col -= 1; // Make 0-indexed

  return { sheet, row, col };
}

/**
 * Parse range notation into sheet, startRow, endRow, startCol, endCol.
 * Examples: "Sheet1!A1:B10" -> {sheet: "Sheet1", startRow: 1, endRow: 10, startCol: 0, endCol: 1}
 */
function parseRange(
  range: string
): { sheet: string; startRow: number; endRow: number; startCol: number; endCol: number } | null {
  const match = range.match(/^([^!]+)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!match) return null;

  const sheet = match[1]!;
  const startColLetters = match[2]!;
  const startRow = parseInt(match[3]!, 10);
  const endColLetters = match[4]!;
  const endRow = parseInt(match[5]!, 10);

  const startCol =
    startColLetters
      .split('')
      .reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 'A'.charCodeAt(0) + 1, 0) - 1;
  const endCol =
    endColLetters
      .split('')
      .reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 'A'.charCodeAt(0) + 1, 0) - 1;

  return { sheet, startRow, endRow, startCol, endCol };
}

/**
 * Check if a cell (A1 notation) overlaps with a range.
 */
function cellOverlapsRange(cell: string, range: string): boolean {
  const cellParsed = parseA1(cell);
  const rangeParsed = parseRange(range);

  if (!cellParsed || !rangeParsed) return false;
  if (cellParsed.sheet !== rangeParsed.sheet) return false;

  const { row, col } = cellParsed;
  const { startRow, endRow, startCol, endCol } = rangeParsed;

  return row >= startRow && row <= endRow && col >= startCol && col <= endCol;
}

/**
 * Check if two ranges overlap.
 */
function rangesOverlap(range1: string, range2: string): boolean {
  const r1 = parseRange(range1);
  const r2 = parseRange(range2);

  if (!r1 || !r2) return false;
  if (r1.sheet !== r2.sheet) return false;

  // Check if ranges overlap in both row and column dimensions
  const rowOverlap = r1.startRow <= r2.endRow && r1.endRow >= r2.startRow;
  const colOverlap = r1.startCol <= r2.endCol && r1.endCol >= r2.startCol;

  return rowOverlap && colOverlap;
}

// ─── Time Travel Debugger ───────────────────────────────────────────────────

export class TimeTravelDebugger {
  private historyService: HistoryService;
  private snapshotService: SnapshotService;
  private maxCheckpoints: number;

  private checkpoints: Map<string, Checkpoint> = new Map();
  private checkpointsBySpreadsheet: Map<string, string[]> = new Map();

  private branches: Map<string, Branch> = new Map(); // key: `${spreadsheetId}:${branchName}`
  private activeBranches: Map<string, string> = new Map(); // spreadsheetId -> branchName

  constructor(options: TimeTravelDebuggerOptions) {
    this.historyService = options.historyService;
    this.snapshotService = options.snapshotService;
    this.maxCheckpoints = options.maxCheckpoints ?? 50;

    // Register as singleton for resetTimeTravelDebugger()
    if (!globalInstance) {
      globalInstance = this;
    }
  }

  // ─── Checkpoint Management ──────────────────────────────────────────────

  async createCheckpoint(spreadsheetId: string, name: string): Promise<string> {
    // Create snapshot
    const snapshotId = await this.snapshotService.create(spreadsheetId, name);

    // Capture current operations
    const operations = this.historyService.getBySpreadsheet(spreadsheetId);

    // Create checkpoint
    const checkpointId = `ckpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const checkpoint: Checkpoint = {
      id: checkpointId,
      spreadsheetId,
      name,
      snapshotId,
      createdAt: new Date().toISOString(),
      operations: [...operations], // Copy array
    };

    this.checkpoints.set(checkpointId, checkpoint);

    // Track per-spreadsheet
    const existing = this.checkpointsBySpreadsheet.get(spreadsheetId) ?? [];
    existing.push(checkpointId);
    this.checkpointsBySpreadsheet.set(spreadsheetId, existing);

    // Prune old checkpoints if exceeding max
    if (existing.length > this.maxCheckpoints) {
      const oldestId = existing.shift();
      if (oldestId) {
        await this.deleteCheckpoint(oldestId).catch(() => {
          // Ignore errors during pruning
        });
      }
    }

    return checkpointId;
  }

  listCheckpoints(spreadsheetId: string): Checkpoint[] {
    const ids = this.checkpointsBySpreadsheet.get(spreadsheetId) ?? [];
    return ids.map((id) => this.checkpoints.get(id)!).filter(Boolean);
  }

  inspectState(checkpointId: string): CheckpointState {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new NotFoundError('checkpoint', checkpointId);
    }

    return {
      id: checkpoint.id,
      name: checkpoint.name,
      operations: checkpoint.operations,
      snapshotId: checkpoint.snapshotId,
    };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new NotFoundError('checkpoint', checkpointId);
    }

    // Delete snapshot
    await this.snapshotService.delete(checkpoint.snapshotId);

    // Remove from memory
    this.checkpoints.delete(checkpointId);

    const ids = this.checkpointsBySpreadsheet.get(checkpoint.spreadsheetId) ?? [];
    const filtered = ids.filter((id) => id !== checkpointId);
    this.checkpointsBySpreadsheet.set(checkpoint.spreadsheetId, filtered);
  }

  // ─── Blame Analysis ─────────────────────────────────────────────────────

  blameCell(spreadsheetId: string, cell: string): BlameResult {
    const operations = this.historyService.getBySpreadsheet(spreadsheetId);

    const overlapping = operations.filter((op) => {
      const range = op.params['range'] as string | undefined;
      if (!range) return false;
      return cellOverlapsRange(cell, range);
    });

    return {
      cell,
      operations: overlapping,
    };
  }

  blameOperation(spreadsheetId: string, operationId: string): BlameOperationResult {
    const operation = this.historyService.getById(operationId);
    if (!operation) {
      throw new NotFoundError('operation', operationId);
    }

    const range = operation.params['range'] as string | undefined;
    if (!range) {
      return { operation, dependents: [] };
    }

    // Find operations that came after and overlap with this operation's range
    const operations = this.historyService.getBySpreadsheet(spreadsheetId);
    const operationTime = new Date(operation.timestamp).getTime();

    const dependents = operations.filter((op) => {
      if (op.id === operationId) return false;

      const opTime = new Date(op.timestamp).getTime();
      if (opTime <= operationTime) return false;

      const opRange = op.params['range'] as string | undefined;
      if (!opRange) return false;

      return rangesOverlap(range, opRange);
    });

    return { operation, dependents };
  }

  // ─── Branching ──────────────────────────────────────────────────────────

  createBranch(spreadsheetId: string, name: string, fromCheckpoint?: string): Branch {
    const key = `${spreadsheetId}:${name}`;

    if (this.branches.has(key)) {
      throw new ValidationError(
        `Branch ${name} already exists for spreadsheet ${spreadsheetId}`,
        'name',
        'unique branch name'
      );
    }

    let operations: OperationHistory[];

    if (fromCheckpoint) {
      const checkpoint = this.checkpoints.get(fromCheckpoint);
      if (!checkpoint) {
        throw new NotFoundError('checkpoint', fromCheckpoint);
      }
      operations = [...checkpoint.operations];
    } else {
      operations = [...this.historyService.getBySpreadsheet(spreadsheetId)];
    }

    const branch: Branch = {
      name,
      operations,
      createdAt: new Date().toISOString(),
    };

    this.branches.set(key, branch);

    // Set as active if this is the first branch for this spreadsheet
    if (!this.activeBranches.has(spreadsheetId)) {
      this.activeBranches.set(spreadsheetId, 'main');
    }

    return branch;
  }

  getCurrentBranch(spreadsheetId: string): string {
    return this.activeBranches.get(spreadsheetId) ?? 'main';
  }

  switchBranch(spreadsheetId: string, name: string): void {
    const key = `${spreadsheetId}:${name}`;

    if (!this.branches.has(key)) {
      throw new NotFoundError('branch', `${name} for spreadsheet ${spreadsheetId}`);
    }

    this.activeBranches.set(spreadsheetId, name);
  }

  mergeBranch(spreadsheetId: string, sourceName: string, targetName: string): MergeResult {
    const sourceKey = `${spreadsheetId}:${sourceName}`;
    const targetKey = `${spreadsheetId}:${targetName}`;

    const sourceBranch = this.branches.get(sourceKey);
    const targetBranch = this.branches.get(targetKey);

    if (!sourceBranch) {
      throw new NotFoundError('branch', sourceName);
    }
    if (!targetBranch) {
      throw new NotFoundError('branch', targetName);
    }

    // Find operations in source that aren't in target
    const targetOpIds = new Set(targetBranch.operations.map((op) => op.id));
    const newOps = sourceBranch.operations.filter((op) => !targetOpIds.has(op.id));

    // Detect conflicts (overlapping ranges)
    const conflicts: MergeResult['conflicts'] = [];

    for (const sourceOp of newOps) {
      const sourceRange = sourceOp.params['range'] as string | undefined;
      if (!sourceRange) continue;

      for (const targetOp of targetBranch.operations) {
        const targetRange = targetOp.params['range'] as string | undefined;
        if (!targetRange) continue;

        if (rangesOverlap(sourceRange, targetRange)) {
          conflicts.push({
            sourceOp,
            targetOp,
            reason: `Range overlap: ${sourceRange} overlaps with ${targetRange}`,
          });
        }
      }
    }

    const success = conflicts.length === 0;

    return {
      success,
      mergedOperations: newOps,
      conflicts,
    };
  }

  // ─── Diffing ────────────────────────────────────────────────────────────

  diffCheckpoints(checkpointId1: string, checkpointId2: string): CheckpointDiff {
    const cp1 = this.checkpoints.get(checkpointId1);
    const cp2 = this.checkpoints.get(checkpointId2);

    if (!cp1) {
      throw new NotFoundError('checkpoint', checkpointId1);
    }
    if (!cp2) {
      throw new NotFoundError('checkpoint', checkpointId2);
    }

    const ops1Ids = new Set(cp1.operations.map((op) => op.id));
    const ops2Ids = new Set(cp2.operations.map((op) => op.id));

    const added = cp2.operations.filter((op) => !ops1Ids.has(op.id));
    const removed = cp1.operations.filter((op) => !ops2Ids.has(op.id));

    const time1 = new Date(cp1.createdAt).getTime();
    const time2 = new Date(cp2.createdAt).getTime();
    const timeDelta = time2 - time1;

    return {
      operationsAdded: added,
      operationsRemoved: removed,
      timeDelta,
    };
  }
}
