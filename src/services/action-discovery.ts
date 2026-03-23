/**
 * Action Discovery Service
 *
 * Provides intent-aware search across all 404 ServalSheets actions.
 * Builds an inverted index from action names, tool descriptions,
 * and action annotations for fast lookup.
 *
 * Usage: Used by discover_action meta-tool in sheets_analyze
 * to help Claude find the right action using natural language.
 */

import { ACTION_ANNOTATIONS } from '../schemas/annotations.js';

export interface ActionMatch {
  tool: string;
  action: string;
  confidence: number;
  description: string;
  whenToUse?: string;
  whenNotToUse?: string;
  commonMistake?: string;
}

interface ActionIndex {
  key: string;
  tool: string;
  action: string;
  strongKeywords: string[];
  weakKeywords: string[];
  description: string;
  whenToUse?: string;
  whenNotToUse?: string;
  commonMistakes?: string[];
  category?: string;
  actionPhrase: string;
  toolPhrase: string;
}

/**
 * Category mapping for all registered tools.
 * Used to filter results by category.
 */
export const TOOL_CATEGORIES: Record<string, string> = {
  sheets_data: 'data',
  sheets_core: 'structure',
  sheets_format: 'format',
  sheets_dimensions: 'structure',
  sheets_advanced: 'structure',
  sheets_analyze: 'analysis',
  sheets_visualize: 'analysis',
  sheets_collaborate: 'collaboration',
  sheets_composite: 'data',
  sheets_fix: 'data',
  sheets_history: 'data',
  sheets_dependencies: 'analysis',
  sheets_bigquery: 'data',
  sheets_appsscript: 'automation',
  sheets_webhook: 'automation',
  sheets_federation: 'automation',
  sheets_transaction: 'data',
  sheets_session: 'structure',
  sheets_quality: 'data',
  sheets_templates: 'structure',
  sheets_confirm: 'structure',
  sheets_auth: 'structure',
  sheets_agent: 'automation',
  sheets_compute: 'analysis',
  sheets_connectors: 'data',
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'use',
  'what',
  'when',
  'with',
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  add: ['append', 'insert', 'create'],
  append: ['add', 'insert'],
  auth: ['oauth', 'login', 'token'],
  calculate: ['compute', 'formula', 'math'],
  chart: ['graph', 'plot', 'visualization'],
  clean: ['fix', 'normalize', 'sanitize'],
  dedupe: ['deduplicate', 'duplicate'],
  duplicate: ['deduplicate', 'dedupe'],
  fetch: ['get', 'read'],
  graph: ['chart', 'plot', 'visualization'],
  list: ['show', 'enumerate'],
  merge: ['combine'],
  notification: ['webhook', 'trigger'],
  oauth: ['auth', 'login', 'token'],
  permission: ['access', 'share'],
  plot: ['chart', 'graph', 'visualization'],
  read: ['fetch', 'get', 'query'],
  scenario: ['whatif', 'forecast'],
  share: ['permission', 'access', 'collaborate'],
  sheet: ['tab', 'worksheet'],
  sheets: ['tabs', 'worksheets'],
  spreadsheet: ['workbook', 'file', 'document'],
  spreadsheets: ['workbooks', 'files', 'documents'],
  tab: ['sheet', 'worksheet'],
  tabs: ['sheets', 'worksheets'],
  trigger: ['webhook', 'notification'],
  undo: ['revert', 'rollback'],
  update: ['write', 'edit', 'set'],
  visualize: ['chart', 'graph', 'plot'],
  webhook: ['trigger', 'notification'],
  workbook: ['spreadsheet', 'file'],
  write: ['update', 'edit', 'set'],
};

