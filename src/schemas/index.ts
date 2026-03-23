/**
 * ServalSheets - Schema Index
 *
 * Re-exports all schemas for easy importing.
 *
 * Architectural Notes (MCP 2025-11-25):
 * - sheets_confirm: Uses Elicitation (SEP-1036) for user confirmation
 * - sheets_analyze: Uses Sampling (SEP-1577) for AI analysis
 * - Removed: sheets_plan, sheets_insights (replaced by MCP-native patterns)
 */

// Shared types
export * from './shared.js';

// Action counts (source of truth, no dependencies)
export * from './action-counts.js';

// Tool annotations
export * from './annotations.js';

// LLM-optimized tool descriptions
export * from './descriptions.js';
export * from './descriptions-minimal.js';

// Core tool schemas
export * from './auth.js';
export * from './core.js'; // Consolidated spreadsheet + sheet
export * from './data.js'; // Consolidated values + cells (Wave 4)
export * from './format.js';
export * from './dimensions.js';
export * from './visualize.js'; // Consolidated charts + pivot
export * from './collaborate.js'; // Consolidated sharing + comments + versions
export * from './advanced.js';
export * from './transaction.js';
export * from './quality.js';
export * from './history.js';
export * from './prompts.js';

// MCP-native tool schemas (Elicitation & Sampling)
export * from './confirm.js'; // Uses Elicitation (SEP-1036)
export * from './analyze.js'; // Uses Sampling (SEP-1577)
export * from './fix.js'; // Automated issue resolution
export * from './composite.js'; // High-level composite operations
export * from './session.js'; // Session context for NL excellence
export * from './templates.js'; // Enterprise templates (Tier 7)
export * from './bigquery.js'; // BigQuery Connected Sheets (Tier 7)
export * from './appsscript.js'; // Apps Script automation (Tier 7)
export * from './webhook.js'; // Webhook notifications
export * from './dependencies.js'; // Formula dependency analysis
export * from './federation.js'; // MCP server federation (Feature 3)
export * from './compute.js'; // Computation engine (Phase 5)
export * from './agent.js'; // Agent loop (Phase 6)
export * from './connectors.js'; // Live data connectors (Wave 6)

// Action-level metadata for AI cost-aware decision making
export * from './action-metadata.js';

// Tool actions for completions and test orchestration
// This is the single source of truth for action lists
export { TOOL_ACTIONS } from '../mcp/completions.js';

// Tool metadata for registration is defined in src/mcp/registration/tool-definitions.ts.
// For action lists, use TOOL_ACTIONS from src/mcp/completions.ts.

// TOOL_COUNT, ACTION_COUNT, ACTION_COUNTS are re-exported from action-counts.ts (line 16)
