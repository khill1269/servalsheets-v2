/**
 * ServalSheets - Tool Definitions
 *
 * Complete tool registry with Zod schemas and metadata.
 *
 * @module mcp/registration/tool-definitions
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';

import { DEFER_DESCRIPTIONS } from '../../config/constants.js';
import { getLazyLoadTools } from '../../config/schema-optimization.js';
import {
  SheetsAuthInputSchema,
  SheetsAuthOutputSchema,
  SHEETS_AUTH_ANNOTATIONS,
  SheetsCoreInputSchema,
  SheetsCoreOutputSchema,
  SHEETS_CORE_ANNOTATIONS,
  SheetsDataInputSchema,
  SheetsDataOutputSchema,
  SHEETS_DATA_ANNOTATIONS,
  SheetsFormatInputSchema,
  SheetsFormatOutputSchema,
  SHEETS_FORMAT_ANNOTATIONS,
  SheetsDimensionsInputSchema,
  SheetsDimensionsOutputSchema,
  SHEETS_DIMENSIONS_ANNOTATIONS,
  SheetsVisualizeInputSchema,
  SheetsVisualizeOutputSchema,
  SHEETS_VISUALIZE_ANNOTATIONS,
  SheetsCollaborateInputSchema,
  SheetsCollaborateOutputSchema,
  SHEETS_COLLABORATE_ANNOTATIONS,
  SheetsAdvancedInputSchema,
  SheetsAdvancedOutputSchema,
  SHEETS_ADVANCED_ANNOTATIONS,
  SheetsTransactionInputSchema,
  SheetsTransactionOutputSchema,
  SHEETS_TRANSACTION_ANNOTATIONS,
  SheetsQualityInputSchema,
  SheetsQualityOutputSchema,
  SHEETS_QUALITY_ANNOTATIONS,
  SheetsHistoryInputSchema,
  SheetsHistoryOutputSchema,
  SHEETS_HISTORY_ANNOTATIONS,
  // New MCP-native tools
  SheetsConfirmInputSchema,
  SheetsConfirmOutputSchema,
  SHEETS_CONFIRM_ANNOTATIONS,
  SheetsAnalyzeInputSchema,
  SheetsAnalyzeOutputSchema,
  SHEETS_ANALYZE_ANNOTATIONS,
  SheetsFixInputSchema,
  SheetsFixOutputSchema,
  SHEETS_FIX_ANNOTATIONS,
  // Composite operations
  CompositeInputSchema,
  CompositeOutputSchema,
  SHEETS_COMPOSITE_ANNOTATIONS,
  // Session context for NL excellence
  SheetsSessionInputSchema,
  SheetsSessionOutputSchema,
  SHEETS_SESSION_ANNOTATIONS,
  // Tier 7 Enterprise tools
  SheetsTemplatesInputSchema,
  SheetsTemplatesOutputSchema,
  SHEETS_TEMPLATES_ANNOTATIONS,
  SheetsBigQueryInputSchema,
  SheetsBigQueryOutputSchema,
  SHEETS_BIGQUERY_ANNOTATIONS,
  SheetsAppsScriptInputSchema,
  SheetsAppsScriptOutputSchema,
  SHEETS_APPSSCRIPT_ANNOTATIONS,
  // Phase 3 tools
  SheetsWebhookInputSchema,
  SheetsWebhookOutputSchema,
  SHEETS_WEBHOOK_ANNOTATIONS,
  SheetsDependenciesInputSchema,
  SheetsDependenciesOutputSchema,
  SHEETS_DEPENDENCIES_ANNOTATIONS,
  // Feature 3: Federation
  SheetsFederationInputSchema,
  SheetsFederationOutputSchema,
  SHEETS_FEDERATION_ANNOTATIONS,
  // Phase 5: Computation Engine
  SheetsComputeInputSchema,
  SheetsComputeOutputSchema,
  SHEETS_COMPUTE_ANNOTATIONS,
  // Phase 6: Agent Loop
  SheetsAgentInputSchema,
  SheetsAgentOutputSchema,
  SHEETS_AGENT_ANNOTATIONS,
  // Wave 6: Live Data Connectors
  SheetsConnectorsInputSchema,
  SheetsConnectorsOutputSchema,
  SHEETS_CONNECTORS_ANNOTATIONS,
  // LLM-optimized descriptions
  TOOL_DESCRIPTIONS,
  TOOL_DESCRIPTIONS_MINIMAL,
} from '../../schemas/index.js';

/**
 * Get the appropriate tool description based on DEFER_DESCRIPTIONS setting.
 *
 * When DEFER_DESCRIPTIONS=true, uses minimal ~100 char descriptions to save ~7,700 tokens.
 * Full documentation available via schema://tools/{toolName} resources.
 */
