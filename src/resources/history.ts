/**
 * ServalSheets - History Resources
 *
 * Exposes operation history as MCP resources for debugging and audit.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getHistoryService } from '../services/history-service.js';
import type { OperationHistoryFilter } from '../types/history.js';

/**
 * Register history resources with the MCP server
 */
export function registerHistoryResources(server: McpServer): number {
  const historyService = getHistoryService();

  // Resource 1: history://operations - Recent operations
  server.registerResource(
    'Operation History',
    'history://operations',
    {
      description: 'Last 100 operations with full details for debugging, undo, and audit',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        // Parse query parameters from URI if present
        const url = new URL(uri);
        const params = url.searchParams;

        const filter: OperationHistoryFilter = {};

        if (params.get('tool')) {
          filter.tool = params.get('tool')!;
        }
        if (params.get('action')) {
          filter.action = params.get('action')!;
        }
        if (params.get('result')) {
          filter.result = params.get('result') as 'success' | 'error';
        }
        if (params.get('spreadsheetId')) {
          filter.spreadsheetId = params.get('spreadsheetId')!;
        }
        if (params.get('limit')) {
          filter.limit = parseInt(params.get('limit')!, 10);
        }

        const operations = historyService.getAll(filter);

        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  total: operations.length,
                  operations,
                  filters: filter,
                  note: 'Query parameters supported: tool, action, result, spreadsheetId, limit',
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
              uri: uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  error: 'Failed to fetch operation history',
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

  // Resource 2: history://stats - Statistics
  server.registerResource(
    'History Statistics',
    'history://stats',
    {
      description: 'Operation statistics: success rate, average duration, most common tools',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const stats = historyService.getStats();

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  stats,
                  currentSize: historyService.size(),
                  maxSize: 100,
                  isFull: historyService.isFull(),
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
                  error: 'Failed to fetch history statistics',
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

  // Resource 3: history://recent - Last N operations (shortcut)
  server.registerResource(
    'Recent Operations',
    'history://recent',
    {
      description: 'Last 10 operations (quick view)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const url = new URL(uri);
        const count = parseInt(url.searchParams.get('count') || '10', 10);

        const operations = historyService.getRecent(count);

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  count: operations.length,
                  operations,
                  note: 'Use ?count=N to adjust (default: 10)',
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
                  error: 'Failed to fetch recent operations',
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

  // Resource 4: history://failures - Failed operations only
  server.registerResource(
    'Failed Operations',
    'history://failures',
    {
      description: 'Operations that failed with errors (for debugging)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const url = new URL(uri);
        const count = url.searchParams.get('count')
          ? parseInt(url.searchParams.get('count')!, 10)
          : undefined;

        const failures = historyService.getFailures(count);

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  count: failures.length,
                  failures,
                  note: count ? `Showing last ${count} failures` : 'Showing all failures',
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
                  error: 'Failed to fetch failed operations',
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

  // Note: Using console.error for MCP server startup output (visible to user)
  console.error('[ServalSheets] Registered 4 history resources:');
  console.error('  - history://operations (full history with filters)');
  console.error('  - history://stats (statistics)');
  console.error('  - history://recent (last 10 operations)');
  console.error('  - history://failures (failed operations only)');

  return 4;
}