const ACTION_INTENT_BOOSTS: Array<{ pattern: RegExp; actionKeys: string[]; bonus: number }> = [
  {
    pattern:
      /\blist\b.*\b(spreadsheet|spreadsheets|workbook|workbooks|drive)\b|\bdrive\b.*\blist\b/,
    actionKeys: ['sheets_core.list'],
    bonus: 4,
  },
  {
    pattern: /\blist\b.*\b(sheet|sheets|tab|tabs|worksheet|worksheets)\b/,
    actionKeys: ['sheets_core.list_sheets'],
    bonus: 6,
  },
  {
    pattern: /\bmerge\b.*\bcells?\b/,
    actionKeys: ['sheets_data.merge_cells'],
    bonus: 4,
  },
  {
    pattern: /\bunmerge\b.*\bcells?\b/,
    actionKeys: ['sheets_data.unmerge_cells'],
    bonus: 4,
  },
  {
    pattern: /\bfind\b.*\bduplicates?\b|\bdedupe\b|\bdeduplicate\b/,
    actionKeys: ['sheets_composite.deduplicate'],
    bonus: 4,
  },
  {
    pattern: /\bwhat[-\s]?if\b|\bscenario\b/,
    actionKeys: ['sheets_dependencies.model_scenario', 'sheets_dependencies.compare_scenarios'],
    bonus: 3,
  },
];

const TOOL_INTENT_BOOSTS: Array<{ pattern: RegExp; tools: string[]; bonus: number }> = [
  {
    pattern: /\bshare\b|\bpermission\b|\baccess\b|\bcomment\b/,
    tools: ['sheets_collaborate'],
    bonus: 2,
  },
  {
    pattern: /\bwebhook\b|\btrigger\b|\bnotification\b/,
    tools: ['sheets_webhook'],
    bonus: 2,
  },
  {
    pattern: /\bbigquery\b|\bsql\b|\bdataset\b/,
    tools: ['sheets_bigquery'],
    bonus: 2,
  },
];

const GENERIC_VERBS = new Set(['list', 'create', 'delete', 'get', 'add', 'update', 'set', 'run']);

const LIST_OBJECT_HINT = /\b(spreadsheet|spreadsheets|drive|sheet|sheets|tab|tabs)\b/;

export type DiscoveryClarificationReason =
  | 'no_matches'
  | 'underspecified_query'
  | 'low_confidence'
  | 'close_competition';

export interface DiscoveryGuidance {
  needsClarification: boolean;
  clarificationReason?: DiscoveryClarificationReason;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
}

let indexCache: ActionIndex[] | null = null;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractTerms(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function singularize(token: string): string {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
  return token;
}

function pluralize(token: string): string {
  if (token.endsWith('s')) return token;
  if (token.endsWith('y') && token.length > 2) return `${token.slice(0, -1)}ies`;
  return `${token}s`;
}

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);

  for (const token of tokens) {
    const singular = singularize(token);
    const plural = pluralize(token);
    expanded.add(singular);
    expanded.add(plural);

    for (const variant of [token, singular, plural]) {
      const synonyms = TOKEN_SYNONYMS[variant];
      if (!synonyms) continue;
      for (const synonym of synonyms) {
        expanded.add(synonym);
      }
    }
  }

  return [...expanded].filter((token) => token.length > 1);
}

/**
 * Build the action index from ACTION_ANNOTATIONS.
 * This runs once and caches the result.
 *
 * Each action gets search terms from:
 * 1. Action name parts (split on underscore)
 * 2. Tool name parts (after removing "sheets_" prefix)
 * 3. Guidance fields (whenToUse, whenNotToUse, commonMistakes)
 */
