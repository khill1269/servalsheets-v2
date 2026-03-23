/**
 * ServalSheets - SEP-1036 Elicitation Support
 *
 * Enables server-to-client user input requests for interactive operations.
 * Supports two modes:
 * - Form Mode: Collect structured data via UI forms
 * - URL Mode: Redirect user to URLs (OAuth, external auth)
 *
 * @module mcp/elicitation
 * @see https://spec.modelcontextprotocol.io/specification/2025-11-25/client/elicitation/
 */

import type { ClientCapabilities, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { ServiceError } from '../core/errors.js';
import { recordElicitationRequest } from '../observability/metrics.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Elicitation capability check result
 */
export interface ElicitationSupport {
  /** Whether any elicitation is supported */
  supported: boolean;
  /** Whether form-based elicitation is supported */
  form: boolean;
  /** Whether URL-based elicitation is supported */
  url: boolean;
}

/**
 * Primitive schema types for form fields
 */
export interface StringSchema {
  type: 'string';
  title?: string;
  description?: string;
  default?: string;
  minLength?: number;
  maxLength?: number;
  format?: 'email' | 'uri' | 'date' | 'date-time';
}

export interface NumberSchema {
  type: 'number' | 'integer';
  title?: string;
  description?: string;
  default?: number;
  minimum?: number;
  maximum?: number;
}

export interface BooleanSchema {
  type: 'boolean';
  title?: string;
  description?: string;
  default?: boolean;
}

export interface EnumSchema {
  type: 'string';
  title?: string;
  description?: string;
  default?: string;
  enum?: string[];
  oneOf?: Array<{ const: string; title: string }>;
}

/**
 * Multi-select enum schema — `type: 'array'` with string enum items.
 * Matches the SDK's `MultiSelectEnumSchemaSchema` (MCP 2025-11-25 spec).
 * Allows clients to render a checkbox group or multi-select list.
 */
export interface MultiSelectEnumSchema {
  type: 'array';
  title?: string;
  description?: string;
  minItems?: number;
  maxItems?: number;
  default?: string[];
  items: { type: 'string'; enum: string[] } | { anyOf: Array<{ const: string; title: string }> };
}

export type PrimitiveSchema = StringSchema | NumberSchema | BooleanSchema | EnumSchema;
// MultiSelectEnumSchema (type:'array') removed — violates MCP 2025-11-25 spec which requires string/number/boolean/enum only

/**
 * Form elicitation request parameters
 */
export interface FormElicitParams {
  mode?: 'form';
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, PrimitiveSchema>;
    required?: string[];
  };
}

/**
 * URL elicitation request parameters
 */
export interface URLElicitParams {
  mode: 'url';
  message: string;
  elicitationId: string;
  url: string;
}

/**
 * Server interface for elicitation (subset of Server methods we need)
 */
export interface ElicitationServer {
  getClientCapabilities(): ClientCapabilities | undefined;
  elicitInput(params: FormElicitParams | URLElicitParams): Promise<ElicitResult>;
  createElicitationCompletionNotifier?(elicitationId: string): () => Promise<void>;
}

// ============================================================================
// Capability Detection
// ============================================================================

/**
 * Check if the client supports elicitation and its modes
 */
export function checkElicitationSupport(
  clientCapabilities: ClientCapabilities | undefined
): ElicitationSupport {
  const elicitation = clientCapabilities?.elicitation;
  return {
    supported: !!elicitation,
    form: !!elicitation?.form,
    url: !!elicitation?.url,
  };
}

/**
 * Assert that form elicitation is supported
 */
export function assertFormElicitationSupport(
  clientCapabilities: ClientCapabilities | undefined
): void {
  if (!clientCapabilities?.elicitation?.form) {
    throw new ServiceError(
      'Client does not support form-based elicitation',
      'INTERNAL_ERROR',
      'elicitation'
    );
  }
}

/**
 * Assert that URL elicitation is supported
 */