function getDescription(toolName: string): string {
  if (DEFER_DESCRIPTIONS) {
    return TOOL_DESCRIPTIONS_MINIMAL[toolName] ?? TOOL_DESCRIPTIONS[toolName] ?? '';
  }
  return TOOL_DESCRIPTIONS[toolName] ?? '';
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tool definition with Zod schemas
 *
 * Schemas can be z.object(), z.discriminatedUnion(), or other Zod types.
 * The SDK compatibility layer handles conversion to JSON Schema.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ZodTypeAny;
  readonly outputSchema: ZodTypeAny;
  readonly annotations: ToolAnnotations;
  /**
   * Authentication policy used by transport layers.
   * Defaults to `{ requiresAuth: true }` when omitted.
   */
  readonly authPolicy?: ToolAuthPolicy;
}

export interface ToolAuthPolicy {
  /**
   * When false, this tool can be called without Google auth.
   */
  readonly requiresAuth?: boolean;
  /**
   * Per-action auth exemptions for tools that are mostly authenticated.
   */
  readonly exemptActions?: readonly string[];
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

/**
 * Complete tool registry for ServalSheets
 *
 * 25 tools after consolidation + enterprise additions:
 * - Wave 1: sheets_core (replaces sheets_spreadsheet + sheets_sheet)
 * - Wave 1: sheets_visualize (replaces sheets_charts + sheets_pivot)
 * - Wave 1: sheets_collaborate (replaces sheets_sharing + sheets_comments + sheets_versions)
 * - Wave 2: sheets_format (absorbed sheets_rules conditional formatting + data validation)
 * - Wave 2: sheets_dimensions (absorbed sheets_filter_sort filtering + sorting)
 * - Wave 3: sheets_quality (replaces sheets_validation + sheets_conflict + sheets_impact)
 * - Wave 4: sheets_data (replaces sheets_values + sheets_cells)
 *
 * Schema Pattern: z.object({ request: z.discriminatedUnion('action', ...) })
 * - Actions are discriminated by `action` within `request`
 * - Responses are discriminated by `success` within `response`
 *
 * Note: Removed sheets_plan and sheets_insights (anti-patterns).
 * Replaced with sheets_confirm (Elicitation) and sheets_analyze (Sampling).
 *
 * Descriptions: All tool descriptions are imported from descriptions.ts to maintain
 * a single source of truth for LLM-optimized tool descriptions.
 */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'sheets_auth',
    title: 'Authentication',
    description: getDescription('sheets_auth'),
    inputSchema: SheetsAuthInputSchema,
    outputSchema: SheetsAuthOutputSchema,
    annotations: SHEETS_AUTH_ANNOTATIONS,
    authPolicy: { requiresAuth: false },
  },
  {
    name: 'sheets_core',
    title: 'Spreadsheet & Sheet Management',
    description: getDescription('sheets_core'),
    inputSchema: SheetsCoreInputSchema,
    outputSchema: SheetsCoreOutputSchema,
    annotations: SHEETS_CORE_ANNOTATIONS,
  },
  {
    name: 'sheets_data',
    title: 'Cell Data Operations',
    description: getDescription('sheets_data'),
    inputSchema: SheetsDataInputSchema,
    outputSchema: SheetsDataOutputSchema,
    annotations: SHEETS_DATA_ANNOTATIONS,
  },
  {
    name: 'sheets_format',
    title: 'Formatting & Styling',
    description: getDescription('sheets_format'),
    inputSchema: SheetsFormatInputSchema,
    outputSchema: SheetsFormatOutputSchema,
    annotations: SHEETS_FORMAT_ANNOTATIONS,
  },
  {
    name: 'sheets_dimensions',
    title: 'Rows, Columns & Sorting',
    description: getDescription('sheets_dimensions'),
    inputSchema: SheetsDimensionsInputSchema,
    outputSchema: SheetsDimensionsOutputSchema,
    annotations: SHEETS_DIMENSIONS_ANNOTATIONS,
  },
  {
    name: 'sheets_visualize',
    title: 'Charts & Pivot Tables',
    description: getDescription('sheets_visualize'),
    inputSchema: SheetsVisualizeInputSchema,
    outputSchema: SheetsVisualizeOutputSchema,
    annotations: SHEETS_VISUALIZE_ANNOTATIONS,
  },
  {
    name: 'sheets_collaborate',
    title: 'Sharing & Collaboration',
    description: getDescription('sheets_collaborate'),
    inputSchema: SheetsCollaborateInputSchema,
    outputSchema: SheetsCollaborateOutputSchema,
    annotations: SHEETS_COLLABORATE_ANNOTATIONS,
  },
  {
    name: 'sheets_advanced',
    title: 'Named Ranges, Protection & Tables',
    description: getDescription('sheets_advanced'),
    inputSchema: SheetsAdvancedInputSchema,
    outputSchema: SheetsAdvancedOutputSchema,
    annotations: SHEETS_ADVANCED_ANNOTATIONS,
  },
  {
    name: 'sheets_transaction',
    title: 'Atomic Batch Operations',
    description: getDescription('sheets_transaction'),
    inputSchema: SheetsTransactionInputSchema,
    outputSchema: SheetsTransactionOutputSchema,
    annotations: SHEETS_TRANSACTION_ANNOTATIONS,
  },
  {
    name: 'sheets_quality',
    title: 'Data Validation & Quality',
    description: getDescription('sheets_quality'),
    inputSchema: SheetsQualityInputSchema,
    outputSchema: SheetsQualityOutputSchema,
    annotations: SHEETS_QUALITY_ANNOTATIONS,
  },
  {
    name: 'sheets_history',
    title: 'Operation History & Undo',
    description: getDescription('sheets_history'),
    inputSchema: SheetsHistoryInputSchema,
    outputSchema: SheetsHistoryOutputSchema,
    annotations: SHEETS_HISTORY_ANNOTATIONS,
    authPolicy: { exemptActions: ['list', 'get', 'stats'] },
  },
  // ============================================================================
  // MCP-NATIVE TOOLS (Elicitation & Sampling)
  // ============================================================================
  {
    name: 'sheets_confirm',
    title: 'User Confirmation & Approval',
    description: getDescription('sheets_confirm'),
    inputSchema: SheetsConfirmInputSchema,
    outputSchema: SheetsConfirmOutputSchema,
    annotations: SHEETS_CONFIRM_ANNOTATIONS,
    authPolicy: { requiresAuth: false },
  },
  {
    name: 'sheets_analyze',
    title: 'AI-Powered Analysis',
    description: getDescription('sheets_analyze'),
    inputSchema: SheetsAnalyzeInputSchema,
    outputSchema: SheetsAnalyzeOutputSchema,
    annotations: SHEETS_ANALYZE_ANNOTATIONS,
  },
  {
    name: 'sheets_fix',
    title: 'Auto-Fix Issues',
    description: getDescription('sheets_fix'),
    inputSchema: SheetsFixInputSchema,
    outputSchema: SheetsFixOutputSchema,
    annotations: SHEETS_FIX_ANNOTATIONS,
  },
  {
    name: 'sheets_composite',
    title: 'Multi-Step Operations',
    description: getDescription('sheets_composite'),
    inputSchema: CompositeInputSchema,
    outputSchema: CompositeOutputSchema,
    annotations: SHEETS_COMPOSITE_ANNOTATIONS,
    authPolicy: { exemptActions: ['generate_template', 'preview_generation'] },
  },
  {
    name: 'sheets_session',
    title: 'Session & Context Management',
    description: getDescription('sheets_session'),
    inputSchema: SheetsSessionInputSchema,
    outputSchema: SheetsSessionOutputSchema,
    annotations: SHEETS_SESSION_ANNOTATIONS,
    authPolicy: { requiresAuth: false },
  },
  // ============================================================================
  // TIER 7 ENTERPRISE TOOLS
  // ============================================================================
  {
    name: 'sheets_templates',
    title: 'Spreadsheet Templates',
    description: getDescription('sheets_templates'),
    inputSchema: SheetsTemplatesInputSchema,
    outputSchema: SheetsTemplatesOutputSchema,
    annotations: SHEETS_TEMPLATES_ANNOTATIONS,
  },
  // ============================================================================
  // TIER 7: BIGQUERY INTEGRATION
  // ============================================================================
  {
    name: 'sheets_bigquery',
    title: 'BigQuery Integration',
    description: getDescription('sheets_bigquery'),
    inputSchema: SheetsBigQueryInputSchema,
    outputSchema: SheetsBigQueryOutputSchema,
    annotations: SHEETS_BIGQUERY_ANNOTATIONS,
  },
  // ============================================================================
  // TIER 7: APPS SCRIPT AUTOMATION
  // ============================================================================
  {
    name: 'sheets_appsscript',
    title: 'Apps Script Automation',
    description: getDescription('sheets_appsscript'),
    inputSchema: SheetsAppsScriptInputSchema,
    outputSchema: SheetsAppsScriptOutputSchema,
    annotations: SHEETS_APPSSCRIPT_ANNOTATIONS,
  },
  // ============================================================================
  // PHASE 3: WEBHOOKS & DEPENDENCIES
  // ============================================================================
  {
    name: 'sheets_webhook',
    title: 'Webhook Notifications',
    description: getDescription('sheets_webhook'),
    inputSchema: SheetsWebhookInputSchema,
    outputSchema: SheetsWebhookOutputSchema,
    annotations: SHEETS_WEBHOOK_ANNOTATIONS,
  },
  {
    name: 'sheets_dependencies',
    title: 'Formula Dependencies',
    description: getDescription('sheets_dependencies'),
    inputSchema: SheetsDependenciesInputSchema,
    outputSchema: SheetsDependenciesOutputSchema,
    annotations: SHEETS_DEPENDENCIES_ANNOTATIONS,
  },
  // ============================================================================
  // FEATURE 3: MCP SERVER FEDERATION
  // ============================================================================
  {
    name: 'sheets_federation',
    title: 'MCP Server Federation',
    description: getDescription('sheets_federation'),
    inputSchema: SheetsFederationInputSchema,
    outputSchema: SheetsFederationOutputSchema,
    annotations: SHEETS_FEDERATION_ANNOTATIONS,
  },
  // ============================================================================
  // PHASE 5: COMPUTATION ENGINE
  // ============================================================================
  {
    name: 'sheets_compute',
    title: 'Computation Engine',
    description: getDescription('sheets_compute'),
    inputSchema: SheetsComputeInputSchema,
    outputSchema: SheetsComputeOutputSchema,
    annotations: SHEETS_COMPUTE_ANNOTATIONS,
  },
  // ============================================================================
  // PHASE 6: AGENT LOOP
  // ============================================================================
  {
    name: 'sheets_agent',
    title: 'Agentic Execution',
    description: getDescription('sheets_agent'),
    inputSchema: SheetsAgentInputSchema,
    outputSchema: SheetsAgentOutputSchema,
    annotations: SHEETS_AGENT_ANNOTATIONS,
  },
  // ============================================================================
  // WAVE 6: LIVE DATA CONNECTORS
  // ============================================================================
  {
    name: 'sheets_connectors',
    title: 'Live Data Connectors',
    description: getDescription('sheets_connectors'),
    inputSchema: SheetsConnectorsInputSchema,
    outputSchema: SheetsConnectorsOutputSchema,
    annotations: SHEETS_CONNECTORS_ANNOTATIONS,
  },
] as const;

