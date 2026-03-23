import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import { AnalysisRouter } from '../../analysis/router.js';
import { TieredRetrieval } from '../../analysis/tiered-retrieval.js';
import { sendProgress } from '../../utils/request-context.js';
import { logger } from '../../utils/logger.js';
import {
  buildAnalysisSamplingRequest,
  getSamplingAnalysisService,
  parseAnalysisResponse,
  type AnalysisType,
} from '../../services/sampling-analysis.js';
import type { AnalyzeResponse, SheetsAnalyzeInput } from '../../schemas/analyze.js';
import { getCacheAdapter } from '../../utils/cache-adapter.js';

type AnalyzeDataRequest = SheetsAnalyzeInput['request'] & { spreadsheetId: string };

export interface AnalyzeDataDeps {
  sheetsApi: sheets_v4.Sheets;
  hasSampling: boolean;
  checkSamplingCapability: () => Promise<AnalyzeResponse | null>;
  createAIMessage: (samplingRequest: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: { type: 'text'; text: string } | string;
    }>;
    systemPrompt?: string;
    maxTokens?: number;
  }) => Promise<string>;
}

/**
 * Decomposed action handler for `analyze_data`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleAnalyzeDataAction(
  req: AnalyzeDataRequest,
  deps: AnalyzeDataDeps
): Promise<AnalyzeResponse> {
  const startTime = Date.now();
  const analysisService = getSamplingAnalysisService();

  const tieredRetrieval = new TieredRetrieval({
    cache: getCacheAdapter('analysis'),
    sheetsApi: deps.sheetsApi,
    defaultSampleSize: 100,
    maxSampleSize: 500,
  });

  const metadata = await tieredRetrieval.getMetadata(req.spreadsheetId);

  const router = new AnalysisRouter({
    hasSampling: deps.hasSampling,
    hasTasks: true,
  });
  const decision = router.route({ request: req } as SheetsAnalyzeInput, metadata);

  logger.info('Analysis routing decision', {
    spreadsheetId: req.spreadsheetId,
    path: decision.path,
    reason: decision.reason,
    estimatedDuration: decision.estimatedDuration,
  });

  switch (decision.path) {
    case 'fast': {
      const sheetId = 'sheetId' in req ? req.sheetId : undefined;
      const sampleResult = await tieredRetrieval.getSample(
        req.spreadsheetId,
        sheetId as number | undefined,
        100
      );

      const data = sampleResult.sampleData.rows;
      if (!data || data.length === 0) {
        return {
          success: false,
          error: {
            code: ErrorCodes.NO_DATA,
            message: 'No data found in the specified range',
            retryable: false,
          },
        };
      }

      logger.info('Fast path using tier 3 (sample)', {
        sampleSize: sampleResult.sampleData.sampleSize,
        totalRows: sampleResult.sampleData.totalRows,
        samplingMethod: sampleResult.sampleData.samplingMethod,
      });

      const { analyzeTrends, detectAnomalies, analyzeCorrelationsData } =
        await import('../../analysis/helpers.js');

      const trends = analyzeTrends(data);
      const anomalies = detectAnomalies(data);
      const correlations = analyzeCorrelationsData(data);

      const duration = Date.now() - startTime;

      return {
        success: true,
        action: 'analyze_data',
        summary: `Fast statistical analysis complete (sample: ${sampleResult.sampleData.sampleSize}/${sampleResult.sampleData.totalRows} rows). Found ${anomalies.length} anomalies, ${trends.length} trends, and ${correlations.length} correlations.`,
        analyses: [
          {
            type: 'summary',
            confidence: 'high',
            findings: [
              `Analyzed ${data.length} rows with ${data[0]?.length ?? 0} columns (sample of ${sampleResult.sampleData.totalRows} total rows)`,
              `Detected ${anomalies.length} anomalies`,
              `Identified ${trends.length} trend patterns`,
              `Found ${correlations.length} correlations`,
            ],
            details: `Fast path statistical analysis using traditional algorithms on tier 3 sample: trends=${trends.length}, anomalies=${anomalies.length}, correlations=${correlations.length}`,
          },
        ],
        overallQualityScore: 85,
        topInsights: [
          `${anomalies.length} anomalies detected in sample`,
          `${trends.length} trend patterns identified`,
          `${correlations.length} correlations found`,
        ],
        duration,
        message: `Fast path analysis completed in ${duration}ms using tier 3 sample (${sampleResult.sampleData.sampleSize} rows)`,
      };
    }

    case 'ai': {
      const samplingError = await deps.checkSamplingCapability();
      if (samplingError) {
        return samplingError;
      }

      const sheetId = 'sheetId' in req ? req.sheetId : undefined;

      const useFullData =
        'analysisTypes' in req &&
        Array.isArray(req.analysisTypes) &&
        req.analysisTypes.includes('quality');

      const dataResult = useFullData
        ? await tieredRetrieval.getFull(req.spreadsheetId, sheetId as number | undefined)
        : await tieredRetrieval.getSample(req.spreadsheetId, sheetId as number | undefined, 200);

      const data = useFullData
        ? 'fullData' in dataResult
          ? dataResult.fullData.values
          : []
        : 'sampleData' in dataResult
          ? dataResult.sampleData.rows
          : [];

      if (!data || data.length === 0) {
        return {
          success: false,
          error: {
            code: ErrorCodes.NO_DATA,
            message: 'No data found in the specified range',
            retryable: false,
          },
        };
      }

      logger.info(`AI path using tier ${useFullData ? '4 (full)' : '3 (sample)'}`, {
        dataSize: data.length,
        useFullData,
      });

      const targetSheet =
        sheetId !== undefined
          ? metadata.sheets.find((s) => s.sheetId === sheetId)
          : metadata.sheets[0];
      const sheetName = targetSheet?.title;

      const samplingRequest = buildAnalysisSamplingRequest(data, {
        spreadsheetId: req.spreadsheetId,
        sheetName,
        range: undefined,
        analysisTypes: ('analysisTypes' in req ? req.analysisTypes : undefined) as AnalysisType[],
        context: 'context' in req ? req.context : undefined,
        maxTokens: 'maxTokens' in req ? req.maxTokens : undefined,
      });

      const contentText = await deps.createAIMessage(samplingRequest);
      const duration = Date.now() - startTime;

      const parsed = parseAnalysisResponse(contentText);

      if (!parsed.success || !parsed.result) {
        const types = ('analysisTypes' in req ? req.analysisTypes : undefined) as AnalysisType[];
        if (types) {
          analysisService.recordFailure(types);
        }
        return {
          success: false,
          error: {
            code: ErrorCodes.PARSE_ERROR,
            message: parsed.error ?? 'Failed to parse analysis response',
            retryable: true,
          },
        };
      }

      const types = ('analysisTypes' in req ? req.analysisTypes : undefined) as AnalysisType[];
      if (types) {
        analysisService.recordSuccess(types, duration);
      }

      const analyses = parsed.result.analyses ?? [];
      const topInsights = parsed.result.topInsights ?? [];
      return {
        success: true,
        action: 'analyze_data',
        summary: parsed.result.summary,
        analyses: analyses.map((a) => ({
          type: a.type as AnalysisType,
          confidence: a.confidence as 'high' | 'medium' | 'low',
          findings: a.findings,
          details: a.details,
          affectedCells: a.affectedCells,
          recommendations: a.recommendations,
        })),
        overallQualityScore: parsed.result.overallQualityScore,
        topInsights,
        duration,
        message: `AI path analysis complete (tier ${useFullData ? '4' : '3'}): ${analyses.length} finding(s) with ${topInsights.length} key insight(s)`,
      };
    }

    case 'streaming': {
      logger.info('Streaming path selected - chunked processing', {
        decision,
      });

      const sheetId = 'sheetId' in req ? req.sheetId : undefined;

      const { StreamingAnalyzer } = await import('../../analysis/streaming.js');

      const streamingAnalyzer = new StreamingAnalyzer(deps.sheetsApi, tieredRetrieval, 1000);

      const streamingResult = await streamingAnalyzer.execute(
        req.spreadsheetId,
        sheetId as number | undefined,
        metadata,
        async (chunk) => {
          const progressPercent = ((chunk.rowsProcessed / chunk.totalRows) * 100).toFixed(1);
          logger.info('Streaming progress', {
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            progress: `${progressPercent}%`,
            partialResults: chunk.partialResults,
          });

          await sendProgress(
            chunk.chunkIndex,
            chunk.totalChunks,
            `Processing chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks} (${progressPercent}% - ${chunk.rowsProcessed}/${chunk.totalRows} rows)`
          );
        }
      );

      const duration = Date.now() - startTime;

      logger.info('Streaming analysis complete', {
        totalRowsProcessed: streamingResult.totalRowsProcessed,
        totalChunks: streamingResult.totalChunks,
        duration: streamingResult.duration,
      });

      return {
        success: true,
        action: 'analyze_data',
        executionPath: 'streaming',
        summary: `Streaming analysis complete: processed ${streamingResult.totalRowsProcessed} rows in ${streamingResult.totalChunks} chunks. Found ${streamingResult.aggregatedResults.anomalies} anomalies, ${streamingResult.aggregatedResults.trends} trends, ${streamingResult.aggregatedResults.correlations} correlations.`,
        analyses: [
          {
            type: 'summary',
            confidence: 'high',
            findings: [
              `Processed ${streamingResult.totalRowsProcessed} rows using chunked streaming (${streamingResult.totalChunks} chunks)`,
              `Detected ${streamingResult.aggregatedResults.anomalies} anomalies`,
              `Identified ${streamingResult.aggregatedResults.trends} trend patterns`,
              `Found ${streamingResult.aggregatedResults.correlations} correlations`,
              `Null cells: ${streamingResult.aggregatedResults.nullCount}`,
              `Duplicate rows: ${streamingResult.aggregatedResults.duplicateCount}`,
            ],
            details: `Streaming analysis on large dataset: trends=${streamingResult.aggregatedResults.trends}, anomalies=${streamingResult.aggregatedResults.anomalies}, correlations=${streamingResult.aggregatedResults.correlations}, chunks=${streamingResult.totalChunks}`,
          },
        ],
        overallQualityScore: Math.max(
          50,
          100 -
            Math.floor(
              (streamingResult.aggregatedResults.nullCount / streamingResult.totalRowsProcessed) *
                100
            )
        ),
        topInsights: [
          `${streamingResult.aggregatedResults.anomalies} anomalies detected across all chunks`,
          `${streamingResult.aggregatedResults.trends} trend patterns identified`,
          `${streamingResult.aggregatedResults.duplicateCount} duplicate rows found`,
          `Processed ${streamingResult.totalRowsProcessed} rows in ${(streamingResult.duration / 1000).toFixed(1)}s`,
        ],
        duration,
        message: `Streaming analysis complete: ${streamingResult.totalRowsProcessed} rows processed in ${streamingResult.totalChunks} chunks (${(duration / 1000).toFixed(1)}s)`,
      };
    }
  }
}
