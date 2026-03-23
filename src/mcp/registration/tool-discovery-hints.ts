/**
 * ServalSheets - Tool Discovery Hints
 *
 * Builds lightweight action-level parameter hints from the full input schemas so
 * deferred `tools/list` responses remain actionable without requiring MCP
 * resource reads.
 */

import { zodSchemaToJsonSchema } from '../../utils/schema-compat.js';
import { filterAvailableActions } from '../tool-availability.js';
import type { ToolDefinition } from './tool-definitions.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';

type JsonRecord = Record<string, unknown>;
type HintEnumValue = string | number | boolean | null;

const MAX_DESCRIPTION_LENGTH = 160;
const MAX_NESTED_FIELDS = 12;
const MAX_ENUM_VALUES = 24;
const MAX_SUMMARY_DEPTH = 3;

export interface ParamSchemaHint {
  type?: string;
  description?: string;
  enum?: HintEnumValue[];
  required?: string[];
  properties?: Record<string, ParamSchemaHint>;
  items?: ParamSchemaHint;
}

export interface ActionParamHint {
  description?: string;
  required: string[];
  requiredOneOf?: string[][];
  optional?: string[];
  params?: Record<string, ParamSchemaHint>;
}

export interface ToolDiscoveryHint {
  actionParams: Record<string, ActionParamHint>;
  requestDescription: string;
  descriptionSuffix: string;
}

const discoveryHintCache = new Map<string, ToolDiscoveryHint | null>();

interface ActionHintOverride {
  description?: string;
  required?: string[];
  requiredOneOf?: string[][];
  optional?: string[];
  params?: string[];
}

const COMMON_COLLABORATE_PARAMS = ['spreadsheetId', 'safety', 'verbosity'];

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function collaborateAction(
  required: string[],
  extras: string[] = [],
  description?: string,
  requiredOneOf?: string[][]
): ActionHintOverride {
  return {
    ...(description ? { description } : {}),
    required,
    ...(requiredOneOf ? { requiredOneOf } : {}),
    params: uniqueStrings([...required, ...extras, ...COMMON_COLLABORATE_PARAMS]),
  };
}

