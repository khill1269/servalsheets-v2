/**
 * Handler for sheets_analyze.semantic_search (ISSUE-174/175)
 *
 * Natural language search across spreadsheet content using vector embeddings.
 * Requires VOYAGE_API_KEY environment variable.
 */

import type { sheets_v4 } from 'googleapis';
import { semanticSearch, getSemanticIndexStats } from '../../services/semantic-search.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { logger } from '../../utils/logger.js';

type SemanticSearchRequest = {
  spreadsheetId: string;
  query: string;
  topK?: number;
  forceReindex?: boolean;
};

export interface SemanticSearchDeps {
  sheetsApi: sheets_v4.Sheets;
}

export async function handleSemanticSearchAction(
  input: SemanticSearchRequest,
  deps: SemanticSearchDeps
): Promise<AnalyzeResponse> {
  const apiKey = process.env['VOYAGE_API_KEY'];
  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message:
          'VOYAGE_API_KEY environment variable is not set. ' +
          'Semantic search requires a Voyage AI API key. ' +
          'Get one at https://www.voyageai.com and set VOYAGE_API_KEY in your environment.',
        retryable: false,
      },
    } as unknown as AnalyzeResponse;
  }

  const { spreadsheetId, query, topK = 5, forceReindex = false } = input;

  logger.info('semantic_search: starting', {
    spreadsheetId,
    query: query.slice(0, 100),
    topK,
    forceReindex,
  });

  try {
    const results = await semanticSearch(
      spreadsheetId,
      query,
      topK,
      deps.sheetsApi,
      apiKey,
      forceReindex
    );

    const indexStats = getSemanticIndexStats();

    return {
      success: true,
      action: 'semantic_search',
      query,
      resultCount: results.length,
      results,
      indexStats: {
        cachedSpreadsheets: indexStats.cached,
      },
      _hints:
        results.length > 0
          ? [
              `Top result: ${results[0]?.range} (score: ${results[0]?.relevanceScore})`,
              'Use sheets_data.read with the returned ranges to fetch the actual cell values.',
              'Call with forceReindex:true after significant edits to refresh the index.',
            ]
          : [
              'No results found. Try a broader query or check that the spreadsheet has content.',
              'Use forceReindex:true if the spreadsheet was recently edited.',
            ],
    } as unknown as AnalyzeResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isApiError = message.includes('Embedding API error');
    logger.error('semantic_search: failed', { spreadsheetId, error: message });

    return {
      success: false,
      error: {
        code: isApiError ? 'UNAVAILABLE' : 'INTERNAL_ERROR',
        message: isApiError
          ? `Embedding service error: ${message}. Check VOYAGE_API_KEY validity.`
          : `Semantic search failed: ${message}`,
        retryable: isApiError,
      },
    } as unknown as AnalyzeResponse;
  }
}
