/**
 * Formula Intelligence Helpers
 *
 * Provides advanced formula analysis capabilities:
 * - Volatile formula detection (NOW, TODAY, RAND)
 * - Full column reference detection (A:A)
 * - Formula complexity scoring
 * - Circular reference detection
 * - INDIRECT/OFFSET usage detection
 * - Array formula analysis
 * - Broken reference detection
 * - Formula optimization suggestions
 *
 * Part of Ultimate Analysis Tool - Formula Intelligence capability
 */

// ============================================================================
// Formula Pattern Library
// ============================================================================

/**
 * A reusable formula pattern with template, example, and keyword metadata.
 */
export interface FormulaPattern {
  key: string;
  template: string; // formula with {param} substitution tokens
  example: string; // concrete working example
  keywords: string[]; // for matching to user requests
  description: string;
}

/**
 * Library of common Google Sheets formula patterns indexed by key.
 * Used by generate_formula to inject relevant examples into the sampling prompt.
 */
export const FORMULA_PATTERN_LIBRARY: Record<string, FormulaPattern> = {
  xlookup: {
    key: 'xlookup',
    template: '=IFERROR(XLOOKUP({key}, {lookup_range}, {return_range}, ""), "")',
    example: '=IFERROR(XLOOKUP(A2, Products!A:A, Products!C:C, ""), "")',
    keywords: ['lookup', 'find', 'match', 'vlookup', 'search', 'retrieve'],
    description:
      'Look up a value in one range and return a value from another range. Prefer over VLOOKUP.',
  },
  filter_rows: {
    key: 'filter_rows',
    template: '=FILTER({range}, {condition_column}="{value}")',
    example: '=FILTER(A2:E100, C2:C100="Active")',
    keywords: ['filter', 'show only', 'where', 'condition', 'active', 'dynamic'],
    description: 'Return only rows matching a condition. Result spills dynamically.',
  },
  sort_filter: {
    key: 'sort_filter',
    template: '=SORT(FILTER({range}, {condition}), {sort_col_idx}, {ascending})',
    example: '=SORT(FILTER(A2:D100, D2:D100>1000), 4, FALSE)',
    keywords: ['sort', 'filter', 'order', 'top', 'ranked'],
    description: 'Filter rows by condition then sort the results.',
  },
  unique_list: {
    key: 'unique_list',
    template: '=UNIQUE({column_range})',
    example: '=UNIQUE(B2:B100)',
    keywords: ['unique', 'distinct', 'list', 'deduplicate', 'categories'],
    description: 'Return unique values from a range. Spills vertically.',
  },
  sequence_months: {
    key: 'sequence_months',
    template: '=TEXT(DATE({year}, SEQUENCE(1,12), 1), "MMM")',
    example: '=TEXT(DATE(2026, SEQUENCE(1,12), 1), "MMM")',
    keywords: ['months', 'header', 'january', 'calendar', 'sequence'],
    description: 'Generate 12 month names as a horizontal row.',
  },
  yoy_variance: {
    key: 'yoy_variance',
    template: '=IFERROR(({current}-{prior})/ABS({prior}), 0)',
    example: '=IFERROR((B2-C2)/ABS(C2), 0)',
    keywords: ['year over year', 'yoy', 'variance', 'growth', 'change', 'delta', 'percent change'],
    description: 'Calculate year-over-year percentage change. Handles zero prior values.',
  },
  sumifs_multi: {
    key: 'sumifs_multi',
    template:
      '=SUMIFS({sum_range}, {criteria_range1}, {criteria1}, {criteria_range2}, {criteria2})',
    example: '=SUMIFS(D:D, B:B, "Widget", C:C, "Q1")',
    keywords: ['sum if', 'sumif', 'conditional sum', 'multiple criteria', 'filter sum'],
    description: 'Sum values meeting multiple conditions simultaneously.',
  },
  running_total: {
    key: 'running_total',
    template: '=SUM($B$2:B{row})',
    example: '=SUM($B$2:B2) — drag down to extend the running total',
    keywords: ['running total', 'cumulative', 'cumulative sum', 'running sum'],
    description: 'Cumulative sum that grows as you drag the formula down.',
  },
  arrayformula_margin: {
    key: 'arrayformula_margin',
    template: '=ARRAYFORMULA(IF({revenue_col}<>"", ({revenue_col}-{cost_col})/{revenue_col}, ""))',
    example: '=ARRAYFORMULA(IF(B2:B<>"", (B2:B-C2:C)/B2:B, ""))',
    keywords: ['arrayformula', 'whole column', 'margin', 'auto-fill', 'bulk'],
    description: 'Apply margin calculation to entire column without dragging. Skips empty rows.',
  },
  ifs_classifier: {
    key: 'ifs_classifier',
    template:
      '=IFS({val}>={threshold1}, "{label1}", {val}>={threshold2}, "{label2}", TRUE, "{default}")',
    example: '=IFS(B2>=90,"A", B2>=80,"B", B2>=70,"C", TRUE,"F")',
    keywords: ['grade', 'classify', 'tier', 'category', 'if else', 'ifs', 'bucket'],
    description: 'Multi-condition classifier without nesting IFs. Cleaner than nested IF().',
  },
};

