/**
 * Semantic Search Service
 *
 * In-memory vector index for spreadsheet content using cosine similarity.
 * Embedding generation via Anthropic API (voyage-3-lite model).
 * Index is per-spreadsheet, LRU-evicted when memory pressure arises.
 *
 * Single-tenant mode: no namespace isolation (ISSUE-174/175 deferred to ISSUE-173/SSO).
 */

import type { sheets_v4 } from 'googleapis';
import { ServiceError } from '../core/errors.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface IndexedChunk {
  range: string; // A1 notation, e.g. "Sheet1!A1:E5"
  snippet: string; // Human-readable summary (headers + sample values)
  embedding: number[]; // Embedding vector
}

export interface SpreadsheetIndex {
  spreadsheetId: string;
  indexedAt: number; // Date.now()
  chunks: IndexedChunk[];
}

export interface SemanticSearchResult {
  range: string;
  relevanceScore: number; // 0–1, cosine similarity
  snippet: string;
}

// ============================================================================
// Constants
// ============================================================================

const EMBEDDING_MODEL = 'voyage-3-lite';
const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
// Max chunks per spreadsheet to keep index size manageable
const MAX_CHUNKS_PER_SHEET = 50;
// LRU: evict oldest when we exceed this many cached indexes
const MAX_CACHED_INDEXES = 20;
// Minimum chunk text length to embed (skip near-empty ranges)
const MIN_CHUNK_LENGTH = 10;

// ============================================================================
// In-memory LRU index cache
// ============================================================================

const indexCache = new Map<string, SpreadsheetIndex & { lastUsed: number }>();

function evictIfNeeded(): void {
  if (indexCache.size <= MAX_CACHED_INDEXES) return;
  // Find oldest entry
  let oldestKey = '';
  let oldestTime = Infinity;
  for (const [key, val] of indexCache) {
    if (val.lastUsed < oldestTime) {
      oldestTime = val.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) indexCache.delete(oldestKey);
}

// ============================================================================
// Embedding
// ============================================================================

async function embed(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      input_type: 'document',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ServiceError(
      `Embedding API error ${response.status}: ${body}`,
      'UNAVAILABLE',
      'voyage-ai',
      response.status === 429,
      { statusCode: response.status }
    );
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [query],
      input_type: 'query',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ServiceError(
      `Embedding API error ${response.status}: ${body}`,
      'UNAVAILABLE',
      'voyage-ai',
      response.status === 429,
      { statusCode: response.status }
    );
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  const first = data.data[0];
  if (!first) throw new ServiceError('Empty embedding response', 'UNAVAILABLE', 'voyage-ai', false);
  return first.embedding;
}

// ============================================================================
// Cosine similarity
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================================
// Index building
// ============================================================================

/**
 * Build text chunks from a sheet's data for embedding.
 * Strategy: sliding window over rows, grouping headers + N data rows per chunk.
 */
function buildChunks(
  sheetName: string,
  rows: sheets_v4.Schema$RowData[],
  startRow: number,
  chunkSize: number = 10
): Array<{ range: string; snippet: string }> {
  const chunks: Array<{ range: string; snippet: string }> = [];

  // Extract header row (first row with data)
  let headerRow: string[] = [];
  let dataStartRow = 0;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]?.values ?? [];
    const texts = cells.map((c) =>
      String(
        c.formattedValue ?? c.effectiveValue?.stringValue ?? c.effectiveValue?.numberValue ?? ''
      ).trim()
    );
    if (texts.some((t) => t.length > 0)) {
      headerRow = texts;
      dataStartRow = i + 1;
      break;
    }
  }

  // Build sliding window chunks
  for (let rowIdx = dataStartRow; rowIdx < rows.length; rowIdx += chunkSize) {
    const chunkRows = rows.slice(rowIdx, rowIdx + chunkSize);
    const lines: string[] = [];

    if (headerRow.length > 0) {
      lines.push(`Headers: ${headerRow.filter(Boolean).join(' | ')}`);
    }

    for (const row of chunkRows) {
      const cells = row.values ?? [];
      const values = cells.map((c) =>
        String(
          c.formattedValue ?? c.effectiveValue?.stringValue ?? c.effectiveValue?.numberValue ?? ''
        ).trim()
      );
      const line = values.filter(Boolean).join(' | ');
      if (line) lines.push(line);
    }

    const snippet = lines.join('\n');
    if (snippet.length < MIN_CHUNK_LENGTH) continue;

    const firstDataRow = startRow + rowIdx + 1; // 1-indexed
    const lastDataRow = startRow + Math.min(rowIdx + chunkSize, rows.length);
    const colCount = Math.max(headerRow.length, ...chunkRows.map((r) => r.values?.length ?? 0));
    const lastCol = colCount > 0 ? String.fromCharCode(64 + Math.min(colCount, 26)) : 'Z';
    const range = `${sheetName}!A${firstDataRow}:${lastCol}${lastDataRow}`;

    chunks.push({ range, snippet });
  }

  // Also add a "whole-sheet header summary" chunk if we have headers
  if (headerRow.length > 0) {
    const summary = `Sheet "${sheetName}" — columns: ${headerRow.filter(Boolean).join(', ')}`;
    chunks.unshift({ range: `${sheetName}!A1:A1`, snippet: summary });
  }

  return chunks.slice(0, MAX_CHUNKS_PER_SHEET);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Index a spreadsheet's content for semantic search.
 * Fetches data via Sheets API, builds text chunks, and generates embeddings.
 * Caches the index in memory (LRU, max 20 spreadsheets).
 */
