/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - Collaborate Handler: Version Action Tests
 *
 * Tests for version_restore_snapshot, version_delete_snapshot,
 * version_compare, and version_export actions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollaborateHandler } from '../../src/handlers/collaborate.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { drive_v3 } from 'googleapis';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/utils/safety-helpers.js', () => ({
  createSnapshotIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/mcp/elicitation.js', () => ({
  confirmDestructiveAction: vi.fn().mockResolvedValue({ confirmed: true }),
}));

vi.mock('../../src/security/incremental-scope.js', () => {
  const MockScopeValidator = vi.fn().mockImplementation(function (this: any) {
    this.requireScope = vi.fn();
    this.hasScope = vi.fn().mockReturnValue(true);
    this.validateOperation = vi.fn();
    return this;
  });
  return {
    ScopeValidator: MockScopeValidator,
    ScopeCategory: {
      SPREADSHEETS: 'spreadsheets',
      DRIVE: 'drive',
      DRIVE_FILE: 'drive.file',
      SPREADSHEETS_READONLY: 'spreadsheets.readonly',
    },
    IncrementalScopeRequiredError: class extends Error {},
  };
});

vi.mock('../../src/utils/request-context.js', () => ({
  getRequestLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  sendProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/error-factory.js', () => ({
  createNotFoundError: vi.fn((params: any) => ({
    code: 'NOT_FOUND',
    message: `${params.resourceType} not found`,
    retryable: false,
  })),
  createValidationError: vi.fn((params: any) => ({
    code: 'INVALID_PARAMS',
    message: params.reason ?? 'Validation failed',
    retryable: false,
  })),
}));

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const SPREADSHEET_ID = 'test-spreadsheet-id';
const SNAPSHOT_ID = 'snapshot-drive-file-id';

const createMockDriveApi = () => ({
  files: {
    get: vi.fn().mockResolvedValue({
      data: { name: 'Test Spreadsheet', id: SPREADSHEET_ID },
    }),
    copy: vi.fn().mockResolvedValue({
      data: {
        id: 'restored-copy-id',
        name: 'Test Spreadsheet (restored from snapshot)',
        createdTime: '2026-01-20T10:00:00.000Z',
        size: '102400',
      },
    }),
    delete: vi.fn().mockResolvedValue({}),
    export: vi.fn().mockResolvedValue({
      data: Buffer.from('PK\x03\x04xlsx_content_here'),
    }),
  },
  revisions: {
    list: vi.fn().mockResolvedValue({
      data: {
        revisions: [
          { id: '1', modifiedTime: '2026-01-10T08:00:00Z' },
          { id: '2', modifiedTime: '2026-01-15T10:00:00Z' },
          { id: '3', modifiedTime: '2026-01-20T12:00:00Z' },
        ],
      },
    }),
    get: vi.fn()
      .mockResolvedValueOnce({
        data: {
          id: '2',
          modifiedTime: '2026-01-15T10:00:00Z',
          lastModifyingUser: { displayName: 'Alice', emailAddress: 'alice@example.com' },
          size: '51200',
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: '3',
          modifiedTime: '2026-01-20T12:00:00Z',
          lastModifyingUser: { displayName: 'Bob', emailAddress: 'bob@example.com' },
          size: '61440',
        },
      }),
  },
  about: {
    get: vi.fn().mockResolvedValue({
      data: { user: { emailAddress: 'user@example.com' } },
    }),
  },
  comments: {
    create: vi.fn().mockResolvedValue({ data: { id: 'comment-new' } }),
  },
});

