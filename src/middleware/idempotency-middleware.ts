/**
 * Idempotency Middleware
 *
 * Wraps tool handlers to prevent duplicate execution of non-idempotent operations.
 * Integrates with request context to extract idempotency keys from HTTP headers.
 *
 * @category Middleware
 */

import { idempotencyManager } from '../services/idempotency-manager.js';
import {
  generateRequestFingerprint,
  generateIdempotencyKey,
} from '../utils/idempotency-key-generator.js';
import { getRequestContext } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';

/**
 * Extract action from handler arguments
 *
 * Handles the canonical request envelope: { request: { action, ...params } }
 * and legacy flat inputs: { action, ...params }
 *
 * @param args - Handler arguments
 * @returns Action string or undefined
 */
function extractAction(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') {
    return undefined;
  }

  const record = args as Record<string, unknown>;

  // Legacy flat format
  if (typeof record['action'] === 'string') {
    return record['action'];
  }

  // Canonical request envelope
  const request = record['request'];
  if (request && typeof request === 'object') {
    const requestRecord = request as Record<string, unknown>;
    if (typeof requestRecord['action'] === 'string') {
      return requestRecord['action'];
    }
  }

  return undefined;
}

/**
 * Wrap tool handler with idempotency checking
 *
 * For non-idempotent operations:
 * 1. Auto-generate idempotency key if not provided
 * 2. Check cache for previous execution
 * 3. Return cached result if exists
 * 4. Execute handler and cache result
 *
 * @param toolName - Tool name (e.g., 'sheets_data')
 * @param handler - Original handler function
 * @returns Wrapped handler with idempotency
 */
export function withIdempotency(
  toolName: string,
  handler: (args: unknown, extra?: unknown) => Promise<unknown>
): (args: unknown, extra?: unknown) => Promise<unknown> {
  return async (args: unknown, extra?: unknown): Promise<unknown> => {
    const action = extractAction(args);

    if (!action) {
      // No action found, execute normally (this shouldn't happen with valid requests)
      return handler(args, extra);
    }

    // Check if operation is idempotent
    const isIdempotent = idempotencyManager.isIdempotent(toolName, action);

    if (isIdempotent) {
      // Idempotent operations don't need caching - safe to retry
      return handler(args, extra);
    }

    // Non-idempotent operation - requires idempotency key
    const context = getRequestContext();
    let idempotencyKey = context?.idempotencyKey;

    // Auto-generate key if not provided
    if (!idempotencyKey) {
      idempotencyKey = generateIdempotencyKey();
      logger.debug('Auto-generated idempotency key for non-idempotent operation', {
        tool: toolName,
        action,
        key: idempotencyKey.substring(0, 16) + '...',
      });
    }

    // Generate request fingerprint for collision detection
    const fingerprint = generateRequestFingerprint(
      toolName,
      action,
      args as Record<string, unknown>
    );

    // Check cache
    const cachedResult = idempotencyManager.getCachedResult(
      idempotencyKey,
      toolName,
      action,
      fingerprint
    );

    if (cachedResult !== undefined) {
      logger.info('Idempotency key cache hit - returning cached result', {
        tool: toolName,
        action,
        key: idempotencyKey.substring(0, 16) + '...',
      });
      return cachedResult;
    }

    // Execute handler
    let result: unknown;
    let executionError: Error | undefined;

    try {
      result = await handler(args, extra);
    } catch (error) {
      executionError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      // Store result (success or error) for idempotency
      // Even errors should be cached to prevent retry storms
      if (executionError) {
        idempotencyManager.storeResult(idempotencyKey, toolName, action, fingerprint, {
          error: executionError.message,
          stack: executionError.stack,
        });
      } else {
        idempotencyManager.storeResult(idempotencyKey, toolName, action, fingerprint, result);
      }
    }

    return result;
  };
}

/**
 * Wrap all handlers in tool map with idempotency middleware
 *
 * @param toolMap - Map of tool names to handlers
 * @returns Wrapped tool map
 */
export function wrapToolMapWithIdempotency(
  toolMap: Record<string, (args: unknown, extra?: unknown) => Promise<unknown>>
): Record<string, (args: unknown, extra?: unknown) => Promise<unknown>> {
  const wrapped: Record<string, (args: unknown, extra?: unknown) => Promise<unknown>> = {};

  for (const [toolName, handler] of Object.entries(toolMap)) {
    wrapped[toolName] = withIdempotency(toolName, handler);
  }

  return wrapped;
}