export function assertURLElicitationSupport(
  clientCapabilities: ClientCapabilities | undefined
): void {
  if (!clientCapabilities?.elicitation?.url) {
    throw new ServiceError(
      'Client does not support URL-based elicitation',
      'INTERNAL_ERROR',
      'elicitation'
    );
  }
}

// ============================================================================
// Schema Builders
// ============================================================================

/**
 * Build a string field schema
 */
export function stringField(options: {
  title: string;
  description?: string;
  default?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  format?: 'email' | 'uri' | 'date' | 'date-time';
}): StringSchema {
  return {
    type: 'string',
    title: options.title,
    ...(options.description && { description: options.description }),
    ...(options.default !== undefined && { default: options.default }),
    ...(options.minLength !== undefined && { minLength: options.minLength }),
    ...(options.maxLength !== undefined && { maxLength: options.maxLength }),
    ...(options.format && { format: options.format }),
  };
}

/**
 * Build a number field schema
 */
export function numberField(options: {
  title: string;
  description?: string;
  default?: number;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
}): NumberSchema {
  return {
    type: options.integer ? 'integer' : 'number',
    title: options.title,
    ...(options.description && { description: options.description }),
    ...(options.default !== undefined && { default: options.default }),
    ...(options.minimum !== undefined && { minimum: options.minimum }),
    ...(options.maximum !== undefined && { maximum: options.maximum }),
  };
}

/**
 * Build a boolean field schema
 */
export function booleanField(options: {
  title: string;
  description?: string;
  default?: boolean;
}): BooleanSchema {
  return {
    type: 'boolean',
    title: options.title,
    ...(options.description && { description: options.description }),
    ...(options.default !== undefined && { default: options.default }),
  };
}

/**
 * Build an enum field schema (simple list)
 */
export function enumField(options: {
  title: string;
  description?: string;
  values: string[];
  default?: string;
}): EnumSchema {
  return {
    type: 'string',
    title: options.title,
    ...(options.description && { description: options.description }),
    enum: options.values,
    ...(options.default && { default: options.default }),
  };
}

/**
 * Build an enum field schema with display titles
 */
export function selectField(options: {
  title: string;
  description?: string;
  options: Array<{ value: string; label: string }>;
  default?: string;
}): EnumSchema {
  return {
    type: 'string',
    title: options.title,
    ...(options.description && { description: options.description }),
    oneOf: options.options.map((opt) => ({
      const: opt.value,
      title: opt.label,
    })),
    ...(options.default && { default: options.default }),
  };
}

// ============================================================================
// Pre-built Form Schemas for Common ServalSheets Operations
// ============================================================================

/**
 * Schema for spreadsheet creation preferences
 */
