/**
 * ServalSheets - Collaborate Handler Tests
 *
 * Tests for sharing, comments, and version control operations.
 * Covers 29 actions across sharing (8), comments (10), and versions (11)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollaborateHandler } from '../../src/handlers/collaborate.js';
import { SheetsCollaborateOutputSchema } from '../../src/schemas/collaborate.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4, drive_v3 } from 'googleapis';
import {
  createRequestContext,
  runWithRequestContext,
} from '../../src/utils/request-context.js';

// Mock Google Sheets API
const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-spreadsheet-id',
        properties: { title: 'Test Spreadsheet' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      },
    }),
  },
});

// Mock Google Drive API
const createMockDriveApi = () => ({
  files: {
    get: vi.fn().mockResolvedValue({
      data: {
        id: 'test-spreadsheet-id',
        name: 'Test Spreadsheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
    }),
    copy: vi.fn().mockResolvedValue({
      data: { id: 'snapshot-id', name: 'Snapshot - Test Spreadsheet' },
    }),
    export: vi.fn().mockResolvedValue({
      data: Buffer.from('test data'),
    }),
  },
  permissions: {
    list: vi.fn().mockResolvedValue({
      data: {
        permissions: [
          {
            id: 'perm-123',
            type: 'user',
            role: 'writer',
            emailAddress: 'user@example.com',
          },
          {
            id: 'perm-456',
            type: 'user',
            role: 'owner',
            emailAddress: 'owner@example.com',
          },
        ],
      },
    }),
    get: vi.fn().mockResolvedValue({
      data: {
        id: 'perm-123',
        type: 'user',
        role: 'writer',
        emailAddress: 'user@example.com',
      },
    }),
    create: vi.fn().mockResolvedValue({
      data: {
        id: 'new-perm-789',
        type: 'user',
        role: 'reader',
        emailAddress: 'newuser@example.com',
      },
    }),
    update: vi.fn().mockResolvedValue({
      data: {
        id: 'perm-123',
        type: 'user',
        role: 'commenter',
        emailAddress: 'user@example.com',
      },
    }),
    delete: vi.fn().mockResolvedValue({}),
  },
  comments: {
    list: vi.fn().mockResolvedValue({
      data: {
        comments: [
          {
            id: 'comment-1',
            content: 'Test comment',
            author: { displayName: 'Test User' },
            createdTime: '2026-01-15T10:00:00Z',
            resolved: false,
          },
        ],
      },
    }),
    get: vi.fn().mockResolvedValue({
      data: {
        id: 'comment-1',
        content: 'Test comment',
        author: { displayName: 'Test User' },
        createdTime: '2026-01-15T10:00:00Z',
        resolved: false,
      },
    }),
    create: vi.fn().mockResolvedValue({
      data: {
        id: 'new-comment',
        content: 'New comment',
        author: { displayName: 'Test User' },
        createdTime: '2026-01-17T10:00:00Z',
      },
    }),
    update: vi.fn().mockResolvedValue({
      data: {
        id: 'comment-1',
        content: 'Updated comment',
        modifiedTime: '2026-01-17T11:00:00Z',
      },
    }),
    delete: vi.fn().mockResolvedValue({}),
  },
  replies: {
    create: vi.fn().mockResolvedValue({
      data: { id: 'reply-1', content: 'Reply text' },
    }),
    update: vi.fn().mockResolvedValue({
      data: { id: 'reply-1', content: 'Updated reply' },
    }),
    delete: vi.fn().mockResolvedValue({}),
  },
  revisions: {
    list: vi.fn().mockResolvedValue({
      data: {
        revisions: [
          { id: '1', modifiedTime: '2026-01-15T10:00:00Z' },
          { id: '2', modifiedTime: '2026-01-16T10:00:00Z' },
        ],
      },
    }),
    get: vi.fn().mockResolvedValue({
      data: { id: '2', modifiedTime: '2026-01-16T10:00:00Z' },
    }),
    update: vi.fn().mockResolvedValue({
      data: { id: '2', keepForever: true },
    }),
  },
});

// Create mock context
const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {
    compile: vi.fn(),
    execute: vi.fn(),
    executeAll: vi.fn(),
  } as any,
  rangeResolver: {
    resolve: vi.fn().mockResolvedValue({
      a1Notation: 'Sheet1!A1:B10',
      sheetId: 0,
      sheetName: 'Sheet1',
    }),
  } as any,
  sheetsApi: createMockSheetsApi() as unknown as sheets_v4.Sheets,
  driveApi: createMockDriveApi() as unknown as drive_v3.Drive,
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
});

describe('CollaborateHandler', () => {
  let handler: CollaborateHandler;
  let mockContext: HandlerContext;
  let mockDriveApi: ReturnType<typeof createMockDriveApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDriveApi = createMockDriveApi();
    mockContext = createMockContext();
    handler = new CollaborateHandler(mockContext, mockDriveApi as any);
  });

  // ===== SHARING ACTIONS =====

  describe('share_list', () => {
    it('should list all permissions', async () => {
      const result = await handler.handle({
        action: 'share_list',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
      const parseResult = SheetsCollaborateOutputSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('share_get', () => {
    it('should get a specific permission', async () => {
      const result = await handler.handle({
        action: 'share_get',
        spreadsheetId: 'test-spreadsheet-id',
        permissionId: 'perm-123',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('share_add', () => {
    it('should add a new permission', async () => {
      const result = await handler.handle({
        action: 'share_add',
        spreadsheetId: 'test-spreadsheet-id',
        type: 'user',
        role: 'reader',
        emailAddress: 'newuser@example.com',
      });

      expect(result.response.success).toBe(true);
    });

    it('should fail fast when type is missing', async () => {
      const result = await handler.handle({
        action: 'share_add',
        spreadsheetId: 'test-spreadsheet-id',
        role: 'reader',
        emailAddress: 'user@example.com',
      } as Parameters<typeof handler.handle>[0]);

      expect(result.response.success).toBe(false);
      expect((result.response as { error?: { message?: string } }).error?.message).toContain(
        'type is required'
      );
    });

    it('should fail fast when type=user and emailAddress is missing', async () => {
      const result = await handler.handle({
        action: 'share_add',
        spreadsheetId: 'test-spreadsheet-id',
        type: 'user',
        role: 'reader',
      });

      expect(result.response.success).toBe(false);
      expect((result.response as { error?: { message?: string } }).error?.message).toContain(
        'emailAddress is required'
      );
    });

    it('should fail fast when type=domain and domain is missing', async () => {
      const result = await handler.handle({
        action: 'share_add',
        spreadsheetId: 'test-spreadsheet-id',
        type: 'domain',
        role: 'reader',
      });

      expect(result.response.success).toBe(false);
      expect((result.response as { error?: { message?: string } }).error?.message).toContain(
        'domain is required'
      );
    });

    it('should fail fast when domain format is invalid', async () => {
      const result = await handler.handle({
        action: 'share_add',
        spreadsheetId: 'test-spreadsheet-id',
        type: 'domain',
        role: 'reader',
        domain: 'https://example.com',
      });

      expect(result.response.success).toBe(false);
      expect((result.response as { error?: { message?: string } }).error?.message).toContain(
        'Invalid domain format'
      );
    });
  });

  describe('share_update', () => {
    it('should update an existing permission', async () => {
      const result = await handler.handle({
        action: 'share_update',
        spreadsheetId: 'test-spreadsheet-id',
        permissionId: 'perm-123',
        role: 'commenter',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('share_remove', () => {
    it('should remove a permission', async () => {
      const result = await handler.handle({
        action: 'share_remove',
        spreadsheetId: 'test-spreadsheet-id',
        permissionId: 'perm-123',
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ===== COMMENT ACTIONS =====

  describe('comment_list', () => {
    it('should list all comments', async () => {
      const result = await handler.handle({
        action: 'comment_list',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('comment_get', () => {
    it('should get a specific comment', async () => {
      const result = await handler.handle({
        action: 'comment_get',
        spreadsheetId: 'test-spreadsheet-id',
        commentId: 'comment-1',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('comment_add', () => {
    it('should add a new comment', async () => {
      const result = await handler.handle({
        action: 'comment_add',
        spreadsheetId: 'test-spreadsheet-id',
        content: 'New comment',
        anchor: 'A1',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('comment_resolve', () => {
    it('should resolve a comment', async () => {
      const result = await handler.handle({
        action: 'comment_resolve',
        spreadsheetId: 'test-spreadsheet-id',
        commentId: 'comment-1',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('comment_add_reply', () => {
    it('should add a reply to a comment', async () => {
      const result = await handler.handle({
        action: 'comment_add_reply',
        spreadsheetId: 'test-spreadsheet-id',
        commentId: 'comment-1',
        content: 'Reply text',
      });

      expect(result.response.success).toBe(true);
    });
  });

  // ===== VERSION ACTIONS =====

  describe('version_list_revisions', () => {
    it('should list all revisions', async () => {
      const result = await handler.handle({
        action: 'version_list_revisions',
        spreadsheetId: 'test-spreadsheet-id',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('version_get_revision', () => {
    it('should get a specific revision', async () => {
      const result = await handler.handle({
        action: 'version_get_revision',
        spreadsheetId: 'test-spreadsheet-id',
        revisionId: '2',
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('version_create_snapshot', () => {
    it('should start an async snapshot task', async () => {
      const result = await handler.handle({
        action: 'version_create_snapshot',
        spreadsheetId: 'test-spreadsheet-id',
        name: 'Before major changes',
        description: 'Snapshot before Q1 update',
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.taskId).toMatch(/^snapshot_/);
        expect(result.response.taskStatus).toBe('working');
      }
    });

    it('should report snapshot task completion via version_snapshot_status', async () => {
      const started = await handler.handle({
        action: 'version_create_snapshot',
        spreadsheetId: 'test-spreadsheet-id',
        name: 'Before major changes',
      });

      expect(started.response.success).toBe(true);
      if (!started.response.success) {
        return;
      }

      await Promise.resolve();
      await Promise.resolve();

      const result = await handler.handle({
        action: 'version_snapshot_status',
        spreadsheetId: 'test-spreadsheet-id',
        taskId: started.response.taskId!,
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.taskStatus).toBe('completed');
        expect(result.response.snapshot?.id).toBe('snapshot-id');
      }
    });
  });

  describe('version_keep_revision', () => {
    it('should mark revision to keep forever', async () => {
      const result = await handler.handle({
        action: 'version_keep_revision',
        spreadsheetId: 'test-spreadsheet-id',
        revisionId: '2',
        keepForever: true,
      });

      expect(result.response.success).toBe(true);
    });
  });

  describe('progress notifications (tranche E)', () => {
    it('should emit progress notifications for version_list_revisions with afterRevisionId cursor', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'version-list-progress',
        progressToken: 'version-list-progress',
        sendNotification: notification,
      });

      mockDriveApi.revisions.list.mockResolvedValue({
        data: {
          revisions: [
            { id: 'rev-1', modifiedTime: '2026-01-15T10:00:00Z' },
            { id: 'rev-2', modifiedTime: '2026-01-16T10:00:00Z' },
            { id: 'rev-3', modifiedTime: '2026-01-17T10:00:00Z' },
          ],
          // No nextPageToken → single page
        },
      });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'version_list_revisions',
          spreadsheetId: 'test-spreadsheet-id',
          afterRevisionId: 'rev-1',
        })
      );

      expect(result.response.success).toBe(true);
      // Should have emitted at least the initial progress notification
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });

    it('should emit progress notifications for version_compare when resolving head references', async () => {
      const notification = vi.fn().mockResolvedValue(undefined);
      const requestContext = createRequestContext({
        requestId: 'version-compare-progress',
        progressToken: 'version-compare-progress',
        sendNotification: notification,
      });

      mockDriveApi.revisions.list.mockResolvedValue({
        data: {
          revisions: [
            { id: 'rev-1' },
            { id: 'rev-2' },
            { id: 'rev-3' },
          ],
        },
      });
      mockDriveApi.revisions.get
        .mockResolvedValueOnce({
          data: { id: 'rev-3', modifiedTime: '2026-01-17T10:00:00Z', size: '1024' },
        })
        .mockResolvedValueOnce({
          data: { id: 'rev-2', modifiedTime: '2026-01-16T10:00:00Z', size: '900' },
        });

      const result = await runWithRequestContext(requestContext, () =>
        handler.handle({
          action: 'version_compare',
          spreadsheetId: 'test-spreadsheet-id',
          revisionId1: 'head~1',
          revisionId2: 'head',
        })
      );

      expect(result.response.success).toBe(true);
      // Should have emitted progress during revision resolution
      expect(notification).toHaveBeenCalled();
      expect(notification.mock.calls[0]?.[0]).toMatchObject({
        method: 'notifications/progress',
        params: expect.objectContaining({ progress: 0 }),
      });
    });
  });
});
