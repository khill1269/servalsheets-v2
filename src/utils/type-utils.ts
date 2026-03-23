/**
 * Type utilities for compile-time exhaustiveness checking.
 */

/**
 * Error thrown when an unknown action is encountered at runtime.
 * Carries code 'INVALID_PARAMS' so handler error mappers return the
 * correct MCP error code instead of generic INTERNAL_ERROR.
 */
export class InvalidActionError extends Error {
  readonly code = 'INVALID_PARAMS' as const;
  readonly retryable = false;

  constructor(value: unknown) {
    super(
      `Unknown action: ${typeof value === 'object' && value !== null && 'action' in value ? (value as { action: unknown }).action : JSON.stringify(value)}`
    );
    this.name = 'InvalidActionError';
  }
}

/**
 * Call in the `default` branch of a discriminated-union switch to assert that
 * all cases are handled.  TypeScript raises a compile error if `x` can still
 * be a non-`never` type, and the function throws at runtime if somehow reached.
 */
export function assertNever(x: never): never {
  throw new InvalidActionError(x);
}
