/**
 * OpenAPI Generator
 *
 * Generates OpenAPI 3.1 specification from Zod schemas.
 * Converts ServalSheets' MCP tool surface into a REST API specification.
 */

import type { OpenAPIV3_1 } from 'openapi-types';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';
import { TOOL_ACTIONS } from '../src/mcp/completions.js';
import { ACTION_COUNT, TOOL_COUNT } from '../src/schemas/action-counts.js';

interface ToolSchema {
  name: string;
  description: string;
  inputSchema: any;
  outputSchema: any;
  annotations: any;
}

interface ActionSchema {
  tool: string;
  action: string;
  schema: any;
  description: string;
}

export class OpenAPIGenerator {
  private version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')).version as string;
  private baseUrl = 'https://api.servalsheets.com';

  /**
   * Extract tool schemas from TOOL_DEFINITIONS
   */
  async extractToolSchemas(): Promise<ToolSchema[]> {
    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    }));
  }

  /**
   * Extract action schemas for a specific tool
   */
  async extractActionSchemas(toolName: string): Promise<ActionSchema[]> {
    const actions = TOOL_ACTIONS[toolName];
    if (!actions) {
      return [];
    }

    const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
    if (!tool) {
      return [];
    }

    return actions.map((action) => ({
      tool: toolName,
      action,
      schema: tool.inputSchema,
      description: `${toolName}.${action}`,
    }));
  }

  /**
   * Extract all actions across all tools
   */
  async extractAllActions(): Promise<ActionSchema[]> {
    const allActions: ActionSchema[] = [];

    for (const toolName of Object.keys(TOOL_ACTIONS)) {
      const actions = await this.extractActionSchemas(toolName);
      allActions.push(...actions);
    }

    return allActions;
  }

  /**
   * Generate complete OpenAPI 3.1 specification
   */
  async generateFromSchemas(): Promise<OpenAPIV3_1.Document> {
    const tools = await this.extractToolSchemas();

    const spec: OpenAPIV3_1.Document = {
      openapi: '3.1.0',
      info: {
        title: 'ServalSheets API',
        version: this.version,
        description: `Production-grade Google Sheets API with ${TOOL_COUNT} tools and ${ACTION_COUNT} actions.

Features:
- AI-powered spreadsheet operations
- Safety rails and transaction support
- Batch operations and streaming
- Enterprise features (BigQuery, Apps Script, Webhooks)
- Full OAuth 2.1 authentication

Built with the Model Context Protocol (MCP).`,
        contact: {
          name: 'ServalSheets',
          url: 'https://github.com/khill1269/servalsheets',
          email: 'support@servalsheets.com',
        },
        license: {
          name: 'MIT',
          url: 'https://github.com/khill1269/servalsheets/blob/main/LICENSE',
        },
      },
      servers: [
        {
          url: this.baseUrl,
          description: 'Production API',
        },
        {
          url: 'https://api-staging.servalsheets.com',
          description: 'Staging API',
        },
        {
          url: 'http://localhost:3000',
          description: 'Local development',
        },
      ],
      paths: this.generatePaths(tools),
      components: {
        schemas: this.generateSchemas(tools),
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'API key authentication',
          },
          oauth2: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: `${this.baseUrl}/oauth/authorize`,
                tokenUrl: `${this.baseUrl}/oauth/token`,
                scopes: {
                  'spreadsheets.readonly': 'Read spreadsheet data',
                  spreadsheets: 'Read and write spreadsheet data',
                  'drive.readonly': 'Read Drive metadata',
                  'drive.file': 'Manage Drive files created by app',
                },
              },
            },
          },
        },
        responses: {
          Error: {
            description: 'Error response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['response'],
                  properties: {
                    response: {
                      type: 'object',
                      required: ['success', 'error'],
                      properties: {
                        success: { type: 'boolean', enum: [false] },
                        error: {
                          type: 'object',
                          required: ['code', 'message'],
                          properties: {
                            code: { type: 'string' },
                            message: { type: 'string' },
                            details: { type: 'object' },
                            retryable: { type: 'boolean' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }, { oauth2: ['spreadsheets'] }],
      tags: this.generateTags(),
    };

    return spec;
  }

  /**
   * Generate OpenAPI paths for all tools
   */
  private generatePaths(tools: ToolSchema[]): OpenAPIV3_1.PathsObject {
    const paths: OpenAPIV3_1.PathsObject = {};

    for (const tool of tools) {
      const toolPath = `/v1/${tool.name.replace('sheets_', 'sheets/')}`;
      const tag = this.getToolTag(tool.name);

      paths[toolPath] = {
        post: {
          summary: `Execute ${tool.name} operation`,
          description: tool.description,
          operationId: tool.name,
          tags: [tag],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${this.getSchemaName(tool.name, 'Input')}`,
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
                    $ref: `#/components/schemas/${this.getSchemaName(tool.name, 'Output')}`,
                  },
                },
              },
            },
            '400': {
              $ref: '#/components/responses/Error',
            },
            '401': {
              description: 'Unauthorized',
            },
            '429': {
              description: 'Rate limit exceeded',
            },
            '500': {
              $ref: '#/components/responses/Error',
            },
          },
        },
      };
    }

    return paths;
  }

  /**
   * Generate OpenAPI component schemas from Zod schemas
   *
   * Note: Due to complexity of ServalSheets' Zod schemas (discriminated unions, preprocessing),
   * we provide simplified OpenAPI schemas with basic structure documentation.
   * Full schema validation is available via the Zod schemas in the SDK.
   */
  private generateSchemas(tools: ToolSchema[]): Record<string, OpenAPIV3_1.SchemaObject> {
    const schemas: Record<string, OpenAPIV3_1.SchemaObject> = {};

    for (const tool of tools) {
      // Input schema - simplified structure
      const inputName = this.getSchemaName(tool.name, 'Input');
      schemas[inputName] = {
        type: 'object',
        required: ['request'],
        properties: {
          request: {
            type: 'object',
            required: ['action'],
            properties: {
              action: {
                type: 'string',
                description: 'Action to perform',
                enum: TOOL_ACTIONS[tool.name] || [],
              },
              spreadsheetId: {
                type: 'string',
                description: 'Spreadsheet ID',
                pattern: '^[a-zA-Z0-9-_]+$',
              },
            },
            description: 'Tool request with discriminated action',
          },
        },
        description: tool.description,
      };

      // Output schema - simplified structure
      const outputName = this.getSchemaName(tool.name, 'Output');
      schemas[outputName] = {
        type: 'object',
        required: ['response'],
        properties: {
          response: {
            type: 'object',
            required: ['success'],
            properties: {
              success: {
                type: 'boolean',
                description: 'Whether the operation succeeded',
              },
              action: {
                type: 'string',
                description: 'Action that was performed',
              },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  details: { type: 'object' },
                },
                description: 'Error details (if success=false)',
              },
            },
            description: 'Tool response',
          },
        },
        description: `Response from ${tool.name}`,
      };
    }

    return schemas;
  }

  /**
   * Generate OpenAPI tags for grouping
   */
  private generateTags(): OpenAPIV3_1.TagObject[] {
    return [
      {
        name: 'Core',
        description: 'Core spreadsheet and sheet operations',
      },
      {
        name: 'Data',
        description: 'Cell data operations (read, write, append)',
      },
      {
        name: 'Format',
        description: 'Cell and range formatting',
      },
      {
        name: 'Visualize',
        description: 'Charts and pivot tables',
      },
      {
        name: 'Collaborate',
        description: 'Sharing, comments, and version control',
      },
      {
        name: 'Advanced',
        description: 'Advanced operations (formulas, named ranges)',
      },
      {
        name: 'Quality',
        description: 'Data quality and validation',
      },
      {
        name: 'Analysis',
        description: 'AI-powered analysis and insights',
      },
      {
        name: 'Enterprise',
        description: 'Enterprise features (BigQuery, Apps Script, Templates)',
      },
      {
        name: 'Automation',
        description: 'Webhooks and automation',
      },
    ];
  }

  /**
   * Get tag for a tool
   */
  private getToolTag(toolName: string): string {
    const tagMap: Record<string, string> = {
      sheets_auth: 'Core',
      sheets_core: 'Core',
      sheets_data: 'Data',
      sheets_format: 'Format',
      sheets_dimensions: 'Format',
      sheets_visualize: 'Visualize',
      sheets_collaborate: 'Collaborate',
      sheets_advanced: 'Advanced',
      sheets_transaction: 'Advanced',
      sheets_quality: 'Quality',
      sheets_history: 'Advanced',
      sheets_confirm: 'Core',
      sheets_analyze: 'Analysis',
      sheets_fix: 'Quality',
      sheets_composite: 'Advanced',
      sheets_session: 'Core',
      sheets_templates: 'Enterprise',
      sheets_bigquery: 'Enterprise',
      sheets_appsscript: 'Enterprise',
      sheets_webhook: 'Automation',
      sheets_dependencies: 'Advanced',
      sheets_federation: 'Enterprise',
    };

    return tagMap[toolName] ?? 'Other';
  }

  /**
   * Get schema name for a tool
   */
  private getSchemaName(toolName: string, suffix: 'Input' | 'Output'): string {
    // Convert sheets_data -> SheetsData
    const parts = toolName.split('_');
    const pascalCase = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    return `${pascalCase}${suffix}`;
  }

  /**
   * Generate and write OpenAPI spec to file
   */
  async generateAndWrite(format: 'yaml' | 'json' | 'all' = 'all'): Promise<void> {
    const spec = await this.generateFromSchemas();

    if (format === 'yaml' || format === 'all') {
      const yamlStr = yaml.stringify(spec, {
        lineWidth: 120,
        indent: 2,
      });
      const outputPath = join(process.cwd(), 'openapi.yaml');
      writeFileSync(outputPath, yamlStr, 'utf-8');
      console.log(`✓ Generated OpenAPI spec: ${outputPath}`);
    }

    if (format === 'json' || format === 'all') {
      const jsonStr = JSON.stringify(spec, null, 2);
      const outputPath = join(process.cwd(), 'openapi.json');
      writeFileSync(outputPath, jsonStr, 'utf-8');
      console.log(`✓ Generated OpenAPI spec: ${outputPath}`);
    }
  }

  /**
   * Build complete OpenAPI spec with version
   */
  async buildOpenAPISpec(version: string): Promise<OpenAPIV3_1.Document> {
    this.version = version;
    return this.generateFromSchemas();
  }
}

// CLI usage
const isMainModule = process.argv[1]?.includes('generate-openapi');
if (isMainModule) {
  try {
    const format =
      process.argv[2] === 'json' ? 'json' : process.argv[2] === 'yaml' ? 'yaml' : 'all';
    const generator = new OpenAPIGenerator();
    await generator.generateAndWrite(format);
  } catch (error) {
    console.error('Error generating OpenAPI spec:', error);
    process.exit(1);
  }
}