export const SPREADSHEET_CREATION_SCHEMA: FormElicitParams['requestedSchema'] = {
  type: 'object',
  properties: {
    title: stringField({
      title: 'Spreadsheet Title',
      description: 'Name for your new spreadsheet',
      default: 'Untitled Spreadsheet',
      maxLength: 255,
    }),
    locale: selectField({
      title: 'Locale',
      description: 'Regional format settings',
      options: [
        { value: 'en_US', label: 'English (United States)' },
        { value: 'en_GB', label: 'English (United Kingdom)' },
        { value: 'de_DE', label: 'German (Germany)' },
        { value: 'fr_FR', label: 'French (France)' },
        { value: 'es_ES', label: 'Spanish (Spain)' },
        { value: 'ja_JP', label: 'Japanese (Japan)' },
        { value: 'zh_CN', label: 'Chinese (Simplified)' },
      ],
      default: 'en_US',
    }),
    timeZone: selectField({
      title: 'Time Zone',
      description: 'Time zone for date/time functions',
      options: [
        { value: 'America/New_York', label: 'Eastern Time (US)' },
        { value: 'America/Chicago', label: 'Central Time (US)' },
        { value: 'America/Denver', label: 'Mountain Time (US)' },
        { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
        { value: 'Europe/London', label: 'London (UK)' },
        { value: 'Europe/Paris', label: 'Paris (France)' },
        { value: 'Europe/Berlin', label: 'Berlin (Germany)' },
        { value: 'Asia/Tokyo', label: 'Tokyo (Japan)' },
        { value: 'Asia/Shanghai', label: 'Shanghai (China)' },
        { value: 'Australia/Sydney', label: 'Sydney (Australia)' },
      ],
      default: 'America/New_York',
    }),
  },
  required: ['title'],
};

/**
 * Schema for sharing settings
 */
export const SHARING_SETTINGS_SCHEMA: FormElicitParams['requestedSchema'] = {
  type: 'object',
  properties: {
    email: stringField({
      title: 'Email Address',
      description: 'Email of the person to share with',
      format: 'email',
    }),
    role: selectField({
      title: 'Permission Level',
      description: 'What can they do?',
      options: [
        { value: 'reader', label: 'Viewer - Can view only' },
        { value: 'commenter', label: 'Commenter - Can view and comment' },
        { value: 'writer', label: 'Editor - Can make changes' },
      ],
      default: 'reader',
    }),
    sendNotification: booleanField({
      title: 'Send notification email',
      description: 'Notify the person via email',
      default: true,
    }),
    message: stringField({
      title: 'Personal message (optional)',
      description: 'Add a message to the notification email',
      maxLength: 500,
    }),
  },
  required: ['email', 'role'],
};

/**
 * Schema for destructive action confirmation
 */
export const DESTRUCTIVE_CONFIRMATION_SCHEMA: FormElicitParams['requestedSchema'] = {
  type: 'object',
  properties: {
    confirm: booleanField({
      title: 'I understand this action cannot be undone',
      default: false,
    }),
    reason: stringField({
      title: 'Reason for this action (optional)',
      description: 'Why are you performing this operation?',
      maxLength: 200,
    }),
  },
  required: ['confirm'],
};

/**
 * Schema for data import options
 */
export const DATA_IMPORT_SCHEMA: FormElicitParams['requestedSchema'] = {
  type: 'object',
  properties: {
    sourceType: selectField({
      title: 'Import from',
      options: [
        { value: 'csv_url', label: 'CSV from URL' },
        { value: 'google_sheet', label: 'Another Google Sheet' },
        { value: 'json_api', label: 'JSON API endpoint' },
      ],
    }),
    url: stringField({
      title: 'Source URL',
      description: 'URL of the data source',
      format: 'uri',
    }),
    targetSheet: stringField({
      title: 'Target Sheet',
      description: 'Name of sheet to import into (new or existing)',
      default: 'Imported Data',
    }),
    headerRow: booleanField({
      title: 'First row contains headers',
      default: true,
    }),
    replaceExisting: booleanField({
      title: 'Replace existing data',
      description: 'Clear the target sheet before importing',
      default: false,
    }),
  },
  required: ['sourceType', 'url', 'targetSheet'],
};

/**
 * Schema for filter settings
 */
export const FILTER_SETTINGS_SCHEMA: FormElicitParams['requestedSchema'] = {
  type: 'object',
  properties: {
    filterName: stringField({
      title: 'Filter View Name',
      description: 'Name to save this filter as',
      maxLength: 100,
    }),
    columnToFilter: stringField({
      title: 'Column to Filter',
      description: 'Column letter or name (e.g., "A" or "Status")',
    }),
    filterType: selectField({
      title: 'Filter Type',
      options: [
        { value: 'equals', label: 'Equals' },
        { value: 'contains', label: 'Contains' },
        { value: 'greater_than', label: 'Greater than' },
        { value: 'less_than', label: 'Less than' },
        { value: 'between', label: 'Between' },
        { value: 'is_empty', label: 'Is empty' },
        { value: 'is_not_empty', label: 'Is not empty' },
      ],
    }),
    filterValue: stringField({
      title: 'Filter Value',
      description: 'Value to filter by',
    }),
  },
  required: ['columnToFilter', 'filterType'],
};

// ============================================================================
// High-Level Elicitation Functions
// ============================================================================

/**
 * Safely elicit with fallback value if not supported.
 * Attempts elicitation regardless of declared capabilities — Claude Desktop
 * handles elicitation/create even when not advertised in initialize capabilities.
 * Falls back silently on any error (unsupported, declined, timeout).
 */
export async function safeElicit<T>(
  server: ElicitationServer,
  params: FormElicitParams,
  fallback: T
): Promise<T> {
  try {
    const result = await server.elicitInput(params);
    if (result.action === 'accept' && result.content) {
      return result.content as T;
    }
  } catch (_error) {
    // Client doesn't support elicitation, declined, or timed out — use fallback
  }

  return fallback;
}

/**
 * Elicit spreadsheet creation preferences
 */
export async function elicitSpreadsheetCreation(server: ElicitationServer): Promise<{
  title: string;
  locale: string;
  timeZone: string;
} | null> {
  try {
    const result = await server.elicitInput({
      mode: 'form',
      message: 'Configure your new spreadsheet:',
      requestedSchema: SPREADSHEET_CREATION_SCHEMA,
    });

    if (result.action === 'accept' && result.content) {
      return {
        title: (result.content['title'] as string) || 'Untitled Spreadsheet',
        locale: (result.content['locale'] as string) || 'en_US',
        timeZone: (result.content['timeZone'] as string) || 'America/New_York',
      };
    }
  } catch (_error) {
    /* client doesn't support elicitation — fall through to return null */
  }

  return null;
}

/**
 * Elicit sharing settings
 */
export async function elicitSharingSettings(
  server: ElicitationServer,
  spreadsheetTitle: string
): Promise<{
  email: string;
  role: 'reader' | 'commenter' | 'writer';
  sendNotification: boolean;
  message?: string;
} | null> {
  try {
    const result = await server.elicitInput({
      mode: 'form',
      message: `Share "${spreadsheetTitle}" with someone:`,
      requestedSchema: SHARING_SETTINGS_SCHEMA,
    });

    if (result.action === 'accept' && result.content) {
      return {
        email: result.content['email'] as string,
        role: result.content['role'] as 'reader' | 'commenter' | 'writer',
        sendNotification: (result.content['sendNotification'] as boolean) ?? true,
        message: result.content['message'] as string | undefined,
      };
    }
  } catch (_error) {
    /* client doesn't support elicitation */
  }

  return null;
}

/**
 * Confirm a destructive action
 */
export async function confirmDestructiveAction(
  server: ElicitationServer,
  action: string,
  details: string
): Promise<{ confirmed: boolean; reason?: string }> {
  // Add timeout to prevent hanging when client doesn't respond
  const ELICITATION_TIMEOUT_MS = 5000;

  try {
    const elicitPromise = server.elicitInput({
      mode: 'form',
      message: `⚠️ ${action}\n\n${details}\n\nThis action cannot be undone.`,
      requestedSchema: DESTRUCTIVE_CONFIRMATION_SCHEMA,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Elicitation timeout')), ELICITATION_TIMEOUT_MS);
    });

    const result = await Promise.race([elicitPromise, timeoutPromise]);

    recordElicitationRequest(action, 'accepted');
    if (result.action === 'accept' && result.content?.['confirm'] === true) {
      return {
        confirmed: true,
        reason: result.content['reason'] as string | undefined,
      };
    }
    recordElicitationRequest(action, 'declined');

    // User declined or cancelled
    return { confirmed: false };
  } catch (_error) {
    // Client doesn't support elicitation or timed out — proceed by default since
    // user explicitly requested the action (safe per MCP spec backward compatibility)
    recordElicitationRequest(action, 'unavailable');
    return { confirmed: true };
  }
}

/**
 * Elicit data import configuration
 */
export async function elicitDataImport(server: ElicitationServer): Promise<{
  sourceType: 'csv_url' | 'google_sheet' | 'json_api';
  url: string;
  targetSheet: string;
  headerRow: boolean;
  replaceExisting: boolean;
} | null> {
  try {
    const result = await server.elicitInput({
      mode: 'form',
      message: 'Configure data import:',
      requestedSchema: DATA_IMPORT_SCHEMA,
    });

    if (result.action === 'accept' && result.content) {
      return {
        sourceType: result.content['sourceType'] as 'csv_url' | 'google_sheet' | 'json_api',
        url: result.content['url'] as string,
        targetSheet: (result.content['targetSheet'] as string) || 'Imported Data',
        headerRow: (result.content['headerRow'] as boolean) ?? true,
        replaceExisting: (result.content['replaceExisting'] as boolean) ?? false,
      };
    }
  } catch (_error) {
    /* client doesn't support elicitation */
  }

  return null;
}

/**
 * Elicit sort settings for sheets_dimensions.sort_range
 */
export async function elicitSortSettings(server: ElicitationServer): Promise<{
  column: string;
  direction: 'ASCENDING' | 'DESCENDING';
  hasHeaders: boolean;
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      column: stringField({
        title: 'Column to sort by',
        description: 'Column letter or name (e.g., "A" or "Date")',
      }),
      direction: selectField({
        title: 'Sort direction',
        options: [
          { value: 'ASCENDING', label: 'A → Z (ascending)' },
          { value: 'DESCENDING', label: 'Z → A (descending)' },
        ],
        default: 'ASCENDING',
      }),
      hasHeaders: booleanField({
        title: 'First row contains headers',
        description: 'Exclude the header row from sorting',
        default: true,
      }),
    },
    required: ['column', 'direction'],
  };

  const result = await safeElicit<{
    column: string;
    direction: 'ASCENDING' | 'DESCENDING';
    hasHeaders?: boolean;
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Configure sort settings:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      column: result.column,
      direction: result.direction,
      hasHeaders: result.hasHeaders ?? true,
    };
  }

  return null;
}

