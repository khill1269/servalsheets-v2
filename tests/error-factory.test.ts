import { describe, it, expect } from 'vitest';
import {
  createPermissionError,
  createRateLimitError,
  createNotFoundError,
  createAuthenticationError,
  createValidationError,
  parseGoogleApiError,
  enrichErrorWithContext,
  detectErrorPattern,
} from '../src/utils/error-factory.js';
import type { ErrorDetail } from '../src/schemas/shared.js';

describe('Error Factory', () => {
  describe('createPermissionError', () => {
    it('should create a permission error with actionable steps', () => {
      const error = createPermissionError({
        operation: 'write to sheet',
        resourceType: 'sheet',
        resourceId: 'Sheet1',
        currentPermission: 'view',
        requiredPermission: 'edit',
      });

      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.category).toBe('auth');
      expect(error.severity).toBe('high');
      expect(error.retryable).toBe(false);
      expect(error.resolutionSteps).toHaveLength(4);
      expect(error.suggestedTools).toContain('sheets_collaborate');
    });
  });

  describe('createRateLimitError', () => {
    it('should create a rate limit error with retry guidance', () => {
      const error = createRateLimitError({
        quotaType: 'write',
        retryAfterMs: 30000,
        endpoint: '/v4/spreadsheets',
      });

      expect(error.code).toBe('RATE_LIMITED');
      expect(error.category).toBe('quota');
      expect(error.severity).toBe('medium');
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(30000);
      expect(error.retryStrategy).toBe('wait_for_reset');
      expect(error.resolutionSteps).toHaveLength(5);
    });
  });

  describe('createNotFoundError', () => {
    it('should create a not found error for spreadsheet', () => {
      const error = createNotFoundError({
        resourceType: 'spreadsheet',
        resourceId: 'abc123',
      });

      expect(error.code).toBe('SPREADSHEET_NOT_FOUND');
      expect(error.category).toBe('client');
      expect(error.severity).toBe('medium');
      expect(error.retryable).toBe(false);
      expect(error.resolutionSteps?.length).toBeGreaterThan(0);
    });

    it('should create a not found error for sheet', () => {
      const error = createNotFoundError({
        resourceType: 'sheet',
        resourceId: 'Sheet1',
      });

      expect(error.code).toBe('SHEET_NOT_FOUND');
      expect(error.suggestedTools).toContain('sheets_core');
    });

    it('should create a not found error for range', () => {
      const error = createNotFoundError({
        resourceType: 'range',
        resourceId: 'A1:B10',
      });

      expect(error.code).toBe('RANGE_NOT_FOUND');
      expect(error.resolutionSteps?.some((step) => step.includes('A1 notation'))).toBe(true);
    });
  });

  describe('createAuthenticationError', () => {
    it('should create missing token error', () => {
      const error = createAuthenticationError({
        reason: 'missing_token',
      });

      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.category).toBe('auth');
      expect(error.severity).toBe('critical');
      expect(error.retryable).toBe(false);
      expect(error.resolutionSteps?.some((step) => step.includes('npm run auth'))).toBe(true);
    });

    it('should create expired token error', () => {
      const error = createAuthenticationError({
        reason: 'expired_token',
      });

      expect(error.retryable).toBe(true);
      expect(error.retryStrategy).toBe('exponential_backoff');
    });

    it('should create insufficient scopes error', () => {
      const error = createAuthenticationError({
        reason: 'insufficient_scopes',
        missingScopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      expect(error.message).toContain('Insufficient permissions');
      expect(error.message).toContain('spreadsheets');
    });
  });

  describe('createValidationError', () => {
    it('should create validation error with format guidance', () => {
      const error = createValidationError({
        field: 'range',
        value: 'invalid',
        expectedFormat: 'A1 notation (e.g., "Sheet1!A1:B10")',
        allowedValues: ['Sheet1!A1:B10', 'A1:B10'],
      });

      expect(error.code).toBe('INVALID_REQUEST');
      expect(error.category).toBe('client');
      expect(error.severity).toBe('medium');
      expect(error.retryable).toBe(false);
      expect(error.resolutionSteps?.some((step) => step.includes('Expected format'))).toBe(true);
    });
  });

  describe('parseGoogleApiError', () => {
    it('should parse 401 authentication error', () => {
      const error = parseGoogleApiError({
        code: 401,
        message: 'Invalid authentication credentials',
      });

      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.category).toBe('auth');
    });

    it('should parse 403 rate limit error', () => {
      const error = parseGoogleApiError({
        code: 403,
        message: 'Rate limit exceeded',
        errors: [{ domain: 'usageLimits', reason: 'rateLimitExceeded' }],
      });

      expect(error.code).toBe('RATE_LIMITED');
      expect(error.category).toBe('quota');
    });

    it('should parse 403 permission error', () => {
      const error = parseGoogleApiError({
        code: 403,
        message: 'Permission denied',
        errors: [{ domain: 'global', reason: 'insufficientPermissions' }],
      });

      expect(error.code).toBe('PERMISSION_DENIED');
    });

    it('should parse 404 not found error', () => {
      const error = parseGoogleApiError({
        code: 404,
        message: 'Not found',
      });

      expect(error.code).toBe('SPREADSHEET_NOT_FOUND');
    });

    it('should parse 429 rate limit error', () => {
      const error = parseGoogleApiError({
        code: 429,
        message: 'Too many requests',
      });

      expect(error.code).toBe('RATE_LIMITED');
    });

    it('should parse 400 validation error', () => {
      const error = parseGoogleApiError({
        code: 400,
        message: 'Invalid request',
      });

      expect(error.code).toBe('INVALID_REQUEST');
    });

    it('should parse 500 server error', () => {
      const error = parseGoogleApiError({
        code: 500,
        message: 'Internal server error',
      });

      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.category).toBe('server');
      expect(error.retryable).toBe(true);
      expect(error.retryStrategy).toBe('exponential_backoff');
    });
  });

  describe('enrichErrorWithContext', () => {
    it('should enrich Error instance with context', () => {
      const error = new Error('Something went wrong');
      const enriched = enrichErrorWithContext(error, {
        correlationId: 'corr-123',
        requestPath: '/api/sheets/read',
        userAction: 'reading spreadsheet',
      });

      expect(enriched.correlationId).toBe('corr-123');
      expect(enriched.requestPath).toBe('/api/sheets/read');
      expect(enriched.userAction).toBe('reading spreadsheet');
      expect(enriched.stackTrace).toBeDefined();
      expect(enriched.enrichedAt).toBeGreaterThan(0);
    });

    it('should enrich ErrorDetail with context', () => {
      const error: ErrorDetail = {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        category: 'quota',
        severity: 'medium',
        retryable: true,
      };

      const enriched = enrichErrorWithContext(error, {
        correlationId: 'corr-456',
      });

      expect(enriched.code).toBe('RATE_LIMITED');
      expect(enriched.correlationId).toBe('corr-456');
    });

    it('should include error history', () => {
      const previousErrors: ErrorDetail[] = [
        {
          code: 'RATE_LIMITED',
          message: 'Rate limit 1',
          category: 'quota',
          severity: 'medium',
          retryable: true,
        },
        {
          code: 'RATE_LIMITED',
          message: 'Rate limit 2',
          category: 'quota',
          severity: 'medium',
          retryable: true,
        },
      ];

      const error = new Error('Rate limit 3');
      const enriched = enrichErrorWithContext(error, { previousErrors });

      expect(enriched.errorHistory).toHaveLength(2);
      expect(enriched.errorHistory?.[0]?.error.code).toBe('RATE_LIMITED');
    });

    it('should limit error history to last 10 errors', () => {
      const previousErrors: ErrorDetail[] = Array.from({ length: 15 }, (_, i) => ({
        code: 'RATE_LIMITED',
        message: `Rate limit ${i}`,
        category: 'quota',
        severity: 'medium',
        retryable: true,
      }));

      const error = new Error('Latest error');
      const enriched = enrichErrorWithContext(error, { previousErrors });

      expect(enriched.errorHistory).toHaveLength(10);
    });

    it('should detect error pattern from history', () => {
      const previousErrors: ErrorDetail[] = Array.from({ length: 5 }, () => ({
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        category: 'quota',
        severity: 'medium',
        retryable: true,
      }));

      const error = new Error('Another rate limit');
      const enriched = enrichErrorWithContext(error, { previousErrors });

      expect(enriched.suggestedPattern).toBeDefined();
      expect(enriched.suggestedPattern?.pattern).toBe('rate_limit');
    });
  });

  describe('detectErrorPattern', () => {
    it('should detect rate limit pattern', () => {
      const errors: ErrorDetail[] = Array.from({ length: 5 }, () => ({
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        category: 'quota',
        severity: 'medium',
        retryable: true,
      }));

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeDefined();
      expect(pattern?.pattern).toBe('rate_limit');
      expect(pattern?.frequency).toBe(5);
      expect(pattern?.suggestedAction).toContain('backoff');
    });

    it('should detect auth expiry pattern', () => {
      const errors: ErrorDetail[] = Array.from({ length: 3 }, () => ({
        code: 'UNAUTHORIZED',
        message: 'Authentication token expired',
        category: 'auth',
        severity: 'critical',
        retryable: false,
      }));

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeDefined();
      expect(pattern?.pattern).toBe('auth_expiry');
      expect(pattern?.suggestedAction).toContain('token refresh');
    });

    it('should detect network pattern', () => {
      const errors: ErrorDetail[] = Array.from({ length: 4 }, () => ({
        code: 'NETWORK_ERROR',
        message: 'Network timeout',
        category: 'network',
        severity: 'high',
        retryable: true,
      }));

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeDefined();
      expect(pattern?.pattern).toBe('network');
      expect(pattern?.suggestedAction).toContain('circuit breaker');
    });

    it('should detect permission pattern', () => {
      const errors: ErrorDetail[] = [
        {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied 1',
          category: 'auth',
          severity: 'high',
          retryable: false,
        },
        {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied 2',
          category: 'auth',
          severity: 'high',
          retryable: false,
        },
      ];

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeDefined();
      expect(pattern?.pattern).toBe('permission');
      expect(pattern?.suggestedAction).toContain('sheets_collaborate');
    });

    it('should track affected operations', () => {
      const errors: ErrorDetail[] = Array.from({ length: 3 }, (_, i) => ({
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        category: 'quota',
        severity: 'medium',
        retryable: true,
        details: {
          operation: `operation${i % 2}`,
        },
      }));

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeDefined();
      expect(pattern?.affectedOperations).toContain('operation0');
      expect(pattern?.affectedOperations).toContain('operation1');
    });

    it('should handle empty error array', () => {
      const pattern = detectErrorPattern([]);

      expect(pattern).toBeNull();
    });

    it('should return null when no clear pattern', () => {
      const errors: ErrorDetail[] = [
        {
          code: 'RATE_LIMITED',
          message: 'Rate limit',
          category: 'quota',
          severity: 'medium',
          retryable: true,
        },
        {
          code: 'PERMISSION_DENIED',
          message: 'Permission denied',
          category: 'auth',
          severity: 'high',
          retryable: false,
        },
      ];

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeNull();
    });

    it('should handle non-string operation values', () => {
      const errors: ErrorDetail[] = [
        {
          code: 'RATE_LIMITED',
          message: 'Rate limit 1',
          category: 'quota',
          severity: 'medium',
          retryable: true,
          details: {
            operation: { complex: 'object' },
          },
        },
        {
          code: 'RATE_LIMITED',
          message: 'Rate limit 2',
          category: 'quota',
          severity: 'medium',
          retryable: true,
          details: {
            operation: 'string_operation',
          },
        },
        {
          code: 'RATE_LIMITED',
          message: 'Rate limit 3',
          category: 'quota',
          severity: 'medium',
          retryable: true,
        },
      ];

      const pattern = detectErrorPattern(errors);

      expect(pattern).toBeDefined();
      expect(pattern?.affectedOperations).toEqual(['string_operation']);
    });
  });
});
