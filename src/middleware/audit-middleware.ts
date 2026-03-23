/**
 * Audit Middleware
 *
 * Automatically logs audit events for all MCP tool calls.
 * Integrates with request context for correlation.
 *
 * ## Audit Coverage
 *
 * **Data Mutations** (sheets_data, sheets_dimensions, sheets_format):
 * - All write operations (write, append, clear, batch_write)
 * - All structural changes (insert, delete, move, resize)
 * - All formatting operations (set_format, batch_format, clear_format)
 *
 * **Permission Changes** (sheets_collaborate):
 * - Sharing spreadsheets (share_add, share_update, share_remove)
 * - Updating permissions (share_set_link)
 * - Revoking access (share_remove)
 *
 * **Authentication** (sheets_auth):
 * - Login attempts (authenticate)
 * - Token refresh (refresh_token)
 * - Token revocation (revoke_token)
 *
 * **Exports** (sheets_data, sheets_bigquery):
 * - CSV exports (export_csv)
 * - XLSX exports (export_xlsx)
 * - BigQuery exports (export_to_bigquery)
 *
 * ## Usage
 *
 * ```typescript
 * import { createAuditMiddleware } from './middleware/audit-middleware.js';
 * import { getAuditLogger } from './services/audit-logger.js';
 *
 * const auditLogger = getAuditLogger();
 * const auditMiddleware = createAuditMiddleware(auditLogger);
 *
 * // Wrap handler execution
 * const result = await auditMiddleware.wrap(
 *   toolName,
 *   action,
 *   args,
 *   () => handler.executeAction(args)
 * );
 * ```
 *
 * ## Request Context Integration
 *
 * The middleware automatically extracts context from AsyncLocalStorage:
 * - Request ID (for correlation with application logs)
 * - User ID (from authentication context)
 * - IP address (from HTTP request)
 * - User agent (from HTTP headers)
 * - OAuth scopes (from token claims)
 */

import type {
  AuditLogger,
  MutationEvent,
  PermissionEvent,
  AuthenticationEvent,
  ExportEvent,
  ConfigurationEvent,
} from '../services/audit-logger.js';
import { getRequestContext } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';

/**
 * Tool actions that trigger audit logging.
 * Names must match the actual action keys dispatched by handler switch statements.
 */
export const MUTATION_ACTIONS = new Set<MutationEvent['action']>([
  // sheets_data — direct data writes
  'write',
  'append',
  'clear',
  'batch_write',
  'batch_clear',
  'cross_write',
  'import_csv',
  'import_xlsx',
  'smart_append',
  'smart_fill',
  // sheets_fix — mutating fixes
  'clean',
  'standardize_formats',
  'fill_missing',
  // sheets_composite — bulk write operations
  'bulk_update',
  'deduplicate',
  'setup_sheet',
  'import_and_format',
  'clone_structure',
  'generate_sheet',
  'generate_template',
  'batch_operations',
  'data_pipeline',
  'instantiate_template',
  'migrate_spreadsheet',
  'cut_paste',
  'copy_paste',
  'find_replace',
  'merge_cells',
  'unmerge_cells',
  'set_hyperlink',
  'clear_hyperlink',
  'add_note',
  'clear_note',

  // sheets_dimensions — structural changes
  'delete_sheet',
  'batch_delete_sheets',
  'clear_sheet',
  'insert',
  'delete',
  'move',
  'resize',
  'hide',
  'show',
  'freeze',
  'group',
  'ungroup',
  'trim_whitespace',
  'text_to_columns',
  'randomize_range',
  'set_basic_filter',
  'clear_basic_filter',
  'sort_range',
  'create_filter_view',
  'update_filter_view',
  'delete_filter_view',
  'create_slicer',
  'update_slicer',
  'delete_slicer',
  'auto_fill',

  // sheets_format — formatting mutations
  'set_format',
  'set_background',
  'set_text_format',
  'set_number_format',
  'set_alignment',
  'set_borders',
  'clear_format',
  'apply_preset',
  'batch_format',
  'set_data_validation',
  'clear_data_validation',
  'add_conditional_format_rule',
  'rule_add_conditional_format',
  'rule_update_conditional_format',
  'rule_delete_conditional_format',
  'set_rich_text',
  'sparkline_add',
  'sparkline_clear',
]);

