/**
 * ServalSheets - Request Helper Functions
 *
 * Pure utility functions for request handling.
 * Extracted from BaseHandler for better modularity and independent testing.
 */

/**
 * Unwrap the canonical `{ request: ... }` envelope while preserving legacy flat inputs.
 */
export function unwrapRequest<TRequest extends Record<string, unknown>>(
  input: { request?: TRequest } | TRequest
): TRequest {
  if (input && typeof input === 'object' && 'request' in input) {
    const container = input as { request?: TRequest };
    if (container.request && typeof container.request === 'object') {
      return container.request;
    }
  }

  return input as TRequest;
}
