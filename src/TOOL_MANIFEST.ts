/**
 * ServalSheets — Tool Manifest
 * Machine-readable registry of all 25 tools, their schemas, handlers, and services.
 * Auto-generated reference for AI discovery and developer onboarding.
 *
 * Source of truth: src/generated/action-counts.ts
 * Generated: 2026-03-23
 */

import { ACTION_COUNTS, ACTION_COUNT, TOOL_COUNT } from './generated/action-counts.js';

/**
 * Tool entry metadata
 */
export interface ToolEntry {
  /** Tool name (e.g., 'sheets_core') */
  name: string;
  /** Number of actions in this tool */
  actions: number;
  /** Path to handler file (e.g., 'src/handlers/core.ts') */
  handlerFile: string;
  /** Path to schema file (e.g., 'src/schemas/core.ts') */
  schemaFile: string;
  /** Handler architecture: BaseHandler (extends base) or Standalone (implements handle directly) */
  handlerType: 'BaseHandler' | 'Standalone';
  /** Primary service dependencies */
  keyServices: string[];
  /** Brief description of tool purpose */
  description: string;
}

/**
 * Complete tool registry — 25 tools, 407 actions total
 *
 * BaseHandler subclasses (13): extend BaseHandler<Input, Output> for:
 * - Intent batching
 * - Snapshot support
 * - Verbosity filtering
 * - Scope validation
 * - Progress reporting
 * - Error mapping
 *
 * Standalone handlers (12): implement handle() directly for:
 * - Custom state management
 * - Non-standard response flows
 * - Direct error handling
 */
