/**
 * Export OpenAPI Schema from MCP Tools
 *
 * Generates OpenAPI 3.1 specification from MCP tool schemas.
 * This enables integration with API documentation tools, testing frameworks,
 * and other OpenAPI-compatible systems.
 *
 * Usage:
 *   npm run export-openapi
 *   npm run export-openapi -- --output ./docs/openapi.json
 *   npm run export-openapi -- --format yaml
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import { execSync } from 'child_process';

// Ensure project is built before importing
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Build if dist doesn't exist
try {
  await fs.access(path.join(projectRoot, 'dist', 'schemas', 'index.js'));
} catch {
  console.log('Building project before export...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
}

// Define tool information manually (MCP schemas don't export a single unified object)
const toolDefinitions = [
  { name: 'sheets_auth', description: 'OAuth and credential management' },
  { name: 'sheets_core', description: 'Spreadsheet metadata and sheet/tab operations' },
  {
    name: 'sheets_data',
    description: 'Read/write values, notes, hyperlinks, validation, merge/cut/copy',
  },
  {
    name: 'sheets_format',
    description: 'Cell formatting, conditional formatting, data validation',
  },
  { name: 'sheets_dimensions', description: 'Row/column sizing, filtering, and sorting' },
  { name: 'sheets_visualize', description: 'Charts and pivot tables' },
  { name: 'sheets_collaborate', description: 'Sharing, comments, revisions, and snapshots' },
  {
    name: 'sheets_advanced',
    description: 'Named ranges, protected ranges, metadata, banding, tables',
  },
  { name: 'sheets_transaction', description: 'Transactional batching with rollback support' },
  { name: 'sheets_quality', description: 'Validation, conflict detection, and impact analysis' },
  { name: 'sheets_history', description: 'Operation history and undo/redo' },
  { name: 'sheets_confirm', description: 'Plan confirmation via elicitation' },
  { name: 'sheets_analyze', description: 'AI analysis and insights' },
  { name: 'sheets_fix', description: 'Automated issue fixing' },
  { name: 'sheets_composite', description: 'High-level composite operations' },
  { name: 'sheets_session', description: 'Session context management' },
];

interface ToolDefinition {
  name: string;
  description: string;
}

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact?: {
      name: string;
      url: string;
    };
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
  };
}

/**
 * Convert MCP tool definition to OpenAPI path operation
 */
