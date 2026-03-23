/**
 * AQUI-VR Gate G17 — TOOL_ACTIONS Cross-Map Consistency
 *
 * Verifies that every entry in TOOL_ACTIONS (completions.ts) exactly matches
 * the discriminated union action literals in the corresponding tool's input schema
 * (from TOOL_DEFINITIONS).
 *
 * Prevents silent drift where a renamed action in the schema is not reflected in
 * completions, causing autocompletion to suggest non-existent actions.
 */

import { describe, it, expect } from 'vitest';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';
import { TOOL_DEFINITIONS } from '../../src/mcp/registration/tool-definitions.js';
import type { ZodTypeAny } from 'zod';

/** Extract action literal values from a tool's input schema discriminated union. */
function extractSchemaActions(inputSchema: ZodTypeAny): string[] | null {
  // Schema shape: z.object({ request: z.discriminatedUnion('action', [...]) })
  const shape = (inputSchema as { shape?: Record<string, ZodTypeAny> }).shape;
  if (!shape?.['request']) return null;

  const requestSchema = shape['request'];
  const def = (requestSchema as { _def?: Record<string, unknown> })._def;
  if (!def) return null;

  // Zod v4: _def.options is an array of ZodObject, discriminator is 'action'
  const options = def['options'] as Array<{ shape?: Record<string, ZodTypeAny> }> | undefined;
  const discriminator = def['discriminator'] as string | undefined;

  if (!Array.isArray(options) || discriminator !== 'action') return null;

  const actions: string[] = [];
  for (const option of options) {
    const actionField = option.shape?.['action'];
    if (!actionField) continue;
    const fieldDef = (actionField as { _def?: Record<string, unknown> })._def;
    // Zod v4 ZodLiteral uses 'values' array
    const values = fieldDef?.['values'] as unknown[] | undefined;
    if (Array.isArray(values) && values.length > 0) {
      actions.push(String(values[0]));
    }
  }

  return actions.length > 0 ? actions : null;
}

describe('TOOL_ACTIONS cross-map consistency (G17)', () => {
  const toolDefinitionsByName = new Map(TOOL_DEFINITIONS.map(t => [t.name, t]));

  it('TOOL_ACTIONS contains entries for all 25 registered tools', () => {
    const toolNames = TOOL_DEFINITIONS.map(t => t.name);
    const missingFromCompletions = toolNames.filter(name => !(name in TOOL_ACTIONS));
    expect(missingFromCompletions).toEqual([]);
  });

  it('TOOL_ACTIONS has no entries for unregistered tools', () => {
    const toolNames = new Set(TOOL_DEFINITIONS.map(t => t.name));
    const phantomTools = Object.keys(TOOL_ACTIONS).filter(name => !toolNames.has(name));
    expect(phantomTools).toEqual([]);
  });

  for (const [toolName, completionActions] of Object.entries(TOOL_ACTIONS)) {
    const toolDef = toolDefinitionsByName.get(toolName);
    if (!toolDef) continue; // covered by the "no phantom tools" test above

    it(`${toolName}: TOOL_ACTIONS matches schema discriminated union`, () => {
      const schemaActions = extractSchemaActions(toolDef.inputSchema);

      if (schemaActions === null) {
        // Schema does not follow the standard discriminated union shape — skip diff
        // (Zod v4 preprocess/pipe schemas are excluded; see llm-compatibility.test.ts)
        console.warn(
          `${toolName}: could not extract schema actions — schema may use preprocess/pipe`
        );
        return;
      }

      const completionSet = new Set(completionActions);
      const schemaSet = new Set(schemaActions);

      const inCompletionNotSchema = completionActions.filter(a => !schemaSet.has(a));
      const inSchemaNoteCompletion = schemaActions.filter(a => !completionSet.has(a));

      expect(inCompletionNotSchema).toEqual(
        [],
        `${toolName}: completions.ts has actions not in schema: ${inCompletionNotSchema.join(', ')}`
      );
      expect(inSchemaNoteCompletion).toEqual(
        [],
        `${toolName}: schema has actions not in completions.ts: ${inSchemaNoteCompletion.join(', ')}`
      );
    });
  }
});
