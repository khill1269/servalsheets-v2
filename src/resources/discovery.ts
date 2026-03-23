/**
 * ServalSheets - Discovery Resources
 *
 * Exposes Google API schema health and discovery information via MCP resources.
 * Phase 4 - Observability
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  DiscoveryApiClient,
  type SchemaDefinition,
  type PropertyDefinition,
} from '../services/discovery-client.js';

// Singleton discovery client
let discoveryClient: DiscoveryApiClient | null = null;

function getDiscoveryClient(): DiscoveryApiClient {
  if (!discoveryClient) {
    discoveryClient = new DiscoveryApiClient({
      enabled: true,
      cacheTTL: 86400, // 24 hours
      timeout: 10000,
    });
  }
  return discoveryClient;
}

/**
 * Register discovery resources with the MCP server
 */
export function registerDiscoveryResources(server: McpServer): number {
  // Resource: discovery://health - API schema health check
  server.registerResource(
    'API Schema Health',
    'discovery://health',
    {
      description:
        'Google Sheets API schema health check - shows current schema status, cache info, and any deprecation warnings',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const client = getDiscoveryClient();
        const cacheStats = client.getCacheStats();

        // Try to fetch current schema (will use cache if available)
        let schemaStatus = 'unknown';
        let schemaVersion = 'v4';
        const deprecations: string[] = [];
        let lastFetched: string | null = null;

        try {
          const schema = await client.getApiSchema('sheets', 'v4');
          schemaStatus = 'healthy';
          schemaVersion = schema.version;

          // Check for deprecations in schemas
          if (schema.schemas) {
            for (const [name, def] of Object.entries(schema.schemas)) {
              const schemaDef = def as SchemaDefinition;
              if (schemaDef.deprecated) {
                deprecations.push(`Schema ${name} is deprecated`);
              }
              if (schemaDef.properties) {
                for (const [propName, prop] of Object.entries(schemaDef.properties)) {
                  const propDef = prop as PropertyDefinition;
                  if (propDef.deprecated) {
                    deprecations.push(`${name}.${propName} is deprecated`);
                  }
                }
              }
            }
          }

          if (cacheStats.newestEntry) {
            lastFetched = new Date(cacheStats.newestEntry).toISOString();
          }
        } catch (_error) {
          schemaStatus = 'error';
        }

        const health = {
          timestamp: new Date().toISOString(),
          api: 'sheets',
          version: schemaVersion,
          status: schemaStatus,
          cache: {
            entries: cacheStats.entries,
            lastFetched,
          },
          deprecations: deprecations.length > 0 ? deprecations.slice(0, 10) : [],
          deprecationCount: deprecations.length,
        };

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(health),
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
                  error: 'Failed to check API health',
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

  // Resource: discovery://versions - Available API versions
  server.registerResource(
    'API Versions',
    'discovery://versions',
    {
      description: 'List available Google Sheets API versions from Discovery API',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const client = getDiscoveryClient();
        const sheetsVersions = await client.listAvailableVersions('sheets');
        const driveVersions = await client.listAvailableVersions('drive');

        return {
          contents: [
            {
              uri: typeof uri === 'string' ? uri : uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  timestamp: new Date().toISOString(),
                  apis: {
                    sheets: {
                      versions: sheetsVersions,
                      current: 'v4',
                    },
                    drive: {
                      versions: driveVersions,
                      current: 'v3',
                    },
                  },
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
                  error: 'Failed to list API versions',
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

  console.error('[ServalSheets] Registered 2 discovery resources:');
  console.error('  - discovery://health (API schema health check)');
  console.error('  - discovery://versions (available API versions)');

  return 2;
}