/**
 * Return up to 5 formula patterns most relevant to the given keywords.
 * Scoring is based on how many pattern keywords overlap with the query keywords.
 */
export function getRelevantPatterns(keywords: string[]): FormulaPattern[] {
  const normalizedKeywords = keywords.map((k) => k.toLowerCase());
  const scored = Object.values(FORMULA_PATTERN_LIBRARY).map((pattern) => {
    const score = pattern.keywords.filter((kw) =>
      normalizedKeywords.some((nk) => nk.includes(kw) || kw.includes(nk))
    ).length;
    return { pattern, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.pattern);
}

/**
 * Tokenize a description string into lowercase keywords, filtering stop words.
 * Used to extract search terms from generate_formula description input.
 */
export function extractFormulaKeywords(description: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'the',
    'for',
    'of',
    'in',
    'to',
    'that',
    'with',
    'from',
    'and',
    'or',
  ]);
  return description
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Basic structural validation for a Google Sheets formula string.
 * Checks for balanced parentheses and that the formula starts with '='.
 * Returns `{ valid: true }` on success or `{ valid: false, issue: string }` on failure.
 * Used by sheet-generator to skip malformed AI-generated formulas before writing.
 */
export function validateFormulaStructure(formula: string): { valid: boolean; issue?: string } {
  if (!formula || typeof formula !== 'string') {
    return { valid: false, issue: 'Formula is empty or not a string' };
  }
  const trimmed = formula.trim();
  if (!trimmed.startsWith('=')) {
    return { valid: false, issue: 'Formula must start with =' };
  }
  // Check balanced parentheses
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inString) {
      if (ch === stringChar) inString = false;
    } else if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth < 0) {
        return { valid: false, issue: 'Unbalanced parentheses: unexpected closing )' };
      }
    }
  }
  if (depth !== 0) {
    return {
      valid: false,
      issue: `Unbalanced parentheses: ${depth} unclosed opening parenthesis(es)`,
    };
  }
  return { valid: true };
}

// ============================================================================
// Modern Google Sheets Function Registry
// ============================================================================

/**
 * Registry of modern Google Sheets functions (Lambda, Dynamic Arrays, Modern Lookups)
 * Supports recognition, validation, and explanation.
 */
export const MODERN_FUNCTION_REGISTRY: Record<
  string,
  {
    minArgs: number;
    maxArgs: number;
    description: string;
    category: 'lambda' | 'dynamic_array' | 'lookup' | 'utility';
    introduced?: string; // Approximate date introduced
    volatility?: 'volatile' | 'stable';
  }