const PERMISSION_ACTIONS = new Set<PermissionEvent['action']>([
  // sheets_collaborate — actual dispatch names
  'share_add',
  'share_update',
  'share_remove',
  'share_transfer_ownership',
  'share_set_link',
]);

const AUTHENTICATION_ACTIONS = new Set<AuthenticationEvent['action']>([
  'authenticate',
  'refresh_token',
  'revoke_token',
  'oauth_grant',
  'service_account_auth',
]);

const EXPORT_ACTIONS = new Set<ExportEvent['action']>([
  'export_csv',
  'export_xlsx',
  'export_pdf',
  'publish_report',
  'export_to_bigquery',
  'download_attachment',
]);

const CONFIGURATION_ACTIONS = new Set<ConfigurationEvent['action']>([
  'update_env',
  'toggle_feature',
  'adjust_rate_limit',
  'update_webhook',
]);

/**
 * Audit middleware for automatic event logging
 */
export class AuditMiddleware {
  constructor(private auditLogger: AuditLogger) {}

  private isSetAction<T extends string>(set: ReadonlySet<T>, action: string): action is T {
    return set.has(action as T);
  }

  /**
   * Wrap handler execution with audit logging
   */
  async wrap<T>(
    toolName: string,
    action: string,
    args: Record<string, unknown>,
    handler: () => Promise<T>
  ): Promise<T> {
    // Check if action requires audit logging
    if (!this.requiresAudit(action)) {
      return handler();
    }

    const startTime = Date.now();
    const requestContext = getRequestContext();

    // Extract user context
    const userId = this.extractUserId(args);
    const ipAddress = this.extractIpAddress();
    const resource = this.extractResource(action, args);

    let outcome: 'success' | 'failure' | 'partial' = 'success';
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let result: T | undefined;

    try {
      result = await handler();
      return result;
    } catch (error) {
      outcome = 'failure';
      errorCode = error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN';
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const durationMs = Date.now() - startTime;

      // Log appropriate audit event
      try {
        if (this.isSetAction(MUTATION_ACTIONS, action)) {
          await this.auditLogger.logMutation({
            userId,
            action,
            tool: toolName,
            resource,
            outcome,
            errorCode,
            errorMessage,
            ipAddress,
            requestId: requestContext?.requestId ?? 'unknown',
            durationMs,
            userAgent: this.extractUserAgent(),
            scopes: this.extractScopes(args),
            cellsModified: this.extractCellsModified(result),
            rowsModified: this.extractRowsModified(result),
            columnsModified: this.extractColumnsModified(result),
          });
        } else if (this.isSetAction(PERMISSION_ACTIONS, action)) {
          await this.auditLogger.logPermissionChange({
            userId,
            action,
            tool: toolName,
            resource,
            outcome,
            errorCode,
            errorMessage,
            ipAddress,
            requestId: requestContext?.requestId ?? 'unknown',
            durationMs,
            userAgent: this.extractUserAgent(),
            scopes: this.extractScopes(args),
            permission: this.extractPermission(args),
          });
        } else if (this.isSetAction(AUTHENTICATION_ACTIONS, action)) {
          await this.auditLogger.logAuthentication({
            userId,
            action,
            tool: toolName,
            resource,
            outcome,
            errorCode,
            errorMessage,
            ipAddress,
            requestId: requestContext?.requestId ?? 'unknown',
            durationMs,
            userAgent: this.extractUserAgent(),
            method: this.extractAuthMethod(action),
            failureReason: outcome === 'failure' ? errorMessage : undefined,
          });
        } else if (this.isSetAction(EXPORT_ACTIONS, action)) {
          await this.auditLogger.logExport({
            userId,
            action,
            tool: toolName,
            resource,
            outcome,
            errorCode,
            errorMessage,
            ipAddress,
            requestId: requestContext?.requestId ?? 'unknown',
            durationMs,
            userAgent: this.extractUserAgent(),
            scopes: this.extractScopes(args),
            format: this.extractExportFormat(action, args, result),
            recordCount: this.extractRecordCount(result),
            fileSize: this.extractFileSize(result),
          });
        } else if (this.isSetAction(CONFIGURATION_ACTIONS, action)) {
          await this.auditLogger.logConfiguration({
            userId,
            action,
            tool: toolName,
            resource,
            outcome,
            errorCode,
            errorMessage,
            ipAddress,
            requestId: requestContext?.requestId ?? 'unknown',
            durationMs,
            userAgent: this.extractUserAgent(),
            scopes: this.extractScopes(args),
            configKey: this.extractConfigKey(args),
            oldValue: this.extractOldValue(args),
            newValue: this.extractNewValue(args),
          });
        }
      } catch (error) {
        // Don't fail the operation if audit logging fails
        logger.error('Failed to log audit event', {
          error,
          toolName,
          action,
          userId,
        });
      }
    }
  }

