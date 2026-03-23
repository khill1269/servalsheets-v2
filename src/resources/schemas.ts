/**
 * ServalSheets - Schema Resources
 *
 * Provides on-demand access to full tool schemas when DEFER_SCHEMAS is enabled.
 * This allows tools to be registered with minimal schemas while full schemas
 * are available via MCP resources.
 *
 * URI Pattern: schema://tools/{toolName}
 *
 * @module resources/schemas
 */

import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_DEFINITIONS } from '../mcp/registration/tool-definitions.js';
import { filterAvailableActions } from '../mcp/tool-availability.js';
import { ACTION_ANNOTATIONS } from '../schemas/annotations.js';
import { zodSchemaToJsonSchema } from '../utils/schema-compat.js';
import { logger } from '../utils/logger.js';
import { createInvalidResourceUriError, createResourceNotFoundError } from '../utils/mcp-errors.js';
import { BoundedCache } from '../utils/bounded-cache.js';

/**
 * Schema resource content cache
 * Caches converted JSON schemas to avoid repeated conversions.
 * Uses BoundedCache to prevent unbounded memory growth with LRU eviction.
 */
const schemaCache = new BoundedCache<string, { content: string }>({
  maxSize: 150,
  ttl: 10 * 60 * 1000, // 10 minutes
  onEviction: (key) => {
    logger.debug('Schema cache evicted', {
      component: 'resources/schemas',
      toolName: key,
    });
  },
});

const actionGuidanceCache = new BoundedCache<string, { content: string }>({
  maxSize: 150,
  ttl: 10 * 60 * 1000,
  onEviction: (key) => {
    logger.debug('Action guidance cache evicted', {
      component: 'resources/schemas',
      key,
    });
  },
});

/**
 * Get the full JSON Schema for a tool
 *
 * @param toolName - Name of the tool (e.g., 'sheets_core')
 * @returns JSON string of the full schema, or null if not found
 */
export function getToolSchema(toolName: string): string | null {
  const allowedActions = getAllowedActions(toolName);
  const cacheKey = `tool:${toolName}:${allowedActions.join(',')}`;

  // Check cache first
  const cached = schemaCache.get(cacheKey);
  if (cached) {
    return cached.content;
  }

  // Find the tool definition
  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  if (!tool) {
    return null;
  }

  // Convert Zod schema to JSON Schema
  const jsonSchema = zodSchemaToJsonSchema(tool.inputSchema);
  const filteredSchema = filterRootSchemaActions(
    jsonSchema as Record<string, unknown>,
    allowedActions
  );

  // Build complete schema document with metadata
  const schemaDoc = {
    $id: `schema://tools/${toolName}`,
    title: toolName,
    description: tool.description,
    inputSchema: filteredSchema,
    outputSchema: tool.outputSchema ? zodSchemaToJsonSchema(tool.outputSchema) : undefined,
    annotations: tool.annotations,
  };

  const content = JSON.stringify(schemaDoc);

  // Cache for future requests
  schemaCache.set(cacheKey, { content });

  return content;
}

/**
 * Get a summary of all available tool schemas
 *
 * @returns JSON string with tool names and brief descriptions
 */
export function getSchemaIndex(): string {
  const index = {
    $id: 'schema://tools',
    title: 'ServalSheets Tool Schemas',
    description:
      'Index of all available tool schemas. Read individual schema resources for full details.',
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      uri: `schema://tools/${tool.name}`,
      title: tool.annotations.title || tool.name,
      readOnlyHint: tool.annotations.readOnlyHint,
      destructiveHint: tool.annotations.destructiveHint,
    })),
    usage: {
      instructions:
        'Before calling a tool, read its schema resource to understand available actions and parameters.',
      example:
        'Read schema://tools/sheets_data to see all data operations (read, write, append, etc.)',
    },
  };

  return JSON.stringify(index);
}

/**
 * Get action guidance for all actions in a tool.
 *
 * URI pattern: schema://actions/{toolName}
 */
