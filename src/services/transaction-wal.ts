/**
 * TransactionManager — Write-Ahead Log (WAL)
 *
 * DR-01: Crash-recovery durability for the TransactionManager.
 *
 * Encapsulates all WAL state and operations in a single class that the
 * TransactionManager delegates to, keeping WAL logic separate from the
 * transaction state machine.
 *
 * Protocol:
 * - One JSON object per line: { seq, txId, type, ts, data }
 * - append() — write event before notifying listeners
 * - compact() — atomic temp-file rename removes completed transactions
 * - replay() — on startup, detect orphaned (begin but no commit/rollback) transactions
 */

import { promises as fsPromises, existsSync, mkdirSync } from 'fs';
import { open as fsOpen } from 'fs/promises';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../core/errors.js';
import type { TransactionEvent } from '../types/transaction.js';

/**
 * SECURITY: Write data and fsync to ensure durability.
 * Without fsync, a crash could lose the last appended WAL entries,
 * causing silent transaction loss.
 */
async function appendAndSync(filePath: string, data: string): Promise<void> {
  const fh = await fsOpen(filePath, 'a', 0o640);
  try {
    await fh.appendFile(data);
    await fh.sync(); // fsync — flush OS buffers to disk
  } finally {
    await fh.close();
  }
}

/**
 * SECURITY: Clean up stale .tmp files left by interrupted compact() operations.
 * Called during WAL initialization to prevent accumulation of orphaned temp files.
 */
