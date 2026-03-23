import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_ACTIONS } from '../../src/mcp/completions.js';

function collectInvalidActionReferences(filePath: string): string[] {
  const text = readFileSync(filePath, 'utf8');
  const invalid: string[] = [];
  const seen = new Set<string>();

  const explicitActionPattern = /(sheets_[a-z_]+)[^\n]{0,120}?action\s*[:=]\s*"([a-z_]+)"/g;
  for (const match of text.matchAll(explicitActionPattern)) {
    const toolName = match[1]!;
    const actionName = match[2]!;
    if (!TOOL_ACTIONS[toolName]?.includes(actionName)) {
      const key = `${toolName}:${actionName}`;
      if (!seen.has(key)) {
        seen.add(key);
        invalid.push(key);
      }
    }
  }

  const jsonPlanPattern =
    /"tool"\s*:\s*"(sheets_[a-z_]+)"\s*,\s*"action"\s*:\s*"([a-z_]+)"/g;
  for (const match of text.matchAll(jsonPlanPattern)) {
    const toolName = match[1]!;
    const actionName = match[2]!;
    if (!TOOL_ACTIONS[toolName]?.includes(actionName)) {
      const key = `${toolName}:${actionName}`;
      if (!seen.has(key)) {
        seen.add(key);
        invalid.push(key);
      }
    }
  }

  const dottedPattern = /`(sheets_[a-z_]+)\.([a-z_]+)`/g;
  for (const match of text.matchAll(dottedPattern)) {
    const toolName = match[1]!;
    const actionName = match[2]!;
    if (!TOOL_ACTIONS[toolName]?.includes(actionName)) {
      const key = `${toolName}:${actionName}`;
      if (!seen.has(key)) {
        seen.add(key);
        invalid.push(key);
      }
    }
  }

  return invalid.sort();
}

describe('Claude-facing prompt and instruction references', () => {
  it('uses only valid tool/action references in registered prompts', () => {
    const filePath = resolve(process.cwd(), 'src/mcp/registration/prompt-registration.ts');
    expect(collectInvalidActionReferences(filePath)).toEqual([]);
  });

  it('uses only valid tool/action references in server instructions', () => {
    const filePath = resolve(process.cwd(), 'src/mcp/features-2025-11-25.ts');
    expect(collectInvalidActionReferences(filePath)).toEqual([]);
  });
});
