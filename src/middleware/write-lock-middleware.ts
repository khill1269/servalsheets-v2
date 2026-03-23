/**
 * Per-Spreadsheet Write Lock Middleware
 *
 * Serializes all mutation operations per spreadsheetId using PQueue(concurrency=1).
 * Read operations bypass the lock entirely, maintaining full parallelism.
 *
 * This prevents data corruption from concurrent writes to the same spreadsheet
 * across multiple Claude sessions or parallel tool calls.
 */

import PQueue, { TimeoutError } from 'p-queue';
import { logger } from '../utils/logger.js';
import { ServiceError } from '../core/errors.js';
import { ErrorCodes } from '../handlers/error-codes.js';

// Per-spreadsheet write queues. Max 1 concurrent write per spreadsheet.
const writeLocks = new Map<string, PQueue>();

// Clean idle locks every 5 minutes to prevent memory leaks
const LOCK_CLEANUP_MS = 5 * 60 * 1000;

// Write lock acquisition timeout (default: 30s). Configurable via LOCK_TIMEOUT_MS env var.
const LOCK_TIMEOUT_MS = parseInt(process.env['LOCK_TIMEOUT_MS'] ?? '30000', 10);

// Mutation actions that require write serialization.
// These are the core data/structure/format mutations across all tools.
export const MUTATION_ACTIONS = new Set<string>([
  // sheets_data — direct data writes
  'write',
  'append',
  'clear',
  'batch_write',
  'batch_clear',
  'cross_write',
  'import_csv',
  'import_xlsx',
  'smart_append',
  'smart_fill',
  // sheets_fix — mutating fixes
  'clean',
  'standardize_formats',
  'fill_missing',
  // sheets_composite — bulk write operations
  'bulk_update',
  'deduplicate',
  'setup_sheet',
  'import_and_format',
  'clone_structure',
  'generate_sheet',
  'generate_template',
  'batch_operations',
  'data_pipeline',
  'instantiate_template',
  'migrate_spreadsheet',
  'cut_paste',
  'copy_paste',
  'find_replace',
  'merge_cells',
  'unmerge_cells',
  'set_hyperlink',
  'clear_hyperlink',
  'add_note',
  'clear_note',
  // sheets_dimensions — structural changes
  'delete_sheet',
  'batch_delete_sheets',
  'clear_sheet',
  'insert',
  'delete',
  'move',
  'resize',
  'hide',
  'show',
  'freeze',
  'group',
  'ungroup',
  'trim_whitespace',
  'text_to_columns',
  'randomize_range',
  'set_basic_filter',
  'clear_basic_filter',
  'sort_range',
  'create_filter_view',
  'update_filter_view',
  'delete_filter_view',
  'create_slicer',
  'update_slicer',
  'delete_slicer',
  'auto_fill',
  // sheets_format — formatting mutations
  'set_format',
  'set_background',
  'set_text_format',
  'set_number_format',
  'set_alignment',
  'set_borders',
  'clear_format',
  'apply_preset',
  'batch_format',
  'set_data_validation',
  'clear_data_validation',
  'add_conditional_format_rule',
  'rule_add_conditional_format',
  'rule_update_conditional_format',
  'rule_delete_conditional_format',
  'set_rich_text',
  'sparkline_add',
  'sparkline_clear',
]);

// Additional mutation actions not currently covered by MUTATION_ACTIONS.
// These actions mutate spreadsheet data/structure and must be serialized.
export const FORCE_WRITE_ACTIONS = new Set<string>([
  // sheets_core
  'add_sheet',
  'update_sheet',
  'duplicate_sheet',
  'copy_sheet_to',
  'batch_update_sheets',
  'move_sheet',
  // sheets_visualize
  'chart_create',
  'chart_update',
  'chart_delete',
  'chart_move',
  'chart_resize',
  'chart_update_data_range',
  'chart_add_trendline',
  'chart_remove_trendline',
  'pivot_create',
  'pivot_update',
  'pivot_delete',
  'pivot_refresh',
  // sheets_advanced
  'add_named_range',
  'update_named_range',
  'delete_named_range',
  'add_protected_range',
  'update_protected_range',
  'delete_protected_range',
  'set_metadata',
  'delete_metadata',
  'add_banding',
  'update_banding',
  'delete_banding',
  'create_table',
  'delete_table',
  'update_table',
  'rename_table_column',
  'set_table_column_properties',
  'add_person_chip',
  'add_drive_chip',
  'add_rich_link_chip',
  'create_named_function',
  'update_named_function',
  'delete_named_function',
  // sheets_collaborate
  'comment_add',
  'comment_update',
  'comment_delete',
  'comment_resolve',
  'comment_reopen',
  'comment_add_reply',
  'comment_update_reply',
  'comment_delete_reply',
  'version_restore_revision',
  'version_keep_revision',
  'version_create_snapshot',
  'version_restore_snapshot',
  'version_delete_snapshot',
  'approval_create',
  'approval_approve',
  'approval_reject',
  'approval_delegate',
  'approval_cancel',
  // sheets_dependencies
  'create_scenario_sheet',
]);

const MUTATION_ACTION_PREFIX =
  /^(write|append|clear|batch_write|batch_clear|cross_write|set_|add_|update_|delete_|remove_|create_|insert|move|copy_|cut_|merge_|unmerge_|apply_|rule_|share_|comment_|approval_|import_|export_|connect|disconnect|refresh|cancel_|deploy|undeploy|run|rollback|commit|queue|begin|subscribe|unsubscribe|watch_|instantiate_|migrate_|bulk_|deduplicate|fill_|standardize_|clean|fix|execute|resolve_)/;

