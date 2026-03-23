/**
 * ServalSheets - Knowledge Search Resource
 *
 * Provides fuzzy search across all knowledge files.
 * URI: knowledge:///search?q={query}
 *
 * Features:
 * - Intent-based direct routing for common queries (Fix 8)
 * - Expanded keyword mappings for comprehensive coverage (Fix 2)
 * - Multi-word keyword expansion (Fix 3)
 * - Levenshtein fuzzy matching for typo tolerance (Fix 4)
 * - Suffix-stripping stemmer for word matching (Fix 10)
 *
 * @module resources/knowledge-search
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listKnowledgeResources } from './knowledge.js';

/**
 * Search result with relevance scoring
 */
interface SearchResult {
  uri: string;
  name: string;
  description: string;
  category: string;
  score: number;
  matchType: 'name' | 'description' | 'category' | 'keyword' | 'intent' | 'fuzzy';
}

// =============================================================================
// Fix 8: Intent-based direct routing — skip scoring for common query patterns
// =============================================================================

/**
 * Maps regex patterns to knowledge file name prefixes.
 * When a query matches a pattern, those files get score=100 instantly.
 */
const INTENT_PATTERNS: Array<{ pattern: RegExp; files: string[] }> = [
  {
    pattern: /\b(formula|function|vlookup|xlookup|index.?match|sumif|countif|arrayformula)\b/i,
    files: ['functions-reference', 'lookup', 'key-formulas', 'advanced', 'financial', 'datetime'],
  },
  {
    pattern: /\b(quota|rate.?limit|throttl|429|too.?many)\b/i,
    files: ['quotas'],
  },
  {
    pattern: /\b(template|crm|inventory|project.?template|budget.?template|marketing.?template)\b/i,
    files: ['template', 'crm', 'inventory', 'project', 'finance', 'marketing'],
  },
  {
    pattern: /\b(chart|graph|pie|bar|line.?chart|scatter|histogram|treemap|waterfall)\b/i,
    files: ['charts'],
  },
  {
    pattern: /\b(pivot|pivot.?table|summary.?table|aggregate)\b/i,
    files: ['pivot-tables'],
  },
  {
    pattern: /\b(conditional.?format|color.?scale|gradient|rule|highlight)\b/i,
    files: ['conditional-formatting'],
  },
  {
    pattern: /\b(data.?validation|dropdown|list.?validation|custom.?formula.?validation)\b/i,
    files: ['data-validation'],
  },
  {
    pattern: /\b(batch|bulk|multiple.?operations|batch.?update|batch.?read|batch.?write)\b/i,
    files: ['batch-operations'],
  },
  {
    pattern: /\b(named.?range|protected.?range|protection)\b/i,
    files: ['named-ranges'],
  },
  {
    pattern: /\b(error|error.?handling|recovery|retry|timeout|401|403|404|500)\b/i,
    files: ['error-handling'],
  },
  {
    pattern: /\b(security|compliance|audit|permission|access.?control|oauth|scope)\b/i,
    files: ['security-compliance'],
  },
  {
    pattern: /\b(performance|tuning|optimize|slow|latency|speed)\b/i,
    files: ['performance-tuning'],
  },
  {
    pattern: /\b(concurren|parallel|race.?condition|lock|conflict)\b/i,
    files: ['concurrency-patterns'],
  },
  {
    pattern: /\b(data.?quality|quality|clean|validate|integrity)\b/i,
    files: ['data-quality'],
  },
  {
    pattern: /\b(schema|governance|naming|standard|convention)\b/i,
    files: ['schema-governance'],
  },
  {
    pattern: /\b(apps?.?script|trigger|macro|custom.?function|automation)\b/i,
    files: ['apps-script-integration'],
  },
  {
    pattern: /\b(workflow|pattern|best.?practice|intent|natural.?language)\b/i,
    files: ['workflow-patterns', 'workflow-intelligence', 'natural-language-guide', 'user-intent'],
  },
  {
    pattern: /\b(confirm|safety|destructive|dangerous|undo|rollback)\b/i,
    files: ['confirmation-guide'],
  },
  {
    pattern: /\b(ui|ux|user.?experience|display|present)\b/i,
    files: ['ui-ux-patterns'],
  },
  {
    pattern: /\b(anti.?pattern|mistake|avoid|wrong|bad.?practice)\b/i,
    files: ['formula-antipatterns'],
  },
  {
    pattern: /\b(datafilter|dynamic.?range|metadata.?lookup|grid.?range)\b/i,
    files: ['dynamic-ranges'],
  },
  {
    pattern: /\b(bigquery|bq|sql|scheduled.?query|connected.?sheet)\b/i,
    files: ['bigquery-optimization'],
  },
  {
    pattern: /\b(webhook|notification|push|watch|change.?detection)\b/i,
    files: ['webhook-security'],
  },
  {
    pattern: /\b(sparkline|inline.?chart|mini.?chart)\b/i,
    files: ['charts', 'functions-reference'],
  },
  {
    pattern:
      /\b(lambda|let.?formula|map.?reduce|scan.?array|byrow|bycol|makearray|isomitted|named.?function)\b/i,
    files: ['lambda-advanced'],
  },
  {
    pattern:
      /\b(query.?function|gql.?query|select.?from|group.?by.?sheets|pivot.?query|having.?sheets)\b/i,
    files: ['query-function'],
  },
  {
    pattern:
      /\b(importrange|import.?range|cross.?spreadsheet|cross.?sheet.?import|allow.?access)\b/i,
    files: ['importrange'],
  },
  {
    pattern:
      /\b(slicer|tables.?api|table.?column|columnproperties|dropdown.?type|structured.?table)\b/i,
    files: ['slicers-tables'],
  },
];