/**
 * Elicit filter settings for sheets_dimensions.set_basic_filter
 */
export async function elicitFilterSettings(server: ElicitationServer): Promise<{
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
  value: string;
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      column: stringField({
        title: 'Column to filter',
        description: 'Column letter or name (e.g., "A" or "Status")',
      }),
      operator: selectField({
        title: 'Filter condition',
        options: [
          { value: 'eq', label: 'equals' },
          { value: 'neq', label: 'not equal to' },
          { value: 'gt', label: 'greater than' },
          { value: 'lt', label: 'less than' },
          { value: 'contains', label: 'contains' },
        ],
        default: 'eq',
      }),
      value: stringField({
        title: 'Filter value',
        description: 'Value to filter by',
      }),
    },
    required: ['column', 'operator', 'value'],
  };

  const result = await safeElicit<{
    column: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
    value: string;
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Set up a basic filter:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      column: result.column,
      operator: result.operator,
      value: result.value,
    };
  }

  return null;
}

/**
 * Elicit chart settings for sheets_visualize.chart_create
 */
export async function elicitChartSettings(server: ElicitationServer): Promise<{
  chartType: string;
  title: string;
  legendPosition: string;
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      chartType: selectField({
        title: 'Chart type',
        options: [
          { value: 'BAR', label: 'Bar Chart' },
          { value: 'LINE', label: 'Line Chart' },
          { value: 'PIE', label: 'Pie Chart' },
          { value: 'COLUMN', label: 'Column Chart' },
          { value: 'SCATTER', label: 'Scatter Plot' },
          { value: 'AREA', label: 'Area Chart' },
        ],
      }),
      title: stringField({
        title: 'Chart title',
        description: 'Name for this chart',
        maxLength: 255,
      }),
      legendPosition: selectField({
        title: 'Legend position',
        options: [
          { value: 'TOP', label: 'Top' },
          { value: 'BOTTOM', label: 'Bottom' },
          { value: 'LEFT', label: 'Left' },
          { value: 'RIGHT', label: 'Right' },
          { value: 'NONE', label: 'Hidden' },
        ],
        default: 'BOTTOM',
      }),
    },
    required: ['chartType', 'title'],
  };

  const result = await safeElicit<{
    chartType: string;
    title: string;
    legendPosition?: string;
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Create a new chart:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      chartType: result.chartType,
      title: result.title,
      legendPosition: result.legendPosition || 'BOTTOM',
    };
  }

  return null;
}