async function cleanupStaleTmpFiles(walPath: string): Promise<void> {
  const tmpPath = walPath + '.tmp';
  try {
    if (existsSync(tmpPath)) {
      logger.warn('WAL: Cleaning up stale .tmp file from interrupted compact()', { tmpPath });
      await fsPromises.unlink(tmpPath);
    }
  } catch (error) {
    // Non-fatal — log and continue. The .tmp file is an incomplete compact result
    // and should not be used for recovery (the original WAL is the source of truth).
    logger.error('WAL: Failed to clean up stale .tmp file', {
      tmpPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================================
// Internal types
// ============================================================================

interface WalEntry {
  seq?: number;
  txId: string;
  type: TransactionEvent['type'];
  ts: number;
  data?: unknown;
}

export interface WalRecoveryTransaction {
  transactionId: string;
  spreadsheetId?: string;
  snapshotId?: string;
  queuedOperations: number;
  lastEventType: TransactionEvent['type'];
  lastEventTimestamp: number;
}

export interface WalRecoveryReport {
  enabled: boolean;
  walPath?: string;
  orphanedTransactions: WalRecoveryTransaction[];
}

// ============================================================================
// WalManager class
// ============================================================================

export class WalManager {
  private readonly walPath: string;
  private seq = 0;
  private orphanedTransactions: WalRecoveryTransaction[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(walPath: string) {
    this.walPath = walPath;
    this.ready = this.init();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private async init(): Promise<void> {
    try {
      const walDir = dirname(this.walPath);
      if (!existsSync(walDir)) {
        mkdirSync(walDir, { recursive: true, mode: 0o750 });
      }
      // Clean up any stale .tmp files from interrupted compact() operations
      await cleanupStaleTmpFiles(this.walPath);
      await this.replay();
    } catch (error) {
      logger.error('WAL initialization failed', {
        error: error instanceof Error ? error.message : String(error),
        walPath: this.walPath,
      });
    }
  }

  private async replay(): Promise<void> {
    if (!existsSync(this.walPath)) return;
    try {
      const content = await fsPromises.readFile(this.walPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const txEvents = new Map<
        string,
        {
          hasBegin: boolean;
          completed: boolean;
          queuedOperations: number;
          spreadsheetId?: string;
          snapshotId?: string;
          lastEventType: TransactionEvent['type'];
          lastEventTimestamp: number;
        }
      >();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as WalEntry;
          this.seq = Math.max(this.seq, entry.seq ?? 0);

          const state = txEvents.get(entry.txId) ?? {
            hasBegin: false,
            completed: false,
            queuedOperations: 0,
            lastEventType: entry.type,
            lastEventTimestamp: entry.ts,
          };

          state.lastEventType = entry.type;
          state.lastEventTimestamp = entry.ts;

          if (entry.type === 'begin') {
            state.hasBegin = true;
            const beginData =
              entry.data && typeof entry.data === 'object'
                ? (entry.data as Record<string, unknown>)
                : undefined;
            const spreadsheetId = beginData?.['spreadsheetId'];
            const snapshotId = beginData?.['snapshot'];
            if (typeof spreadsheetId === 'string') {
              state.spreadsheetId = spreadsheetId;
            }
            if (typeof snapshotId === 'string') {
              state.snapshotId = snapshotId;
            }
          }

          if (entry.type === 'queue') {
            state.queuedOperations += 1;
          }

          if (entry.type === 'commit' || entry.type === 'rollback' || entry.type === 'fail') {
            state.completed = true;
          }

          txEvents.set(entry.txId, state);
        } catch {
          // Ignore malformed WAL lines
        }
      }
      const orphaned: WalRecoveryTransaction[] = [];
      for (const [txId, state] of txEvents) {
        if (state.hasBegin && !state.completed) {
          orphaned.push({
            transactionId: txId,
            spreadsheetId: state.spreadsheetId,
            snapshotId: state.snapshotId,
            queuedOperations: state.queuedOperations,
            lastEventType: state.lastEventType,
            lastEventTimestamp: state.lastEventTimestamp,
          });
        }
      }
      this.orphanedTransactions = orphaned;

      if (this.orphanedTransactions.length > 0) {
        logger.warn('WAL replay: orphaned transactions detected from previous crash', {
          count: this.orphanedTransactions.length,
          transactions: this.orphanedTransactions.map((tx) => ({
            transactionId: tx.transactionId,
            spreadsheetId: tx.spreadsheetId,
            snapshotId: tx.snapshotId,
            queuedOperations: tx.queuedOperations,
          })),
        });
      } else {
        logger.info('WAL replay: no orphaned transactions', { walPath: this.walPath });
      }
    } catch (error) {
      logger.warn('WAL replay failed', {
        error: error instanceof Error ? error.message : String(error),
        walPath: this.walPath,
      });
    }
  }

  // ============================================================================
  // Write operations
  // ============================================================================

  async append(event: TransactionEvent): Promise<void> {
    await this.ready;
    await this.runOperation('append', async () => {
      const entry =
        JSON.stringify({
          seq: ++this.seq,
          txId: event.transactionId,
          type: event.type,
          ts: event.timestamp,
          data: event.data ?? {},
        }) + '\n';
      await appendAndSync(this.walPath, entry);
    });
  }

  async compact(completedTxId: string): Promise<void> {
    await this.ready;
    await this.runOperation('compact', async () => {
      if (!existsSync(this.walPath)) return;

      const content = await fsPromises.readFile(this.walPath, 'utf8');
      const remaining = content
        .split('\n')
        .filter((line) => {
          if (!line) return false;
          try {
            const entry = JSON.parse(line) as { txId: string };
            return entry.txId !== completedTxId;
          } catch {
            return true; // Keep malformed lines (don't lose data)
          }
        })
        .join('\n');
      const tmpPath = this.walPath + '.tmp';
      // Write compacted WAL to temp file with fsync before atomic rename
      const fh = await fsOpen(tmpPath, 'w', 0o640);
      try {
        await fh.writeFile(remaining ? remaining + '\n' : '');
        await fh.sync(); // fsync — ensure compacted data is on disk before rename
      } finally {
        await fh.close();
      }
      await fsPromises.rename(tmpPath, this.walPath);

      this.orphanedTransactions = this.orphanedTransactions.filter(
        (tx) => tx.transactionId !== completedTxId
      );
    });
  }

  private runOperation(operationName: string, operation: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      try {
        await operation();
      } catch (error) {
        logger.warn('WAL operation failed', {
          operation: operationName,
          error: error instanceof Error ? error.message : String(error),
          walPath: this.walPath,
        });
      }
    });
    return this.writeChain;
  }

  // ============================================================================
  // Recovery queries
  // ============================================================================

  async getRecoveryReport(): Promise<WalRecoveryReport> {
    await this.ready;
    return {
      enabled: true,
      walPath: this.walPath,
      orphanedTransactions: [...this.orphanedTransactions],
    };
  }

  async discardOrphaned(transactionId: string): Promise<void> {
    const exists = this.orphanedTransactions.some((tx) => tx.transactionId === transactionId);
    if (!exists) {
      throw new NotFoundError('orphaned transaction', transactionId);
    }
    await this.compact(transactionId);
    logger.info('Discarded orphaned WAL transaction', { transactionId });
  }

  removeOrphanedLocally(transactionId: string): void {
    this.orphanedTransactions = this.orphanedTransactions.filter(
      (tx) => tx.transactionId !== transactionId
    );
  }
}
