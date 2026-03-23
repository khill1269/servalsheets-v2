/**
 * ServalSheets - Deferred Knowledge Resource Loader
 *
 * Provides lazy-loading of knowledge resources to reduce startup context.
 * Instead of loading all 800KB+ of knowledge at startup, files are loaded
 * on-demand when Claude requests them via MCP resources.
 *
 * Usage:
 * - Enable with DISABLE_KNOWLEDGE_RESOURCES=true (prevents eager loading)
 * - This module provides on-demand access via knowledge:///{path} resources
 *
 * Benefits:
 * - Reduces initial context by ~800KB
 * - Files loaded only when needed
 * - Same URIs as eager loading (knowledge:///api/batch-operations.md)
 *
 * @module resources/knowledge-deferred
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createResourceNotFoundError, createInvalidResourceUriError } from '../utils/mcp-errors.js';
import { logger } from '../utils/logger.js';
import { registerCleanup } from '../utils/resource-cleanup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Knowledge directory (relative to dist/ or src/)
const KNOWLEDGE_DIR = join(__dirname, '../knowledge');

// Cache for loaded knowledge files (in-memory, expires after 5 minutes)
const knowledgeCache = new Map<string, { content: string; loadedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const deferredKnowledgeRegistration = new WeakSet<McpServer>();

/**
 * Get MIME type from file extension
 */
function getMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

/**
 * Load a knowledge file by path with caching
 */
async function loadKnowledgeFile(relativePath: string): Promise<string | null> {
  // Check cache first
  const cached = knowledgeCache.get(relativePath);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    logger.debug('Knowledge cache hit', { path: relativePath });
    return cached.content;
  }

  // Build full path
  const fullPath = join(KNOWLEDGE_DIR, relativePath);

  // Security: Prevent path traversal
  if (!fullPath.startsWith(KNOWLEDGE_DIR)) {
    logger.warn('Knowledge path traversal attempt blocked', {
      path: relativePath,
      resolved: fullPath,
    });
    return null;
  }

  // Check if file exists
  if (!existsSync(fullPath)) {
    logger.debug('Knowledge file not found', { path: fullPath });
    return null;
  }

  try {
    const content = await readFile(fullPath, 'utf-8');

    // Cache the content
    knowledgeCache.set(relativePath, {
      content,
      loadedAt: Date.now(),
    });

    logger.info('Knowledge file loaded', {
      path: relativePath,
      size: content.length,
    });

    return content;
  } catch (error) {
    logger.error('Failed to load knowledge file', {
      path: relativePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Clear expired cache entries
 */
function cleanCache(): void {
  const now = Date.now();
  for (const [key, entry] of knowledgeCache.entries()) {
    if (now - entry.loadedAt >= CACHE_TTL_MS) {
      knowledgeCache.delete(key);
    }
  }
}

// Store interval ID for cleanup
let cacheCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the cache cleanup interval
 * Called during module initialization to start the periodic cleanup task
 */
function startCacheCleanupInterval(): void {
  if (cacheCleanupInterval !== null) {
    logger.warn('Cache cleanup interval already running');
    return;
  }

  // Run cache cleanup every minute
  cacheCleanupInterval = setInterval(cleanCache, 60 * 1000);

  // Register cleanup function to ensure interval is cleared on shutdown
  registerCleanup(
    'knowledge-deferred',
    () => {
      if (cacheCleanupInterval !== null) {
        clearInterval(cacheCleanupInterval);
        cacheCleanupInterval = null;
        logger.debug('Knowledge cache cleanup interval cleared');
      }
    },
    'cache-cleanup-interval'
  );

  logger.debug('Knowledge cache cleanup interval started (1 minute)');
}

// Start the cleanup interval when the module loads
startCacheCleanupInterval();

/**
 * Register deferred knowledge resource with URI template support
 *
 * Registers a single resource template that handles all knowledge files:
 * - knowledge:///{path} - Load any knowledge file on-demand
 *
 * This allows Claude to request specific knowledge files without
 * loading all of them into context at startup.
 */
export function registerDeferredKnowledgeResources(server: McpServer): void {
  if (deferredKnowledgeRegistration.has(server)) {
    logger.debug('Deferred knowledge resources already registered for this server instance');
    return;
  }

  // Check if knowledge directory exists
  if (!existsSync(KNOWLEDGE_DIR)) {
    logger.warn('Knowledge directory not found, skipping deferred registration', {
      path: KNOWLEDGE_DIR,
    });
    return;
  }

  // Register resource template for all knowledge files
  // URI pattern: knowledge:///{path}
  // Examples:
  //   - knowledge:///api/batch-operations.md
  //   - knowledge:///formulas/functions-reference.md
  //   - knowledge:///templates/finance.json
  server.registerResource(
    'Deferred Knowledge',
    'knowledge:///{path}',
    {
      description:
        'On-demand access to ServalSheets knowledge files. Use knowledge:///index to see available files, then request specific files as needed. Reduces context by loading only what you need.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const uriStr = typeof uri === 'string' ? uri : String(uri);

      // Parse the path from the URI
      // Expected format: knowledge:///api/batch-operations.md
      const match = uriStr.match(/^knowledge:\/\/\/(.+)$/);
      if (!match) {
        throw createInvalidResourceUriError(
          uriStr,
          'knowledge:///{path} (e.g., knowledge:///api/batch-operations.md)'
        );
      }

      const relativePath = match[1]!;

      // Handle special index path (redirect to index resource)
      if (relativePath === 'index' || relativePath === 'index.json') {
        throw createInvalidResourceUriError(
          uriStr,
          'Use knowledge:///index resource directly for the index'
        );
      }

      // Load the file
      const content = await loadKnowledgeFile(relativePath);

      if (!content) {
        throw createResourceNotFoundError(
          'knowledge',
          relativePath,
          'Check knowledge:///index for available files'
        );
      }

      return {
        contents: [
          {
            uri: uriStr,
            mimeType: getMimeType(relativePath),
            text: content,
          },
        ],
      };
    }
  );
  deferredKnowledgeRegistration.add(server);

  logger.info('Deferred knowledge resources registered', {
    knowledgeDir: KNOWLEDGE_DIR,
    cacheSize: knowledgeCache.size,
  });
}

/**
 * Get cache statistics for monitoring
 */
export function getKnowledgeCacheStats(): {
  size: number;
  entries: Array<{ path: string; age: number; sizeBytes: number }>;
} {
  const now = Date.now();
  return {
    size: knowledgeCache.size,
    entries: Array.from(knowledgeCache.entries()).map(([path, entry]) => ({
      path,
      age: now - entry.loadedAt,
      sizeBytes: entry.content.length,
    })),
  };
}

/**
 * Clear the knowledge cache (useful for testing or memory pressure)
 */
export function clearKnowledgeCache(): void {
  knowledgeCache.clear();
  logger.info('Knowledge cache cleared');
}