// =============================================================================
// Fix 2: Expanded keyword mappings (27 → 50+ entries)
// =============================================================================

const KEYWORD_MAPPINGS: Record<string, string[]> = {
  // Budget/Finance terms
  budget: ['finance', 'financial', 'money', 'expense', 'income', 'template'],
  finance: ['budget', 'financial', 'money', 'accounting', 'template'],
  money: ['finance', 'budget', 'financial'],
  accounting: ['finance', 'financial', 'journal', 'ledger'],

  // Sales/CRM terms
  sales: ['crm', 'customer', 'pipeline', 'deal', 'template'],
  crm: ['customer', 'sales', 'contact', 'pipeline', 'template'],
  customer: ['crm', 'sales', 'contact'],
  pipeline: ['sales', 'crm', 'deal'],

  // Project terms
  project: ['task', 'milestone', 'gantt', 'schedule', 'template'],
  task: ['project', 'todo', 'milestone'],
  gantt: ['project', 'schedule', 'timeline'],

  // Inventory terms
  inventory: ['stock', 'sku', 'warehouse', 'quantity', 'template'],
  stock: ['inventory', 'warehouse', 'quantity'],

  // Formula terms
  vlookup: ['lookup', 'index', 'match', 'search', 'formula', 'function'],
  xlookup: ['lookup', 'vlookup', 'index', 'match', 'formula'],
  lookup: ['vlookup', 'index', 'match', 'xlookup', 'formula'],
  formula: ['function', 'calculation', 'expression', 'reference'],
  arrayformula: ['array', 'formula', 'bulk', 'spill'],
  sumif: ['formula', 'conditional', 'sum', 'aggregate'],
  countif: ['formula', 'conditional', 'count', 'aggregate'],

  // API terms
  api: ['quota', 'rate', 'limit', 'batch', 'error'],
  quota: ['api', 'limit', 'rate', 'throttle'],
  batch: ['api', 'bulk', 'multiple', 'performance', 'operation'],
  rate: ['quota', 'limit', 'throttle', 'api'],

  // Performance terms
  performance: ['optimization', 'speed', 'fast', 'efficient', 'tuning'],
  optimization: ['performance', 'optimize', 'improve', 'tuning'],
  speed: ['performance', 'fast', 'latency', 'optimization'],
  latency: ['performance', 'speed', 'slow', 'timeout'],

  // Chart/Visualization
  chart: ['graph', 'visualization', 'plot', 'sparkline'],
  graph: ['chart', 'visualization', 'plot'],
  pivot: ['summary', 'aggregate', 'table', 'crosstab'],
  sparkline: ['chart', 'inline', 'mini', 'visualization'],

  // Security terms
  security: ['permission', 'access', 'protection', 'compliance', 'audit'],
  permission: ['security', 'access', 'share', 'protect'],
  protect: ['security', 'permission', 'lock', 'named range'],

  // NEW: Operations terms (Fix 2)
  sort: ['order', 'arrange', 'rank', 'dimension'],
  filter: ['view', 'criteria', 'slicer', 'dimension'],
  query: ['search', 'find', 'lookup', 'sql', 'bigquery'],
  summarize: ['aggregate', 'total', 'sum', 'pivot', 'group'],
  aggregate: ['summarize', 'total', 'sum', 'pivot', 'group'],
  merge: ['combine', 'join', 'union', 'cell'],
  split: ['separate', 'divide', 'text to columns'],
  import: ['csv', 'upload', 'load', 'composite', 'xlsx'],
  export: ['download', 'save', 'xlsx', 'csv', 'composite'],
  duplicate: ['copy', 'clone', 'replicate', 'sheet'],
  template: ['preset', 'starter', 'boilerplate', 'crm', 'inventory'],
  schedule: ['timer', 'recurring', 'cron', 'automated', 'trigger'],
  trigger: ['event', 'onedit', 'onchange', 'schedule', 'apps script'],
  webhook: ['notification', 'callback', 'push', 'watch', 'event'],
  bigquery: ['sql', 'query', 'connected', 'warehouse', 'analytics'],
  share: ['collaborate', 'permission', 'access', 'user', 'email'],
  validate: ['check', 'verify', 'quality', 'data validation'],
  format: ['style', 'color', 'font', 'border', 'conditional'],
  conditional: ['rule', 'format', 'highlight', 'color scale'],
  error: ['recovery', 'retry', 'handle', 'fix', 'troubleshoot'],
  undo: ['revert', 'rollback', 'history', 'restore'],
  snapshot: ['version', 'backup', 'checkpoint', 'history'],
  datafilter: ['dynamic range', 'metadata', 'grid range', 'resilient'],

  // New terms (2026-02-19)
  lambda: ['function', 'custom', 'named', 'reusable', 'formula'],
  let: ['variable', 'named', 'intermediate', 'lambda', 'formula'],
  reduce: ['accumulate', 'fold', 'aggregate', 'lambda', 'array'],
  scan: ['running', 'cumulative', 'lambda', 'array', 'reduce'],
  byrow: ['aggregate', 'row', 'lambda', 'summary'],
  bycol: ['aggregate', 'column', 'lambda', 'summary'],
  makearray: ['generate', 'array', 'lambda', 'matrix'],
  importrange: ['import', 'range', 'cross-sheet', 'external', 'link'],
  slicer: ['filter', 'interactive', 'widget', 'chart', 'dimension'],
  table: ['structured', 'column', 'dropdown', 'banded', 'header'],
};

