/**
 * ServalSheets - Response Compactor
 *
 * Minimizes response size to reduce context window pressure.
 * After ~100 tool calls, Claude's context window fills up causing resets.
 * This compactor reduces response sizes by 50-80%.
 *
 * Features:
 * - Smart array sampling (first-last, evenly-spaced)
 * - Verbosity-aware truncation (respects verbosity:"detailed")
 * - Token-efficient metadata hints
 *
 * @module utils/response-compactor
 */

import { getEnv } from '../config/env.js';

export type SamplingStrategy = 'first-last' | 'evenly-spaced' | 'first-only';

export interface TruncationMetadata {
  totalCount: number;
  truncatedCount: number;
  samplingStrategy: SamplingStrategy;
  hint: string;
}

/**
 * Fields that are always included in compact responses
 */
const ESSENTIAL_FIELDS = new Set(['success', 'action', 'message', 'error', 'authenticated']);

/**
 * Fields that MUST pass through untouched (never truncated/stringified).
 * These are schema-required object fields that break output validation if converted to strings.
 */
const PRESERVED_FIELDS = new Set([
  'spreadsheet', // sheets_core: get, create, copy
  'spreadsheets', // sheets_core: batch_get
  'comprehensiveMetadata', // sheets_core: get_comprehensive
  'formula', // sheets_analyze: generate_formula
  'scout', // sheets_analyze: scout
  'plan', // sheets_analyze: plan
  'operations', // sheets_fix: fix preview
  'pivotTable', // sheets_visualize: pivot_create
  'filter', // sheets_dimensions: get_basic_filter (nested range object)
]);

/**
 * Fields included only if they don't exceed size limits
 *
 * These fields are preserved (with truncation for large arrays) rather than stripped.
 * Includes all common list/array response fields from handlers.
 */
const CONDITIONAL_FIELDS = new Set([
  'values',
  'data',
  'sheets',
  'charts',
  'items',
  'results',
  // List action response fields (BUG FIX 0.1 - preserve list action data arrays)
  'permissions', // sheets_collaborate: share_list
  'comments', // sheets_collaborate: comment_list
  'revisions', // sheets_collaborate: version_list_revisions
  'namedRanges', // sheets_advanced: list_named_ranges
  'protectedRanges', // sheets_advanced: list_protected_ranges
  'filterViews', // sheets_dimensions: list_filter_views
  'valueRanges', // sheets_data: batch_read
  'templates', // sheets_templates: list
  'webhooks', // sheets_webhook: list
  'validations', // sheets_format: list_data_validations
  'conditionalFormats', // sheets_format: rule_list_conditional_formats
  'pivotTables', // sheets_visualize: list_pivot_tables
  'dataSourceTables', // sheets_bigquery: list_connections
  'deployments', // sheets_appsscript: list_deployments
  'versions', // sheets_appsscript: list_versions
  'processes', // sheets_appsscript: list_processes
  // Suggestion/recommendation response fields (BUG FIX 0.4)
  'suggestions', // sheets_visualize: suggest_chart, suggest_pivot
  // New API response fields (2026-02-19)
  'triggers', // sheets_appsscript: list_triggers
  'slicers', // sheets_dimensions: list_slicers
  'tables', // Tables API: list
  'functions', // sheets_advanced: list_named_functions / sheets_appsscript: list_functions
  'scripts', // sheets_appsscript: list
  // smart_append response fields
  'columnsMatched', // sheets_composite: smart_append
  'columnsCreated', // sheets_composite: smart_append
  'columnsSkipped', // sheets_composite: smart_append
]);

/**
 * List action fields that must remain arrays (not wrapped in objects)
 * BUG FIX Phase 0.1: These fields get truncated but keep array structure
 */
const LIST_ACTION_FIELDS = new Set([
  'permissions',
  'comments',
  'revisions',
  'namedRanges',
  'protectedRanges',
  'filterViews',
  'valueRanges',
  'templates',
  'webhooks',
  'validations',
  'conditionalFormats',
  'pivotTables',
  'dataSourceTables',
  'deployments',
  'versions',
  'processes',
  'suggestions',
  'triggers',
  'slicers',
  'tables',
  'functions',
  'scripts',
]);

/**
 * Fields always stripped in compact mode
 */
const STRIPPED_FIELDS = new Set([
  '_meta',
  'costEstimate',
  'quotaImpact',
  'cacheHit',
  'fetchTime',
  'traceId',
  'spanId',
  'requestId',
  'debugInfo',
]);

