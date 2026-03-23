/**
 * @serval/core — Typed Error Classes
 *
 * Verifies that all exported error classes are instantiable, carry the correct
 * error codes, and serialize correctly to ErrorDetail.
 *
 * ISSUE-075 (#38): Required for v0.2.0 npm publish readiness.
 */

import { describe, it, expect } from 'vitest';
import {
  ServiceError,
  ConfigError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  DataError,
  QuotaExceededError,
  ApiTimeoutError,
  ServalError,
} from '../../../packages/serval-core/src/errors/errors.js';

describe('@serval/core — error classes', () => {
  describe('ServiceError', () => {
    it('carries code, serviceName, and retryable flag', () => {
      const err = new ServiceError('DB unavailable', 'SERVICE_UNAVAILABLE', 'Postgres', true);
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
      expect(err.serviceName).toBe('Postgres');
      expect(err.retryable).toBe(true);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ServalError);
    });

    it('toErrorDetail includes resolution hint for retryable errors', () => {
      const err = new ServiceError('timeout', 'TIMEOUT', 'BigQuery', true);
      const detail = err.toErrorDetail();
      expect(detail.code).toBe('TIMEOUT');
      expect(detail.retryable).toBe(true);
      expect(detail.resolution).toContain('Retry');
    });

    it('toErrorDetail includes config hint for non-retryable errors', () => {
      const err = new ServiceError('misconfigured', 'CONFIG_ERROR', 'Auth', false);
      const detail = err.toErrorDetail();
      expect(detail.retryable).toBe(false);
      expect(detail.resolution).toBeDefined();
    });

    it('has name set to ServiceError', () => {
      const err = new ServiceError('test', 'UNKNOWN_ERROR', 'test', false);
      expect(err.name).toBe('ServiceError');
    });
  });

  describe('ConfigError', () => {
    it('carries configKey and code CONFIG_ERROR', () => {
      const err = new ConfigError('REDIS_URL missing', 'REDIS_URL');
      expect(err.code).toBe('CONFIG_ERROR');
      expect(err.configKey).toBe('REDIS_URL');
      expect(err.retryable).toBe(false);
    });

    it('toErrorDetail includes the config key in details', () => {
      const err = new ConfigError('bad env', 'DATABASE_URL');
      const detail = err.toErrorDetail();
      expect(detail.details?.['configKey']).toBe('DATABASE_URL');
    });
  });

  describe('ValidationError', () => {
    it('carries field and expectedFormat when provided', () => {
      const err = new ValidationError('must be positive', 'amount', 'positive number');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.field).toBe('amount');
      expect(err.expectedFormat).toBe('positive number');
      expect(err.retryable).toBe(false);
    });

    it('works without optional expectedFormat', () => {
      const err = new ValidationError('bad input', 'range');
      expect(err.field).toBe('range');
      expect(err.expectedFormat).toBeUndefined();
    });
  });

  describe('NotFoundError', () => {
    it('carries resourceType and resourceId', () => {
      // NotFoundError(resourceType, resourceId) — auto-generates message
      const err = new NotFoundError('Sheet', 'Sales');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.resourceType).toBe('Sheet');
      expect(err.resourceId).toBe('Sales');
      expect(err.message).toContain('Sales');
    });

    it('toErrorDetail includes resource info in details', () => {
      const err = new NotFoundError('Spreadsheet', 'abc123');
      const detail = err.toErrorDetail();
      expect(detail.details?.['resourceType']).toBe('Spreadsheet');
      expect(detail.details?.['resourceId']).toBe('abc123');
    });
  });

  describe('AuthenticationError', () => {
    it('defaults to AUTH_ERROR code', () => {
      const err = new AuthenticationError('token expired');
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.retryable).toBe(false);
    });

    it('accepts custom code and retryable flag', () => {
      const err = new AuthenticationError('refresh needed', 'AUTH_ERROR', true);
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.retryable).toBe(true);
    });
  });

  describe('DataError', () => {
    it('defaults to DATA_ERROR code, non-retryable', () => {
      const err = new DataError('corrupt CSV');
      expect(err.code).toBe('DATA_ERROR');
      expect(err.retryable).toBe(false);
    });

    it('accepts custom code and retryable flag', () => {
      const err = new DataError('stale cache', 'STALE_DATA', true);
      expect(err.code).toBe('STALE_DATA');
      expect(err.retryable).toBe(true);
    });
  });

  describe('QuotaExceededError', () => {
    it('carries quotaType and retryAfter, is retryable', () => {
      const err = new QuotaExceededError('rate limited', 'read', 30);
      expect(err.code).toBe('QUOTA_EXCEEDED');
      expect(err.retryable).toBe(true);
      expect(err.retryAfterSeconds).toBe(30);
      expect(err.quotaType).toBe('read');
    });

    it('toErrorDetail includes retryAfter hint', () => {
      const err = new QuotaExceededError('quota', 'write', 60);
      const detail = err.toErrorDetail();
      expect(detail.details?.['retryAfterSeconds']).toBe(60);
    });
  });

  describe('ApiTimeoutError', () => {
    it('carries timeoutMs and operation, is retryable', () => {
      const err = new ApiTimeoutError('timed out', 5000, 'spreadsheets.get');
      expect(err.code).toBe('DEADLINE_EXCEEDED');
      expect(err.retryable).toBe(true);
      expect(err.operation).toBe('spreadsheets.get');
      expect(err.timeoutMs).toBe(5000);
    });

    it('defaults timeoutMs to 30000 when omitted', () => {
      const err = new ApiTimeoutError('timed out');
      expect(err.timeoutMs).toBe(30000);
    });
  });

  describe('error redaction', () => {
    it('redacts bearer tokens from error messages', () => {
      const err = new ServiceError(
        'Failed with Bearer eyJhbGciOiJSUzI1NiJ9.secret',
        'UNKNOWN_ERROR',
        'Api',
        false
      );
      expect(err.message).not.toContain('eyJhbGciOiJSUzI1NiJ9.secret');
    });

    it('instanceof checks work through inheritance chain', () => {
      const errors = [
        new ServiceError('s', 'UNKNOWN_ERROR', 'X', false),
        new ConfigError('c', 'K'),
        new ValidationError('v'),
        new NotFoundError('n', 'T', 'I'),
        new AuthenticationError('a', 'oauth'),
        new DataError('d', 'csv', 'op'),
        new QuotaExceededError('q', 'read', 10),
        new ApiTimeoutError('t', 'ep', 1000),
      ];
      for (const err of errors) {
        expect(err).toBeInstanceOf(ServalError);
        expect(err).toBeInstanceOf(Error);
      }
    });
  });
});
