/**
 * Tests for Enhanced Startup Error Handling
 *
 * Tests the enhanceStartupError() function that converts raw startup errors
 * into user-friendly messages with actionable resolution steps.
 */

import { describe, it, expect } from 'vitest';
import { enhanceStartupError } from '../../src/utils/enhanced-errors.js';

describe('Enhanced Startup Errors', () => {
  describe('MODULE_NOT_FOUND errors', () => {
    it('should handle missing dist/cli.js with build instructions', () => {
      const error = new Error("Cannot find module '/path/to/dist/cli.js'");
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('BUILD_REQUIRED');
      expect(enhanced.message).toContain('Missing compiled files');
      expect(enhanced.resolution).toContain('Run build command');
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps?.length).toBeGreaterThan(0);
      expect(enhanced.resolutionSteps![0]).toContain('npm run build');
    });

    it('should handle missing dist/server.js with build instructions', () => {
      const error = new Error("Cannot find module '/path/to/dist/server.js'");
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('BUILD_REQUIRED');
      expect(enhanced.message).toContain('Missing compiled files');
      expect(enhanced.resolutionSteps![0]).toContain('npm run build');
    });

    it('should handle missing node_modules with install instructions', () => {
      const error = new Error(
        "Cannot find module '@modelcontextprotocol/sdk'\nRequire stack:\n- /path/to/server.js"
      );
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('DEPENDENCY_MISSING');
      expect(enhanced.message).toContain('Missing required dependency');
      expect(enhanced.message).toContain('@modelcontextprotocol/sdk');
      expect(enhanced.resolution).toContain('Install dependencies');
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps![0]).toContain('npm install');
    });

    it('should handle generic MODULE_NOT_FOUND', () => {
      const error = new Error('Cannot find module something-else');
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('DEPENDENCY_MISSING');
      expect(enhanced.message).toContain('Missing required dependency');
      expect(enhanced.resolution).toBeDefined();
    });
  });

  describe('File system errors', () => {
    it('should handle ENOENT (file not found)', () => {
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('FILE_NOT_FOUND');
      expect(enhanced.message).toContain('Required file or directory not found');
      expect(enhanced.resolution).toContain('Check file paths');
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps![0]).toContain('npm run build');
    });

    it('should handle EACCES (permission denied)', () => {
      const error = new Error('EACCES: permission denied');
      (error as any).code = 'EACCES';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('PERMISSION_DENIED');
      expect(enhanced.message).toContain('Permission denied');
      expect(enhanced.resolution).toContain('Insufficient permissions');
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps!.length).toBeGreaterThan(0);
    });
  });

  describe('Network errors', () => {
    it('should handle EADDRINUSE (port already in use)', () => {
      const error = new Error('EADDRINUSE: address already in use');
      (error as any).code = 'EADDRINUSE';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('PORT_IN_USE');
      expect(enhanced.message).toContain('is already in use');
      expect(enhanced.resolution).toBeDefined();
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps!.some((step) => step.includes('--port'))).toBe(true);
    });

    it('should handle ECONNREFUSED (connection refused)', () => {
      const error = new Error('ECONNREFUSED: connection refused');
      (error as any).code = 'ECONNREFUSED';

      const enhanced = enhanceStartupError(error);

      // ECONNREFUSED triggers Redis connection handler
      expect(enhanced.code).toBe('REDIS_CONNECTION_FAILED');
      expect(enhanced.message).toContain('Cannot connect to Redis server');
      expect(enhanced.resolution).toBeDefined();
    });
  });

  describe('Configuration errors', () => {
    it('should handle invalid ENCRYPTION_KEY', () => {
      const error = new Error('ENCRYPTION_KEY must be 64 hex characters');

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('CONFIG_INVALID');
      expect(enhanced.message).toContain('Invalid encryption key');
      expect(enhanced.resolution).toContain('Set valid encryption key');
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps!.some((step) => step.includes('openssl'))).toBe(true);
    });

    it('should handle invalid environment variable', () => {
      const error = new Error('Environment variable XYZ is required');

      const enhanced = enhanceStartupError(error);

      // Generic errors fall through to default handler
      expect(enhanced.code).toBe('STARTUP_FAILED');
      expect(enhanced.resolution).toBeDefined();
    });
  });

  describe('Redis errors', () => {
    it('should handle Redis connection failure', () => {
      const error = new Error('Redis connection failed: ECONNREFUSED');

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('REDIS_CONNECTION_FAILED');
      expect(enhanced.message).toContain('Cannot connect to Redis server');
      expect(enhanced.resolution).toContain('Redis');
      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps!.some((step) => step.includes('redis-server'))).toBe(true);
    });

    it('should suggest development mode when Redis unavailable', () => {
      const error = new Error('Could not connect to Redis server');

      const enhanced = enhanceStartupError(error);

      expect(enhanced.code).toBe('REDIS_CONNECTION_FAILED');
      expect(enhanced.resolutionSteps!.some((step) => step.includes('NODE_ENV=development'))).toBe(
        true
      );
    });
  });

  describe('Generic errors', () => {
    it('should handle generic Error objects', () => {
      const error = new Error('Something went wrong');

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBeDefined();
      expect(enhanced.resolution).toBeDefined();
      expect(enhanced.resolutionSteps).toBeDefined();
    });

    it('should handle string errors', () => {
      const error = 'String error message';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBe('String error message');
      expect(enhanced.resolution).toBeDefined();
    });

    it('should handle undefined/null errors', () => {
      const enhanced1 = enhanceStartupError(undefined);
      const enhanced2 = enhanceStartupError(null);

      expect(enhanced1.message).toBeDefined();
      expect(enhanced2.message).toBeDefined();
    });

    it('should handle errors with no message', () => {
      const error = new Error();

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBeDefined();
      expect(enhanced.resolution).toBeDefined();
    });
  });

  describe('Error enhancement structure', () => {
    it('should return ErrorDetail with all required fields', () => {
      const error = new Error('Test error');

      const enhanced = enhanceStartupError(error);

      expect(enhanced).toHaveProperty('message');
      expect(enhanced).toHaveProperty('code');
      expect(enhanced).toHaveProperty('resolution');
      expect(enhanced).toHaveProperty('resolutionSteps');
      expect(enhanced).toHaveProperty('retryable');
      expect(typeof enhanced.message).toBe('string');
      expect(typeof enhanced.code).toBe('string');
    });

    it('should mark build errors as non-retryable', () => {
      const error = new Error("Cannot find module '/path/to/dist/cli.js'");
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.retryable).toBe(false);
    });

    it('should mark network errors as potentially retryable', () => {
      const error = new Error('ECONNREFUSED: connection refused');
      (error as any).code = 'ECONNREFUSED';

      const enhanced = enhanceStartupError(error);

      // Network errors might be retryable after fixing the issue
      expect(enhanced.retryable).toBeDefined();
    });

    it('should include helpful context in resolution steps', () => {
      const error = new Error("Cannot find module '/path/to/dist/cli.js'");
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.resolutionSteps).toBeDefined();
      expect(enhanced.resolutionSteps!.length).toBeGreaterThan(1);
      // Should have numbered steps
      expect(enhanced.resolutionSteps![0]).toMatch(/^1\./);
    });
  });

  describe('Edge cases', () => {
    it('should handle errors with very long messages', () => {
      const longMessage = 'Error: '.repeat(1000);
      const error = new Error(longMessage);

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBeDefined();
      expect(enhanced.message.length).toBeLessThan(longMessage.length * 2);
    });

    it('should handle errors with special characters', () => {
      const error = new Error('Error with "quotes" and \'apostrophes\' and \n newlines');

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBeDefined();
      expect(enhanced.resolution).toBeDefined();
    });

    it('should handle errors with stack traces', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at Object.<anonymous> (/path/to/file.js:10:15)';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBe('Test error');
      expect(enhanced.resolution).toBeDefined();
    });
  });

  describe('Integration with existing error system', () => {
    it('should use enhanceError internally for known error codes', () => {
      const error = new Error("Cannot find module '/path/to/dist/cli.js'");
      error.name = 'MODULE_NOT_FOUND';

      const enhanced = enhanceStartupError(error);

      // Should have been enhanced with the standard enhanceError function
      expect(enhanced.code).toBe('BUILD_REQUIRED');
      expect(enhanced.message).toBeDefined();
      expect(enhanced.resolution).toBeDefined();
      expect(enhanced.resolutionSteps).toBeDefined();
    });

    it('should preserve error context when available', () => {
      const error = new Error('ENOENT: no such file or directory /path/to/file.txt');
      (error as any).code = 'ENOENT';
      (error as any).path = '/path/to/file.txt';

      const enhanced = enhanceStartupError(error);

      expect(enhanced.message).toBeDefined();
      expect(enhanced.resolution).toBeDefined();
    });
  });
});
