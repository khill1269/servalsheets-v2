import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { ComprehensiveAnalyzer } from '../../analysis/comprehensive.js';
import { ServiceError } from '../../core/errors.js';
import { isHeapCritical } from '../../utils/heap-watchdog.js';
import { logger } from '../../utils/logger.js';
import { getRequestAbortSignal, sendProgress } from '../../utils/request-context.js';
import type { AnalyzeResponse, ComprehensiveInput } from '../../schemas/analyze.js';
import type { HandlerContext } from '../base.js';
import { handleScoutAction } from './scout.js';

type TaskStore = NonNullable<HandlerContext['taskStore']>;

export interface ComprehensiveDeps {
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
}

function isMemoryPressureFailure(error: unknown): boolean {
  if (isHeapCritical()) {
    return true;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes('out of memory') ||
    message.includes('heap memory') ||
    message.includes('heap') ||
    message.includes('oom') ||
    message.includes('resource exhausted')
  );
}

async function buildComprehensiveScoutFallback(
  input: ComprehensiveInput,
  deps: ComprehensiveDeps,
  reason: string
): Promise<AnalyzeResponse> {
  logger.warn('Degrading comprehensive analysis to scout', {
    spreadsheetId: input.spreadsheetId,
    reason,
  });

  const scoutResponse = await handleScoutAction(
    {
      spreadsheetId: input.spreadsheetId,
      includeColumnTypes: false,
      includeQuickIndicators: true,
      detectIntent: false,
    },
    {
      sheetsApi: deps.sheetsApi,
      context: {
        sessionContext: deps.context.sessionContext,
      },
    }
  );

  if (!scoutResponse.success) {
    return {
      success: false,
      error: {
        code: ErrorCodes.RESOURCE_EXHAUSTED,
        message:
          'Comprehensive analysis was degraded because the server is under memory pressure, ' +
          'but the scout fallback also failed. Retry after current operations finish.',
        retryable: true,
        suggestedFix:
          'Wait for other analysis operations to complete, then retry comprehensive or use scout directly.',
      },
    };
  }

  const scoutInsights =
    scoutResponse.scout?.quickIndicators?.potentialIssues?.slice(0, 3) ??
    scoutResponse.scout?.suggestedAnalyses?.slice(0, 3).map((analysis) => analysis.reason) ??
    [];

  return {
    ...scoutResponse,
    action: 'comprehensive',
    summary:
      'Comprehensive analysis was automatically degraded to a scout scan because the server is under memory pressure.',
    topInsights: scoutInsights,
    message:
      `Comprehensive analysis degraded to scout: ${reason}. ` +
      'Use scout now, then retry comprehensive after memory pressure subsides.',
  };
}