function buildIndex(): ActionIndex[] {
  if (indexCache) return indexCache;

  const index: ActionIndex[] = [];

  // Index all actions from ACTION_ANNOTATIONS
  for (const [key, annotation] of Object.entries(ACTION_ANNOTATIONS)) {
    const [tool, action] = key.split('.');
    if (!tool || !action) continue;

    const strongKeywords = new Set<string>();
    const weakKeywords = new Set<string>();

    // Add action name parts (e.g., "batch_read" → ["batch", "read"])
    action.split('_').forEach((w) => {
      if (w.length > 1) {
        strongKeywords.add(w.toLowerCase());
      }
    });

    // Add tool name parts (e.g., "sheets_data" → ["data"])
    tool
      .replace('sheets_', '')
      .split('_')
      .forEach((w) => {
        if (w.length > 1) {
          strongKeywords.add(w.toLowerCase());
        }
      });

    // Add words from guidance text
    for (const term of extractTerms(annotation.whenToUse)) {
      strongKeywords.add(term);
    }
    for (const term of extractTerms(annotation.whenNotToUse)) {
      weakKeywords.add(term);
    }
    if (annotation.commonMistakes) {
      for (const mistake of annotation.commonMistakes) {
        for (const term of extractTerms(mistake)) {
          weakKeywords.add(term);
        }
      }
    }

    // Build description: prefer whenToUse, fall back to action name
    const description = annotation.whenToUse || `${action.replace(/_/g, ' ')} operation`;

    index.push({
      key,
      tool,
      action,
      strongKeywords: [...strongKeywords],
      weakKeywords: [...weakKeywords],
      description,
      whenToUse: annotation.whenToUse,
      whenNotToUse: annotation.whenNotToUse,
      commonMistakes: annotation.commonMistakes,
      category: TOOL_CATEGORIES[tool] || 'other',
      actionPhrase: action.replace(/_/g, ' '),
      toolPhrase: tool.replace('sheets_', '').replace(/_/g, ' '),
    });
  }

  indexCache = index;
  return index;
}

/**
 * Tokenize a search query into lowercase words.
 * Removes special characters and filters out very short tokens.
 */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function matchesPartially(haystack: string[], token: string): boolean {
  // Short tokens (e.g., "tab") are too ambiguous for substring matching
  // and can incorrectly match unrelated words (e.g., "table").
  if (token.length < 4) return false;
  return haystack.some((keyword) => keyword.includes(token) || token.includes(keyword));
}

/**
 * Search for actions matching a natural language query.
 *
 * @param query - Natural language search query (e.g., "merge cells", "combine data")
 * @param category - Optional category filter (data|format|analysis|structure|collaboration|automation|all)
 * @param maxResults - Maximum results to return (1-10, default 5)
 * @returns Array of matching actions ranked by confidence
 */
export function discoverActions(
  query: string,
  category?: string,
  maxResults: number = 5
): ActionMatch[] {
  const index = buildIndex();
  const queryTokens = expandQueryTokens(tokenize(query));
  const normalizedQuery = query.toLowerCase();
  const safeMaxResults = Math.max(1, Math.min(10, maxResults));

  if (queryTokens.length === 0) return [];

  const scored: { entry: ActionIndex; confidence: number; rawScore: number }[] = [];

  for (const entry of index) {
    // Skip if category filter provided and doesn't match
    if (category && category !== 'all' && entry.category !== category) continue;

    let rawScore = 0;

    for (const token of queryTokens) {
      // Exact keyword match (strongest signal: +3 points)
      if (entry.strongKeywords.includes(token)) {
        rawScore += 3;
      }
      // Partial match in strong keywords (word contains token or vice versa: +1.5 points)
      else if (matchesPartially(entry.strongKeywords, token)) {
        rawScore += 1.5;
      }
      // Weak keyword match from whenNotToUse/commonMistakes (+1 point)
      else if (entry.weakKeywords.includes(token)) {
        rawScore += 1;
      }
      // Partial weak match (+0.5 points)
      else if (matchesPartially(entry.weakKeywords, token)) {
        rawScore += 0.5;
      }
      // Direct match in action name (e.g., searching "read" finds "read_*" actions: +2 points)
      else if (entry.action.includes(token)) {
        rawScore += 2;
      }
      // Match in tool name (e.g., "data" matches sheets_data: +0.75 points)
      else if (entry.tool.includes(token)) {
        rawScore += 0.75;
      }
      // Match in description text (+1 point)
      else if (entry.description.toLowerCase().includes(token)) {
        rawScore += 1;
      }
    }

    // Strong phrase match boosts for high-confidence direct intents.
    if (entry.actionPhrase.includes(' ') && normalizedQuery.includes(entry.actionPhrase)) {
      rawScore += 3;
    }
    if (normalizedQuery.includes(entry.toolPhrase)) {
      rawScore += 1;
    }

    for (const rule of ACTION_INTENT_BOOSTS) {
      if (rule.pattern.test(normalizedQuery) && rule.actionKeys.includes(entry.key)) {
        rawScore += rule.bonus;
      }
    }

    for (const rule of TOOL_INTENT_BOOSTS) {
      if (rule.pattern.test(normalizedQuery) && rule.tools.includes(entry.tool)) {
        rawScore += rule.bonus;
      }
    }

    // Normalize confidence score to 0-1 range
    const normalizationBase = Math.max(6, queryTokens.length * 3 + 3);
    const confidence = Math.min(1, rawScore / normalizationBase);

    // Only include matches with minimum confidence
    if (confidence > 0.12) {
      scored.push({ entry, confidence, rawScore });
    }
  }

  // Sort by confidence first, then raw score for deterministic tie-breaks.
  scored.sort((a, b) => b.confidence - a.confidence || b.rawScore - a.rawScore);

  // Return top N results
  return scored.slice(0, safeMaxResults).map(({ entry, confidence }) => ({
    tool: entry.tool,
    action: entry.action,
    confidence: Math.round(confidence * 100) / 100,
    description: entry.description,
    whenToUse: entry.whenToUse,
    whenNotToUse: entry.whenNotToUse,
    commonMistake: entry.commonMistakes?.[0],
  }));
}

