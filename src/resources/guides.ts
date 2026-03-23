/**
 * ServalSheets - Performance Guide Resources
 *
 * Provides AI-friendly performance optimization guides:
 * - Quota optimization strategies
 * - Batching patterns and best practices
 * - Caching strategies
 * - Error recovery patterns
 *
 * These resources help LLMs make optimal decisions about
 * API usage, performance trade-offs, and error handling.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createResourceNotFoundError, createResourceReadError } from '../utils/mcp-errors.js';
import { NotFoundError } from '../core/errors.js';
import { resolveGuidesDirectory } from '../utils/runtime-paths.js';

/**
 * Register performance guide resources
 */
export function registerGuideResources(server: McpServer): void {
  // Quota Optimization Guide
  server.registerResource(
    'Quota Optimization Guide',
    'servalsheets://guides/quota-optimization',
    {
      description:
        'Strategies to minimize Google Sheets API quota usage. Covers batching, transactions, and composite actions with before/after examples showing 80-99% quota savings.',
      mimeType: 'text/markdown',
    },
    async (uri) => readGuideResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Batching Strategies Guide
  server.registerResource(
    'Batching Strategies Guide',
    'servalsheets://guides/batching-strategies',
    {
      description:
        'When and how to use batching for optimal performance. Covers batch_read, batch_write, transactions, and composite actions with decision trees and performance benchmarks.',
      mimeType: 'text/markdown',
    },
    async (uri) => readGuideResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Caching Patterns Guide
  server.registerResource(
    'Caching Patterns Guide',
    'servalsheets://guides/caching-patterns',
    {
      description:
        'How to leverage ServalSheets intelligent caching system. Covers cache strategies, TTL configuration, manual cache control, and achieving 80-90% API call reduction.',
      mimeType: 'text/markdown',
    },
    async (uri) => readGuideResource(typeof uri === 'string' ? uri : uri.toString())
  );

  // Error Recovery Guide
  server.registerResource(
    'Error Recovery Guide',
    'servalsheets://guides/error-recovery',
    {
      description:
        'How to handle errors gracefully. Covers automatic retry, exponential backoff, error-specific recovery strategies (400/401/403/404/429/500/503), and best practices.',
      mimeType: 'text/markdown',
    },
    async (uri) => readGuideResource(typeof uri === 'string' ? uri : uri.toString())
  );
}

/**
 * Read guide resource content
 */
export async function readGuideResource(uri: string): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
}> {
  const resourceId = uri.replace('servalsheets://guides/', '');

  // Map resource ID to markdown file
  const guideFiles: Record<string, string> = {
    'quota-optimization': 'quota-optimization.md',
    'batching-strategies': 'batching-strategies.md',
    'caching-patterns': 'caching-patterns.md',
    'error-recovery': 'error-recovery.md',
  };

  const fileName = guideFiles[resourceId];
  if (!fileName) {
    throw createResourceNotFoundError(
      'guide',
      resourceId,
      'Available guides: quota-optimization, batching-strategies, caching-patterns, error-recovery'
    );
  }

  try {
    const guidesDir = resolveGuidesDirectory();
    if (!guidesDir) {
      throw new NotFoundError('guide_directory', 'guides');
    }

    const filePath = join(guidesDir, fileName);
    const content = await readFile(filePath, 'utf-8');

    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: content,
        },
      ],
    };
  } catch (error) {
    throw createResourceReadError(uri, error);
  }
}