> = {
  LAMBDA: {
    minArgs: 2,
    maxArgs: 253,
    description: 'Creates a custom function with named parameters',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  LET: {
    minArgs: 3,
    maxArgs: 253,
    description: 'Assigns names to values for reuse throughout a formula',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  MAP: {
    minArgs: 2,
    maxArgs: 253,
    description: 'Applies a LAMBDA function to each value in one or more arrays',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  REDUCE: {
    minArgs: 3,
    maxArgs: 3,
    description: 'Reduces an array to a single accumulated value using a LAMBDA function',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  SCAN: {
    minArgs: 3,
    maxArgs: 3,
    description: 'Scans an array and produces intermediate results using a LAMBDA function',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  MAKEARRAY: {
    minArgs: 3,
    maxArgs: 3,
    description: 'Creates an array of specified dimensions using a LAMBDA function',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  BYROW: {
    minArgs: 2,
    maxArgs: 2,
    description: 'Applies a LAMBDA function to each row of a range and returns an array',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  BYCOL: {
    minArgs: 2,
    maxArgs: 2,
    description: 'Applies a LAMBDA function to each column of a range and returns an array',
    category: 'lambda',
    introduced: '2021',
    volatility: 'stable',
  },
  XLOOKUP: {
    minArgs: 3,
    maxArgs: 6,
    description:
      'Searches a range and returns a matching item. Modern replacement for VLOOKUP/HLOOKUP',
    category: 'lookup',
    introduced: '2019',
    volatility: 'stable',
  },
  XMATCH: {
    minArgs: 2,
    maxArgs: 4,
    description:
      'Returns the relative position of a value in a range. Modern replacement for MATCH',
    category: 'lookup',
    introduced: '2019',
    volatility: 'stable',
  },
  FILTER: {
    minArgs: 2,
    maxArgs: 3,
    description:
      'Filter a range based on a boolean condition array. Returns only rows/columns where the condition is TRUE.',
    category: 'dynamic_array',
    introduced: '2023',
    volatility: 'stable',
  },
  SORT: {
    minArgs: 1,
    maxArgs: 4,
    description:
      'Sort rows of a range by specified columns. Supports ascending/descending and multi-column sort.',
    category: 'dynamic_array',
    introduced: '2023',
    volatility: 'stable',
  },
  SORTBY: {
    minArgs: 2,
    maxArgs: 6,
    description:
      'Sort a range by corresponding values in another range. More flexible than SORT for complex ordering.',
    category: 'dynamic_array',
    introduced: '2023',
    volatility: 'stable',
  },
  SEQUENCE: {
    minArgs: 1,
    maxArgs: 4,
    description:
      'Generate a sequence of numbers arranged in rows and columns. Parameters: rows, columns, start, step.',
    category: 'dynamic_array',
    introduced: '2023',
    volatility: 'stable',
  },
};

// ============================================================================
// Type Definitions
// ============================================================================

export interface VolatileFormula {
  cell: string;
  formula: string;
  volatileFunctions: string[];
  impact: 'low' | 'medium' | 'high';
  suggestion: string;
}

export interface FullColumnReference {
  cell: string;
  formula: string;
  references: string[]; // e.g., ["A:A", "B:B"]
  impact: 'low' | 'medium' | 'high';
  suggestion: string;
}

export interface FormulaComplexity {
  cell: string;
  formula: string;
  score: number; // 0-100
  metrics: {
    functionCount: number;
    nestedLevels: number;
    referenceCount: number;
    operators: number;
    length: number;
  };
  category: 'simple' | 'moderate' | 'complex' | 'very_complex';
  suggestions: string[];
}

export interface CircularReference {
  cells: string[];
  chain: string; // e.g., "A1 -> B1 -> C1 -> A1"
  severity: 'warning' | 'error';
}

export interface IndirectUsage {
  cell: string;
  formula: string;
  function: 'INDIRECT' | 'OFFSET';
  impact: 'low' | 'medium' | 'high';
  reasoning: string;
  suggestion: string;
}

export interface ArrayFormula {
  range: string;
  formula: string;
  inputRows: number;
  inputCols: number;
  outputRows: number;
  outputCols: number;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface BrokenReference {
  cell: string;
  formula: string;
  brokenRefs: string[];
  errorType:
    | '#REF!'
    | '#NAME?'
    | '#VALUE!'
    | '#DIV/0!'
    | '#N/A'
    | '#NULL!'
    | '#NUM!'
    | '#ERROR!'
    | 'MISSING_SHEET';
  suggestion: string;
}

/**
 * Formula error detected from cell evaluation
 * This captures errors that appear in cell VALUES, not just formula text
 */
export interface FormulaError {
  cell: string;
  formula: string;
  errorType: '#REF!' | '#NAME?' | '#VALUE!' | '#DIV/0!' | '#N/A' | '#NULL!' | '#NUM!' | '#ERROR!';
  errorValue: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestion: string;
  possibleCauses: string[];
}

/**
 * Summary of formula health for a spreadsheet
 */
export interface FormulaHealthSummary {
  totalFormulas: number;
  healthyFormulas: number;
  errorCount: number;
  errorsByType: Record<string, number>;
  criticalErrors: FormulaError[];
  healthScore: number; // 0-100
}

export interface OptimizationSuggestion {
  type:
    | 'VLOOKUP_TO_INDEX_MATCH'
    | 'SUMIF_TO_SUMIFS'
    | 'REMOVE_VOLATILE'
    | 'SIMPLIFY_NESTED'
    | 'USE_NAMED_RANGE'
    | 'ARRAY_FORMULA';
  priority: 'low' | 'medium' | 'high';
  affectedCells: string[];
  currentFormula: string;
  suggestedFormula: string;
  reasoning: string;
  estimatedSpeedup: string;
}

// ============================================================================
// Modern Function Validation
// ============================================================================

/**
 * Validate a function call against modern Google Sheets function registry
 * Returns error details if validation fails, null if valid
 */
export function validateModernFunction(
  functionName: string,
  argCount: number
): { valid: boolean; error?: string } {
  const upper = functionName.toUpperCase();
  const spec = MODERN_FUNCTION_REGISTRY[upper];

  if (!spec) {
    return { valid: true }; // Not a modern function, don't validate
  }

  if (argCount < spec.minArgs) {
    return {
      valid: false,
      error: `${upper} requires at least ${spec.minArgs} argument(s), got ${argCount}`,
    };
  }

  if (argCount > spec.maxArgs) {
    return {
      valid: false,
      error: `${upper} accepts at most ${spec.maxArgs} argument(s), got ${argCount}`,
    };
  }

  return { valid: true };
}

/**
 * Check if a function is a modern Google Sheets function
 */
export function isModernFunction(functionName: string): boolean {
  return functionName.toUpperCase() in MODERN_FUNCTION_REGISTRY;
}

/**
 * Get metadata for a modern function
 */
export function getModernFunctionInfo(
  functionName: string
): (typeof MODERN_FUNCTION_REGISTRY)[keyof typeof MODERN_FUNCTION_REGISTRY] | null {
  return MODERN_FUNCTION_REGISTRY[functionName.toUpperCase()] ?? null;
}

/**
 * Count modern function usage in a formula
 */
export function countModernFunctions(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const functionPattern = /\b([A-Z_]+)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = functionPattern.exec(formula)) !== null) {
    const fnName = match[1] ?? '';
    if (isModernFunction(fnName)) {
      counts[fnName] = (counts[fnName] ?? 0) + 1;
    }
  }

  return counts;
}

// ============================================================================
// Volatile Formula Detection
// ============================================================================

/**
 * Detect formulas using volatile functions
 *
 * Volatile functions recalculate on every change, even if their inputs haven't changed.
 * Common volatile functions: NOW, TODAY, RAND, RANDBETWEEN, INDIRECT, OFFSET
 */
export function findVolatileFormulas(
  formulas: Array<{ cell: string; formula: string }>
): VolatileFormula[] {
  const volatileFunctions = ['NOW', 'TODAY', 'RAND', 'RANDBETWEEN', 'INDIRECT', 'OFFSET', 'INFO'];

  const volatileFormulas: VolatileFormula[] = [];

  for (const { cell, formula } of formulas) {
    const upperFormula = formula.toUpperCase();
    const foundVolatile = volatileFunctions.filter((fn) =>
      new RegExp(`\\b${fn}\\s*\\(`).test(upperFormula)
    );

    if (foundVolatile.length > 0) {
      // Determine impact based on how many volatile functions
      let impact: 'low' | 'medium' | 'high' = 'low';
      if (foundVolatile.length >= 3) impact = 'high';
      else if (foundVolatile.length === 2) impact = 'medium';

      // Generate suggestion
      let suggestion = '';
      if (foundVolatile.includes('NOW') || foundVolatile.includes('TODAY')) {
        suggestion =
          'Consider calculating these once in a helper cell and referencing that cell instead.';
      } else if (foundVolatile.includes('RAND') || foundVolatile.includes('RANDBETWEEN')) {
        suggestion =
          'Random functions are inherently volatile. Use sparingly or calculate once and copy values.';
      } else if (foundVolatile.includes('INDIRECT') || foundVolatile.includes('OFFSET')) {
        suggestion =
          'INDIRECT and OFFSET are volatile. Consider using INDEX/MATCH or direct references when possible.';
      }

      volatileFormulas.push({
        cell,
        formula,
        volatileFunctions: foundVolatile,
        impact,
        suggestion,
      });
    }
  }

  return volatileFormulas;
}

// ============================================================================
// Full Column Reference Detection
// ============================================================================

/**
 * Detect formulas using full column references (A:A, B:B, etc.)
 *
 * Full column references can cause performance issues on large sheets.
 */
export function findFullColumnRefs(
  formulas: Array<{ cell: string; formula: string }>
): FullColumnReference[] {
  const fullColumnRefs: FullColumnReference[] = [];
  const columnRefPattern = /\b([A-Z]{1,3}):([A-Z]{1,3})\b/g;

  for (const { cell, formula } of formulas) {
    const matches = Array.from(formula.matchAll(columnRefPattern));
    const references = matches
      .filter((m) => m[1] === m[2]) // Same column (A:A, not A:B)
      .map((m) => m[0]);

    if (references.length > 0) {
      // Determine impact
      let impact: 'low' | 'medium' | 'high' = 'low';
      if (references.length >= 3) impact = 'high';
      else if (references.length === 2) impact = 'medium';

      fullColumnRefs.push({
        cell,
        formula,
        references,
        impact,
        suggestion:
          'Replace full column references with specific ranges (e.g., A1:A1000) to improve performance.',
      });
    }
  }

  return fullColumnRefs;
}

// ============================================================================
// Formula Complexity Scoring
// ============================================================================

/**
 * Score formula complexity on a scale of 0-100
 *
 * Factors:
 * - Function count
 * - Nesting depth
 * - Number of cell references
 * - Number of operators
 * - Overall length
 */
export function scoreFormulaComplexity(formula: string): number {
  let score = 0;

  // Count functions
  const functionPattern = /\b[A-Z_]+\s*\(/g;
  const functions = formula.match(functionPattern) || [];
  score += Math.min(functions.length * 5, 30);

  // Count nesting depth
  let maxDepth = 0;
  let currentDepth = 0;
  for (const char of formula) {
    if (char === '(') currentDepth++;
    if (char === ')') currentDepth--;
    maxDepth = Math.max(maxDepth, currentDepth);
  }
  score += Math.min(maxDepth * 10, 30);

  // Count cell references
  const cellRefPattern = /\b[A-Z]{1,3}[0-9]{1,7}\b/g;
  const cellRefs = formula.match(cellRefPattern) || [];
  score += Math.min(cellRefs.length * 2, 20);

  // Count operators
  const operators = ['+', '-', '*', '/', '^', '&', '<', '>', '='];
  const operatorCount = operators.reduce((count, op) => count + (formula.split(op).length - 1), 0);
  score += Math.min(operatorCount * 2, 10);

  // Length
  score += Math.min(formula.length / 10, 10);

  return Math.min(score, 100);
}

/**
 * Analyze formula complexity with detailed metrics
 */
export function analyzeFormulaComplexity(cell: string, formula: string): FormulaComplexity {
  const score = scoreFormulaComplexity(formula);

  // Extract metrics
  const functionPattern = /\b[A-Z_]+\s*\(/g;
  const functions = formula.match(functionPattern) || [];
  const functionCount = functions.length;

  let maxDepth = 0;
  let currentDepth = 0;
  for (const char of formula) {
    if (char === '(') currentDepth++;
    if (char === ')') currentDepth--;
    maxDepth = Math.max(maxDepth, currentDepth);
  }

  const cellRefPattern = /\b[A-Z]{1,3}[0-9]{1,7}\b/g;
  const cellRefs = formula.match(cellRefPattern) || [];
  const referenceCount = cellRefs.length;

  const operators = ['+', '-', '*', '/', '^', '&', '<', '>', '='];
  const operatorCount = operators.reduce((count, op) => count + (formula.split(op).length - 1), 0);

  // Categorize
  let category: FormulaComplexity['category'] = 'simple';
  if (score > 70) category = 'very_complex';
  else if (score > 50) category = 'complex';
  else if (score > 30) category = 'moderate';

  // Generate suggestions
  const suggestions: string[] = [];
  if (functionCount > 5) {
    suggestions.push('Consider breaking down into multiple helper cells');
  }
  if (maxDepth > 4) {
    suggestions.push('High nesting depth - simplify logic where possible');
  }
  if (referenceCount > 10) {
    suggestions.push('Many cell references - consider using named ranges');
  }
  if (formula.length > 200) {
    suggestions.push('Very long formula - break into intermediate calculations');
  }

  // Check for modern function usage
  const modernFuncs = countModernFunctions(formula);
  if (Object.keys(modernFuncs).length > 0) {
    const modernList = Object.keys(modernFuncs).join(', ');
    suggestions.push(
      `Using modern functions (${modernList}) - ensure Google Sheets version is current`
    );
  }

  return {
    cell,
    formula,
    score: Math.round(score),
    metrics: {
      functionCount,
      nestedLevels: maxDepth,
      referenceCount,
      operators: operatorCount,
      length: formula.length,
    },
    category,
    suggestions,
  };
}

// ============================================================================
// Circular Reference Detection
// ============================================================================

/**
 * Detect circular references in formulas
 *
 * Note: This is a simplified version. Full detection requires dependency graph.
 */
export function detectCircularRefs(
  formulas: Array<{ cell: string; formula: string }>
): CircularReference[] {
  const circularRefs: CircularReference[] = [];
  const cellRefPattern = /\b([A-Z]{1,3}[0-9]{1,7})\b/g;

  // Build dependency graph
  const dependencies = new Map<string, Set<string>>();

  for (const { cell, formula } of formulas) {
    const refs = Array.from(formula.matchAll(cellRefPattern))
      .map((m) => m[1])
      .filter((ref): ref is string => ref !== undefined);
    dependencies.set(cell, new Set(refs));
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycle(node: string, path: string[]): boolean {
    if (recStack.has(node)) {
      // Found cycle
      const cycleStart = path.indexOf(node);
      const cyclePath = path.slice(cycleStart).concat(node);
      circularRefs.push({
        cells: cyclePath,
        chain: cyclePath.join(' -> '),
        severity: 'error',
      });
      return true;
    }

    if (visited.has(node)) return false;

    visited.add(node);
    recStack.add(node);
    path.push(node);

    const deps = dependencies.get(node);
    if (deps) {
      deps.forEach((dep) => {
        if (hasCycle(dep, [...path])) {
          // Continue to find all cycles
        }
      });
    }

    recStack.delete(node);
    return false;
  }

  dependencies.forEach((_, cell) => {
    if (!visited.has(cell)) {
      hasCycle(cell, []);
    }
  });

  return circularRefs;
}

// ============================================================================
// INDIRECT/OFFSET Detection
// ============================================================================

/**
 * Detect usage of INDIRECT and OFFSET functions
 */
export function findIndirectUsage(
  formulas: Array<{ cell: string; formula: string }>
): IndirectUsage[] {
  const indirectUsage: IndirectUsage[] = [];

  for (const { cell, formula } of formulas) {
    const upperFormula = formula.toUpperCase();

    // Check for INDIRECT
    if (/\bINDIRECT\s*\(/.test(upperFormula)) {
      const complexity = scoreFormulaComplexity(formula);
      const impact: 'low' | 'medium' | 'high' =
        complexity > 50 ? 'high' : complexity > 30 ? 'medium' : 'low';

      indirectUsage.push({
        cell,
        formula,
        function: 'INDIRECT',
        impact,
        reasoning: 'INDIRECT is volatile and cannot be optimized by the calculation engine',
        suggestion: 'Consider using INDEX/MATCH or direct cell references when possible',
      });
    }

    // Check for OFFSET
    if (/\bOFFSET\s*\(/.test(upperFormula)) {
      const complexity = scoreFormulaComplexity(formula);
      const impact: 'low' | 'medium' | 'high' =
        complexity > 50 ? 'high' : complexity > 30 ? 'medium' : 'low';

      indirectUsage.push({
        cell,
        formula,
        function: 'OFFSET',
        impact,
        reasoning: 'OFFSET is volatile and recalculates on every change',
        suggestion: 'Consider using INDEX with dynamic ranges or named ranges',
      });
    }
  }

  return indirectUsage;
}

// ============================================================================
// Array Formula Analysis
// ============================================================================

/**
 * Analyze array formulas
 */
export function findArrayFormulas(
  formulas: Array<{ cell: string; formula: string; isArrayFormula?: boolean }>
): ArrayFormula[] {
  const arrayFormulas: ArrayFormula[] = [];

  for (const { cell, formula, isArrayFormula } of formulas) {
    if (isArrayFormula || (formula.startsWith('{') && formula.endsWith('}'))) {
      // Parse range from cell (e.g., "A1:B10")
      const rangeMatch = cell.match(/([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)/);
      if (rangeMatch && rangeMatch[1] && rangeMatch[2] && rangeMatch[3] && rangeMatch[4]) {
        const [, startCol, startRow, endCol, endRow] = rangeMatch;
        const outputRows = parseInt(endRow) - parseInt(startRow) + 1;
        const outputCols = endCol.charCodeAt(0) - startCol.charCodeAt(0) + 1;

        const complexity = scoreFormulaComplexity(formula);
        const complexityCategory: 'simple' | 'moderate' | 'complex' =
          complexity > 50 ? 'complex' : complexity > 30 ? 'moderate' : 'simple';

        arrayFormulas.push({
          range: cell,
          formula,
          inputRows: 0, // Would need more context
          inputCols: 0,
          outputRows,
          outputCols,
          complexity: complexityCategory,
        });
      }
    }
  }

  return arrayFormulas;
}

// ============================================================================
// Broken Reference Detection
// ============================================================================

/**
 * Detect broken references in formulas
 */
export function findOrphanedRefs(
  formulas: Array<{ cell: string; formula: string }>,
  validSheets: string[]
): BrokenReference[] {
  const brokenRefs: BrokenReference[] = [];

  const sheetRefPattern = /\b([A-Za-z0-9\s_]+)![A-Z]{1,3}[0-9]{1,7}\b/g;

  for (const { cell, formula } of formulas) {
    // Check for #REF! errors
    if (formula.includes('#REF!')) {
      brokenRefs.push({
        cell,
        formula,
        brokenRefs: ['#REF!'],
        errorType: '#REF!',
        suggestion: 'Cell or range was deleted. Update formula with correct reference.',
      });
      continue;
    }

    // Check for missing sheets
    const sheetRefs = Array.from(formula.matchAll(sheetRefPattern));
    const missingSheets = sheetRefs
      .map((m) => m[1])
      .filter((sheet): sheet is string => sheet !== undefined && !validSheets.includes(sheet));

    if (missingSheets.length > 0) {
      brokenRefs.push({
        cell,
        formula,
        brokenRefs: missingSheets,
        errorType: 'MISSING_SHEET',
        suggestion: `Referenced sheets not found: ${missingSheets.join(', ')}. Check sheet names.`,
      });
    }
  }

  return brokenRefs;
}

// ============================================================================
// Optimization Suggestions
// ============================================================================

/**
 * Generate optimization suggestions for formulas
 */
export function generateOptimizations(
  formulas: Array<{ cell: string; formula: string }>
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  for (const { cell, formula } of formulas) {
    const upperFormula = formula.toUpperCase();

    // VLOOKUP to INDEX/MATCH
    if (/\bVLOOKUP\s*\(/.test(upperFormula)) {
      suggestions.push({
        type: 'VLOOKUP_TO_INDEX_MATCH',
        priority: 'medium',
        affectedCells: [cell],
        currentFormula: formula,
        suggestedFormula: 'INDEX(return_range, MATCH(lookup_value, lookup_range, 0))',
        reasoning: 'INDEX/MATCH is more flexible and faster than VLOOKUP for large datasets',
        estimatedSpeedup: '20-50% faster',
      });
    }

    // SUMIF to SUMIFS (when multiple conditions detected)
    if (/\bSUMIF\s*\(/.test(upperFormula) && formula.split('IF').length > 2) {
      suggestions.push({
        type: 'SUMIF_TO_SUMIFS',
        priority: 'low',
        affectedCells: [cell],
        currentFormula: formula,
        suggestedFormula: 'SUMIFS(sum_range, criteria_range1, criterion1, ...)',
        reasoning: 'SUMIFS is designed for multiple criteria and is more readable',
        estimatedSpeedup: 'Slightly faster, more maintainable',
      });
    }
  }

  return suggestions;
}

// ============================================================================
// Formula Upgrade Detection
// ============================================================================

export interface FormulaUpgrade {
  cell: string;
  currentFormula: string;
  suggestedFormula: string;
  pattern: string;
  reason: string;
  confidence: number;
  executable: {
    tool: string;
    action: string;
    params: { spreadsheetId: string; range: string; values: string[][] };
  };
}

/**
 * Detect formulas that can be upgraded to modern Google Sheets functions.
 * Returns executable suggestions with ready-to-dispatch params.
 */
export function detectFormulaUpgrades(
  formulas: Array<{ cell: string; formula: string }>,
  spreadsheetId: string
): FormulaUpgrade[] {
  const upgrades: FormulaUpgrade[] = [];

  for (const { cell, formula } of formulas) {
    const upper = formula.toUpperCase();

    // 1. IF(ISNA(VLOOKUP(...))) → IFNA(XLOOKUP(...))
    if (/\bIF\s*\(\s*ISNA\s*\(\s*VLOOKUP/.test(upper)) {
      upgrades.push({
        cell,
        currentFormula: formula,
        suggestedFormula: formula.replace(
          /IF\s*\(\s*ISNA\s*\(\s*(VLOOKUP\([^)]+\))\s*\)\s*,\s*([^,]+)\s*,\s*\1\s*\)/i,
          'IFNA(XLOOKUP($2), $3)'
        ),
        pattern: 'IF_ISNA_VLOOKUP_TO_IFNA_XLOOKUP',
        reason: 'IFNA(XLOOKUP(...)) is cleaner — XLOOKUP handles errors natively without wrapping',
        confidence: 0.9,
        executable: {
          tool: 'sheets_data',
          action: 'write',
          params: { spreadsheetId, range: cell, values: [[`=IFNA(XLOOKUP(...), default_value)`]] },
        },
      });
    }
    // 2. Plain VLOOKUP → XLOOKUP
    else if (/\bVLOOKUP\s*\(/.test(upper) && !/\bXLOOKUP/.test(upper)) {
      upgrades.push({
        cell,
        currentFormula: formula,
        suggestedFormula: '=XLOOKUP(lookup_value, lookup_range, result_range, default)',
        pattern: 'VLOOKUP_TO_XLOOKUP',
        reason:
          'XLOOKUP supports bidirectional search, handles errors natively, and does not require sorted data',
        confidence: 0.85,
        executable: {
          tool: 'sheets_data',
          action: 'write',
          params: { spreadsheetId, range: cell, values: [['=XLOOKUP(...)']] },
        },
      });
    }

    // 3. Deeply nested IF → IFS
    const ifMatches = upper.match(/\bIF\s*\(/g);
    if (ifMatches && ifMatches.length >= 3) {
      upgrades.push({
        cell,
        currentFormula: formula,
        suggestedFormula: '=IFS(condition1, value1, condition2, value2, ...)',
        pattern: 'NESTED_IF_TO_IFS',
        reason: `${ifMatches.length} nested IF levels detected — IFS is flatter, easier to read and maintain`,
        confidence: 0.8,
        executable: {
          tool: 'sheets_data',
          action: 'write',
          params: { spreadsheetId, range: cell, values: [['=IFS(...)']] },
        },
      });
    }

    // 4. ARRAYFORMULA wrapping simple filter/unique patterns → native array functions
    if (/\bARRAYFORMULA\s*\(/.test(upper)) {
      if (/\bIF\s*\(.*,\s*[A-Z]+\d*:\s*[A-Z]+\d*/.test(upper)) {
        upgrades.push({
          cell,
          currentFormula: formula,
          suggestedFormula: '=FILTER(range, condition)',
          pattern: 'ARRAYFORMULA_IF_TO_FILTER',
          reason:
            'FILTER is a native array function — no ARRAYFORMULA wrapper needed, better performance',
          confidence: 0.75,
          executable: {
            tool: 'sheets_data',
            action: 'write',
            params: { spreadsheetId, range: cell, values: [['=FILTER(...)']] },
          },
        });
      }
    }

    // 5. INDIRECT/OFFSET → flag as volatile with non-volatile alternative
    if (/\bINDIRECT\s*\(/.test(upper)) {
      upgrades.push({
        cell,
        currentFormula: formula,
        suggestedFormula: 'Use INDEX with named ranges instead of INDIRECT',
        pattern: 'INDIRECT_VOLATILE',
        reason:
          'INDIRECT is volatile — recalculates on every edit. INDEX with named ranges is non-volatile and faster',
        confidence: 0.7,
        executable: {
          tool: 'sheets_data',
          action: 'write',
          params: { spreadsheetId, range: cell, values: [['=INDEX(...)']] },
        },
      });
    }
    if (/\bOFFSET\s*\(/.test(upper)) {
      upgrades.push({
        cell,
        currentFormula: formula,
        suggestedFormula: 'Use INDEX with calculated row/col instead of OFFSET',
        pattern: 'OFFSET_VOLATILE',
        reason:
          'OFFSET is volatile — recalculates on every edit. INDEX is non-volatile and produces same results',
        confidence: 0.7,
        executable: {
          tool: 'sheets_data',
          action: 'write',
          params: { spreadsheetId, range: cell, values: [['=INDEX(...)']] },
        },
      });
    }
  }

  return upgrades;
}

// ============================================================================
// Formula Error Detection (from cell VALUES, not just formula text)
// ============================================================================

/**
 * All Google Sheets error types
 */
const SHEET_ERROR_TYPES = [
  '#REF!',
  '#NAME?',
  '#VALUE!',
  '#DIV/0!',
  '#N/A',
  '#NULL!',
  '#NUM!',
  '#ERROR!',
] as const;

type SheetErrorType = (typeof SHEET_ERROR_TYPES)[number];

/**
 * Error metadata for generating helpful suggestions
 */
const ERROR_METADATA: Record<
  SheetErrorType,
  {
    severity: 'critical' | 'high' | 'medium' | 'low';
    suggestion: string;
    possibleCauses: string[];
  }
> = {
  '#REF!': {
    severity: 'critical',
    suggestion:
      'A referenced cell, range, or sheet was deleted. Update the formula with valid references.',
    possibleCauses: [
      'Referenced cell or range was deleted',
      'Referenced sheet was deleted or renamed',
      'Copy/paste operation broke relative references',
      'Row or column containing referenced cells was deleted',
    ],
  },
  '#NAME?': {
    severity: 'high',
    suggestion: 'Check for typos in function names, named ranges, or missing quotes around text.',
    possibleCauses: [
      'Misspelled function name (e.g., SUMM instead of SUM)',
      'Named range does not exist',
      'Text value missing quotes',
      'Add-on function not available',
    ],
  },
  '#VALUE!': {
    severity: 'medium',
    suggestion: 'Check that the data types match what the formula expects (numbers vs text).',
    possibleCauses: [
      'Text value where number expected',
      'Array formula returning wrong dimensions',
      'Date/time format mismatch',
      'Incompatible operand types',
    ],
  },
  '#DIV/0!': {
    severity: 'medium',
    suggestion:
      'The formula is dividing by zero or an empty cell. Add error handling with IFERROR.',
    possibleCauses: [
      'Dividing by zero explicitly',
      'Dividing by empty cell',
      'AVERAGE of empty range',
      'Divisor cell contains text',
    ],
  },
  '#N/A': {
    severity: 'low',
    suggestion: 'Lookup value not found. Verify the lookup value exists in the search range.',
    possibleCauses: [
      'VLOOKUP/HLOOKUP/MATCH value not found',
      'FILTER returned no results',
      'INDEX out of range',
      'Extra spaces or formatting differences',
    ],
  },
  '#NULL!': {
    severity: 'low',
    suggestion: 'Invalid range intersection. Check for missing operators between ranges.',
    possibleCauses: [
      'Missing comma between arguments',
      'Invalid range intersection operator (space)',
      'Typo in range specification',
    ],
  },
  '#NUM!': {
    severity: 'medium',
    suggestion: 'Invalid numeric value or calculation result too large/small.',
    possibleCauses: [
      'Number too large for Google Sheets',
      'Invalid argument for math function (e.g., SQRT of negative)',
      'IRR or RATE cannot converge',
      'Date calculation resulting in invalid date',
    ],
  },
  '#ERROR!': {
    severity: 'high',
    suggestion: 'Google Sheets cannot parse the formula. Check syntax and function arguments.',
    possibleCauses: [
      'Formula syntax error',
      'Unsupported function',
      'Invalid characters in formula',
      'Missing required arguments',
    ],
  },
};

/**
 * Detect formula errors from cell values
 *
 * CRITICAL: This function analyzes cell VALUES (what the user sees),
 * not just formula text. A formula like =VLOOKUP(A1, DeletedSheet!A:B, 2)
 * will show #REF! in the cell value even though the formula text itself
 * might not contain #REF!.
 *
 * @param cells Array of cells with formula and evaluated value
 * @returns Array of detected formula errors
 */
export function detectFormulaErrors(
  cells: Array<{
    cell: string;
    formula: string;
    value?: string | number | boolean | null;
    formattedValue?: string;
  }>
): FormulaError[] {
  const errors: FormulaError[] = [];

  for (const { cell, formula, value, formattedValue } of cells) {
    // Check the displayed/formatted value for errors (what user sees)
    const displayValue = formattedValue ?? String(value ?? '');

    for (const errorType of SHEET_ERROR_TYPES) {
      if (displayValue.includes(errorType) || String(value).includes(errorType)) {
        const metadata = ERROR_METADATA[errorType];
        errors.push({
          cell,
          formula,
          errorType,
          errorValue: displayValue,
          severity: metadata.severity,
          suggestion: metadata.suggestion,
          possibleCauses: metadata.possibleCauses,
        });
        break; // Only report first error per cell
      }
    }

    // Also check if formula text itself contains error (embedded #REF!)
    if (!errors.some((e) => e.cell === cell)) {
      for (const errorType of SHEET_ERROR_TYPES) {
        if (formula.includes(errorType)) {
          const metadata = ERROR_METADATA[errorType];
          errors.push({
            cell,
            formula,
            errorType,
            errorValue: formula,
            severity: metadata.severity,
            suggestion: metadata.suggestion,
            possibleCauses: metadata.possibleCauses,
          });
          break;
        }
      }
    }
  }

  return errors;
}

/**
 * Calculate formula health summary
 *
 * @param totalFormulas Total number of formulas analyzed
 * @param errors Detected formula errors
 * @returns Health summary with score and breakdown
 */
export function calculateFormulaHealth(
  totalFormulas: number,
  errors: FormulaError[]
): FormulaHealthSummary {
  const errorsByType: Record<string, number> = {};

  for (const error of errors) {
    errorsByType[error.errorType] = (errorsByType[error.errorType] || 0) + 1;
  }

  const criticalErrors = errors.filter((e) => e.severity === 'critical');
  const highErrors = errors.filter((e) => e.severity === 'high');

  // Calculate health score:
  // - Start at 100
  // - Critical errors: -10 points each (max -50)
  // - High errors: -5 points each (max -25)
  // - Medium errors: -2 points each (max -15)
  // - Low errors: -1 point each (max -10)
  let healthScore = 100;
  healthScore -= Math.min(50, criticalErrors.length * 10);
  healthScore -= Math.min(25, highErrors.length * 5);
  healthScore -= Math.min(15, errors.filter((e) => e.severity === 'medium').length * 2);
  healthScore -= Math.min(10, errors.filter((e) => e.severity === 'low').length);
  healthScore = Math.max(0, healthScore);

  return {
    totalFormulas,
    healthyFormulas: totalFormulas - errors.length,
    errorCount: errors.length,
    errorsByType,
    criticalErrors,
    healthScore,
  };
}