export function getActionGuidance(toolName: string): string | null {
  const allowedActions = new Set(getAllowedActions(toolName));
  const cacheKey = `actions:${toolName}:${[...allowedActions].join(',')}`;
  const cached = actionGuidanceCache.get(cacheKey);
  if (cached) {
    return cached.content;
  }

  const tool = TOOL_DEFINITIONS.find((definition) => definition.name === toolName);
  if (!tool) {
    return null;
  }

  const entries = Object.entries(ACTION_ANNOTATIONS).filter(([key]) =>
    key.startsWith(`${toolName}.`)
  );
  const actions = entries
    .map(([key, annotation]) => ({
      action: key.replace(`${toolName}.`, ''),
      annotation,
    }))
    .filter((entry) => allowedActions.has(entry.action));

  const content = JSON.stringify({
    $id: `schema://actions/${toolName}`,
    title: `${toolName} Action Guidance`,
    description: 'Action-level guidance for model-safe routing, retries, and optimization.',
    tool: toolName,
    count: actions.length,
    actions,
  });

  actionGuidanceCache.set(cacheKey, { content });
  return content;
}

function getAllowedActions(toolName: string): string[] {
  const actions = Object.keys(ACTION_ANNOTATIONS)
    .filter((key) => key.startsWith(`${toolName}.`))
    .map((key) => key.replace(`${toolName}.`, ''));
  return [...filterAvailableActions(toolName, actions)];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function filterRootSchemaActions(
  rootSchema: Record<string, unknown>,
  allowedActions: readonly string[]
): Record<string, unknown> {
  const properties = asRecord(rootSchema['properties']);
  const requestSchema = asRecord(properties?.['request']);
  if (!properties || !requestSchema) {
    return rootSchema;
  }

  return {
    ...rootSchema,
    properties: {
      ...properties,
      request: filterRequestSchemaActions(requestSchema, new Set(allowedActions)),
    },
  };
}

function filterRequestSchemaActions(
  requestSchema: Record<string, unknown>,
  allowedActions: ReadonlySet<string>
): Record<string, unknown> {
  let filtered: Record<string, unknown> = { ...requestSchema };

  for (const key of ['oneOf', 'anyOf'] as const) {
    const variants = Array.isArray(filtered[key]) ? filtered[key] : null;
    if (!variants) {
      continue;
    }

    filtered = {
      ...filtered,
      [key]: variants.filter((variant) => {
        const actionSchema = asRecord(asRecord(variant)?.['properties'])?.['action'];
        const actionRecord = asRecord(actionSchema);
        const actionName = actionRecord?.['const'] ?? (actionRecord?.['enum'] as unknown[])?.[0];
        return typeof actionName === 'string' ? allowedActions.has(actionName) : true;
      }),
    };
  }

  const properties = asRecord(filtered['properties']);
  const actionSchema = asRecord(properties?.['action']);
  if (!properties || !actionSchema) {
    return filtered;
  }

  const nextActionSchema: Record<string, unknown> = { ...actionSchema };
  if (Array.isArray(actionSchema['enum'])) {
    nextActionSchema['enum'] = (actionSchema['enum'] as unknown[]).filter(
      (value) => typeof value !== 'string' || allowedActions.has(value)
    );
  }

  return {
    ...filtered,
    properties: {
      ...properties,
      action: nextActionSchema,
    },
  };
}

export function getActionGuidanceIndex(): string {
  return JSON.stringify({
    $id: 'schema://actions',
    title: 'ServalSheets Action Guidance Index',
    description:
      'Index of action-level annotations. Read schema://actions/{toolName} for tool-specific guidance.',
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      uri: `schema://actions/${tool.name}`,
      title: tool.annotations.title || tool.name,
    })),
  });
}

/**
 * Read a schema resource by URI
 *
 * @param uri - Resource URI (schema://tools or schema://tools/{toolName})
 * @returns Resource contents
 */