/**
 * Maximum size for inline arrays before truncation
 * Configurable via MAX_INLINE_CELLS env var. Default 500 cells.
 * Note: Previously was 100 which was too aggressive for typical spreadsheet reads
 * (26 columns = only ~3.8 rows before truncation). Increased to 500 (19 rows at 26 cols).
 */
const MAX_INLINE_ITEMS = parseInt(process.env['MAX_INLINE_CELLS'] || '500', 10);

/**
 * Maximum string length before truncation
 * OPTIMIZATION: Reduced from 500 to 200 for smaller payloads
 */
const MAX_STRING_LENGTH = 200;

/**
 * Whether compact mode is enabled
 * CRITICAL: Enabled by default to prevent context window bloat in Claude Desktop
 * (disabled only if explicitly set to 'false')
 */
export function isCompactModeEnabled(): boolean {
  return getEnv().COMPACT_RESPONSES;
}

/**
 * Check if verbosity override is enabled
 * @param verbosity - Verbosity level from input ('minimal' | 'standard' | 'detailed')
 * @returns True if truncation should be skipped
 */
export function shouldSkipTruncation(verbosity?: string): boolean {
  return verbosity === 'detailed' || !getEnv().COMPACT_RESPONSES;
}

/**
 * Compact a response object to minimize context window usage
 *
 * @param response - The full response object
 * @param options - Compaction options
 * @returns Compacted response with minimal fields
 */
export function compactResponse<T extends Record<string, unknown>>(
  response: T,
  options?: { verbosity?: string }
): T {
  // Skip truncation if verbosity:"detailed" or compact mode disabled
  if (!isCompactModeEnabled() || shouldSkipTruncation(options?.verbosity)) {
    return response;
  }

  // If response has a 'response' wrapper, compact the inner object
  if ('response' in response && typeof response['response'] === 'object') {
    const innerCompact = compactInner(response['response'] as Record<string, unknown>, options);
    const wrappedCompact: Record<string, unknown> = { response: innerCompact };

    // Preserve protocol-level metadata on wrapped MCP results. This differs from
    // handler-level response._meta, which is intentionally compacted separately.
    if ('_meta' in response && typeof response['_meta'] !== 'undefined') {
      wrappedCompact['_meta'] = response['_meta'];
    }

    return wrappedCompact as unknown as T;
  }

  return compactInner(response, options) as unknown as T;
}

/**
 * Compact inner response object
 */
function compactInner(
  response: Record<string, unknown>,
  options?: { verbosity?: string }
): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  const truncatedFields: string[] = [];
  // A6: Explicit truncation hints — field name → human-readable message
  const truncationHints: Record<string, string> = {};

  // Always include essential fields
  for (const field of ESSENTIAL_FIELDS) {
    if (field in response) {
      compact[field] = response[field];
    }
  }

  // Include conditional fields with size limits
  for (const field of CONDITIONAL_FIELDS) {
    if (field in response) {
      const original = response[field];
      const compacted = truncateValue(original, field, options);
      compact[field] = compacted;

      // Track if this field was truncated
      if (compacted !== original && typeof compacted === 'object' && compacted !== null) {
        if (
          Array.isArray(original) &&
          Array.isArray(compacted) &&
          compacted.length < original.length
        ) {
          // List field was truncated to an array slice (LIST_ACTION_FIELDS path)
          truncatedFields.push(`${field}(${original.length} total, showing ${compacted.length})`);
          // A6: Add explicit truncation hint for list fields
          const hidden = original.length - compacted.length;
          truncationHints[field] =
            `${hidden} more ${field} not shown — use verbosity:"detailed" to see all`;
        } else {
          // 2D array or 1D array wrapped into an object with _truncated:true
          const meta = (compacted as Record<string, unknown>)['_truncated'];
          if (meta === true) {
            const total =
              (compacted as Record<string, unknown>)['totalRows'] ??
              ((compacted as Record<string, unknown>)['_meta']
                ? ((compacted as Record<string, unknown>)['_meta'] as Record<string, unknown>)?.[
                    'totalCount'
                  ]
                : undefined);
            truncatedFields.push(total ? `${field}(${total} total)` : field);
            // A6: Add explicit truncation hint for this field
            truncationHints[field] =
              `${total ?? '?'} rows truncated — use verbosity:"detailed" to see all`;
          }
        }
      }
    }
  }

  // Include simple scalar fields not in stripped list
  for (const [key, value] of Object.entries(response)) {
    if (STRIPPED_FIELDS.has(key)) continue;
    if (ESSENTIAL_FIELDS.has(key)) continue;
    if (CONDITIONAL_FIELDS.has(key)) continue;

    // Preserved fields pass through untouched (schema-required objects)
    if (PRESERVED_FIELDS.has(key)) {
      compact[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      compact[key] = truncateArray(value, key, options);
      continue;
    }

    // Include if it's a simple value
    if (isSimpleValue(value)) {
      compact[key] = truncateString(value);
    }
    // Keep object fields schema-compatible instead of collapsing them into strings.
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      compact[key] = truncateObject(value as Record<string, unknown>, options);
    }
  }

  // Add _hint when data was truncated so Claude knows what happened
  if (truncatedFields.length > 0) {
    const hasNextCursor = typeof compact['nextCursor'] === 'string';
    const cursorHint = hasNextCursor
      ? ` Next page: add cursor:"${compact['nextCursor']}" to your request.`
      : '';
    compact['_hint'] =
      `Data truncated: ${truncatedFields.join(', ')}. Use verbosity:"detailed" for full data.${cursorHint}`;
  }

  // A6: Inject _truncated key when any field was truncated (explicit hints for LLM)
  if (Object.keys(truncationHints).length > 0) {
    compact['_truncated'] = truncationHints;
  }

  // Add pagination hint even when no truncation occurred
  if (
    !compact['_hint'] &&
    compact['hasMore'] === true &&
    typeof compact['nextCursor'] === 'string'
  ) {
    compact['_hint'] =
      `More data available. Next page: add cursor:"${compact['nextCursor']}" to your request.`;
  }

  return compact;
}

