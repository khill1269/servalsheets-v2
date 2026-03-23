/**
 * ServalSheets - ETag Helpers
 *
 * Helper functions for integrating ETag support with Google API calls.
 * Simplifies conditional request implementation in handlers.
 *
 * @category Utils
 */

import { getETagCache, type ETagCache } from '../services/etag-cache.js';
import { logger } from './logger.js';
import type { GaxiosResponse } from 'gaxios';

/**
 * Extract ETag from Google API response
 *
 * Google API returns ETags in response headers as:
 * - etag: "abc123" (standard)
 * - ETag: "abc123" (alternative casing)
 *
 * Accepts any response type (GaxiosResponse, GaxiosResponseWithHTTP2, etc.)
 * since we only access the headers property which is common to all.
 *
 * @param response - Google API response (any type with headers)
 * @returns ETag string or null if not present
 */
export function extractETag(response: { headers?: unknown }): string | null {
  const headers = response.headers as unknown as Record<string, unknown>;
  const etag = headers?.['etag'] || headers?.['ETag'];
  return typeof etag === 'string' ? etag : null;
}

/**
 * Add If-None-Match header for conditional GET request
 *
 * Modifies request headers to include ETag for conditional request.
 * If server returns 304, the cached data is still valid.
 *
 * @param headers - Request headers object
 * @param etag - ETag from cache
 * @returns Modified headers object
 */
export function addIfNoneMatchHeader(
  headers: Record<string, string> | undefined,
  etag: string
): Record<string, string> {
  const requestHeaders = headers || {};

  // Add If-None-Match header
  requestHeaders['If-None-Match'] = etag;

  logger.debug('Added If-None-Match header', {
    etag: etag.substring(0, 16),
  });

  return requestHeaders;
}

/**
 * Check if response is 304 Not Modified
 *
 * @param response - Google API response or error
 * @returns true if 304 Not Modified
 */
export function is304NotModified(response: unknown): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  const r = response as {
    status?: number;
    response?: { status?: number };
    code?: string | number;
  };
  // Primary: .status getter (gaxios v4+ returns response.status via getter)
  // Fallback: .response.status (reliable across all gaxios versions)
  // Final: .code as string "304" (older gaxios sets error.code = HTTP status string)
  const status = r.status ?? r.response?.status;
  const code = r.code;
  return status === 304 || code === '304' || code === 304;
}

/**
 * Helper for ETag-aware GET requests
 *
 * Wraps a Google API GET call with ETag support:
 * 1. Checks cache for existing ETag
 * 2. Adds If-None-Match header if ETag exists
 * 3. Handles 304 responses by returning cached data
 * 4. Caches new ETags from 200 responses
 *
 * @param cacheKey - ETag cache key
 * @param apiCall - Function that makes the Google API call
 * @param options - Optional configuration
 * @returns API response or cached data
 */
export async function withETag<T>(
  cacheKey: {
    spreadsheetId: string;
    endpoint: 'metadata' | 'values' | 'properties' | 'sheets';
    range?: string;
    params?: Record<string, unknown>;
  },
  apiCall: (headers?: Record<string, string>) => Promise<GaxiosResponse<T>>,
  options: {
    cache?: ETagCache;
    enableCache?: boolean;
  } = {}
): Promise<GaxiosResponse<T>> {
  const cache = options.cache ?? getETagCache();
  const enableCache = options.enableCache ?? true;

  if (!enableCache) {
    // Cache disabled, make direct call
    return apiCall();
  }

  // Check for cached ETag
  const cachedETag = cache.getETag(cacheKey);

  try {
    if (cachedETag) {
      // Make conditional request with If-None-Match
      const headers = addIfNoneMatchHeader({}, cachedETag);

      try {
        const response = await apiCall(headers);

        // 200 OK - Data changed, cache new ETag
        const newETag = extractETag(response);
        if (newETag) {
          cache.setETag(cacheKey, newETag, response.data);
        }

        return response;
      } catch (error: unknown) {
        // Check for 304 Not Modified
        if (is304NotModified(error)) {
          logger.info('304 Not Modified - using cached data', {
            spreadsheetId: cacheKey.spreadsheetId,
            endpoint: cacheKey.endpoint,
            range: cacheKey.range,
          });

          // Return cached data (with original ETag)
          const cachedData = cache.getCachedData(cacheKey) as T;

          if (cachedData) {
            // Construct a minimal response with cached data
            // Type assertion is safe here since we're simulating a successful API response
            return {
              data: cachedData,
              status: 200,
              statusText: 'OK (from cache)',
              headers: { etag: cachedETag },
              config: { url: '', method: 'GET' },
            } as unknown as GaxiosResponse<T>;
          }

          // No cached data, make unconditional request
          logger.warn('304 but no cached data - falling back to full request', {
            spreadsheetId: cacheKey.spreadsheetId,
          });

          const response = await apiCall();
          const newETag = extractETag(response);
          if (newETag) {
            cache.setETag(cacheKey, newETag, response.data);
          }

          return response;
        }

        // Other error, re-throw
        throw error;
      }
    }

    // No cached ETag, make unconditional request
    const response = await apiCall();
    const etag = extractETag(response);

    if (etag) {
      cache.setETag(cacheKey, etag, response.data);
    }

    return response;
  } catch (error) {
    // Log API error before re-throwing
    logger.debug('ETag-aware request failed', {
      spreadsheetId: cacheKey.spreadsheetId,
      endpoint: cacheKey.endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Invalidate ETags after mutation
 *
 * Call this after any write/update/delete operation to ensure
 * the next GET request fetches fresh data.
 *
 * @param spreadsheetId - Spreadsheet to invalidate
 * @param cache - Optional cache instance (defaults to singleton)
 */
export function invalidateETagsForSpreadsheet(spreadsheetId: string, cache?: ETagCache): void {
  const etagCache = cache ?? getETagCache();
  etagCache.invalidateSpreadsheet(spreadsheetId);

  logger.debug('Invalidated ETags after mutation', { spreadsheetId });
}
