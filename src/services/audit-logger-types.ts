/**
 * Shared type definitions for compliance-grade audit logging.
 */

/**
 * W5 Audit Event (Who, What, When, Where, Why)
 */
export interface AuditEvent {
  // WHO: Identity and authentication
  userId: string; // User identifier (email, sub claim, API key ID)
  sessionId?: string; // Session identifier for correlation
  clientId?: string; // OAuth client ID
  apiKeyId?: string; // API key identifier (not the key itself)

  // WHAT: Action and outcome
  action: string; // Action performed (e.g., 'write_range', 'share_spreadsheet')
  tool?: string; // MCP tool invoked (e.g., 'sheets_data')
  resource: AuditResource; // Resource affected
  outcome: 'success' | 'failure' | 'partial'; // Operation result
  errorCode?: string; // Error code if outcome is failure
  errorMessage?: string; // Error message (sanitized, no PII)

  // WHEN: Temporal context
  timestamp: string; // ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)
  durationMs?: number; // Operation duration in milliseconds

  // WHERE: Location and network
  ipAddress: string; // Source IP address (IPv4 or IPv6)
  geoLocation?: string; // Geographic location (city, country)
  userAgent?: string; // User agent string
  endpoint?: string; // API endpoint invoked

  // WHY: Business context
  requestId: string; // Request ID for correlation with application logs
  scopes?: string[]; // OAuth scopes granted
  reason?: string; // Business justification (e.g., 'emergency access')

  // Additional metadata
  metadata?: Record<string, unknown>; // Extensible metadata
}

/**
 * Resource identifier (spreadsheet, range, permission, etc.)
 */
export interface AuditResource {
  type: 'spreadsheet' | 'range' | 'permission' | 'token' | 'config' | 'export';
  spreadsheetId?: string;
  spreadsheetName?: string;
  range?: string;
  sheetId?: string;
  sheetName?: string;
  [key: string]: unknown; // Extensible
}

/**
 * Data mutation event (create, update, delete)
 */
export interface MutationEvent extends AuditEvent {
  action:
    | 'write'
    | 'append'
    | 'clear'
    | 'batch_write'
    | 'batch_clear'
    | 'cross_write'
    | 'import_csv'
    | 'import_xlsx'
    | 'smart_append'
    | 'smart_fill'
    | 'clean'
    | 'standardize_formats'
    | 'fill_missing'
    | 'bulk_update'
    | 'deduplicate'
    | 'setup_sheet'
    | 'import_and_format'
    | 'clone_structure'
    | 'generate_sheet'
    | 'generate_template'
    | 'batch_operations'
    | 'data_pipeline'
    | 'instantiate_template'
    | 'migrate_spreadsheet'
    | 'cut_paste'
    | 'copy_paste'
    | 'find_replace'
    | 'merge_cells'
    | 'unmerge_cells'
    | 'set_hyperlink'
    | 'clear_hyperlink'
    | 'add_note'
    | 'clear_note'
    | 'delete_sheet'
    | 'batch_delete_sheets'
    | 'clear_sheet'
    | 'insert'
    | 'delete'
    | 'move'
    | 'resize'
    | 'hide'
    | 'show'
    | 'freeze'
    | 'group'
    | 'ungroup'
    | 'trim_whitespace'
    | 'text_to_columns'
    | 'randomize_range'
    | 'set_basic_filter'
    | 'clear_basic_filter'
    | 'sort_range'
    | 'create_filter_view'
    | 'update_filter_view'
    | 'delete_filter_view'
    | 'create_slicer'
    | 'update_slicer'
    | 'delete_slicer'
    | 'auto_fill'
    | 'set_format'
    | 'set_background'
    | 'set_text_format'
    | 'set_number_format'
    | 'set_alignment'
    | 'set_borders'
    | 'clear_format'
    | 'apply_preset'
    | 'batch_format'
    | 'set_data_validation'
    | 'clear_data_validation'
    | 'add_conditional_format_rule'
    | 'rule_add_conditional_format'
    | 'rule_update_conditional_format'
    | 'rule_delete_conditional_format'
    | 'set_rich_text'
    | 'sparkline_add'
    | 'sparkline_clear';
  cellsModified?: number;
  rowsModified?: number;
  columnsModified?: number;
  snapshot?: string;
}

/**
 * Permission change event
 */
export interface PermissionEvent extends AuditEvent {
  action:
    | 'share_add'
    | 'share_update'
    | 'share_remove'
    | 'share_transfer_ownership'
    | 'share_set_link';
  permission: {
    role: 'owner' | 'writer' | 'reader';
    email?: string;
    domain?: string;
    anyone?: boolean;
  };
}

/**
 * Authentication event
 */
export interface AuthenticationEvent extends AuditEvent {
  action:
    | 'login'
    | 'logout'
    | 'token_refresh'
    | 'token_revoke'
    | 'oauth_grant'
    | 'authenticate'
    | 'refresh_token'
    | 'revoke_token'
    | 'service_account_auth';
  method: 'oauth' | 'api_key' | 'service_account' | 'managed_identity';
  failureReason?: string;
}

/**
 * Configuration change event
 */
export interface ConfigurationEvent extends AuditEvent {
  action: 'update_env' | 'toggle_feature' | 'adjust_rate_limit' | 'update_webhook';
  configKey: string;
  oldValue?: string;
  newValue?: string;
}

/**
 * Export event (data extraction)
 */
export interface ExportEvent extends AuditEvent {
  action:
    | 'export_csv'
    | 'export_xlsx'
    | 'export_pdf'
    | 'publish_report'
    | 'export_bigquery'
    | 'export_to_bigquery'
    | 'download_attachment';
  format?: string;
  recordCount?: number;
  fileSize?: number;
  destination?: string;
}

/**
 * Signed audit entry (immutable with cryptographic integrity)
 */
export interface SignedAuditEntry {
  sequenceNumber: number;
  event: AuditEvent;
  hash: string;
  previousHash: string;
}

/**
 * SIEM destination configuration
 */
export interface SiemConfig {
  type: 'splunk' | 'datadog' | 'cloudwatch' | 'azure';
  endpoint: string;
  token?: string;
  apiKey?: string;
  region?: string;
  logGroup?: string;
  logStream?: string;
}