/**
 * Elicit formula goal for sheets_analyze.generate_formula
 */
export async function elicitFormulaGoal(server: ElicitationServer): Promise<{
  goal: string;
  targetCell: string;
  inputRange: string;
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      goal: stringField({
        title: 'What should the formula calculate?',
        description: 'e.g., "Sum of revenue minus costs" or "Percentage change from Q1 to Q2"',
        maxLength: 500,
      }),
      targetCell: stringField({
        title: 'Cell to place the formula',
        description: 'A1 reference (e.g., "E5" or "Summary!B10")',
      }),
      inputRange: stringField({
        title: 'Range of input data',
        description: 'Range containing the data to calculate on (e.g., "A1:D100")',
      }),
    },
    required: ['goal', 'targetCell', 'inputRange'],
  };

  const result = await safeElicit<{
    goal: string;
    targetCell: string;
    inputRange: string;
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Generate a formula:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      goal: result.goal,
      targetCell: result.targetCell,
      inputRange: result.inputRange,
    };
  }

  return null;
}

/**
 * Elicit cleaning scope for sheets_fix.clean
 */
export async function elicitCleaningScope(server: ElicitationServer): Promise<{
  range: string;
  mode: 'preview' | 'apply';
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      range: stringField({
        title: 'Range to clean',
        description: 'A1 reference (e.g., "A1:Z100" or entire sheet)',
        default: 'A:Z',
      }),
      mode: selectField({
        title: 'What do you want to do?',
        options: [
          { value: 'preview', label: 'Preview changes first' },
          { value: 'apply', label: 'Apply changes now' },
        ],
        default: 'preview',
      }),
      aggressiveness: selectField({
        title: 'Cleaning intensity',
        description: 'How aggressively should we clean?',
        options: [
          { value: 'conservative', label: 'Conservative - Only fix obvious issues' },
          { value: 'moderate', label: 'Moderate - Standard cleaning rules' },
          { value: 'aggressive', label: 'Aggressive - Fix potential issues too' },
        ],
        default: 'moderate',
      }),
    },
    required: ['range', 'mode'],
  };

  const result = await safeElicit<{
    range?: string;
    mode: 'preview' | 'apply';
    aggressiveness?: 'conservative' | 'moderate' | 'aggressive';
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Configure data cleaning:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      range: result.range || 'A:Z',
      mode: result.mode,
      aggressiveness: result.aggressiveness || 'moderate',
    };
  }

  return null;
}

