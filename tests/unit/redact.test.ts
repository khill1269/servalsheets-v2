/**
 * ServalSheets - Redaction Utility Tests
 *
 * Comprehensive tests for sensitive data redaction
 */

import { describe, it, expect } from 'vitest';
import {
  redactString,
  redactObject,
  redact,
  isSensitiveField,
  SENSITIVE_FIELD_NAMES,
  SENSITIVE_STRING_PATTERNS,
} from '../../src/utils/redact.js';

describe('Redaction Utility', () => {
  describe('redactString', () => {
    it('should redact Bearer tokens', () => {
      const input = 'Authorization: Bearer ya29.a0ARrdaM_abc123xyz';
      const result = redactString(input);
      expect(result).toBe('Authorization: Bearer [REDACTED]');
      expect(result).not.toContain('ya29');
    });

    it('should redact Google API keys', () => {
      const input = 'API_KEY=AIzaSyDabcdefghijklmnopqrstuvwxyz12345';
      const result = redactString(input);
      expect(result).toBe('API_KEY=AIza[REDACTED]');
      expect(result).not.toContain('SyDabc');
    });

    it('should redact JWT tokens', () => {
      const input =
        'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = redactString(input);
      expect(result).toBe('Token: eyJ[REDACTED]');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should redact tokens in URL query parameters', () => {
      const input = 'https://api.example.com/data?access_token=secret123&other=value';
      const result = redactString(input);
      expect(result).toContain('access_token=[REDACTED]');
      expect(result).not.toContain('secret123');
      expect(result).toContain('other=value'); // Non-sensitive params unchanged
    });

    it('should redact API keys in URL query parameters', () => {
      const input = 'https://sheets.googleapis.com/v4/spreadsheets?key=AIzaSyABCDEF123456';
      const result = redactString(input);
      expect(result).toContain('key=[REDACTED]');
      expect(result).not.toContain('AIzaSyABCDEF');
    });

    it('should redact Basic Auth', () => {
      const input = 'Authorization: Basic dXNlcjpwYXNzd29yZA==';
      const result = redactString(input);
      expect(result).toBe('Authorization: Basic [REDACTED]');
      expect(result).not.toContain('dXNlcjpwYXNzd29yZA');
    });

    it('should redact AWS access keys', () => {
      const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      const result = redactString(input);
      expect(result).toBe('AWS_ACCESS_KEY_ID=AKIA[REDACTED]');
      expect(result).not.toContain('IOSFODNN7EXAMPLE');
    });

    it('should redact long strings after sensitive keywords', () => {
      const input = 'token: abcdef1234567890abcdef1234567890abcdef12';
      const result = redactString(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('abcdef1234567890');
    });

    it('should preserve non-sensitive strings', () => {
      const input = 'Hello world, this is a normal message without secrets';
      const result = redactString(input);
      expect(result).toBe(input);
    });

    it('should handle empty strings', () => {
      const result = redactString('');
      expect(result).toBe('');
    });

    it('should handle multiple sensitive patterns in one string', () => {
      const input = 'Bearer ya29.abc123 and API key AIzaSyDEF456';
      const result = redactString(input);
      expect(result).toContain('Bearer [REDACTED]');
      expect(result).toContain('AIza[REDACTED]');
      expect(result).not.toContain('ya29');
      expect(result).not.toContain('SyDEF');
    });
  });

  describe('isSensitiveField', () => {
    it('should detect sensitive field names (case-insensitive)', () => {
      expect(isSensitiveField('access_token')).toBe(true);
      expect(isSensitiveField('ACCESS_TOKEN')).toBe(true);
      expect(isSensitiveField('Access_Token')).toBe(true);
      expect(isSensitiveField('accessToken')).toBe(true);
      expect(isSensitiveField('refresh_token')).toBe(true);
      expect(isSensitiveField('password')).toBe(true);
      expect(isSensitiveField('api_key')).toBe(true);
      expect(isSensitiveField('apiKey')).toBe(true);
      expect(isSensitiveField('client_secret')).toBe(true);
      expect(isSensitiveField('clientSecret')).toBe(true);
    });

    it('should not flag non-sensitive field names', () => {
      expect(isSensitiveField('username')).toBe(false);
      expect(isSensitiveField('email')).toBe(false);
      expect(isSensitiveField('name')).toBe(false);
      expect(isSensitiveField('id')).toBe(false);
      expect(isSensitiveField('data')).toBe(false);
    });
  });

  describe('redactObject', () => {
    it('should redact sensitive fields in objects', () => {
      const input = {
        username: 'john',
        access_token: 'secret123',
        email: 'john@example.com',
        refresh_token: 'refresh456',
      };

      const result = redactObject(input);

      expect(result).toEqual({
        username: 'john',
        access_token: '[REDACTED]',
        email: 'john@example.com',
        refresh_token: '[REDACTED]',
      });
    });

    it('should redact nested objects', () => {
      const input = {
        user: {
          name: 'john',
          credentials: {
            password: 'secret123',
            api_key: 'key456',
          },
        },
        public_data: 'visible',
      };

      const result = redactObject(input);

      expect(result).toEqual({
        user: {
          name: 'john',
          credentials: {
            password: '[REDACTED]',
            api_key: '[REDACTED]',
          },
        },
        public_data: 'visible',
      });
    });

    it('should redact sensitive strings in nested values', () => {
      const input = {
        message: 'Authorization: Bearer ya29.secret123',
        data: {
          info: 'API key: AIzaSyDABC123',
        },
      };

      const result = redactObject(input);

      expect(result.message).toContain('Bearer [REDACTED]');
      expect(result.message).not.toContain('ya29');
      expect((result.data as Record<string, string>).info).toContain('AIza[REDACTED]');
    });

    it('should handle arrays', () => {
      const input = {
        tokens: ['Bearer secret1', 'Bearer secret2'],
        data: ['public1', 'public2'],
      };

      const result = redactObject(input);

      expect(result.tokens).toEqual(['Bearer [REDACTED]', 'Bearer [REDACTED]']);
      expect(result.data).toEqual(['public1', 'public2']);
    });

    it('should handle circular references', () => {
      const input: Record<string, unknown> = {
        name: 'test',
        access_token: 'secret',
      };
      input['self'] = input; // Circular reference

      const result = redactObject(input);

      expect(result.name).toBe('test');
      expect(result.access_token).toBe('[REDACTED]');
      expect(result.self).toBe('[Circular]');
    });

    it('should handle Error objects', () => {
      const error = new Error('Auth failed: token expired ya29.secret123');
      const result = redactObject(error);

      expect(result).toHaveProperty('name', 'Error');
      expect((result as Error).message).toContain('[REDACTED]');
      expect((result as Error).message).not.toContain('ya29');
      expect(result).toHaveProperty('stack');
    });

    it('should preserve primitives', () => {
      const input = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
      };

      const result = redactObject(input);

      expect(result).toEqual({
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
      });
    });

    it('should handle deeply nested structures', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  password: 'deep_secret',
                  public: 'visible',
                },
              },
            },
          },
        },
      };

      const result = redactObject(input);

      expect(
        (
          (
            ((result.level1 as Record<string, unknown>).level2 as Record<string, unknown>)
              .level3 as Record<string, unknown>
          ).level4 as Record<string, unknown>
        ).level5
      ).toEqual({
        password: '[REDACTED]',
        public: 'visible',
      });
    });

    it('should prevent stack overflow on very deep objects', () => {
      let deep: Record<string, unknown> = { value: 'end' };
      for (let i = 0; i < 20; i++) {
        deep = { next: deep };
      }

      const result = redactObject(deep);

      // Should not throw, and should handle gracefully
      expect(result).toBeDefined();
    });

    it('should handle mixed arrays and objects', () => {
      const input = {
        users: [
          { name: 'alice', token: 'Bearer secret1' },
          { name: 'bob', api_key: 'key123' },
        ],
        public: ['data1', 'data2'],
      };

      const result = redactObject(input);

      expect((result.users as Array<Record<string, string>>)[0]).toEqual({
        name: 'alice',
        token: 'Bearer [REDACTED]',
      });
      expect((result.users as Array<Record<string, string>>)[1]).toEqual({
        name: 'bob',
        api_key: '[REDACTED]',
      });
      expect(result.public).toEqual(['data1', 'data2']);
    });
  });

  describe('redact (auto-detect)', () => {
    it('should handle strings', () => {
      const input = 'Bearer ya29.secret123';
      const result = redact(input);
      expect(result).toBe('Bearer [REDACTED]');
    });

    it('should handle objects', () => {
      const input = { access_token: 'secret', name: 'test' };
      const result = redact(input);
      expect(result).toEqual({ access_token: '[REDACTED]', name: 'test' });
    });

    it('should handle primitives unchanged', () => {
      expect(redact(42)).toBe(42);
      expect(redact(true)).toBe(true);
      expect(redact(null)).toBe(null);
      expect(redact(undefined)).toBe(undefined);
    });
  });

  describe('Real-world scenarios', () => {
    it('should redact Google OAuth error response', () => {
      const error = {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked.',
        access_token: 'ya29.a0ARrdaM_abc123',
        refresh_token: '1//0gABC123xyz',
      };

      const result = redactObject(error);

      expect(result.error).toBe('invalid_grant');
      expect(result.error_description).toBe('Token has been expired or revoked.');
      expect(result.access_token).toBe('[REDACTED]');
      expect(result.refresh_token).toBe('[REDACTED]');
    });

    it('should redact HTTP request/response logs', () => {
      const log = {
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: 'Bearer ya29.secret123',
        },
        body: {
          grant_type: 'refresh_token',
          refresh_token: '1//0gSecret456',
          client_secret: 'GOCSPX-abc123def456',
        },
        response: {
          access_token: 'ya29.new_token_789',
          expires_in: 3600,
        },
      };

      const result = redactObject(log);

      expect(result.method).toBe('POST');
      expect((result.headers as Record<string, string>).authorization).toContain('[REDACTED]');
      expect((result.body as Record<string, string>).refresh_token).toBe('[REDACTED]');
      expect((result.body as Record<string, string>).client_secret).toBe('[REDACTED]');
      expect((result.response as Record<string, string>).access_token).toBe('[REDACTED]');
      expect((result.response as Record<string, number>).expires_in).toBe(3600);
    });

    it('should redact error messages with embedded tokens', () => {
      const error = {
        message: 'API request failed with token ya29.abc123: Unauthorized',
        stack: 'Error: API request failed\n    at fetch (/app/api.js:42:10)',
        context: {
          url: 'https://sheets.googleapis.com/v4/spreadsheets?key=AIzaSyD123',
          token: 'Bearer ya29.xyz789',
        },
      };

      const result = redactObject(error);

      expect(result.message).not.toContain('ya29');
      expect(result.message).toContain('[REDACTED]');
      expect(result.stack).toBe(error.stack); // Stack preserved
      expect((result.context as Record<string, string>).url).toContain('[REDACTED]');
      expect((result.context as Record<string, string>).token).toContain('[REDACTED]');
    });

    it('should handle MCP tool error responses', () => {
      const mcpError = {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Authentication failed: Invalid token ya29.abc123. Please re-authenticate.',
          },
        ],
        _meta: {
          request: {
            auth: {
              access_token: 'ya29.secret456',
              refresh_token: '1//0gRefresh789',
            },
          },
        },
      };

      const result = redactObject(mcpError);

      expect((result.content as Array<{ text: string }>)[0].text).not.toContain('ya29.abc123');
      expect((result.content as Array<{ text: string }>)[0].text).toContain('[REDACTED]');
      expect(
        (
          (result._meta as Record<string, unknown>).request as Record<
            string,
            Record<string, string>
          >
        ).auth.access_token
      ).toBe('[REDACTED]');
      expect(
        (
          (result._meta as Record<string, unknown>).request as Record<
            string,
            Record<string, string>
          >
        ).auth.refresh_token
      ).toBe('[REDACTED]');
    });
  });

  describe('Edge cases', () => {
    it('should handle null and undefined', () => {
      expect(redactObject(null)).toBe(null);
      expect(redactObject(undefined)).toBe(undefined);
    });

    it('should handle empty objects', () => {
      const result = redactObject({});
      expect(result).toEqual({});
    });

    it('should handle empty arrays', () => {
      const result = redactObject([]);
      expect(result).toEqual([]);
    });

    it('should handle objects with only sensitive fields', () => {
      const input = {
        access_token: 'secret1',
        refresh_token: 'secret2',
        password: 'secret3',
      };

      const result = redactObject(input);

      expect(result).toEqual({
        access_token: '[REDACTED]',
        refresh_token: '[REDACTED]',
        password: '[REDACTED]',
      });
    });

    it('should handle strings without sensitive data', () => {
      const input = 'This is a completely normal string with no secrets';
      const result = redactString(input);
      expect(result).toBe(input);
    });
  });

  describe('Configuration constants', () => {
    it('SENSITIVE_FIELD_NAMES should be a Set', () => {
      expect(SENSITIVE_FIELD_NAMES).toBeInstanceOf(Set);
      expect(SENSITIVE_FIELD_NAMES.size).toBeGreaterThan(0);
    });

    it('SENSITIVE_STRING_PATTERNS should be an array of pattern objects', () => {
      expect(Array.isArray(SENSITIVE_STRING_PATTERNS)).toBe(true);
      expect(SENSITIVE_STRING_PATTERNS.length).toBeGreaterThan(0);

      SENSITIVE_STRING_PATTERNS.forEach((pattern) => {
        expect(pattern).toHaveProperty('pattern');
        expect(pattern).toHaveProperty('replacement');
        expect(pattern).toHaveProperty('description');
        expect(pattern.pattern).toBeInstanceOf(RegExp);
      });
    });
  });
});
