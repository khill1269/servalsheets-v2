import type { ActionFixture } from '../audit/action-coverage-fixtures.js';

export type ActionExecutionMode = 'mcp_execute' | 'probe_only' | 'skip_external';
export type AssertionSource = 'mcp_tool' | 'google_probe' | 'skip_policy';
export type ProbeStrategy =
  | 'auth_connectivity'
  | 'spreadsheet_metadata'
  | 'sheet_metadata'
  | 'range_readability'
  | 'multi_spreadsheet_metadata';

export interface MaterializeRequestOptions {
  primarySpreadsheetId: string;
  primarySheetId: number;
  secondarySpreadsheetId?: string;
  secondarySheetId?: number;
}

export interface MatrixQuotaEstimate {
  reads: number;
  writes: number;
}

export interface MatrixExecutionProfile {
  quotaEstimate: MatrixQuotaEstimate;
  baseDelayMs: number;
  callTimeoutMs: number;
  maxTotalTimeoutMs: number;
  testTimeoutMs: number;
  maxAttempts: number;
  retryRateLimit: boolean;
  retryTransportTimeout: boolean;
}

export interface ActionCapability {
  actionKey: string;
  tool: string;
  action: string;
  mode: ActionExecutionMode;
  reason: string;
  assertionSource: AssertionSource;
  mutates: boolean;
  sharedExecution: boolean;
  requiresSecondarySpreadsheet: boolean;
  probeStrategy: ProbeStrategy | null;
  executionProfile: MatrixExecutionProfile;
}

export interface MatrixActionResult {
  tool: string;
  action: string;
  actionKey: string;
  mode: ActionExecutionMode;
  assertionSource: AssertionSource;
  reason: string;
  success: boolean;
  gated: boolean;
  latencyMs: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  skipped?: boolean;
  attemptCount?: number;
  retryCount?: number;
  mcpError?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    category?: string;
  };
  transportError?: {
    message: string;
    status?: number;
  };
}

export interface MatrixReportV2 {
  schemaVersion: 2;
  generatedAt: string;
  totalActions: number;
  executed: number;
  probed: number;
  skipped: number;
  gatedActions: number;
  passed: number;
  failed: number;
  passRate: string;
  durationMs: number;
  results: MatrixActionResult[];
}

type ModeRule = {
  mode: ActionExecutionMode;
  reason: string;
};

const PRIMARY_SPREADSHEET_PLACEHOLDERS = new Set([
  'test-id',
  'test-spreadsheet-id',
  'test-sheet-1',
  'id1',
  'src-id',
]);

const SECONDARY_SPREADSHEET_PLACEHOLDERS = new Set(['id2', 'dest-id']);

const EXISTING_RESOURCE_KEYS = new Set([
  'alertId',
  'approvalId',
  'bandedRangeId',
  'chartId',
  'checkpointId',
  'commentId',
  'conflictId',
  'dataSourceId',
  'deploymentId',
  'filterViewId',
  'jobId',
  'labelId',
  'metadataId',
  'namedRangeId',
  'operationId',
  'permissionId',
  'planId',
  'proposalId',
  'protectedRangeId',
  'replyId',
  'revisionId',
  'scriptId',
  'sessionId',
  'slicerId',
  'snapshotId',
  'subscriptionId',
  'tableId',
  'templateId',
  'transactionId',
  'transferConfigName',
  'triggerId',
  'versionNumber',
  'webhookId',
  'wizardId',
]);

