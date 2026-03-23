import { describe, expect, it } from 'vitest';
import {
  getCanonicalErrorCode,
  getErrorCodeCompatibility,
  getErrorCodeFamily,
  getLegacyErrorCodesForCanonical,
  isKnownErrorCode,
} from '../../src/utils/error-code-compat.js';

describe('error-code-compat', () => {
  it('maps legacy alias codes to canonical codes', () => {
    expect(getCanonicalErrorCode('VALIDATION_ERROR')).toBe('INVALID_REQUEST');
    expect(getCanonicalErrorCode('AUTH_ERROR')).toBe('AUTHENTICATION_REQUIRED');
    expect(getCanonicalErrorCode('NOT_IMPLEMENTED')).toBe('UNIMPLEMENTED');
  });

  it('preserves canonical codes', () => {
    expect(getCanonicalErrorCode('PERMISSION_DENIED')).toBe('PERMISSION_DENIED');
    expect(getCanonicalErrorCode('SPREADSHEET_NOT_FOUND')).toBe('SPREADSHEET_NOT_FOUND');
  });

  it('returns undefined for unknown error codes', () => {
    expect(getCanonicalErrorCode('RATE_LIMIT')).toBeUndefined();
  });

  it('reports compatibility metadata for known aliases', () => {
    const compatibility = getErrorCodeCompatibility('FAILED_PRECONDITION');
    expect(compatibility).toMatchObject({
      reportedCode: 'FAILED_PRECONDITION',
      canonicalCode: 'PRECONDITION_FAILED',
      family: 'precondition',
      isKnown: true,
      isAlias: true,
    });
  });

  it('classifies unknown codes into unknown family with UNKNOWN_ERROR canonical fallback', () => {
    const compatibility = getErrorCodeCompatibility('CUSTOM_ERROR');
    expect(compatibility).toMatchObject({
      reportedCode: 'CUSTOM_ERROR',
      canonicalCode: 'UNKNOWN_ERROR',
      family: 'unknown',
      isKnown: false,
      isAlias: false,
    });
  });

  it('returns legacy aliases for a canonical code', () => {
    const aliases = getLegacyErrorCodesForCanonical('INVALID_REQUEST');
    expect(aliases).toContain('INVALID_PARAMS');
    expect(aliases).toContain('VALIDATION_ERROR');
  });

  it('detects known error codes', () => {
    expect(isKnownErrorCode('SHEET_NOT_FOUND')).toBe(true);
    expect(isKnownErrorCode('CUSTOM_ERROR')).toBe(false);
    expect(isKnownErrorCode(123)).toBe(false);
  });

  it('classifies canonical family buckets', () => {
    expect(getErrorCodeFamily('RESOURCE_EXHAUSTED')).toBe('quota');
    expect(getErrorCodeFamily('FEATURE_UNAVAILABLE')).toBe('feature');
    expect(getErrorCodeFamily('SESSION_NOT_FOUND')).toBe('not_found');
  });
});
