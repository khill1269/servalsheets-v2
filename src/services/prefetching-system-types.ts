/**
 * Shared type definitions for prefetching system.
 */

export interface PrefetchOptions {
  /** Enable/disable prefetching (default: true) */
  enabled?: boolean;
  /** Maximum concurrent prefetch requests (default: 2) */
  concurrency?: number;
  /** Minimum confidence threshold for prefetching (default: 0.5) */
  minConfidence?: number;
  /** Enable background refresh (default: true) */
  backgroundRefresh?: boolean;
  /** Refresh TTL threshold in ms (default: 60000 = 1 min before expiry) */
  refreshThreshold?: number;
}

export interface PrefetchTask {
  spreadsheetId: string;
  range?: string;
  sheetId?: number;
  comprehensive?: boolean;
  confidence: number;
  reason: string;
  priority: number;
}

export interface RefreshTask {
  cacheKey: string;
  spreadsheetId: string;
  range?: string;
  sheetId?: number;
  comprehensive?: boolean;
  priority: number;
  lastAccessed: number;
  accessCount: number;
}

export interface RefreshMetadata {
  spreadsheetId: string;
  range?: string;
  comprehensive?: boolean;
  lastAccessed: number;
  accessCount: number;
}

export interface PrefetchStats {
  totalPrefetches: number;
  successfulPrefetches: number;
  failedPrefetches: number;
  cacheHitsFromPrefetch: number;
  prefetchHitRate: number;
  totalRefreshes: number;
  successfulRefreshes: number;
  failedRefreshes: number;
  refreshHitRate: number;
  failureRate: number;
  circuitOpen: boolean;
}