// =============================================================================
// Fix 10: Suffix-stripping stemmer for word matching
// =============================================================================

/**
 * Simple English suffix stemmer for improving word matching.
 * "optimization" → "optimiz", "optimize" → "optimiz" → match!
 */
function stem(word: string): string {
  if (word.length < 4) return word;
  return word
    .replace(/(ation|izing|ized|ment|ness|able|ible|ious|ives|ting|sion|ence|ance)$/, '')
    .replace(/(ing|ive|ize|ise|ful|ous|ent|ant|ery|ory|ist|ism|ity|ial|ual)$/, '')
    .replace(/(ed|er|es|ly|al|en)$/, '')
    .replace(/(s)$/, '')
    .replace(/(.)\1+$/, '$1'); // deduplicate trailing chars
}

// =============================================================================
// Fix 4: Levenshtein distance for typo tolerance
// =============================================================================

/**
 * Calculate Levenshtein edit distance between two strings.
 * Used for typo tolerance: "vlookp" → "vlookup" (distance 1)
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1, // deletion
        matrix[i]![j - 1]! + 1, // insertion
        matrix[i - 1]![j - 1]! + cost // substitution
      );
    }
  }
  return matrix[b.length]![a.length]!;
}

/**
 * Known terms for fuzzy matching against typos
 */