/**
 * Truncate a value based on its type
 */
function truncateValue(
  value: unknown,
  fieldName: string,
  options?: { verbosity?: string }
): unknown {
  if (
    fieldName === 'data' &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    return compactInner(value as Record<string, unknown>, options);
  }
  if (Array.isArray(value)) {
    return truncateArray(value, fieldName, options);
  }
  if (typeof value === 'string') {
    return truncateString(value);
  }
  if (typeof value === 'object' && value !== null) {
    return truncateObject(value as Record<string, unknown>, options);
  }
  return value;
}

/**
 * Truncate an array with smart sampling strategies
 */
function truncateArray(
  arr: unknown[],
  fieldName: string,
  options?: { verbosity?: string }
): unknown {
  // Skip truncation if verbosity:"detailed"
  if (shouldSkipTruncation(options?.verbosity)) {
    return arr;
  }

  // Small arrays pass through unchanged
  if (arr.length <= 10) {
    return arr;
  }

  // BUG FIX Phase 0.1: For list action fields, return truncated array directly
  // (preserve array structure for schema compatibility)
  if (LIST_ACTION_FIELDS.has(fieldName)) {
    // Return first 50 items as array (not wrapped in object)
    // This maintains schema compatibility while still reducing payload size
    return arr.slice(0, 50);
  }

  // For 2D arrays (like cell values), use row-based truncation
  if (is2DArray(arr)) {
    return truncate2DArray(arr as unknown[][], fieldName);
  }

  // For 1D arrays, use smart sampling
  return truncate1DArray(arr, fieldName);
}

/**
 * Truncate 2D arrays (spreadsheet data) with row sampling while preserving
 * the array type for output-schema compatibility.
 */
function truncate2DArray(values: unknown[][], fieldName: string): unknown {
  const totalRows = values.length;
  const totalCells = values.reduce((sum, row) => sum + row.length, 0);

  if (totalCells <= MAX_INLINE_ITEMS) {
    return values;
  }

  // Sample strategy: first 6 rows + last 4 rows for pattern detection
  // Increased from 5 to 10 preview rows to give AI better context for analysis
  const previewRows = Math.min(10, totalRows);
  const firstRows = Math.ceil(previewRows * 0.6); // 60% from start
  const lastRows = previewRows - firstRows; // 40% from end

  const sampled: unknown[][] = [...values.slice(0, firstRows), ...values.slice(-lastRows)];
  void fieldName;
  return sampled;
}

/**
 * Truncate 1D arrays with intelligent sampling while preserving the array type
 * for output-schema compatibility.
 */
function truncate1DArray(arr: unknown[], fieldName: string): unknown {
  if (arr.length <= MAX_INLINE_ITEMS) {
    return arr;
  }

  // Determine optimal sample size (max 20 items)
  const maxSampleSize = Math.min(20, MAX_INLINE_ITEMS);

  // Use first-last strategy: 60% from start, 40% from end
  const firstCount = Math.ceil(maxSampleSize * 0.6);
  const lastCount = maxSampleSize - firstCount;

  const sampled = [...arr.slice(0, firstCount), ...arr.slice(-lastCount)];
  void fieldName;
  return sampled;
}