/**
 * Elicit scenario setup for sheets_dependencies.model_scenario
 */
export async function elicitScenarioSetup(server: ElicitationServer): Promise<{
  scenarioName: string;
  description: string;
  targetMetric: string;
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      scenarioName: stringField({
        title: 'Scenario name',
        description: 'e.g., "Revenue Down 20%" or "Best Case 2026"',
        maxLength: 100,
      }),
      description: stringField({
        title: 'What-if scenario description',
        description: 'Describe the scenario (e.g., "Revenue drops 20%, costs stay flat")',
        maxLength: 500,
      }),
      targetMetric: stringField({
        title: 'Key metric to track',
        description:
          'Cell reference or name of the metric you want to monitor (e.g., "Profit Margin" or "B25")',
      }),
    },
    required: ['scenarioName', 'description', 'targetMetric'],
  };

  const result = await safeElicit<{
    scenarioName: string;
    description: string;
    targetMetric: string;
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Set up a what-if scenario:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      scenarioName: result.scenarioName,
      description: result.description,
      targetMetric: result.targetMetric,
    };
  }

  return null;
}

/**
 * Elicit pipeline configuration for sheets_composite.data_pipeline
 */
export async function elicitPipelineConfig(server: ElicitationServer): Promise<{
  sourceName: string;
  outputFormat: 'same_sheet' | 'new_sheet' | 'new_spreadsheet';
  scheduleHint: string;
} | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      sourceName: stringField({
        title: 'Data source description',
        description: 'e.g., "Sales data" or "Customer feedback CSV from Typeform"',
        maxLength: 200,
      }),
      outputFormat: selectField({
        title: 'Where should the pipeline output go?',
        options: [
          { value: 'same_sheet', label: 'Same sheet (replace or append)' },
          { value: 'new_sheet', label: 'New sheet in this spreadsheet' },
          { value: 'new_spreadsheet', label: 'New spreadsheet' },
        ],
        default: 'new_sheet',
      }),
      scheduleHint: stringField({
        title: 'How often should this run?',
        description: 'e.g., "Daily", "Weekly", "On demand", or leave blank',
        maxLength: 100,
      }),
    },
    required: ['sourceName', 'outputFormat'],
  };

  const result = await safeElicit<{
    sourceName: string;
    outputFormat: 'same_sheet' | 'new_sheet' | 'new_spreadsheet';
    scheduleHint?: string;
  } | null>(
    server,
    {
      mode: 'form',
      message: 'Configure data pipeline:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return {
      sourceName: result.sourceName,
      outputFormat: result.outputFormat,
      scheduleHint: result.scheduleHint || '',
    };
  }

  return null;
}