const KNOWN_TERMS = [
  'vlookup',
  'xlookup',
  'hlookup',
  'lookup',
  'index',
  'match',
  'formula',
  'function',
  'arrayformula',
  'sumif',
  'countif',
  'query',
  'filter',
  'sort',
  'unique',
  'sparkline',
  'chart',
  'pivot',
  'conditional',
  'validation',
  'format',
  'batch',
  'transaction',
  'template',
  'import',
  'export',
  'merge',
  'split',
  'protect',
  'share',
  'collaborate',
  'webhook',
  'trigger',
  'bigquery',
  'schedule',
  'performance',
  'optimization',
  'error',
  'quota',
  'security',
  'compliance',
  'concurrency',
  'snapshot',
  'datafilter',
  'banding',
  'lambda',
  'importrange',
  'slicer',
  'makearray',
  'regexmatch',
  'regexextract',
  'regexreplace',
  'xlookup',
  'byrow',
  'bycol',
];

// =============================================================================
// Core search functions
// =============================================================================

/**
 * Normalize a search term for matching
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[-_]/g, ' ').trim();
}

/**
 * Calculate match score between query and text.
 * Enhanced with stemming (Fix 10) for better word-level matching.
 */
function calculateScore(query: string, text: string, weight: number): number {
  const normalizedQuery = normalize(query);
  const normalizedText = normalize(text);

  // Exact match
  if (normalizedText === normalizedQuery) {
    return 100 * weight;
  }

  // Contains exact query
  if (normalizedText.includes(normalizedQuery)) {
    return 80 * weight;
  }

  // Word-level matching with stemming (Fix 10)
  const queryWords = normalizedQuery.split(/\s+/);
  const textWords = normalizedText.split(/\s+/);
  const stemmedTextWords = textWords.map(stem);

  let matchedWords = 0;
  for (const qw of queryWords) {
    const stemmedQw = stem(qw);
    const directMatch = textWords.some((tw) => tw.includes(qw) || qw.includes(tw));
    const stemMatch = stemmedTextWords.some(
      (stw) => stw === stemmedQw || stw.includes(stemmedQw) || stemmedQw.includes(stw)
    );
    if (directMatch || stemMatch) {
      matchedWords++;
    }
  }

  if (matchedWords > 0) {
    return (matchedWords / queryWords.length) * 60 * weight;
  }

  return 0;
}

/**
 * Check if query matches via keyword expansion.
 * Fix 3: Splits multi-word queries into individual words for expansion.
 */