/**
 * Truncate a string if too long
 */
function truncateString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.length <= MAX_STRING_LENGTH) return value;

  return (
    value.substring(0, MAX_STRING_LENGTH) + `... [${value.length - MAX_STRING_LENGTH} more chars]`
  );
}

/**
 * Truncate an object while preserving JSON types recursively so compacted
 * responses still validate against output schemas.
 */
function truncateObject(
  obj: Record<string, unknown>,
  options?: { verbosity?: string }
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (STRIPPED_FIELDS.has(key)) continue;

    if (isSimpleValue(value)) {
      result[key] = truncateString(value);
    } else if (Array.isArray(value)) {
      result[key] = truncateArray(value, key, options);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = truncateObject(value as Record<string, unknown>, options);
    }
  }

  return result;
}

/**
 * Check if value is a 2D array
 */
function is2DArray(arr: unknown[]): arr is unknown[][] {
  return arr.length > 0 && Array.isArray(arr[0]);
}

/**
 * Check if value is a simple primitive
 */
function isSimpleValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

// =============================================================================
// SheetCompressor — SpreadsheetLLM-inspired context compression (2026-02-19)
// =============================================================================

/**
 * Structural anchor cell (header or type-boundary row)
 */
export interface AnchorCell {
  row: number;
  col: number;
  value: string;
  isHeader: boolean;
}

/**
 * Per-column statistical summary
 */
export interface ColumnStats {
  col: number;
  header: string;
  dominantType: 'text' | 'number' | 'date' | 'boolean' | 'empty' | 'mixed';
  nonEmptyCount: number;
  uniqueCount: number;
  examples: string[];
  min?: number | string;
  max?: number | string;
}

/**
 * Compressed sheet representation for LLM consumption.
 * Replaces raw cell data with structural skeleton + statistics.
 */
export interface CompressedSheet {
  dimensions: { rows: number; cols: number };
  anchors: AnchorCell[];
  inverseIndex: Record<string, [number, number][]>;
  columnStats: ColumnStats[];
  compressionRatio: number;
  hint: string;
}

/**
 * Compress a sheet's cell data for efficient LLM understanding.
 *
 * Implements the core ideas from Microsoft SpreadsheetLLM (2024):
 *  1. Structural anchor extraction — find header rows and type-boundary rows
 *  2. Inverse index translation — map unique values → [row,col] positions
 *  3. Column statistics — type distribution, min/max/mean, unique examples
 *
 * Achieves ~25x context compression while preserving structural understanding.
 * Use for sheets > 100 rows where full cell data would overflow context.
 *
 * @param values - 2D cell array (row-major, strings or primitives)
 * @param options.maxAnchors - Max structural anchor rows to include (default 20)
 * @param options.maxExamples - Max example values per column (default 5)
 */