const SPREADSHEET_ID_KEYS = new Set([
  'spreadsheetId',
  'sourceSpreadsheetId',
  'destinationSpreadsheetId',
]);

export function isLikelyMutationAction(action: string): boolean {
  return (
    isMutationAction(action) ||
    FORCE_WRITE_ACTIONS.has(action) ||
    MUTATION_ACTION_PREFIX.test(action)
  );
}

function collectSpreadsheetIds(
  value: unknown,
  ids: Set<string>,
  parentKey?: string,
  depth: number = 0
): void {
  if (depth > 8 || value == null) return;

  if (typeof value === 'string') {
    if (parentKey && SPREADSHEET_ID_KEYS.has(parentKey)) {
      ids.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (parentKey === 'spreadsheetIds') {
      for (const entry of value) {
        if (typeof entry === 'string') ids.add(entry);
      }
      return;
    }
    // Skip scanning large value payload arrays (e.g., cell matrices) for IDs.
    if (parentKey === 'values' || parentKey === 'data') return;
    for (const entry of value) {
      collectSpreadsheetIds(entry, ids, undefined, depth + 1);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      collectSpreadsheetIds(entry, ids, key, depth + 1);
    }
  }
}

/**
 * Get or create a write lock queue for a spreadsheet.
 * Each queue has concurrency=1, serializing writes to that spreadsheet.
 */
export function getWriteLock(spreadsheetId: string): PQueue {
  let queue = writeLocks.get(spreadsheetId);
  if (!queue) {
    queue = new PQueue({ concurrency: 1, timeout: LOCK_TIMEOUT_MS });
    writeLocks.set(spreadsheetId, queue);
    logger.debug('Write lock created for spreadsheet', {
      spreadsheetId,
      timeoutMs: LOCK_TIMEOUT_MS,
    });
  }
  return queue;
}

/**
 * Check if an action is a mutation that requires write serialization.
 */
export function isMutationAction(action: string): boolean {
  return MUTATION_ACTIONS.has(action as Parameters<typeof MUTATION_ACTIONS.has>[0]);
}

/**
 * Extract action and spreadsheetId from normalized tool args.
 * Args are expected in { request: { action, spreadsheetId, ... } } format
 * after normalizeToolArgs() processing.
 */
export function extractWriteLockParams(normalizedArgs: Record<string, unknown>): {
  action?: string;
  spreadsheetIds: string[];
} {
  const request = normalizedArgs['request'];
  if (!request || typeof request !== 'object') {
    return { spreadsheetIds: [] };
  }
  const req = request as Record<string, unknown>;
  const ids = new Set<string>();
  collectSpreadsheetIds(req, ids);
  return {
    action: typeof req['action'] === 'string' ? req['action'] : undefined,
    spreadsheetIds: [...ids],
  };
}

async function withMultipleWriteLocks<T>(
  spreadsheetIds: string[],
  fn: () => Promise<T>
): Promise<T> {
  const lockOrder = [...new Set(spreadsheetIds)].sort();
  if (lockOrder.length === 0) return fn();

  const executeAt = async (index: number): Promise<T> => {
    if (index >= lockOrder.length) return fn();
    const spreadsheetId = lockOrder[index];
    if (!spreadsheetId) {
      return executeAt(index + 1);
    }
    const lock = getWriteLock(spreadsheetId);
    return lock.add(async () => executeAt(index + 1)) as Promise<T>;
  };

  return executeAt(0);
}

/**
 * Execute a handler with write-lock serialization if the action is a mutation
 * targeting a specific spreadsheet. Reads bypass the lock entirely.
 */
export async function withWriteLock<T>(
  normalizedArgs: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const { action, spreadsheetIds } = extractWriteLockParams(normalizedArgs);

  if (action && spreadsheetIds.length > 0 && isLikelyMutationAction(action)) {
    logger.debug('Acquiring write lock(s)', {
      action,
      spreadsheets: spreadsheetIds,
      lockCount: spreadsheetIds.length,
    });
    try {
      return await withMultipleWriteLocks(spreadsheetIds, fn);
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new ServiceError(
          `Write lock acquisition timed out after ${LOCK_TIMEOUT_MS}ms for action '${action}'. ` +
            'Another operation is holding the write lock. Retry after the concurrent write completes.',
          ErrorCodes.LOCK_TIMEOUT,
          'WriteLockMiddleware',
          true // retryable
        );
      }
      throw err;
    }
  }

  // Not a mutation or no spreadsheet target — execute immediately without lock
  return fn();
}

/**
 * Remove idle lock queues (no pending or running tasks) to prevent memory leaks.
 */
export function cleanupIdleLocks(): void {
  let cleaned = 0;
  for (const [id, queue] of writeLocks.entries()) {
    if (queue.size === 0 && queue.pending === 0) {
      writeLocks.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug('Cleaned up idle write locks', { cleaned, remaining: writeLocks.size });
  }
}

// Run cleanup every 5 minutes (unref so it doesn't keep the process alive)
const cleanupInterval = setInterval(cleanupIdleLocks, LOCK_CLEANUP_MS);
cleanupInterval.unref();

/**
 * Get current write lock statistics (for diagnostics).
 */
export function getWriteLockStats(): {
  activeSpreadsheets: number;
  locks: Array<{ spreadsheetId: string; pending: number; running: number }>;
} {
  const locks: Array<{ spreadsheetId: string; pending: number; running: number }> = [];
  for (const [id, queue] of writeLocks.entries()) {
    locks.push({ spreadsheetId: id, pending: queue.size, running: queue.pending });
  }
  return { activeSpreadsheets: writeLocks.size, locks };
}