function checkKeywordMatch(query: string, text: string): boolean {
  const normalizedQuery = normalize(query);
  const normalizedText = normalize(text);

  // Fix 3: Split query into individual words and check each
  const queryWords = normalizedQuery.split(/\s+/);

  for (const word of queryWords) {
    // Check exact word mapping
    const relatedKeywords = KEYWORD_MAPPINGS[word] || [];
    for (const keyword of relatedKeywords) {
      if (normalizedText.includes(keyword)) {
        return true;
      }
    }

    // Also check stemmed version of the word
    const stemmed = stem(word);
    if (stemmed !== word) {
      const stemRelated = KEYWORD_MAPPINGS[stemmed] || [];
      for (const keyword of stemRelated) {
        if (normalizedText.includes(keyword)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if query has typo matches against known terms (Fix 4).
 * Returns the matched term and distance if found.
 */
function findFuzzyMatch(query: string): { term: string; distance: number } | null {
  const normalizedQuery = normalize(query);
  const queryWords = normalizedQuery.split(/\s+/);

  for (const word of queryWords) {
    if (word.length < 3) continue; // Skip very short words

    const maxDistance = word.length <= 5 ? 1 : 2; // Allow more edits for longer words

    let bestMatch: { term: string; distance: number } | null = null;

    for (const term of KNOWN_TERMS) {
      const dist = levenshtein(word, term);
      if (dist > 0 && dist <= maxDistance) {
        if (!bestMatch || dist < bestMatch.distance) {
          bestMatch = { term, distance: dist };
        }
      }
    }

    if (bestMatch) return bestMatch;
  }

  return null;
}

/**
 * Search knowledge resources with enhanced matching
 */
async function searchKnowledge(query: string): Promise<SearchResult[]> {
  const resources = await listKnowledgeResources();
  const results: SearchResult[] = [];

  // Fix 8: Check intent patterns first for instant routing
  const normalizedQuery = normalize(query);
  const intentMatches = new Set<string>();
  for (const { pattern, files } of INTENT_PATTERNS) {
    if (pattern.test(normalizedQuery)) {
      for (const file of files) {
        intentMatches.add(file);
      }
    }
  }

  for (const resource of resources) {
    let maxScore = 0;
    let matchType: SearchResult['matchType'] = 'name';

    // Fix 8: Check if this resource matches an intent pattern
    if (intentMatches.size > 0) {
      const resourceName = normalize(resource.name);
      for (const intentFile of intentMatches) {
        if (resourceName.includes(intentFile)) {
          maxScore = 95; // High score but below exact match (100)
          matchType = 'intent';
          break;
        }
      }
    }

    // Score by name (highest weight)
    const nameScore = calculateScore(query, resource.name, 1.0);
    if (nameScore > maxScore) {
      maxScore = nameScore;
      matchType = 'name';
    }

    // Score by category
    const categoryScore = calculateScore(query, resource.category, 0.8);
    if (categoryScore > maxScore) {
      maxScore = categoryScore;
      matchType = 'category';
    }

    // Score by description
    const descScore = calculateScore(query, resource.description, 0.6);
    if (descScore > maxScore) {
      maxScore = descScore;
      matchType = 'description';
    }

    // Check keyword expansion (Fix 3: now works with multi-word queries)
    if (maxScore < 30) {
      const nameKeyword = checkKeywordMatch(query, resource.name);
      const descKeyword = checkKeywordMatch(query, resource.description);
      const catKeyword = checkKeywordMatch(query, resource.category);

      if (nameKeyword || descKeyword || catKeyword) {
        maxScore = 25;
        matchType = 'keyword';
      }
    }

    // Fix 4: Fuzzy match for typos (last resort)
    if (maxScore < 15) {
      const fuzzy = findFuzzyMatch(query);
      if (fuzzy) {
        // Re-score using the corrected term
        const correctedNameScore = calculateScore(fuzzy.term, resource.name, 0.7);
        const correctedDescScore = calculateScore(fuzzy.term, resource.description, 0.4);
        const correctedCatScore = calculateScore(fuzzy.term, resource.category, 0.5);
        const correctedMax = Math.max(correctedNameScore, correctedDescScore, correctedCatScore);

        if (correctedMax > maxScore) {
          maxScore = correctedMax;
          matchType = 'fuzzy';
        }
      }
    }

    if (maxScore > 0) {
      results.push({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        category: resource.category,
        score: Math.round(maxScore * 10) / 10,
        matchType,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Return top 10 results
  return results.slice(0, 10);
}

/**
 * Register knowledge search resource
 */
export function registerKnowledgeSearchResource(server: McpServer): void {
  server.registerResource(
    'Knowledge Search',
    'knowledge:///search',
    {
      description:
        'Fuzzy search across all knowledge files. Append ?q=query to search. Returns top 10 matches ranked by relevance.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const url = new URL(uri.toString(), 'knowledge://localhost');
      const query = url.searchParams.get('q') || '';

      if (!query) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Missing query parameter',
                  usage: 'knowledge:///search?q=your+search+term',
                  examples: [
                    'knowledge:///search?q=VLOOKUP',
                    'knowledge:///search?q=budget+template',
                    'knowledge:///search?q=batch+operations',
                    'knowledge:///search?q=api+quota',
                    'knowledge:///search?q=pivot+table',
                  ],
                  supportedKeywords: Object.keys(KEYWORD_MAPPINGS).slice(0, 30),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const results = await searchKnowledge(query);

      // Include fuzzy correction info if applicable
      const fuzzy = findFuzzyMatch(query);
      const fuzzyNote = fuzzy
        ? `Did you mean "${fuzzy.term}"? (edit distance: ${fuzzy.distance})`
        : undefined;

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                query,
                resultCount: results.length,
                ...(fuzzyNote && { suggestion: fuzzyNote }),
                results: results.map((r) => ({
                  uri: r.uri,
                  name: r.name,
                  category: r.category,
                  description: r.description,
                  relevanceScore: r.score,
                  matchType: r.matchType,
                })),
                note:
                  results.length === 0
                    ? 'No matches found. Try different keywords or browse knowledge:///index for all files.'
                    : 'Results sorted by relevance. Use uri to read the full file.',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