const ACTION_HINT_OVERRIDES: Record<string, Record<string, ActionHintOverride>> = {
  sheets_appsscript: {
    get: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Get project metadata. Provide either scriptId directly or spreadsheetId to auto-resolve the bound project.',
    },
    get_content: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Get script files. Provide either scriptId directly or spreadsheetId to auto-resolve the bound project.',
    },
    update_content: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Update project files. Requires files plus either scriptId directly or spreadsheetId to auto-resolve the bound project.',
    },
    create_trigger: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Compatibility-only. Currently returns NOT_IMPLEMENTED because external Apps Script clients cannot manage triggers via REST. Prefer update_content plus deploy.',
    },
    list_triggers: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Compatibility-only. Currently returns NOT_IMPLEMENTED because external Apps Script clients cannot list triggers via REST. Prefer get_content to inspect ScriptApp trigger code.',
    },
    delete_trigger: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Compatibility-only. Currently returns NOT_IMPLEMENTED because external Apps Script clients cannot delete triggers via REST. Prefer update_content to remove ScriptApp trigger code.',
    },
    update_trigger: {
      requiredOneOf: [['scriptId', 'spreadsheetId']],
      description:
        'Compatibility-only. Currently returns NOT_IMPLEMENTED because external Apps Script clients cannot update triggers via REST. Prefer update_content plus deploy.',
    },
  },
  sheets_format: {
    auto_fit: {
      requiredOneOf: [['range', 'sheetId']],
      description: 'Auto-fit rows or columns. Provide either a range or a numeric sheetId.',
    },
  },
  sheets_connectors: {
    list_connectors: {
      description:
        'Start here for external data onboarding. Returns configured status, signupUrl, recommendedUseCases, and nextStep for each connector.',
    },
    configure: {
      description:
        'Configure a connector. If connectorId or credentials are omitted, the server can prompt for them. API-key connectors can open a local setup page via MCP URL elicitation and the response ends with verification guidance.',
    },
    status: {
      description:
        'Use after configure to distinguish not configured vs configured but failing and to get the recommended next query.',
    },
  },
  sheets_webhook: {
    register: {
      description:
        'Register a webhook endpoint. Requires Redis-backed webhook storage plus an HTTPS webhookUrl.',
    },
    unregister: {
      description: 'Remove a registered webhook. Requires the Redis-backed webhook store.',
    },
    list: {
      description: 'List registered webhooks. Requires the Redis-backed webhook store.',
    },
    get: {
      description: 'Get details for one webhook. Requires the Redis-backed webhook store.',
    },
    test: {
      description:
        'Send a test delivery to an existing webhook. Requires the Redis-backed webhook store.',
    },
    get_stats: {
      description: 'Get webhook delivery statistics. Requires the Redis-backed webhook store.',
    },
    watch_changes: {
      description:
        'Create a native Drive files.watch channel. Does not require Redis, but without Redis the channel is not persisted for renewal or later listing.',
    },
    subscribe_workspace: {
      required: ['spreadsheetId'],
      description:
        'Create a Google Workspace Events subscription for real-time change notifications. No Redis required.',
    },
    unsubscribe_workspace: {
      required: ['subscriptionId'],
      description:
        'Remove a Google Workspace Events subscription. Requires the subscriptionId from subscribe_workspace.',
    },
    list_workspace_subscriptions: {
      required: [],
      description: 'List active Google Workspace Events subscriptions. No Redis required.',
    },
  },
  sheets_collaborate: {
    share_add: collaborateAction(
      ['spreadsheetId', 'type', 'role'],
      ['emailAddress', 'domain', 'sendNotification', 'emailMessage', 'expirationTime'],
      'Add a sharing permission. If type=user or group, include emailAddress. If type=domain, include domain.'
    ),
    share_update: collaborateAction(
      ['spreadsheetId', 'permissionId', 'role'],
      ['expirationTime'],
      'Update an existing sharing permission for a user, group, domain, or public link.'
    ),
    share_remove: collaborateAction(
      ['spreadsheetId', 'permissionId'],
      [],
      'Remove a sharing permission from the spreadsheet.'
    ),
    share_list: collaborateAction(
      ['spreadsheetId'],
      [],
      'List current sharing permissions and roles for the spreadsheet.'
    ),
    share_get: collaborateAction(
      ['spreadsheetId', 'permissionId'],
      [],
      'Get details for one sharing permission by permissionId.'
    ),
    share_transfer_ownership: collaborateAction(
      ['spreadsheetId', 'newOwnerEmail'],
      [],
      'Transfer spreadsheet ownership to a new user email.'
    ),
    share_set_link: collaborateAction(
      ['spreadsheetId', 'enabled'],
      ['type', 'role', 'allowFileDiscovery'],
      'Enable, disable, or change link-sharing settings for the spreadsheet.'
    ),
    share_get_link: collaborateAction(
      ['spreadsheetId'],
      [],
      'Get the current link-sharing configuration for the spreadsheet.'
    ),
    comment_add: collaborateAction(
      ['spreadsheetId', 'content'],
      ['anchor'],
      'Add a new comment to the spreadsheet, optionally anchored to content.'
    ),
    comment_update: collaborateAction(
      ['spreadsheetId', 'commentId', 'content'],
      [],
      'Update the text of an existing comment.'
    ),
    comment_delete: collaborateAction(
      ['spreadsheetId', 'commentId'],
      [],
      'Delete an existing comment.'
    ),
    comment_list: collaborateAction(
      ['spreadsheetId'],
      ['includeDeleted', 'commentPageToken', 'maxResults'],
      'List spreadsheet comments with optional pagination and deleted-comment visibility.'
    ),
    comment_get: collaborateAction(
      ['spreadsheetId', 'commentId'],
      [],
      'Get one comment thread by commentId.'
    ),
    comment_resolve: collaborateAction(
      ['spreadsheetId', 'commentId'],
      [],
      'Mark a comment thread as resolved.'
    ),
    comment_reopen: collaborateAction(
      ['spreadsheetId', 'commentId'],
      [],
      'Reopen a previously resolved comment thread.'
    ),
    comment_add_reply: collaborateAction(
      ['spreadsheetId', 'commentId', 'content'],
      [],
      'Add a reply to an existing comment thread.'
    ),
    comment_update_reply: collaborateAction(
      ['spreadsheetId', 'commentId', 'replyId', 'content'],
      [],
      'Update the text of a reply in a comment thread.'
    ),
    comment_delete_reply: collaborateAction(
      ['spreadsheetId', 'commentId', 'replyId'],
      [],
      'Delete a reply from a comment thread.'
    ),
    version_list_revisions: collaborateAction(
      ['spreadsheetId'],
      ['pageSize', 'pageToken'],
      'List Drive revisions for the spreadsheet with optional pagination.'
    ),
    version_get_revision: collaborateAction(
      ['spreadsheetId', 'revisionId'],
      [],
      'Get metadata for one Drive revision.'
    ),
    version_restore_revision: collaborateAction(
      ['spreadsheetId', 'revisionId'],
      [],
      'Restore the spreadsheet from a Drive revision.'
    ),
    version_keep_revision: collaborateAction(
      ['spreadsheetId', 'revisionId', 'keepForever'],
      [],
      'Mark a Drive revision to keep forever or clear that retention.'
    ),
    version_create_snapshot: collaborateAction(
      ['spreadsheetId'],
      ['name', 'description', 'destinationFolderId'],
      'Start an async snapshot copy for rollback, audit, or manual restore. Poll version_snapshot_status with the returned taskId.'
    ),
    version_snapshot_status: collaborateAction(
      ['spreadsheetId', 'taskId'],
      [],
      'Check the status of an async snapshot copy started by version_create_snapshot.'
    ),
    version_list_snapshots: collaborateAction(
      ['spreadsheetId'],
      [],
      'List named snapshots created for the spreadsheet.'
    ),
    version_restore_snapshot: collaborateAction(
      ['spreadsheetId', 'snapshotId'],
      [],
      'Restore spreadsheet content from a named snapshot.'
    ),
    version_delete_snapshot: collaborateAction(
      ['spreadsheetId', 'snapshotId'],
      [],
      'Delete a named snapshot.'
    ),
    version_compare: collaborateAction(
      ['spreadsheetId'],
      ['revisionId', 'revisionId1', 'revisionId2', 'sheetId'],
      'Compare the current spreadsheet with one revision, or compare two revisions to each other.'
    ),
    version_export: collaborateAction(
      ['spreadsheetId'],
      ['revisionId', 'format'],
      'Export the current spreadsheet or a specific revision in a chosen format.'
    ),
    approval_create: collaborateAction(
      ['spreadsheetId', 'range', 'approvers'],
      ['requiredApprovals', 'message', 'expirationDays'],
      'Create an approval request for a range with one or more approvers.'
    ),
    approval_approve: collaborateAction(
      ['spreadsheetId', 'approvalId'],
      [],
      'Approve a pending approval request.'
    ),
    approval_reject: collaborateAction(
      ['spreadsheetId', 'approvalId'],
      [],
      'Reject a pending approval request.'
    ),
    approval_get_status: collaborateAction(
      ['spreadsheetId', 'approvalId'],
      [],
      'Get the current status and decisions for an approval request.'
    ),
    approval_list_pending: collaborateAction(
      ['spreadsheetId'],
      [],
      'List pending approval requests for the spreadsheet.'
    ),
    approval_delegate: collaborateAction(
      ['spreadsheetId', 'approvalId', 'delegateTo'],
      [],
      'Delegate an approval request to another reviewer.'
    ),
    approval_cancel: collaborateAction(
      ['spreadsheetId', 'approvalId'],
      [],
      'Cancel an approval workflow.'
    ),
    list_access_proposals: collaborateAction(
      ['spreadsheetId'],
      ['pageToken', 'pageSize'],
      'List pending access proposals or requests for the spreadsheet.'
    ),
    resolve_access_proposal: collaborateAction(
      ['spreadsheetId', 'proposalId', 'decision'],
      [],
      'Approve or deny a pending access proposal.'
    ),
    label_list: collaborateAction(
      [],
      ['fileId', 'includeLabels'],
      'List Drive labels for a spreadsheet or Drive file. Provide fileId directly or spreadsheetId as the default file target.',
      [['fileId', 'spreadsheetId']]
    ),
    label_apply: collaborateAction(
      ['labelId'],
      ['fileId', 'labelFields'],
      'Apply a Drive label. Requires labelId plus either fileId directly or spreadsheetId as the default file target.',
      [['fileId', 'spreadsheetId']]
    ),
    label_remove: collaborateAction(
      ['labelId'],
      ['fileId'],
      'Remove a Drive label. Requires labelId plus either fileId directly or spreadsheetId as the default file target.',
      [['fileId', 'spreadsheetId']]
    ),
  },
  sheets_federation: {
    call_remote: {
      required: ['serverName', 'toolName'],
      optional: ['toolInput'],
      params: ['serverName', 'toolName', 'toolInput'],
      description:
        'Call a tool on a remote MCP server. toolInput is the arguments object for the remote tool.',
    },
    list_servers: {
      required: [],
      params: [],
      description: 'List all configured remote MCP servers and their connection status.',
    },
    get_server_tools: {
      required: ['serverName'],
      params: ['serverName'],
      description: 'List tools available on a specific remote MCP server.',
    },
    validate_connection: {
      required: ['serverName'],
      params: ['serverName'],
      description: 'Test the connection to a remote MCP server.',
    },
  },
  sheets_auth: {
    status: {
      required: [],
      description:
        'Check authentication and readiness first. Read readiness, blockingIssues, recommendedNextAction, and recommendedPrompt before doing anything else.',
    },
    login: {
      required: [],
      description: 'Start the OAuth2 login flow. Opens browser for Google account authorization.',
    },
    callback: {
      required: ['code', 'state'],
      description: 'Handle OAuth2 callback with authorization code and state parameter.',
    },
    logout: {
      required: [],
      description: 'Revoke tokens and clear stored credentials.',
    },
    setup_feature: {
      required: ['feature'],
      description:
        'Canonical optional-capability setup for connectors, AI fallback, webhooks, and federation. Returns configured, verified, nextStep, and fallbackInstructions.',
    },
  },
  sheets_session: {
    set_active: {
      required: ['spreadsheetId'],
      description:
        'Set the active spreadsheet for the current session. Enables "that spreadsheet" references.',
    },
    get_active: {
      required: [],
      description: 'Get the currently active spreadsheet ID and metadata.',
    },
    get_context: {
      required: [],
      description:
        'Get full session context including active spreadsheet, recent operations, and preferences.',
    },
    record_operation: {
      required: ['tool', 'toolAction', 'spreadsheetId', 'description'],
      description: 'Record a tool operation in session history for context continuity.',
    },
    get_last_operation: {
      required: [],
      description: 'Get the most recent operation recorded in this session.',
    },
    get_history: {
      required: [],
      optional: ['limit'],
      description: 'Get recent operation history for the current session.',
    },
    find_by_reference: {
      required: ['reference'],
      description:
        'Resolve a natural language reference like "that spreadsheet" or "the range I just read".',
    },
    update_preferences: {
      required: ['preferences'],
      description: 'Update session preferences (verbosity, timezone, locale, etc.).',
    },
    get_preferences: {
      required: [],
      description: 'Get current session preferences.',
    },
    set_pending: {
      required: ['key', 'value'],
      description: 'Store a pending value for multi-step workflows (e.g. wizard state).',
    },
    get_pending: {
      required: ['key'],
      description: 'Retrieve a stored pending value by key.',
    },
    clear_pending: {
      required: ['key'],
      description: 'Clear a stored pending value by key.',
    },
    save_checkpoint: {
      required: ['name'],
      description: 'Save current session state as a named checkpoint for later restoration.',
    },
    load_checkpoint: {
      required: ['name'],
      description: 'Restore session state from a named checkpoint.',
    },
    list_checkpoints: {
      required: [],
      description: 'List all saved session checkpoints.',
    },
    delete_checkpoint: {
      required: ['name'],
      description: 'Delete a saved session checkpoint by name.',
    },
    reset: {
      required: [],
      description: 'Reset session state (active spreadsheet, history, preferences).',
    },
    get_alerts: {
      required: [],
      description: 'Get unacknowledged session alerts (quota warnings, error patterns, etc.).',
    },
    acknowledge_alert: {
      required: ['alertId'],
      description: 'Acknowledge and dismiss a session alert.',
    },
    clear_alerts: {
      required: [],
      description: 'Clear all session alerts.',
    },
    set_user_id: {
      required: ['userId'],
      description: 'Set the user identifier for session tracking and RBAC.',
    },
    get_profile: {
      required: [],
      description: 'Get user profile including preferences and usage statistics.',
    },
    update_profile_preferences: {
      required: ['preferences'],
      description: 'Update persistent user profile preferences.',
    },
    record_successful_formula: {
      required: ['formula', 'spreadsheetId'],
      description: 'Record a formula that worked well for future suggestion ranking.',
    },
    reject_suggestion: {
      required: ['suggestionId'],
      description: 'Record a rejected suggestion so it is not repeated.',
    },
    get_top_formulas: {
      required: [],
      description: 'Get the most frequently successful formulas for suggestion context.',
    },
    execute_pipeline: {
      required: ['steps'],
      description: 'Execute a multi-step pipeline of ServalSheets operations sequentially.',
    },
    schedule_create: {
      required: ['name', 'cronExpression', 'steps'],
      description: 'Create a scheduled recurring pipeline with cron expression.',
    },
    schedule_list: {
      required: [],
      description: 'List all scheduled pipelines.',
    },
    schedule_cancel: {
      required: ['scheduleId'],
      description: 'Cancel a scheduled pipeline by ID.',
    },
    schedule_run_now: {
      required: ['scheduleId'],
      description: 'Immediately run a scheduled pipeline.',
    },
  },
  sheets_data: {
    read: {
      required: ['spreadsheetId', 'range'],
      optional: ['valueRenderOption', 'dateTimeRenderOption', 'majorDimension'],
      description:
        'Read cell values from a range. Returns 2D array of values. Use valueRenderOption=UNFORMATTED_VALUE for numeric reads — the default FORMATTED_VALUE returns strings like "1,234.56" which break numeric comparisons.',
    },
    write: {
      required: ['spreadsheetId', 'range', 'values'],
      optional: ['valueInputOption', 'preserveDataValidation'],
      description:
        'Write values to a range. Values is a 2D array. Default valueInputOption=USER_ENTERED parses formulas (=SUM()) and numbers correctly. Use preserveDataValidation=true to keep existing data validation rules on target cells.',
    },
    append: {
      required: ['spreadsheetId', 'range', 'values'],
      description: 'Append rows after the last row with data in the range.',
    },
    clear: {
      required: ['spreadsheetId', 'range'],
      description: 'Clear cell values in a range (keeps formatting).',
    },
    batch_read: {
      required: ['spreadsheetId', 'ranges'],
      optional: ['valueRenderOption'],
      description:
        'Read multiple ranges in one API call. Ranges is an array of A1 notation strings. Prefer over repeated read calls. Use valueRenderOption=UNFORMATTED_VALUE for numeric data.',
    },
    batch_write: {
      required: ['spreadsheetId', 'data'],
      description:
        'Write to multiple ranges in one API call. Data is array of { range, values } objects. Prefer over repeated write calls. For formula fills, generate the formula string per row in code (e.g. "=B2-C2") and write all rows in one batch_write call.',
    },
    batch_clear: {
      required: ['spreadsheetId', 'ranges'],
      description: 'Clear multiple ranges in one API call.',
    },
    find_replace: {
      required: ['spreadsheetId', 'find'],
      optional: ['replacement', 'range', 'matchCase', 'matchEntireCell', 'useRegex', 'sheetId'],
      description:
        'Find and optionally replace values. Omit replacement for find-only (count matches).',
    },
    add_note: {
      required: ['spreadsheetId', 'cell', 'note'],
      description: 'Add a note (tooltip) to a cell.',
    },
    get_note: {
      required: ['spreadsheetId', 'cell'],
      description: 'Get the note on a specific cell.',
    },
    clear_note: {
      required: ['spreadsheetId', 'cell'],
      description: 'Remove the note from a cell.',
    },
    set_hyperlink: {
      required: ['spreadsheetId', 'cell', 'url'],
      optional: ['label'],
      description: 'Set a hyperlink on a cell with an optional display label.',
    },
    clear_hyperlink: {
      required: ['spreadsheetId', 'cell'],
      description: 'Remove the hyperlink from a cell.',
    },
    merge_cells: {
      required: ['spreadsheetId', 'range'],
      optional: ['mergeType'],
      description: 'Merge cells in a range. mergeType: MERGE_ALL, MERGE_COLUMNS, or MERGE_ROWS.',
    },
    unmerge_cells: {
      required: ['spreadsheetId', 'range'],
      description: 'Unmerge previously merged cells.',
    },
    get_merges: {
      required: ['spreadsheetId'],
      optional: ['sheetId'],
      description: 'List all merged cell regions in the spreadsheet or a specific sheet.',
    },
    cut_paste: {
      required: ['spreadsheetId', 'source', 'destination'],
      description: 'Cut a range and paste it to a destination cell. Source is cleared.',
    },
    copy_paste: {
      required: ['spreadsheetId', 'source', 'destination'],
      optional: ['pasteType'],
      description:
        'Copy a range and paste to destination. pasteType: PASTE_NORMAL, PASTE_VALUES, PASTE_FORMAT, etc.',
    },
    detect_spill_ranges: {
      required: ['spreadsheetId'],
      optional: ['sheetId', 'sheetName'],
      description: 'Detect dynamic array spill ranges (ARRAYFORMULA, FILTER, SORT results).',
    },
    smart_fill: {
      required: ['spreadsheetId', 'range'],
      description: 'Autofill a range based on detected patterns in adjacent data.',
    },
    auto_fill: {
      required: ['spreadsheetId', 'sourceRange', 'fillRange'],
      optional: ['strategy'],
      description:
        'Extend source pattern into fill range. Strategy: detect, linear, repeat, or date.',
    },
    cross_read: {
      required: ['sources'],
      optional: ['joinKey', 'joinType'],
      description:
        'Read and merge data from multiple spreadsheets. Sources is array of { spreadsheetId, range }.',
    },
    cross_query: {
      required: ['sources', 'query'],
      description: 'Natural language query across multiple spreadsheets.',
    },
    cross_write: {
      required: ['source', 'destination'],
      description: 'Copy data from one spreadsheet range to another.',
    },
    cross_compare: {
      required: ['source1', 'source2', 'compareColumns'],
      description: 'Diff two ranges across spreadsheets by key columns.',
    },
  },
  sheets_core: {
    get: {
      required: ['spreadsheetId'],
      optional: ['includeGridData', 'ranges'],
      description: 'Get spreadsheet metadata. Add includeGridData:true + ranges for cell data.',
    },
    create: {
      required: [],
      optional: ['title', 'locale', 'timeZone', 'sheets'],
      description:
        'Create a new spreadsheet. All params optional — defaults to "Untitled Spreadsheet".',
    },
    copy: {
      required: ['spreadsheetId'],
      optional: ['title', 'destinationFolderId'],
      description: 'Copy an entire spreadsheet to a new file.',
    },
    update_properties: {
      required: ['spreadsheetId'],
      optional: ['title', 'locale', 'timeZone', 'autoRecalc'],
      description: 'Update spreadsheet-level properties (title, locale, timezone, recalc mode).',
    },
    get_url: {
      required: ['spreadsheetId'],
      description: 'Get the web URL for a spreadsheet.',
    },
    batch_get: {
      required: ['spreadsheetIds'],
      description: 'Get metadata for multiple spreadsheets in one call.',
    },
    get_comprehensive: {
      required: ['spreadsheetId'],
      description:
        'Get full spreadsheet metadata including sheets, named ranges, and developer metadata.',
    },
    describe_workbook: {
      required: ['spreadsheetId'],
      description: 'Get an LLM-friendly workbook description with sheet summaries and data shapes.',
    },
    workbook_fingerprint: {
      required: ['spreadsheetId'],
      description: 'Get a structural fingerprint for change detection (hash of sheet structure).',
    },
    list: {
      required: [],
      optional: ['query', 'pageSize', 'pageToken'],
      description: 'List spreadsheets accessible to the user. Supports Drive query syntax.',
    },
    add_sheet: {
      required: ['spreadsheetId', 'title'],
      optional: ['rowCount', 'columnCount'],
      description: 'Add a new sheet/tab to the spreadsheet.',
    },
    delete_sheet: {
      required: ['spreadsheetId', 'sheetId'],
      description: 'Delete a sheet/tab by numeric sheetId (not name).',
    },
    duplicate_sheet: {
      required: ['spreadsheetId', 'sheetId'],
      optional: ['newSheetName', 'targetSpreadsheetId'],
      description: 'Duplicate a sheet within or across spreadsheets.',
    },
    update_sheet: {
      required: ['spreadsheetId', 'sheetId'],
      optional: ['title', 'hidden', 'tabColor', 'index', 'rightToLeft'],
      description: 'Update sheet properties (rename, hide/show, tab color, position, RTL).',
    },
    copy_sheet_to: {
      required: ['spreadsheetId', 'sheetId', 'destinationSpreadsheetId'],
      description: 'Copy a sheet to a different spreadsheet.',
    },
    list_sheets: {
      required: ['spreadsheetId'],
      description: 'List all sheets/tabs in the spreadsheet with their properties.',
    },
    get_sheet: {
      required: ['spreadsheetId'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Get metadata for a specific sheet by sheetId or sheetName.',
    },
    batch_delete_sheets: {
      required: ['spreadsheetId', 'sheetIds'],
      description: 'Delete multiple sheets in one call. sheetIds is array of numeric IDs.',
    },
    batch_update_sheets: {
      required: ['spreadsheetId', 'updates'],
      description: 'Update multiple sheet properties in one call.',
    },
    clear_sheet: {
      required: ['spreadsheetId'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Clear all data from a sheet (keeps structure and formatting).',
    },
    move_sheet: {
      required: ['spreadsheetId', 'sheetId', 'newIndex'],
      description: 'Move a sheet to a new tab position (0-indexed).',
    },
  },
  sheets_dimensions: {
    insert: {
      required: ['spreadsheetId', 'dimension', 'startIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      optional: ['count'],
      description: 'Insert rows or columns. dimension: ROWS or COLUMNS. startIndex is 0-based.',
    },
    delete: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description:
        'Delete rows or columns. dimension: ROWS or COLUMNS. Range is [startIndex, endIndex).',
    },
    move: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex', 'destinationIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Move rows or columns to a new position.',
    },
    resize: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex', 'pixelSize'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Set row height or column width in pixels.',
    },
    auto_resize: {
      required: ['spreadsheetId', 'dimension'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description:
        'Auto-fit row height or column width to content. Optionally scope with startIndex/endIndex.',
    },
    hide: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Hide rows or columns in range [startIndex, endIndex).',
    },
    show: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Show (unhide) rows or columns in range [startIndex, endIndex).',
    },
    freeze: {
      required: ['spreadsheetId', 'dimension', 'count'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Freeze rows or columns. count=0 to unfreeze. dimension: ROWS or COLUMNS.',
    },
    group: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Create a row or column group (collapsible outline).',
    },
    ungroup: {
      required: ['spreadsheetId', 'dimension', 'startIndex', 'endIndex'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Remove a row or column group.',
    },
    append: {
      required: ['spreadsheetId', 'dimension', 'count'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Append empty rows or columns to the end of the sheet.',
    },
    set_basic_filter: {
      required: ['spreadsheetId'],
      requiredOneOf: [['sheetId', 'sheetName']],
      optional: ['range', 'criteria', 'columnIndex'],
      description:
        'Set or replace the basic filter on a sheet. Optional criteria for column filtering.',
    },
    clear_basic_filter: {
      required: ['spreadsheetId'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Remove the basic filter from a sheet.',
    },
    get_basic_filter: {
      required: ['spreadsheetId'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Get the current basic filter configuration.',
    },
    sort_range: {
      required: ['spreadsheetId', 'range', 'sortSpecs'],
      description:
        'Sort a range by one or more columns. sortSpecs: [{ dimensionIndex, sortOrder }].',
    },
    delete_duplicates: {
      required: ['spreadsheetId', 'range'],
      description: 'Remove duplicate rows from a range based on all columns.',
    },
    trim_whitespace: {
      required: ['spreadsheetId', 'range'],
      description: 'Trim leading/trailing whitespace from all cells in a range.',
    },
    randomize_range: {
      required: ['spreadsheetId', 'range'],
      description: 'Randomize the order of rows in a range.',
    },
    text_to_columns: {
      required: ['spreadsheetId', 'source'],
      optional: ['delimiter', 'delimiterType'],
      description: 'Split a column into multiple columns by delimiter.',
    },
    auto_fill: {
      required: ['spreadsheetId'],
      optional: ['range', 'sourceRange', 'fillLength', 'dimension'],
      description: 'Auto-fill a range by extending detected patterns.',
    },
    create_filter_view: {
      required: ['spreadsheetId', 'title'],
      requiredOneOf: [['sheetId', 'sheetName']],
      optional: ['range', 'criteria'],
      description: 'Create a named filter view for a sheet.',
    },
    duplicate_filter_view: {
      required: ['spreadsheetId', 'filterViewId'],
      description: 'Duplicate an existing filter view.',
    },
    update_filter_view: {
      required: ['spreadsheetId', 'filterViewId'],
      optional: ['title', 'range', 'criteria'],
      description: 'Update a filter view (title, range, or criteria).',
    },
    delete_filter_view: {
      required: ['spreadsheetId', 'filterViewId'],
      description: 'Delete a filter view.',
    },
    list_filter_views: {
      required: ['spreadsheetId'],
      optional: ['sheetId', 'cursor', 'limit'],
      description: 'List filter views with optional pagination.',
    },
    get_filter_view: {
      required: ['spreadsheetId', 'filterViewId'],
      description: 'Get details of a specific filter view.',
    },
    create_slicer: {
      required: ['spreadsheetId', 'dataRange', 'filterColumn', 'position'],
      requiredOneOf: [['sheetId', 'sheetName']],
      description: 'Create a slicer control for interactive filtering.',
    },
    update_slicer: {
      required: ['spreadsheetId', 'slicerId'],
      description: 'Update slicer properties.',
    },
    delete_slicer: {
      required: ['spreadsheetId', 'slicerId'],
      description: 'Delete a slicer.',
    },
    list_slicers: {
      required: ['spreadsheetId'],
      optional: ['sheetId'],
      description: 'List all slicers in the spreadsheet or a specific sheet.',
    },
  },
  sheets_compute: {
    evaluate: {
      required: ['spreadsheetId', 'formula'],
      optional: ['range'],
      description:
        'Evaluate a formula expression. Optionally scope to a range for cell references.',
    },
    aggregate: {
      required: ['spreadsheetId', 'range', 'functions'],
      optional: ['groupBy', 'type', 'valueColumn', 'windowSize'],
      description:
        'Run aggregate functions (SUM, AVG, COUNT, etc.) on a range. Optional groupBy for pivoting.',
    },
    statistical: {
      required: ['spreadsheetId', 'range'],
      optional: ['columns', 'percentiles', 'includeCorrelations', 'movingWindow'],
      description:
        'Compute descriptive statistics (mean, median, stddev, percentiles) for a range.',
    },
    regression: {
      required: ['spreadsheetId', 'range', 'xColumn', 'yColumn'],
      optional: ['type', 'degree', 'predict'],
      description: 'Fit a regression model. type: linear, polynomial, exponential, logarithmic.',
    },
    forecast: {
      required: ['spreadsheetId', 'range', 'dateColumn', 'valueColumn', 'periods'],
      optional: ['method', 'seasonality'],
      description: 'Forecast future values from time series data.',
    },
    matrix_op: {
      required: ['spreadsheetId', 'range', 'operation'],
      optional: ['secondRange', 'outputRange'],
      description: 'Matrix operations: transpose, multiply, inverse, determinant.',
    },
    pivot_compute: {
      required: ['spreadsheetId', 'range', 'rows', 'values'],
      optional: ['columns', 'filters'],
      description: 'Compute a pivot table in-memory (no sheet modification).',
    },
    custom_function: {
      required: ['spreadsheetId', 'range', 'expression'],
      optional: ['outputColumn'],
      description: 'Apply a custom expression to each row. Use $col_name for column references.',
    },
    batch_compute: {
      required: ['spreadsheetId', 'computations'],
      optional: ['stopOnError'],
      description: 'Run multiple compute operations in one call.',
    },
    explain_formula: {
      required: ['spreadsheetId', 'formula'],
      optional: ['range'],
      description: 'Get a plain-English explanation of a formula.',
    },
    sql_query: {
      required: ['spreadsheetId', 'tables', 'sql'],
      optional: ['timeoutMs'],
      description:
        'Run SQL against sheet data via DuckDB. tables maps alias to { sheetName, range }.',
    },
    sql_join: {
      required: ['spreadsheetId', 'left', 'right', 'on'],
      optional: ['select', 'joinType', 'timeoutMs'],
      description: 'SQL JOIN two sheet ranges. joinType: INNER, LEFT, RIGHT, FULL.',
    },
    python_eval: {
      required: ['spreadsheetId', 'range', 'code'],
      optional: ['hasHeaders', 'timeoutMs'],
      description: 'Run Python code on sheet data (Pyodide). Data available as `df` DataFrame.',
    },
    pandas_profile: {
      required: ['spreadsheetId', 'range'],
      optional: ['hasHeaders', 'includeCorrelations'],
      description: 'Generate a pandas profiling report for a range.',
    },
    sklearn_model: {
      required: ['spreadsheetId', 'range', 'targetColumn', 'modelType'],
      optional: ['featureColumns', 'testSize'],
      description: 'Train a scikit-learn model. modelType: linear, logistic, tree, forest, knn.',
    },
    matplotlib_chart: {
      required: ['spreadsheetId', 'range', 'chartType'],
      optional: ['xColumn', 'yColumns', 'title', 'width', 'height'],
      description: 'Render a matplotlib chart as base64 PNG.',
    },
  },
  sheets_history: {
    list: {
      required: [],
      optional: ['spreadsheetId', 'count', 'failuresOnly', 'cursor', 'pageSize'],
      description: 'List operation history. Optionally filter by spreadsheetId or failures only.',
    },
    get: {
      required: ['operationId'],
      description: 'Get details for a specific operation by ID.',
    },
    stats: {
      required: [],
      description: 'Get aggregate operation statistics (counts, error rates, timing).',
    },
    undo: {
      required: ['spreadsheetId'],
      description: 'Undo the last undoable operation on a spreadsheet.',
    },
    redo: {
      required: ['spreadsheetId'],
      description: 'Redo the last undone operation on a spreadsheet.',
    },
    revert_to: {
      required: ['operationId'],
      description: 'Revert spreadsheet to the state before a specific operation.',
    },
    clear: {
      required: [],
      optional: ['spreadsheetId'],
      description: 'Clear operation history. Optionally scope to one spreadsheet.',
    },
    timeline: {
      required: ['spreadsheetId'],
      optional: ['range', 'since', 'until', 'limit'],
      description: 'Chronological change timeline from Drive revisions with who/what/when.',
    },
    diff_revisions: {
      required: ['spreadsheetId', 'revisionId1', 'revisionId2'],
      optional: ['range'],
      description: 'Cell-level diff between two Drive revisions.',
    },
    restore_cells: {
      required: ['spreadsheetId', 'revisionId', 'cells'],
      description:
        'Surgically restore specific cells from a past revision. cells: array of A1 refs.',
    },
  },
  sheets_dependencies: {
    build: {
      required: ['spreadsheetId'],
      optional: ['sheetNames'],
      description: 'Build the formula dependency graph for a spreadsheet.',
    },
    analyze_impact: {
      required: ['spreadsheetId', 'cell'],
      description: 'Analyze what would be affected if a cell changes.',
    },
    detect_cycles: {
      required: ['spreadsheetId'],
      description: 'Detect circular references in formulas.',
    },
    get_dependencies: {
      required: ['spreadsheetId', 'cell'],
      description: 'Get cells that this cell depends on (precedents).',
    },
    get_dependents: {
      required: ['spreadsheetId', 'cell'],
      description: 'Get cells that depend on this cell (dependents).',
    },
    get_stats: {
      required: ['spreadsheetId'],
      description: 'Get dependency graph statistics (depth, complexity, hotspots).',
    },
    export_dot: {
      required: ['spreadsheetId'],
      description: 'Export dependency graph as Graphviz DOT format.',
    },
    model_scenario: {
      required: ['spreadsheetId', 'changes'],
      optional: ['outputRange'],
      description: '"What if" analysis — trace cascade of changing cell values through formulas.',
    },
    compare_scenarios: {
      required: ['spreadsheetId', 'scenarios'],
      optional: ['compareColumns'],
      description: 'Compare multiple what-if scenarios side by side.',
    },
    create_scenario_sheet: {
      required: ['spreadsheetId', 'scenario'],
      optional: ['targetSheet', 'sourceSheetName'],
      description: 'Materialize a scenario as a new sheet with highlighted changes.',
    },
  },
  sheets_advanced: {
    add_named_range: {
      required: ['spreadsheetId', 'name', 'range'],
      description: 'Create a named range (e.g. "Revenue" for Sheet1!B2:B100).',
    },
    update_named_range: {
      required: ['spreadsheetId', 'namedRangeId'],
      optional: ['name', 'range'],
      description: 'Update a named range. Get namedRangeId from list_named_ranges.',
    },
    delete_named_range: {
      required: ['spreadsheetId', 'namedRangeId'],
      description: 'Delete a named range.',
    },
    list_named_ranges: {
      required: ['spreadsheetId'],
      optional: ['cursor', 'pageSize'],
      description: 'List all named ranges with pagination.',
    },
    get_named_range: {
      required: ['spreadsheetId', 'name'],
      description: 'Get a named range by name.',
    },
    create_named_function: {
      required: ['spreadsheetId', 'functionName', 'functionBody'],
      optional: ['description', 'parameterDefinitions'],
      description:
        'Compatibility action only. Returns FEATURE_UNAVAILABLE because named functions are not exposed consistently via the live Sheets API.',
    },
    list_named_functions: {
      required: ['spreadsheetId'],
      optional: ['cursor', 'pageSize'],
      description:
        'Compatibility action only. Returns FEATURE_UNAVAILABLE because named functions are not exposed consistently via the live Sheets API.',
    },
    get_named_function: {
      required: ['spreadsheetId', 'functionName'],
      description:
        'Compatibility action only. Returns FEATURE_UNAVAILABLE because named functions are not exposed consistently via the live Sheets API.',
    },
    update_named_function: {
      required: ['spreadsheetId', 'functionName'],
      optional: ['newFunctionName', 'functionBody', 'description', 'parameterDefinitions'],
      description:
        'Compatibility action only. Returns FEATURE_UNAVAILABLE because named functions are not exposed consistently via the live Sheets API.',
    },
    delete_named_function: {
      required: ['spreadsheetId', 'functionName'],
      description:
        'Compatibility action only. Returns FEATURE_UNAVAILABLE because named functions are not exposed consistently via the live Sheets API.',
    },
    add_protected_range: {
      required: ['spreadsheetId', 'range'],
      optional: ['description', 'warningOnly', 'editors'],
      description: 'Protect a range from editing. editors: list of allowed email addresses.',
    },
    update_protected_range: {
      required: ['spreadsheetId', 'protectedRangeId'],
      optional: ['range', 'description', 'warningOnly', 'editors'],
      description: 'Update a protected range.',
    },
    delete_protected_range: {
      required: ['spreadsheetId', 'protectedRangeId'],
      description: 'Remove protection from a range.',
    },
    list_protected_ranges: {
      required: ['spreadsheetId'],
      optional: ['sheetId', 'cursor', 'pageSize'],
      description: 'List protected ranges with optional sheet filter.',
    },
    set_metadata: {
      required: ['spreadsheetId', 'metadataKey', 'metadataValue'],
      optional: ['visibility', 'location'],
      description: 'Set developer metadata (key-value pair on spreadsheet, sheet, or range).',
    },
    get_metadata: {
      required: ['spreadsheetId'],
      optional: ['metadataId', 'metadataKey'],
      description: 'Get developer metadata by ID or key.',
    },
    delete_metadata: {
      required: ['spreadsheetId', 'metadataId'],
      description: 'Delete developer metadata by ID.',
    },
    add_banding: {
      required: ['spreadsheetId', 'range'],
      optional: ['rowProperties', 'columnProperties'],
      description: 'Apply alternating row/column color banding.',
    },
    update_banding: {
      required: ['spreadsheetId', 'bandedRangeId'],
      optional: ['rowProperties', 'columnProperties'],
      description: 'Update banding colors.',
    },
    delete_banding: {
      required: ['spreadsheetId', 'bandedRangeId'],
      description: 'Remove banding from a range.',
    },
    list_banding: {
      required: ['spreadsheetId'],
      optional: ['sheetId', 'cursor', 'pageSize'],
      description: 'List banded ranges.',
    },
    create_table: {
      required: ['spreadsheetId', 'range'],
      optional: ['tableName', 'hasHeaders', 'headerRowCount'],
      description: 'Create a structured table from a range.',
    },
    delete_table: {
      required: ['spreadsheetId', 'tableId'],
      description: 'Delete a table.',
    },
    list_tables: {
      required: ['spreadsheetId'],
      optional: ['cursor', 'pageSize'],
      description: 'List all tables.',
    },
    update_table: {
      required: ['spreadsheetId', 'tableId'],
      optional: ['range'],
      description: 'Update table range.',
    },
    rename_table_column: {
      required: ['spreadsheetId', 'tableId', 'columnIndex', 'newName'],
      description: 'Rename a table column header.',
    },
    set_table_column_properties: {
      required: ['spreadsheetId', 'tableId', 'columnIndex'],
      optional: ['columnType', 'dropdownValues', 'dropdownRange'],
      description: 'Set table column type and dropdown properties.',
    },
    add_person_chip: {
      required: ['spreadsheetId', 'range', 'email'],
      optional: ['displayFormat'],
      description: 'Insert a person smart chip by email address.',
    },
    add_drive_chip: {
      required: ['spreadsheetId', 'range', 'fileId'],
      optional: ['displayText'],
      description: 'Insert a Drive file smart chip.',
    },
    add_rich_link_chip: {
      required: ['spreadsheetId', 'range', 'uri'],
      optional: ['displayText'],
      description: 'Insert a rich link smart chip.',
    },
    list_chips: {
      required: ['spreadsheetId'],
      optional: ['range', 'sheetId', 'chipType', 'cursor', 'pageSize'],
      description: 'List smart chips with optional type filter.',
    },
  },
  sheets_visualize: {
    chart_create: {
      required: ['spreadsheetId', 'sheetId', 'chartType', 'data', 'position'],
      optional: ['options'],
      description: 'Create a chart. chartType: LINE, BAR, COLUMN, PIE, SCATTER, AREA, COMBO, etc.',
    },
    suggest_chart: {
      required: ['spreadsheetId', 'range'],
      optional: ['maxSuggestions'],
      description: 'AI-powered chart type suggestions based on data shape.',
    },
    chart_update: {
      required: ['spreadsheetId', 'chartId'],
      optional: ['chartType', 'data', 'position', 'options'],
      description: 'Update chart properties, data range, or position.',
    },
    chart_delete: {
      required: ['spreadsheetId', 'chartId'],
      description: 'Delete a chart.',
    },
    chart_list: {
      required: ['spreadsheetId'],
      optional: ['sheetId'],
      description: 'List all charts in the spreadsheet or a specific sheet.',
    },
    chart_get: {
      required: ['spreadsheetId', 'chartId'],
      description: 'Get chart details by ID.',
    },
    chart_move: {
      required: ['spreadsheetId', 'chartId', 'position'],
      description: 'Move a chart to a new position.',
    },
    chart_resize: {
      required: ['spreadsheetId', 'chartId', 'width', 'height'],
      description: 'Resize a chart in pixels.',
    },
    chart_update_data_range: {
      required: ['spreadsheetId', 'chartId', 'data'],
      description: 'Update only the data range of a chart.',
    },
    chart_add_trendline: {
      required: ['spreadsheetId', 'chartId', 'trendline'],
      optional: ['seriesIndex'],
      description: 'Add a trendline to a chart series.',
    },
    chart_remove_trendline: {
      required: ['spreadsheetId', 'chartId'],
      optional: ['seriesIndex'],
      description: 'Remove a trendline from a chart series.',
    },
    pivot_create: {
      required: ['spreadsheetId', 'sourceRange', 'values'],
      optional: ['rows', 'columns', 'filters', 'destinationSheetId', 'destinationCell'],
      description: 'Create a pivot table from a data range.',
    },
    suggest_pivot: {
      required: ['spreadsheetId', 'range'],
      optional: ['maxSuggestions'],
      description: 'AI-powered pivot table configuration suggestions.',
    },
    pivot_update: {
      required: ['spreadsheetId', 'sheetId'],
      optional: ['rows', 'columns', 'values', 'filters'],
      description: 'Update pivot table configuration.',
    },
    pivot_delete: {
      required: ['spreadsheetId', 'sheetId'],
      description: 'Delete a pivot table.',
    },
    pivot_list: {
      required: ['spreadsheetId'],
      description: 'List all pivot tables.',
    },
    pivot_get: {
      required: ['spreadsheetId', 'sheetId'],
      description: 'Get pivot table details.',
    },
    pivot_refresh: {
      required: ['spreadsheetId', 'sheetId'],
      description: 'Refresh a pivot table (recalculate from source data).',
    },
  },
  sheets_composite: {
    import_csv: {
      required: ['spreadsheetId', 'csvData'],
      optional: ['sheet', 'delimiter', 'hasHeader', 'mode', 'newSheetName'],
      description: 'Import CSV data. mode: replace (default), append, or new_sheet.',
    },
    smart_append: {
      required: ['spreadsheetId', 'data', 'sheet'],
      description: 'Append data matching existing column headers (auto-maps columns).',
    },
    bulk_update: {
      required: ['spreadsheetId', 'keyColumn', 'sheet', 'updates'],
      description: 'Update rows by matching a key column. updates: array of row objects.',
    },
    deduplicate: {
      required: ['spreadsheetId', 'keyColumns', 'sheet'],
      optional: ['keep'],
      description: 'Remove duplicate rows. keep: first (default) or last.',
    },
    export_xlsx: {
      required: ['spreadsheetId'],
      description: 'Export spreadsheet as XLSX (Excel) file.',
    },
    import_xlsx: {
      required: ['fileContent'],
      optional: ['title', 'destinationFolderId'],
      description: 'Import an XLSX file as a new spreadsheet. fileContent is base64.',
    },
    get_form_responses: {
      required: ['spreadsheetId'],
      description: 'Read Google Forms responses linked to this spreadsheet.',
    },
    setup_sheet: {
      required: ['spreadsheetId'],
      optional: ['sheetName', 'headers', 'formatting', 'validations', 'sampleData'],
      description:
        'Create and configure a new sheet in one operation (headers, formatting, validation).',
    },
    import_and_format: {
      required: ['spreadsheetId', 'data'],
      description: 'Import data with auto-detection of types and format application.',
    },
    clone_structure: {
      required: ['spreadsheetId'],
      optional: ['targetSpreadsheetId', 'includeFormatting', 'includeValidation'],
      description: 'Clone sheet structure (headers, formatting, validation) without data.',
    },
    export_large_dataset: {
      required: ['spreadsheetId', 'range'],
      optional: ['format', 'chunkSize'],
      description: 'Stream-export a large range as CSV or JSON.',
    },
    audit_sheet: {
      required: ['spreadsheetId'],
      optional: ['sheetId', 'sheetName'],
      description: 'Run a comprehensive audit (formulas, formatting, data quality).',
    },
    publish_report: {
      required: ['spreadsheetId'],
      optional: ['range', 'format', 'template'],
      description: 'Export a sheet/range as a formatted report (HTML, PDF, etc.).',
    },
    data_pipeline: {
      required: ['spreadsheetId', 'steps'],
      description: 'Execute a multi-step data pipeline (read → transform → write).',
    },
    instantiate_template: {
      required: ['templateId'],
      optional: ['title', 'variables', 'destinationFolderId'],
      description: 'Create a spreadsheet from a saved template with variable substitution.',
    },
    migrate_spreadsheet: {
      required: ['spreadsheetId', 'targetSpreadsheetId'],
      optional: ['sheets', 'includeFormatting', 'includeFormulas'],
      description: 'Migrate sheets between spreadsheets with structure preservation.',
    },
    generate_sheet: {
      required: ['description'],
      optional: ['context', 'style', 'spreadsheetId', 'sheetName'],
      description: 'AI-generate a structured spreadsheet from a natural language description.',
    },
    generate_template: {
      required: ['description'],
      optional: ['parameterize'],
      description: 'AI-generate a reusable template definition from a description.',
    },
    preview_generation: {
      required: ['description'],
      description: 'Dry-run: preview proposed sheet structure without creating it.',
    },
    batch_operations: {
      required: ['spreadsheetId', 'operations'],
      optional: ['stopOnError'],
      description: 'Execute multiple ServalSheets actions in a single tool call.',
    },
    build_dashboard: {
      required: ['spreadsheetId'],
      optional: ['kpiRows', 'charts', 'slicers', 'layout'],
      description: 'Build a dashboard sheet with KPIs, charts, and slicers.',
    },
  },
  sheets_bigquery: {
    connect: {
      required: ['spreadsheetId', 'spec'],
      optional: ['sheetId', 'sheetName'],
      description:
        'Connect a BigQuery data source to a sheet. spec: { projectId, datasetId, tableId }.',
    },
    connect_looker: {
      required: ['spreadsheetId', 'spec'],
      optional: ['sheetId', 'sheetName'],
      description: 'Connect a Looker data source to a sheet.',
    },
    disconnect: {
      required: ['spreadsheetId', 'dataSourceId'],
      description: 'Disconnect a data source from a sheet.',
    },
    list_connections: {
      required: ['spreadsheetId'],
      description: 'List all BigQuery/Looker data source connections.',
    },
    get_connection: {
      required: ['spreadsheetId', 'dataSourceId'],
      description: 'Get connection details by data source ID.',
    },
    query: {
      required: ['spreadsheetId', 'projectId', 'query'],
      optional: ['dataSourceId', 'sheetId', 'maxResults', 'timeoutMs', 'dryRun', 'location'],
      description: 'Run a BigQuery SQL query and write results to a sheet.',
    },
    preview: {
      required: ['projectId', 'query'],
      optional: ['maxRows', 'estimateCost', 'timeoutMs', 'dryRun', 'location'],
      description: 'Preview a BigQuery query (results + cost estimate). No spreadsheet needed.',
    },
    refresh: {
      required: ['spreadsheetId', 'dataSourceId'],
      optional: ['force'],
      description: 'Refresh a connected data source.',
    },
    cancel_refresh: {
      required: ['spreadsheetId', 'dataSourceId'],
      description: 'Cancel an in-progress data source refresh.',
    },
    list_datasets: {
      required: ['projectId'],
      optional: ['maxResults'],
      description: 'List BigQuery datasets in a GCP project.',
    },
    list_tables: {
      required: ['projectId', 'datasetId'],
      optional: ['maxResults'],
      description: 'List tables in a BigQuery dataset.',
    },
    get_table_schema: {
      required: ['projectId', 'datasetId', 'tableId'],
      description: 'Get the schema (columns, types) of a BigQuery table.',
    },
    export_to_bigquery: {
      required: ['spreadsheetId', 'range', 'destination'],
      optional: ['writeDisposition', 'headerRows', 'autoDetectSchema'],
      description:
        'Export sheet data to a BigQuery table. destination: { projectId, datasetId, tableId }.',
    },
    import_from_bigquery: {
      required: ['spreadsheetId', 'projectId', 'query'],
      optional: ['sheetId', 'sheetName', 'startCell', 'includeHeaders', 'maxResults'],
      description: 'Import BigQuery query results into a sheet.',
    },
    create_scheduled_query: {
      required: ['projectId', 'query', 'displayName', 'schedule'],
      optional: ['destinationDatasetId', 'destinationTableId', 'location'],
      description: 'Create a scheduled BigQuery query (e.g. "every 24 hours").',
    },
    list_scheduled_queries: {
      required: ['projectId'],
      optional: ['location', 'maxResults'],
      description: 'List scheduled queries in a project.',
    },
    delete_scheduled_query: {
      required: ['transferConfigName'],
      description: 'Delete a scheduled query by transfer config name.',
    },
  },
  sheets_analyze: {
    comprehensive: {
      required: ['spreadsheetId'],
      optional: ['range', 'sheetName', 'depth', 'focusAreas'],
      description:
        'Full AI-powered analysis of a spreadsheet (43 feature categories). Omit range to analyze the whole workbook. Use depth="quick" for fast scan, depth="full" for deep analysis including formula evaluation and data profiling.',
    },
    scout: {
      required: ['spreadsheetId'],
      optional: ['sheetName'],
      description:
        'Fast ~200ms structural scan — use before comprehensive to get column types, row counts, and formula presence without loading all data.',
    },
    suggest_next_actions: {
      required: ['spreadsheetId'],
      optional: ['range', 'maxSuggestions', 'categories'],
      description:
        'Get ranked, actionable suggestions for the current spreadsheet. Returns executable params for each suggestion. Use categories to filter to formulas, formatting, structure, data_quality, or visualization.',
    },
    query_natural_language: {
      required: ['spreadsheetId', 'query'],
      optional: ['sheetName', 'range'],
      description:
        'Answer a natural-language question about the spreadsheet data. Provide query as a plain English question. Use after comprehensive or scout for context-aware answers.',
    },
    analyze_data: {
      required: ['spreadsheetId', 'range'],
      optional: ['analysisType', 'includeFormulas'],
      description:
        'Statistical analysis of a data range. analysisType can be "summary", "distribution", "correlation", or "outliers".',
    },
  },
  sheets_fix: {
    clean: {
      required: ['spreadsheetId', 'range'],
      optional: ['rules', 'mode'],
      description:
        'Auto-detect and fix data quality issues in a range (whitespace, type mismatches, duplicates, format inconsistencies). Use mode="preview" to see proposed changes before applying, mode="apply" to write fixes.',
    },
    fix: {
      required: ['spreadsheetId'],
      optional: ['range', 'issues'],
      description:
        'Apply specific fixes identified by sheets_quality.validate. Pass issues from a prior validate call to target only known problems.',
    },
    standardize_formats: {
      required: ['spreadsheetId', 'range'],
      optional: ['columns', 'targetFormats'],
      description:
        'Normalize inconsistent formats in a range (dates, currencies, phone numbers, emails). Specify columns with targetFormats to control output format per column.',
    },
    fill_missing: {
      required: ['spreadsheetId', 'range', 'strategy'],
      optional: ['constantValue', 'columns'],
      description:
        'Fill empty cells using a strategy: "forward" (propagate last value down), "backward" (propagate next value up), "mean", "median", "mode", or "constant" (requires constantValue).',
    },
    detect_anomalies: {
      required: ['spreadsheetId', 'range'],
      optional: ['method', 'threshold', 'columns'],
      description:
        'Flag statistical outliers in numeric columns. method can be "iqr" (interquartile range, default), "zscore" (z-score with configurable threshold), or "isolation_forest".',
    },
    suggest_cleaning: {
      required: ['spreadsheetId', 'range'],
      optional: ['maxSuggestions'],
      description:
        'AI-powered cleaning recommendations (uses MCP Sampling). Returns prioritized list of cleaning steps with rationale and estimated impact. No data is written.',
    },
  },
  sheets_confirm: {
    request: {
      required: ['action', 'description'],
      optional: ['impact', 'spreadsheetId', 'timeoutMs'],
      description:
        'Create a confirmation request for a potentially destructive operation. Returns a confirmationToken — pass it to the action that requires confirmation.',
    },
    wizard_start: {
      required: ['wizardType'],
      optional: ['spreadsheetId', 'context'],
      description:
        'Start a multi-step interactive wizard. wizardType specifies which wizard flow to run (e.g. "chart_creation", "data_import", "format_preset").',
    },
    wizard_step: {
      required: ['wizardId', 'stepResponse'],
      optional: [],
      description:
        'Advance a running wizard with the user response to the current step. wizardId comes from wizard_start. stepResponse is the value provided for the current prompt.',
    },
    wizard_complete: {
      required: ['wizardId'],
      optional: [],
      description:
        'Finalize a completed wizard and execute the configured action. Call after all wizard steps are answered.',
    },
    get_stats: {
      required: [],
      optional: ['since'],
      description:
        'Get confirmation request statistics (total, approved, rejected, expired). Use since (ISO timestamp) to filter to a time window.',
    },
  },
  sheets_quality: {
    validate: {
      required: ['spreadsheetId', 'range'],
      optional: ['validationRules', 'sheetName', 'includeWarnings'],
      description:
        'Validate a data range against rules (required fields, type constraints, format patterns, value ranges). Returns violations with row/column references. Pass results to sheets_fix.fix to auto-remediate.',
    },
    detect_conflicts: {
      required: ['spreadsheetId'],
      optional: ['range', 'sheetName', 'windowSeconds'],
      description:
        'Detect concurrent modification conflicts in a spreadsheet. windowSeconds controls how far back to look (default 60s). Returns conflicting changes with user attribution.',
    },
    resolve_conflict: {
      required: ['spreadsheetId', 'conflictId', 'resolution'],
      optional: ['sheetName'],
      description:
        'Resolve a detected conflict. resolution can be "accept_mine", "accept_theirs", or "merge". conflictId comes from detect_conflicts.',
    },
    analyze_impact: {
      required: ['spreadsheetId', 'range'],
      optional: ['changeType', 'sheetName'],
      description:
        'Analyze the downstream impact of modifying a range before committing changes. Returns affected formulas, dependent ranges, and risk level.',
    },
  },
  sheets_transaction: {
    begin: {
      required: ['spreadsheetId'],
      optional: ['description', 'autoRollback', 'autoSnapshot', 'isolationLevel'],
      description:
        'Start a transaction. Returns a transactionId — pass it to subsequent queue calls. Set autoSnapshot=true to create a backup before any mutations. autoRollback=true (default) rolls back automatically on failure.',
    },
    queue: {
      required: ['transactionId', 'tool', 'action', 'params'],
      optional: [],
      description:
        'Queue an operation inside a transaction. tool is the MCP tool name (e.g. "sheets_data"), action is the action name, params is the operation input. Operations execute in order at commit.',
    },
    commit: {
      required: ['transactionId'],
      optional: [],
      description:
        'Execute all queued operations atomically and close the transaction. Returns per-operation results.',
    },
    rollback: {
      required: ['transactionId'],
      optional: [],
      description:
        'Discard all queued operations and close the transaction without writing any changes.',
    },
    abort: {
      required: ['transactionId'],
      optional: ['reason'],
      description:
        'Abort a transaction with an optional reason. Equivalent to rollback but records the abort reason in the audit trail.',
    },
    status: {
      required: ['transactionId'],
      optional: [],
      description:
        'Get the current state of a transaction (OPEN, COMMITTED, ROLLED_BACK, ABORTED) and the list of queued operations.',
    },
  },
  sheets_templates: {
    list: {
      required: [],
      optional: ['category', 'maxResults'],
      description:
        'List available templates from the Drive appDataFolder. Use category to filter (e.g. "finance", "project", "hr").',
    },
    get: {
      required: ['templateId'],
      optional: [],
      description: 'Get template definition including structure, variables, and metadata.',
    },
    create: {
      required: ['spreadsheetId', 'name'],
      optional: ['description', 'category', 'variables', 'sheetNames'],
      description:
        'Save the current spreadsheet as a reusable template. Specify variables for token substitution (e.g. {{COMPANY_NAME}}).',
    },
    instantiate: {
      required: ['templateId'],
      optional: ['variables', 'targetSpreadsheetId', 'title'],
      description:
        'Create a new spreadsheet from a template. Pass variables as key-value pairs for token substitution. Omit targetSpreadsheetId to create a new spreadsheet.',
    },
    apply: {
      required: ['templateId', 'spreadsheetId'],
      optional: ['variables', 'sheetName', 'overwrite'],
      description:
        'Apply a template to an existing spreadsheet (overlay structure and formatting). Use overwrite=false to skip sheets that already exist.',
    },
  },
  sheets_agent: {
    plan: {
      required: ['goal', 'spreadsheetId'],
      optional: ['maxSteps', 'context', 'constraints'],
      description:
        'Compile a natural-language goal into an executable multi-step plan. Returns a planId and the full step list for review before execution. Always pass context (scout output or sheet description) — informed plans cut step count materially versus having the agent rediscover structure. Use maxSteps (default 10, max 50) to limit plan size.',
    },
    execute: {
      required: ['planId'],
      optional: ['startStep', 'dryRun', 'checkpointAfterEach'],
      description:
        'Execute a compiled plan autonomously. Each step is validated by AI reflexion before the next step runs. Use observe() to create a rollback checkpoint before executing destructive operations. Use dryRun=true to preview without writing. Returns per-step results and overall status.',
    },
    execute_step: {
      required: ['planId', 'stepIndex'],
      optional: ['dryRun'],
      description:
        'Execute a single step of a plan manually. Use for step-by-step control when execute is too autonomous.',
    },
    get_plan: {
      required: ['planId'],
      optional: [],
      description:
        'Get the full plan definition and current execution state (step statuses, outputs).',
    },
    list_plans: {
      required: [],
      optional: ['status', 'spreadsheetId', 'maxResults'],
      description:
        'List plans filtered by status (DRAFT, EXECUTING, COMPLETED, PAUSED, FAILED) or spreadsheetId.',
    },
    abort_plan: {
      required: ['planId'],
      optional: ['reason'],
      description:
        'Abort a running or paused plan. Completed steps are not rolled back — use sheets_transaction for atomic execution.',
    },
    get_checkpoint: {
      required: ['planId', 'checkpointId'],
      optional: [],
      description: 'Get saved state from a plan checkpoint for resumability or debugging.',
    },
    create_checkpoint: {
      required: ['planId'],
      optional: ['label'],
      description: 'Manually save a checkpoint at the current plan execution state.',
    },
  },
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function truncateDescription(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}...`;
}

function isHintEnumValue(value: unknown): value is HintEnumValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function dereference(root: JsonRecord, ref: string): JsonRecord | null {
  if (!ref.startsWith('#/')) {
    return null;
  }

  let current: unknown = root;
  for (const segment of ref.slice(2).split('/').map(decodeJsonPointerSegment)) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    current = (current as JsonRecord)[segment];
  }

  return asRecord(current);
}

function resolveSchemaNode(
  node: unknown,
  root: JsonRecord,
  seenRefs: Set<string> = new Set()
): JsonRecord | null {
  const record = asRecord(node);
  if (!record) {
    return null;
  }

  const ref = record['$ref'];
  if (typeof ref !== 'string') {
    return record;
  }

  if (seenRefs.has(ref)) {
    return record;
  }

  const resolved = dereference(root, ref);
  if (!resolved) {
    return record;
  }

  const nextSeenRefs = new Set(seenRefs);
  nextSeenRefs.add(ref);
  return resolveSchemaNode(resolved, root, nextSeenRefs) ?? resolved;
}

function inferTypeFromEnum(values: HintEnumValue[]): string | undefined {
  if (values.length === 0) {
    return undefined; // OK: Explicit empty — empty array input
  }

  const distinctTypes = new Set(values.map((value) => (value === null ? 'null' : typeof value)));
  if (distinctTypes.size !== 1) {
    return undefined; // OK: Explicit empty — mixed types, cannot infer
  }

  return [...distinctTypes][0];
}

function readSchemaType(schema: JsonRecord): string | undefined {
  const typeValue = schema['type'];
  if (typeof typeValue === 'string') {
    return typeValue;
  }

  if (Array.isArray(typeValue)) {
    const parts = typeValue.filter((entry): entry is string => typeof entry === 'string');
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }

  if (asRecord(schema['properties'])) {
    return 'object';
  }

  if (schema['items'] !== undefined) {
    return 'array';
  }

  return undefined; // OK: Explicit empty — unrecognized JSON Schema type node
}

function summarizeSchemaNode(
  node: unknown,
  root: JsonRecord,
  depth = 0,
  seenRefs: Set<string> = new Set()
): ParamSchemaHint | undefined {
  const schema = resolveSchemaNode(node, root, seenRefs);
  if (!schema) {
    return undefined; // OK: Explicit empty — schema node could not be resolved
  }

  const hint: ParamSchemaHint = {};
  const enumValues = Array.isArray(schema['enum'])
    ? schema['enum'].filter(isHintEnumValue).slice(0, MAX_ENUM_VALUES)
    : [];
  const constValue = isHintEnumValue(schema['const']) ? [schema['const']] : [];
  const summarizedEnum = enumValues.length > 0 ? enumValues : constValue;

  const type = readSchemaType(schema) ?? inferTypeFromEnum(summarizedEnum);
  if (type) {
    hint.type = type;
  }

  if (summarizedEnum.length > 0) {
    hint.enum = summarizedEnum;
  }

  if (typeof schema['description'] === 'string' && schema['description'].trim().length > 0) {
    hint.description = truncateDescription(schema['description']);
  }

  if (depth < MAX_SUMMARY_DEPTH) {
    const required = Array.isArray(schema['required'])
      ? (schema['required'] as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .slice(0, MAX_NESTED_FIELDS)
      : [];
    if (required.length > 0) {
      hint.required = required;
    }

    const properties = asRecord(schema['properties']);
    if (properties) {
      const propertyHints: Record<string, ParamSchemaHint> = {};
      for (const [key, value] of Object.entries(properties).slice(0, MAX_NESTED_FIELDS)) {
        const nested = summarizeSchemaNode(value, root, depth + 1, seenRefs);
        if (nested) {
          propertyHints[key] = nested;
        }
      }

      if (Object.keys(propertyHints).length > 0) {
        hint.properties = propertyHints;
      }
    }

    if (schema['items'] !== undefined) {
      const items = summarizeSchemaNode(schema['items'], root, depth + 1, seenRefs);
      if (items) {
        hint.items = items;
      }
    }
  }

  return Object.keys(hint).length > 0 ? hint : undefined;
}

function getSchemaVariants(schema: JsonRecord): JsonRecord[] {
  const directAction = getActionName(schema);
  if (directAction) {
    return [schema];
  }

  const variants: JsonRecord[] = [];
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const entries = schema[key];
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      variants.push(...getSchemaVariants(record));
    }
  }

  return variants;
}

function getActionName(schema: JsonRecord): string | null {
  const properties = asRecord(schema['properties']);
  const actionSchema = asRecord(properties?.['action']);
  if (!actionSchema) {
    return null;
  }

  const constValue = actionSchema['const'];
  if (typeof constValue === 'string') {
    return constValue;
  }

  const enumValues = Array.isArray(actionSchema['enum']) ? actionSchema['enum'] : undefined;
  if (enumValues?.length === 1 && typeof enumValues[0] === 'string') {
    return enumValues[0];
  }

  return null;
}

function getRequiredFields(schema: JsonRecord): string[] {
  return Array.isArray(schema['required'])
    ? (schema['required'] as unknown[])
        .filter((value): value is string => typeof value === 'string' && value !== 'action')
        .sort()
    : [];
}

function getOptionalFields(schema: JsonRecord, required: string[]): string[] {
  const properties = asRecord(schema['properties']);
  if (!properties) {
    return [];
  }

  return Object.keys(properties)
    .filter((key) => key !== 'action' && !required.includes(key))
    .sort();
}

function pickParamHints(
  root: JsonRecord,
  properties: JsonRecord | null,
  paramNames: string[],
  existing?: Record<string, ParamSchemaHint>
): Record<string, ParamSchemaHint> | undefined {
  const params: Record<string, ParamSchemaHint> = {};

  for (const paramName of paramNames) {
    const paramSchema = properties?.[paramName];
    if (paramSchema !== undefined) {
      const hint = summarizeSchemaNode(paramSchema, root);
      if (hint) {
        params[paramName] = hint;
        continue;
      }
    }

    if (existing?.[paramName]) {
      params[paramName] = existing[paramName]!;
    }
  }

  return Object.keys(params).length > 0 || paramNames.length === 0 ? params : undefined;
}

function applyActionHintOverrides(
  toolName: string,
  actionParams: Record<string, ActionParamHint>,
  root: JsonRecord,
  requestSchema: JsonRecord
): Record<string, ActionParamHint> {
  const overrides = ACTION_HINT_OVERRIDES[toolName];
  if (!overrides) {
    return actionParams;
  }

  const requestProperties = asRecord(requestSchema['properties']);
  const merged: Record<string, ActionParamHint> = { ...actionParams };

  for (const [action, override] of Object.entries(overrides)) {
    const current = merged[action] ?? { required: [] };
    const required = override.required ?? current.required ?? [];
    const requiredOneOf = override.requiredOneOf ?? current.requiredOneOf;
    const params =
      override.params !== undefined
        ? pickParamHints(root, requestProperties, override.params, current.params)
        : current.params;

    const conditionallyRequired = new Set((requiredOneOf ?? []).flat());
    const optional =
      override.optional ??
      (override.params !== undefined
        ? override.params.filter(
            (param) => !required.includes(param) && !conditionallyRequired.has(param)
          )
        : current.optional);

    merged[action] = {
      ...current,
      ...(override.description ? { description: override.description } : {}),
      required,
      ...(requiredOneOf && requiredOneOf.length > 0 ? { requiredOneOf } : {}),
      ...(optional && optional.length > 0 ? { optional } : {}),
      ...(params ? { params } : {}),
    };
  }

  return merged;
}

function getRequirementPreview(hint: ActionParamHint): string[] {
  const preview = [...hint.required];
  if (hint.requiredOneOf) {
    preview.push(...hint.requiredOneOf.map((group) => group.join(' or ')));
  }
  return preview;
}

function formatActionSummary(action: string, hint: ActionParamHint): string {
  const preview = getRequirementPreview(hint);
  if (preview.length === 0) {
    return `${action}(no extra required fields)`;
  }
  return `${action}(${preview.join(', ')})`;
}

function buildRequestDescription(actionParams: Record<string, ActionParamHint>): string {
  const entries = Object.entries(actionParams);
  if (entries.length === 0) {
    return 'Action-specific required fields and compact param hints are exposed inline in x-servalsheets.actionParams.';
  }

  const preview = entries.slice(0, 10).map(([action, hint]) => formatActionSummary(action, hint));
  const summary = `Required fields by action: ${preview.join('; ')}.`;

  if (entries.length <= 10) {
    return `${summary} Full map, including compact param types/enums, is also available in x-servalsheets.actionParams.`;
  }

  return `${summary} Showing 10 of ${entries.length} actions. Full map, including compact param types/enums, is in x-servalsheets.actionParams.`;
}

function buildDescriptionSuffix(): string {
  return 'Required params by action and compact param types/enums are inline in the input schema request description and x-servalsheets.actionParams.';
}

function buildToolDiscoveryHint(tool: ToolDefinition): ToolDiscoveryHint | null {
  const jsonSchema = zodSchemaToJsonSchema(tool.inputSchema);
  const root = asRecord(jsonSchema);
  if (!root) {
    return null;
  }
  const properties = asRecord(root['properties']);
  const requestSchema = asRecord(properties?.['request']);
  if (!requestSchema) {
    return null;
  }

  const variants = getSchemaVariants(requestSchema);
  const actionParams: Record<string, ActionParamHint> = {};
  for (const variant of variants) {
    const action = getActionName(variant);
    if (!action || actionParams[action]) {
      continue;
    }

    const propertiesForVariant = asRecord(variant['properties']);
    const actionSchema = asRecord(propertiesForVariant?.['action']);
    const required = getRequiredFields(variant);
    const optional = getOptionalFields(variant, required);
    const params: Record<string, ParamSchemaHint> = {};

    for (const [paramName, paramSchema] of Object.entries(propertiesForVariant ?? {})) {
      if (paramName === 'action') {
        continue;
      }

      const hint = summarizeSchemaNode(paramSchema, root);
      if (hint) {
        params[paramName] = hint;
      }
    }

    actionParams[action] = {
      ...(typeof actionSchema?.['description'] === 'string' && {
        description: actionSchema['description'],
      }),
      required,
      ...(optional.length > 0 && { optional }),
      ...(Object.keys(params).length > 0 && { params }),
    };
  }

  const enrichedActionParams = applyActionHintOverrides(
    tool.name,
    actionParams,
    root,
    requestSchema
  );

  if (Object.keys(enrichedActionParams).length === 0) {
    return null;
  }

  return {
    actionParams: enrichedActionParams,
    requestDescription: buildRequestDescription(enrichedActionParams),
    descriptionSuffix: buildDescriptionSuffix(),
  };
}

export function getToolDiscoveryHint(toolName: string): ToolDiscoveryHint | null {
  let baseHint: ToolDiscoveryHint | null;
  if (discoveryHintCache.has(toolName)) {
    baseHint = discoveryHintCache.get(toolName) ?? null;
  } else {
    const tool = TOOL_DEFINITIONS.find((definition) => definition.name === toolName);
    baseHint = tool ? buildToolDiscoveryHint(tool) : null;
    discoveryHintCache.set(toolName, baseHint);
  }

  if (!baseHint) {
    return null;
  }

  const allowedActions = new Set(
    filterAvailableActions(toolName, Object.keys(baseHint.actionParams))
  );
  const filteredActionParams = Object.fromEntries(
    Object.entries(baseHint.actionParams).filter(([action]) => allowedActions.has(action))
  );

  if (Object.keys(filteredActionParams).length === Object.keys(baseHint.actionParams).length) {
    return baseHint;
  }

  return {
    actionParams: filteredActionParams,
    requestDescription: buildRequestDescription(filteredActionParams),
    descriptionSuffix: baseHint.descriptionSuffix,
  };
}

export function clearDiscoveryHintCache(): void {
  discoveryHintCache.clear();
}
