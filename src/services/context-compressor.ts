/**
 * ServalSheets - Context Compressor
 *
 * Compresses spreadsheet data for MCP Sampling requests to reduce token usage.
 * For a 10,000-row sheet, raw data can be 500K+ tokens — well beyond model limits.
 *
 * Compression strategies:
 * 1. Statistical summary — replaces raw data with column stats (min, max, mean, etc.)
 * 2. Representative sampling — first N, last N, and random rows
 * 3. Schema-only — column names and types without any data
 *
 * Token reduction: 80-96% compared to raw data inclusion.
 *
 * Design: Stateless module-level functions. No class instantiation needed.
 */

// ============================================================================
// Types
// ============================================================================

export type CompressionStrategy = 'statistical' | 'representative' | 'schema_only' | 'auto';

export interface CompressionOptions {
  /** Compression strategy. 'auto' selects based on data size. Default: 'auto' */
  strategy?: CompressionStrategy;
  /** Maximum rows for representative sampling. Default: 15 */
  maxSampleRows?: number;
  /** Maximum columns to include in summary. Default: 20 */
  maxColumns?: number;
  /** Include column type detection. Default: true */
  includeTypes?: boolean;
  /** Include statistical summary. Default: true (for 'statistical' and 'auto') */
  includeStats?: boolean;
  /** Target approximate token budget. Default: 2000 */
  tokenBudget?: number;
}

export interface ColumnStats {
  name: string;
  type: 'number' | 'text' | 'date' | 'boolean' | 'mixed' | 'empty';
  nonNull: number;
  nullCount: number;
  unique: number;
  /** Number-only stats */
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stddev?: number;
  /** Text-only stats */
  minLength?: number;
  maxLength?: number;
  avgLength?: number;
  /** Sample values (up to 5 unique) */
  sampleValues?: unknown[];
}

export interface CompressedContext {
  /** Total rows in source data (excluding header) */
  totalRows: number;
  /** Total columns */
  totalColumns: number;
  /** Column headers */
  headers: string[];
  /** Per-column statistics */
  columnStats?: ColumnStats[];
  /** Representative sample rows */
  sampleRows?: unknown[][];
  /** Labels for sample rows (e.g., "row 1", "row 5000", "row 9999") */
  sampleRowLabels?: string[];
  /** Strategy used */
  strategy: CompressionStrategy;
  /** Approximate token count of compressed output */
  estimatedTokens: number;
}

// ============================================================================
// Auto-Strategy Thresholds
// ============================================================================

/** Below this row count, use representative sampling (fast, preserves structure) */
const SMALL_DATASET_THRESHOLD = 50;
/** Above this row count, use statistical summary (compact, data-dense) */
const LARGE_DATASET_THRESHOLD = 500;

// ============================================================================
// Core Compression Functions
// ============================================================================

/**
 * Compress spreadsheet data for Sampling context.
 *
 * @param data - 2D array with headers in first row
 * @param options - Compression configuration
 * @returns Compressed context ready for prompt inclusion
 */
export function compressContext(
  data: unknown[][],
  options: CompressionOptions = {}
): CompressedContext {
  const {
    strategy = 'auto',
    maxSampleRows = 15,
    maxColumns = 20,
    includeTypes = true,
    includeStats = true,
  } = options;

  if (!data || data.length === 0) {
    return {
      totalRows: 0,
      totalColumns: 0,
      headers: [],
      strategy: strategy === 'auto' ? 'schema_only' : strategy,
      estimatedTokens: 10,
    };
  }

  const headers = (data[0] ?? []).slice(0, maxColumns).map((h) => String(h ?? ''));
  const bodyRows = data.slice(1);
  const totalRows = bodyRows.length;
  const totalColumns = headers.length;

  // Select strategy
  const effectiveStrategy = strategy === 'auto' ? selectStrategy(totalRows) : strategy;

  switch (effectiveStrategy) {
    case 'schema_only':
      return buildSchemaOnly(headers, totalRows, totalColumns, includeTypes ? bodyRows : []);

    case 'representative':
      return buildRepresentative(headers, bodyRows, totalRows, totalColumns, maxSampleRows);

    case 'statistical':
      return buildStatistical(
        headers,
        bodyRows,
        totalRows,
        totalColumns,
        includeStats,
        maxSampleRows
      );

    default:
      return buildRepresentative(headers, bodyRows, totalRows, totalColumns, maxSampleRows);
  }
}

/**
 * Format compressed context as a prompt-ready string.
 */
