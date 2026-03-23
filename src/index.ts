/**
 * ServalSheets
 *
 * Production-grade Google Sheets MCP Server
 * Production-grade MCP server with safety rails and enterprise features
 * Tool/action counts: see TOOL_COUNT and ACTION_COUNT in schemas/action-counts.ts
 *
 * MCP Protocol: 2025-11-25
 * Google Sheets API: v4
 */

// Server
export {
  ServalSheetsServer,
  createServalSheetsServer,
  type ServalSheetsServerOptions,
} from './server.js';

// HTTP/SSE Transport
export {
  createHttpServer,
  startHttpServer,
  startRemoteServer,
  type HttpServerOptions,
} from './http-server.js';

// OAuth Provider
export { OAuthProvider, type OAuthConfig } from './oauth-provider.js';

// Schemas
export * from './schemas/index.js';

// Core (exports ExecutionResult type)
export * from './core/index.js';

// Services
// NOTE: services/index.js also exports ExecutionResult and RiskLevel types from agentic-planner
// which conflict with core/schemas. TypeScript will warn but both are accessible.
// Use 'import type { ExecutionResult as AgenticExecutionResult } from services/agentic-planner' if needed.
export * from './services/index.js';

// Handlers
export * from './handlers/index.js';

// Version info
export {
  VERSION,
  MCP_PROTOCOL_VERSION,
  VERSION_STRING,
  SERVER_INFO,
  SERVER_ICONS,
} from './version.js';
export const SHEETS_API_VERSION = 'v4';
