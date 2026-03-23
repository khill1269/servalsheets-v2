/**
 * ServalSheets - Category 6 Collaboration Tests (Simulation)
 *
 * Tests for sharing, comments, approvals, and snapshots
 * Note: These are integration tests verifying action dispatch, not full E2E tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollaborateHandler } from '../../src/handlers/collaborate.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4, drive_v3 } from 'googleapis';

const createMockSheetsApi = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        spreadsheetId: 'test-sheet-id',
        properties: { title: 'Test Sheet' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({ data: { replies: [] } }),
  },
});

const createMockDriveApi = () => ({
  files: {
    get: vi.fn().mockResolvedValue({ data: { id: 'test-sheet-id', name: 'Test Sheet' } }),
    copy: vi.fn().mockResolvedValue({ data: { id: 'snapshot-id' } }),
  },
  permissions: {
    list: vi.fn().mockResolvedValue({ data: { permissions: [] } }),
    create: vi.fn().mockResolvedValue({ data: { id: 'perm-new' } }),
    update: vi.fn().mockResolvedValue({ data: { id: 'perm-2' } }),
    delete: vi.fn().mockResolvedValue({}),
  },
});

const createMockContext = (): HandlerContext => ({
  googleClient: {} as any,
  batchCompiler: {} as any,
  rangeResolver: { resolve: vi.fn().mockResolvedValue({ a1Notation: 'Sheet1!A1:B2' }) } as any,
  auth: { scopes: ['https://www.googleapis.com/auth/drive.file'] } as any,
  samplingServer: undefined,
  snapshotService: {
    create: vi.fn().mockResolvedValue({ snapshotId: 'snap-123' }),
    restore: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue({ snapshots: [] }),
    delete: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ snapshotId: 'snap-123' }),
  } as any,
  sessionContext: {} as any,
  confirmDestructiveAction: vi.fn().mockResolvedValue(undefined),
  createSnapshotIfNeeded: vi.fn().mockResolvedValue({ snapshotId: 'snap-123' }),
  sendProgress: vi.fn(),
  cachedApi: {} as any,
});

describe('Category 6: Collaboration Operations', () => {
  let handler: CollaborateHandler;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApi>;
  let mockDriveApi: ReturnType<typeof createMockDriveApi>;
  let mockContext: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSheetsApi = createMockSheetsApi();
    mockDriveApi = createMockDriveApi();
    mockContext = createMockContext();
    handler = new CollaborateHandler(mockContext, mockSheetsApi as unknown as sheets_v4.Sheets, mockDriveApi as unknown as drive_v3.Drive);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('6.1 share_add dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'share_add',
        spreadsheetId: 'test-sheet-id',
        type: 'user',
        role: 'writer',
        emailAddress: 'user@example.com',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.2 share_list dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'share_list', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.3 share_get dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'share_get', spreadsheetId: 'test-sheet-id', permissionId: 'perm-1' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.4 share_update dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'share_update',
        spreadsheetId: 'test-sheet-id',
        permissionId: 'perm-1',
        role: 'reader',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.5 share_remove dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'share_remove', spreadsheetId: 'test-sheet-id', permissionId: 'perm-1' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.6 share_set_link dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'share_set_link', spreadsheetId: 'test-sheet-id', enabled: true },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.7 share_get_link dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'share_get_link', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.8 comment_add dispatches', async () => {
    mockSheetsApi.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addComment: { comment: { commentId: 'c1' } } }] },
    });
    const result = await handler.handle({
      request: { action: 'comment_add', spreadsheetId: 'test-sheet-id', content: 'Test comment' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.9 comment_list dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'comment_list', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.10 approval_create dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'approval_create',
        spreadsheetId: 'test-sheet-id',
        description: 'Budget Review',
        approvers: ['approver@example.com'],
        requiredApprovals: 1,
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.11 approval_approve dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'approval_approve', spreadsheetId: 'test-sheet-id', approvalId: 'apr-1' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.12 undo dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'undo', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.13 redo dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'redo', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.14 version_create_snapshot dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'version_create_snapshot', spreadsheetId: 'test-sheet-id', name: 'Backup' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.15 version_list_snapshots dispatches', async () => {
    const result = await handler.handle({
      request: { action: 'version_list_snapshots', spreadsheetId: 'test-sheet-id' },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.16 version_restore_snapshot dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'version_restore_snapshot',
        spreadsheetId: 'test-sheet-id',
        snapshotId: 'snap-123',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.17 version_delete_snapshot dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'version_delete_snapshot',
        spreadsheetId: 'test-sheet-id',
        snapshotId: 'snap-123',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });

  it('6.18 diff_revisions dispatches', async () => {
    const result = await handler.handle({
      request: {
        action: 'diff_revisions',
        spreadsheetId: 'test-sheet-id',
        revisionId1: 'rev-1',
        revisionId2: 'rev-2',
      },
    });
    expect(result).toBeDefined();
    expect(result.response).toBeDefined();
  });
});