export async function indexSpreadsheet(
  spreadsheetId: string,
  sheetsApi: sheets_v4.Sheets,
  apiKey: string,
  forceRefresh = false
): Promise<SpreadsheetIndex> {
  // Return cached index if fresh (< 10 min old) and not forced
  const cached = indexCache.get(spreadsheetId);
  if (cached && !forceRefresh && Date.now() - cached.indexedAt < 10 * 60 * 1000) {
    cached.lastUsed = Date.now();
    return cached;
  }

  logger.info('semantic-search: indexing spreadsheet', { spreadsheetId });

  // Fetch spreadsheet data (sample: first 200 rows per sheet)
  const spreadsheet = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    includeGridData: true,
    fields:
      'sheets(properties(title,sheetId),data(rowData(values(formattedValue,effectiveValue,userEnteredFormula))))',
    ranges: undefined,
  });

  const allChunks: Array<{ range: string; snippet: string }> = [];

  for (const sheet of spreadsheet.data.sheets ?? []) {
    const sheetName = sheet.properties?.title ?? 'Sheet1';
    const gridData = sheet.data ?? [];

    for (const grid of gridData) {
      const rows = (grid.rowData ?? []).slice(0, 200); // cap at 200 rows per grid
      const startRow = grid.startRow ?? 0;
      const chunks = buildChunks(sheetName, rows, startRow);
      allChunks.push(...chunks);
    }
  }

  if (allChunks.length === 0) {
    logger.warn('semantic-search: no indexable content found', { spreadsheetId });
    const emptyIndex: SpreadsheetIndex = { spreadsheetId, indexedAt: Date.now(), chunks: [] };
    indexCache.set(spreadsheetId, { ...emptyIndex, lastUsed: Date.now() });
    evictIfNeeded();
    return emptyIndex;
  }

  // Generate embeddings in batches of 32 (Voyage API rate limits)
  const BATCH_SIZE = 32;
  const embeddedChunks: IndexedChunk[] = [];

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.snippet);
    const vectors = await embed(texts, apiKey);

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const vec = vectors[j];
      if (chunk && vec) {
        embeddedChunks.push({ range: chunk.range, snippet: chunk.snippet, embedding: vec });
      }
    }
  }

  logger.info('semantic-search: index built', {
    spreadsheetId,
    chunks: embeddedChunks.length,
  });

  const index: SpreadsheetIndex = {
    spreadsheetId,
    indexedAt: Date.now(),
    chunks: embeddedChunks,
  };

  evictIfNeeded();
  indexCache.set(spreadsheetId, { ...index, lastUsed: Date.now() });
  return index;
}

/**
 * Search a previously-indexed spreadsheet by natural language query.
 * Returns the top-K most relevant ranges, sorted by cosine similarity.
 */
export async function semanticSearch(
  spreadsheetId: string,
  query: string,
  topK: number,
  sheetsApi: sheets_v4.Sheets,
  apiKey: string,
  forceRefresh = false
): Promise<SemanticSearchResult[]> {
  const index = await indexSpreadsheet(spreadsheetId, sheetsApi, apiKey, forceRefresh);

  if (index.chunks.length === 0) {
    return [];
  }

  // Embed the query
  const queryVector = await embedQuery(query, apiKey);

  // Score all chunks
  const scored = index.chunks.map((chunk) => ({
    range: chunk.range,
    snippet: chunk.snippet,
    relevanceScore: cosineSimilarity(queryVector, chunk.embedding),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return scored.slice(0, topK).map((r) => ({
    range: r.range,
    relevanceScore: Math.round(r.relevanceScore * 10000) / 10000,
    snippet: r.snippet.slice(0, 500), // truncate long snippets for response
  }));
}

/**
 * Clear the cached index for a spreadsheet (e.g., after writes).
 */
export function clearSemanticIndex(spreadsheetId: string): void {
  indexCache.delete(spreadsheetId);
}

/**
 * Return stats about the current index cache (for diagnostics).
 */
export function getSemanticIndexStats(): { cached: number; spreadsheetIds: string[] } {
  return {
    cached: indexCache.size,
    spreadsheetIds: Array.from(indexCache.keys()),
  };
}
