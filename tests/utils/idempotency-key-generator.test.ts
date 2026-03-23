/**
 * Idempotency Key Generator Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateIdempotencyKey,
  generateRequestFingerprint,
  validateIdempotencyKey,
  normalizeIdempotencyKey,
  extractIdempotencyKeyFromHeaders,
} from '../../src/utils/idempotency-key-generator.js';

describe('IdempotencyKeyGenerator', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate valid UUID v4', () => {
      const key = generateIdempotencyKey();

      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateIdempotencyKey());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe('generateRequestFingerprint', () => {
    it('should generate deterministic hash for same input', () => {
      const params = { spreadsheetId: '123', range: 'A1', values: [[1, 2]] };

      const fp1 = generateRequestFingerprint('sheets_data', 'write', params);
      const fp2 = generateRequestFingerprint('sheets_data', 'write', params);

      expect(fp1).toBe(fp2);
      expect(fp1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    });

    it('should generate different hashes for different params', () => {
      const params1 = { spreadsheetId: '123', range: 'A1' };
      const params2 = { spreadsheetId: '456', range: 'A1' };

      const fp1 = generateRequestFingerprint('sheets_data', 'read', params1);
      const fp2 = generateRequestFingerprint('sheets_data', 'read', params2);

      expect(fp1).not.toBe(fp2);
    });

    it('should generate different hashes for different actions', () => {
      const params = { spreadsheetId: '123', range: 'A1' };

      const fp1 = generateRequestFingerprint('sheets_data', 'read', params);
      const fp2 = generateRequestFingerprint('sheets_data', 'write', params);

      expect(fp1).not.toBe(fp2);
    });

    it('should normalize object key order', () => {
      const params1 = { a: 1, b: 2, c: 3 };
      const params2 = { c: 3, a: 1, b: 2 };

      const fp1 = generateRequestFingerprint('sheets_data', 'write', params1);
      const fp2 = generateRequestFingerprint('sheets_data', 'write', params2);

      expect(fp1).toBe(fp2);
    });
  });

  describe('validateIdempotencyKey', () => {
    it('should accept valid UUID v4', () => {
      const key = '550e8400-e29b-41d4-a716-446655440000';
      expect(validateIdempotencyKey(key)).toBe(true);
    });

    it('should accept alphanumeric keys of valid length', () => {
      expect(validateIdempotencyKey('abcdef1234567890')).toBe(true); // 16 chars
      expect(validateIdempotencyKey('abcdef123456789012345')).toBe(true); // 21 chars
      expect(validateIdempotencyKey('abc-def-123-456-789')).toBe(true); // 19 chars
    });

    it('should reject keys that are too short', () => {
      expect(validateIdempotencyKey('abc')).toBe(false);
      expect(validateIdempotencyKey('1234567890123')).toBe(false);
    });

    it('should reject keys that are too long', () => {
      const longKey = 'a'.repeat(129);
      expect(validateIdempotencyKey(longKey)).toBe(false);
    });

    it('should reject keys with invalid characters', () => {
      expect(validateIdempotencyKey('key-with-spaces key')).toBe(false);
      expect(validateIdempotencyKey('key_with_underscores')).toBe(false);
      expect(validateIdempotencyKey('key@with#special')).toBe(false);
    });

    it('should reject keys with all same character', () => {
      expect(validateIdempotencyKey('aaaaaaaaaaaaaaaa')).toBe(false);
      expect(validateIdempotencyKey('1111111111111111')).toBe(false);
    });

    it('should accept keys with hyphens', () => {
      expect(validateIdempotencyKey('abc-def-123-456-789')).toBe(true);
    });
  });

  describe('normalizeIdempotencyKey', () => {
    it('should lowercase keys', () => {
      expect(normalizeIdempotencyKey('ABC-DEF-123')).toBe('abc-def-123');
      expect(normalizeIdempotencyKey('MixedCase123')).toBe('mixedcase123');
    });

    it('should trim whitespace', () => {
      expect(normalizeIdempotencyKey('  key123  ')).toBe('key123');
      expect(normalizeIdempotencyKey('\tkey456\n')).toBe('key456');
    });
  });

  describe('extractIdempotencyKeyFromHeaders', () => {
    it('should extract from X-Idempotency-Key header', () => {
      const headers = {
        'x-idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should extract from Idempotency-Key header', () => {
      const headers = {
        'idempotency-key': '550e8400-e29b-41d4-a716-446655440000',
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should prefer X-Idempotency-Key over Idempotency-Key', () => {
      const headers = {
        'x-idempotency-key': 'key1-123456789012345',
        'idempotency-key': 'key2-123456789012345',
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBe('key1-123456789012345');
    });

    it('should handle array header values', () => {
      const headers = {
        'x-idempotency-key': ['550e8400-e29b-41d4-a716-446655440000', 'duplicate'],
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should return undefined if header missing', () => {
      const headers = {
        'content-type': 'application/json',
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBeUndefined();
    });

    it('should return undefined if key invalid', () => {
      const headers = {
        'x-idempotency-key': 'invalid',
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBeUndefined();
    });

    it('should normalize extracted keys', () => {
      const headers = {
        'x-idempotency-key': '  ABC-DEF-123456789  ',
      };

      const key = extractIdempotencyKeyFromHeaders(headers);
      expect(key).toBe('abc-def-123456789');
    });
  });
});
