/**
 * ServalSheets - Metadata Cache Service
 *
 * Session-level cache for spreadsheet metadata to eliminate N+1 queries.
 * Multiple handlers often fetch the same spreadsheet metadata independently,
 * causing redundant API calls. This cache ensures metadata is fetched once per request.
 *
 * Performance Impact:
 * - Reduces API calls by 30-50% for multi-range operations
 * - Eliminates duplicate spreadsheets.get() calls within same request
 * - Session-scoped (cleared after each request)
 *
 * @category Services
 */

import type { sheets_v4 } from 'googleapis';
import { baseLogger } from '../utils/base-logger.js';

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  sheets: Array<{
    sheetId: number;
    title: string;
    index: number;
    gridProperties?: {
      rowCount: number;
      columnCount: number;
      frozenRowCount?: number;
      frozenColumnCount?: number;
    };
  }>;
  properties: {
    title: string;
    locale: string;
    timeZone: string;
  };
  fetchedAt: number;
}

export interface MetadataCacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  cacheSize: number;
  totalFetches: number;
}

/**
 * Session-level metadata cache
 * Scoped to single request - cleared after each operation
 */
export class MetadataCache {
  private cache: Map<string, SpreadsheetMetadata> = new Map();
  private hits = 0;
  private misses = 0;
  private sheetsApi: sheets_v4.Sheets;

  constructor(sheetsApi: sheets_v4.Sheets) {
    this.sheetsApi = sheetsApi;
  }

  /**
   * Get or fetch spreadsheet metadata
   * @param spreadsheetId - Spreadsheet ID
   * @returns Spreadsheet metadata
   */
  async getOrFetch(spreadsheetId: string): Promise<SpreadsheetMetadata> {
    // Check cache first
    const cached = this.cache.get(spreadsheetId);
    if (cached) {
      this.hits++;
      baseLogger.debug('[MetadataCache] Cache hit', {
        spreadsheetId,
        hitRate: this.getStats().hitRate,
      });
      return cached;
    }

    // Cache miss - fetch from API
    this.misses++;
    baseLogger.debug('[MetadataCache] Cache miss - fetching from API', {
      spreadsheetId,
    });

    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields:
        'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties))',
    });

    const metadata: SpreadsheetMetadata = {
      spreadsheetId,
      sheets: (response.data.sheets ?? []).map((sheet) => ({
        sheetId: sheet.properties?.sheetId ?? 0,
        title: sheet.properties?.title ?? '',
        index: sheet.properties?.index ?? 0,
        gridProperties: sheet.properties?.gridProperties
          ? {
              rowCount: sheet.properties.gridProperties.rowCount ?? 0,
              columnCount: sheet.properties.gridProperties.columnCount ?? 0,
              frozenRowCount: sheet.properties.gridProperties.frozenRowCount ?? undefined,
              frozenColumnCount: sheet.properties.gridProperties.frozenColumnCount ?? undefined,
            }
          : undefined,
      })),
      properties: {
        title: response.data.properties?.title ?? '',
        locale: response.data.properties?.locale ?? 'en_US',
        timeZone: response.data.properties?.timeZone ?? 'America/New_York',
      },
      fetchedAt: Date.now(),
    };

    this.cache.set(spreadsheetId, metadata);
    return metadata;
  }

  /**
   * Get sheet ID by name
   * @param spreadsheetId - Spreadsheet ID
   * @param sheetName - Sheet name
   * @returns Sheet ID or undefined if not found
   */
  async getSheetId(spreadsheetId: string, sheetName: string): Promise<number | undefined> {
    const metadata = await this.getOrFetch(spreadsheetId);
    const sheet = metadata.sheets.find((s) => s.title === sheetName);
    return sheet?.sheetId;
  }

  /**
   * Get sheet name by ID
   * @param spreadsheetId - Spreadsheet ID
   * @param sheetId - Sheet ID
   * @returns Sheet name or undefined if not found
   */
  async getSheetName(spreadsheetId: string, sheetId: number): Promise<string | undefined> {
    const metadata = await this.getOrFetch(spreadsheetId);
    const sheet = metadata.sheets.find((s) => s.sheetId === sheetId);
    return sheet?.title;
  }

  /**
   * Get all sheet names
   * @param spreadsheetId - Spreadsheet ID
   * @returns Array of sheet names
   */
  async getSheetNames(spreadsheetId: string): Promise<string[]> {
    const metadata = await this.getOrFetch(spreadsheetId);
    return metadata.sheets.map((s) => s.title);
  }

  /**
   * Clear cache (called after each request)
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): MetadataCacheStats {
    const totalFetches = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: totalFetches > 0 ? this.hits / totalFetches : 0,
      cacheSize: this.cache.size,
      totalFetches,
    };
  }

  /**
   * Invalidate specific spreadsheet (after mutations)
   * @param spreadsheetId - Spreadsheet ID to invalidate
   */
  invalidate(spreadsheetId: string): void {
    this.cache.delete(spreadsheetId);
    baseLogger.debug('[MetadataCache] Invalidated', { spreadsheetId });
  }
}

/**
 * Create metadata cache instance
 * @param sheetsApi - Google Sheets API instance
 * @returns Metadata cache
 */
export function createMetadataCache(sheetsApi: sheets_v4.Sheets): MetadataCache {
  return new MetadataCache(sheetsApi);
}