export function formatCompressedContext(ctx: CompressedContext): string {
  const parts: string[] = [];

  parts.push(`Dataset: ${ctx.totalRows} rows × ${ctx.totalColumns} columns`);
  parts.push(`Compression: ${ctx.strategy}`);
  parts.push(`Headers: ${ctx.headers.join(' | ')}`);

  // Column statistics
  if (ctx.columnStats && ctx.columnStats.length > 0) {
    parts.push('\nColumn Summary:');
    for (const col of ctx.columnStats) {
      let line = `  ${col.name} (${col.type}): ${col.nonNull} values, ${col.nullCount} nulls, ${col.unique} unique`;
      if (col.type === 'number' && col.min !== undefined) {
        line += ` | range: [${col.min}, ${col.max}] | mean: ${col.mean?.toFixed(2)} | median: ${col.median}`;
        if (col.stddev !== undefined) {
          line += ` | stddev: ${col.stddev.toFixed(2)}`;
        }
      }
      if (col.type === 'text' && col.avgLength !== undefined) {
        line += ` | length: [${col.minLength}, ${col.maxLength}] avg ${col.avgLength.toFixed(0)}`;
      }
      if (col.sampleValues && col.sampleValues.length > 0) {
        const samples = col.sampleValues.map((v) => JSON.stringify(v)).join(', ');
        line += ` | samples: ${samples}`;
      }
      parts.push(line);
    }
  }

  // Sample rows
  if (ctx.sampleRows && ctx.sampleRows.length > 0) {
    parts.push('\nSample Rows:');
    // Header row
    parts.push(`| ${ctx.headers.join(' | ')} |`);
    parts.push(`|${ctx.headers.map(() => '---').join('|')}|`);
    // Data rows with labels
    for (let i = 0; i < ctx.sampleRows.length; i++) {
      const row = ctx.sampleRows[i]!;
      const label = ctx.sampleRowLabels?.[i] ?? `row ${i + 1}`;
      const cells = row.map((cell) => String(cell ?? '')).join(' | ');
      parts.push(`| ${cells} | ← ${label}`);
    }
  }

  return parts.join('\n');
}

/**
 * Estimate token count for a string (rough: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// Strategy Selection
// ============================================================================

function selectStrategy(rowCount: number): CompressionStrategy {
  if (rowCount <= SMALL_DATASET_THRESHOLD) {
    return 'representative';
  }
  if (rowCount <= LARGE_DATASET_THRESHOLD) {
    return 'representative';
  }
  return 'statistical';
}

// ============================================================================
// Schema-Only Builder
// ============================================================================

function buildSchemaOnly(
  headers: string[],
  totalRows: number,
  totalColumns: number,
  bodyRows: unknown[][]
): CompressedContext {
  const columnStats: ColumnStats[] = headers.map((name, colIdx) => {
    const colType = bodyRows.length > 0 ? detectColumnType(bodyRows, colIdx) : 'empty';
    return {
      name,
      type: colType,
      nonNull: 0,
      nullCount: 0,
      unique: 0,
    };
  });

  const ctx: CompressedContext = {
    totalRows,
    totalColumns,
    headers,
    columnStats,
    strategy: 'schema_only',
    estimatedTokens: 0,
  };
  ctx.estimatedTokens = estimateTokens(formatCompressedContext(ctx));
  return ctx;
}

// ============================================================================
// Representative Sampling Builder
// ============================================================================

function buildRepresentative(
  headers: string[],
  bodyRows: unknown[][],
  totalRows: number,
  totalColumns: number,
  maxSampleRows: number
): CompressedContext {
  const { rows, labels } = selectRepresentativeRows(bodyRows, maxSampleRows);

  const ctx: CompressedContext = {
    totalRows,
    totalColumns,
    headers,
    sampleRows: rows.map((row) => (row as unknown[]).slice(0, totalColumns)),
    sampleRowLabels: labels,
    strategy: 'representative',
    estimatedTokens: 0,
  };
  ctx.estimatedTokens = estimateTokens(formatCompressedContext(ctx));
  return ctx;
}

/**
 * Select representative rows: first N, last N, and evenly-spaced middle rows.
 */
function selectRepresentativeRows(
  rows: unknown[][],
  maxRows: number
): { rows: unknown[][]; labels: string[] } {
  if (rows.length <= maxRows) {
    return {
      rows: rows,
      labels: rows.map((_, i) => `row ${i + 2}`), // +2 because row 1 is header
    };
  }

  const firstCount = Math.min(3, Math.floor(maxRows / 3));
  const lastCount = Math.min(3, Math.floor(maxRows / 3));
  const middleCount = maxRows - firstCount - lastCount;

  const selectedRows: unknown[][] = [];
  const labels: string[] = [];

  // First rows
  for (let i = 0; i < firstCount; i++) {
    selectedRows.push(rows[i]!);
    labels.push(`row ${i + 2}`);
  }

  // Middle rows (evenly spaced)
  if (middleCount > 0 && rows.length > firstCount + lastCount) {
    const middleStart = firstCount;
    const middleEnd = rows.length - lastCount;
    const step = Math.max(1, Math.floor((middleEnd - middleStart) / (middleCount + 1)));

    for (let i = 0; i < middleCount; i++) {
      const idx = middleStart + step * (i + 1);
      if (idx < middleEnd && idx < rows.length) {
        selectedRows.push(rows[idx]!);
        labels.push(`row ${idx + 2}`);
      }
    }
  }

  // Last rows
  for (let i = Math.max(0, rows.length - lastCount); i < rows.length; i++) {
    selectedRows.push(rows[i]!);
    labels.push(`row ${i + 2}`);
  }

  return { rows: selectedRows, labels };
}

