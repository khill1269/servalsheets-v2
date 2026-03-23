/**
 * ServalSheets - Metrics Resources
 *
 * Exposes performance metrics and system statistics via MCP resources.
 * Phase 6, Task 6.1
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getMetricsService } from '../services/metrics.js';
import { getServiceContext } from '../utils/logger-context.js';
import { generateMetricsDashboard } from '../services/metrics-dashboard.js';

/**
 * Register metrics resources with the MCP server
 */
export function registerMetricsResources(server: McpServer): number {
  const metricsService = getMetricsService();

  // Resource: metrics://summary - Complete metrics summary
  server.registerResource(
    'Performance Metrics Summary',
    'metrics://summary',
    {
      description:
        'Comprehensive performance metrics including operations, cache, API, and system stats',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const summary = metricsService.getSummary();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(summary),
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
                  error: 'Failed to fetch metrics summary',
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

  // Resource: metrics://dashboard - Optimization Dashboard (Phase 4)
  server.registerResource(
    'Optimization Dashboard',
    'metrics://dashboard',
    {
      description:
        'Performance optimization dashboard showing API efficiency, caching gains, batching stats, and cost savings',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const dashboard = await generateMetricsDashboard();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(dashboard),
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
                  error: 'Failed to generate optimization dashboard',
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

  // Resource: metrics://operations - Operation metrics
  server.registerResource(
    'Operation Metrics',
    'metrics://operations',
    {
      description: 'Detailed metrics for all recorded operations (count, duration, success rate)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const operations = metricsService.getAllOperationMetrics();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify({ operations }),
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
                  error: 'Failed to fetch operation metrics',
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

  // Resource: metrics://cache - Cache metrics
  server.registerResource(
    'Cache Metrics',
    'metrics://cache',
    {
      description: 'Cache hit rate and performance statistics',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const cache = metricsService.getCacheMetrics();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify({ cache }),
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
                  error: 'Failed to fetch cache metrics',
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

  // Resource: metrics://api - API call metrics
  server.registerResource(
    'API Metrics',
    'metrics://api',
    {
      description: 'Google Sheets API call statistics and error rates',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const api = metricsService.getApiMetrics();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify({ api }),
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
                { error: 'Failed to fetch API metrics', message: errorMessage },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Resource: metrics://system - System resource metrics
  server.registerResource(
    'System Metrics',
    'metrics://system',
    {
      description: 'System resource usage (memory, CPU, active requests)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const system = metricsService.getSystemMetrics();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify({ system }),
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
                  error: 'Failed to fetch system metrics',
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

  // Resource: metrics://service - Service information
  server.registerResource(
    'Service Information',
    'metrics://service',
    {
      description: 'Service metadata (version, environment, hostname, instance ID)',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const service = getServiceContext();
        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify({ service }),
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
                  error: 'Failed to fetch service information',
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

  console.error('[ServalSheets] Registered 7 metrics resources:');
  console.error('  - metrics://summary (comprehensive metrics)');
  console.error('  - metrics://dashboard (optimization dashboard)');
  console.error('  - metrics://operations (operation performance)');
  console.error('  - metrics://cache (cache statistics)');
  console.error('  - metrics://api (API call statistics)');
  console.error('  - metrics://system (system resources)');
  console.error('  - metrics://service (service metadata)');

  return 7;
}
