import { ErrorCodes } from '../error-codes.js';
import type { SamplingServer } from '../../mcp/sampling.js';
import { generateAIInsight } from '../../mcp/sampling.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { buildChartSamplingRequest } from '../../services/sampling-analysis.js';
import { DataError } from '../../core/errors.js';
import { logger } from '../../utils/logger.js';
import { buildA1Notation } from '../../utils/google-sheets-helpers.js';

type SuggestVisualizationRequest = {
  spreadsheetId: string;
  range: { a1: string } | { sheetName: string; range?: string };
  goal?: string;
  preferredTypes?: string[];
};

const SUGGEST_VISUALIZATION_CHART_TYPES = [
  'BAR',
  'LINE',
  'AREA',
  'COLUMN',
  'SCATTER',
  'COMBO',
  'STEPPED_AREA',
  'PIE',
  'DOUGHNUT',
  'TREEMAP',
  'WATERFALL',
  'HISTOGRAM',
  'CANDLESTICK',
  'ORG',
  'RADAR',
  'SCORECARD',
  'BUBBLE',
] as const;

type SuggestedChartType = (typeof SUGGEST_VISUALIZATION_CHART_TYPES)[number];
type ChartRecommendation = {
  chartType: SuggestedChartType;
  suitabilityScore: number;
  reasoning: string;
  configuration?: {
    categories?: string;
    series?: string[];
    stacked?: boolean;
    title?: string;
  };
  insights?: string[];
  executionParams: {
    tool: 'sheets_visualize';
    action: 'chart_create';
    params: {
      spreadsheetId: string;
      sheetId: number;
      chartType: SuggestedChartType;
      data: {
        sourceRange: { a1: string };
      };
      position: {
        anchorCell: string;
        offsetX: number;
        offsetY: number;
        width: number;
        height: number;
      };
      options: {
        title: string;
        legendPosition: 'BOTTOM_LEGEND';
        axisTitle: {
          horizontal: string;
          vertical: string;
        };
      };
    };
  };
};
type DataAssessment = {
  dataType: string;
  rowCount: number;
  columnCount: number;
  hasHeaders: boolean;
};

type SamplingRequest = {
  messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string } | string;
  }>;
  systemPrompt?: string;
  maxTokens?: number;
};

function parseChartType(value: unknown): SuggestedChartType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.toUpperCase();
  return (SUGGEST_VISUALIZATION_CHART_TYPES as readonly string[]).includes(normalized)
    ? (normalized as SuggestedChartType)
    : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export interface SuggestVisualizationDeps {
  checkSamplingCapability: () => Promise<AnalyzeResponse | null>;
  resolveAnalyzeRange: (range?: {
    a1?: string;
    sheetName?: string;
    range?: string;
  }) => string | undefined;
  getSheetNameFromRange: (range?: string) => string | undefined;
  resolveSheetId: (spreadsheetId: string, sheetName?: string) => Promise<number>;
  readData: (spreadsheetId: string, range?: string) => Promise<unknown[][]>;
  createAIMessage: (samplingRequest: SamplingRequest) => Promise<string>;
  samplingServer?: SamplingServer;
}

/**
 * Decomposed action handler for `suggest_visualization`.
 * Keeps the original behavior while moving case logic out of the main AnalyzeHandler class.
 */