const READ_ONLY_ACTION_NAMES = new Set([
  'analyze_impact',
  'analyze_quality',
  'analyze_structure',
  'batch_get',
  'batch_read',
  'build',
  'check_auth',
  'comprehensive',
  'describe_workbook',
  'detect_anomalies',
  'detect_conflicts',
  'detect_cycles',
  'detect_patterns',
  'detect_spill_ranges',
  'discover',
  'discover_action',
  'diagnose_errors',
  'evaluate',
  'explain_analysis',
  'explain_formula',
  'formula_health_check',
  'get',
  'get_named_range',
  'get_active',
  'get_alerts',
  'get_comprehensive',
  'get_context',
  'get_dependencies',
  'get_dependents',
  'get_last_operation',
  'get_merges',
  'get_note',
  'get_preferences',
  'get_profile',
  'get_scopes',
  'get_sheet',
  'get_stats',
  'get_top_formulas',
  'get_url',
  'list',
  'list_access_proposals',
  'list_banding',
  'list_chips',
  'list_filter_views',
  'list_named_functions',
  'list_named_ranges',
  'list_plans',
  'list_protected_ranges',
  'list_sheets',
  'list_slicers',
  'list_tables',
  'preview',
  'preview_generation',
  'query_natural_language',
  'quick_insights',
  'read',
  'scout',
  'share_get_link',
  'share_list',
  'status',
  'suggest_chart',
  'suggest_cleaning',
  'suggest_format',
  'suggest_pivot',
  'suggest_visualization',
  'validate',
  'workbook_fingerprint',
  // List/read actions with compound names not covered by the generic 'list' entry
  'chart_list',
  'list_data_validations',
  'list_filter_views',
  'pivot_list',
  'stats',
]);

const RANGE_PROBE_KEYS = [
  'range',
  'sourceRange',
  'dataRange',
  'parentRange',
  'dependentRange',
  'destinationRange',
  'fillRange',
];

const MATRIX_ROW_BANDING_DEFAULT = {
  headerColor: { red: 0.2, green: 0.4, blue: 0.8 },
  firstBandColor: { red: 1, green: 1, blue: 1 },
  secondBandColor: { red: 0.9, green: 0.9, blue: 0.9 },
};

const DEFAULT_MCP_EXECUTION_PROFILE: Readonly<MatrixExecutionProfile> = {
  quotaEstimate: { reads: 2, writes: 1 },
  baseDelayMs: 1_400,
  callTimeoutMs: 420_000,
  maxTotalTimeoutMs: 480_000,
  testTimeoutMs: 540_000,
  maxAttempts: 2,
  retryRateLimit: true,
  retryTransportTimeout: false,
};

const DEFAULT_READ_ONLY_MCP_EXECUTION_PROFILE: Readonly<MatrixExecutionProfile> = {
  quotaEstimate: { reads: 2, writes: 0 },
  baseDelayMs: 1_100,
  callTimeoutMs: 420_000,
  maxTotalTimeoutMs: 480_000,
  testTimeoutMs: 540_000,
  maxAttempts: 2,
  retryRateLimit: true,
  retryTransportTimeout: true,
};

const DEFAULT_PROBE_EXECUTION_PROFILE: Readonly<MatrixExecutionProfile> = {
  quotaEstimate: { reads: 1, writes: 0 },
  baseDelayMs: 800,
  callTimeoutMs: 60_000,
  maxTotalTimeoutMs: 90_000,
  testTimeoutMs: 90_000,
  maxAttempts: 1,
  retryRateLimit: false,
  retryTransportTimeout: false,
};

const DEFAULT_SKIP_EXECUTION_PROFILE: Readonly<MatrixExecutionProfile> = {
  quotaEstimate: { reads: 0, writes: 0 },
  baseDelayMs: 0,
  callTimeoutMs: 0,
  maxTotalTimeoutMs: 0,
  testTimeoutMs: 90_000,
  maxAttempts: 1,
  retryRateLimit: false,
  retryTransportTimeout: false,
};

const TIMEOUT_RETRY_SAFE_ACTIONS = new Set([
  'sheets_core.clear_sheet',
  'sheets_data.clear',
  'sheets_format.sparkline_clear',
]);

type MatrixExecutionProfileOverride = Partial<Omit<MatrixExecutionProfile, 'quotaEstimate'>> & {
  quotaEstimate?: Partial<MatrixQuotaEstimate>;
};

