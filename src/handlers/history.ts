/**
 * ServalSheets - History Handler
 *
 * Handles operation history tracking, undo/redo functionality, and debugging.
 */

import { ErrorCodes } from './error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import { getHistoryService } from '../services/history-service.js';
import { SnapshotService } from '../services/snapshot.js';
import { createNotFoundError } from '../utils/error-factory.js';
import type {
  SheetsHistoryInput,
  SheetsHistoryOutput,
  HistoryResponse,
  HistoryTimelineInput,
  HistoryDiffRevisionsInput,
  HistoryRestoreCellsInput,
} from '../schemas/history.js';
import { unwrapRequest } from './base.js';
import { getTimeline, diffRevisions, restoreCells } from '../services/revision-timeline.js';
import type { ElicitationServer } from '../mcp/elicitation.js';
import { confirmDestructiveAction } from '../mcp/elicitation.js';
import type { SamplingServer } from '../mcp/sampling.js';
import { withSamplingTimeout, assertSamplingConsent, generateAIInsight } from '../mcp/sampling.js';
import { applyVerbosityFilter } from './helpers/verbosity-filter.js';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { recordRevisionId } from '../mcp/completions.js';
import { recordTimeTravelOp } from '../observability/metrics.js';
import { getSessionContext } from '../services/session-context.js';
import { logger } from '../utils/logger.js';
import { sendProgress } from '../utils/request-context.js';
import type { HistoryHandlerOptions } from '../types/history-handler-options.js';

export type { HistoryHandlerOptions } from '../types/history-handler-options.js';

export class HistoryHandler {
  private snapshotService?: SnapshotService;
  private driveApi?: drive_v3.Drive;
  private sheetsApi?: sheets_v4.Sheets;
  private server?: ElicitationServer;
  private samplingServer?: SamplingServer;
  private googleClient?: import('../services/google-api.js').GoogleApiClient;
  private sessionContext?: HistoryHandlerOptions['sessionContext'];

  constructor(options: HistoryHandlerOptions = {}) {
    this.snapshotService = options.snapshotService;
    this.driveApi = options.driveApi;
    this.sheetsApi = options.sheetsApi;
    this.server = options.server;
    this.samplingServer = options.samplingServer;
    this.googleClient = options.googleClient;
    this.sessionContext = options.sessionContext;
  }

  async handle(input: SheetsHistoryInput): Promise<SheetsHistoryOutput> {
    const req = unwrapRequest<SheetsHistoryInput['request']>(input);
    const historyService = getHistoryService();

    try {
      let response: HistoryResponse;

      switch (req.action) {
        case 'list': {
          let operations;
          if (req.failuresOnly) {
            operations = historyService.getFailures(req.count);
          } else if (req.spreadsheetId) {
            operations = historyService.getBySpreadsheet(req.spreadsheetId, req.count);
          } else {
            operations = historyService.getRecent(req.count || 10);
          }

          response = {
            success: true,
            action: 'list',
            operations: operations.map((op) => ({
              id: op.id,
              tool: op.tool,
              action: op.action,
              spreadsheetId: op.spreadsheetId,
              range: undefined,
              success: op.result === 'success',
              duration: op.duration,
              timestamp: new Date(op.timestamp).getTime(),
              error: op.errorMessage,
            })),
            message: `Retrieved ${operations.length} operation(s)`,
          };
          break;
        }

        case 'get': {
          const operation = historyService.getById(req.operationId!);

          if (!operation) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'operation',
                resourceId: req.operationId!,
                searchSuggestion: 'Use action "list" to see available operation IDs',
              }),
            };
            break;
          }

