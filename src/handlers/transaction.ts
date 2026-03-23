/**
 * ServalSheets - Transaction Handler
 *
 * Handles multi-operation transactions with atomicity and auto-rollback.
 */

import { ErrorCodes } from './error-codes.js';
import { assertNever } from '../utils/type-utils.js';
import { getTransactionManager } from '../services/transaction-manager.js';
import type {
  SheetsTransactionInput,
  SheetsTransactionOutput,
  TransactionResponse,
} from '../schemas/transaction.js';
import { unwrapRequest, type HandlerContext } from './base.js';
import { ValidationError, ServiceError } from '../core/errors.js';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { applyVerbosityFilter } from './helpers/verbosity-filter.js';
import { resourceNotifications } from '../resources/notifications.js';
import { sendProgress } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

export interface TransactionHandlerOptions {
  context?: HandlerContext;
}

function tryGetTransactionSpreadsheetId(
  transactionManager: Pick<ReturnType<typeof getTransactionManager>, 'getTransaction'>,
  transactionId: string
): string | undefined {
  try {
    return transactionManager.getTransaction(transactionId)?.spreadsheetId;
  } catch {
    return undefined;
  }
}

export class TransactionHandler {
  private context?: HandlerContext;

  constructor(options: TransactionHandlerOptions = {}) {
    this.context = options.context;
  }

  async handle(input: SheetsTransactionInput): Promise<SheetsTransactionOutput> {
    const req = unwrapRequest<SheetsTransactionInput['request']>(input);
    const transactionManager = getTransactionManager();

    try {
      let response: TransactionResponse;

      switch (req.action) {
        case 'begin': {
          // Type assertion after validation
          if (!req.spreadsheetId) {
            throw new ValidationError(
              'spreadsheetId is required for begin action',
              'spreadsheetId'
            );
          }

          // Elicitation wizard: ask for a description to enrich the audit trail
          let txDescription: string | undefined;
          const beginReqAny = req as Record<string, unknown>;
          if (!beginReqAny['description'] && this.context?.server) {
            try {
              const elicitResult = await this.context.server.elicitInput({
                mode: 'form',
                message: 'Transaction description (optional — helps with audit trail):',
                requestedSchema: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      title: 'Transaction description',
                      description: 'Describe what this transaction will do (for audit trail)',
                    },
                  },
                },
              });
              if (elicitResult.action === 'accept' && elicitResult.content?.['description']) {
                txDescription = elicitResult.content['description'] as string;
              }
            } catch {
              // non-blocking — proceed without description
            }
          } else {
            txDescription = beginReqAny['description'] as string | undefined;
          }

          const txId = await transactionManager.begin(req.spreadsheetId, {
            autoCommit: false,
            autoRollback: req.autoRollback ?? true,
            autoSnapshot: req.autoSnapshot ?? false,
            isolationLevel: req.isolationLevel ?? 'read_committed',
          });

          // Warn about snapshot limitations for large spreadsheets
          const snapshotWarning = req.autoSnapshot
            ? ' Note: Snapshots are metadata-only and may fail for very large spreadsheets (>50MB metadata).'
            : '';

          const descriptionNote = txDescription ? ` Description: "${txDescription}".` : '';
          response = {
            success: true,
            action: 'begin',
            transactionId: txId,
            status: 'pending',
            operationsQueued: 0,
            message: `Transaction ${txId} started for spreadsheet ${req.spreadsheetId}.${snapshotWarning}${descriptionNote}`,
          };
          resourceNotifications.notifyTransactionStateChanged(txId, 'pending', req.spreadsheetId);
          break;
        }