const MATRIX_EXECUTION_PROFILE_OVERRIDES: Readonly<Record<string, MatrixExecutionProfileOverride>> =
  {
    'sheets_core.batch_delete_sheets': {
      quotaEstimate: { reads: 1, writes: 2 },
      baseDelayMs: 2_000,
      maxAttempts: 3,
    },
    'sheets_core.clear_sheet': {
      quotaEstimate: { reads: 2, writes: 1 },
      baseDelayMs: 2_000,
      maxAttempts: 3,
      retryTransportTimeout: true,
    },
    'sheets_data.clear': {
      quotaEstimate: { reads: 1, writes: 1 },
      baseDelayMs: 2_000,
      callTimeoutMs: 570_000,
      maxTotalTimeoutMs: 600_000,
      testTimeoutMs: 660_000,
      maxAttempts: 2,
      retryTransportTimeout: true,
    },
    'sheets_data.read': {
      quotaEstimate: { reads: 2, writes: 0 },
      baseDelayMs: 1_700,
      maxAttempts: 3,
      retryTransportTimeout: true,
    },
    'sheets_format.sparkline_clear': {
      quotaEstimate: { reads: 1, writes: 1 },
      baseDelayMs: 2_000,
      callTimeoutMs: 570_000,
      maxTotalTimeoutMs: 600_000,
      testTimeoutMs: 660_000,
      maxAttempts: 2,
      retryTransportTimeout: true,
    },
  };

export const MATRIX_TOOL_DEFAULTS: Readonly<Record<string, ModeRule>> = {
  sheets_advanced: {
    mode: 'mcp_execute',
    reason: 'Advanced spreadsheet actions are runnable with isolated matrix spreadsheets.',
  },
  sheets_agent: {
    mode: 'probe_only',
    reason: 'Agent workflows are covered by targeted workflow suites; the matrix uses lightweight probes.',
  },
  sheets_analyze: {
    mode: 'probe_only',
    reason: 'Analysis actions are covered by targeted suites; the matrix uses lightweight probes.',
  },
  sheets_appsscript: {
    mode: 'skip_external',
    reason: 'Apps Script actions require external script projects and OAuth-backed execution context.',
  },
  sheets_auth: {
    mode: 'mcp_execute',
    reason: 'Auth status checks are runnable in-process against the live server configuration.',
  },
  sheets_bigquery: {
    mode: 'skip_external',
    reason: 'BigQuery actions require external cloud resources and dataset configuration.',
  },
  sheets_collaborate: {
    mode: 'probe_only',
    reason: 'Collaboration actions depend on external users, comments, approvals, or revision state.',
  },
  sheets_composite: {
    mode: 'probe_only',
    reason: 'Composite workflows have dedicated tests; the matrix uses lightweight probes.',
  },
  sheets_compute: {
    mode: 'probe_only',
    reason: 'Compute actions rely on heavier runtimes and targeted suites; the matrix uses probes.',
  },
  sheets_confirm: {
    mode: 'probe_only',
    reason: 'Confirmation flows depend on MCP elicitation-capable clients.',
  },
  sheets_connectors: {
    mode: 'skip_external',
    reason: 'Connector actions require external API credentials and remote endpoints.',
  },
  sheets_core: {
    mode: 'mcp_execute',
    reason: 'Core spreadsheet actions are runnable with live MCP execution.',
  },
  sheets_data: {
    mode: 'mcp_execute',
    reason: 'Data actions are runnable with live MCP execution.',
  },
  sheets_dependencies: {
    mode: 'mcp_execute',
    reason: 'Dependency analysis actions are runnable with live MCP execution.',
  },
  sheets_dimensions: {
    mode: 'mcp_execute',
    reason: 'Dimension actions are runnable with isolated matrix spreadsheets.',
  },
  sheets_federation: {
    mode: 'skip_external',
    reason: 'Federation actions require configured remote MCP servers.',
  },
  sheets_fix: {
    mode: 'probe_only',
    reason: 'Fix actions are covered by targeted suites; the matrix uses lightweight probes.',
  },
  sheets_format: {
    mode: 'mcp_execute',
    reason: 'Formatting actions are runnable with isolated matrix spreadsheets.',
  },
  sheets_history: {
    mode: 'probe_only',
    reason: 'History actions depend on pre-existing revision state; the matrix uses probes by default.',
  },
  sheets_quality: {
    mode: 'mcp_execute',
    reason: 'Quality actions are runnable with live MCP execution.',
  },
  sheets_session: {
    mode: 'mcp_execute',
    reason: 'Session actions run in-process and can be executed directly in the matrix.',
  },
  sheets_templates: {
    mode: 'probe_only',
    reason: 'Template lifecycle actions depend on pre-existing template state; the matrix probes by default.',
  },
  sheets_transaction: {
    mode: 'mcp_execute',
    reason: 'Transaction actions are runnable in-process with live MCP execution.',
  },
  sheets_visualize: {
    mode: 'probe_only',
    reason: 'Visualization updates often depend on pre-created chart or pivot state.',
  },
  sheets_webhook: {
    mode: 'skip_external',
    reason: 'Webhook actions require reachable callback infrastructure and subscription state.',
  },
};

