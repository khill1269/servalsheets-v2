/**
 * Serval Core - Safety Helpers
 *
 * Platform-agnostic safety patterns:
 * - Dry-run support
 * - Snapshot creation (via abstract interface)
 * - Confirmation requirements
 * - Safety warnings and suggestions
 */

import { defaultLogger } from '../utils/logger.js';

export interface SafetyOptions {
  dryRun?: boolean;
  createSnapshot?: boolean;
  requireConfirmation?: boolean;
}

export interface SafetyContext {
  affectedCells?: number;
  affectedRows?: number;
  affectedColumns?: number;
  isDestructive: boolean;
  operationType: string;
  /** Platform-specific document/spreadsheet identifier */
  documentId?: string;
}

export interface SafetyWarning {
  type: 'snapshot_recommended' | 'confirmation_recommended' | 'dry_run_recommended' | 'large_operation';
  message: string;
  suggestion: string;
}

export interface SnapshotResult {
  snapshotId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Abstract snapshot service — implemented per-platform
 */
export interface SnapshotProvider {
  create(documentId: string, description: string): Promise<{ id?: string }>;
}

/**
 * Determine if operation requires confirmation based on size/risk
 */
export function requiresConfirmation(context: SafetyContext): boolean {
  const { affectedCells = 0, affectedRows = 0, isDestructive } = context;

  if (isDestructive && affectedCells > 100) return true;
  if (context.operationType.includes('delete') && affectedRows > 10) return true;

  return false;
}

/**
 * Generate safety warnings and suggestions for operation
 */
export function generateSafetyWarnings(
  context: SafetyContext,
  safetyOptions?: SafetyOptions
): SafetyWarning[] {
  const warnings: SafetyWarning[] = [];
  const { affectedCells = 0, affectedRows = 0, isDestructive, operationType } = context;

  if (requiresConfirmation(context) && !safetyOptions?.requireConfirmation) {
    warnings.push({
      type: 'confirmation_recommended',
      message: `This operation affects ${affectedCells > 0 ? `${affectedCells} cells` : `${affectedRows} rows`}`,
      suggestion: 'Consider reviewing the plan before execution',
    });
  }

  if (isDestructive && !safetyOptions?.createSnapshot && !safetyOptions?.dryRun) {
    warnings.push({
      type: 'snapshot_recommended',
      message: `${operationType} is destructive and cannot be undone without a snapshot`,
      suggestion: 'Add {"safety":{"createSnapshot":true}} for instant undo capability',
    });
  }

  if (isDestructive && !safetyOptions?.dryRun && affectedCells > 50) {
    warnings.push({
      type: 'dry_run_recommended',
      message: 'Preview changes before executing',
      suggestion: 'Use {"safety":{"dryRun":true}} to see what will change without executing',
    });
  }

  if (affectedCells > 1000 || affectedRows > 500) {
    warnings.push({
      type: 'large_operation',
      message: `Large operation (${affectedCells || affectedRows} ${affectedCells > 0 ? 'cells' : 'rows'})`,
      suggestion: 'Consider batching operations for better performance',
    });
  }

  return warnings;
}

/**
 * Create snapshot if requested and operation is destructive
 */
export async function createSnapshotIfNeeded(
  snapshotProvider: SnapshotProvider | undefined,
  context: SafetyContext,
  safetyOptions?: SafetyOptions
): Promise<SnapshotResult | null> {
  if (!safetyOptions?.createSnapshot || !context.isDestructive) return null;

  if (!snapshotProvider) {
    defaultLogger.warn('Snapshot requested but provider not available', {
      operationType: context.operationType,
    });
    return null;
  }

  if (!context.documentId) {
    defaultLogger.warn('Snapshot requested but documentId not provided', {
      operationType: context.operationType,
    });
    return null;
  }

  try {
    const snapshot = await snapshotProvider.create(
      context.documentId,
      `Before ${context.operationType}`
    );

    defaultLogger.info('Snapshot created for safety', {
      snapshotId: snapshot.id,
      operationType: context.operationType,
      documentId: context.documentId,
    });

    return {
      snapshotId: snapshot.id ?? '',
      createdAt: new Date().toISOString(),
      metadata: {
        operationType: context.operationType,
        affectedCells: context.affectedCells,
        affectedRows: context.affectedRows,
      },
    };
  } catch (error) {
    defaultLogger.error('Failed to create safety snapshot', {
      error: error instanceof Error ? error.message : String(error),
      operationType: context.operationType,
      documentId: context.documentId,
    });
    return null;
  }
}

/**
 * Calculate affected cells from A1-notation range (e.g., "A1:D10")
 */
export function calculateAffectedCells(range?: string): number {
  if (!range) return 0;
  const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
  if (!match) return 0;

  const [, startCol, startRow, endCol, endRow] = match;
  if (!startCol || !startRow || !endCol || !endRow) return 0;

  const colStart = columnToNumber(startCol);
  const colEnd = columnToNumber(endCol);
  const rowStart = parseInt(startRow, 10);
  const rowEnd = parseInt(endRow, 10);

  return (colEnd - colStart + 1) * (rowEnd - rowStart + 1);
}

function columnToNumber(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

export function calculateAffectedRows(_startIndex: number, count: number): number {
  return count;
}

export function formatSafetyWarnings(warnings: SafetyWarning[]): string[] {
  return warnings.map((w) => `${w.message}. ${w.suggestion}`);
}

export function shouldReturnPreview(safetyOptions?: SafetyOptions): boolean {
  return safetyOptions?.dryRun === true;
}

export function buildSnapshotInfo(snapshot: SnapshotResult | null): Record<string, unknown> | undefined {
  if (!snapshot) return undefined;
  return {
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    undoInstructions: [
      `Snapshot ID: ${snapshot.snapshotId}`,
      'Use your platform\'s undo/restore capability with this snapshot ID',
    ],
  };
}
