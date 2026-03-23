/**
 * ServalSheets - tools/list Compatibility Handler
 *
 * Overrides the MCP SDK tools/list handler to safely convert Zod v4 schemas
 * (including transforms/pipes) into JSON Schema without throwing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DEFER_SCHEMAS } from '../../config/constants.js';
import { TOOL_ICONS } from '../features-2025-11-25.js';
import { logger } from '../../utils/logger.js';
import { zodSchemaToJsonSchema } from '../../utils/schema-compat.js';
import { filterAvailableActions, getToolAvailabilityMetadata } from '../tool-availability.js';
import {
  prepareSchemaForRegistrationCached,
  buildDeferredFallbackSchema,
} from './schema-helpers.js';
import { getToolDiscoveryHint } from './tool-discovery-hints.js';

const EMPTY_OBJECT_JSON_SCHEMA = { type: 'object', properties: {} };

function isZodSchema(schema: unknown): boolean {
  return Boolean(
    schema &&
    typeof schema === 'object' &&
    ('_def' in (schema as Record<string, unknown>) || '_zod' in (schema as Record<string, unknown>))
  );
}

// P1-2 fix: Track tools that failed schema conversion so we can annotate them
const schemaConversionErrors = new Map<string, string>();

function toJsonSchema(
  schema: unknown,
  options?: { toolName?: string; schemaType?: 'input' | 'output' }
): Record<string, unknown> {
  if (!schema) {
    return EMPTY_OBJECT_JSON_SCHEMA;
  }

  const { toolName, schemaType = 'input' } = options ?? {};
  const schemaForSerialization =
    toolName && isZodSchema(schema)
      ? prepareSchemaForRegistrationCached(toolName, schema as z.ZodType, schemaType)
      : schema;

  let result: Record<string, unknown>;
  if (isZodSchema(schemaForSerialization)) {
    try {
      result = zodSchemaToJsonSchema(schemaForSerialization as unknown as import('zod').ZodTypeAny);
    } catch (err) {
      // P1-2: Full conversion failed — try deferred fallback before giving up.
      // The deferred builder extracts action enums + property names from the Zod
      // schema, producing a useful ~300-800 byte schema instead of empty {}.
      if (toolName) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Full schema conversion failed, trying deferred fallback', {
          tool: toolName,
          error: msg,
        });

        try {
          const fallback = buildDeferredFallbackSchema(schema as z.ZodType, schemaType ?? 'input');
          if (fallback && typeof fallback === 'object' && Object.keys(fallback).length > 0) {
            return fallback;
          }
        } catch (fallbackErr) {
          logger.error('Deferred fallback also failed', {
            tool: toolName,
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          });
        }

        schemaConversionErrors.set(toolName, msg);
      }
      return EMPTY_OBJECT_JSON_SCHEMA;
    }
  } else if (typeof schemaForSerialization === 'object') {
    result = schemaForSerialization as Record<string, unknown>;
  } else {
    return EMPTY_OBJECT_JSON_SCHEMA;
  }

  // MCP spec requires inputSchema MUST be type: 'object'.
  // Discriminated unions produce { anyOf: [...] } without type — wrap them.
  if (result && !('type' in result)) {
    return { type: 'object', ...result };
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeDescription(existing: unknown, addition: string | undefined): string | undefined {
  if (!addition) {
    return typeof existing === 'string' ? existing : undefined;
  }

  if (typeof existing !== 'string' || existing.trim().length === 0) {
    return addition;
  }

  if (existing.includes(addition)) {
    return existing;
  }

  return `${existing} ${addition}`;
}

function enrichToolDescription(toolName: string, description: unknown): string | undefined {
  const existing = typeof description === 'string' ? description : undefined;
  const availability = getToolAvailabilityMetadata(toolName);
  const availabilityReason =
    typeof availability?.['reason'] === 'string' ? availability['reason'] : undefined;
  const availabilitySuffix =
    toolName === 'sheets_webhook' && availabilityReason
      ? 'Redis is not configured in this server process. Redis-backed webhook actions are currently unavailable; watch_changes and workspace subscription actions remain available.'
      : toolName === 'sheets_appsscript' && availabilityReason
        ? 'Apps Script trigger compatibility actions are hidden by default because external Apps Script REST clients cannot manage triggers. Use update_content plus deploy with ScriptApp trigger code instead.'
        : undefined;

  if (!DEFER_SCHEMAS) {
    return mergeDescription(existing, availabilitySuffix);
  }

  const hint = getToolDiscoveryHint(toolName);
  return mergeDescription(mergeDescription(existing, hint?.descriptionSuffix), availabilitySuffix);
}

function enrichInputSchema(
  toolName: string,
  inputSchema: Record<string, unknown>
): Record<string, unknown> {
  // Always inject x-servalsheets.actionParams hints regardless of schema mode.
  // In deferred mode (STDIO) these are the primary parameter guide.
  // In full-schema mode (HTTP) they supplement the JSON Schema with compact
  // per-action required/optional/enum summaries that are faster to scan.
  const hint = getToolDiscoveryHint(toolName);
  if (!hint) {
    return inputSchema;
  }

  const allowedActions = new Set(filterAvailableActions(toolName, Object.keys(hint.actionParams)));
  const actionParams = Object.fromEntries(
    Object.entries(hint.actionParams).filter(([action]) => allowedActions.has(action))
  );

  const enriched: Record<string, unknown> = {
    ...inputSchema,
    'x-servalsheets': {
      ...(asRecord(inputSchema['x-servalsheets']) ?? {}),
      actionParams,
      ...(getToolAvailabilityMetadata(toolName)
        ? { availability: getToolAvailabilityMetadata(toolName) }
        : {}),
    },
  };

  const properties = asRecord(inputSchema['properties']);
  if (!properties) {
    enriched['description'] = mergeDescription(inputSchema['description'], hint.requestDescription);
    return enriched;
  }

  const requestSchema = asRecord(properties['request']);
  if (!requestSchema) {
    enriched['description'] = mergeDescription(inputSchema['description'], hint.requestDescription);
    return enriched;
  }

  let finalRequestSchema: Record<string, unknown> = {
    ...requestSchema,
    description: mergeDescription(requestSchema['description'], hint.requestDescription),
  };

  finalRequestSchema = filterRequestSchemaActions(finalRequestSchema, allowedActions);

  enriched['properties'] = {
    ...properties,
    request: finalRequestSchema,
  };

  return enriched;
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
        const variantRecord = asRecord(variant);
        const action = (variantRecord?.['properties'] as Record<string, unknown> | undefined)?.[
          'action'
        ] as Record<string, unknown> | undefined;
        const actionName = action?.['const'] ?? (action?.['enum'] as unknown[])?.[0];
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

  filtered['properties'] = {
    ...properties,
    action: nextActionSchema,
  };

  return filtered;
}

export function registerToolsListCompatibilityHandler(server: McpServer): void {
  const protocolServer = server.server as unknown as {
    setRequestHandler: typeof server.server.setRequestHandler;
  };

  const registeredTools = (
    server as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK internal property type
      _registeredTools?: Record<string, any>;
    }
  )._registeredTools;

  protocolServer.setRequestHandler(
    ListToolsRequestSchema,
    (_request: z.infer<typeof ListToolsRequestSchema>) => {
      // Accept cursor param per MCP 2025-11-25 spec (single-page response for ≤25 tools)
      // cursor is intentionally ignored — single-page response for ≤25 tools

      return {
        tools: Object.entries(registeredTools ?? {})
          .filter(([name, tool]) => {
            if (tool?.enabled === false) return false;
            // P1-2: Exclude tools whose schemas failed to convert — they'll crash at runtime
            if (schemaConversionErrors.has(name)) {
              logger.error('Excluding tool from tools/list due to schema error', {
                tool: name,
                error: schemaConversionErrors.get(name),
              });
              return false;
            }
            return true;
          })
          .map(([name, tool]) => {
            const inputSchema = enrichInputSchema(
              name,
              toJsonSchema(tool.inputSchema, { toolName: name, schemaType: 'input' })
            );
            const toolDefinition: Record<string, unknown> = {
              name,
              title: tool.title,
              description: enrichToolDescription(name, tool.description),
              inputSchema,
              annotations: tool.annotations,
              icons: tool.icons ?? TOOL_ICONS[name],
              execution: tool.execution,
              _meta: tool._meta,
            };

            if (tool.outputSchema) {
              toolDefinition['outputSchema'] = toJsonSchema(tool.outputSchema, {
                toolName: name,
                schemaType: 'output',
              });
            }

            return toolDefinition;
          }),
        // MCP spec compliance: include nextCursor (undefined = no more pages)
        nextCursor: undefined,
      };
    }
  );
}
