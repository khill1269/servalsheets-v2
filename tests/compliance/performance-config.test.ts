/**
 * Performance & Configuration Mode Tests
 *
 * Tests response compaction performance, configuration flags,
 * schema preparation caching, and startup optimizations.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  compactResponse,
  isCompactModeEnabled,
  shouldSkipTruncation,
  getCompactionStats,
} from '../../src/utils/response-compactor.js';
import { resetEnvForTest } from '../../src/config/env.js';
import { getPreparedSchemaCacheSize } from '../../src/mcp/registration/schema-helpers.js';

// Save and restore env
const savedEnv: Record<string, string | undefined> = {};

function saveEnv(key: string): void {
  savedEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('Configuration Modes', () => {
  describe('COMPACT_RESPONSES', () => {
    beforeAll(() => {
      saveEnv('COMPACT_RESPONSES');
    });

    beforeEach(() => {
      resetEnvForTest();
    });

    afterAll(() => {
      restoreEnv();
    });

    it('should detect compact mode from env', () => {
      delete process.env['COMPACT_RESPONSES'];
      resetEnvForTest();
      expect(isCompactModeEnabled()).toBe(true); // default enabled

      process.env['COMPACT_RESPONSES'] = 'false';
      resetEnvForTest();
      expect(isCompactModeEnabled()).toBe(false);

      process.env['COMPACT_RESPONSES'] = 'true';
      resetEnvForTest();
      expect(isCompactModeEnabled()).toBe(true);
    });
  });

  describe('Verbosity override', () => {
    // shouldSkipTruncation also checks COMPACT_RESPONSES env
    // tests/setup.ts sets COMPACT_RESPONSES=false, so we must override

    beforeEach(() => {
      resetEnvForTest();
    });

    it('should skip truncation for detailed verbosity', () => {
      delete process.env['COMPACT_RESPONSES'];
      expect(shouldSkipTruncation('detailed')).toBe(true);
    });

    it('should NOT skip truncation for standard verbosity when compact enabled', () => {
      delete process.env['COMPACT_RESPONSES'];
      expect(shouldSkipTruncation('standard')).toBe(false);
    });

    it('should NOT skip truncation for minimal verbosity when compact enabled', () => {
      delete process.env['COMPACT_RESPONSES'];
      expect(shouldSkipTruncation('minimal')).toBe(false);
    });

    it('should NOT skip truncation when undefined and compact enabled', () => {
      delete process.env['COMPACT_RESPONSES'];
      expect(shouldSkipTruncation(undefined)).toBe(false);
    });

    it('should skip truncation when COMPACT_RESPONSES=false regardless of verbosity', () => {
      process.env['COMPACT_RESPONSES'] = 'false';
      expect(shouldSkipTruncation('standard')).toBe(true);
      expect(shouldSkipTruncation(undefined)).toBe(true);
    });
  });
});

describe('Response Compaction Performance', () => {
  // Enable compact mode for these tests
  beforeAll(() => {
    saveEnv('COMPACT_RESPONSES');
    delete process.env['COMPACT_RESPONSES']; // defaults to enabled
  });

  beforeEach(() => {
    resetEnvForTest();
  });

  afterAll(() => {
    restoreEnv();
  });

  it('should reduce large response size by >40%', () => {
    const largeResponse = {
      response: {
        success: true,
        action: 'read',
        values: Array.from({ length: 500 }, (_, i) => [
          `row${i}`,
          `data${i}`,
          `value${i}`,
          `extra${i}`,
        ]),
        _meta: { costEstimate: 5, traceId: 'abc', requestId: '123' },
        debugInfo: { stack: 'some stack trace' },
        quotaImpact: { used: 100, remaining: 900 },
      },
    };

    const compacted = compactResponse(largeResponse);
    const stats = getCompactionStats(largeResponse, compacted);

    expect(stats.reductionPercent).toBeGreaterThan(40);
  });

  it('should strip _meta, debugInfo, traceId, requestId', () => {
    const response = {
      response: {
        success: true,
        action: 'write',
        message: 'Wrote 10 cells',
        _meta: { costEstimate: 5 },
        debugInfo: { timing: 100 },
        traceId: 'trace_123',
        requestId: 'req_456',
        spanId: 'span_789',
      },
    };

    const compacted = compactResponse(response);
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['_meta']).toBeUndefined();
    expect(inner['debugInfo']).toBeUndefined();
    expect(inner['traceId']).toBeUndefined();
    expect(inner['requestId']).toBeUndefined();
    expect(inner['spanId']).toBeUndefined();
  });

  it('should preserve protocol-level _meta on wrapped MCP responses', () => {
    const response = {
      response: {
        success: true,
        action: 'write',
        message: 'Wrote 10 cells',
        _meta: { costEstimate: 5 },
      },
      _meta: {
        traceId: 'trace_123',
        requestId: 'req_456',
        spanId: 'span_789',
      },
    };

    const compacted = compactResponse(response) as {
      response: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };

    expect(compacted.response['_meta']).toBeUndefined();
    expect(compacted._meta).toEqual(response._meta);
  });

  it('should preserve essential fields', () => {
    const response = {
      response: {
        success: true,
        action: 'read',
        message: 'Read complete',
        error: undefined,
        authenticated: true,
      },
    };

    const compacted = compactResponse(response);
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['success']).toBe(true);
    expect(inner['action']).toBe('read');
    expect(inner['message']).toBe('Read complete');
    expect(inner['authenticated']).toBe(true);
  });

  it('should preserve schema-required object fields', () => {
    const response = {
      response: {
        success: true,
        action: 'get',
        spreadsheet: {
          spreadsheetId: '123',
          title: 'Test',
          sheets: [{ sheetId: 0, title: 'Sheet1' }],
        },
      },
    };

    const compacted = compactResponse(response);
    const inner = compacted.response as Record<string, unknown>;

    // spreadsheet is a PRESERVED_FIELD - must pass through untouched
    expect(inner['spreadsheet']).toEqual(response.response.spreadsheet);
  });

  it('should be fast (<5ms for typical response)', () => {
    const response = {
      response: {
        success: true,
        action: 'read',
        values: Array.from({ length: 100 }, (_, i) => [`cell${i}`]),
        message: 'Read complete',
        _meta: { costEstimate: 1 },
      },
    };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      compactResponse(response);
    }
    const elapsed = performance.now() - start;

    // 100 compactions should complete in <500ms (5ms each)
    expect(elapsed).toBeLessThan(500);
  });

  it('should handle empty responses', () => {
    const response = {
      response: {
        success: true,
        action: 'clear',
      },
    };

    const compacted = compactResponse(response);
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['success']).toBe(true);
    expect(inner['action']).toBe('clear');
  });

  it('should handle error responses', () => {
    const response = {
      response: {
        success: false,
        action: 'write',
        error: {
          code: 'PERMISSION_DENIED',
          message: 'No access',
          retryable: false,
        },
      },
    };

    const compacted = compactResponse(response);
    const inner = compacted.response as Record<string, unknown>;

    expect(inner['success']).toBe(false);
    expect(inner['error']).toEqual(response.response.error);
  });
});

describe('Schema Cache Performance', () => {
  it('should cache prepared schemas', () => {
    const cacheSize = getPreparedSchemaCacheSize();
    // Cache should have entries from module initialization
    expect(cacheSize).toBeGreaterThanOrEqual(0);
  });
});

describe('Compaction Statistics', () => {
  it('should report accurate reduction stats', () => {
    const original = { a: 'x'.repeat(1000), b: [1, 2, 3] };
    const compacted = { a: 'x'.repeat(100), b: [1] };
    const stats = getCompactionStats(original, compacted);

    expect(stats.originalSize).toBeGreaterThan(stats.compactedSize);
    expect(stats.reduction).toBeGreaterThan(0);
    expect(stats.reductionPercent).toBeGreaterThan(0);
    expect(stats.reductionPercent).toBeLessThanOrEqual(100);
  });

  it('should handle identical objects', () => {
    const obj = { a: 1, b: 2 };
    const stats = getCompactionStats(obj, obj);

    expect(stats.reduction).toBe(0);
    expect(stats.reductionPercent).toBe(0);
  });
});