// ============================================================================
// TOOL FILTERING BY MODE
// ============================================================================

/**
 * All 25 tools — always registered (MCP 2025-11-25 approach)
 *
 * Payload size managed by DEFER_DESCRIPTIONS + DEFER_SCHEMAS (auto-on for
 * STDIO / Claude Desktop): tools/list stays ~5KB regardless of action count.
 * Full schemas load on-demand via schema://tools/{name} MCP resources.
 *
 * The server emits notifications/tools/list_changed when runtime state
 * changes (OAuth, session, federation). Clients re-request tools/list.
 *
 * LAZY_LOAD_ENTERPRISE=true or LAZY_LOAD_TOOLS=a,b can still exclude
 * specific tools for specialized deployments.
 */
export const ACTIVE_TOOL_DEFINITIONS: readonly ToolDefinition[] = (() => {
  const lazyLoadTools = getLazyLoadTools();
  return TOOL_DEFINITIONS.filter((t) => !lazyLoadTools.includes(t.name));
})();

/**
 * Get lazy-loaded tool definitions (for on-demand loading)
 *
 * These tools are not included in the initial tools/list response
 * but can be loaded later via tool discovery.
 */
export function getLazyToolDefinitions(): readonly ToolDefinition[] {
  const lazyLoadTools = getLazyLoadTools();
  return TOOL_DEFINITIONS.filter((t) => lazyLoadTools.includes(t.name));
}

