/**
 * Tests for mapStandaloneError() helper
 *
 * Verifies that catch blocks in standalone handlers produce
 * valid ErrorCode enum values from src/schemas/shared.ts.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { mapStandaloneError } from '../../src/handlers/helpers/error-mapping.js';
import { ErrorCodeSchema } from '../../src/schemas/shared.js';
import {
  ValidationError,
  NotFoundError,
  AuthenticationError,
  ServiceError,
  ConfigError,
} from '../../src/core/errors.js';

// Helper: asserts code is a valid ErrorCode enum member
function assertValidCode(code: string): void {
  const result = ErrorCodeSchema.safeParse(code);
  expect(result.success, `Expected '${code}' to be a valid ErrorCode`).toBe(true);
}

describe('mapStandaloneError()', () => {
  describe('plain Error', () => {
    it('returns INTERNAL_ERROR code for generic Error', () => {
      const err = new Error('something went wrong');
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('INTERNAL_ERROR');
      assertValidCode(mapped.code);
    });

    it('preserves message from generic Error', () => {
      const err = new Error('detailed failure');
      const mapped = mapStandaloneError(err);
      expect(mapped.message).toBe('detailed failure');
    });

    it('marks generic errors as not retryable (unknown if safe to retry)', () => {
      const mapped = mapStandaloneError(new Error('oops'));
      expect(mapped.retryable).toBe(false);
    });

    it('preserves explicit known error codes on generic Error instances', () => {
      const err = Object.assign(new Error('bad request'), { code: 'INVALID_PARAMS' });
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('INVALID_PARAMS');
      assertValidCode(mapped.code);
    });

    it('maps config-like generic errors to CONFIG_ERROR', () => {
      const mapped = mapStandaloneError(
        new Error('OPENAI_API_KEY environment variable is missing for AI suggestions')
      );
      expect(mapped.code).toBe('CONFIG_ERROR');
      assertValidCode(mapped.code);
    });
  });

  describe('non-Error values', () => {
    it('returns INTERNAL_ERROR code for string throw', () => {
      const mapped = mapStandaloneError('unexpected string error');
      expect(mapped.code).toBe('INTERNAL_ERROR');
      assertValidCode(mapped.code);
    });

    it('stringifies non-Error values in message', () => {
      const mapped = mapStandaloneError('my error string');
      expect(mapped.message).toBe('my error string');
    });

    it('handles null thrown', () => {
      const mapped = mapStandaloneError(null);
      expect(mapped.code).toBe('INTERNAL_ERROR');
      assertValidCode(mapped.code);
      expect(typeof mapped.message).toBe('string');
    });
  });

  describe('ValidationError', () => {
    it('returns VALIDATION_ERROR code', () => {
      const err = new ValidationError('bad value', 'spreadsheetId');
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('VALIDATION_ERROR');
      assertValidCode(mapped.code);
    });

    it('preserves message', () => {
      const err = new ValidationError('field is required', 'range');
      const mapped = mapStandaloneError(err);
      expect(mapped.message).toBe('field is required');
    });

    it('marks as not retryable', () => {
      const err = new ValidationError('bad format', 'action');
      const mapped = mapStandaloneError(err);
      expect(mapped.retryable).toBe(false);
    });
  });

  describe('ZodError', () => {
    it('maps request validation failures to INVALID_PARAMS', () => {
      const schema = z.object({
        action: z.enum(['read', 'write']),
      });

      const parsed = schema.safeParse({ action: 'append' });
      expect(parsed.success).toBe(false);

      const mapped = mapStandaloneError(parsed.error);
      expect(mapped.code).toBe('INVALID_PARAMS');
      expect(mapped.retryable).toBe(false);
      assertValidCode(mapped.code);
    });
  });

  describe('NotFoundError', () => {
    it('returns NOT_FOUND code', () => {
      const err = new NotFoundError('operation', 'op_123');
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('NOT_FOUND');
      assertValidCode(mapped.code);
    });

    it('marks as not retryable', () => {
      const err = new NotFoundError('snapshot', 'snap_456');
      const mapped = mapStandaloneError(err);
      expect(mapped.retryable).toBe(false);
    });
  });

  describe('AuthenticationError', () => {
    it('returns AUTH_ERROR code by default', () => {
      const err = new AuthenticationError('token expired');
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('AUTH_ERROR');
      assertValidCode(mapped.code);
    });

    it('returns custom code when provided', () => {
      const err = new AuthenticationError('insufficient scope', 'INSUFFICIENT_PERMISSIONS', false);
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('INSUFFICIENT_PERMISSIONS');
      assertValidCode(mapped.code);
    });
  });

  describe('ServiceError', () => {
    it('returns the code from ServiceError', () => {
      const err = new ServiceError('service down', 'SERVICE_NOT_INITIALIZED', 'webhooks', false);
      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('SERVICE_NOT_INITIALIZED');
      assertValidCode(mapped.code);
    });

    it('propagates retryable flag', () => {
      const err = new ServiceError('transient', 'UNAVAILABLE', 'redis', true);
      const mapped = mapStandaloneError(err);
      expect(mapped.retryable).toBe(true);
    });
  });

  describe('Google API shaped errors', () => {
    it('maps nested Google API invalid range failures to INVALID_RANGE', () => {
      const err = Object.assign(new Error('Unable to parse range: Sheet1!A:B'), {
        response: {
          status: 400,
          data: {
            error: {
              code: 400,
              message: 'Unable to parse range: Sheet1!A:B',
              errors: [{ reason: 'invalidRange', message: 'Bad range' }],
            },
          },
        },
      });

      const mapped = mapStandaloneError(err);
      expect(mapped.code).toBe('INVALID_RANGE');
      expect(mapped.retryable).toBe(false);
      assertValidCode(mapped.code);
    });
  });

  describe('all returned codes are valid ErrorCode enum values', () => {
    it('every error type produces a valid code', () => {
      const inputs: unknown[] = [
        new Error('generic'),
        new ValidationError('bad', 'field'),
        new ConfigError('missing key', 'OPENAI_API_KEY'),
        new NotFoundError('resource', 'id'),
        new AuthenticationError('auth fail'),
        new ServiceError('svc fail', 'SERVICE_NOT_INITIALIZED', 'test', false),
        'plain string',
        42,
        null,
        undefined,
      ];

      for (const input of inputs) {
        const mapped = mapStandaloneError(input);
        assertValidCode(mapped.code);
      }
    });
  });

  describe('return shape matches ErrorDetail structure', () => {
    it('always returns code and message', () => {
      const mapped = mapStandaloneError(new Error('x'));
      expect(typeof mapped.code).toBe('string');
      expect(typeof mapped.message).toBe('string');
    });

    it('optional fields are correct types when present', () => {
      const mapped = mapStandaloneError(new Error('x'));
      if (mapped.details !== undefined) {
        expect(typeof mapped.details).toBe('object');
      }
      if (mapped.retryable !== undefined) {
        expect(typeof mapped.retryable).toBe('boolean');
      }
    });
  });
});