          response = {
            success: true,
            action: 'get',
            operation: {
              id: operation.id,
              tool: operation.tool,
              action: operation.action,
              params: operation.params as Record<
                string,
                string | number | boolean | null | unknown[] | Record<string, unknown>
              >,
              result: operation.result === 'success' ? 'success' : operation.result,
              spreadsheetId: operation.spreadsheetId,
              range: undefined,
              success: operation.result === 'success',
              duration: operation.duration,
              timestamp: new Date(operation.timestamp).getTime(),
              error: operation.errorMessage,
            },
            message: 'Operation retrieved',
          };
          break;
        }

        case 'stats': {
          const stats = historyService.getStats();

          response = {
            success: true,
            action: 'stats',
            stats: {
              totalOperations: stats.totalOperations,
              successfulOperations: stats.successfulOperations,
              failedOperations: stats.failedOperations,
              successRate: stats.successRate,
              avgDuration: stats.averageDuration,
              operationsByTool: {},
              recentFailures: stats.failedOperations,
            },
            message: `${stats.totalOperations} operation(s) tracked, ${stats.successRate.toFixed(1)}% success rate`,
          };
          break;
        }

        case 'undo': {
          const operation = historyService.getLastUndoable(req.spreadsheetId!);

          if (!operation) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'operation',
                resourceId: 'undoable operation',
                searchSuggestion:
                  'No undoable operations exist for this spreadsheet. Check operation history with action "list"',
                parentResourceId: req.spreadsheetId,
              }),
            };
            break;
          }

          if (!operation.snapshotId) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'snapshot',
                resourceId: operation.id,
                searchSuggestion:
                  'This operation was not snapshotted and cannot be undone. Enable snapshot creation for future operations.',
              }),
            };
            break;
          }

          if (!this.snapshotService) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.SERVICE_NOT_INITIALIZED,
                message: 'Snapshot service not available',
                retryable: false,
              },
            };
            break;
          }

          // Create safety snapshot before undoing
          await this.snapshotService.create(req.spreadsheetId!, 'pre-undo backup');

          // Confirm destructive action
          if (this.server) {
            const { confirmDestructiveAction } = await import('../mcp/elicitation.js');
            const confirmation = await confirmDestructiveAction(
              this.server,
              'Undo last operation',
              'Reverts the most recent change to this spreadsheet'
            );
            if (!confirmation.confirmed) {
              response = {
                success: false,
                error: {
                  code: ErrorCodes.OPERATION_CANCELLED,
                  message: 'Undo cancelled by user',
                  retryable: false,
                },
              };
              break;
            }
          }

          try {
            // Restore from snapshot
            const restoredId = await this.snapshotService.restore(operation.snapshotId);

            // Mark as undone in history
            historyService.markAsUndone(operation.id, req.spreadsheetId!);

            response = {
              success: true,
              action: 'undo',
              restoredSpreadsheetId: restoredId,
              operationRestored: {
                id: operation.id,
                tool: operation.tool,
                action: operation.action,
                timestamp: new Date(operation.timestamp).getTime(),
              },
              message: `Undid ${operation.tool}.${operation.action} operation`,
            };
          } catch (error) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.SNAPSHOT_RESTORE_FAILED,
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
              },
            };
          }
          break;
        }

        case 'redo': {
          const operation = historyService.getLastRedoable(req.spreadsheetId!);

          if (!operation) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'operation',
                resourceId: 'redoable operation',
                searchSuggestion:
                  'No redoable operations exist. You can only redo operations that were previously undone.',
                parentResourceId: req.spreadsheetId,
              }),
            };
            break;
          }

          if (!operation.snapshotId) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'snapshot',
                resourceId: operation.id,
                searchSuggestion:
                  'This operation was not snapshotted and cannot be redone. Enable snapshot creation for future operations.',
              }),
            };
            break;
          }

          if (!this.snapshotService) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.SERVICE_NOT_INITIALIZED,
                message: 'Snapshot service not available',
                retryable: false,
              },
            };
            break;
          }

          // Create safety snapshot before redoing
          await this.snapshotService.create(req.spreadsheetId!, 'pre-redo backup');

          // Confirm destructive action
          if (this.server) {
            const { confirmDestructiveAction } = await import('../mcp/elicitation.js');
            const confirmation = await confirmDestructiveAction(
              this.server,
              'Redo last undone operation',
              'Re-applies the previously undone change'
            );
            if (!confirmation.confirmed) {
              response = {
                success: false,
                error: {
                  code: ErrorCodes.OPERATION_CANCELLED,
                  message: 'Redo cancelled by user',
                  retryable: false,
                },
              };
              break;
            }
          }

          try {
            // Restore from snapshot
            const restoredId = await this.snapshotService.restore(operation.snapshotId);

            // Mark as redone in history
            historyService.markAsRedone(operation.id, req.spreadsheetId!);

            response = {
              success: true,
              action: 'redo',
              restoredSpreadsheetId: restoredId,
              operationRestored: {
                id: operation.id,
                tool: operation.tool,
                action: operation.action,
                timestamp: new Date(operation.timestamp).getTime(),
              },
              message: `Redid ${operation.tool}.${operation.action} operation`,
            };
          } catch (error) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.SNAPSHOT_RESTORE_FAILED,
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
              },
            };
          }
          break;
        }

        case 'revert_to': {
          const operation = historyService.getById(req.operationId!);

          if (!operation) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'operation',
                resourceId: req.operationId!,
                searchSuggestion: 'Use action "list" to see available operation IDs',
              }),
            };
            break;
          }

          if (!operation.snapshotId) {
            response = {
              success: false,
              error: createNotFoundError({
                resourceType: 'snapshot',
                resourceId: operation.id,
                searchSuggestion:
                  'This operation was not snapshotted and cannot be reverted. Enable snapshot creation for future operations.',
              }),
            };
            break;
          }

          if (!this.snapshotService) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.SERVICE_NOT_INITIALIZED,
                message: 'Snapshot service not available',
                retryable: false,
              },
            };
            break;
          }

          // ISSUE-011: dryRun mode — return what would be reverted without executing
          if (req.safety?.dryRun) {
            response = {
              success: true,
              action: 'revert_to',
              dryRun: true,
              wouldRevert: {
                operationId: operation.id,
                tool: operation.tool,
                action: operation.action,
                timestamp: new Date(operation.timestamp).getTime(),
                snapshotId: operation.snapshotId,
                spreadsheetId: operation.spreadsheetId,
              },
              message: `[DRY RUN] Would revert to state before ${operation.tool}.${operation.action} — pass safety.dryRun:false to execute`,
            };
            break;
          }

          // Create safety snapshot before reverting
          await this.snapshotService.create(operation.spreadsheetId!, 'pre-revert backup');

          // Confirm destructive action
          if (this.server) {
            const { confirmDestructiveAction } = await import('../mcp/elicitation.js');
            const confirmation = await confirmDestructiveAction(
              this.server,
              `Revert to revision ${req.operationId}`,
              'All changes after this revision will be lost'
            );
            if (!confirmation.confirmed) {
              response = {
                success: false,
                error: {
                  code: ErrorCodes.OPERATION_CANCELLED,
                  message: 'Revert cancelled by user',
                  retryable: false,
                },
              };
              break;
            }
          }

          try {
            // Restore from snapshot (state before this operation)
            const restoredId = await this.snapshotService.restore(operation.snapshotId);

            response = {
              success: true,
              action: 'revert_to',
              restoredSpreadsheetId: restoredId,
              operationRestored: {
                id: operation.id,
                tool: operation.tool,
                action: operation.action,
                timestamp: new Date(operation.timestamp).getTime(),
              },
              message: `Reverted to state before ${operation.tool}.${operation.action} operation`,
            };
          } catch (error) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.SNAPSHOT_RESTORE_FAILED,
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
              },
            };
          }
          break;
        }

        case 'clear': {
          // ISSUE-100: Confirm before clearing history (irreversible — no spreadsheet data lost
          // but operation log cannot be recovered)
          if (this.server) {
            const clearScope = req.spreadsheetId
              ? `operation history for spreadsheet ${req.spreadsheetId}`
              : 'all operation history';
            const confirmation = await confirmDestructiveAction(
              this.server,
              'Clear operation history',
              `Permanently deletes ${clearScope}. The history log cannot be recovered.`
            );
            if (!confirmation.confirmed) {
              response = {
                success: false,
                error: {
                  code: ErrorCodes.OPERATION_CANCELLED,
                  message: 'Clear cancelled by user',
                  retryable: false,
                },
              };
              break;
            }
          }

          let cleared: number;

          if (req.spreadsheetId) {
            cleared = historyService.clearForSpreadsheet(req.spreadsheetId);
          } else {
            cleared = historyService.size();
            historyService.clear();
          }

          response = {
            success: true,
            action: 'clear',
            operationsCleared: cleared,
            message: req.spreadsheetId
              ? `Cleared ${cleared} operation(s) for spreadsheet ${req.spreadsheetId}`
              : `Cleared all ${cleared} operation(s)`,
          };
          break;
        }
        case 'timeline': {
          if (!this.driveApi) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: 'Drive API not available for timeline',
                retryable: false,
              },
            };
            break;
          }
          const timelineReq = req as HistoryTimelineInput;
          await sendProgress(0, 2, 'Scanning revision history...');
          const timeline = await getTimeline(this.driveApi, timelineReq.spreadsheetId, {
            since: timelineReq.since,
            until: timelineReq.until,
            limit: timelineReq.limit,
            googleClient: this.googleClient,
          });
          await sendProgress(1, 2, `Found ${timeline.items.length} revision entries`);

          // Wire session context: cache timeline for quick follow-up diff_revisions
          try {
            const session = this.sessionContext ?? getSessionContext();
            if (timeline.items.length >= 2) {
              const latestId = (timeline.items[0] as { revisionId?: string }).revisionId;
              const previousId = (timeline.items[1] as { revisionId?: string }).revisionId;
              if (latestId && previousId) {
                session.setPendingOperation({
                  type: 'timeline',
                  step: 1,
                  totalSteps: 2,
                  context: {
                    spreadsheetId: timelineReq.spreadsheetId,
                    latestRevisionId: latestId,
                    previousRevisionId: previousId,
                    entryCount: timeline.items.length,
                    since: timelineReq.since,
                    until: timelineReq.until,
                  },
                });
              }
            }
          } catch {
            /* non-blocking */
          }

          // Wire completions: cache revision IDs for argument autocompletion (ISSUE-062)
          for (const entry of timeline.items) {
            const revId = (entry as unknown as Record<string, unknown>)['revisionId'];
            if (typeof revId === 'string') recordRevisionId(revId);
          }

          // Wire AI insight: narrate change history
          let aiNarrative: string | undefined;
          if (timeline.items.length > 0) {
            const timelineSummary = timeline.items
              .slice(0, 10)
              .map((e) => {
                const entry = e as unknown as Record<string, unknown>;
                const ts = entry['timestamp']
                  ? new Date(entry['timestamp'] as string).toISOString()
                  : '?';
                const author = entry['author'] ? ` (${entry['author']})` : '';
                const desc = entry['description'] ?? entry['summary'] ?? 'unknown change';
                return `${ts}: ${desc}${author}`;
              })
              .join('; ');
            aiNarrative = await generateAIInsight(
              this.samplingServer,
              'diffNarrative',
              'Narrate this change timeline — what story does it tell about how this spreadsheet evolved?',
              timelineSummary
            );
          }

          response = {
            success: true,
            action: 'timeline',
            timeline: timeline.items,
            activityAvailable: timeline.activityAvailable,
            totalFetched: timeline.totalFetched,
            truncated: timeline.truncated,
            nextPageToken: timeline.nextPageToken,
            ...(aiNarrative !== undefined ? { aiNarrative } : {}),
            message: `Found ${timeline.items.length} revision(s)`,
          };
          recordTimeTravelOp('timeline', 'success');
          break;
        }

        case 'diff_revisions': {
          if (!this.driveApi) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: 'Drive API not available for diff',
                retryable: false,
              },
            };
            break;
          }
          const diffReq = req as HistoryDiffRevisionsInput;
          const diff = await diffRevisions(
            this.driveApi,
            diffReq.spreadsheetId,
            diffReq.revisionId1,
            diffReq.revisionId2
          );

          // If sampling is available, generate an explanation of the diff
          let aiExplanation: string | undefined;
          if (this.samplingServer) {
            try {
              const changeCount = diff.cellChanges?.length ?? 0;
              const sampleChanges = (diff.cellChanges ?? [])
                .slice(0, 5)
                .map(
                  (c: { cell: string; oldValue?: unknown; newValue?: unknown }) =>
                    `${c.cell}: ${String(c.oldValue ?? '')} → ${String(c.newValue ?? '')}`
                )
                .join('; ');
              await assertSamplingConsent(); // ISSUE-226: GDPR consent gate
              const explanationResult = await withSamplingTimeout(() =>
                this.samplingServer!.createMessage({
                  messages: [
                    {
                      role: 'user' as const,
                      content: {
                        type: 'text' as const,
                        text: `In 1-2 sentences, explain what changed between revision ${diffReq.revisionId1} and ${diffReq.revisionId2} of spreadsheet '${diffReq.spreadsheetId}'. There were ${changeCount} cell change(s)${sampleChanges ? ': ' + sampleChanges : ''}.`,
                      },
                    },
                  ],
                  maxTokens: 256,
                })
              );
              const text = Array.isArray(explanationResult.content)
                ? ((
                    explanationResult.content.find((c) => c.type === 'text') as
                      | { text: string }
                      | undefined
                  )?.text ?? '')
                : ((explanationResult.content as { text?: string }).text ?? '');
              aiExplanation = text.trim();
            } catch {
              // Non-blocking: sampling failure should not block the diff response
            }
          }

          // Wire AI insight: explain why changes matter
          let aiNarrative: string | undefined;
          if (diff.cellChanges && diff.cellChanges.length > 0) {
            const changeSummary = (
              diff.cellChanges as Array<{ cell: string; oldValue?: unknown; newValue?: unknown }>
            )
              .slice(0, 8)
              .map((c) => `${c.cell}: ${String(c.oldValue ?? '')} → ${String(c.newValue ?? '')}`)
              .join('; ');
            aiNarrative = await generateAIInsight(
              this.samplingServer,
              'diffNarrative',
              'Explain what changed between these revisions and why it matters',
              changeSummary
            );
          }

          response = {
            success: true,
            action: 'diff_revisions',
            diff,
            message: diff.summary.metadataOnly
              ? 'Cell-level diff unavailable — Google Drive API exports current version only, not historical revisions for Workspace files. Metadata comparison (timestamps, authors) is shown instead. For cell-level change tracking, use sheets_history.timeline which tracks ServalSheets operations.'
              : !diff.isHistorical
                ? `Found ${diff.cellChanges?.length ?? 0} cell change(s) — WARNING: one or both revisions could not be exported from Drive history (revision export unavailable for this file age or format). Diff may reflect current file state rather than the requested revision.`
                : `Found ${diff.cellChanges?.length ?? 0} cell change(s)`,
            ...(aiExplanation !== undefined ? { aiExplanation } : {}),
            ...(aiNarrative !== undefined ? { aiNarrative } : {}),
          };
          recordTimeTravelOp('diff_revisions', 'success');
          break;
        }

        case 'restore_cells': {
          if (!this.driveApi || !this.sheetsApi) {
            response = {
              success: false,
              error: {
                code: ErrorCodes.INTERNAL_ERROR,
                message: 'Drive/Sheets API not available for restore',
                retryable: false,
              },
            };
            break;
          }
          const restoreReq = req as HistoryRestoreCellsInput;

          if (restoreReq.safety?.dryRun) {
            response = {
              success: true,
              action: 'restore_cells',
              restored: restoreReq.cells.map((c) => ({ cell: c })),
              message: `Dry run: would restore ${restoreReq.cells.length} cell(s) from revision ${restoreReq.revisionId}`,
            };
            break;
          }

          // Create snapshot before restoring (before confirmation per safety rail order)
          let snapshotId: string | undefined;
          if (restoreReq.safety?.createSnapshot !== false && this.snapshotService) {
            snapshotId = await this.snapshotService.create(
              restoreReq.spreadsheetId,
              'Pre-restore backup'
            );
          }

          // Require confirmation when restoring >10 cells (bulk operation threshold)
          if (restoreReq.cells.length > 10 && this.server) {
            const confirmation = await confirmDestructiveAction(
              this.server,
              'restore_cells',
              `Restore ${restoreReq.cells.length} cells from revision ${restoreReq.revisionId} in spreadsheet ${restoreReq.spreadsheetId}. This will overwrite current cell values.`
            );
            if (!confirmation.confirmed) {
              response = {
                success: false,
                error: {
                  code: ErrorCodes.PRECONDITION_FAILED,
                  message: confirmation.reason || 'User cancelled the bulk restore operation',
                  retryable: false,
                  suggestedFix:
                    'Restore fewer cells at a time, or use safety.dryRun to preview first',
                },
              };
              break;
            }
          }

          const restored = await restoreCells(
            this.driveApi,
            this.sheetsApi,
            restoreReq.spreadsheetId,
            restoreReq.revisionId,
            restoreReq.cells
          );
          response = {
            success: true,
            action: 'restore_cells',
            restored,
            snapshotId,
            message: `Restored ${restored.length} cell(s) from revision ${restoreReq.revisionId}`,
          };
          recordTimeTravelOp('restore_cells', 'success');
          break;
        }

        default: {
          const _exhaustiveCheck: never = req;
          response = {
            success: false,
            error: {
              code: ErrorCodes.INVALID_PARAMS,
              message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
              retryable: false,
              suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
            },
          };
        }
      }

      // Apply verbosity filtering (LLM optimization)
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = applyVerbosityFilter(response, verbosity);

      return { response: filteredResponse };
    } catch (error) {
      // Catch-all for unexpected errors
      logger.error('History handler error', {
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