/**
 * Elicit conditional format rule preset for sheets_format.add_conditional_format_rule
 */
export async function elicitConditionalFormatPreset(
  server: ElicitationServer,
  range: string
): Promise<{ preset: string } | null> {
  const schema: FormElicitParams['requestedSchema'] = {
    type: 'object',
    properties: {
      preset: selectField({
        title: 'Conditional formatting rule',
        description: `Select a preset rule to apply to range ${range}`,
        options: [
          { value: 'highlight_duplicates', label: 'Highlight duplicate cells in red' },
          { value: 'color_scale_green_red', label: 'Color gradient: green (low) to red (high)' },
          { value: 'data_bars', label: 'Show data bars proportional to cell value' },
          { value: 'top_10_percent', label: 'Bold top 10% of values' },
          { value: 'highlight_blanks', label: 'Highlight blank cells in yellow' },
          { value: 'above_average', label: 'Green for above-average values' },
        ],
        default: 'highlight_duplicates',
      }),
    },
    required: ['preset'],
  };

  const result = await safeElicit<{ preset: string } | null>(
    server,
    {
      mode: 'form',
      message: 'Choose a conditional formatting rule preset:',
      requestedSchema: schema,
    },
    null
  );

  if (result) {
    return { preset: result.preset };
  }

  return null;
}

// ============================================================================
// URL Elicitation (OAuth and External Auth)
// ============================================================================

/**
 * Generate a unique elicitation ID
 */