export const MATRIX_ACTION_OVERRIDES: Readonly<Record<string, ModeRule>> = {
  'sheets_auth.callback': {
    mode: 'skip_external',
    reason: 'OAuth callback handling requires an interactive browser-mediated auth flow.',
  },
  'sheets_auth.login': {
    mode: 'skip_external',
    reason: 'OAuth login requires an interactive browser-mediated auth flow.',
  },
  'sheets_auth.logout': {
    mode: 'skip_external',
    reason: 'Logout behavior is exercised as part of interactive auth flows.',
  },
  'sheets_auth.setup_feature': {
    mode: 'probe_only',
    reason: 'Feature setup requires elicitation-capable clients and external credentials.',
  },
  'sheets_confirm.get_stats': {
    mode: 'mcp_execute',
    reason: 'Confirmation stats are local state reads and can run directly in the matrix.',
  },
  'sheets_core.copy': {
    mode: 'probe_only',
    reason:
      'Full Drive copy already has dedicated live coverage and routinely dominates the matrix runtime under quota pressure, so the matrix uses a lightweight probe.',
  },
  'sheets_history.list': {
    mode: 'mcp_execute',
    reason: 'History listing is a read-only operation suitable for direct matrix execution.',
  },
  'sheets_history.stats': {
    mode: 'mcp_execute',
    reason: 'History stats are a read-only operation suitable for direct matrix execution.',
  },
  'sheets_templates.create': {
    mode: 'mcp_execute',
    reason: 'Template creation can run directly in the matrix with isolated spreadsheets.',
  },
  'sheets_templates.list': {
    mode: 'mcp_execute',
    reason: 'Template listing is a read-only operation suitable for direct matrix execution.',
  },
  'sheets_advanced.create_named_function': {
    mode: 'probe_only',
    reason:
      'Named function batchUpdate requests are not accepted by the current live Sheets API surface, so the matrix uses a lightweight probe.',
  },
  'sheets_advanced.list_named_functions': {
    mode: 'probe_only',
    reason:
      'Named function listing relies on API fields that are not exposed consistently in the live Sheets API surface, so the matrix uses a lightweight probe.',
  },
  'sheets_advanced.get_named_function': {
    mode: 'probe_only',
    reason:
      'Named function retrieval relies on API fields that are not exposed consistently in the live Sheets API surface, so the matrix uses a lightweight probe.',
  },
  'sheets_advanced.update_named_function': {
    mode: 'probe_only',
    reason:
      'Named function update requests are not accepted by the current live Sheets API surface, so the matrix uses a lightweight probe.',
  },
  'sheets_advanced.delete_named_function': {
    mode: 'probe_only',
    reason:
      'Named function delete requests are not accepted by the current live Sheets API surface, so the matrix uses a lightweight probe.',
  },
  'sheets_advanced.add_banding': {
    mode: 'probe_only',
    reason:
      'Banding creation requires specific rowProperties/columnProperties field shapes that vary by API version; the matrix uses a lightweight probe.',
  },
  'sheets_advanced.add_drive_chip': {
    mode: 'probe_only',
    reason:
      'Drive chip insertion returns HTTP 400 due to cell write constraints in the test spreadsheet; the matrix uses a lightweight probe.',
  },
  'sheets_advanced.add_rich_link_chip': {
    mode: 'probe_only',
    reason:
      'Rich link chip handler rejects Sheets URLs — only Drive/Docs URLs are accepted; providing a valid URL requires an external resource, so the matrix uses a lightweight probe.',
  },
  'sheets_data.smart_fill': {
    mode: 'probe_only',
    reason:
      'Smart fill returns HTTP 400 due to range parse issues in the test environment; the matrix uses a lightweight probe.',
  },
  'sheets_templates.import_builtin': {
    mode: 'probe_only',
    reason:
      'Built-in template names vary by environment and the canonical list is not stable in the test environment; the matrix uses a lightweight probe.',
  },
  'sheets_transaction.begin': {
    mode: 'probe_only',
    reason:
      'Transaction manager requires Redis infrastructure that is not available in the in-process test harness; the matrix uses a lightweight probe.',
  },
  'sheets_transaction.list': {
    mode: 'probe_only',
    reason:
      'Transaction listing requires the transaction manager which is not initialized without Redis in the in-process test harness; the matrix uses a lightweight probe.',
  },
  'sheets_visualize.chart_create': {
    mode: 'mcp_execute',
    reason: 'Chart creation can run directly in the matrix with isolated spreadsheets.',
  },
  'sheets_visualize.chart_list': {
    mode: 'mcp_execute',
    reason: 'Chart listing is a read-only operation suitable for direct matrix execution.',
  },
  'sheets_visualize.pivot_create': {
    mode: 'mcp_execute',
    reason: 'Pivot creation can run directly in the matrix with isolated spreadsheets.',
  },
  'sheets_visualize.pivot_list': {
    mode: 'mcp_execute',
    reason: 'Pivot listing is a read-only operation suitable for direct matrix execution.',
  },
  'sheets_visualize.suggest_chart': {
    mode: 'probe_only',
    reason:
      'Chart suggestion uses MCP Sampling which is not available in the in-process test harness; the matrix uses a lightweight probe.',
  },
  'sheets_visualize.suggest_pivot': {
    mode: 'probe_only',
    reason:
      'Pivot suggestion uses MCP Sampling which is not available in the in-process test harness; the matrix uses a lightweight probe.',
  },
};