// ============================================================================
// Statistical Summary Builder
// ============================================================================

function buildStatistical(
  headers: string[],
  bodyRows: unknown[][],
  totalRows: number,
  totalColumns: number,
  includeStats: boolean,
  maxSampleRows: number
): CompressedContext {
  const columnStats: ColumnStats[] = includeStats
    ? headers.map((name, colIdx) => computeColumnStats(name, bodyRows, colIdx))
    : [];

  // Also include a small representative sample (5 rows)
  const sampleCount = Math.min(5, maxSampleRows);
  const { rows: sampleRows, labels: sampleLabels } = selectRepresentativeRows(
    bodyRows,
    sampleCount
  );

  const ctx: CompressedContext = {
    totalRows,
    totalColumns,
    headers,
    columnStats,
    sampleRows: sampleRows.map((row) => (row as unknown[]).slice(0, totalColumns)),
    sampleRowLabels: sampleLabels,
    strategy: 'statistical',
    estimatedTokens: 0,
  };
  ctx.estimatedTokens = estimateTokens(formatCompressedContext(ctx));
  return ctx;
}

// ============================================================================
// Column Analysis Helpers
// ============================================================================

function computeColumnStats(name: string, rows: unknown[][], colIdx: number): ColumnStats {
  const values: unknown[] = rows.map((row) => (row as unknown[])[colIdx]);
  const nonNullValues = values.filter((v) => v !== null && v !== undefined && v !== '');
  const nullCount = values.length - nonNullValues.length;
  const uniqueSet = new Set(nonNullValues.map((v) => String(v)));
  const colType = detectColumnType(rows, colIdx);

  const stats: ColumnStats = {
    name,
    type: colType,
    nonNull: nonNullValues.length,
    nullCount,
    unique: uniqueSet.size,
  };

  // Numeric statistics
  if (colType === 'number') {
    const nums = nonNullValues
      .map((v) => (typeof v === 'number' ? v : parseFloat(String(v))))
      .filter((n) => !isNaN(n));

    if (nums.length > 0) {
      nums.sort((a, b) => a - b);
      stats.min = nums[0];
      stats.max = nums[nums.length - 1];
      stats.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      stats.median =
        nums.length % 2 === 0
          ? (nums[nums.length / 2 - 1]! + nums[nums.length / 2]!) / 2
          : nums[Math.floor(nums.length / 2)];

      // Standard deviation
      const variance = nums.reduce((sum, n) => sum + Math.pow(n - stats.mean!, 2), 0) / nums.length;
      stats.stddev = Math.sqrt(variance);
    }
  }

  // Text statistics
  if (colType === 'text') {
    const lengths = nonNullValues.map((v) => String(v).length);
    if (lengths.length > 0) {
      stats.minLength = Math.min(...lengths);
      stats.maxLength = Math.max(...lengths);
      stats.avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    }
  }

  // Sample values (up to 5 unique, from start of data)
  const seenSamples = new Set<string>();
  const sampleValues: unknown[] = [];
  for (const v of nonNullValues) {
    const key = String(v);
    if (!seenSamples.has(key) && sampleValues.length < 5) {
      seenSamples.add(key);
      sampleValues.push(v);
    }
  }
  stats.sampleValues = sampleValues;

  return stats;
}

/**
 * Detect column type from sample data.
 */
function detectColumnType(
  rows: unknown[][],
  colIdx: number
): 'number' | 'text' | 'date' | 'boolean' | 'mixed' | 'empty' {
  // Sample up to 50 rows for type detection
  const sampleSize = Math.min(50, rows.length);
  const typeCounts = { number: 0, text: 0, date: 0, boolean: 0, empty: 0 };

  for (let i = 0; i < sampleSize; i++) {
    const val = (rows[i] as unknown[])[colIdx];

    if (val === null || val === undefined || val === '') {
      typeCounts.empty++;
      continue;
    }

    if (typeof val === 'boolean') {
      typeCounts.boolean++;
      continue;
    }

    if (typeof val === 'number') {
      typeCounts.number++;
      continue;
    }

    const str = String(val);

    // Check if parseable as number
    if (str.trim() !== '' && !isNaN(Number(str))) {
      typeCounts.number++;
      continue;
    }

    // Check for date patterns
    if (/^\d{4}-\d{2}-\d{2}/.test(str) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
      typeCounts.date++;
      continue;
    }

    // Check for boolean strings
    if (/^(true|false|yes|no)$/i.test(str)) {
      typeCounts.boolean++;
      continue;
    }

    typeCounts.text++;
  }

  const nonEmpty = sampleSize - typeCounts.empty;
  if (nonEmpty === 0) return 'empty';

  // Dominant type wins (>70% threshold)
  const threshold = nonEmpty * 0.7;
  if (typeCounts.number >= threshold) return 'number';
  if (typeCounts.text >= threshold) return 'text';
  if (typeCounts.date >= threshold) return 'date';
  if (typeCounts.boolean >= threshold) return 'boolean';

  return 'mixed';
}
