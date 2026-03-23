/**
 * Tests for code-based circuit breaker readOnlyMode fallback (Task B4)
 *
 * Verifies that FallbackStrategies.readOnlyMode.shouldUse() is based on
 * error codes (not error message text), so:
 *   - PERMISSION_DENIED, UNAUTHENTICATED, etc. do NOT trigger read-only mode
 *   - RATE_LIMITED and transient errors DO trigger read-only mode
 */

import { describe, it, expect } from 'vitest';
import { FallbackStrategies } from '../../src/utils/circuit-breaker.js';

function makeError(message: string, code?: string): Error {
  const err = new Error(message);
  if (code) {
    (err as Error & { errorCode?: string }).errorCode = code;
  }
  return err;
}

function makeCodedError(errorCode: string, message = 'error'): Error {
  const err = new Error(message);
  (err as Error & { errorCode?: string }).errorCode = errorCode;
  return err;
}

describe('FallbackStrategies.readOnlyMode.shouldUse()', () => {
  const fallback = FallbackStrategies.readOnlyMode({ success: false, error: 'read-only' });

  it('does NOT trigger for PERMISSION_DENIED (permanent auth failure)', () => {
    const err = makeCodedError('PERMISSION_DENIED', 'Access denied to write');
    // Even though message contains "write", code indicates permanent failure
    expect(fallback.shouldUse(err)).toBe(false);
  });

  it('does NOT trigger for UNAUTHENTICATED (auth failure)', () => {
    const err = makeCodedError('UNAUTHENTICATED', 'Token invalid');
    expect(fallback.shouldUse(err)).toBe(false);
  });

  it('does NOT trigger for SPREADSHEET_NOT_FOUND (permanent not-found)', () => {
    const err = makeCodedError('SPREADSHEET_NOT_FOUND', 'Spreadsheet not found');
    expect(fallback.shouldUse(err)).toBe(false);
  });

  it('does NOT trigger for INVALID_ARGUMENT (permanent validation failure)', () => {
    const err = makeCodedError('INVALID_ARGUMENT', 'Invalid range format');
    expect(fallback.shouldUse(err)).toBe(false);
  });

  it('DOES trigger for RATE_LIMITED (transient error)', () => {
    const err = makeCodedError('RATE_LIMITED', 'Too many requests');
    expect(fallback.shouldUse(err)).toBe(true);
  });

  it('DOES trigger for errors without a recognized code (transient assumed)', () => {
    // Errors with no errorCode are assumed transient (server errors, timeouts)
    const err = new Error('Internal server error');
    expect(fallback.shouldUse(err)).toBe(true);
  });

  it('DOES trigger for server errors (transient)', () => {
    const err = makeCodedError('INTERNAL_ERROR', 'Server error 500');
    expect(fallback.shouldUse(err)).toBe(true);
  });

  it('returns a FallbackStrategy with name "read-only-mode"', () => {
    expect(fallback.name).toBe('read-only-mode');
  });

  it('execute() returns the provided readOnlyResponse', async () => {
    const response = { success: false, error: 'test-read-only' };
    const fb = FallbackStrategies.readOnlyMode(response);
    const result = await fb.execute(new Error('test'));
    expect(result).toEqual(response);
  });
});
