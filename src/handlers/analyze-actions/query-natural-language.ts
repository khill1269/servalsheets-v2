import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { DataError } from '../../core/errors.js';
import { logger } from '../../utils/logger.js';
import { createNotFoundError } from '../../utils/error-factory.js';
import { TieredRetrieval } from '../../analysis/tiered-retrieval.js';
import { getSessionContext, type SessionContextManager } from '../../services/session-context.js';
import { getCacheAdapter } from '../../utils/cache-adapter.js';
import {
  assertSamplingConsent,
  withSamplingTimeout,
  extractCitationsFromResponse,
  type SamplingServer,
} from '../../mcp/sampling.js';

type QueryNaturalLanguageRequest = {
  spreadsheetId: string;
  query: string;
  sheetId?: number;
  conversationId?: string;
  range?: unknown;
};

const QUERY_RESULT_CHART_TYPES = [
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

type QueryResultChartType = (typeof QUERY_RESULT_CHART_TYPES)[number];
type QueryCellScalar = string | number | boolean | null;
type QueryCellValue = QueryCellScalar | QueryCellScalar[] | Record<string, QueryCellScalar>;
type QueryResultData = {
  headers: string[];
  rows: QueryCellValue[][];
};

function parseQueryResultChartType(value: unknown): QueryResultChartType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.toUpperCase();
  return (QUERY_RESULT_CHART_TYPES as readonly string[]).includes(normalized)
    ? (normalized as QueryResultChartType)
    : undefined;
}

export interface QueryNaturalLanguageDeps {
  checkSamplingCapability: () => Promise<AnalyzeResponse | null>;
  server: SamplingServer;
  sheetsApi: sheets_v4.Sheets;
  sessionContext?: Pick<SessionContextManager, 'understandingStore'>;
}

function resolveRange(range: unknown): string | undefined {
  if (!range) {
    return undefined;
  }

  if (typeof range === 'string') {
    return range;
  }

  if (typeof range === 'object' && range !== null) {
    const record = range as Record<string, unknown>;
    if (typeof record['a1'] === 'string') {
      return record['a1'];
    }
    if (typeof record['namedRange'] === 'string') {
      return record['namedRange'];
    }
  }

  return undefined;
}

function extractSheetName(range: string | undefined): string | undefined {
  if (!range) {
    return undefined;
  }

  const match = range.match(/^(?:'([^']+)'!|([^!]+)!)/);
  return match?.[1] ?? match?.[2];
}