  /**
   * Check if action requires audit logging
   */
  private requiresAudit(action: string): boolean {
    return (
      this.isSetAction(MUTATION_ACTIONS, action) ||
      this.isSetAction(PERMISSION_ACTIONS, action) ||
      this.isSetAction(AUTHENTICATION_ACTIONS, action) ||
      this.isSetAction(EXPORT_ACTIONS, action) ||
      this.isSetAction(CONFIGURATION_ACTIONS, action)
    );
  }

  /**
   * Extract user ID from args or context
   */
  private extractUserId(args: Record<string, unknown>): string {
    // Try to extract from args
    if (typeof args['userId'] === 'string') {
      return args['userId'];
    }

    // Try to extract from auth context
    const requestContext = getRequestContext();
    if (requestContext && 'userId' in requestContext) {
      return String(requestContext['userId']);
    }

    // Fallback to 'anonymous'
    return 'anonymous';
  }

  /**
   * Extract IP address from context
   */
  private extractIpAddress(): string {
    const requestContext = getRequestContext();
    if (requestContext && 'ipAddress' in requestContext) {
      return String(requestContext['ipAddress']);
    }

    return 'unknown';
  }

  /**
   * Extract user agent from context
   */
  private extractUserAgent(): string | undefined {
    const requestContext = getRequestContext();
    if (requestContext && 'userAgent' in requestContext) {
      return String(requestContext['userAgent']);
    }

    return undefined; // no userAgent in request context
  }

  /**
   * Extract OAuth scopes from args or context
   */
  private extractScopes(args: Record<string, unknown>): string[] | undefined {
    if (Array.isArray(args['scopes'])) {
      return args['scopes'].map(String);
    }

    const requestContext = getRequestContext();
    if (requestContext && 'scopes' in requestContext && Array.isArray(requestContext['scopes'])) {
      return requestContext['scopes'].map(String);
    }

    return undefined; // no scopes in request context
  }

  /**
   * Extract resource from args
   */
  private extractResource(
    action: string,
    args: Record<string, unknown>
  ): {
    type: 'spreadsheet' | 'range' | 'permission' | 'token' | 'config' | 'export';
    spreadsheetId?: string;
    spreadsheetName?: string;
    range?: string;
    sheetId?: string;
    sheetName?: string;
  } {
    const type = this.isSetAction(EXPORT_ACTIONS, action)
      ? 'export'
      : this.isSetAction(PERMISSION_ACTIONS, action)
        ? 'permission'
        : this.isSetAction(AUTHENTICATION_ACTIONS, action)
          ? 'token'
          : this.isSetAction(CONFIGURATION_ACTIONS, action)
            ? 'config'
            : 'spreadsheet';
    return {
      type,
      spreadsheetId: typeof args['spreadsheetId'] === 'string' ? args['spreadsheetId'] : undefined,
      spreadsheetName:
        typeof args['spreadsheetName'] === 'string' ? args['spreadsheetName'] : undefined,
      range: typeof args['range'] === 'string' ? args['range'] : undefined,
      sheetId: typeof args['sheetId'] === 'string' ? args['sheetId'] : undefined,
      sheetName: typeof args['sheetName'] === 'string' ? args['sheetName'] : undefined,
    };
  }

  /**
   * Extract permission from args
   */
  private extractPermission(args: Record<string, unknown>): {
    role: 'owner' | 'writer' | 'reader';
    email?: string;
    domain?: string;
    anyone?: boolean;
  } {
    const role =
      typeof args['role'] === 'string' ? (args['role'] as 'owner' | 'writer' | 'reader') : 'reader';
    const email = typeof args['email'] === 'string' ? args['email'] : undefined;
    const domain = typeof args['domain'] === 'string' ? args['domain'] : undefined;
    const anyone = typeof args['anyone'] === 'boolean' ? args['anyone'] : undefined;

    return { role, email, domain, anyone };
  }