export function generateElicitationId(prefix: string = 'elicit'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Initiate OAuth flow via URL elicitation
 */
export async function initiateOAuthFlow(
  server: ElicitationServer,
  params: {
    authUrl: string;
    provider: string;
    scopes?: string[];
  }
): Promise<{
  accepted: boolean;
  elicitationId: string;
}> {
  assertURLElicitationSupport(server.getClientCapabilities());

  const elicitationId = generateElicitationId('oauth');

  let message = `Sign in with ${params.provider} to authorize access.`;
  if (params.scopes?.length) {
    message += `\n\nRequested permissions:\n• ${params.scopes.join('\n• ')}`;
  }

  const result = await server.elicitInput({
    mode: 'url',
    message,
    elicitationId,
    url: params.authUrl,
  });

  return {
    accepted: result.action === 'accept',
    elicitationId,
  };
}

/**
 * Complete an OAuth flow (send notification to client)
 */
export async function completeOAuthFlow(
  server: ElicitationServer,
  elicitationId: string
): Promise<void> {
  if (server.createElicitationCompletionNotifier) {
    const notify = server.createElicitationCompletionNotifier(elicitationId);
    try {
      await notify();
    } catch (_notifyErr) {
      // Non-fatal: notification channel failure shouldn't block OAuth completion
      // (OAuth flow already succeeded; notification is best-effort)
    }
  }
}

// ============================================================================
// Multi-step Wizards
// ============================================================================

/**
 * Result type for wizard steps
 */
export interface WizardStepResult<T> {
  completed: boolean;
  data?: T;
  cancelled?: boolean;
}

/**
 * Run a multi-step wizard
 */
export async function runWizard<T>(
  server: ElicitationServer,
  steps: Array<{
    message: string;
    schema: FormElicitParams['requestedSchema'];
    transform?: (data: Record<string, unknown>, accumulated: Partial<T>) => Partial<T>;
  }>,
  options: {
    onStepComplete?: (stepIndex: number, data: Partial<T>) => void;
  } = {}
): Promise<WizardStepResult<T>> {
  let accumulated: Partial<T> = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const stepNumber = i + 1;
    const totalSteps = steps.length;

    let result: Awaited<ReturnType<typeof server.elicitInput>>;
    try {
      result = await server.elicitInput({
        mode: 'form',
        message: `Step ${stepNumber}/${totalSteps}: ${step.message}`,
        requestedSchema: step.schema,
      });
    } catch (_error) {
      // Client doesn't support elicitation — abort wizard gracefully
      return { completed: false };
    }

    if (result.action === 'cancel') {
      return { completed: false, cancelled: true };
    }

    if (result.action === 'decline' || !result.content) {
      return { completed: false };
    }

    // Transform and accumulate data
    if (step.transform) {
      accumulated = {
        ...accumulated,
        ...step.transform(result.content, accumulated),
      };
    } else {
      accumulated = { ...accumulated, ...(result.content as Partial<T>) };
    }

    // Notify step completion
    if (options.onStepComplete) {
      options.onStepComplete(i, accumulated);
    }
  }

  return { completed: true, data: accumulated as T };
}

// ============================================================================
// B2: Clarification Elicitation
// ============================================================================

/**
 * A single clarification question to ask the user mid-analysis.
 */
export interface ClarificationQuestion {
  /** The question to display to the user */
  question: string;
  /** Optional set of allowed answers (renders as a dropdown) */
  options?: string[];
  /** Field name in the form schema */
  field?: string;
}

/**
 * Elicit user clarification when analysis confidence is low.
 *
 * Asks at most one question (the first in the array) to avoid overwhelming
 * the user. Returns the collected answers, or null if elicitation is
 * unsupported or the user declined.
 *
 * Non-blocking: catches all errors and degrades gracefully.
 */
export async function elicitUserClarification(
  server: ElicitationServer,
  questions: ClarificationQuestion[],
  context?: string
): Promise<Record<string, string> | null> {
  try {
    const firstQ = questions[0];
    if (!firstQ) return null;

    const field = firstQ.field ?? 'clarification';
    const fieldSchema: PrimitiveSchema =
      firstQ.options && firstQ.options.length > 0
        ? { type: 'string', title: firstQ.question, enum: firstQ.options }
        : { type: 'string', title: firstQ.question };

    const result = await server.elicitInput({
      mode: 'form',
      message: context ?? 'I need a quick clarification to give you the best analysis.',
      requestedSchema: {
        type: 'object',
        properties: { [field]: fieldSchema },
      },
    });

    if (result.action === 'accept' && result.content) {
      return result.content as Record<string, string>;
    }
  } catch {
    // Client doesn't support elicitation, declined, or timed out — degrade gracefully
  }

  return null;
}

// ============================================================================
// Exports
// ============================================================================

export type { ElicitResult };
