/**
 * ServalSheets — Cross-Spreadsheet Federation Service (F2)
 *
 * Provides data operations across multiple Google Sheets spreadsheets:
 * - crossRead:    Parallel fetch + optional join/concatenate
 * - crossQuery:   Keyword search across multiple sources
 * - crossWrite:   Copy range from one spreadsheet to another
 * - crossCompare: Cell-level diff between two ranges
 */

import type { sheets_v4 } from 'googleapis';
import type { CachedSheetsApi } from './cached-sheets-api.js';
import { executeWithRetry } from '../utils/retry.js';
import { ValidationError, ServiceError } from '../core/errors.js';

type CellValue = string | number | boolean | null;
type Grid = CellValue[][];

export interface DataSource {
  spreadsheetId: string;
  range: string;
  label?: string;
}

interface FetchResult {
  source: DataSource;
  headers: string[];
  rows: Grid;
  error?: string;
}

export interface CrossReadResult {
  mergedValues: Grid;
  mergedHeaders: string[];
  sourcesRead: number;
  errors: string[];
}

export interface CrossQueryResult {
  queryMatches: Array<{
    spreadsheetId: string;
    label?: string;
    range: string;
    row: number;
    matchedValues: string[];
  }>;
  totalSearched: number;
}

export interface CrossWriteResult {
  cellsCopied: number;
  updatedRange: string;
}

export interface DiffResult {
  added: Grid;
  removed: Grid;
  changed: Array<{
    key: string;
    column: string;
    source1Value: CellValue;
    source2Value: CellValue;
  }>;
  summary: { addedRows: number; removedRows: number; changedCells: number };
}

// ============================================================================
// Internal helpers
// ============================================================================

async function fetchRangeGrid(
  sheetsApi: sheets_v4.Sheets,
  cachedApi: CachedSheetsApi | undefined,
  spreadsheetId: string,
  range: string
): Promise<Grid> {
  const response = cachedApi
    ? await cachedApi.getValues(spreadsheetId, range, {
        valueRenderOption: 'UNFORMATTED_VALUE',
      })
    : (
        await executeWithRetry(() =>
          sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range,
            valueRenderOption: 'UNFORMATTED_VALUE',
          })
        )
      ).data;
  const raw = response.values ?? [];
  return raw.map((row) =>
    row.map((cell) =>
      cell === '' || cell === undefined || cell === null ? null : (cell as CellValue)
    )
  );
}

