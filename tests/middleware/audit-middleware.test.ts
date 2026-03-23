/**
 * Audit Middleware Tests
 *
 * Tests AuditMiddleware.wrap() for mutation, permission, auth, export, and config events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/utils/request-context.js', () => ({
  getRequestContext: vi.fn().mockReturnValue({ requestId: 'req-123' }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AuditMiddleware, createAuditMiddleware } from '../../src/middleware/audit-middleware.js';
import type { AuditLogger } from '../../src/services/audit-logger.js';

function createMockAuditLogger(): AuditLogger {
  return {
    logMutation: vi.fn().mockResolvedValue(undefined),
    logPermissionChange: vi.fn().mockResolvedValue(undefined),
    logAuthentication: vi.fn().mockResolvedValue(undefined),
    logExport: vi.fn().mockResolvedValue(undefined),
    logConfiguration: vi.fn().mockResolvedValue(undefined),
    logToolCall: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogger;
}

describe('AuditMiddleware', () => {
  let mockLogger: AuditLogger;
  let middleware: AuditMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockAuditLogger();
    middleware = new AuditMiddleware(mockLogger);
  });

  describe('createAuditMiddleware', () => {
    it('should create an AuditMiddleware instance', () => {
      const mw = createAuditMiddleware(mockLogger);
      expect(mw).toBeInstanceOf(AuditMiddleware);
    });
  });

  describe('mutation actions', () => {
    it('should log write as mutation', async () => {
      const handler = vi.fn().mockResolvedValue({ cellsModified: 10 });

      const result = await middleware.wrap(
        'sheets_data',
        'write',
        { spreadsheetId: 'abc123', range: 'A1:B10' },
        handler
      );

      expect(result).toEqual({ cellsModified: 10 });
      expect(handler).toHaveBeenCalledOnce();
      expect(mockLogger.logMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'write',
          tool: 'sheets_data',
          outcome: 'success',
        })
      );
    });

    it('should log failure outcome on error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('quota exceeded'));

      await expect(
        middleware.wrap('sheets_data', 'append', { spreadsheetId: 'abc123' }, handler)
      ).rejects.toThrow('quota exceeded');

      expect(mockLogger.logMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'append',
          outcome: 'failure',
          errorMessage: 'quota exceeded',
        })
      );
    });
  });

  describe('permission actions', () => {
    it('should log share_add as permission change', async () => {
      const handler = vi.fn().mockResolvedValue({ shared: true });

      await middleware.wrap(
        'sheets_collaborate',
        'share_add',
        { spreadsheetId: 'abc', role: 'writer', email: 'user@example.com' },
        handler
      );

      expect(mockLogger.logPermissionChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'share_add',
          outcome: 'success',
        })
      );
    });
  });

  describe('authentication actions', () => {
    it('should log authenticate as auth event', async () => {
      const handler = vi.fn().mockResolvedValue({ token: 'xxx' });

      await middleware.wrap('sheets_auth', 'authenticate', {}, handler);

      expect(mockLogger.logAuthentication).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'authenticate',
          outcome: 'success',
        })
      );
    });
  });

  describe('export actions', () => {
    it('should log export_csv as export event', async () => {
      const handler = vi.fn().mockResolvedValue({ recordCount: 500 });

      await middleware.wrap('sheets_data', 'export_csv', { spreadsheetId: 'abc' }, handler);

      expect(mockLogger.logExport).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'export_csv',
          outcome: 'success',
        })
      );
    });
  });

  describe('non-audited actions', () => {
    it('should skip audit for read operations', async () => {
      const handler = vi.fn().mockResolvedValue({ data: [] });

      const result = await middleware.wrap(
        'sheets_data',
        'read_range',
        { spreadsheetId: 'abc' },
        handler
      );

      expect(result).toEqual({ data: [] });
      expect(handler).toHaveBeenCalledOnce();
      expect(mockLogger.logMutation).not.toHaveBeenCalled();
      expect(mockLogger.logPermissionChange).not.toHaveBeenCalled();
      expect(mockLogger.logAuthentication).not.toHaveBeenCalled();
      expect(mockLogger.logExport).not.toHaveBeenCalled();
      expect(mockLogger.logConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('audit logger failure resilience', () => {
    it('should not fail the operation if audit logging throws', async () => {
      vi.mocked(mockLogger.logMutation).mockRejectedValue(new Error('audit db down'));
      const handler = vi.fn().mockResolvedValue({ ok: true });

      const result = await middleware.wrap(
        'sheets_data',
        'write_range',
        { spreadsheetId: 'abc' },
        handler
      );

      // Operation should still succeed even though audit failed
      expect(result).toEqual({ ok: true });
    });
  });
});
