/**
 * ServalSheets - Extraction Helper Functions
 *
 * Centralized utilities for extracting fields from tool arguments and results.
 * These helpers handle both discriminated union patterns (request.action) and
 * flattened patterns (action directly in args).
 *
 * @module mcp/registration/extraction-helpers
 */

// ============================================================================
// ARGUMENT EXTRACTORS
// ============================================================================

/**
 * Extract action from tool arguments
 *
 * Supports both patterns:
 * - Discriminated union: args.request.action
 * - Flattened: args.action
 *
 * @param args - Tool input arguments
 * @returns Action string, or 'unknown' if not found
 *
 * @example
 * ```ts
 * extractAction({ request: { action: 'read' } }) // => 'read'
 * extractAction({ action: 'write' }) // => 'write'
 * extractAction({}) // => 'unknown'
 * ```
 */
export function extractAction(args: Record<string, unknown>): string {
  // Extract action from request object (discriminated union pattern)
  const request = args['request'] as Record<string, unknown> | undefined;
  if (request && typeof request['action'] === 'string') {
    return request['action'];
  }
  // Fallback for non-discriminated schemas
  if (typeof args['action'] === 'string') {
    return args['action'];
  }
  return 'unknown';
}

/**
 * Extract spreadsheetId from tool arguments
 *
 * Supports both patterns:
 * - Discriminated union: args.request.params.spreadsheetId
 * - Flattened: args.spreadsheetId
 *
 * @param args - Tool input arguments
 * @returns Spreadsheet ID, or undefined if not found
 *
 * @example
 * ```ts
 * extractSpreadsheetId({ request: { params: { spreadsheetId: '123' } } }) // => '123'
 * extractSpreadsheetId({ spreadsheetId: '456' }) // => '456'
 * extractSpreadsheetId({}) // => undefined
 * ```
 */
export function extractSpreadsheetId(args: Record<string, unknown>): string | undefined {
  const request = args['request'] as Record<string, unknown> | undefined;

  // Check nested params first (legacy format: request.params.spreadsheetId)
  const params = request?.['params'] as Record<string, unknown> | undefined;
  if (params && typeof params['spreadsheetId'] === 'string') {
    return params['spreadsheetId'];
  }

  // Check flat within request (current MCP format: request.spreadsheetId)
  if (request && typeof request['spreadsheetId'] === 'string') {
    return request['spreadsheetId'];
  }

  // Check top-level (unit test format: spreadsheetId)
  if (typeof args['spreadsheetId'] === 'string') {
    return args['spreadsheetId'];
  }

  // OK: Explicit empty - typed as optional, spreadsheetId field not found in args
  return undefined;
}

/**
 * Extract sheetId from tool arguments
 *
 * Supports both patterns:
 * - Discriminated union: args.request.params.sheetId
 * - Flattened: args.sheetId
 *
 * @param args - Tool input arguments
 * @returns Sheet ID (numeric), or undefined if not found
 *
 * @example
 * ```ts
 * extractSheetId({ request: { params: { sheetId: 0 } } }) // => 0
 * extractSheetId({ sheetId: 123 }) // => 123
 * extractSheetId({}) // => undefined
 * ```
 */
export function extractSheetId(args: Record<string, unknown>): number | undefined {
  const request = args['request'] as Record<string, unknown> | undefined;

  // Check nested params first (legacy format: request.params.sheetId)
  const params = request?.['params'] as Record<string, unknown> | undefined;
  if (params && typeof params['sheetId'] === 'number') {
    return params['sheetId'];
  }

  // Check flat within request (current MCP format: request.sheetId)
  if (request && typeof request['sheetId'] === 'number') {
    return request['sheetId'];
  }

  // Check top-level (unit test format: sheetId)
  if (typeof args['sheetId'] === 'number') {
    return args['sheetId'];
  }

  // OK: Explicit empty - typed as optional, sheetId field not found in args
  return undefined;
}

// ============================================================================
// RESULT CHECKERS
// ============================================================================

/**
 * Check if tool result indicates success
 *
 * Checks for success field in both:
 * - result.response.success
 * - result.success
 *
 * @param result - Tool execution result
 * @returns True if successful, false otherwise
 *
 * @example
 * ```ts
 * isSuccessResult({ response: { success: true } }) // => true
 * isSuccessResult({ success: true }) // => true
 * isSuccessResult({ success: false }) // => false
 * isSuccessResult({}) // => false
 * isSuccessResult(null) // => false
 * ```
 */
export function isSuccessResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const response = (result as Record<string, unknown>)['response'];
  if (response && typeof response === 'object') {
    return (response as Record<string, unknown>)['success'] === true;
  }
  return (result as Record<string, unknown>)['success'] === true;
}

// ============================================================================
// RESULT EXTRACTORS
// ============================================================================