async function fetchSource(
  sheetsApi: sheets_v4.Sheets,
  cachedApi: CachedSheetsApi | undefined,
  source: DataSource
): Promise<FetchResult> {
  try {
    const data = await fetchRangeGrid(sheetsApi, cachedApi, source.spreadsheetId, source.range);
    const headers = (data[0] ?? []).map((h) => String(h ?? ''));
    const rows = data.slice(1);
    return { source, headers, rows };
  } catch (err) {
    return {
      source,
      headers: [],
      rows: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ============================================================================
// crossRead
// ============================================================================

export async function crossRead(
  sheetsApi: sheets_v4.Sheets,
  sources: DataSource[],
  joinKey?: string,
  joinType: 'inner' | 'left' | 'outer' = 'left',
  cachedApi?: CachedSheetsApi
): Promise<CrossReadResult> {
  const results = await Promise.all(sources.map((s) => fetchSource(sheetsApi, cachedApi, s)));
  const successful = results.filter((r) => !r.error);
  const errors = results
    .filter((r) => r.error)
    .map((r) => `${r.source.label ?? r.source.spreadsheetId}: ${r.error}`);

  if (successful.length === 0) {
    return { mergedValues: [], mergedHeaders: [], sourcesRead: 0, errors };
  }

  if (!joinKey) {
    // Concatenate all sources, adding a _source column to identify origin
    const allHeaders = dedupe(successful.flatMap((f) => f.headers)).filter(Boolean);
    const mergedHeaders = ['_source', ...allHeaders];
    const mergedValues: Grid = [];

    for (const f of successful) {
      const label = f.source.label ?? f.source.spreadsheetId;
      for (const row of f.rows) {
        const mapped: CellValue[] = [label];
        for (const h of allHeaders) {
          const idx = f.headers.indexOf(h);
          mapped.push(idx >= 0 ? (row[idx] ?? null) : null);
        }
        mergedValues.push(mapped);
      }
    }

    return { mergedValues, mergedHeaders, sourcesRead: successful.length, errors };
  }

  // Join on key column
  const [primary, ...rest] = successful;
  if (!primary) {
    return { mergedValues: [], mergedHeaders: [], sourcesRead: 0, errors };
  }
  const primaryKeyIdx = primary.headers.indexOf(joinKey);
  if (primaryKeyIdx < 0) {
    throw new ValidationError(
      `Join key "${joinKey}" not found in first source. Available headers: ${primary.headers.join(', ')}`,
      'joinKey'
    );
  }

  // Build extra headers from secondary sources (prefixed to avoid collisions)
  const extraHeaders: string[] = [];
  for (const f of rest) {
    for (const h of f.headers) {
      if (h !== joinKey) {
        extraHeaders.push(`${f.source.label ?? f.source.spreadsheetId}.${h}`);
      }
    }
  }
  const mergedHeaders = [...primary.headers, ...extraHeaders];

  // Build key → row maps for each secondary source
  type SecLookup = {
    keyIdx: number;
    map: Map<string, CellValue[]>;
    headers: string[];
    label: string;
  };
  const lookups: SecLookup[] = rest.map((f) => {
    const keyIdx = f.headers.indexOf(joinKey);
    const map = new Map<string, CellValue[]>();
    if (keyIdx >= 0) {
      for (const row of f.rows) {
        const key = String(row[keyIdx] ?? '');
        if (!map.has(key)) map.set(key, row);
      }
    }
    return { keyIdx, map, headers: f.headers, label: f.source.label ?? f.source.spreadsheetId };
  });

  // Collect all keys depending on join type
  const primaryKeys = primary.rows.map((r) => String(r[primaryKeyIdx] ?? ''));
  const allKeys: string[] =
    joinType === 'outer'
      ? dedupe([...primaryKeys, ...lookups.flatMap((l) => [...l.map.keys()])])
      : primaryKeys;

  const mergedValues: Grid = [];
  for (const key of allKeys) {
    const pRow = primary.rows.find((r) => String(r[primaryKeyIdx] ?? '') === key);
    if (!pRow && joinType !== 'outer') continue;

    const base: CellValue[] = pRow ? [...pRow] : Array(primary.headers.length).fill(null);
    let skipRow = false;

    for (const l of lookups) {
      const sRow = l.map.get(key);
      if (!sRow && joinType === 'inner') {
        skipRow = true;
        break;
      }
      for (const h of l.headers) {
        if (h !== joinKey) {
          const idx = l.headers.indexOf(h);
          base.push(sRow ? (sRow[idx] ?? null) : null);
        }
      }
    }

    if (!skipRow) mergedValues.push(base);
  }

  return { mergedValues, mergedHeaders, sourcesRead: successful.length, errors };
}

// ============================================================================
// crossQuery
// ============================================================================

export async function crossQuery(
  sheetsApi: sheets_v4.Sheets,
  sources: DataSource[],
  query: string,
  maxResults = 100,
  cachedApi?: CachedSheetsApi
): Promise<CrossQueryResult> {
  const results = await Promise.all(sources.map((s) => fetchSource(sheetsApi, cachedApi, s)));
  const queryLower = query.toLowerCase();
  const queryMatches: CrossQueryResult['queryMatches'] = [];
  let totalSearched = 0;

  for (const result of results) {
    if (result.error) continue;
    totalSearched += result.rows.length;

    for (let i = 0; i < result.rows.length; i++) {
      if (queryMatches.length >= maxResults) break;
      const row = result.rows[i];
      if (!row) continue;
      const matched = row
        .filter((cell) => cell !== null && String(cell).toLowerCase().includes(queryLower))
        .map((cell) => String(cell));
      if (matched.length > 0) {
        queryMatches.push({
          spreadsheetId: result.source.spreadsheetId,
          label: result.source.label,
          range: result.source.range,
          row: i + 2, // 1-based, +1 for header row
          matchedValues: matched,
        });
      }
    }
  }

  return { queryMatches, totalSearched };
}

// ============================================================================
// crossWrite
// ============================================================================

export async function crossWrite(
  sheetsApi: sheets_v4.Sheets,
  source: DataSource,
  destination: { spreadsheetId: string; range: string },
  valueInputOption = 'USER_ENTERED',
  cachedApi?: CachedSheetsApi
): Promise<CrossWriteResult> {
  // Read source
  const data = await fetchRangeGrid(sheetsApi, cachedApi, source.spreadsheetId, source.range);

  // Write to destination
  const res = await executeWithRetry(() =>
    sheetsApi.spreadsheets.values.update({
      spreadsheetId: destination.spreadsheetId,
      range: destination.range,
      valueInputOption,
      requestBody: { values: data },
    })
  );

  const cellsCopied = data.reduce((sum, row) => sum + row.filter((c) => c !== null).length, 0);

  return {
    cellsCopied,
    updatedRange: res.data.updatedRange ?? destination.range,
  };
}

// ============================================================================
// crossCompare
// ============================================================================

export async function crossCompare(
  sheetsApi: sheets_v4.Sheets,
  source1: DataSource,
  source2: DataSource,
  compareColumns?: string[],
  keyColumn?: string,
  cachedApi?: CachedSheetsApi
): Promise<DiffResult> {
  const [f1, f2] = await Promise.all([
    fetchSource(sheetsApi, cachedApi, source1),
    fetchSource(sheetsApi, cachedApi, source2),
  ]);

  if (f1.error)
    throw new ServiceError(
      `Source 1 fetch failed: ${f1.error}`,
      'INTERNAL_ERROR',
      'CrossSpreadsheetService'
    );
  if (f2.error)
    throw new ServiceError(
      `Source 2 fetch failed: ${f2.error}`,
      'INTERNAL_ERROR',
      'CrossSpreadsheetService'
    );

  const cols = compareColumns ?? dedupe([...f1.headers, ...f2.headers]).filter(Boolean);

  if (!keyColumn) {
    // Row-by-row positional comparison
    const maxRows = Math.max(f1.rows.length, f2.rows.length);
    const added: Grid = [];
    const removed: Grid = [];
    const changed: DiffResult['changed'] = [];

    for (let i = 0; i < maxRows; i++) {
      const r1 = f1.rows[i];
      const r2 = f2.rows[i];

      if (!r1 && r2) {
        added.push(r2);
        continue;
      }
      if (r1 && !r2) {
        removed.push(r1);
        continue;
      }

      for (const col of cols) {
        const i1 = f1.headers.indexOf(col);
        const i2 = f2.headers.indexOf(col);
        const v1: CellValue = i1 >= 0 ? (r1![i1] ?? null) : null;
        const v2: CellValue = i2 >= 0 ? (r2![i2] ?? null) : null;
        if (String(v1) !== String(v2)) {
          changed.push({ key: `row ${i + 2}`, column: col, source1Value: v1, source2Value: v2 });
        }
      }
    }

    return {
      added,
      removed,
      changed,
      summary: {
        addedRows: added.length,
        removedRows: removed.length,
        changedCells: changed.length,
      },
    };
  }

  // Key-based aligned comparison
  const k1 = f1.headers.indexOf(keyColumn);
  const k2 = f2.headers.indexOf(keyColumn);

  const map1 = new Map<string, CellValue[]>();
  const map2 = new Map<string, CellValue[]>();
  for (const r of f1.rows) map1.set(String(r[k1] ?? ''), r);
  for (const r of f2.rows) map2.set(String(r[k2] ?? ''), r);

  const allKeys = dedupe([...map1.keys(), ...map2.keys()]);
  const added: Grid = [];
  const removed: Grid = [];
  const changed: DiffResult['changed'] = [];

  for (const key of allKeys) {
    const r1 = map1.get(key);
    const r2 = map2.get(key);

    if (!r1 && r2) {
      added.push(r2);
      continue;
    }
    if (r1 && !r2) {
      removed.push(r1);
      continue;
    }

    for (const col of cols) {
      if (col === keyColumn) continue;
      const i1 = f1.headers.indexOf(col);
      const i2 = f2.headers.indexOf(col);
      const v1: CellValue = i1 >= 0 ? (r1![i1] ?? null) : null;
      const v2: CellValue = i2 >= 0 ? (r2![i2] ?? null) : null;
      if (String(v1) !== String(v2)) {
        changed.push({ key, column: col, source1Value: v1, source2Value: v2 });
      }
    }
  }

  return {
    added,
    removed,
    changed,
    summary: { addedRows: added.length, removedRows: removed.length, changedCells: changed.length },
  };
}