async function shouldUseTaskForComprehensive(
  spreadsheetId: string,
  sheetId: number | string | undefined,
  sheetsApi: sheets_v4.Sheets
): Promise<boolean> {
  try {
    const metadata = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
    });

    if (!metadata.data.sheets) {
      return false;
    }

    const sheets = sheetId
      ? metadata.data.sheets.filter((s) => s.properties?.sheetId === sheetId)
      : metadata.data.sheets;

    const totalCells = sheets.reduce(
      (sum, s) =>
        sum +
        (s.properties?.gridProperties?.rowCount || 0) *
          (s.properties?.gridProperties?.columnCount || 0),
      0
    );

    const sheetCount = sheets.length;
    const hasLargeSheet = sheets.some((s) => (s.properties?.gridProperties?.rowCount || 0) > 10000);

    const shouldUseTask = sheetCount > 10 || totalCells > 100000 || hasLargeSheet;

    logger.info('Task decision for comprehensive analysis', {
      spreadsheetId,
      sheetCount,
      totalCells,
      hasLargeSheet,
      shouldUseTask,
    });

    return shouldUseTask;
  } catch (error) {
    logger.warn('Failed to estimate spreadsheet size for task decision', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function runComprehensiveAnalysisTask(
  taskId: string,
  input: ComprehensiveInput,
  sheetsApi: sheets_v4.Sheets,
  taskStore: TaskStore,
  context: HandlerContext
): Promise<void> {
  try {
    await taskStore.updateTaskStatus(taskId, 'working', 'Analyzing spreadsheet...');

    if (isHeapCritical()) {
      const degraded = await buildComprehensiveScoutFallback(
        input,
        { sheetsApi, context },
        'server heap memory is critically full'
      );
      await taskStore.storeTaskResult(taskId, 'completed', {
        content: [
          {
            type: 'text',
            text: 'Comprehensive analysis degraded to scout because the server is under memory pressure.',
          },
        ],
        structuredContent: degraded,
      });
      return;
    }

    const analyzer = new ComprehensiveAnalyzer(sheetsApi, {
      includeFormulas: 'includeFormulas' in input ? (input.includeFormulas as boolean) : true,
      includeVisualizations:
        'includeVisualizations' in input ? (input.includeVisualizations as boolean) : true,
      includePerformance:
        'includePerformance' in input ? (input.includePerformance as boolean) : true,
      forceFullData: 'forceFullData' in input ? (input.forceFullData as boolean) : false,
      samplingThreshold: 'samplingThreshold' in input ? (input.samplingThreshold as number) : 10000,
      sampleSize: 'sampleSize' in input ? (input.sampleSize as number) : 100,
      sheetId: input.sheetId,
      context: input.context,
      cursor: 'cursor' in input ? (input.cursor as string) : undefined,
      pageSize: 'pageSize' in input ? (input.pageSize as number) : undefined,
    });

    const result = await analyzer.analyze(input.spreadsheetId);

    await taskStore.storeTaskResult(taskId, 'completed', {
      content: [
        {
          type: 'text',
          text: `Comprehensive analysis complete: ${result.aggregate.totalIssues} issues found, quality score ${result.aggregate.overallQualityScore.toFixed(0)}%`,
        },
      ],
      structuredContent: result,
    });

    logger.info('Comprehensive analysis task completed', {
      taskId,
      spreadsheetId: input.spreadsheetId,
      sheetCount: result.sheets.length,
    });
  } catch (error) {
    if (isMemoryPressureFailure(error)) {
      const degraded = await buildComprehensiveScoutFallback(
        input,
        { sheetsApi, context },
        error instanceof Error ? error.message : 'memory pressure detected during analysis'
      );
      await taskStore.storeTaskResult(taskId, 'completed', {
        content: [
          {
            type: 'text',
            text: 'Comprehensive analysis degraded to scout after encountering memory pressure.',
          },
        ],
        structuredContent: degraded,
      });
      return;
    }

    logger.error('Comprehensive analysis task failed', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });

    await taskStore.storeTaskResult(taskId, 'failed', {
      content: [
        {
          type: 'text',
          text: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    });
  }
}

/**
 * Decomposed action handler for `comprehensive`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleComprehensiveAction(
  req: ComprehensiveInput,
  deps: ComprehensiveDeps
): Promise<AnalyzeResponse> {
  let resolvedReq = req;

  if (
    resolvedReq.spreadsheetId &&
    (!('focus' in resolvedReq) || !resolvedReq.focus) &&
    deps.context?.server?.elicitInput
  ) {
    try {
      const wizard = await deps.context.server.elicitInput({
        message: 'Which aspect of the spreadsheet should I focus on?',
        requestedSchema: {
          type: 'object',
          properties: {
            focus: {
              type: 'string',
              title: 'Analysis focus',
              description:
                'What to analyze: data quality, formulas, structure, performance, or everything?',
              enum: ['data_quality', 'formulas', 'structure', 'performance', 'everything'],
            },
          },
        },
      });
      const wizardContent = wizard?.content as Record<string, unknown> | undefined;
      const focusChoice =
        typeof wizardContent?.['focus'] === 'string' ? wizardContent['focus'] : undefined;
      if (wizard?.action === 'accept' && focusChoice) {
        if (focusChoice !== 'everything') {
          const analysesByChoice: Record<
            string,
            Array<'quality' | 'formulas' | 'patterns' | 'performance' | 'structure'>
          > = {
            data_quality: ['quality'],
            formulas: ['formulas'],
            structure: ['structure'],
            performance: ['performance'],
          };
          const analyses = analysesByChoice[focusChoice];
          if (analyses) {
            resolvedReq = {
              ...resolvedReq,
              focus: { analyses },
            };
          }
        }
      }
    } catch {
      // Elicitation not available — keep request without focus constraints
    }
  }

  if (isHeapCritical()) {
    return await buildComprehensiveScoutFallback(
      resolvedReq,
      deps,
      'server heap memory is critically full'
    );
  }

  const isQuickScan = 'quickScan' in resolvedReq && resolvedReq.quickScan === true;

  logger.info('Comprehensive analysis requested', {
    spreadsheetId: resolvedReq.spreadsheetId,
    sheetId: resolvedReq.sheetId,
    quickScan: isQuickScan,
    cursor: 'cursor' in resolvedReq ? resolvedReq.cursor : undefined,
    pageSize: 'pageSize' in resolvedReq ? resolvedReq.pageSize : undefined,
  });

  const shouldUseTask = await shouldUseTaskForComprehensive(
    resolvedReq.spreadsheetId,
    resolvedReq.sheetId,
    deps.sheetsApi
  );

  if (shouldUseTask && deps.context.taskStore) {
    const task = await deps.context.taskStore.createTask(
      { ttl: 3600000 },
      'analyze-comprehensive',
      {
        method: 'tools/call',
        params: { name: 'sheets_analyze', arguments: resolvedReq },
      }
    );

    logger.info('Creating task for comprehensive analysis', {
      taskId: task.taskId,
      spreadsheetId: resolvedReq.spreadsheetId,
    });

    void runComprehensiveAnalysisTask(
      task.taskId,
      resolvedReq,
      deps.sheetsApi,
      deps.context.taskStore,
      deps.context
    ).catch((error) => {
      logger.error('Background comprehensive analysis failed', {
        taskId: task.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return {
      success: true,
      action: 'comprehensive',
      message: `Large analysis started - check task ${task.taskId} for progress (estimated time: 30-60s)`,
      taskId: task.taskId,
      taskStatus: task.status,
      summary: 'Analysis running in background...',
      topInsights: [],
    } as AnalyzeResponse;
  }

  const analyzer = new ComprehensiveAnalyzer(deps.sheetsApi, {
    includeFormulas: isQuickScan
      ? false
      : 'includeFormulas' in resolvedReq
        ? (resolvedReq.includeFormulas as boolean)
        : true,
    includeVisualizations: isQuickScan
      ? false
      : 'includeVisualizations' in resolvedReq
        ? (resolvedReq.includeVisualizations as boolean)
        : true,
    includePerformance: isQuickScan
      ? false
      : 'includePerformance' in req
        ? (req.includePerformance as boolean)
        : true,
    forceFullData: 'forceFullData' in req ? (req.forceFullData as boolean) : false,
    samplingThreshold: isQuickScan
      ? 1000
      : 'samplingThreshold' in req
        ? (req.samplingThreshold as number)
        : 10000,
    sampleSize: isQuickScan ? 100 : 'sampleSize' in req ? (req.sampleSize as number) : 100,
    sheetId: req.sheetId,
    context: 'context' in req ? req.context : undefined,
    cursor: 'cursor' in req ? (req.cursor as string) : undefined,
    pageSize: 'pageSize' in req ? (req.pageSize as number) : undefined,
    timeoutMs: isQuickScan ? 15000 : 'timeoutMs' in req ? (req.timeoutMs as number) : 30000,
  });

  try {
    await sendProgress(0, 100, 'Starting comprehensive analysis');
    if ((getRequestAbortSignal() ?? deps.context.abortSignal)?.aborted) {
      throw new ServiceError(
        'Operation cancelled by client',
        'OPERATION_CANCELLED',
        'analyze',
        false
      );
    }

    const result = await analyzer.analyze(req.spreadsheetId);

    await sendProgress(100, 100, 'Comprehensive analysis complete');

    logger.info('Comprehensive analysis complete', {
      spreadsheetId: req.spreadsheetId,
      sheetCount: result.sheets.length,
      totalIssues: result.aggregate.totalIssues,
      hasMore: result.hasMore ?? false,
      resourceUri: result.resourceUri,
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (deps.context.sessionContext) {
        deps.context.sessionContext.recordOperation({
          tool: 'sheets_analyze',
          action: 'comprehensive',
          spreadsheetId: req.spreadsheetId,
          description: `Comprehensive analysis: ${result.sheets.length} sheet(s), ${result.aggregate.totalIssues} issue(s) found`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return result as unknown as AnalyzeResponse;
  } catch (error) {
    if (isMemoryPressureFailure(error)) {
      return await buildComprehensiveScoutFallback(
        req,
        deps,
        error instanceof Error ? error.message : 'memory pressure detected during analysis'
      );
    }

    logger.error('Comprehensive analysis failed', {
      error: error instanceof Error ? error.message : String(error),
      spreadsheetId: req.spreadsheetId,
    });

    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : 'Comprehensive analysis failed',
        retryable: true,
      },
    };
  }
}