export const TOOL_MANIFEST: ToolEntry[] = [
  // ============================================================================
  // BASEHANDLER SUBCLASSES (13 tools)
  // ============================================================================
  {
    name: 'sheets_core',
    actions: ACTION_COUNTS['sheets_core'] ?? 0,
    handlerFile: 'src/handlers/core.ts',
    schemaFile: 'src/schemas/core.ts',
    handlerType: 'BaseHandler',
    keyServices: [
      'GoogleApiClient',
      'CachedSheetsApi',
      'DriveApiClient',
      'CompositeOperationsService',
    ],
    description: 'Spreadsheet CRUD: create, get, list, update properties, delete, copy, duplicate',
  },
  {
    name: 'sheets_data',
    actions: ACTION_COUNTS['sheets_data'] ?? 0,
    handlerFile: 'src/handlers/data.ts',
    schemaFile: 'src/schemas/data.ts',
    handlerType: 'BaseHandler',
    keyServices: [
      'CachedSheetsApi',
      'ParallelExecutor',
      'BatchCompiler',
      'RequestMerger',
      'CrossSpreadsheetService',
    ],
    description:
      'Cell read/write: read, write, append, batch operations, cross-spreadsheet read/write/query/compare',
  },
  {
    name: 'sheets_format',
    actions: ACTION_COUNTS['sheets_format'] ?? 0,
    handlerFile: 'src/handlers/format.ts',
    schemaFile: 'src/schemas/format.ts',
    handlerType: 'BaseHandler',
    keyServices: ['BatchCompiler', 'CachedSheetsApi', 'ConditionalFormatEngine'],
    description:
      'Cell styling: backgrounds, borders, text format, alignment, number format, conditional rules, rich text',
  },
  {
    name: 'sheets_dimensions',
    actions: ACTION_COUNTS['sheets_dimensions'] ?? 0,
    handlerFile: 'src/handlers/dimensions.ts',
    schemaFile: 'src/schemas/dimensions.ts',
    handlerType: 'BaseHandler',
    keyServices: ['BatchCompiler', 'CachedSheetsApi'],
    description: 'Rows/columns: insert, delete, resize, hide/show, freeze, group, sort, filter',
  },
  {
    name: 'sheets_advanced',
    actions: ACTION_COUNTS['sheets_advanced'] ?? 0,
    handlerFile: 'src/handlers/advanced.ts',
    schemaFile: 'src/schemas/advanced.ts',
    handlerType: 'BaseHandler',
    keyServices: ['BatchCompiler', 'CachedSheetsApi'],
    description:
      'Advanced: named ranges, protected ranges, banding, tables, metadata, smart chips, rich links',
  },
  {
    name: 'sheets_visualize',
    actions: ACTION_COUNTS['sheets_visualize'] ?? 0,
    handlerFile: 'src/handlers/visualize.ts',
    schemaFile: 'src/schemas/visualize.ts',
    handlerType: 'BaseHandler',
    keyServices: ['SamplingServer', 'CachedSheetsApi', 'ChartRecommender'],
    description: 'Charts & pivots: create, update, delete, list, resize, trendlines, pivot tables',
  },
  {
    name: 'sheets_collaborate',
    actions: ACTION_COUNTS['sheets_collaborate'] ?? 0,
    handlerFile: 'src/handlers/collaborate.ts',
    schemaFile: 'src/schemas/collaborate.ts',
    handlerType: 'BaseHandler',
    keyServices: ['DriveApiClient', 'CommentThreadManager', 'VersionManager'],
    description:
      'Sharing & collaboration: share, permissions, comments, versions, approval workflows, labels',
  },
  {
    name: 'sheets_composite',
    actions: ACTION_COUNTS['sheets_composite'] ?? 0,
    handlerFile: 'src/handlers/composite.ts',
    schemaFile: 'src/schemas/composite.ts',
    handlerType: 'BaseHandler',
    keyServices: [
      'CompositeOperationsService',
      'SheetGeneratorService',
      'CsvParser',
      'ExcelImporter',
    ],
    description:
      'Multi-step operations: import CSV/XLSX, deduplicate, smart append, bulk update, export, dashboard generation',
  },
  {
    name: 'sheets_analyze',
    actions: ACTION_COUNTS['sheets_analyze'] ?? 0,
    handlerFile: 'src/handlers/analyze.ts',
    schemaFile: 'src/schemas/analyze.ts',
    handlerType: 'BaseHandler',
    keyServices: [
      'ComprehensiveAnalyzer',
      'SamplingServer',
      'SuggestionEngine',
      'SemanticSearchService',
      'UnderstandingStore',
    ],
    description:
      'AI analysis: comprehensive scan, data profiling, pattern detection, formula suggestions, natural language queries',
  },
  {
    name: 'sheets_fix',
    actions: ACTION_COUNTS['sheets_fix'] ?? 0,
    handlerFile: 'src/handlers/fix.ts',
    schemaFile: 'src/schemas/fix.ts',
    handlerType: 'BaseHandler',
    keyServices: ['CleaningEngine', 'ValidationEngine', 'AnomalyDetector'],
    description:
      'Data cleaning: auto-clean, standardize formats, fill missing values, detect anomalies, suggest cleaning rules',
  },
  {
    name: 'sheets_templates',
    actions: ACTION_COUNTS['sheets_templates'] ?? 0,
    handlerFile: 'src/handlers/templates.ts',
    schemaFile: 'src/schemas/templates.ts',
    handlerType: 'BaseHandler',
    keyServices: ['DriveApiClient', 'TemplateRegistry'],
    description: 'Templates: create reusable templates, apply, list, preview, import built-in templates',
  },
  {
    name: 'sheets_bigquery',
    actions: ACTION_COUNTS['sheets_bigquery'] ?? 0,
    handlerFile: 'src/handlers/bigquery.ts',
    schemaFile: 'src/schemas/bigquery.ts',
    handlerType: 'BaseHandler',
    keyServices: ['BigQueryClient', 'CircuitBreaker', 'ConnectedSheetsManager'],
    description:
      'BigQuery integration: connect, disconnect, query, import/export, scheduled queries, refresh data',
  },
  {
    name: 'sheets_appsscript',
    actions: ACTION_COUNTS['sheets_appsscript'] ?? 0,
    handlerFile: 'src/handlers/appsscript.ts',
    schemaFile: 'src/schemas/appsscript.ts',
    handlerType: 'BaseHandler',
    keyServices: ['AppsScriptClient', 'CircuitBreaker', 'ScriptDeploymentManager'],
    description:
      'Apps Script: create, deploy, run, manage scripts, versions, triggers, metrics, test intelligence',
  },

  // ============================================================================
  // STANDALONE HANDLERS (12 tools)
  // ============================================================================
  {
    name: 'sheets_auth',
    actions: ACTION_COUNTS['sheets_auth'] ?? 0,
    handlerFile: 'src/handlers/auth.ts',
    schemaFile: 'src/schemas/auth.ts',
    handlerType: 'Standalone',
    keyServices: ['EncryptedFileTokenStore', 'OAuthClient', 'SamlProvider'],
    description: 'Authentication: login, logout, status, setup OAuth/SAML flows, manage tokens',
  },
  {
    name: 'sheets_confirm',
    actions: ACTION_COUNTS['sheets_confirm'] ?? 0,
    handlerFile: 'src/handlers/confirm.ts',
    schemaFile: 'src/schemas/confirm.ts',
    handlerType: 'Standalone',
    keyServices: ['ElicitationServer', 'WizardSessions', 'ConfirmationManager'],
    description: 'User confirmations: request approval, wizard workflows, get approval stats',
  },
  {
    name: 'sheets_dependencies',
    actions: ACTION_COUNTS['sheets_dependencies'] ?? 0,
    handlerFile: 'src/handlers/dependencies.ts',
    schemaFile: 'src/schemas/dependencies.ts',
    handlerType: 'Standalone',
    keyServices: ['ImpactAnalyzer', 'ScenarioEngine', 'DependencyGraph'],
    description:
      'Dependency analysis: build graph, analyze impact, detect cycles, model scenarios, export DOT format',
  },
  {
    name: 'sheets_quality',
    actions: ACTION_COUNTS['sheets_quality'] ?? 0,
    handlerFile: 'src/handlers/quality.ts',
    schemaFile: 'src/schemas/quality.ts',
    handlerType: 'Standalone',
    keyServices: ['ValidationEngine', 'ConflictDetector', 'DataProfiler'],
    description:
      'Data quality: validate ranges, detect conflicts, resolve conflicts, analyze data impact',
  },
  {
    name: 'sheets_history',
    actions: ACTION_COUNTS['sheets_history'] ?? 0,
    handlerFile: 'src/handlers/history.ts',
    schemaFile: 'src/schemas/history.ts',
    handlerType: 'Standalone',
    keyServices: ['HistoryService', 'SnapshotService', 'TimeTravelService', 'RevisionManager'],
    description:
      'Version history: list, undo, redo, revert to revision, time-travel, diff revisions, restore cells',
  },
  {
    name: 'sheets_session',
    actions: ACTION_COUNTS['sheets_session'] ?? 0,
    handlerFile: 'src/handlers/session.ts',
    schemaFile: 'src/schemas/session.ts',
    handlerType: 'Standalone',
    keyServices: ['SessionContextManager', 'PreferencesStore', 'OperationRecorder'],
    description:
      'Session context: get/set active spreadsheet, record operations, preferences, alerts, checkpoints',
  },
  {
    name: 'sheets_transaction',
    actions: ACTION_COUNTS['sheets_transaction'] ?? 0,
    handlerFile: 'src/handlers/transaction.ts',
    schemaFile: 'src/schemas/transaction.ts',
    handlerType: 'Standalone',
    keyServices: ['TransactionManager', 'WalManager', 'TransactionLogger'],
    description:
      'Atomic transactions: begin, queue operations, commit, rollback, status, list active transactions',
  },
  {
    name: 'sheets_federation',
    actions: ACTION_COUNTS['sheets_federation'] ?? 0,
    handlerFile: 'src/handlers/federation.ts',
    schemaFile: 'src/schemas/federation.ts',
    handlerType: 'Standalone',
    keyServices: ['FederatedMcpClient', 'ServerRegistry', 'RemoteCallExecutor'],
    description: 'MCP federation: call remote MCP servers, list servers, get tools, validate connections',
  },
  {
    name: 'sheets_webhook',
    actions: ACTION_COUNTS['sheets_webhook'] ?? 0,
    handlerFile: 'src/handlers/webhooks.ts',
    schemaFile: 'src/schemas/webhook.ts',
    handlerType: 'Standalone',
    keyServices: ['WebhookManager', 'EventStore', 'RedisBackend'],
    description:
      'Webhooks: register, unregister, test, list, watch changes, workspace subscriptions, event delivery',
  },
  {
    name: 'sheets_agent',
    actions: ACTION_COUNTS['sheets_agent'] ?? 0,
    handlerFile: 'src/handlers/agent.ts',
    schemaFile: 'src/schemas/agent.ts',
    handlerType: 'Standalone',
    keyServices: ['AgentEngine', 'PlanCompiler', 'PlanExecutor', 'CheckpointManager'],
    description:
      'Autonomous agent: plan operations, execute steps, rollback, resume, observe progress, list plans',
  },
  {
    name: 'sheets_compute',
    actions: ACTION_COUNTS['sheets_compute'] ?? 0,
    handlerFile: 'src/handlers/compute.ts',
    schemaFile: 'src/schemas/compute.ts',
    handlerType: 'Standalone',
    keyServices: [
      'ComputeEngine',
      'FormulaEvaluator',
      'DuckDBEngine',
      'StatisticalAnalyzer',
      'RegressionEngine',
    ],
    description:
      'Server-side compute: statistics, regression, forecasting, matrix operations, pivot compute, SQL queries',
  },
  {
    name: 'sheets_connectors',
    actions: ACTION_COUNTS['sheets_connectors'] ?? 0,
    handlerFile: 'src/handlers/connectors.ts',
    schemaFile: 'src/schemas/connectors.ts',
    handlerType: 'Standalone',
    keyServices: ['ConnectorManager', 'FinHubClient', 'FredClient', 'PolygonClient'],
    description:
      'External data: list/configure/query connectors (Finnhub, FRED, Alpha Vantage, Polygon, FMP), subscribe',
  },
];

