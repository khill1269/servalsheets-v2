/**
 * Cached Google Sheets API
 *
 * Wraps Google Sheets API calls with TTL-based caching for read operations.
 * Provides 30-50% API reduction by caching frequently accessed data.
 *
 * @purpose Reduce API quota usage via smart caching
 * @category Performance
 * @dependencies etag-cache, google-api, logger
 *
 * @example
 * const cached = getCachedSheetsApi(sheetsApi);
 * const metadata = await cached.getSpreadsheet(spreadsheetId); // Cached for 5 min
 * const values = await cached.getValues(spreadsheetId, 'Sheet1!A1:D10'); // Cached
 */

import type { sheets_v4 } from 'googleapis';
import type { RequestMerger } from './request-merger.js';
import { getETagCache } from './etag-cache.js';
import { getCacheInvalidationGraph } from './cache-invalidation-graph.js';
import { extractETag, is304NotModified } from '../utils/etag-helpers.js';
import { logger } from '../utils/logger.js';
import { cacheHitsTotal, cacheMissesTotal } from '../observability/metrics.js';
import { getTracer } from '../utils/tracing.js';
import { getAccessPatternTracker } from './access-pattern-tracker.js';
import { getEnv } from '../config/env.js';

/**
 * Statistics for cached API operations
 */
export interface CachedApiStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  savedApiCalls: number;
}

/**
 * Cached Sheets API wrapper
 * Uses TTL-based caching to reduce API calls for read operations.
 */
export class CachedSheetsApi {
  private sheetsApi: sheets_v4.Sheets;
  private requestMerger?: RequestMerger;
  private cache = getETagCache();
  private accessTracker = getAccessPatternTracker();
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  // Lightweight existence cache: spreadsheetId → expiry timestamp.
  // Populated by ensureSpreadsheetExists(). Prevents wasted quota on 404s
  // by catching bad IDs before expensive mutation API calls (Fix 2).
  private knownSpreadsheets = new Map<string, number>();
  private static readonly EXISTENCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(sheetsApi: sheets_v4.Sheets, requestMerger?: RequestMerger) {
    this.sheetsApi = sheetsApi;
    this.requestMerger = requestMerger;
  }