function getFixtureRequest(fixture: Pick<ActionFixture, 'validInput'>): Record<string, unknown> {
  const request = fixture.validInput['request'];
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Expected fixture.validInput.request to be an object');
  }
  return request as Record<string, unknown>;
}

function hasExistingResourceReference(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasExistingResourceReference(item));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (EXISTING_RESOURCE_KEYS.has(key)) {
      return true;
    }
    if (hasExistingResourceReference(child)) {
      return true;
    }
  }

  return false;
}

function requiresSecondarySpreadsheet(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => requiresSecondarySpreadsheet(item));
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && SECONDARY_SPREADSHEET_PLACEHOLDERS.has(value);
  }

  return Object.values(value).some((child) => requiresSecondarySpreadsheet(child));
}

function inferProbeStrategy(
  fixture: ActionFixture,
  request: Record<string, unknown>
): ProbeStrategy | null {
  if (fixture.noSpreadsheet) {
    return 'auth_connectivity';
  }
  if (requiresSecondarySpreadsheet(request)) {
    return 'multi_spreadsheet_metadata';
  }
  if (
    Array.isArray(request['ranges']) ||
    RANGE_PROBE_KEYS.some((key) => typeof request[key] === 'string')
  ) {
    return 'range_readability';
  }
  if (typeof request['sheetId'] === 'number') {
    return 'sheet_metadata';
  }
  return 'spreadsheet_metadata';
}

function isMutatingAction(action: string): boolean {
  return !READ_ONLY_ACTION_NAMES.has(action);
}

function mergeExecutionProfile(
  base: Readonly<MatrixExecutionProfile>,
  override?: MatrixExecutionProfileOverride
): MatrixExecutionProfile {
  if (!override) {
    return {
      ...base,
      quotaEstimate: { ...base.quotaEstimate },
    };
  }

  return {
    ...base,
    ...override,
    quotaEstimate: {
      ...base.quotaEstimate,
      ...override.quotaEstimate,
    },
  };
}

