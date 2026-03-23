/**
 * ServalSheets - Error Handling Property Tests
 *
 * Property-based tests for error creation, parsing, and enrichment.
 * Ensures error codes, types, and context are handled consistently.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createPermissionError,
  createRateLimitError,
  createNotFoundError,
  createAuthenticationError,
  createValidationError,
} from '../../src/utils/error-factory.js';

describe('Error Handling Property Tests', () => {
  describe('Error Code Consistency', () => {
    it('permission errors should always have PERMISSION_DENIED code', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 100 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return error.code === 'PERMISSION_DENIED';
        }),
        { numRuns: 500 }
      );
    });

    it('rate limit errors should always have RATE_LIMITED code', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1000, max: 3600000 }), (retryAfterMs) => {
          const error = createRateLimitError({
            retryAfterMs,
            quotaType: 'write',
          });

          return error.code === 'RATE_LIMITED';
        }),
        { numRuns: 500 }
      );
    });

    it('not found errors should always have a *_NOT_FOUND code', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (resourceId) => {
          const error = createNotFoundError({
            resourceId,
            resourceType: 'spreadsheet',
          });

          // Resource-specific NOT_FOUND codes (e.g., SPREADSHEET_NOT_FOUND, SHEET_NOT_FOUND)
          return (error.code as string).includes('NOT_FOUND');
        }),
        { numRuns: 500 }
      );
    });

    it('authentication errors should always have PERMISSION_DENIED code', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'missing_token' as const,
            'invalid_token' as const,
            'expired_token' as const,
            'insufficient_scopes' as const
          ),
          (reason) => {
            const error = createAuthenticationError({
              reason,
            });

            return error.code === 'PERMISSION_DENIED';
          }
        ),
        { numRuns: 500 }
      );
    });

    it('validation errors should always have INVALID_REQUEST code', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          (field, value) => {
            const error = createValidationError({
              field,
              value,
            });

            return error.code === 'INVALID_REQUEST';
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Error Message Properties', () => {
    it('error messages should never be empty', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (resourceId) => {
          const error = createNotFoundError({
            resourceId,
            resourceType: 'sheet',
          });

          return error.message.length > 0;
        }),
        { numRuns: 500 }
      );
    });

    it('error messages should contain relevant information', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (field) => {
          const error = createValidationError({
            field,
            value: 'test',
          });

          // Message should contain the field name
          return error.message.includes(field);
        }),
        { numRuns: 500 }
      );
    });

    it('errors should have proper structure', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return (
            typeof error.code === 'string' &&
            typeof error.message === 'string' &&
            typeof error.category === 'string' &&
            typeof error.severity === 'string'
          );
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Error Context Preservation', () => {
    it('resourceId should be preserved in NOT_FOUND errors', () => {
      fc.assert(
        fc.property(
          fc.string({
            minLength: 20,
            maxLength: 60,
            unit: fc.constantFrom(
              ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('')
            ),
          }),
          (resourceId) => {
            const error = createNotFoundError({
              resourceId,
              resourceType: 'spreadsheet',
            });

            return error.details.resourceId === resourceId;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('retryAfterMs should be preserved for rate limit errors', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1000, max: 7200000 }), (retryAfterMs) => {
          const error = createRateLimitError({
            retryAfterMs,
            quotaType: 'read',
          });

          return error.retryAfterMs === retryAfterMs;
        }),
        { numRuns: 500 }
      );
    });

    it('validation error field should be preserved', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), (field) => {
          const error = createValidationError({
            field,
            value: 'test',
          });

          return error.details.field === field;
        }),
        { numRuns: 500 }
      );
    });

    it('operation should be preserved in permission errors', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 50 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return error.details.operation === operation;
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Error Type Classification', () => {
    it('retriable errors should have isRetriable flag', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1000, max: 3600000 }), (retryAfterMs) => {
          const error = createRateLimitError({
            retryAfterMs,
            quotaType: 'write',
          });

          return error.retryable === true;
        }),
        { numRuns: 500 }
      );
    });

    it('permission errors should not be retriable', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return error.retryable === false;
        }),
        { numRuns: 500 }
      );
    });

    it('non-expired authentication errors should not be retriable', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'missing_token' as const,
            'invalid_token' as const,
            'insufficient_scopes' as const
          ),
          (reason) => {
            const error = createAuthenticationError({
              reason,
            });

            return error.retryable === false;
          }
        ),
        { numRuns: 500 }
      );
    });

    it('expired_token authentication errors should be retriable', () => {
      const error = createAuthenticationError({ reason: 'expired_token' });
      expect(error.retryable).toBe(true);
    });

    it('validation errors should not be retriable', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (field) => {
          const error = createValidationError({
            field,
            value: 'invalid',
          });

          return error.retryable === false;
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Error Categories', () => {
    it('permission errors should have auth category', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return error.category === 'auth';
        }),
        { numRuns: 500 }
      );
    });

    it('rate limit errors should have quota category', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1000 }), (retryAfterMs) => {
          const error = createRateLimitError({
            retryAfterMs,
          });

          return error.category === 'quota';
        }),
        { numRuns: 500 }
      );
    });

    it('not found errors should have client category', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 5 }), (resourceId) => {
          const error = createNotFoundError({
            resourceId,
            resourceType: 'sheet',
          });

          return error.category === 'client';
        }),
        { numRuns: 500 }
      );
    });

    it('validation errors should have client category', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (field) => {
          const error = createValidationError({
            field,
            value: 123,
          });

          return error.category === 'client';
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Error Severity Levels', () => {
    it('all errors should have valid severity levels', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          const validSeverities = ['low', 'medium', 'high', 'critical'];
          return validSeverities.includes(error.severity);
        }),
        { numRuns: 500 }
      );
    });

    it('permission errors should have high severity', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return error.severity === 'high';
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimum retry times', () => {
      const error = createRateLimitError({
        retryAfterMs: 1000,
        quotaType: 'write',
      });

      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryAfterMs).toBe(1000);
    });

    it('should handle very large retryAfter values', () => {
      fc.assert(
        fc.property(fc.integer({ min: 3600000, max: 86400000 }), (largeRetry) => {
          const error = createRateLimitError({
            retryAfterMs: largeRetry,
            quotaType: 'read',
          });

          return error.retryAfterMs === largeRetry;
        }),
        { numRuns: 100 }
      );
    });

    it('should handle various resource types', () => {
      const resourceTypes = [
        'spreadsheet',
        'sheet',
        'range',
        'file',
        'permission',
        'operation',
        'snapshot',
      ] as const;

      for (const resourceType of resourceTypes) {
        const error = createNotFoundError({
          resourceId: 'test-id',
          resourceType,
        });

        // Each resource type maps to a specific *_NOT_FOUND code
        expect(error.code as string).toContain('NOT_FOUND');
        expect(error.details.resourceType).toBe(resourceType);
      }
    });

    it('should handle all authentication failure reasons', () => {
      const reasons = [
        'missing_token',
        'invalid_token',
        'expired_token',
        'insufficient_scopes',
      ] as const;

      for (const reason of reasons) {
        const error = createAuthenticationError({
          reason,
        });

        expect(error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should handle optional parameters', () => {
      const error = createValidationError({
        field: 'testField',
        value: 'testValue',
        expectedFormat: 'string',
        allowedValues: ['a', 'b', 'c'],
      });

      expect(error.code).toBe('INVALID_REQUEST');
      expect(error.details.expectedFormat).toBe('string');
      expect(error.details.allowedValues).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Resolution Steps', () => {
    it('all errors should provide resolution steps', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (operation) => {
          const error = createPermissionError({
            operation,
          });

          return Array.isArray(error.resolutionSteps) && error.resolutionSteps.length > 0;
        }),
        { numRuns: 500 }
      );
    });

    it('all errors should provide a resolution message', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (field) => {
          const error = createValidationError({
            field,
            value: 123,
          });

          return typeof error.resolution === 'string' && error.resolution.length > 0;
        }),
        { numRuns: 500 }
      );
    });
  });
});
