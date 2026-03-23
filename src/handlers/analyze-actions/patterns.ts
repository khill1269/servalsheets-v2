import { ErrorCodes } from '../error-codes.js';
import { generateAIInsight, type SamplingServer } from '../../mcp/sampling.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { logger } from '../../utils/logger.js';

type DetectPatternsRequest = {
  spreadsheetId: string;
  range: { a1: string } | { namedRange: string } | { semantic: unknown } | { grid: unknown };
};

interface ConvertedRangeInput {
  a1?: string;
  sheetName?: string;
  range?: string;
}

export interface DetectPatternsDeps {
  hasServer: boolean;
  samplingServer?: SamplingServer;
  convertRangeInput: (range: DetectPatternsRequest['range']) => ConvertedRangeInput | undefined;
  resolveAnalyzeRange: (range?: ConvertedRangeInput) => string | undefined;
  readData: (spreadsheetId: string, range?: string) => Promise<unknown[][]>;
}

/**
 * Decomposed action handler for `detect_patterns`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleDetectPatternsAction(
  input: DetectPatternsRequest,
  deps: DetectPatternsDeps
): Promise<AnalyzeResponse> {
  if (!deps.hasServer) {
    return {
      success: false,
      error: {
        code: ErrorCodes.SAMPLING_UNAVAILABLE,
        message: 'MCP Sampling is not available. detect_patterns requires an LLM via Sampling.',
        retryable: false,
      },
    };
  }

  const startTime = Date.now();
  const convertedPatternRange = deps.convertRangeInput(input.range);
  const rangeStr = deps.resolveAnalyzeRange(convertedPatternRange);
  const data = await deps.readData(input.spreadsheetId, rangeStr);

  if (data.length === 0) {
    return {
      success: false,
      error: {
        code: ErrorCodes.NO_DATA,
        message: 'No data found in the specified range',
        retryable: false,
      },
    };
  }

  const rowCount = data.length;
  const useWorkerPool = rowCount > 1000;

  try {
    let anomalies: Array<{
      cell: string;
      value: number;
      expected: string;
      deviation: string;
      zScore: string;
    }>;
    let trends: Array<{
      column: number;
      trend: 'increasing' | 'decreasing' | 'stable';
      changeRate: string;
      confidence: number;
    }>;
    let correlations: Array<{
      columns: number[];
      correlation: string;
      strength: string;
    }>;

    if (useWorkerPool) {
      logger.info('Using worker pool for large dataset analysis', {
        component: 'analyze-handler',
        action: 'detect_patterns',
        rowCount,
      });

      const { getWorkerPool } = await import('../../services/worker-pool.js');
      const { fileURLToPath } = await import('url');
      const { dirname, resolve } = await import('path');

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const workerScriptPath = resolve(__dirname, '../../workers/analysis-worker.js');

      const pool = getWorkerPool();
      pool.registerWorker('analysis', workerScriptPath);

      const workerResult = await pool.execute<
        {
          operation: 'fullAnalysis';
          data: unknown[][];
        },
        {
          trends: typeof trends;
          anomalies: typeof anomalies;
          correlations: typeof correlations;
          rowCount: number;
          columnCount: number;
          duration: number;
        }
      >('analysis', {
        operation: 'fullAnalysis',
        data,
      });

      anomalies = workerResult.anomalies;
      trends = workerResult.trends;
      correlations = workerResult.correlations;

      logger.info('Worker pool analysis completed', {
        component: 'analyze-handler',
        action: 'detect_patterns',
        rowCount,
        workerDuration: workerResult.duration,
      });
    } else {
      const { detectAnomalies, analyzeTrends, analyzeCorrelationsData } =
        await import('../../analysis/helpers.js');

      anomalies = detectAnomalies(data);
      trends = analyzeTrends(data);
      correlations = analyzeCorrelationsData(data);
    }

    const duration = Date.now() - startTime;
    const patternSummary = {
      anomalies: anomalies.slice(0, 3),
      trends: trends.slice(0, 3),
      correlations: correlations.slice(0, 3),
    };
    const aiInsight = await generateAIInsight(
      deps.samplingServer,
      'dataAnalysis',
      'Explain these detected patterns and their business significance',
      patternSummary
    );

    return {
      success: true,
      action: 'detect_patterns',
      patterns: {
        anomalies: anomalies.map((a) => ({
          location: a.cell,
          value: a.value,
          severity: parseFloat(a.zScore) > 3 ? 'high' : parseFloat(a.zScore) > 2 ? 'medium' : 'low',
          expectedRange: a.expected,
        })),
        trends: trends.map((t) => ({
          column: `Column ${t.column + 1}`,
          direction: t.trend,
          confidence: t.confidence,
          description: `${t.trend} trend in Column ${t.column + 1} (change: ${t.changeRate})`,
        })),
        correlations: {
          matrix: correlations.map((c) => [...c.columns, parseFloat(c.correlation)]),
          columns: correlations.map((c) => `Columns ${c.columns.join(' & ')}`),
        },
      },
      duration,
      aiInsight,
      message: `Found ${anomalies.length} anomalies, ${trends.length} trends, ${correlations.length} correlations`,
    };
  } catch (error) {
    logger.error('Failed to detect patterns', {
      component: 'analyze-handler',
      action: 'detect_patterns',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to detect patterns',
        retryable: true,
      },
    };
  }
}