        case 'queue': {
          // Type assertion after validation
          if (!req.transactionId || !req.operation) {
            throw new ValidationError(
              'transactionId and operation are required for queue action',
              'transactionId'
            );
          }

          // ISSUE-139: Hard cap on queued operations to prevent unbounded growth
          const MAX_TRANSACTION_OPS = getEnv().MAX_TRANSACTION_OPS;
          const preTx = transactionManager.getTransaction(req.transactionId);
          if (preTx.operations.length >= MAX_TRANSACTION_OPS) {
            throw new ServiceError(
              `Transaction ${req.transactionId} has reached the maximum of ${MAX_TRANSACTION_OPS} operations. Commit or rollback before adding more.`,
              'OPERATION_LIMIT_EXCEEDED',
              'transaction'
            );
          }

          await transactionManager.queue(req.transactionId, {
            type: 'custom',
            tool: req.operation.tool,
            action: req.operation.action,
            params: req.operation.params,
          });

          const tx = transactionManager.getTransaction(req.transactionId);

          // Generate warnings for large transactions
          const warnings: string[] = [];
          if (tx.operations.length > 50) {
            warnings.push(
              `Large transaction (${tx.operations.length} operations). Consider splitting into multiple smaller transactions for better reliability and easier debugging.`
            );
          } else if (tx.operations.length > 20) {
            warnings.push(
              `Transaction size is growing (${tx.operations.length} operations). Maximum recommended size is 50 operations.`
            );
          }

          response = {
            success: true,
            action: 'queue',
            transactionId: req.transactionId,
            operationsQueued: tx.operations.length,
            message: `Operation queued. ${tx.operations.length} operation(s) in transaction.`,
            _meta: warnings.length > 0 ? { warnings } : undefined,
          };
          break;
        }