  /**
   * Extract authentication method from action
   */
  private extractAuthMethod(
    action: AuthenticationEvent['action']
  ): 'oauth' | 'api_key' | 'service_account' | 'managed_identity' {
    if (action === 'oauth_grant') return 'oauth';
    if (action === 'service_account_auth') return 'service_account';
    return 'oauth'; // Default
  }

  /**
   * Extract export format from action
   */
  private extractExportFormat(
    action: ExportEvent['action'],
    args: Record<string, unknown>,
    result: unknown
  ): string | undefined {
    if (action === 'publish_report') {
      if (typeof args['format'] === 'string') {
        return args['format'];
      }
      const report = this.getNestedRecord(result, 'report');
      if (report && typeof report['format'] === 'string') {
        return report['format'];
      }
    }
    if (action === 'export_csv') return 'csv';
    if (action === 'export_xlsx') return 'xlsx';
    if (action === 'export_pdf') return 'pdf';
    if (action === 'export_bigquery' || action === 'export_to_bigquery') return 'bigquery';
    return undefined; // OK: unknown format type
  }

  /**
   * Extract config key from args
   */
  private extractConfigKey(args: Record<string, unknown>): string {
    return typeof args['configKey'] === 'string' ? args['configKey'] : 'unknown';
  }

  /**
   * Extract old value from args (sanitized)
   */
  private extractOldValue(args: Record<string, unknown>): string | undefined {
    if (typeof args['oldValue'] === 'string') {
      return this.sanitizeConfigValue(this.extractConfigKey(args), args['oldValue']);
    }
    return undefined;
  }

  /**
   * Extract new value from args (sanitized)
   */
  private extractNewValue(args: Record<string, unknown>): string | undefined {
    if (typeof args['newValue'] === 'string') {
      return this.sanitizeConfigValue(this.extractConfigKey(args), args['newValue']);
    }
    return undefined;
  }

  /**
   * Sanitize config value (remove secrets)
   */
  private sanitizeConfigValue(key: string, value: string): string {
    const sensitiveKeys = /secret|token|key|password|credential|auth|private/i;
    if (sensitiveKeys.test(key)) {
      return '[REDACTED]';
    }
    return value;
  }

  /**
   * Extract cells modified count from result
   */
  private extractCellsModified(result: unknown): number | undefined {
    if (
      result &&
      typeof result === 'object' &&
      'cellsModified' in result &&
      typeof result.cellsModified === 'number'
    ) {
      return result.cellsModified;
    }
    return undefined;
  }

  /**
   * Extract rows modified count from result
   */
  private extractRowsModified(result: unknown): number | undefined {
    if (
      result &&
      typeof result === 'object' &&
      'rowsModified' in result &&
      typeof result.rowsModified === 'number'
    ) {
      return result.rowsModified;
    }
    return undefined;
  }

  /**
   * Extract columns modified count from result
   */
  private extractColumnsModified(result: unknown): number | undefined {
    if (
      result &&
      typeof result === 'object' &&
      'columnsModified' in result &&
      typeof result.columnsModified === 'number'
    ) {
      return result.columnsModified;
    }
    return undefined;
  }

  /**
   * Extract record count from result
   */
  private extractRecordCount(result: unknown): number | undefined {
    if (
      result &&
      typeof result === 'object' &&
      'recordCount' in result &&
      typeof result.recordCount === 'number'
    ) {
      return result.recordCount;
    }
    return undefined;
  }

  /**
   * Extract file size from result
   */
  private extractFileSize(result: unknown): number | undefined {
    if (
      result &&
      typeof result === 'object' &&
      'fileSize' in result &&
      typeof result.fileSize === 'number'
    ) {
      return result.fileSize;
    }
    if (
      result &&
      typeof result === 'object' &&
      'sizeBytes' in result &&
      typeof result.sizeBytes === 'number'
    ) {
      return result.sizeBytes;
    }
    const report = this.getNestedRecord(result, 'report');
    if (report && typeof report['sizeBytes'] === 'number') {
      return report['sizeBytes'];
    }
    return undefined;
  }

  private getNestedRecord(result: unknown, key: string): Record<string, unknown> | undefined {
    if (!result || typeof result !== 'object' || !(key in result)) {
      return undefined;
    }
    const value = (result as Record<string, unknown>)[key];
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  }
}

/**
 * Create audit middleware instance
 */
export function createAuditMiddleware(auditLogger: AuditLogger): AuditMiddleware {
  return new AuditMiddleware(auditLogger);
}
