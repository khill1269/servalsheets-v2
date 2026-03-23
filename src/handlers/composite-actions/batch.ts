import { ErrorCodes } from '../error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import type {
  BatchOperationResult,
  CompositeBatchOperationsInput,
  CompositeOutput,
} from '../../schemas/composite.js';
import type { ResponseMeta } from '../../schemas/shared.js';
import type { HandlerContext } from '../base.js';
import { getRequestLogger } from '../../utils/request-context.js';
import { dispatchCompositeOperation } from '../../resources/composite-operation-dispatcher.js';

type GenerateMetaFn = (
  action: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  options: Record<string, unknown>
) => ResponseMeta;

export interface BatchDeps {
  context: HandlerContext;
  sheetsApi: sheets_v4.Sheets;
  driveApi?: drive_v3.Drive;
  generateMeta: GenerateMetaFn;
  sendProgress?: (completed: number, total: number, message?: string) => Promise<void>;
}

/**
 * Decomposed action handler for `batch_operations`.
 * Preserves original behavior while moving logic out of the main CompositeHandler class.
 */
export async function handleBatchOperationsAction(
  input: CompositeBatchOperationsInput,
  deps: BatchDeps
): Promise<CompositeOutput['response']> {
  const logger = getRequestLogger();
  logger.info('Starting batch operations', {
    spreadsheetId: input.spreadsheetId,
    operationCount: input.operations.length,
    atomic: input.atomic,
    stopOnError: input.stopOnError,
  });

  const results: BatchOperationResult[] = [];
  let succeeded = 0;
  let failed = 0;
  const totalOperations = input.operations.length;
  const shouldReportProgress = totalOperations >= 2 && typeof deps.sendProgress === 'function';

  if (shouldReportProgress) {
    try {
      await deps.sendProgress!(
        0,
        totalOperations,
        `Starting batch operations (0/${totalOperations})...`
      );
    } catch {
      // Best-effort progress reporting; never fail the action on notification issues.
    }
  }

  for (let i = 0; i < totalOperations; i++) {
    const op = input.operations[i]!;
    let shouldStop = false;

    try {
      const params = { spreadsheetId: input.spreadsheetId, ...op.params };

      const result = await dispatchCompositeOperation({
        context: deps.context,
        sheetsApi: deps.sheetsApi,
        driveApi: deps.driveApi,
        tool: op.tool,
        action: op.action,
        params,
      });

      results.push({
        index: i,
        tool: op.tool,
        action: op.action,
        success: result.success,
        data: result.success ? result : undefined,
        error: !result.success ? result.error : undefined,
      });

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        if (input.stopOnError) {
          logger.info('Batch operations halted on error', {
            index: i,
            tool: op.tool,
            action: op.action,
          });
          shouldStop = true;
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      failed++;

      results.push({
        index: i,
        tool: op.tool,
        action: op.action,
        success: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Operation failed: ${errMsg}`,
          retryable: false,
        },
      });

      if (input.stopOnError) {
        logger.info('Batch operations halted on exception', {
          index: i,
          tool: op.tool,
          action: op.action,
          error: errMsg,
        });
        shouldStop = true;
      }
    }

    const processedOperations = results.length;
    if (
      shouldReportProgress &&
      (processedOperations % 2 === 0 || shouldStop || processedOperations === totalOperations)
    ) {
      try {
        await deps.sendProgress!(
          processedOperations,
          totalOperations,
          shouldStop || processedOperations === totalOperations
            ? `Batch operations complete: ${processedOperations}/${totalOperations} operation(s)`
            : `Processed ${processedOperations}/${totalOperations} batch operation(s)...`
        );
      } catch {
        // Best-effort progress reporting; never fail the action on notification issues.
      }
    }

    if (shouldStop) {
      break;
    }
  }

  logger.info('Batch operations completed', {
    total: input.operations.length,
    succeeded,
    failed,
  });

  return {
    success: true as const,
    action: 'batch_operations' as const,
    total: input.operations.length,
    succeeded,
    failed,
    results,
    _meta: deps.generateMeta(
      'batch_operations',
      input as unknown as Record<string, unknown>,
      { succeeded, failed } as Record<string, unknown>,
      {}
    ),
  };
}