        case 'commit': {
          // Type assertion after validation
          if (!req.transactionId) {
            throw new ValidationError(
              'transactionId is required for commit action',
              'transactionId'
            );
          }

          await sendProgress(0, 100, 'Committing transaction...');
          const spreadsheetId = tryGetTransactionSpreadsheetId(
            transactionManager,
            req.transactionId
          );
          const result = await transactionManager.commit(req.transactionId);
          await sendProgress(100, 100, 'Transaction committed');

          if (result.success) {
            response = {
              success: true,
              action: 'commit',
              transactionId: req.transactionId,
              status: 'committed',
              operationsExecuted: result.operationResults.length,
              apiCallsSaved: result.apiCallsSaved,
              duration: result.duration,
              message: `Transaction committed successfully. ${result.operationResults.length} operation(s) executed, ${result.apiCallsSaved} API call(s) saved.`,
            };
            resourceNotifications.notifyTransactionStateChanged(
              req.transactionId,
              'committed',
              spreadsheetId
            );
          } else {
            response = {
              success: false,
              error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: result.error?.message || 'Transaction commit failed',
                retryable: false,
                details: result.rolledBack
                  ? { rollback: 'Transaction was automatically rolled back' }
                  : undefined,
              },
            };
            resourceNotifications.notifyTransactionStateChanged(
              req.transactionId,
              'failed',
              spreadsheetId
            );
          }
          break;
        }

        case 'rollback': {
          // Type assertion after validation
          if (!req.transactionId) {
            throw new ValidationError(
              'transactionId is required for rollback action',
              'transactionId'
            );
          }

          const spreadsheetId = tryGetTransactionSpreadsheetId(
            transactionManager,
            req.transactionId
          );
          const rollbackResult = await transactionManager.rollback(req.transactionId);

          const recoveryHint = rollbackResult.snapshotId
            ? ` Snapshot ${rollbackResult.snapshotId} is available — use sheets_collaborate action="version_restore_snapshot" or sheets_history action="undo" to restore cell data.`
            : ' No snapshot was taken; use sheets_history action="undo" to manually reverse individual operations.';

          response = {
            success: true,
            action: 'rollback',
            transactionId: req.transactionId,
            status: 'rolled_back',
            snapshotId: rollbackResult.snapshotId || undefined,
            operationsExecuted: rollbackResult.operationsReverted,
            message: `Transaction ${req.transactionId} rolled back successfully (${rollbackResult.operationsReverted ?? 0} operation(s) reverted).${recoveryHint}`,
          };
          resourceNotifications.notifyTransactionStateChanged(
            req.transactionId,
            'rolled_back',
            spreadsheetId
          );
          break;
        }

        case 'status': {
          // Type assertion after validation
          if (!req.transactionId) {
            throw new ValidationError(
              'transactionId is required for status action',
              'transactionId'
            );
          }

          const tx = transactionManager.getTransaction(req.transactionId);

          response = {
            success: true,
            action: 'status',
            transactionId: req.transactionId,
            status: tx.status,
            operationsQueued: tx.operations.length,
            snapshotId: tx.snapshot?.id,
            message: `Transaction is ${tx.status} with ${tx.operations.length} operation(s) queued.`,
          };
          break;
        }

        case 'list': {
          const allTransactions = transactionManager.getActiveTransactions();

          // Apply optional filters
          let filteredTransactions = allTransactions;

          if (req.spreadsheetId) {
            filteredTransactions = allTransactions.filter(
              (tx) => tx.spreadsheetId === req.spreadsheetId
            );
          }

          // Sort by creation time (newest first)
          filteredTransactions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

          // Map transactions to response format with additional details
          const transactions = filteredTransactions.map((tx) => {
            const duration = tx.endTime
              ? tx.endTime - (tx.startTime || 0)
              : Date.now() - (tx.startTime || 0);

            return {
              id: tx.id,
              spreadsheetId: tx.spreadsheetId,
              status: tx.status,
              operationCount: tx.operations.length,
              created: new Date(tx.startTime || 0).toISOString(),
              updated: tx.endTime ? new Date(tx.endTime).toISOString() : undefined,
              duration: tx.status === 'pending' || tx.status === 'queued' ? duration : tx.duration,
              isolationLevel: tx.isolationLevel,
              snapshotId: tx.snapshot?.id,
            };
          });

          // Generate summary statistics
          const summary = {
            total: transactions.length,
            byStatus: {
              pending: transactions.filter((t) => t.status === 'pending').length,
              queued: transactions.filter((t) => t.status === 'queued').length,
              executing: transactions.filter((t) => t.status === 'executing').length,
              committed: transactions.filter((t) => t.status === 'committed').length,
              rolled_back: transactions.filter((t) => t.status === 'rolled_back').length,
              failed: transactions.filter((t) => t.status === 'failed').length,
            },
          };

          // Generate summary info for metadata
          const summaryMessage = [
            `Total: ${summary.total}`,
            `Pending: ${summary.byStatus.pending}`,
            `Queued: ${summary.byStatus.queued}`,
            `Executing: ${summary.byStatus.executing}`,
            `Committed: ${summary.byStatus.committed}`,
            `Rolled Back: ${summary.byStatus.rolled_back}`,
            `Failed: ${summary.byStatus.failed}`,
          ].join(' | ');

          // DR-01: Include WAL orphan info for crash recovery awareness
          const walReport = await transactionManager.getWalRecoveryReport();

          response = {
            success: true,
            action: 'list',
            transactions,
            walEnabled: walReport.enabled,
            walOrphans:
              walReport.orphanedTransactions.length > 0
                ? walReport.orphanedTransactions
                : undefined,
            message:
              walReport.orphanedTransactions.length > 0
                ? `Found ${transactions.length} active transaction(s). ${summaryMessage} | WAL: ${walReport.orphanedTransactions.length} orphaned transaction(s) from crash — call rollback with each transactionId to discard`
                : `Found ${transactions.length} active transaction(s). ${summaryMessage}`,
            _meta:
              transactions.length > 0
                ? {
                    summary,
                    suggestions:
                      summary.byStatus.pending > 0 || summary.byStatus.queued > 0
                        ? [
                            {
                              type: 'follow_up' as const,
                              message: `${summary.byStatus.pending + summary.byStatus.queued} transaction(s) awaiting execution`,
                              reason: 'Transactions in pending or queued state',
                              priority: 'medium' as const,
                            },
                          ]
                        : undefined,
                  }
                : undefined,
          };
          break;
        }

        default:
          assertNever(req);
      }

      // Apply verbosity filtering (LLM optimization)
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = applyVerbosityFilter(response, verbosity);

      return { response: filteredResponse };
    } catch (error) {
      // Catch-all for unexpected errors
      logger.error('Transaction handler error', {
        action: req.action,
        error,
      });
      return {
        response: {
          success: false,
          error: mapStandaloneError(error),
        },
      };
    }
  }
}
