import { ErrorCodes } from '../error-codes.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { buildAnalysisSamplingRequest } from '../../services/sampling-analysis.js';
import {
  assertSamplingConsent,
  generateAIInsight,
  withSamplingTimeout,
  type SamplingServer,
} from '../../mcp/sampling.js';
import { logger } from '../../utils/logger.js';

type ExplainAnalysisRequest = {
  analysisResult?: Record<string, unknown>;
  question?: string;
  spreadsheetId?: string;
};

export interface ExplainAnalysisDeps {
  checkSamplingCapability: () => Promise<AnalyzeResponse | null>;
  server: SamplingServer;
  samplingServer?: SamplingServer;
}

/**
 * Decomposed action handler for `explain_analysis`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleExplainAnalysisAction(
  input: ExplainAnalysisRequest,
  deps: ExplainAnalysisDeps
): Promise<AnalyzeResponse> {
  const samplingErrorExplain = await deps.checkSamplingCapability();
  if (samplingErrorExplain) {
    return samplingErrorExplain;
  }

  const startTime = Date.now();

  try {
    const questionText = input.question
      ? `${input.question}\n\nContext: ${JSON.stringify(input.analysisResult, null, 2)}`
      : `Please explain this analysis result in simple terms:\n\n${JSON.stringify(input.analysisResult, null, 2)}`;

    const samplingRequest = buildAnalysisSamplingRequest([[questionText]], {
      spreadsheetId: input.spreadsheetId || '',
      analysisTypes: ['summary' as const],
      maxTokens: 1000,
    });

    let samplingResult;
    try {
      await assertSamplingConsent();
      samplingResult = await withSamplingTimeout(() => deps.server.createMessage(samplingRequest));
    } catch (samplingError) {
      logger.error('MCP Sampling call failed for explain_analysis', {
        component: 'analyze-handler',
        action: 'explain_analysis',
        error: samplingError instanceof Error ? samplingError.message : String(samplingError),
      });
      return {
        success: false,
        error: {
          code: ErrorCodes.FEATURE_UNAVAILABLE,
          message:
            'MCP Sampling capability failed. This feature requires a compatible MCP client with Sampling support (MCP 2025-11-25+).',
          retryable: false,
          suggestedFix:
            'Ensure your MCP client supports the Sampling capability or provide an LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY).',
        },
      };
    }

    const duration = Date.now() - startTime;
    const contentBlocks = Array.isArray(samplingResult.content)
      ? samplingResult.content
      : [samplingResult.content];
    const textBlock = contentBlocks.find(
      (block): block is { type: 'text'; text: string } =>
        block.type === 'text' && 'text' in block && typeof block.text === 'string'
    );
    const explanation = textBlock?.text ?? 'Unable to extract explanation from response';

    const aiInsightExplain = await generateAIInsight(
      deps.samplingServer,
      'dataAnalysis',
      'Provide a clear, executive-summary narrative of these analysis findings',
      input.analysisResult
    );

    return {
      success: true,
      action: 'explain_analysis',
      explanation,
      duration,
      aiInsight: aiInsightExplain,
      message: 'Analysis explained successfully',
    };
  } catch (error) {
    logger.error('Failed to explain analysis', {
      component: 'analyze-handler',
      action: 'explain_analysis',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to explain analysis',
        retryable: true,
      },
    };
  }
}
