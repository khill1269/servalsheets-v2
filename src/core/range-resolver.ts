/**
 * ServalSheets - Range Resolver
 *
 * Resolves semantic range queries to A1 notation
 * MCP Protocol: 2025-11-25
 *
 * Tighten-up #6: Strict resolution with confidence
 */

import type { sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import { LRUCache } from 'lru-cache';
import type { RangeInput, ResolvedRange, GridRange } from '../schemas/shared.js';
import { RangeResolutionError } from './errors.js';

// Re-export for backward compatibility
export { RangeResolutionError };

interface HeaderCache {
  headers: Map<string, number>; // header -> column index
  timestamp: number;
}

export interface RangeResolverOptions {
  sheetsApi: sheets_v4.Sheets;
  cacheTtlMs?: number;
  fuzzyMatchThreshold?: number;
}

/**
 * Resolves various range formats to A1 notation
 */
export class RangeResolver {
  private sheetsApi: sheets_v4.Sheets;
  private headerCache: LRUCache<string, HeaderCache>;
  private cacheTtlMs: number;
  private fuzzyMatchThreshold: number;

  constructor(options: RangeResolverOptions) {
    this.sheetsApi = options.sheetsApi;
    this.cacheTtlMs = options.cacheTtlMs ?? 300000; // 5 minutes
    this.fuzzyMatchThreshold = options.fuzzyMatchThreshold ?? 0.8;

    this.headerCache = new LRUCache<string, HeaderCache>({
      max: 1000, // Increased from 100 to support larger workloads
      ttl: this.cacheTtlMs,
      updateAgeOnGet: true,
      dispose: (value, key) => {
        // Log evicted entries in debug mode
        if (process.env['LOG_LEVEL'] === 'debug') {
          logger.debug('Range cache entry evicted', { key });
        }
      },
    });
  }

  /**
   * Escape sheet name for A1 notation
   * Single quotes within sheet names must be doubled
   */
  private escapeSheetName(name: string): string {
    return name.replace(/'/g, "''");
  }

  /**
   * Resolve a range input to A1 notation
   */
  async resolve(
    spreadsheetId: string,
    input: RangeInput | string | null | undefined
  ): Promise<ResolvedRange> {
    if (typeof input === 'string') {
      return this.resolveA1(spreadsheetId, input);
    }

    if (!input || typeof input !== 'object') {
      throw new RangeResolutionError(
        'Range input is required. Provide A1 notation (for example "Sheet1!A1:D10") or a structured range object.',
        'INVALID_RANGE',
        { range: input === undefined ? 'undefined' : String(input) }
      );
    }

    // Direct A1 notation
    if ('a1' in input) {
      return this.resolveA1(spreadsheetId, input.a1);
    }

    // Named range
    if ('namedRange' in input) {
      return this.resolveNamedRange(spreadsheetId, input.namedRange);
    }

    // Grid coordinates
    if ('grid' in input) {
      return this.resolveGrid(spreadsheetId, input.grid);
    }

    // Semantic query
    if ('semantic' in input) {
      return this.resolveSemantic(spreadsheetId, input.semantic);
    }

    throw new RangeResolutionError('Invalid range input format', 'INVALID_RANGE');
  }

  /**
   * Resolve A1 notation directly
   */
  private async resolveA1(spreadsheetId: string, a1: string): Promise<ResolvedRange> {
    // Check if input is JUST a range (e.g., "A1:Z200") without sheet qualifier
    // A1 notation pattern: optional column letters, optional row numbers, optional colon, repeat
    const rangeOnlyPattern = /^[A-Z]+\d*(?::[A-Z]+\d*)?$/i;

    let sheetName: string;
    let rangeRef: string;

    if (rangeOnlyPattern.test(a1)) {
      // Input is just a range like "A1:Z200" without sheet name
      // Use first sheet as default
      try {
        const response = await this.sheetsApi.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties',
        });

        const firstSheet = response.data.sheets?.[0];
        if (!firstSheet?.properties) {
          throw new RangeResolutionError('No sheets found in spreadsheet', 'SHEET_NOT_FOUND');
        }

        sheetName = firstSheet.properties.title ?? 'Sheet1';
        rangeRef = a1;

        // Get sheet info to validate
        const sheetInfo = await this.getSheetInfo(spreadsheetId, sheetName);

        // Build full A1 notation with sheet name
        const fullA1 = `'${this.escapeSheetName(sheetInfo.title)}'!${rangeRef}`;

        return {
          sheetId: sheetInfo.sheetId,
          sheetName: sheetInfo.title,
          a1Notation: fullA1,
          gridRange: this.a1ToGridRange(sheetInfo.sheetId, rangeRef),
          resolution: {
            method: 'a1_direct',
            confidence: 1.0,
            path: `Range without sheet qualifier resolved to: ${fullA1}`,
          },
        };
      } catch (error: unknown) {
        // Catch authentication errors and provide clear guidance
        const err = error as { code?: number; message?: string };
        if (
          err?.code === 401 ||
          err?.code === 403 ||
          err?.message?.includes('unauthenticated') ||
          err?.message?.includes('invalid_grant') ||
          err?.message?.includes('credentials')
        ) {
          throw new RangeResolutionError(
            "Authentication required to resolve range. Call sheets_auth with action 'status' to check authentication, or action 'login' to authenticate.",
            'AUTH_REQUIRED',
            {
              range: a1,
              spreadsheetId,
              hint: 'Authentication is required before resolving ranges',
              steps: [
                '1. Check auth: sheets_auth action="status"',
                '2. If not authenticated: sheets_auth action="login"',
                '3. Follow OAuth flow',
                '4. Retry this operation',
              ],
            }
          );
        }
        throw error; // Re-throw other errors
      }
    }

    // Parse sheet name and range - handle escaped quotes in sheet names
    // Patterns: 'Sheet Name'!A1:B2 or SheetName!A1:B2
    const match = a1.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.*)$/);

    if (!match) {
      throw new RangeResolutionError(
        `Invalid A1 notation format: "${a1}". Expected format: "Sheet1!A1:Z200" or "A1:Z200"`,
        'INVALID_RANGE'
      );
    }

    sheetName = match[1] ?? match[2] ?? 'Sheet1';
    rangeRef = match[3] ?? '';

    // Unescape sheet name (convert '' back to ')
    sheetName = sheetName.replace(/''/g, "'");

    // Get sheet info (with auth error handling)
    try {
      const sheetInfo = await this.getSheetInfo(spreadsheetId, sheetName);

      return {
        sheetId: sheetInfo.sheetId,
        sheetName: sheetInfo.title,
        a1Notation: a1,
        gridRange: this.a1ToGridRange(sheetInfo.sheetId, rangeRef),
        resolution: {
          method: 'a1_direct',
          confidence: 1.0,
          path: `Direct A1 notation: ${a1}`,
        },
      };
    } catch (error: unknown) {
      // Catch authentication errors and provide clear guidance
      const err = error as { code?: number; message?: string };
      if (
        err?.code === 401 ||
        err?.code === 403 ||
        err?.message?.includes('unauthenticated') ||
        err?.message?.includes('invalid_grant') ||
        err?.message?.includes('credentials')
      ) {
        throw new RangeResolutionError(
          "Authentication required to resolve range. Call sheets_auth with action 'status' to check authentication, or action 'login' to authenticate.",
          'AUTH_REQUIRED',
          {
            range: a1,
            spreadsheetId,
            hint: 'Authentication is required before resolving ranges',
            steps: [
              '1. Check auth: sheets_auth action="status"',
              '2. If not authenticated: sheets_auth action="login"',
              '3. Follow OAuth flow',
              '4. Retry this operation',
            ],
          }
        );
      }
      throw error; // Re-throw other errors
    }
  }

  /**
   * Resolve named range
   */
  private async resolveNamedRange(spreadsheetId: string, name: string): Promise<ResolvedRange> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'namedRanges,sheets.properties',
    });

    const namedRange = response.data.namedRanges?.find(
      (nr) => nr.name?.toLowerCase() === name.toLowerCase()
    );

    if (!namedRange?.range) {
      // Provide available named ranges
      const available = response.data.namedRanges?.map((nr) => nr.name) ?? [];
      throw new RangeResolutionError(`Named range "${name}" not found`, 'RANGE_NOT_FOUND', {
        available,
      });
    }

    const sheetId = namedRange.range.sheetId ?? 0;
    const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === sheetId);

    const sheetTitle = sheet?.properties?.title ?? 'Sheet1';

    return {
      sheetId,
      sheetName: sheetTitle,
      a1Notation: this.gridRangeToA1(sheetTitle, namedRange.range as GridRange),
      gridRange: namedRange.range as GridRange,
      resolution: {
        method: 'named_range',
        confidence: 1.0,
        path: `Named range: ${name}`,
      },
    };
  }

  /**
   * Resolve grid coordinates
   */
  private async resolveGrid(spreadsheetId: string, grid: GridRange): Promise<ResolvedRange> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheet = response.data.sheets?.find((s) => s.properties?.sheetId === grid.sheetId);

    if (!sheet?.properties) {
      const availableSheets =
        response.data.sheets
          ?.slice(0, 5)
          .map((s) => `${s.properties?.title} (id: ${s.properties?.sheetId})`)
          .filter(Boolean) ?? [];
      const totalSheets = response.data.sheets?.length ?? 0;
      throw new RangeResolutionError(
        `Sheet with ID ${grid.sheetId} not found. Available sheets: ${availableSheets.join(', ')}${totalSheets > 5 ? ` (+${totalSheets - 5} more)` : ''}. Use sheets_core action:"list_sheets" to get valid sheet IDs.`,
        'SHEET_NOT_FOUND',
        {
          requestedSheetId: grid.sheetId,
          availableSheets: response.data.sheets?.map((s) => ({
            name: s.properties?.title,
            id: s.properties?.sheetId,
          })),
          hint: 'Sheet IDs change when sheets are deleted/recreated. Always fetch current IDs before operations.',
          suggestedAction: 'sheets_core action:"list_sheets"',
        }
      );
    }

    const sheetTitle = sheet.properties.title ?? 'Sheet1';
    const a1 = this.gridRangeToA1(sheetTitle, grid);

    return {
      sheetId: grid.sheetId,
      sheetName: sheetTitle,
      a1Notation: a1,
      gridRange: grid,
      resolution: {
        method: 'a1_direct',
        confidence: 1.0,
        path: `Grid coordinates: ${JSON.stringify(grid)}`,
      },
    };
  }

  /**
   * Resolve semantic query (column header match)
   */
  private async resolveSemantic(
    spreadsheetId: string,
    query: {
      sheet: string;
      column: string;
      includeHeader?: boolean;
      rowStart?: number | undefined;
      rowEnd?: number | undefined;
    }
  ): Promise<ResolvedRange> {
    // Get headers
    const headers = await this.getHeaders(spreadsheetId, query.sheet);

    // Find matching columns
    const matches: Array<{
      header: string;
      index: number;
      confidence: number;
    }> = [];
    const queryLower = query.column.toLowerCase();

    for (const [header, index] of headers.entries()) {
      const headerLower = header.toLowerCase();

      // Exact match
      if (headerLower === queryLower) {
        matches.push({ header, index, confidence: 1.0 });
        continue;
      }

      // Contains match
      if (headerLower.includes(queryLower) || queryLower.includes(headerLower)) {
        const confidence =
          Math.min(queryLower.length, headerLower.length) /
          Math.max(queryLower.length, headerLower.length);
        if (confidence >= this.fuzzyMatchThreshold) {
          matches.push({ header, index, confidence });
        }
      }
    }

    // No matches
    if (matches.length === 0) {
      throw new RangeResolutionError(
        `No column matching "${query.column}" found in sheet "${query.sheet}"`,
        'RANGE_NOT_FOUND',
        { available: Array.from(headers.keys()) }
      );
    }

    // Ambiguous - multiple exact matches
    const exactMatches = matches.filter((m) => m.confidence === 1.0);
    if (exactMatches.length > 1) {
      throw new RangeResolutionError(
        `Ambiguous: "${query.column}" matches multiple columns`,
        'AMBIGUOUS_RANGE',
        {
          matches: exactMatches.map((m) => m.header),
          suggestedFix: `Specify one of: ${exactMatches.map((m) => `"${m.header}"`).join(', ')}`,
        }
      );
    }

    // Use exact match if available, otherwise best fuzzy match
    const bestMatch = exactMatches[0] ?? matches.sort((a, b) => b.confidence - a.confidence)[0];

    if (!bestMatch) {
      throw new RangeResolutionError(
        `No column matching "${query.column}" found`,
        'RANGE_NOT_FOUND'
      );
    }

    // Build A1 notation with properly escaped sheet name
    const colLetter = this.columnIndexToLetter(bestMatch.index);
    const startRow = query.includeHeader ? 1 : 2;
    const endRow = query.rowEnd ?? '';
    const escapedSheet = this.escapeSheetName(query.sheet);
    const a1 = `'${escapedSheet}'!${colLetter}${query.rowStart ?? startRow}:${colLetter}${endRow}`;

    const sheetInfo = await this.getSheetInfo(spreadsheetId, query.sheet);

    return {
      sheetId: sheetInfo.sheetId,
      sheetName: query.sheet,
      a1Notation: a1,
      gridRange: {
        sheetId: sheetInfo.sheetId,
        startColumnIndex: bestMatch.index,
        endColumnIndex: bestMatch.index + 1,
        startRowIndex: (query.rowStart ?? startRow) - 1,
        endRowIndex: query.rowEnd,
      },
      resolution: {
        method: 'semantic_header',
        confidence: bestMatch.confidence,
        path: `Matched "${query.column}" to header "${bestMatch.header}" (column ${colLetter})`,
        alternatives:
          matches.length > 1
            ? matches
                .filter((m) => m !== bestMatch)
                .map((m) => ({
                  a1Notation: `'${escapedSheet}'!${this.columnIndexToLetter(m.index)}:${this.columnIndexToLetter(m.index)}`,
                  reason: `Header "${m.header}" (${Math.round(m.confidence * 100)}% match)`,
                }))
            : undefined,
      },
    };
  }

  /**
   * Get headers for a sheet (cached)
   */
  private async getHeaders(spreadsheetId: string, sheetName: string): Promise<Map<string, number>> {
    const cacheKey = `${spreadsheetId}:${sheetName}`;
    const cached = this.headerCache.get(cacheKey);

    if (cached) {
      return cached.headers;
    }

    // Fetch first row with escaped sheet name
    const escapedSheet = this.escapeSheetName(sheetName);
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapedSheet}'!1:1`,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const headers = new Map<string, number>();
    const row = response.data.values?.[0] ?? [];

    for (let i = 0; i < row.length; i++) {
      const value = String(row[i] ?? '').trim();
      if (value) {
        headers.set(value, i);
      }
    }

    this.headerCache.set(cacheKey, {
      headers,
      timestamp: Date.now(),
    });

    return headers;
  }

  /**
   * Get sheet info by name
   */
  private async getSheetInfo(
    spreadsheetId: string,
    sheetName: string
  ): Promise<{ sheetId: number; title: string }> {
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheet = response.data.sheets?.find(
      (s) => s.properties?.title?.toLowerCase() === sheetName.toLowerCase()
    );

    if (!sheet?.properties) {
      const available = response.data.sheets?.map((s) => s.properties?.title) ?? [];
      throw new RangeResolutionError(`Sheet "${sheetName}" not found`, 'SHEET_NOT_FOUND', {
        available,
      });
    }

    return {
      sheetId: sheet.properties.sheetId ?? 0,
      title: sheet.properties.title ?? sheetName,
    };
  }

  /**
   * Convert A1 reference to grid range
   */
  private a1ToGridRange(sheetId: number, a1: string): GridRange {
    if (!a1) {
      return { sheetId };
    }

    const match = a1.match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
    if (!match) {
      return { sheetId };
    }

    const [, startCol, startRow, endCol, endRow] = match;

    return {
      sheetId,
      startColumnIndex: startCol ? this.letterToColumnIndex(startCol) : undefined,
      endColumnIndex: endCol
        ? this.letterToColumnIndex(endCol) + 1
        : startCol
          ? this.letterToColumnIndex(startCol) + 1
          : undefined,
      startRowIndex: startRow ? parseInt(startRow) - 1 : undefined,
      endRowIndex: endRow ? parseInt(endRow) : startRow ? parseInt(startRow) : undefined,
    };
  }

  /**
   * Convert grid range to A1 notation with escaped sheet name
   */
  private gridRangeToA1(sheetName: string, range: GridRange): string {
    // BUG-2/6/14 fix: Ensure output is always valid A1 notation (col+row pairs).
    // When only rows or only columns are specified, default the missing dimension
    // to prevent row-only notation like "'Sheet'!1:3" which fails downstream parsing.
    const hasRows = range.startRowIndex !== undefined || range.endRowIndex !== undefined;
    const hasCols = range.startColumnIndex !== undefined || range.endColumnIndex !== undefined;

    const startCol = range.startColumnIndex ?? (hasRows && !hasCols ? 0 : undefined);
    const endCol = range.endColumnIndex ?? (hasRows && !hasCols ? 27 : undefined); // A through AA
    const startRow = range.startRowIndex ?? (hasCols && !hasRows ? 0 : undefined);
    const endRow = range.endRowIndex ?? (hasCols && !hasRows ? 1000 : undefined);

    const parts: string[] = [];

    if (startCol !== undefined) {
      parts.push(this.columnIndexToLetter(startCol));
    }
    if (startRow !== undefined) {
      parts.push(String(startRow + 1));
    }

    if (endCol !== undefined || endRow !== undefined) {
      parts.push(':');
      if (endCol !== undefined) {
        parts.push(this.columnIndexToLetter(endCol - 1));
      }
      if (endRow !== undefined) {
        parts.push(String(endRow));
      }
    }

    const rangeStr = parts.join('');
    const escapedSheet = this.escapeSheetName(sheetName);
    return rangeStr ? `'${escapedSheet}'!${rangeStr}` : `'${escapedSheet}'`;
  }

  /**
   * Convert column letter to 0-based index
   */
  private letterToColumnIndex(letter: string): number {
    let index = 0;
    const upper = letter.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
      index = index * 26 + (upper.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  /**
   * Convert 0-based index to column letter
   */
  private columnIndexToLetter(index: number): string {
    let letter = '';
    let temp = index + 1;
    while (temp > 0) {
      const mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  }

  /**
   * Clear header cache
   */
  clearCache(): void {
    this.headerCache.clear();
  }

  /**
   * Invalidate cache for a specific spreadsheet
   */
  invalidateSpreadsheet(spreadsheetId: string): void {
    // Remove all entries for this spreadsheet
    for (const key of this.headerCache.keys()) {
      if (key.startsWith(`${spreadsheetId}:`)) {
        this.headerCache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; max: number; hitRate: number } {
    const size = this.headerCache.size;
    const max = this.headerCache.max;

    // Calculate approximate hit rate from cache size vs max
    // In a well-utilized cache, size approaching max indicates good hit rate
    const hitRate = max > 0 ? (size / max) * 100 : 0;

    return {
      size,
      max,
      hitRate: Math.min(hitRate, 100),
    };
  }
}
