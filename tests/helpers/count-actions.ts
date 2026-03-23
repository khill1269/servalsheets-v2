/**
 * Helper utilities for dynamically calculating action counts
 *
 * These helpers ensure tests validate against actual action definitions
 * rather than hardcoded values, preventing drift between tests and reality.
 */

/**
 * Calculate total action count from TOOL_ACTIONS map
 *
 * @param toolActions - Map of tool names to action arrays
 * @returns Total number of actions across all tools
 *
 * @example
 * const total = calculateTotalActions(TOOL_ACTIONS);
 * expect(ACTION_COUNT).toBe(total); // Dynamic validation
 */
export function calculateTotalActions(toolActions: Record<string, string[]>): number {
  return Object.values(toolActions).reduce((sum, actions) => sum + actions.length, 0);
}

/**
 * Calculate action count for a specific tool
 *
 * @param toolActions - Map of tool names to action arrays
 * @param toolName - Name of the tool (e.g., 'sheets_core')
 * @returns Number of actions for the specified tool
 *
 * @example
 * const coreActions = calculateToolActionCount(TOOL_ACTIONS, 'sheets_core');
 * expect(coreActions).toBeGreaterThan(0);
 */
export function calculateToolActionCount(
  toolActions: Record<string, string[]>,
  toolName: string
): number {
  return toolActions[toolName]?.length ?? 0;
}

/**
 * Validate that a tool has the expected number of actions
 *
 * @param toolActions - Map of tool names to action arrays
 * @param toolName - Name of the tool
 * @param expectedCount - Expected number of actions
 * @returns True if count matches, false otherwise
 *
 * @example
 * expect(validateToolActionCount(TOOL_ACTIONS, 'sheets_core', 19)).toBe(true);
 */
export function validateToolActionCount(
  toolActions: Record<string, string[]>,
  toolName: string,
  expectedCount: number
): boolean {
  const actualCount = calculateToolActionCount(toolActions, toolName);
  return actualCount === expectedCount;
}

/**
 * Get list of all tool names from TOOL_ACTIONS
 *
 * @param toolActions - Map of tool names to action arrays
 * @returns Sorted array of tool names
 *
 * @example
 * const tools = getToolNames(TOOL_ACTIONS);
 * expect(tools).toContain('sheets_core');
 */
export function getToolNames(toolActions: Record<string, string[]>): string[] {
  return Object.keys(toolActions).sort();
}