function quoteSheetName(sheetName: string): string {
  return /[\s'!]/.test(sheetName) ? `'${sheetName.replace(/'/g, "''")}'` : sheetName;
}

/**
 * Decomposed action handler for `query_natural_language`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleQueryNaturalLanguageAction(
  input: QueryNaturalLanguageRequest,
  deps: QueryNaturalLanguageDeps
): Promise<AnalyzeResponse> {
  const samplingError = await deps.checkSamplingCapability();
  if (samplingError) {
    return samplingError;
  }

  const startTime = Date.now();

  // Read understanding store context built by prior scout/comprehensive calls
  const understandingStore =
    deps.sessionContext?.understandingStore ?? getSessionContext().understandingStore;
  const understanding = understandingStore.getSummary(input.spreadsheetId);
  const semanticIndex = understandingStore.get(input.spreadsheetId)?.semanticIndex;
  const additionalContext = understanding
    ? [
        understanding.inferredPurpose ? `Workbook type: ${understanding.inferredPurpose}.` : '',
        semanticIndex?.workbookType && semanticIndex.workbookType !== understanding.inferredPurpose
          ? `Semantic classification: ${semanticIndex.workbookType} (${semanticIndex.workbookTypeConfidence}% confidence).`
          : '',
        understanding.domain ? `Business domain: ${understanding.domain}.` : '',
        understanding.userIntent ? `User intent: ${understanding.userIntent}.` : '',
        semanticIndex?.suggestedOperations.length
          ? `Likely useful operations: ${semanticIndex.suggestedOperations.slice(0, 3).join(', ')}.`
          : '',
        understanding.topGaps.length > 0
          ? `Known gaps: ${understanding.topGaps.slice(0, 2).join('; ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : undefined;

  try {
    const tieredRetrieval = new TieredRetrieval({
      cache: getCacheAdapter('analysis'),
      sheetsApi: deps.sheetsApi,
    });

    const metadata = await tieredRetrieval.getMetadata(input.spreadsheetId);
    const requestedRange = resolveRange(input.range);
    const requestedSheetName = extractSheetName(requestedRange);

    const targetSheet = input.sheetId
      ? metadata.sheets.find((s) => s.sheetId === input.sheetId)
      : requestedSheetName
        ? metadata.sheets.find((s) => s.title === requestedSheetName)
        : metadata.sheets[0];

    if (!targetSheet) {
      return {
        success: false,
        error: createNotFoundError({
          resourceType: 'sheet',
          resourceId: input.sheetId ? String(input.sheetId) : 'first sheet',
          searchSuggestion: 'Use sheets_core action "list_sheets" to see available sheets',
          parentResourceId: input.spreadsheetId,
        }),
      };
    }

    const { detectQueryIntent, buildNLQuerySamplingRequest, validateQuery } =
      await import('../../analysis/conversational-helpers.js');
    const { inferSchema } = await import('../../analysis/structure-helpers.js');

    let sampleHeaders: unknown[] = [];
    let sampleRows: unknown[][] = [];
    let snapshotRowCount = targetSheet.rowCount;
    let snapshotColumnCount = targetSheet.columnCount;

    if (requestedRange) {
      const effectiveRange = requestedSheetName
        ? requestedRange
        : `${quoteSheetName(targetSheet.title)}!${requestedRange}`;
      const scopedSample = await deps.sheetsApi.spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range: effectiveRange,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const scopedValues = (scopedSample.data.values as unknown[][]) ?? [];
      sampleHeaders = scopedValues[0] ?? [];
      sampleRows = scopedValues.slice(1);
      snapshotRowCount = sampleRows.length;
      snapshotColumnCount = Math.max(sampleHeaders.length, ...sampleRows.map((row) => row.length));
    } else {
      const sampleData = await tieredRetrieval.getSample(input.spreadsheetId, targetSheet.sheetId);
      sampleHeaders = sampleData.sampleData.headers ?? [];
      sampleRows = sampleData.sampleData.rows ?? [];
    }

    const schemaSource = sampleHeaders.length > 0 ? [sampleHeaders, ...sampleRows] : sampleRows;
    const schema = inferSchema(schemaSource, sampleHeaders.length > 0 ? 0 : undefined);

    const context = {
      spreadsheetId: input.spreadsheetId,
      sheetName: targetSheet.title,
      schema,
      ...(additionalContext ? { additionalContext } : {}),
      previousQueries: [],
      dataSnapshot: {
        sampleRows,
        rowCount: snapshotRowCount,
        columnCount: snapshotColumnCount,
      },
    };

    const intent = detectQueryIntent(input.query, schema);
    const validation = validateQuery(input.query, context);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: validation.reason || 'Invalid query',
          retryable: false,
        },
      };
    }

    const samplingRequest = buildNLQuerySamplingRequest(input.query, context);

    let samplingResult;
    try {
      await assertSamplingConsent();
      samplingResult = await withSamplingTimeout(() => deps.server.createMessage(samplingRequest));
    } catch (samplingError) {
      logger.error('MCP Sampling call failed for query_natural_language', {
        component: 'analyze-handler',
        action: 'query_natural_language',
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

    const contentBlocks = Array.isArray(samplingResult.content)
      ? samplingResult.content
      : [samplingResult.content];
    const textBlock = contentBlocks.find(
      (block): block is { type: 'text'; text: string } =>
        block.type === 'text' && 'text' in block && typeof block.text === 'string'
    );
    const contentText = textBlock?.text ?? '';

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
    const duration = Date.now() - startTime;
    const answer = typeof parsed['answer'] === 'string' ? parsed['answer'] : 'No answer provided';

    const parsedData = (() => {
      const candidate = parsed['data'];
      if (typeof candidate !== 'object' || candidate === null) {
        return undefined;
      }
      const record = candidate as Record<string, unknown>;
      if (!Array.isArray(record['headers']) || !Array.isArray(record['rows'])) {
        return undefined;
      }
      if (!record['headers'].every((value) => typeof value === 'string')) {
        return undefined;
      }
      if (!record['rows'].every((row) => Array.isArray(row))) {
        return undefined;
      }

      return {
        headers: record['headers'] as QueryResultData['headers'],
        rows: record['rows'] as QueryResultData['rows'],
      };
    })();

    const parsedVisualization = (() => {
      const candidate = parsed['visualizationSuggestion'];
      if (typeof candidate !== 'object' || candidate === null) {
        return undefined;
      }
      const record = candidate as Record<string, unknown>;
      const chartType = parseQueryResultChartType(record['chartType']);
      if (!chartType || typeof record['reasoning'] !== 'string') {
        return undefined;
      }

      return {
        chartType,
        reasoning: record['reasoning'],
      };
    })();

    const followUpQuestions = Array.isArray(parsed['followUpQuestions'])
      ? parsed['followUpQuestions'].filter((q): q is string => typeof q === 'string')
      : [];

    // Extract cell-level citations from the AI response (best-effort)
    const citations = extractCitationsFromResponse(jsonMatch[0]);

    return {
      success: true,
      action: 'query_natural_language',
      queryResult: {
        query: input.query,
        answer,
        intent: {
          type: intent.type,
          confidence: intent.confidence,
        },
        data: parsedData,
        visualizationSuggestion: parsedVisualization,
        followUpQuestions,
      },
      // Bubble citations up to _meta via tool-response.ts convention
      ...(citations.length > 0 ? { _citations: citations } : {}),
      duration,
      message: `Query processed: ${intent.type} (${intent.confidence}% confidence)`,
    };
  } catch (error) {
    logger.error('Failed to process natural language query', {
      component: 'analyze-handler',
      action: 'query_natural_language',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Failed to process natural language query',
        retryable: true,
      },
    };
  }
}
