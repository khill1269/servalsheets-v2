/**
 * ServalSheets - Safety Helpers
 *
 * Unified safety patterns for all handlers:
 * - Dry-run support
 * - Snapshot creation
 * - Confirmation requirements
 * - Safety warnings and suggestions
 */

import type { SnapshotService } from '../services/snapshot.js';
import { logger } from './logger.js';

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
  spreadsheetId?: string;
}

export interface SafetyWarning {
  type:
    | 'snapshot_recommended'
    | 'confirmation_recommended'
    | 'dry_run_recommended'
    | 'large_operation';
  message: string;
  suggestion: string;
}

export interface SnapshotResult {
  snapshotId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Determine if operation requires confirmation based on size/risk
 */
export function requiresConfirmation(context: SafetyContext): boolean {
  const { affectedCells = 0, affectedRows = 0, isDestructive } = context;

  // Destructive operations on >100 cells require confirmation
  if (isDestructive && affectedCells > 100) {
    return true;
  }

  // Deleting >10 rows requires confirmation
  if (context.operationType.includes('delete') && affectedRows > 10) {
    return true;
  }

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

  // Recommend confirmation for large/destructive operations
  if (requiresConfirmation(context) && !safetyOptions?.requireConfirmation) {
    warnings.push({
      type: 'confirmation_recommended',
      message: `This operation affects ${affectedCells > 0 ? `${affectedCells} cells` : `${affectedRows} rows`}`,
      suggestion: 'Consider using sheets_confirm to review the plan before execution',
    });
  }

  // Recommend snapshot for destructive operations
  if (isDestructive && !safetyOptions?.createSnapshot && !safetyOptions?.dryRun) {
    warnings.push({
      type: 'snapshot_recommended',
      message: `${operationType} is destructive and cannot be undone without a snapshot`,
      suggestion: 'Add {"safety":{"createSnapshot":true}} for instant undo capability',
    });
  }

  // Recommend dry-run for first-time operations
  if (isDestructive && !safetyOptions?.dryRun && affectedCells > 50) {
    warnings.push({
      type: 'dry_run_recommended',
      message: 'Preview changes before executing',
      suggestion: 'Use {"safety":{"dryRun":true}} to see what will change without executing',
    });
  }

  // Warn about large operations
  if (affectedCells > 1000 || affectedRows > 500) {
    warnings.push({
      type: 'large_operation',
      message: `Large operation (${affectedCells || affectedRows} ${affectedCells > 0 ? 'cells' : 'rows'})`,
      suggestion: 'Consider using sheets_transaction to batch operations for better performance',
    });
  }

  return warnings;
}

/**
 * Create snapshot if requested and operation is destructive
 */
export async function createSnapshotIfNeeded(
  snapshotService: SnapshotService | undefined,
  context: SafetyContext,
  safetyOptions?: SafetyOptions
): Promise<SnapshotResult | null> {
  // Only create snapshot if requested AND operation is destructive
  if (!safetyOptions?.createSnapshot || !context.isDestructive) {
    return null;
  }

  if (!snapshotService) {
    logger.warn('Snapshot requested but snapshotService not available', {
      operationType: context.operationType,
    });
    return null;
  }

  if (!context.spreadsheetId) {
    logger.warn('Snapshot requested but spreadsheetId not provided', {
      operationType: context.operationType,
    });
    return null;
  }

  try {
    const snapshot = await snapshotService.create(
      context.spreadsheetId,
      `Before ${context.operationType}`
    );

    logger.info('Snapshot created for safety', {
      snapshotId: (snapshot as { id?: string }).id,
      operationType: context.operationType,
      spreadsheetId: context.spreadsheetId,
    });

    return {
      snapshotId: (snapshot as { id?: string }).id ?? '',
      createdAt: new Date().toISOString(),
      metadata: {
        operationType: context.operationType,
        affectedCells: context.affectedCells,
        affectedRows: context.affectedRows,
      },
    };
  } catch (error) {
    logger.error('Failed to create safety snapshot', {
      error: error instanceof Error ? error.message : String(error),
      operationType: context.operationType,
      spreadsheetId: context.spreadsheetId,
    });
    return null;
  }
}

/**
 * Calculate affected cells from range
 */
export function calculateAffectedCells(range?: string): number {
  if (!range) return 0;

  // Parse A1 notation range (e.g., "A1:D10" = 4 cols × 10 rows = 40 cells)
  const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
  if (!match) return 0;

  const [, startCol, startRow, endCol, endRow] = match;
  if (!startCol || !startRow || !endCol || !endRow) return 0;

  const colStart = columnToNumber(startCol);
  const colEnd = columnToNumber(endCol);
  const rowStart = parseInt(startRow, 10);
  const rowEnd = parseInt(endRow, 10);

  const cols = colEnd - colStart + 1;
  const rows = rowEnd - rowStart + 1;

  return cols * rows;
}

/**
 * Convert column letter to number (A=1, B=2, ..., Z=26, AA=27, etc.)
 */
function columnToNumber(col: string): number {
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

/**
 * Extract affected rows from dimension operations
 */
export function calculateAffectedRows(startIndex: number, count: number): number {
  return count;
}

/**
 * Format safety warnings for response
 */
export function formatSafetyWarnings(warnings: SafetyWarning[]): string[] {
  return warnings.map((w) => `${w.message}. ${w.suggestion}`);
}

/**
 * Check if dry-run mode should return preview
 */
export function shouldReturnPreview(safetyOptions?: SafetyOptions): boolean {
  return safetyOptions?.dryRun === true;
}

/**
 * Build snapshot info for response
 */
export function buildSnapshotInfo(
  snapshot: SnapshotResult | null
): Record<string, unknown> | undefined {
  // OK: Explicit empty - typed as optional, no snapshot provided
  if (!snapshot) return undefined;

  return {
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    undoInstructions: [
      `To undo: sheets_collaborate action="version_restore_snapshot" snapshotId="${snapshot.snapshotId}"`,
      'Or: sheets_history action="undo"',
    ],
  };
}