/**
 * Get a specific tool definition by name (includes lazy-loaded tools)
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

const EMPTY_ACTION_LIST: readonly string[] = [];
const DEFAULT_TOOL_AUTH_POLICY: Readonly<Required<ToolAuthPolicy>> = {
  requiresAuth: true,
  exemptActions: EMPTY_ACTION_LIST,
};

/**
 * Resolve auth policy for a tool (with defaults applied).
 */
export function getToolAuthPolicy(toolName: string): Readonly<Required<ToolAuthPolicy>> {
  const definition = getToolDefinition(toolName);
  if (!definition?.authPolicy) {
    return DEFAULT_TOOL_AUTH_POLICY;
  }

  return {
    requiresAuth: definition.authPolicy.requiresAuth ?? true,
    exemptActions: definition.authPolicy.exemptActions ?? EMPTY_ACTION_LIST,
  };
}

/**
 * Whether a specific tool call is exempt from authentication.
 */
export function isToolCallAuthExempt(toolName: string, action?: string): boolean {
  const policy = getToolAuthPolicy(toolName);
  if (!policy.requiresAuth) {
    return true;
  }
  return Boolean(action && policy.exemptActions.includes(action));
}

// ---------------------------------------------------------------------------
// Architecture bridge: provide TOOL_DEFINITIONS input schemas to the services
// layer without requiring services to import from mcp/registration (G3 fix).
// ---------------------------------------------------------------------------
import { registerToolInputSchemas } from '../../services/agent-engine.js';

registerToolInputSchemas(new Map(TOOL_DEFINITIONS.map((t) => [t.name, t.inputSchema] as const)));