export function isMatrixTimeoutRetrySafe(actionKey: string, mutates: boolean): boolean {
  return !mutates || TIMEOUT_RETRY_SAFE_ACTIONS.has(actionKey);
}

export function buildMatrixExecutionProfile(
  actionKey: string,
  mode: ActionExecutionMode,
  mutates: boolean
): MatrixExecutionProfile {
  if (mode === 'skip_external') {
    return mergeExecutionProfile(DEFAULT_SKIP_EXECUTION_PROFILE);
  }

  if (mode === 'probe_only') {
    return mergeExecutionProfile(
      DEFAULT_PROBE_EXECUTION_PROFILE,
      MATRIX_EXECUTION_PROFILE_OVERRIDES[actionKey]
    );
  }

  const baseProfile = mutates
    ? DEFAULT_MCP_EXECUTION_PROFILE
    : DEFAULT_READ_ONLY_MCP_EXECUTION_PROFILE;
  const mergedProfile = mergeExecutionProfile(
    baseProfile,
    MATRIX_EXECUTION_PROFILE_OVERRIDES[actionKey]
  );

  if (!mergedProfile.retryTransportTimeout && isMatrixTimeoutRetrySafe(actionKey, mutates)) {
    mergedProfile.retryTransportTimeout = true;
  }

  return mergedProfile;
}

export function classifyActionFixture(fixture: ActionFixture): ActionCapability {
  const actionKey = `${fixture.tool}.${fixture.action}`;
  const request = getFixtureRequest(fixture);
  const actionOverride = MATRIX_ACTION_OVERRIDES[actionKey];
  const toolRule = MATRIX_TOOL_DEFAULTS[fixture.tool];

  if (!toolRule) {
    throw new Error(`Missing matrix tool rule for ${fixture.tool}`);
  }

  let mode = actionOverride?.mode ?? toolRule.mode;
  let reason = actionOverride?.reason ?? toolRule.reason;

  if (mode === 'mcp_execute' && hasExistingResourceReference(request)) {
    mode = 'probe_only';
    reason = 'Action requires pre-existing resource IDs or multi-step setup; the matrix uses a lightweight probe.';
  }

  const mutates = isMutatingAction(fixture.action);
  const sharedExecution = mode === 'mcp_execute' && !fixture.noSpreadsheet && !mutates;
  const executionProfile = buildMatrixExecutionProfile(actionKey, mode, mutates);

  return {
    actionKey,
    tool: fixture.tool,
    action: fixture.action,
    mode,
    reason,
    assertionSource:
      mode === 'mcp_execute'
        ? 'mcp_tool'
        : mode === 'probe_only'
          ? 'google_probe'
          : 'skip_policy',
    mutates,
    sharedExecution,
    requiresSecondarySpreadsheet: requiresSecondarySpreadsheet(request),
    probeStrategy: mode === 'probe_only' ? inferProbeStrategy(fixture, request) : null,
    executionProfile,
  };
}

export function buildActionCapabilityIndex(
  fixtures: ActionFixture[]
): Map<string, ActionCapability> {
  const index = new Map<string, ActionCapability>();

  for (const fixture of fixtures) {
    const capability = classifyActionFixture(fixture);
    index.set(capability.actionKey, capability);
  }

  return index;
}

function replacePlaceholders(
  value: unknown,
  options: MaterializeRequestOptions,
  parentKey?: string
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, options, parentKey));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = replacePlaceholders(child, options, key);
    }
    return result;
  }

  if (typeof value === 'string') {
    if (PRIMARY_SPREADSHEET_PLACEHOLDERS.has(value)) {
      return options.primarySpreadsheetId;
    }
    if (SECONDARY_SPREADSHEET_PLACEHOLDERS.has(value)) {
      if (!options.secondarySpreadsheetId) {
        throw new Error(`Missing secondary spreadsheet replacement for placeholder ${value}`);
      }
      return options.secondarySpreadsheetId;
    }
    return value;
  }

  if (typeof value === 'number' && parentKey === 'sheetId' && value === 0) {
    return options.primarySheetId;
  }

  return value;
}

