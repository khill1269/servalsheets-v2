import { ErrorCodes } from '../error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { SuggestionCategory } from '../../analysis/suggestion-engine.js';
import type { AnalyzeResponse } from '../../schemas/analyze.js';
import { logger } from '../../utils/logger.js';
import { recordSuggestionOp } from '../../observability/metrics.js';

type SuggestNextActionsRequest = {
  spreadsheetId: string;
  range?: { a1?: string; sheetName?: string; range?: string };
  maxSuggestions?: number;
  categories?: SuggestionCategory[];
};

type AutoEnhanceRequest = {
  spreadsheetId: string;
  range?: { a1?: string; sheetName?: string; range?: string };
  categories?: SuggestionCategory[];
  mode?: 'preview' | 'apply';
  maxEnhancements?: number;
};

type DiscoverActionRequest = {
  query: string;
  category?: string;
  maxResults?: number;
};

export interface SuggestionsDeps {
  sheetsApi: sheets_v4.Sheets;
  resolveAnalyzeRange: (range?: {
    a1?: string;
    sheetName?: string;
    range?: string;
  }) => string | undefined;
}

/**
 * Decomposed action handler for `suggest_next_actions`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleSuggestNextActionsAction(
  input: SuggestNextActionsRequest,
  deps: SuggestionsDeps
): Promise<AnalyzeResponse> {
  logger.info('Suggest next actions', { spreadsheetId: input.spreadsheetId });

  try {
    const { SuggestionEngine } = await import('../../analysis/suggestion-engine.js');
    const { Scout } = await import('../../analysis/scout.js');
    const { ActionGenerator } = await import('../../analysis/action-generator.js');
    const { getCacheAdapter } = await import('../../utils/cache-adapter.js');

    const suggestEngine = new SuggestionEngine({
      scout: new Scout({
        cache: getCacheAdapter('suggest'),
        sheetsApi: deps.sheetsApi,
      }),
      actionGenerator: new ActionGenerator(),
    });

    const suggestResult = await suggestEngine.suggest({
      spreadsheetId: input.spreadsheetId,
      range: input.range ? deps.resolveAnalyzeRange(input.range) : undefined,
      maxSuggestions: input.maxSuggestions ?? 5,
      categories: input.categories,
    });

    recordSuggestionOp('suggest_next_actions', 'success');
    return {
      success: true,
      action: 'suggest_next_actions',
      suggestions: suggestResult.suggestions,
      scoutSummary: suggestResult.scoutSummary,
      totalCandidates: suggestResult.totalCandidates,
      filtered: suggestResult.filtered,
    };
  } catch (error) {
    logger.error('suggest_next_actions failed', {
      spreadsheetId: input.spreadsheetId,
      error: error instanceof Error ? error.message : String(error),
    });
    recordSuggestionOp('suggest_next_actions', 'error');
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Suggestion generation failed. Please try again.',
        retryable: true,
      },
    };
  }
}

/**
 * Decomposed action handler for `auto_enhance`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleAutoEnhanceAction(
  input: AutoEnhanceRequest,
  deps: SuggestionsDeps
): Promise<AnalyzeResponse> {
  logger.info('Auto enhance', { spreadsheetId: input.spreadsheetId, mode: input.mode });

  try {
    const { SuggestionEngine } = await import('../../analysis/suggestion-engine.js');
    const { Scout } = await import('../../analysis/scout.js');
    const { ActionGenerator } = await import('../../analysis/action-generator.js');
    const { getCacheAdapter } = await import('../../utils/cache-adapter.js');

    const enhanceEngine = new SuggestionEngine({
      scout: new Scout({
        cache: getCacheAdapter('enhance'),
        sheetsApi: deps.sheetsApi,
      }),
      actionGenerator: new ActionGenerator(),
    });

    const enhanceResult = await enhanceEngine.enhance({
      spreadsheetId: input.spreadsheetId,
      range: input.range ? deps.resolveAnalyzeRange(input.range) : undefined,
      categories: input.categories ?? ['formatting', 'structure'],
      mode: input.mode ?? 'preview',
      maxEnhancements: input.maxEnhancements ?? 3,
    });

    recordSuggestionOp('auto_enhance', 'success');
    return {
      success: true,
      action: 'auto_enhance',
      mode: input.mode ?? 'preview',
      enhancements: enhanceResult.applied,
      enhanceSummary: enhanceResult.summary,
    };
  } catch (error) {
    logger.error('auto_enhance failed', {
      spreadsheetId: input.spreadsheetId,
      error: error instanceof Error ? error.message : String(error),
    });
    recordSuggestionOp('auto_enhance', 'error');
    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Auto-enhancement failed. Please try again.',
        retryable: true,
      },
    };
  }
}

/**
 * Decomposed action handler for `discover_action`.
 * Preserves original behavior while moving logic out of the main AnalyzeHandler class.
 */
export async function handleDiscoverActionAction(
  input: DiscoverActionRequest
): Promise<AnalyzeResponse> {
  logger.info('Discover action (meta-tool)', { query: input.query, category: input.category });

  try {
    const { discoverActions, analyzeDiscoveryQuery } =
      await import('../../services/action-discovery.js');

    const matches = discoverActions(input.query, input.category, input.maxResults ?? 5);
    const guidance = analyzeDiscoveryQuery(input.query, matches);

    return {
      success: true,
      action: 'discover_action',
      query: input.query,
      category: input.category ?? 'all',
      matches,
      matchCount: matches.length,
      ...guidance,
    };
  } catch (error) {
    logger.error('discover_action failed', {
      query: input.query,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: ErrorCodes.DISCOVERY_FAILED,
        message: 'Action discovery failed. Please try a different search query.',
        retryable: true,
      },
    };
  }
}
