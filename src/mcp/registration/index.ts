/**
 * ServalSheets - MCP Registration
 *
 * Main entry point for tool, resource, and prompt registration.
 * Orchestrates registration across multiple modules.
 *
 * @module mcp/registration
 */

// Re-export types and definitions
export type { ToolDefinition } from './tool-definitions.js';
export { TOOL_DEFINITIONS } from './tool-definitions.js';

// Re-export helpers
export {
  prepareSchemaForRegistration,
  prepareSchemaForRegistrationCached,
  verifySchemaIfNeeded,
  getCachedPreparedSchema,
  getPreparedSchemaCacheSize,
} from './schema-helpers.js';

// Re-export handler functions
export {
  createToolHandlerMap,
  buildToolResponse,
  registerServalSheetsTools,
} from './tool-handlers.js';

export { registerToolsListCompatibilityHandler } from './tools-list-compat.js';

// Re-export resource registration
export { registerServalSheetsResources } from './resource-registration.js';

// Re-export prompt registration
export { registerServalSheetsPrompts } from './prompt-registration.js';