/**
 * Computed totals from ACTION_COUNTS
 */
export const MANIFEST_SUMMARY = {
  /** Total number of tools */
  toolCount: TOOL_COUNT,
  /** Total number of actions */
  actionCount: ACTION_COUNT,
  /** Number of BaseHandler tools */
  baseHandlerCount: TOOL_MANIFEST.filter((t) => t.handlerType === 'BaseHandler').length,
  /** Number of Standalone tools */
  standaloneCount: TOOL_MANIFEST.filter((t) => t.handlerType === 'Standalone').length,
  /** Sum of all actions across all tools */
  totalActions: TOOL_MANIFEST.reduce((sum, tool) => sum + tool.actions, 0),
} as const;

/**
 * Quick lookup by tool name
 */
export const TOOL_MANIFEST_BY_NAME = new Map(TOOL_MANIFEST.map((t) => [t.name, t]));

/**
 * Handler type groupings for discovery
 */
export const TOOLS_BY_HANDLER_TYPE = {
  BaseHandler: TOOL_MANIFEST.filter((t) => t.handlerType === 'BaseHandler'),
  Standalone: TOOL_MANIFEST.filter((t) => t.handlerType === 'Standalone'),
} as const;

/**
 * Service dependency graph (which tools use which services)
 */
export function getToolsByService(serviceName: string): ToolEntry[] {
  return TOOL_MANIFEST.filter((tool) => tool.keyServices.includes(serviceName));
}