/**
 * Extract cellsAffected count from tool result
 *
 * Tries multiple field names:
 * - result.response.cellsAffected
 * - result.cellsAffected
 * - result.response.updatedCells
 * - result.updatedCells
 * - result.response.mutation.cellsAffected
 * - result.mutation.cellsAffected
 *
 * @param result - Tool execution result
 * @returns Number of cells affected, or undefined if not found
 *
 * @example
 * ```ts
 * extractCellsAffected({ response: { cellsAffected: 100 } }) // => 100
 * extractCellsAffected({ cellsAffected: 50 }) // => 50
 * extractCellsAffected({ updatedCells: 25 }) // => 25
 * extractCellsAffected({ mutation: { cellsAffected: 10 } }) // => 10
 * extractCellsAffected({}) // => undefined
 * ```
 */
export function extractCellsAffected(result: unknown): number | undefined {
  if (typeof result !== 'object' || result === null) {
    // OK: Explicit empty - typed as optional, invalid result object
    return undefined;
  }
  const response = (result as Record<string, unknown>)['response'];
  const data = response && typeof response === 'object' ? response : result;
  const dataObj = data as Record<string, unknown>;

  // Try common field names
  if (typeof dataObj['cellsAffected'] === 'number') {
    return dataObj['cellsAffected'];
  }
  if (typeof dataObj['updatedCells'] === 'number') {
    return dataObj['updatedCells'];
  }

  // Try mutation summary
  const mutation = dataObj['mutation'] as Record<string, unknown> | undefined;
  if (mutation && typeof mutation['cellsAffected'] === 'number') {
    return mutation['cellsAffected'];
  }

  // OK: Explicit empty - typed as optional, cellsAffected field not found in result
  return undefined;
}

/**
 * Extract snapshotId from tool result
 *
 * Looks for:
 * - result.response.mutation.revertSnapshotId
 * - result.mutation.revertSnapshotId
 *
 * @param result - Tool execution result
 * @returns Snapshot ID for revert, or undefined if not found
 *
 * @example
 * ```ts
 * extractSnapshotId({ response: { mutation: { revertSnapshotId: 'snap-123' } } }) // => 'snap-123'
 * extractSnapshotId({ mutation: { revertSnapshotId: 'snap-456' } }) // => 'snap-456'
 * extractSnapshotId({}) // => undefined
 * ```
 */
export function extractSnapshotId(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    // OK: Explicit empty - typed as optional, invalid result object
    return undefined;
  }
  const response = (result as Record<string, unknown>)['response'];
  const data = response && typeof response === 'object' ? response : result;
  const mutation = (data as Record<string, unknown>)['mutation'] as
    | Record<string, unknown>
    | undefined;

  if (mutation && typeof mutation['revertSnapshotId'] === 'string') {
    return mutation['revertSnapshotId'];
  }

  // OK: Explicit empty - typed as optional, revertSnapshotId field not found in result
  return undefined;
}

/**
 * Extract error message from tool result
 *
 * Looks for:
 * - result.response.error.message
 *
 * @param result - Tool execution result
 * @returns Error message, or undefined if not found
 *
 * @example
 * ```ts
 * extractErrorMessage({ response: { error: { message: 'Not found' } } }) // => 'Not found'
 * extractErrorMessage({ response: { success: true } }) // => undefined
 * extractErrorMessage({}) // => undefined
 * ```
 */
export function extractErrorMessage(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    // OK: Explicit empty - typed as optional, invalid result object
    return undefined;
  }
  const response = (result as Record<string, unknown>)['response'];
  if (response && typeof response === 'object') {
    const error = (response as Record<string, unknown>)['error'] as
      | Record<string, unknown>
      | undefined;
    if (error && typeof error['message'] === 'string') {
      return error['message'];
    }
  }
  // OK: Explicit empty - typed as optional, error message field not found in result
  return undefined;
}

/**
 * Extract error code from tool result
 *
 * Looks for:
 * - result.response.error.code
 *
 * @param result - Tool execution result
 * @returns Error code, or undefined if not found
 *
 * @example
 * ```ts
 * extractErrorCode({ response: { error: { code: 'SHEET_NOT_FOUND' } } }) // => 'SHEET_NOT_FOUND'
 * extractErrorCode({ response: { success: true } }) // => undefined
 * extractErrorCode({}) // => undefined
 * ```
 */
export function extractErrorCode(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) {
    // OK: Explicit empty - typed as optional, invalid result object
    return undefined;
  }
  const response = (result as Record<string, unknown>)['response'];
  if (response && typeof response === 'object') {
    const error = (response as Record<string, unknown>)['error'] as
      | Record<string, unknown>
      | undefined;
    if (error && typeof error['code'] === 'string') {
      return error['code'];
    }
  }
  // OK: Explicit empty - typed as optional, error code field not found in result
  return undefined;
}