function toOptionLabel(match: ActionMatch): string {
  return `${match.tool}.${match.action} — ${match.description}`;
}

/**
 * Analyze discovery results and determine whether we should ask a clarification
 * question instead of blindly selecting a top match.
 */
export function analyzeDiscoveryQuery(query: string, matches: ActionMatch[]): DiscoveryGuidance {
  const queryTokens = tokenize(query);
  const normalizedQuery = query.toLowerCase();

  if (matches.length === 0) {
    return {
      needsClarification: true,
      clarificationReason: 'no_matches',
      clarificationQuestion:
        'I could not find a strong action match. Can you describe the exact operation and target (cells, sheet tab, spreadsheet, chart, or sharing)?',
      clarificationOptions: [],
    };
  }

  const top = matches[0]?.confidence ?? 0;
  const second = matches[1]?.confidence ?? 0;
  const spread = top - second;
  const topOptions = matches.slice(0, 3).map(toOptionLabel);

  const hasOnlyGenericIntent =
    queryTokens.length <= 1 || queryTokens.every((token) => GENERIC_VERBS.has(token));

  if (queryTokens.includes('list') && !LIST_OBJECT_HINT.test(normalizedQuery)) {
    return {
      needsClarification: true,
      clarificationReason: 'underspecified_query',
      clarificationQuestion:
        'Do you want to list Drive spreadsheets, or list sheet tabs inside a spreadsheet?',
      clarificationOptions: [
        'sheets_core.list — List spreadsheets in Google Drive',
        'sheets_core.list_sheets — List tabs in one spreadsheet',
      ],
    };
  }

  if (hasOnlyGenericIntent) {
    return {
      needsClarification: true,
      clarificationReason: 'underspecified_query',
      clarificationQuestion:
        'Your request is broad. Which specific target do you mean (cells, sheet tab, chart, sharing, or entire spreadsheet)?',
      clarificationOptions: topOptions,
    };
  }

  if (top < 0.3) {
    return {
      needsClarification: true,
      clarificationReason: 'low_confidence',
      clarificationQuestion:
        'I found possible actions but confidence is low. Which of these best matches your intent?',
      clarificationOptions: topOptions,
    };
  }

  if (matches.length > 1 && spread <= 0.03) {
    return {
      needsClarification: true,
      clarificationReason: 'close_competition',
      clarificationQuestion: 'Two actions look equally likely. Which one should I use?',
      clarificationOptions: topOptions,
    };
  }

  return { needsClarification: false };
}

/**
 * Get all available categories for filtering.
 */
export function getCategories(): string[] {
  return ['data', 'format', 'analysis', 'structure', 'collaboration', 'automation'];
}