/**
 * Validate manifest consistency
 */
export function validateManifest(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check tool count
  if (TOOL_MANIFEST.length !== TOOL_COUNT) {
    errors.push(`Tool count mismatch: manifest has ${TOOL_MANIFEST.length}, ACTION_COUNTS has ${TOOL_COUNT}`);
  }

  // Check action counts
  for (const tool of TOOL_MANIFEST) {
    if (ACTION_COUNTS[tool.name] !== tool.actions) {
      errors.push(
        `Action count mismatch for ${tool.name}: manifest has ${tool.actions}, ACTION_COUNTS has ${ACTION_COUNTS[tool.name]}`
      );
    }
  }

  // Check totals
  const manifestTotal = TOOL_MANIFEST.reduce((sum, t) => sum + t.actions, 0);
  if (manifestTotal !== ACTION_COUNT) {
    errors.push(`Total action count mismatch: manifest has ${manifestTotal}, ACTION_COUNTS has ${ACTION_COUNT}`);
  }

  // Check handler type distribution
  const baseHandlerTools = TOOL_MANIFEST.filter((t) => t.handlerType === 'BaseHandler');
  const standaloneTools = TOOL_MANIFEST.filter((t) => t.handlerType === 'Standalone');

  if (baseHandlerTools.length !== 13) {
    errors.push(`BaseHandler count mismatch: expected 13, got ${baseHandlerTools.length}`);
  }

  if (standaloneTools.length !== 12) {
    errors.push(`Standalone count mismatch: expected 12, got ${standaloneTools.length}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