export async function handleSuggestVisualizationAction(
  input: SuggestVisualizationRequest,
  deps: SuggestVisualizationDeps
): Promise<AnalyzeResponse> {
  const samplingError = await deps.checkSamplingCapability();
  if (samplingError) {
    return samplingError;
  }

  const startTime = Date.now();
  const rangeStr = deps.resolveAnalyzeRange(input.range);
  const sheetName = deps.getSheetNameFromRange(rangeStr);
  const sheetId = await deps.resolveSheetId(input.spreadsheetId, sheetName);
  const anchorCell = sheetName ? buildA1Notation(sheetName, 0, 0) : 'A1';
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

  const samplingRequest = buildChartSamplingRequest(data, {
    goal: input.goal,
    preferredTypes: input.preferredTypes,
  });
  const contentText = await deps.createAIMessage(samplingRequest);
  const duration = Date.now() - startTime;

  try {
    const jsonMatch = contentText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new DataError(
        'No JSON in response - model returned invalid format',
        'DATA_ERROR',
        false
      );
    }

    const parsedUnknown: unknown = JSON.parse(jsonMatch[0]);
    const parsed =
      typeof parsedUnknown === 'object' && parsedUnknown !== null
        ? (parsedUnknown as Record<string, unknown>)
        : {};

    const rawRecommendations = Array.isArray(parsed['recommendations'])
      ? parsed['recommendations']
      : [];
    const chartRecommendations: ChartRecommendation[] = rawRecommendations
      .map((item): ChartRecommendation | undefined => {
        if (typeof item !== 'object' || item === null) {
          return undefined;
        }

        const recommendation = item as Record<string, unknown>;
        const chartType = parseChartType(recommendation['chartType']) ?? 'LINE';
        const suitabilityScore = parseNumber(recommendation['suitabilityScore']) ?? 0;
        const reasoning =
          typeof recommendation['reasoning'] === 'string'
            ? recommendation['reasoning']
            : 'Recommended based on data profile';

        const configCandidate = recommendation['configuration'];
        const configRecord =
          typeof configCandidate === 'object' && configCandidate !== null
            ? (configCandidate as Record<string, unknown>)
            : undefined;
        const configuration = configRecord
          ? {
              categories:
                typeof configRecord['categories'] === 'string'
                  ? configRecord['categories']
                  : undefined,
              series: Array.isArray(configRecord['series'])
                ? configRecord['series'].filter(
                    (value): value is string => typeof value === 'string'
                  )
                : undefined,
              stacked:
                typeof configRecord['stacked'] === 'boolean' ? configRecord['stacked'] : undefined,
              title: typeof configRecord['title'] === 'string' ? configRecord['title'] : undefined,
            }
          : undefined;
        const hasConfigValues =
          configuration !== undefined &&
          (configuration.categories !== undefined ||
            configuration.series !== undefined ||
            configuration.stacked !== undefined ||
            configuration.title !== undefined);
        const insights = Array.isArray(recommendation['insights'])
          ? recommendation['insights'].filter((value): value is string => typeof value === 'string')
          : undefined;

        return {
          chartType,
          suitabilityScore,
          reasoning,
          configuration: hasConfigValues ? configuration : undefined,
          insights,
          executionParams: {
            tool: 'sheets_visualize',
            action: 'chart_create',
            params: {
              spreadsheetId: input.spreadsheetId,
              sheetId,
              chartType,
              data: {
                sourceRange: { a1: rangeStr ?? 'A:ZZ' },
              },
              position: {
                anchorCell,
                offsetX: 0,
                offsetY: 0,
                width: 600,
                height: 400,
              },
              options: {
                title: configuration?.title ?? `${chartType} Chart`,
                legendPosition: 'BOTTOM_LEGEND',
                axisTitle: {
                  horizontal: configuration?.categories ?? '',
                  vertical: 'Values',
                },
              },
            },
          },
        };
      })
      .filter(
        (recommendation): recommendation is ChartRecommendation => recommendation !== undefined
      );

    const dataAssessment: DataAssessment | undefined = (() => {
      const candidate = parsed['dataAssessment'];
      if (typeof candidate !== 'object' || candidate === null) {
        return undefined;
      }
      const record = candidate as Record<string, unknown>;
      const rowCount = parseNumber(record['rowCount']);
      const columnCount = parseNumber(record['columnCount']);
      if (
        typeof record['dataType'] !== 'string' ||
        rowCount === undefined ||
        columnCount === undefined ||
        typeof record['hasHeaders'] !== 'boolean'
      ) {
        return undefined;
      }
      return {
        dataType: record['dataType'],
        rowCount,
        columnCount,
        hasHeaders: record['hasHeaders'],
      };
    })();

    const topCharts = chartRecommendations.slice(0, 2);
    const aiInsightViz = await generateAIInsight(
      deps.samplingServer,
      'chartRecommendation',
      'Explain why these visualization types best represent this data',
      topCharts
    );

    return {
      success: true,
      action: 'suggest_visualization',
      chartRecommendations,
      dataAssessment,
      duration,
      aiInsight: aiInsightViz,
      message: `${chartRecommendations.length} chart type(s) recommended with executable params`,
    };
  } catch (error) {
    logger.error('Failed to parse chart recommendation response', {
      component: 'analyze-handler',
      action: 'suggest_visualization',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.PARSE_ERROR,
        message: 'Failed to parse chart recommendation response',
        retryable: true,
      },
    };
  }
}
