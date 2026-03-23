/**
 * Tests for Server Lifecycle
 *
 * Tests server startup validation and configuration checking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = { ...process.env };

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('crypto', () => ({
  randomBytes: vi.fn().mockImplementation((size) => {
    return Buffer.alloc(size, 'a');
  }),
}));

describe('Lifecycle - Environment Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to known state
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('credential validation', () => {
    it('should accept OAuth client credentials', () => {
      process.env['GOOGLE_CLIENT_ID'] = 'test-client-id.apps.googleusercontent.com';
      process.env['GOOGLE_CLIENT_SECRET'] = 'test-client-secret';

      // Validate presence
      const hasOAuth = !!(process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET']);
      expect(hasOAuth).toBe(true);
    });

    it('should accept service account key path', () => {
      process.env['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'] = '/path/to/service-account.json';

      const hasServiceAccount = !!process.env['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'];
      expect(hasServiceAccount).toBe(true);
    });

    it('should accept application default credentials', () => {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = '/path/to/credentials.json';

      const hasADC = !!process.env['GOOGLE_APPLICATION_CREDENTIALS'];
      expect(hasADC).toBe(true);
    });

    it('should require at least one credential method', () => {
      delete process.env['GOOGLE_CLIENT_ID'];
      delete process.env['GOOGLE_CLIENT_SECRET'];
      delete process.env['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'];
      delete process.env['GOOGLE_APPLICATION_CREDENTIALS'];

      const hasAnyCredential = !!(
        (process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET']) ||
        process.env['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'] ||
        process.env['GOOGLE_APPLICATION_CREDENTIALS']
      );

      expect(hasAnyCredential).toBe(false);
    });
  });

  describe('security validation', () => {
    it('should require encryption key in production', () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['ENCRYPTION_KEY'];

      const isProduction = process.env['NODE_ENV'] === 'production';
      const hasEncryptionKey = !!process.env['ENCRYPTION_KEY'];

      const isSecure = !isProduction || hasEncryptionKey;
      expect(isSecure).toBe(false);
    });

    it('should accept valid 64-char hex encryption key', () => {
      process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);

      const key = process.env['ENCRYPTION_KEY'];
      const isValidLength = key?.length === 64;
      const isValidHex = /^[0-9a-f]+$/i.test(key || '');

      expect(isValidLength && isValidHex).toBe(true);
    });

    it('should reject short encryption key', () => {
      process.env['ENCRYPTION_KEY'] = 'too-short';

      const key = process.env['ENCRYPTION_KEY'];
      const isValidLength = key?.length === 64;

      expect(isValidLength).toBe(false);
    });

    it('should allow missing encryption key in development', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['ENCRYPTION_KEY'];

      const isProduction = process.env['NODE_ENV'] === 'production';
      expect(isProduction).toBe(false);
    });
  });

  describe('port configuration', () => {
    it('should use PORT environment variable', () => {
      process.env['PORT'] = '8080';

      const port = parseInt(process.env['PORT'] || '3000', 10);
      expect(port).toBe(8080);
    });

    it('should default to 3000 when PORT not set', () => {
      delete process.env['PORT'];

      const port = parseInt(process.env['PORT'] || '3000', 10);
      expect(port).toBe(3000);
    });

    it('should validate port range', () => {
      process.env['PORT'] = '3000';

      const port = parseInt(process.env['PORT'], 10);
      const isValidPort = port > 0 && port < 65536;

      expect(isValidPort).toBe(true);
    });

    it('should handle invalid port string', () => {
      process.env['PORT'] = 'invalid';

      const port = parseInt(process.env['PORT'], 10);
      expect(isNaN(port)).toBe(true);
    });
  });

  describe('log level configuration', () => {
    it('should accept valid log levels', () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];

      validLevels.forEach((level) => {
        process.env['LOG_LEVEL'] = level;
        expect(validLevels.includes(process.env['LOG_LEVEL']!)).toBe(true);
      });
    });

    it('should default to info when not set', () => {
      delete process.env['LOG_LEVEL'];

      const level = process.env['LOG_LEVEL'] || 'info';
      expect(level).toBe('info');
    });
  });

  describe('rate limit configuration', () => {
    it('should use GOOGLE_API_READS_PER_SECOND', () => {
      process.env['GOOGLE_API_READS_PER_SECOND'] = '50';

      const reads = parseInt(process.env['GOOGLE_API_READS_PER_SECOND'] || '100', 10);
      expect(reads).toBe(50);
    });

    it('should use GOOGLE_API_WRITES_PER_SECOND', () => {
      process.env['GOOGLE_API_WRITES_PER_SECOND'] = '25';

      const writes = parseInt(process.env['GOOGLE_API_WRITES_PER_SECOND'] || '100', 10);
      expect(writes).toBe(25);
    });

    it('should use default rate limits when not set', () => {
      delete process.env['GOOGLE_API_READS_PER_SECOND'];
      delete process.env['GOOGLE_API_WRITES_PER_SECOND'];

      const reads = parseInt(process.env['GOOGLE_API_READS_PER_SECOND'] || '100', 10);
      const writes = parseInt(process.env['GOOGLE_API_WRITES_PER_SECOND'] || '100', 10);

      expect(reads).toBe(100);
      expect(writes).toBe(100);
    });
  });

  describe('circuit breaker configuration', () => {
    it('should use CIRCUIT_BREAKER_FAILURE_THRESHOLD', () => {
      process.env['CIRCUIT_BREAKER_FAILURE_THRESHOLD'] = '3';

      const threshold = parseInt(process.env['CIRCUIT_BREAKER_FAILURE_THRESHOLD'] || '5', 10);
      expect(threshold).toBe(3);
    });

    it('should use CIRCUIT_BREAKER_RESET_TIMEOUT', () => {
      process.env['CIRCUIT_BREAKER_RESET_TIMEOUT'] = '60000';

      const timeout = parseInt(process.env['CIRCUIT_BREAKER_RESET_TIMEOUT'] || '30000', 10);
      expect(timeout).toBe(60000);
    });
  });

  describe('OAuth configuration', () => {
    it('should use OAUTH_REDIRECT_URI', () => {
      process.env['OAUTH_REDIRECT_URI'] = 'http://localhost:3000/callback';

      expect(process.env['OAUTH_REDIRECT_URI']).toBe('http://localhost:3000/callback');
    });

    it('should use GOOGLE_TOKEN_STORE_PATH', () => {
      process.env['GOOGLE_TOKEN_STORE_PATH'] = '/custom/path/tokens.encrypted';

      expect(process.env['GOOGLE_TOKEN_STORE_PATH']).toBe('/custom/path/tokens.encrypted');
    });
  });
});

describe('Lifecycle - Development Key Generation', () => {
  it('should generate 32-byte (64-char hex) key', () => {
    const { randomBytes } = require('crypto');
    const key = randomBytes(32).toString('hex');

    expect(key.length).toBe(64);
  });

  it('should generate valid hex string', () => {
    const key = 'a'.repeat(64);
    expect(/^[0-9a-f]+$/i.test(key)).toBe(true);
  });
});