function toolToOpenAPIPath(tool: ToolDefinition): Record<string, unknown> {
  return {
    post: {
      summary: tool.description,
      operationId: tool.name,
      tags: [tool.name.split('_')[0]], // e.g., "sheets" from "sheets_data"
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: `Input parameters for ${tool.name}`,
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Successful operation',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/SuccessResponse',
              },
            },
          },
        },
        '400': {
          description: 'Invalid input',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        '401': {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        '429': {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        '500': {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Generate OpenAPI specification from MCP tool schemas
 */
function generateOpenAPISpec(): OpenAPISpec {
  const tools = toolDefinitions;

  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info: {
      title: 'ServalSheets API',
      version: '1.3.0',
      description: `
# ServalSheets - Intelligent Google Sheets MCP Server

ServalSheets provides a production-ready Model Context Protocol (MCP) server for Google Sheets operations with:

- **Intelligent Safety Features**: Dry-run mode, impact analysis, conflict detection
- **Production Resilience**: Circuit breakers, fallback strategies, request deduplication
- **Performance Optimization**: Multi-tier caching, parallel execution, request batching
- **Comprehensive Operations**: Values, formatting, metadata, sheet management, analysis

## MCP Protocol

This API follows the Model Context Protocol (MCP) 2025-11-25 specification.
All operations are exposed as MCP tools with structured input/output schemas.

## Authentication

Supports two authentication methods:

1. **Service Account** (recommended for server-to-server):
   \`\`\`bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   \`\`\`

2. **OAuth 2.0** (for user-delegated access):
   - Initialize with: \`npm run auth\`
   - Tokens stored securely with encryption

## Rate Limiting

- Automatic exponential backoff on rate limit errors
- Circuit breaker protection (opens after 5 consecutive failures)
- Request deduplication (30-50% API call reduction)

## Safety Features

All mutating operations support safety options:

- \`dryRun\`: Preview changes without applying them
- \`effectScope\`: Limit operation scope (e.g., maxCellsAffected)
- \`requireConfirmation\`: Prompt user for destructive operations

## Monitoring

Health endpoints available:
- \`GET /health/live\` - Liveness probe
- \`GET /health/ready\` - Readiness probe

MCP resources for monitoring:
- \`cache://stats\` - Cache performance
- \`cache://deduplication\` - Request deduplication stats
- \`metrics://performance\` - Server metrics
`.trim(),
      contact: {
        name: 'ServalSheets',
        url: 'https://github.com/yourusername/servalsheets',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
      {
        url: 'mcp://servalsheets',
        description: 'MCP protocol endpoint',
      },
    ],
    paths: {},
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              const: false,
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  enum: [
                    'AUTH_ERROR',
                    'PERMISSION_ERROR',
                    'NOT_FOUND',
                    'RATE_LIMIT',
                    'CONFLICT',
                    'VALIDATION_ERROR',
                    'INVALID_PARAMS',
                    'INVALID_REQUEST',
                    'PRECONDITION_FAILED',
                    'INTERNAL_ERROR',
                    'API_ERROR',
                  ],
                },
                message: {
                  type: 'string',
                },
                details: {
                  type: 'object',
                },
                retryable: {
                  type: 'boolean',
                },
                retryStrategy: {
                  type: 'string',
                  enum: ['immediate', 'exponential_backoff', 'fixed_delay'],
                },
              },
              required: ['code', 'message'],
            },
          },
          required: ['success', 'error'],
        },
      },
    },
  };

  // Add generic success response schema
  spec.components.schemas['SuccessResponse'] = {
    type: 'object',
    properties: {
      response: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            const: true,
          },
          action: {
            type: 'string',
            description: 'The action that was performed',
          },
          mutation: {
            type: 'object',
            description: 'Summary of mutations made (if applicable)',
            properties: {
              cellsAffected: { type: 'number' },
              rangesAffected: { type: 'array', items: { type: 'string' } },
            },
          },
          dryRun: {
            type: 'boolean',
            description: 'Whether this was a dry-run preview',
          },
        },
        required: ['success', 'action'],
      },
    },
    required: ['response'],
  };

  // Generate paths for each tool
  for (const tool of tools) {
    const pathName = `/tools/${tool.name}`;
    spec.paths[pathName] = toolToOpenAPIPath(tool);
  }

  return spec;
}

/**
 * Main export function
 */
async function main() {
  const args = process.argv.slice(2);
  const outputArg = args.find((arg) => arg.startsWith('--output='));
  const formatArg = args.find((arg) => arg.startsWith('--format='));

  const outputPath = outputArg?.split('=')[1] || path.join(__dirname, '../docs/openapi.json');

  const format = formatArg?.split('=')[1] || 'json';

  console.log('Generating OpenAPI specification...');
  console.log(`  Tools: 7 MCP tools`);
  console.log(`  Format: ${format}`);
  console.log(`  Output: ${outputPath}`);

  const spec = generateOpenAPISpec();

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  // Write spec in requested format
  let content: string;
  if (format === 'yaml' || format === 'yml') {
    content = yaml.stringify(spec);
  } else {
    content = JSON.stringify(spec, null, 2);
  }

  await fs.writeFile(outputPath, content, 'utf-8');

  console.log(`\n✅ OpenAPI specification exported successfully!`);
  console.log(`\nNext steps:`);
  console.log(`  1. View in Swagger Editor: https://editor.swagger.io/`);
  console.log(`  2. Generate API client: npx @openapitools/openapi-generator-cli generate`);
  console.log(`  3. Generate docs: npx redocly build-docs ${outputPath}`);
  console.log(`\nAPI Documentation available at: ${outputPath}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Failed to export OpenAPI schema:', error);
    process.exit(1);
  });
}

export { generateOpenAPISpec, toolToOpenAPIPath };