const createMockContext = (): HandlerContext =>
  ({
    googleClient: {} as any,
    cachedApi: {} as any,
    samplingServer: undefined,
    elicitationServer: undefined,
    snapshotService: undefined,
    backend: undefined,
    batchCompiler: { compile: vi.fn(), execute: vi.fn(), executeAll: vi.fn() } as any,
    rangeResolver: {
      resolve: vi.fn().mockResolvedValue({
        a1Notation: 'Sheet1!A1:B10',
        sheetId: 0,
        sheetName: 'Sheet1',
      }),
    } as any,
    sheetsApi: {} as any,
    driveApi: {} as any,
    sessionId: 'test-session',
    requestId: 'test-request',
    auth: {
      hasElevatedAccess: true,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
    },
  }) as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollaborateHandler — Version Actions', () => {
  let handler: CollaborateHandler;
  let mockContext: HandlerContext;
  let mockDriveApi: ReturnType<typeof createMockDriveApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockContext();
    mockDriveApi = createMockDriveApi();
    // Version actions only need driveApi (2nd arg); no sheetsApi needed
    handler = new CollaborateHandler(mockContext, mockDriveApi as unknown as drive_v3.Drive);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // version_restore_snapshot
  // =========================================================================

  describe('version_restore_snapshot', () => {
    it('should restore a snapshot by copying the snapshot file', async () => {
      // Act
      const result = await handler.handle({
        action: 'version_restore_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('version_restore_snapshot');
      expect(response.snapshot).toBeDefined();
      expect(response.snapshot.copyId).toBe('restored-copy-id');
      expect(response.snapshot.id).toBe(SNAPSHOT_ID);
      // files.get for original name, then files.copy for the restored version
      expect(mockDriveApi.files.get).toHaveBeenCalledOnce();
      expect(mockDriveApi.files.copy).toHaveBeenCalledOnce();
      expect(mockDriveApi.files.copy).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: SNAPSHOT_ID })
      );
    });

    it('should return dry-run success without calling Drive API', async () => {
      // Act
      const result = await handler.handle({
        action: 'version_restore_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
        safety: { dryRun: true },
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      // No Drive API calls in dry-run mode
      expect(mockDriveApi.files.get).not.toHaveBeenCalled();
      expect(mockDriveApi.files.copy).not.toHaveBeenCalled();
    });

    it('should return error when files.get throws (propagates to mapError)', async () => {
      // Arrange — files.get throws (no inner try/catch in handleVersionRestoreSnapshot)
      mockDriveApi.files.get.mockRejectedValue({ code: 404, message: 'File not found' });

      // Act
      const result = await handler.handle({
        action: 'version_restore_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: 'nonexistent-snapshot',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should include size in snapshot when Drive returns it', async () => {
      // Arrange — files.copy returns size as string (Drive API convention)
      mockDriveApi.files.copy.mockResolvedValue({
        data: {
          id: 'copy-with-size',
          name: 'Restored Spreadsheet',
          createdTime: '2026-01-20T12:00:00.000Z',
          size: '204800',
        },
      });

      // Act
      const result = await handler.handle({
        action: 'version_restore_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.snapshot.size).toBe(204800);
    });
  });

  // =========================================================================
  // version_delete_snapshot
  // =========================================================================

  describe('version_delete_snapshot', () => {
    it('should delete a snapshot file from Drive', async () => {
      // Act
      const result = await handler.handle({
        action: 'version_delete_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('version_delete_snapshot');
      expect(mockDriveApi.files.delete).toHaveBeenCalledOnce();
      expect(mockDriveApi.files.delete).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: SNAPSHOT_ID })
      );
    });

    it('should return dry-run success without calling files.delete', async () => {
      // Act
      const result = await handler.handle({
        action: 'version_delete_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
        safety: { dryRun: true },
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(mockDriveApi.files.delete).not.toHaveBeenCalled();
    });

    it('should call createSnapshotIfNeeded before deleting', async () => {
      // Arrange
      const { createSnapshotIfNeeded } = await import('../../src/utils/safety-helpers.js');

      // Act
      await handler.handle({
        action: 'version_delete_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
      } as any);

      // Assert — snapshot is created before deletion (safety rail)
      expect(createSnapshotIfNeeded).toHaveBeenCalledOnce();
    });

    it('should skip confirmDestructiveAction when elicitationServer is undefined', async () => {
      // Arrange — mockContext.elicitationServer is undefined (set in createMockContext)
      const { confirmDestructiveAction } = await import('../../src/mcp/elicitation.js');

      // Act
      await handler.handle({
        action: 'version_delete_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: SNAPSHOT_ID,
      } as any);

      // Assert — elicitation is skipped when server is unavailable
      expect(confirmDestructiveAction).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // version_compare
  // =========================================================================

  describe('version_compare', () => {
    it('should compare two explicit revision IDs without calling revisions.list', async () => {
      // Arrange — two explicit IDs; neither is 'head' or 'head~1', so no list call needed
      // Act
      const result = await handler.handle({
        action: 'version_compare',
        spreadsheetId: SPREADSHEET_ID,
        revisionId1: '2',
        revisionId2: '3',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('version_compare');
      expect(response.revisions).toHaveLength(2);
      // Only revisions.get x2, no revisions.list
      expect(mockDriveApi.revisions.list).not.toHaveBeenCalled();
      expect(mockDriveApi.revisions.get).toHaveBeenCalledTimes(2);
      expect(mockDriveApi.revisions.get).toHaveBeenCalledWith(
        expect.objectContaining({ revisionId: '2' })
      );
      expect(mockDriveApi.revisions.get).toHaveBeenCalledWith(
        expect.objectContaining({ revisionId: '3' })
      );
    });

    it('should resolve symbolic head/head~1 IDs via revisions.list', async () => {
      // Arrange — 'head' and 'head~1' require resolution
      // Act
      const result = await handler.handle({
        action: 'version_compare',
        spreadsheetId: SPREADSHEET_ID,
        revisionId1: 'head~1',
        revisionId2: 'head',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      // revisions.list called once to resolve symbolic IDs
      expect(mockDriveApi.revisions.list).toHaveBeenCalledOnce();
      // revisions.get called twice (resolved IDs)
      expect(mockDriveApi.revisions.get).toHaveBeenCalledTimes(2);
      // head resolves to latest (id='3'), head~1 resolves to second-to-last (id='2')
      const calls = mockDriveApi.revisions.get.mock.calls;
      const calledIds = calls.map((c: any) => c[0].revisionId);
      expect(calledIds).toContain('2');
      expect(calledIds).toContain('3');
    });

    it('should return INVALID_PARAMS when spreadsheet has fewer than 2 revisions', async () => {
      // Arrange — only 1 revision available
      mockDriveApi.revisions.list.mockResolvedValue({
        data: { revisions: [{ id: '1', modifiedTime: '2026-01-10T08:00:00Z' }] },
      });

      // Act
      const result = await handler.handle({
        action: 'version_compare',
        spreadsheetId: SPREADSHEET_ID,
        revisionId1: 'head~1',
        revisionId2: 'head',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('INVALID_PARAMS');
    });

    it('should return INTERNAL_ERROR when driveApi is not available', async () => {
      // Arrange — handler without driveApi
      const handlerWithoutDrive = new CollaborateHandler(mockContext, undefined);

      // Act
      const result = await handlerWithoutDrive.handle({
        action: 'version_compare',
        spreadsheetId: SPREADSHEET_ID,
        revisionId1: '1',
        revisionId2: '2',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // =========================================================================
  // version_export
  // =========================================================================

  describe('version_export', () => {
    it('should export the current version as base64-encoded xlsx', async () => {
      // Act — no revisionId means export current version
      const result = await handler.handle({
        action: 'version_export',
        spreadsheetId: SPREADSHEET_ID,
        format: 'xlsx',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('version_export');
      expect(response.exportData).toBeDefined();
      expect(typeof response.exportData).toBe('string');
      // Should be base64: no whitespace, only base64 characters
      expect(response.exportData).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(mockDriveApi.files.export).toHaveBeenCalledOnce();
    });

    it('should export when revisionId is "head" (treated as current version)', async () => {
      // Act
      const result = await handler.handle({
        action: 'version_export',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: 'head',
        format: 'csv',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(mockDriveApi.files.export).toHaveBeenCalledOnce();
    });

    it('should return FEATURE_UNAVAILABLE when a specific revision ID is provided', async () => {
      // The Drive API does not support exporting historical revisions directly.
      // Act
      const result = await handler.handle({
        action: 'version_export',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: '2',
        format: 'xlsx',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('FEATURE_UNAVAILABLE');
      expect(response.error.message).toContain('specific revision');
      expect(mockDriveApi.files.export).not.toHaveBeenCalled();
    });

    it('should return NOT_FOUND when files.export returns 404', async () => {
      // Arrange
      mockDriveApi.files.export.mockRejectedValue({ code: 404, message: 'File not found' });

      // Act
      const result = await handler.handle({
        action: 'version_export',
        spreadsheetId: SPREADSHEET_ID,
        format: 'xlsx',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('should return INTERNAL_ERROR for non-404 Drive API failures', async () => {
      // Arrange
      mockDriveApi.files.export.mockRejectedValue({
        code: 500,
        message: 'Internal server error',
        name: 'GaxiosError',
      });

      // Act
      const result = await handler.handle({
        action: 'version_export',
        spreadsheetId: SPREADSHEET_ID,
        format: 'xlsx',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('INTERNAL_ERROR');
    });

    it('should default to xlsx format when format is not specified', async () => {
      // Act — omit format param
      const result = await handler.handle({
        action: 'version_export',
        spreadsheetId: SPREADSHEET_ID,
      } as any);

      // Assert — should still succeed with xlsx mime type
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(mockDriveApi.files.export).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        expect.anything()
      );
    });
  });
});
