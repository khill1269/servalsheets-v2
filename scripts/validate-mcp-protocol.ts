#!/usr/bin/env tsx

import { z } from 'zod';
import { TOOL_DEFINITIONS } from '../src/mcp/registration/tool-definitions.js';
import { ACTION_COUNTS, TOOL_COUNT, ACTION_COUNT } from '../src/schemas/action-counts.js';

interface ValidationIssue {
  scope: string;
  message: string;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const out = def?.['out'];
  const innerType = def?.['innerType'];

  if (out && typeof out === 'object') {
    return out as z.ZodTypeAny;
  }
  if (innerType && typeof innerType === 'object') {
    return innerType as z.ZodTypeAny;
  }
  return schema;
}

function getActionCountFromInputSchema(inputSchema: z.ZodTypeAny): number | null {
  const rootSchema = unwrapSchema(inputSchema);
  if (!(rootSchema instanceof z.ZodObject)) {
    return null;
  }

  const rootShape = rootSchema.shape as Record<string, z.ZodTypeAny>;
  const requestSchemaRaw = rootShape['request'];
  if (!requestSchemaRaw) {
    return null;
  }

  const requestSchema = unwrapSchema(requestSchemaRaw);

  if (requestSchema instanceof z.ZodDiscriminatedUnion) {
    const options =
      ((requestSchema as unknown as { _def?: { options?: unknown[] } })._def?.options as
        | unknown[]
        | undefined) ?? [];
    return options.length;
  }

  if (requestSchema instanceof z.ZodObject) {
    const requestShape = requestSchema.shape as Record<string, z.ZodTypeAny>;
    const actionSchemaRaw = requestShape['action'];
    if (!actionSchemaRaw) {
      return null;
    }

    const actionSchema = unwrapSchema(actionSchemaRaw);
    if (actionSchema instanceof z.ZodEnum) {
      return actionSchema.options.length;
    }
    if (actionSchema instanceof z.ZodLiteral) {
      return 1;
    }
    return 1;
  }

  return null;
}

function validateToolDefinitions(issues: ValidationIssue[]): void {
  const seenNames = new Set<string>();

  for (const tool of TOOL_DEFINITIONS) {
    if (!/^sheets_[a-z0-9_]+$/.test(tool.name)) {
      issues.push({
        scope: tool.name,
        message: `Tool name must be snake_case and start with sheets_: ${tool.name}`,
      });
    }

    if (seenNames.has(tool.name)) {
      issues.push({
        scope: tool.name,
        message: `Duplicate tool name: ${tool.name}`,
      });
    }
    seenNames.add(tool.name);

    if (!tool.description || tool.description.trim().length === 0) {
      issues.push({
        scope: tool.name,
        message: 'Missing tool description',
      });
    }

    if (!tool.inputSchema) {
      issues.push({
        scope: tool.name,
        message: 'Missing input schema',
      });
    }

    if (!tool.outputSchema) {
      issues.push({
        scope: tool.name,
        message: 'Missing output schema',
      });
    }

    if (!tool.annotations || typeof tool.annotations !== 'object') {
      issues.push({
        scope: tool.name,
        message: 'Missing annotations object',
      });
    }

    const expectedActionCount = ACTION_COUNTS[tool.name];
    if (expectedActionCount === undefined) {
      issues.push({
        scope: tool.name,
        message: 'Missing ACTION_COUNTS entry for tool',
      });
      continue;
    }

    const schemaActionCount = getActionCountFromInputSchema(tool.inputSchema);
    if (schemaActionCount === null) {
      issues.push({
        scope: tool.name,
        message: 'Could not derive action count from input schema',
      });
      continue;
    }

    if (schemaActionCount !== expectedActionCount) {
      issues.push({
        scope: tool.name,
        message: `Action count mismatch: schema=${schemaActionCount}, action-counts=${expectedActionCount}`,
      });
    }
  }

  for (const actionCountTool of Object.keys(ACTION_COUNTS)) {
    if (!TOOL_DEFINITIONS.some((tool) => tool.name === actionCountTool)) {
      issues.push({
        scope: actionCountTool,
        message: 'ACTION_COUNTS contains tool not present in TOOL_DEFINITIONS',
      });
    }
  }
}

function validateAggregateCounts(issues: ValidationIssue[]): void {
  const definitionToolCount = TOOL_DEFINITIONS.length;
  const actionCountsToolCount = Object.keys(ACTION_COUNTS).length;
  const computedActionCount = Object.values(ACTION_COUNTS).reduce((sum, count) => sum + count, 0);

  if (TOOL_COUNT !== definitionToolCount) {
    issues.push({
      scope: 'counts',
      message: `TOOL_COUNT (${TOOL_COUNT}) does not match TOOL_DEFINITIONS.length (${definitionToolCount})`,
    });
  }

  if (TOOL_COUNT !== actionCountsToolCount) {
    issues.push({
      scope: 'counts',
      message: `TOOL_COUNT (${TOOL_COUNT}) does not match ACTION_COUNTS key count (${actionCountsToolCount})`,
    });
  }

  if (ACTION_COUNT !== computedActionCount) {
    issues.push({
      scope: 'counts',
      message: `ACTION_COUNT (${ACTION_COUNT}) does not match sum(ACTION_COUNTS) (${computedActionCount})`,
    });
  }
}

function main(): number {
  const issues: ValidationIssue[] = [];

  validateToolDefinitions(issues);
  validateAggregateCounts(issues);

  if (issues.length > 0) {
    console.error('MCP protocol metadata validation failed:');
    for (const issue of issues) {
      console.error(`- [${issue.scope}] ${issue.message}`);
    }
    return 1;
  }

  console.log(
    `MCP metadata validation passed (${TOOL_DEFINITIONS.length} tools, ${ACTION_COUNT} actions).`
  );
  return 0;
}

process.exit(main());
