/**
 * Runtime view of the tools currently exposed to the MCP client.
 *
 * This is intentionally lightweight and import-safe so completions/resources can
 * track live registration state without depending on the full tool definition graph.
 */

import { filterAvailableActions } from './tool-availability.js';

let availableToolNames: string[] | null = null;

function normalizeToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames)].sort();
}

export function replaceAvailableToolNames(toolNames: readonly string[]): void {
  availableToolNames = normalizeToolNames(toolNames);
}

export function resetAvailableToolNames(): void {
  availableToolNames = null;
}

export function getAvailableToolNames(fallbackToolNames: readonly string[]): string[] {
  return availableToolNames ? [...availableToolNames] : normalizeToolNames(fallbackToolNames);
}

export function getAvailableToolActions(
  toolName: string,
  allToolActions: Readonly<Record<string, readonly string[]>>,
  fallbackToolNames: readonly string[]
): readonly string[] {
  const availableTools = new Set(getAvailableToolNames(fallbackToolNames));
  if (!availableTools.has(toolName)) {
    return [];
  }
  return filterAvailableActions(toolName, allToolActions[toolName] ?? []);
}
