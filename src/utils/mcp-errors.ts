/**
 * ServalSheets - MCP Error Helpers
 *
 * Provides standardized JSON-RPC error creation for MCP compliance.
 * Uses McpError with proper error codes per MCP 2025-11-25 specification.
 *
 * @module utils/mcp-errors
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Create a resource not found error
 * Uses InvalidParams (-32602) as the resource URI is technically valid but the resource doesn't exist
 *
 * @param resourceType - Type of resource (e.g., 'tool', 'guide', 'pattern')
 * @param resourceId - ID or name of the resource
 * @param hint - Optional hint for the user
 * @returns McpError with proper JSON-RPC error code
 */
export function createResourceNotFoundError(
  resourceType: string,
  resourceId: string,
  hint?: string
): McpError {
  const message = `Resource not found: ${resourceType}/${resourceId}`;
  return new McpError(ErrorCode.InvalidParams, message, {
    resourceType,
    resourceId,
    hint,
  });
}

/**
 * Create an invalid resource URI error
 * Uses InvalidParams (-32602) as the URI format is invalid
 *
 * @param uri - The invalid URI
 * @param expectedPattern - The expected URI pattern
 * @returns McpError with proper JSON-RPC error code
 */
export function createInvalidResourceUriError(uri: string, expectedPattern: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Invalid resource URI: ${uri}`, {
    uri,
    expectedPattern,
  });
}

/**
 * Create a resource read error
 * Uses InternalError (-32603) for unexpected failures during resource reading
 *
 * @param uri - The resource URI that failed to read
 * @param originalError - The original error that occurred
 * @returns McpError with proper JSON-RPC error code
 */
export function createResourceReadError(uri: string, originalError: unknown): McpError {
  const message = originalError instanceof Error ? originalError.message : String(originalError);
  return new McpError(ErrorCode.InternalError, `Failed to read resource: ${message}`, {
    uri,
    originalError: message,
  });
}

/**
 * Create an authentication required error
 * Uses InvalidRequest (-32600) per JSON-RPC spec: the request cannot be
 * processed in the current unauthenticated state.
 *
 * @param uri - The resource URI that requires authentication
 * @param hint - Optional hint for the user
 * @returns McpError with proper JSON-RPC error code
 */
export function createAuthRequiredError(uri: string, hint?: string): McpError {
  return new McpError(
    ErrorCode.InvalidRequest,
    'Not authenticated. Call sheets_auth action:"login" first.',
    {
      uri,
      hint: hint || 'Authentication required to access this resource',
    }
  );
}