export async function readSchemaResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // Handle index request
  if (uri === 'schema://tools' || uri === 'schema://tools/') {
    return {
      contents: [
        {
          uri: 'schema://tools',
          mimeType: 'application/json',
          text: getSchemaIndex(),
        },
      ],
    };
  }
  if (uri === 'schema://actions' || uri === 'schema://actions/') {
    return {
      contents: [
        {
          uri: 'schema://actions',
          mimeType: 'application/json',
          text: getActionGuidanceIndex(),
        },
      ],
    };
  }

  // Extract tool name from URI
  const match = uri.match(/^schema:\/\/tools\/([a-z0-9_]+)$/);
  if (match) {
    const toolName = match[1]!;
    const content = getToolSchema(toolName);

    if (!content) {
      throw createResourceNotFoundError(
        'tool',
        toolName,
        'Use schema://tools to see available tools'
      );
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: content,
        },
      ],
    };
  }

  const actionMatch = uri.match(/^schema:\/\/actions\/([a-z0-9_]+)$/);
  if (actionMatch) {
    const toolName = actionMatch[1]!;
    const content = getActionGuidance(toolName);

    if (!content) {
      throw createResourceNotFoundError(
        'tool',
        toolName,
        'Use schema://actions to see available tool guidance resources'
      );
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: content,
        },
      ],
    };
  }

  throw createInvalidResourceUriError(
    uri,
    'schema://tools/{toolName} or schema://actions/{toolName}'
  );
}

/**
 * Register schema resources with the MCP server
 *
 * Registers resources for tool schema access:
 * - schema://tools - Index of all tool schemas
 * - schema://tools/{toolName} - Full schema for a specific tool
 *
 * When DEFER_SCHEMAS is enabled, Claude should read these resources
 * before calling tools to understand available actions.
 *
 * @param server - McpServer instance
 */
export function registerSchemaResources(server: McpServer): void {
  try {
    // Schema index - lists all available tool schemas
    server.registerResource(
      'Tool Schema Index',
      'schema://tools',
      {
        description:
          'Index of all ServalSheets tool schemas. Lists all tools with their URIs and metadata.',
        mimeType: 'application/json',
      },
      async (uri) => readSchemaResource(typeof uri === 'string' ? uri : String(uri))
    );

    // Register resource template for individual tool schemas
    // Uses ResourceTemplate so the SDK resolves {toolName} dynamically
    const schemaTemplate = new ResourceTemplate('schema://tools/{toolName}', {
      list: undefined,
      complete: {
        toolName: () => TOOL_DEFINITIONS.map((t) => t.name),
      },
    });

    server.registerResource(
      'Tool Schema',
      schemaTemplate,
      {
        description:
          'Full JSON Schema for a specific tool. Includes all actions, parameters, and validation rules.',
        mimeType: 'application/json',
      },
      async (uri, variables) => {
        const toolName = Array.isArray(variables['toolName'])
          ? variables['toolName'][0]
          : variables['toolName'];
        return readSchemaResource(`schema://tools/${toolName}`);
      }
    );

    server.registerResource(
      'Action Guidance Index',
      'schema://actions',
      {
        description:
          'Index of action-level guidance resources. Use schema://actions/{toolName} for per-action annotations.',
        mimeType: 'application/json',
      },
      async (uri) => readSchemaResource(typeof uri === 'string' ? uri : String(uri))
    );

    const actionsTemplate = new ResourceTemplate('schema://actions/{toolName}', {
      list: undefined,
      complete: {
        toolName: () => TOOL_DEFINITIONS.map((t) => t.name),
      },
    });

    server.registerResource(
      'Action Guidance',
      actionsTemplate,
      {
        description:
          'Per-action model guidance for a tool (idempotency, pitfalls, when to use, and alternatives).',
        mimeType: 'application/json',
      },
      async (_uri, variables) => {
        const toolName = Array.isArray(variables['toolName'])
          ? variables['toolName'][0]
          : variables['toolName'];
        return readSchemaResource(`schema://actions/${toolName}`);
      }
    );

    logger.info('Schema resources registered', {
      component: 'resources/schemas',
      toolCount: TOOL_DEFINITIONS.length,
    });
  } catch (error) {
    logger.error('Failed to register schema resources', {
      component: 'resources/schemas',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
