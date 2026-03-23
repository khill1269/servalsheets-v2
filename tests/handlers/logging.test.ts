/**
 * ServalSheets - Logging Handler Tests
 *
 * Tests for log level management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLoggingSetLevel, getCurrentLogLevel } from '../../src/handlers/logging.js';
import { LoggingSetLevelResponseSchema } from '../../src/schemas/logging.js';
import type { McpLoggingLevel } from '../../src/schemas/logging.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    level: 'info',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Logging Handler', () => {
  let originalLevel: string;

  beforeEach(async () => {
    const { logger } = await import('../../src/utils/logger.js');
    originalLevel = logger.level;
    logger.level = 'info'; // Reset to default
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { logger } = await import('../../src/utils/logger.js');
    logger.level = originalLevel; // Restore original level
  });

  describe('handleLoggingSetLevel', () => {
    it('should change log level from info to debug', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'debug' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.previousLevel).toBe('info');
      expect(result.newLevel).toBe('debug');
      expect(logger.level).toBe('debug');

      // Validate against schema
      const parseResult = LoggingSetLevelResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should change log level from info to error', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'error' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.previousLevel).toBe('info');
      expect(result.newLevel).toBe('error');
      expect(logger.level).toBe('error');
    });

    it('should change log level from info to warning', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'warning' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.previousLevel).toBe('info');
      expect(result.newLevel).toBe('warn'); // Winston uses 'warn' not 'warning'
      expect(logger.level).toBe('warn');
    });

    it('should handle all MCP log levels', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const levels: McpLoggingLevel[] = [
        'debug',
        'info',
        'notice',
        'warning',
        'error',
        'critical',
        'alert',
        'emergency',
      ];

      for (const level of levels) {
        const result = await handleLoggingSetLevel({ level });
        expect(result.success).toBe(true);
        expect(result.newLevel).toBeDefined();
        expect(logger.level).toBeDefined();
      }
    });

    it('should map emergency to error level', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'emergency' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.newLevel).toBe('error');
      expect(logger.level).toBe('error');
    });

    it('should map critical to error level', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'critical' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.newLevel).toBe('error');
      expect(logger.level).toBe('error');
    });

    it('should map alert to error level', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'alert' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.newLevel).toBe('error');
    });

    it('should map notice to info level', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      const result = await handleLoggingSetLevel({
        level: 'notice' as McpLoggingLevel,
      });

      expect(result.success).toBe(true);
      expect(result.newLevel).toBe('info');
      expect(logger.level).toBe('info');
    });

    it('should log the level change', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      await handleLoggingSetLevel({ level: 'debug' as McpLoggingLevel });

      expect(logger.info).toHaveBeenCalledWith(
        'Log level changed via MCP logging/setLevel',
        expect.objectContaining({
          previousLevel: 'info',
          newLevel: 'debug',
          mcpLevel: 'debug',
        })
      );
    });

    it('should return previous level correctly', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'warn';

      const result = await handleLoggingSetLevel({
        level: 'debug' as McpLoggingLevel,
      });

      expect(result.previousLevel).toBe('warn');
      expect(result.newLevel).toBe('debug');
    });
  });

  describe('getCurrentLogLevel', () => {
    it('should return current MCP log level', () => {
      const level = getCurrentLogLevel();
      expect(level).toBe('info'); // Default level
    });

    it('should map Winston debug to MCP debug', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'debug';

      const level = getCurrentLogLevel();
      expect(level).toBe('debug');
    });

    it('should map Winston warn to MCP warning', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'warn';

      const level = getCurrentLogLevel();
      expect(level).toBe('warning');
    });

    it('should map Winston error to MCP error', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'error';

      const level = getCurrentLogLevel();
      expect(level).toBe('error');
    });

    it('should map Winston info to MCP info', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'info';

      const level = getCurrentLogLevel();
      expect(level).toBe('info');
    });

    it('should handle unknown Winston levels', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'unknown-level';

      const level = getCurrentLogLevel();
      expect(level).toBe('info'); // Fallback to info
    });
  });

  describe('level persistence', () => {
    it('should persist level changes across multiple calls', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      await handleLoggingSetLevel({ level: 'debug' as McpLoggingLevel });
      expect(logger.level).toBe('debug');

      await handleLoggingSetLevel({ level: 'error' as McpLoggingLevel });
      expect(logger.level).toBe('error');

      await handleLoggingSetLevel({ level: 'info' as McpLoggingLevel });
      expect(logger.level).toBe('info');
    });

    it('should maintain level after multiple operations', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      await handleLoggingSetLevel({ level: 'warning' as McpLoggingLevel });

      const level1 = getCurrentLogLevel();
      expect(level1).toBe('warning');

      const level2 = getCurrentLogLevel();
      expect(level2).toBe('warning');

      expect(logger.level).toBe('warn');
    });
  });

  describe('schema validation', () => {
    it('should validate successful response', async () => {
      const result = await handleLoggingSetLevel({
        level: 'debug' as McpLoggingLevel,
      });

      const parseResult = LoggingSetLevelResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('should have all required fields', async () => {
      const result = await handleLoggingSetLevel({
        level: 'info' as McpLoggingLevel,
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('previousLevel');
      expect(result).toHaveProperty('newLevel');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.newLevel).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('should handle setting same level twice', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      await handleLoggingSetLevel({ level: 'info' as McpLoggingLevel });
      const result = await handleLoggingSetLevel({ level: 'info' as McpLoggingLevel });

      expect(result.success).toBe(true);
      expect(result.previousLevel).toBe('info');
      expect(result.newLevel).toBe('info');
      expect(logger.level).toBe('info');
    });

    it('should handle rapid level changes', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      await handleLoggingSetLevel({ level: 'debug' as McpLoggingLevel });
      await handleLoggingSetLevel({ level: 'error' as McpLoggingLevel });
      const result = await handleLoggingSetLevel({ level: 'warning' as McpLoggingLevel });

      expect(result.success).toBe(true);
      expect(result.previousLevel).toBe('error');
      expect(result.newLevel).toBe('warn');
      expect(logger.level).toBe('warn');
    });
  });

  describe('integration with logger', () => {
    it('should affect what gets logged', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      // Set to error level - debug should not log
      await handleLoggingSetLevel({ level: 'error' as McpLoggingLevel });
      expect(logger.level).toBe('error');

      // Set to debug level - all should log
      await handleLoggingSetLevel({ level: 'debug' as McpLoggingLevel });
      expect(logger.level).toBe('debug');
    });

    it('should log info about level change at info level', async () => {
      const { logger } = await import('../../src/utils/logger.js');
      logger.level = 'info';
      vi.clearAllMocks();

      await handleLoggingSetLevel({ level: 'debug' as McpLoggingLevel });

      expect(logger.info).toHaveBeenCalled();
    });
  });
});