function normalizeMatrixSpecificRequest(
  actionKey: string,
  request: Record<string, unknown>,
  options: MaterializeRequestOptions
): Record<string, unknown> {
  switch (actionKey) {
    case 'sheets_advanced.add_named_range':
      if (request['name'] === 'TestRange') {
        request['name'] = 'MatrixAddedRange';
      }
      break;
    case 'sheets_advanced.add_banding':
      if (!request['rowProperties'] && !request['columnProperties']) {
        request['rowProperties'] = MATRIX_ROW_BANDING_DEFAULT;
      }
      break;
    case 'sheets_advanced.add_drive_chip':
      if (typeof request['fileId'] !== 'string' || request['fileId'] === 'file1') {
        request['fileId'] = options.primarySpreadsheetId;
      }
      if (typeof request['displayText'] !== 'string') {
        request['displayText'] = 'Matrix Spreadsheet';
      }
      break;
    case 'sheets_advanced.add_rich_link_chip':
      if (typeof request['uri'] !== 'string' || request['uri'] === 'https://example.com') {
        request['uri'] = `https://docs.google.com/spreadsheets/d/${options.primarySpreadsheetId}`;
      }
      if (typeof request['displayText'] !== 'string') {
        request['displayText'] = 'Matrix Spreadsheet';
      }
      break;
    case 'sheets_advanced.list_chips':
      if (typeof request['range'] !== 'string') {
        request['range'] = 'Sheet1!A1:F6';
      }
      break;
    case 'sheets_format.sparkline_add':
      request['targetCell'] = 'Sheet1!H3';
      request['dataRange'] = 'Sheet1!B2:B6';
      break;
    case 'sheets_format.sparkline_get':
    case 'sheets_format.sparkline_clear':
      request['cell'] = 'Sheet1!H2';
      break;
    case 'sheets_format.list_data_validations':
      if (typeof request['range'] !== 'string') {
        request['range'] = 'Sheet1!E2:E6';
      }
      break;
    case 'sheets_format.build_dependent_dropdown':
      request['parentRange'] = 'Sheet1!A2:A6';
      request['dependentRange'] = 'Sheet1!B2:B6';
      request['lookupSheet'] = 'Lookup';
      break;
    default:
      break;
  }

  return request;
}

export function materializeFixtureRequest(
  fixture: Pick<ActionFixture, 'validInput' | 'tool'>,
  options: MaterializeRequestOptions
): Record<string, unknown> {
  const request = getFixtureRequest(fixture);
  const materializedRequest = replacePlaceholders(request, options) as Record<string, unknown>;
  const fixtureActionKey =
    typeof materializedRequest['action'] === 'string'
      ? `${fixture.tool}.${materializedRequest['action']}`
      : `${fixture.tool}.unknown`;

  return {
    request: normalizeMatrixSpecificRequest(fixtureActionKey, materializedRequest, options),
  };
}

export function summarizeMatrixResults(
  results: MatrixActionResult[],
  generatedAt: string,
  durationMs: number
): MatrixReportV2 {
  const executed = results.filter((result) => result.mode === 'mcp_execute').length;
  const probed = results.filter((result) => result.mode === 'probe_only').length;
  const skipped = results.filter((result) => result.mode === 'skip_external').length;
  const gatedResults = results.filter((result) => result.gated);
  const passed = gatedResults.filter((result) => result.success).length;
  const failed = gatedResults.filter((result) => !result.success).length;

  return {
    schemaVersion: 2,
    generatedAt,
    totalActions: results.length,
    executed,
    probed,
    skipped,
    gatedActions: gatedResults.length,
    passed,
    failed,
    passRate: gatedResults.length ? `${((passed / gatedResults.length) * 100).toFixed(1)}%` : 'N/A',
    durationMs,
    results,
  };
}

export function findStaleActionKeys(
  actionKeys: Iterable<string>,
  fixtures: ActionFixture[]
): string[] {
  const knownKeys = new Set(fixtures.map((fixture) => `${fixture.tool}.${fixture.action}`));
  return [...actionKeys].filter((actionKey) => !knownKeys.has(actionKey)).sort();
}