export function compressSheetForLLM(
  values: unknown[][],
  options?: { maxAnchors?: number; maxExamples?: number }
): CompressedSheet {
  const maxAnchors = options?.maxAnchors ?? 20;
  const maxExamples = options?.maxExamples ?? 5;
  const rows = values.length;
  const cols = rows > 0 ? Math.max(...values.map((r) => r.length)) : 0;

  // === Step 1: Extract structural anchors ===
  const anchors: AnchorCell[] = [];

  // Row 0 is always a header anchor candidate
  const headerRow = values[0];
  if (headerRow) {
    for (let c = 0; c < headerRow.length; c++) {
      const v = headerRow[c];
      if (v !== null && v !== undefined && v !== '') {
        anchors.push({
          row: 0,
          col: c,
          value: String(v),
          isHeader: true,
        });
      }
    }
  }

  // Detect type-boundary rows: rows where column types shift significantly
  const rowTypes = values.map((row) => classifyRowTypes(row));
  for (let r = 1; r < Math.min(rows, 1000); r++) {
    const prev = rowTypes[r - 1];
    const curr = rowTypes[r];
    if (prev && curr && isTypeBoundary(prev, curr)) {
      const row = values[r];
      if (row) {
        for (let c = 0; c < Math.min(row.length, 5); c++) {
          const v = row[c];
          if (v !== null && v !== undefined && v !== '') {
            anchors.push({ row: r, col: c, value: String(v), isHeader: false });
            break; // One anchor per boundary row
          }
        }
        if (anchors.length >= maxAnchors) break;
      }
    }
  }

  // === Step 2: Inverse index (value → positions) ===
  const valueMap = new Map<string, [number, number][]>();
  const MAX_INDEX_ROWS = Math.min(rows, 500); // Cap to avoid huge indexes

  for (let r = 0; r < MAX_INDEX_ROWS; r++) {
    const row = values[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;
      const key = String(v);
      // Only index repeated values (unique values don't need indexing)
      if (!valueMap.has(key)) {
        valueMap.set(key, []);
      }
      valueMap.get(key)!.push([r, c]);
    }
  }

  // Keep only values that appear in 2+ cells (repeated patterns) and aren't too long
  const inverseIndex: Record<string, [number, number][]> = {};
  for (const [key, positions] of valueMap.entries()) {
    if (positions.length >= 2 && key.length <= 50) {
      inverseIndex[key] = positions;
    }
  }

  // === Step 3: Column statistics ===
  const columnStats: ColumnStats[] = [];

  for (let c = 0; c < cols; c++) {
    const colValues = values
      .slice(1) // Skip header row
      .map((row) => row[c])
      .filter((v) => v !== null && v !== undefined && v !== '');

    const header =
      headerRow?.[c] !== undefined && headerRow[c] !== null ? String(headerRow[c]) : `Col${c + 1}`;

    if (colValues.length === 0) {
      columnStats.push({
        col: c,
        header,
        dominantType: 'empty',
        nonEmptyCount: 0,
        uniqueCount: 0,
        examples: [],
      });
      continue;
    }

    const types = colValues.map(inferCellType);
    const typeCounts: Record<string, number> = {};
    for (const t of types) {
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }

    const dominantType =
      (Object.entries(typeCounts).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0] as ColumnStats['dominantType']) ?? 'mixed';

    const uniqueValues = [...new Set(colValues.map(String))];
    const examples = uniqueValues.slice(0, maxExamples);

    const stat: ColumnStats = {
      col: c,
      header,
      dominantType,
      nonEmptyCount: colValues.length,
      uniqueCount: uniqueValues.length,
      examples,
    };

    // Add min/max for numeric columns
    if (dominantType === 'number') {
      const nums = colValues.filter((v) => typeof v === 'number' || !isNaN(Number(v)));
      if (nums.length > 0) {
        const parsed = nums.map(Number);
        stat.min = Math.min(...parsed);
        stat.max = Math.max(...parsed);
      }
    } else if (dominantType === 'text' && uniqueValues.length > 1) {
      stat.min = uniqueValues.sort()[0];
      stat.max = uniqueValues.sort()[uniqueValues.length - 1];
    }

    columnStats.push(stat);
  }

  // === Compression ratio ===
  const originalSize = values.reduce((sum, row) => sum + row.length, 0);
  const compressedSize = anchors.length + Object.keys(inverseIndex).length + columnStats.length;
  const compressionRatio =
    originalSize > 0 ? Math.round(originalSize / Math.max(compressedSize, 1)) : 1;

  return {
    dimensions: { rows, cols },
    anchors,
    inverseIndex,
    columnStats,
    compressionRatio,
    hint: `Sheet compressed ${compressionRatio}x. Use verbosity:"detailed" to read raw cell data.`,
  };
}

/** Classify the data types in a row */
function classifyRowTypes(row: unknown[]): string[] {
  return row.map(inferCellType);
}

/** Infer cell value type */
function inferCellType(value: unknown): 'text' | 'number' | 'date' | 'boolean' | 'empty' {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  const s = String(value);
  if (!isNaN(Number(s)) && s.trim() !== '') return 'number';
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) return 'date';
  return 'text';
}

/** Detect if two adjacent rows represent a type boundary (structural change) */
function isTypeBoundary(prevTypes: string[], currTypes: string[]): boolean {
  const len = Math.min(prevTypes.length, currTypes.length);
  if (len === 0) return false;
  let changes = 0;
  for (let i = 0; i < len; i++) {
    if (prevTypes[i] !== currTypes[i] && prevTypes[i] !== 'empty' && currTypes[i] !== 'empty') {
      changes++;
    }
  }
  return changes / len > 0.5; // >50% of non-empty columns changed type
}

/**
 * Get compaction statistics
 */
export function getCompactionStats(
  original: unknown,
  compacted: unknown
): {
  originalSize: number;
  compactedSize: number;
  reduction: number;
  reductionPercent: number;
} {
  const originalSize = JSON.stringify(original).length;
  const compactedSize = JSON.stringify(compacted).length;
  const reduction = originalSize - compactedSize;
  const reductionPercent = Math.round((reduction / originalSize) * 100);

  return {
    originalSize,
    compactedSize,
    reduction,
    reductionPercent,
  };
}