  /**
   * Get spreadsheet metadata with caching
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param options - Additional options (includeGridData, ranges, fields)
   * @returns Spreadsheet metadata (from cache if available)
   */
  async getSpreadsheet(
    spreadsheetId: string,
    options: {
      includeGridData?: boolean;
      ranges?: string[];
      fields?: string;
    } = {}
  ): Promise<sheets_v4.Schema$Spreadsheet> {
    const span = getTracer().startSpan('cached-sheets-api.getSpreadsheet', {
      kind: 'internal',
      attributes: { 'spreadsheet.id': spreadsheetId },
    });
    this.stats.totalRequests++;

    const cacheKey = {
      spreadsheetId,
      endpoint: 'metadata' as const,
      params: options,
    };

    // Check if conditional requests are enabled (Priority 9)
    const conditionalRequestsEnabled = getEnv().ENABLE_CONDITIONAL_REQUESTS;

    if (conditionalRequestsEnabled) {
      // Try conditional request with If-None-Match header
      const cachedETag = this.cache.getETag(cacheKey);

      if (cachedETag) {
        try {
          // Make conditional request with If-None-Match
          const response = await this.sheetsApi.spreadsheets.get(
            {
              spreadsheetId,
              includeGridData: options.includeGridData,
              ranges: options.ranges,
              fields: options.fields,
            },
            { headers: { 'If-None-Match': cachedETag } }
          );

          // 200 OK - Data changed, update cache with new ETag
          this.stats.cacheMisses++;
          cacheMissesTotal.inc({ namespace: 'etag' });
          const newETag = extractETag(response);
          if (newETag) {
            await this.cache.setETag(cacheKey, newETag, response.data);
          }

          return response.data;
        } catch (error: unknown) {
          // Check for 304 Not Modified
          if (is304NotModified(error)) {
            this.stats.cacheHits++;
            cacheHitsTotal.inc({ namespace: 'etag' });
            const cachedData = (await this.cache.getCachedData(
              cacheKey
            )) as sheets_v4.Schema$Spreadsheet | null;

            if (cachedData) {
              logger.debug('304 Not Modified - using cached metadata', {
                spreadsheetId,
                quotaSaved: true,
              });
              // 16-A3/A4: Record access pattern for prefetching
              this.recordAccessPattern(spreadsheetId, 'metadata');
              span.end();
              return cachedData;
            }

            // No cached data, fall through to full request
            logger.warn('304 but no cached data, refetching', { spreadsheetId });
          }

          // Other errors fall through to regular request below
        }
      }
    }

    // Check local cache (L1/L2)
    const cached = (await this.cache.getCachedData(
      cacheKey
    )) as sheets_v4.Schema$Spreadsheet | null;
    if (cached) {
      this.stats.cacheHits++;
      cacheHitsTotal.inc({ namespace: 'local' });
      logger.debug('Cache hit for spreadsheet metadata', {
        spreadsheetId,
        savedApiCall: true,
      });
      // 16-A3/A4: Record access pattern for prefetching
      this.recordAccessPattern(spreadsheetId, 'metadata');
      span.end();
      return cached;
    }

    // Cache miss - fetch from API
    this.stats.cacheMisses++;
    cacheMissesTotal.inc({ namespace: 'local' });
    const response = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      includeGridData: options.includeGridData,
      ranges: options.ranges,
      fields: options.fields,
    });

    // Cache with real ETag if available, otherwise use timestamp
    const etag = extractETag(response) || `cached-${Date.now()}`;
    await this.cache.setETag(cacheKey, etag, response.data);

    // 16-A3/A4: Record access pattern after API call
    this.recordAccessPattern(spreadsheetId, 'metadata');
    span.end();
    return response.data;
  }

  /**
   * Get cell values with caching
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param range - A1 notation range
   * @param options - Value render options
   * @returns Values array (from cache if available)
   */
  async getValues(
    spreadsheetId: string,
    range: string,
    options: {
      valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
      dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
      majorDimension?: 'ROWS' | 'COLUMNS';
    } = {}
  ): Promise<sheets_v4.Schema$ValueRange> {
    const span = getTracer().startSpan('cached-sheets-api.getValues', {
      kind: 'internal',
      attributes: { 'spreadsheet.id': spreadsheetId, range: range },
    });
    this.stats.totalRequests++;

    const cacheKey = {
      spreadsheetId,
      endpoint: 'values' as const,
      range,
      params: options,
    };

    // Check if conditional requests are enabled (Priority 9)
    const conditionalRequestsEnabled = getEnv().ENABLE_CONDITIONAL_REQUESTS;

    if (conditionalRequestsEnabled) {
      // Try conditional request with If-None-Match header
      const cachedETag = this.cache.getETag(cacheKey);

      if (cachedETag) {
        try {
          // Make conditional request with If-None-Match
          const response = await this.sheetsApi.spreadsheets.values.get(
            {
              spreadsheetId,
              range,
              valueRenderOption: options.valueRenderOption,
              dateTimeRenderOption: options.dateTimeRenderOption,
              majorDimension: options.majorDimension,
            },
            { headers: { 'If-None-Match': cachedETag } }
          );

          // 200 OK - Data changed, update cache with new ETag
          this.stats.cacheMisses++;
          cacheMissesTotal.inc({ namespace: 'etag' });
          const newETag = extractETag(response);
          if (newETag) {
            await this.cache.setETag(cacheKey, newETag, response.data);
          }

          return response.data;
        } catch (error: unknown) {
          // Check for 304 Not Modified
          if (is304NotModified(error)) {
            this.stats.cacheHits++;
            cacheHitsTotal.inc({ namespace: 'etag' });
            const cachedData = (await this.cache.getCachedData(
              cacheKey
            )) as sheets_v4.Schema$ValueRange | null;

            if (cachedData) {
              logger.debug('304 Not Modified - using cached values', {
                spreadsheetId,
                range,
                quotaSaved: true,
              });
              // 16-A3/A4: Record access pattern for prefetching
              this.recordAccessPattern(spreadsheetId, range);
              span.end();
              return cachedData;
            }

            // No cached data, fall through to full request
            logger.warn('304 but no cached data, refetching', { spreadsheetId, range });
          }

          // Other errors fall through to regular request below
        }
      }
    }

    // Check local cache (L1/L2)
    const cached = (await this.cache.getCachedData(cacheKey)) as sheets_v4.Schema$ValueRange | null;
    if (cached) {
      this.stats.cacheHits++;
      cacheHitsTotal.inc({ namespace: 'local' });
      logger.debug('Cache hit for values', {
        spreadsheetId,
        range,
        savedApiCall: true,
      });
      // 16-A3/A4: Record access pattern for prefetching
      this.recordAccessPattern(spreadsheetId, range);
      span.end();
      return cached;
    }

    // Cache miss - fetch from API
    this.stats.cacheMisses++;
    cacheMissesTotal.inc({ namespace: 'local' });

    // Use RequestMerger for overlapping range optimization (20-40% API savings)
    // Falls back to direct call when dateTimeRenderOption is set (merger doesn't support it)
    let valueData: sheets_v4.Schema$ValueRange;
    if (this.requestMerger && !options.dateTimeRenderOption) {
      valueData = await this.requestMerger.mergeRead(this.sheetsApi, spreadsheetId, range, {
        valueRenderOption: options.valueRenderOption,
        majorDimension: options.majorDimension,
      });
    } else {
      const response = await this.sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: options.valueRenderOption,
        dateTimeRenderOption: options.dateTimeRenderOption,
        majorDimension: options.majorDimension,
      });
      // Cache with real ETag if available
      const etag = extractETag(response) || `cached-${Date.now()}`;
      await this.cache.setETag(cacheKey, etag, response.data);
      valueData = response.data;
    }

    // 16-A3/A4: Record access pattern after API call
    this.recordAccessPattern(spreadsheetId, range);
    span.end();
    return valueData;
  }

  /**
   * Batch get values with caching and de-duplication
   *
   * De-duplicates ranges within the same batch to avoid fetching
   * the same range multiple times. Maps de-duplicated results back
   * to original order.
   */
  async batchGetValues(
    spreadsheetId: string,
    ranges: string[],
    options: {
      valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
      dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
      majorDimension?: 'ROWS' | 'COLUMNS';
    } = {}
  ): Promise<sheets_v4.Schema$BatchGetValuesResponse> {
    const span = getTracer().startSpan('cached-sheets-api.batchGetValues', {
      kind: 'internal',
      attributes: { 'spreadsheet.id': spreadsheetId, 'ranges.count': ranges.length },
    });
    this.stats.totalRequests++;

    // De-duplicate ranges to avoid fetching same range multiple times
    const uniqueRanges = Array.from(new Set(ranges));
    const duplicatesEliminated = ranges.length - uniqueRanges.length;

    if (duplicatesEliminated > 0) {
      logger.debug('De-duplicated batch request', {
        originalCount: ranges.length,
        uniqueCount: uniqueRanges.length,
        duplicatesEliminated,
        efficiencyGain: `${((duplicatesEliminated / ranges.length) * 100).toFixed(1)}%`,
      });
    }

    const cacheKey = {
      spreadsheetId,
      endpoint: 'values' as const,
      range: uniqueRanges.sort().join(','),
      params: options,
    };

    // Check cache first
    const cached = (await this.cache.getCachedData(
      cacheKey
    )) as sheets_v4.Schema$BatchGetValuesResponse | null;
    if (cached) {
      this.stats.cacheHits++;
      cacheHitsTotal.inc({ namespace: 'local' });
      logger.debug('Cache hit for batchGet', {
        spreadsheetId,
        rangeCount: uniqueRanges.length,
        savedApiCall: true,
      });
      // 16-A3/A4: Record access patterns for each range
      uniqueRanges.forEach((r) => this.recordAccessPattern(spreadsheetId, r));
      // Map cached results back to original order if duplicates existed
      if (duplicatesEliminated > 0) {
        span.end();
        return this.remapBatchResults(cached, ranges, uniqueRanges);
      }
      span.end();
      return cached;
    }

    // Cache miss - fetch from API with de-duplicated ranges
    this.stats.cacheMisses++;
    const response = await this.sheetsApi.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: uniqueRanges,
      valueRenderOption: options.valueRenderOption,
      dateTimeRenderOption: options.dateTimeRenderOption,
      majorDimension: options.majorDimension,
    });

    // Cache with real ETag if available, otherwise use timestamp
    const etag = extractETag(response) || `cached-${Date.now()}`;
    await this.cache.setETag(cacheKey, etag, response.data);

    // 16-A3/A4: Record access patterns for each range
    uniqueRanges.forEach((r) => this.recordAccessPattern(spreadsheetId, r));

    // Map results back to original order if duplicates existed
    if (duplicatesEliminated > 0) {
      span.end();
      return this.remapBatchResults(response.data, ranges, uniqueRanges);
    }

    span.end();
    return response.data;
  }

  /**
   * Remap de-duplicated batch results back to original range order
   * @private
   */
  private remapBatchResults(
    response: sheets_v4.Schema$BatchGetValuesResponse,
    originalRanges: string[],
    uniqueRanges: string[]
  ): sheets_v4.Schema$BatchGetValuesResponse {
    if (!response.valueRanges) {
      return response;
    }

    // Create lookup map from unique ranges to their results
    const resultMap = new Map<string, sheets_v4.Schema$ValueRange>();
    uniqueRanges.forEach((range, index) => {
      const valueRange = response.valueRanges?.[index];
      if (valueRange) {
        resultMap.set(range, valueRange);
      }
    });

    // Map back to original order (including duplicates)
    const remappedValueRanges = originalRanges.map((range) => {
      const result = resultMap.get(range);
      if (!result) {
        // Shouldn't happen, but return empty range if missing
        return { range, values: [] };
      }
      return result;
    });

    return {
      ...response,
      valueRanges: remappedValueRanges,
    };
  }

  /**
   * 16-A3/A4: Record access pattern for predictive prefetching
   *
   * Tracks spreadsheet/sheet/range sequences to enable pattern-based prefetching.
   * Non-blocking: errors are logged but don't affect the cache operation.
   */
  private recordAccessPattern(spreadsheetId: string, range: string): void {
    try {
      this.accessTracker.recordAccess({
        spreadsheetId,
        range,
        action: 'read',
      });
    } catch (error) {
      // Non-blocking: access tracking is best-effort optimization
      logger.debug('Failed to record access pattern', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Assert that a spreadsheet exists before performing a mutation.
   *
   * Performs a minimal metadata GET (`fields: 'spreadsheetId'`) on first access
   * and caches the positive result for 5 minutes. Subsequent calls within the TTL
   * return immediately (cache hit). On 404, throws immediately without consuming
   * quota on the mutation call itself (Fix 2).
   *
   * Call this at the start of any write operation that targets a user-provided
   * spreadsheetId to convert silent 404 quota-waste into a fast local throw.
   */
  async ensureSpreadsheetExists(spreadsheetId: string): Promise<void> {
    const expiry = this.knownSpreadsheets.get(spreadsheetId);
    if (expiry !== undefined && Date.now() < expiry) return; // cache hit

    // Minimal-field GET — cheapest possible existence probe
    await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId',
    });

    this.knownSpreadsheets.set(spreadsheetId, Date.now() + CachedSheetsApi.EXISTENCE_TTL_MS);
    logger.debug('Spreadsheet existence confirmed and cached', { spreadsheetId });
  }

  /**
   * Invalidate cache after write operations
   *
   * Call this after any mutation (write, update, delete) to ensure
   * subsequent reads get fresh data.
   */
  async invalidateSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.cache.invalidateSpreadsheet(spreadsheetId);
    this.knownSpreadsheets.delete(spreadsheetId); // also clear existence cache
    logger.debug('Cache invalidated after mutation', { spreadsheetId });
  }

  /**
   * Selective cache invalidation using invalidation graph
   *
   * Only invalidates cache entries affected by the specific operation,
   * improving cache hit rate by preserving unaffected data.
   *
   * @param spreadsheetId - Spreadsheet ID
   * @param tool - Tool name (e.g., 'sheets_data')
   * @param action - Action name (e.g., 'write')
   *
   * @example
   * // After formatting operation, only format cache is invalidated
   * await cached.invalidateSelective(id, 'sheets_format', 'set_format');
   * // Values and metadata caches remain valid
   */
  async invalidateSelective(spreadsheetId: string, tool: string, action: string): Promise<void> {
    const graph = getCacheInvalidationGraph();
    const patterns = graph.getInvalidationKeys(tool, action);

    logger.debug('Selective cache invalidation', {
      spreadsheetId,
      operation: `${tool}.${action}`,
      patterns,
      cascade: graph.shouldCascade(tool, action),
    });

    // Get all cache keys for this spreadsheet
    const allKeys = await this.cache.getKeysForSpreadsheet(spreadsheetId);

    // Match patterns and invalidate
    const keysToInvalidate = graph.getKeysToInvalidate(tool, action, allKeys);

    for (const key of keysToInvalidate) {
      await this.cache.invalidateKey(key);
    }

    logger.info('Selective invalidation complete', {
      spreadsheetId,
      operation: `${tool}.${action}`,
      invalidatedKeys: keysToInvalidate.length,
      preservedKeys: allKeys.length - keysToInvalidate.length,
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CachedApiStats {
    const hitRate =
      this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0;

    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100,
      savedApiCalls: this.stats.cacheHits,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Get underlying Sheets API for operations not yet cached
   */
  get raw(): sheets_v4.Sheets {
    return this.sheetsApi;
  }
}

// Singleton instance
let instance: CachedSheetsApi | null = null;

/**
 * Get or create cached Sheets API singleton
 */
export function getCachedSheetsApi(
  sheetsApi: sheets_v4.Sheets,
  requestMerger?: RequestMerger
): CachedSheetsApi {
  if (!instance) {
    instance = new CachedSheetsApi(sheetsApi, requestMerger);
  }
  return instance;
}

/**
 * Reset cached API (for testing)
 */
export function resetCachedSheetsApi(): void {
  instance = null;
}
