/**
 * ServalSheets - Cache Resources
 *
 * Exposes cache statistics as MCP resources for monitoring and optimization.
 * Phase 1, Task 1.5
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cacheManager } from '../utils/cache-manager.js';
import { requestDeduplicator } from '../utils/request-deduplication.js';

/**
 * Register cache resources with the MCP server
 */
export function registerCacheResources(server: McpServer): number {
  // Resource: cache://stats - Cache statistics
  server.registerResource(
    'Cache Statistics',
    'cache://stats',
    {
      description: 'Cache performance metrics: hit rate, size, entries, and namespace breakdown',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = cacheManager.getStats();

        // Convert byte sizes to human-readable format
        const totalSizeMB = (stats.totalSize / 1024 / 1024).toFixed(2);
        const totalSizeKB = (stats.totalSize / 1024).toFixed(2);
        const displaySize =
          stats.totalSize > 1024 * 1024 ? `${totalSizeMB} MB` : `${totalSizeKB} KB`;

        // Calculate additional metrics
        const totalRequests = stats.hits + stats.misses;
        const avgEntrySize =
          stats.totalEntries > 0 ? (stats.totalSize / stats.totalEntries / 1024).toFixed(2) : '0';

        // Format timestamps
        const oldestEntryDate = stats.oldestEntry
          ? new Date(stats.oldestEntry).toISOString()
          : null;
        const newestEntryDate = stats.newestEntry
          ? new Date(stats.newestEntry).toISOString()
          : null;

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats: {
                    // Core metrics
                    totalEntries: stats.totalEntries,
                    totalSize: stats.totalSize,
                    totalSizeFormatted: displaySize,
                    avgEntrySizeKB: avgEntrySize,

                    // Hit rate metrics
                    hits: stats.hits,
                    misses: stats.misses,
                    totalRequests,
                    hitRate: `${stats.hitRate.toFixed(2)}%`,
                    hitRateNumeric: stats.hitRate,

                    // Time metrics
                    oldestEntry: oldestEntryDate,
                    newestEntry: newestEntryDate,

                    // Namespace breakdown
                    byNamespace: stats.byNamespace,
                    namespaceCount: Object.keys(stats.byNamespace).length,
                  },

                  // Performance assessment
                  performance: {
                    rating:
                      stats.hitRate >= 80
                        ? 'excellent'
                        : stats.hitRate >= 60
                          ? 'good'
                          : stats.hitRate >= 40
                            ? 'fair'
                            : 'poor',
                    recommendations: generateRecommendations(stats),
                  },

                  // Metadata
                  timestamp: new Date().toISOString(),
                  note: 'Cache statistics are cumulative since server start. Use cache manager resetStats() to reset.',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch cache statistics',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Resource: cache://deduplication - Request deduplication statistics
  server.registerResource(
    'Request Deduplication Statistics',
    'cache://deduplication',
    {
      description: 'Request deduplication and result caching statistics for API call optimization',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = requestDeduplicator.getStats();

        // Calculate actual API calls made
        const actualApiCalls = stats.totalRequests - stats.deduplicatedRequests - stats.cacheHits;

        // Format oldest request age
        const oldestAge = stats.oldestRequestAge
          ? `${(stats.oldestRequestAge / 1000).toFixed(1)}s`
          : null;

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats: {
                    // Overall metrics
                    enabled: stats.enabled,
                    totalRequests: stats.totalRequests,
                    actualApiCalls,
                    totalSavedRequests: stats.totalSavedRequests,
                    totalSavingsRate: `${stats.totalSavingsRate.toFixed(1)}%`,

                    // In-flight deduplication
                    deduplication: {
                      pendingCount: stats.pendingCount,
                      deduplicatedRequests: stats.deduplicatedRequests,
                      deduplicationRate: `${stats.deduplicationRate.toFixed(1)}%`,
                      oldestRequestAge: oldestAge,
                    },

                    // Result caching
                    resultCache: {
                      enabled: stats.resultCacheEnabled,
                      size: stats.resultCacheSize,
                      maxSize: stats.resultCacheMaxSize,
                      ttl: `${stats.resultCacheTTL}ms`,
                      hits: stats.cacheHits,
                      misses: stats.cacheMisses,
                      hitRate: `${stats.cacheHitRate.toFixed(1)}%`,
                    },
                  },

                  // Efficiency breakdown
                  efficiency: {
                    requestBreakdown: {
                      total: stats.totalRequests,
                      fromCache: stats.cacheHits,
                      deduplicated: stats.deduplicatedRequests,
                      actualApiCalls,
                    },
                    savingsBreakdown: {
                      cacheHits: `${stats.cacheHits} requests (${((stats.cacheHits / stats.totalRequests) * 100).toFixed(1)}%)`,
                      deduplication: `${stats.deduplicatedRequests} requests (${stats.deduplicationRate.toFixed(1)}%)`,
                      totalSaved: `${stats.totalSavedRequests} requests (${stats.totalSavingsRate.toFixed(1)}%)`,
                    },
                    performance: {
                      rating:
                        stats.totalSavingsRate >= 50
                          ? 'excellent'
                          : stats.totalSavingsRate >= 30
                            ? 'good'
                            : stats.totalSavingsRate >= 10
                              ? 'fair'
                              : 'needs improvement',
                      recommendations: generateDeduplicationRecommendations(stats),
                    },
                  },

                  // Metadata
                  timestamp: new Date().toISOString(),
                  note: 'Deduplication statistics show API call reduction through in-flight request deduplication and result caching.',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch deduplication statistics',
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  console.error('[ServalSheets] Registered 2 cache resources:');
  console.error('  - cache://stats (cache performance metrics)');
  console.error('  - cache://deduplication (request deduplication & result caching stats)');

  return 2;
}

/**
 * Generate performance recommendations based on cache stats
 */
function generateRecommendations(stats: {
  hitRate: number;
  totalEntries: number;
  totalSize: number;
}): string[] {
  const recommendations: string[] = [];

  // Hit rate recommendations
  if (stats.hitRate < 40) {
    recommendations.push(
      'Cache hit rate is low (<40%). Consider increasing cache TTL or reviewing cache key strategy.'
    );
  } else if (stats.hitRate < 60) {
    recommendations.push(
      'Cache hit rate is moderate (40-60%). Review frequently accessed data for better caching opportunities.'
    );
  } else if (stats.hitRate >= 80) {
    recommendations.push('Cache hit rate is excellent (≥80%). Cache is working effectively.');
  }

  // Size recommendations
  const sizeMB = stats.totalSize / 1024 / 1024;
  if (sizeMB > 80) {
    recommendations.push(
      'Cache size is approaching limit (>80MB). Consider reducing TTL or max size.'
    );
  } else if (sizeMB < 10 && stats.totalEntries < 50) {
    recommendations.push('Cache is underutilized. Consider caching more frequently accessed data.');
  }

  // Entry count recommendations
  if (stats.totalEntries === 0) {
    recommendations.push(
      'Cache is empty. Ensure caching is enabled and operations are creating cache entries.'
    );
  } else if (stats.totalEntries > 1000) {
    recommendations.push('High entry count (>1000). Review cache cleanup frequency.');
  }

  return recommendations;
}

/**
 * Generate deduplication recommendations based on stats
 */
function generateDeduplicationRecommendations(stats: {
  enabled: boolean;
  totalRequests: number;
  totalSavingsRate: number;
  deduplicationRate: number;
  cacheHitRate: number;
  resultCacheEnabled: boolean;
}): string[] {
  const recommendations: string[] = [];

  if (!stats.enabled) {
    recommendations.push(
      'Request deduplication is disabled. Enable it for significant API call reduction.'
    );
    return recommendations;
  }

  if (stats.totalRequests === 0) {
    recommendations.push(
      'No requests tracked yet. Statistics will be available after the first requests.'
    );
    return recommendations;
  }

  // Overall savings recommendations
  if (stats.totalSavingsRate >= 50) {
    recommendations.push(
      `Excellent savings rate (${stats.totalSavingsRate.toFixed(1)}%). Deduplication is working very effectively.`
    );
  } else if (stats.totalSavingsRate >= 30) {
    recommendations.push(
      `Good savings rate (${stats.totalSavingsRate.toFixed(1)}%). Consider increasing cache TTL for even better results.`
    );
  } else if (stats.totalSavingsRate >= 10) {
    recommendations.push(
      `Fair savings rate (${stats.totalSavingsRate.toFixed(1)}%). Review request patterns for better caching opportunities.`
    );
  } else {
    recommendations.push(
      `Low savings rate (${stats.totalSavingsRate.toFixed(1)}%). Check if caching is properly configured.`
    );
  }

  // Cache-specific recommendations
  if (!stats.resultCacheEnabled) {
    recommendations.push(
      'Result caching is disabled. Enable it with RESULT_CACHE_ENABLED=true for 30-50% API reduction.'
    );
  } else if (stats.cacheHitRate < 20) {
    recommendations.push(
      `Cache hit rate is low (${stats.cacheHitRate.toFixed(1)}%). Consider increasing RESULT_CACHE_TTL.`
    );
  } else if (stats.cacheHitRate >= 60) {
    recommendations.push(
      `Excellent cache hit rate (${stats.cacheHitRate.toFixed(1)}%). Result caching is very effective.`
    );
  }

  // Deduplication-specific recommendations
  if (stats.deduplicationRate >= 20) {
    recommendations.push(
      `High concurrent request deduplication (${stats.deduplicationRate.toFixed(1)}%). Consider optimizing request batching.`
    );
  }

  return recommendations;
}
