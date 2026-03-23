import { createCacheKey } from '../utils/cache-manager.js';
import type { PrefetchTask, RefreshMetadata, RefreshTask } from './prefetching-system-types.js';

interface ParsedCacheKey {
  spreadsheetId: string;
  range?: string;
  comprehensive?: boolean;
}

/**
 * Updates metadata map and prunes oldest entries when size limit is exceeded.
 */
export function updateRefreshMetadata(
  refreshMetadata: Map<string, RefreshMetadata>,
  cacheKey: string,
  metadata: RefreshMetadata,
  maxSize = 1000,
  pruneCount = 100
): void {
  const existing = refreshMetadata.get(cacheKey);
  if (existing) {
    existing.accessCount++;
    existing.lastAccessed = metadata.lastAccessed;
  } else {
    refreshMetadata.set(cacheKey, metadata);
  }

  if (refreshMetadata.size > maxSize) {
    const entries = Array.from(refreshMetadata.entries());
    entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toRemove = entries.slice(0, pruneCount);
    toRemove.forEach(([key]) => refreshMetadata.delete(key));
  }
}

/**
 * Records success/failure into circular buffer and returns updated index/rate.
 */
export function updateFailureWindow(
  failureWindow: boolean[],
  failureIndex: number,
  success: boolean
): { failureIndex: number; failureRate: number } {
  failureWindow[failureIndex] = success;
  const nextIndex = (failureIndex + 1) % failureWindow.length;
  const failures = failureWindow.filter((value) => !value).length;
  const failureRate = failures / failureWindow.length;

  return {
    failureIndex: nextIndex,
    failureRate,
  };
}

/**
 * Calculate refresh priority based on access patterns.
 */
export function calculateRefreshPriority(
  accessCount: number,
  lastAccessed: number,
  expiresIn: number
): number {
  const frequencyScore = Math.min(5, accessCount);
  const ageMs = Date.now() - lastAccessed;
  const recencyScore = ageMs < 60000 ? 3 : ageMs < 300000 ? 2 : ageMs < 600000 ? 1 : 0;
  const urgencyScore = expiresIn < 30000 ? 2 : expiresIn < 60000 ? 1 : expiresIn < 120000 ? 0.5 : 0;
  const priority = Math.min(10, frequencyScore + recencyScore + urgencyScore);
  return Math.round(priority);
}

/**
 * Parses cache key to reconstruct request identity.
 */
export function parseCacheKey(cacheKey: string): ParsedCacheKey | null {
  try {
    const key = cacheKey.includes(':') ? cacheKey.substring(cacheKey.indexOf(':') + 1) : cacheKey;

    if (key.includes('spreadsheet:comprehensive')) {
      const match = key.match(/spreadsheetId="([^"]+)"/);
      if (match?.[1]) {
        return {
          spreadsheetId: match[1],
          comprehensive: true,
        };
      }
    }

    const params: Record<string, string> = {};
    const parts = key.split('&');

    for (const part of parts) {
      const [paramKey, paramValue] = part.split('=');
      if (paramKey && paramValue) {
        params[paramKey] = paramValue.replace(/^"(.*)"$/, '$1');
      }
    }

    let spreadsheetId = params['spreadsheetId'];
    if (!spreadsheetId && parts[0]) {
      const firstPart = parts[0];
      if (firstPart.includes(':')) {
        const afterColon = firstPart.split(':').pop();
        if (afterColon && !afterColon.includes('=')) {
          spreadsheetId = afterColon;
        }
      }
    }

    if (!spreadsheetId) {
      return null;
    }

    return {
      spreadsheetId,
      range: params['range'],
      comprehensive: params['type'] === 'metadata',
    };
  } catch {
    return null;
  }
}

/**
 * Creates a refresh task from existing metadata or fallback key parsing.
 */
export function createRefreshTaskFromCacheKey(
  cacheKey: string,
  expiresIn: number,
  metadata?: RefreshMetadata
): RefreshTask | null {
  if (metadata) {
    return {
      cacheKey,
      spreadsheetId: metadata.spreadsheetId,
      range: metadata.range,
      comprehensive: metadata.comprehensive,
      priority: calculateRefreshPriority(metadata.accessCount, metadata.lastAccessed, expiresIn),
      lastAccessed: metadata.lastAccessed,
      accessCount: metadata.accessCount,
    };
  }

  const parsed = parseCacheKey(cacheKey);
  if (!parsed) {
    return null;
  }

  return {
    cacheKey,
    spreadsheetId: parsed.spreadsheetId,
    range: parsed.range,
    comprehensive: parsed.comprehensive,
    priority: calculateRefreshPriority(1, Date.now(), expiresIn),
    lastAccessed: Date.now(),
    accessCount: 1,
  };
}

/**
 * Builds cache key for a prefetch task.
 */
export function getPrefetchCacheKey(task: PrefetchTask): string {
  if (task.range) {
    return createCacheKey(task.spreadsheetId, {
      range: task.range,
      type: 'values',
    });
  }
  if (task.comprehensive) {
    return createCacheKey('spreadsheet:comprehensive', {
      spreadsheetId: task.spreadsheetId,
    });
  }
  return createCacheKey(task.spreadsheetId, { type: 'metadata' });
}
