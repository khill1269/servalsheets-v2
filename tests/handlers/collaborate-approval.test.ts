/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ServalSheets - Collaborate Handler: Approval Action Tests
 *
 * Tests for the 7 approval actions (approval_create, approval_approve,
 * approval_reject, approval_get_status, approval_list_pending,
 * approval_delegate, approval_cancel) which previously had ZERO coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollaborateHandler } from '../../src/handlers/collaborate.js';
import type { HandlerContext } from '../../src/handlers/base.js';
import type { sheets_v4, drive_v3 } from 'googleapis';

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
// Fixtures
// ---------------------------------------------------------------------------

const SPREADSHEET_ID = 'test-spreadsheet-id';
const APPROVAL_ID = 'approval_1700000000000_abc123';
const USER_EMAIL = 'approver@example.com';

/** Build matchedDeveloperMetadata response with both metadataId (for update) and metadataValue (for read). */
function buildDevMetaResponse(approvalData: object) {
  return {
    data: {
      matchedDeveloperMetadata: [
        {
          developerMetadata: {
            metadataId: 42,
            metadataKey: `servalsheets_approval_${APPROVAL_ID}`,
            metadataValue: JSON.stringify(approvalData),
          },
        },
      ],
    },
  };
}

const DEFAULT_APPROVAL = {
  approvalId: APPROVAL_ID,
  spreadsheetId: SPREADSHEET_ID,
  range: 'Sheet1!A1:C10',
  status: 'pending',
  requester: { displayName: 'Request Creator', emailAddress: undefined },
  approvers: [USER_EMAIL, 'other@example.com'],
  approvedBy: [],
  requiredApprovals: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: undefined,
  message: 'Please review Q1 data',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockDriveApi = () => ({
  about: {
    get: vi.fn().mockResolvedValue({
      data: { user: { emailAddress: USER_EMAIL } },
    }),
  },
  comments: {
    create: vi.fn().mockResolvedValue({ data: { id: 'comment-new' } }),
  },
  files: {
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue({}),
  },
});

const createMockSheetsApiForApprovals = () => ({
  spreadsheets: {
    get: vi.fn().mockResolvedValue({
      data: {
        sheets: [
          {
            properties: { sheetId: 0, title: 'Sheet1' },
            protectedRanges: [],
          },
        ],
      },
    }),
    batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    developerMetadata: {
      search: vi.fn().mockResolvedValue(buildDevMetaResponse(DEFAULT_APPROVAL)),
    },
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
        a1Notation: 'Sheet1!A1:C10',
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

describe('CollaborateHandler — Approval Actions', () => {
  let handler: CollaborateHandler;
  let mockContext: HandlerContext;
  let mockDriveApi: ReturnType<typeof createMockDriveApi>;
  let mockSheetsApi: ReturnType<typeof createMockSheetsApiForApprovals>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockContext();
    mockDriveApi = createMockDriveApi();
    mockSheetsApi = createMockSheetsApiForApprovals();
    // CollaborateHandler(context, driveApi?, sheetsApi?) — sheetsApi is 3rd constructor arg
    handler = new CollaborateHandler(
      mockContext,
      mockDriveApi as unknown as drive_v3.Drive,
      mockSheetsApi as unknown as sheets_v4.Sheets
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // approval_create
  // =========================================================================

  describe('approval_create', () => {
    it('should create an approval request and return the approval object', async () => {
      // Arrange
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:C10',
        approvers: ['approver1@example.com', 'approver2@example.com'],
        requiredApprovals: 1,
        message: 'Please review Q1 data',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_create');
      expect(response.approval.approvalId).toMatch(/^approval_/);
      expect(response.approval.status).toBe('pending');
      expect(response.approval.approvers).toEqual(['approver1@example.com', 'approver2@example.com']);
      expect(response.approval.approvedBy).toEqual([]);
      expect(response.approval.requiredApprovals).toBe(1);
      expect(response.approval.range).toBe('Sheet1!A1:C10');
      // createDeveloperMetadata then addProtectedRange = 2 batchUpdate calls
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(2);
      // get called once for sheetId lookup
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalledOnce();
    });

    it('should return error when range cannot be parsed', async () => {
      // Act — pass a range that parseA1Notation returns null for
      const result = await handler.handle({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'INVALID!!!###',
        approvers: ['approver@example.com'],
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should return NOT_FOUND when the referenced sheet is not in the spreadsheet', async () => {
      // Arrange — spreadsheet has "DifferentSheet", not "Sheet1"
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: { sheets: [{ properties: { sheetId: 0, title: 'DifferentSheet' } }] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:C10',
        approvers: ['approver@example.com'],
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('should succeed even when Drive comment creation fails (non-critical path)', async () => {
      // Arrange
      mockDriveApi.comments.create.mockRejectedValue(new Error('Drive API unavailable'));
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:C10',
        approvers: ['approver@example.com'],
      } as any);

      // Assert — comment failure is caught internally; approval is still created
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.approval.approvalId).toBeDefined();
    });
  });

  // =========================================================================
  // approval_approve
  // =========================================================================

  describe('approval_approve', () => {
    it('should record approval and return updated approval object', async () => {
      // Act
      const result = await handler.handle({
        action: 'approval_approve',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_approve');
      expect(response.approval.approvedBy).toContain(USER_EMAIL);
      // getApprovalMetadata (search x1) + updateApprovalMetadata (search x1 + batchUpdate x1)
      expect(mockSheetsApi.spreadsheets.developerMetadata.search).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
      expect(mockDriveApi.about.get).toHaveBeenCalledOnce();
    });

    it('should return NOT_FOUND when approval metadata does not exist', async () => {
      // Arrange
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: { matchedDeveloperMetadata: [] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_approve',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'nonexistent_approval',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('should return PERMISSION_DENIED when user is not listed as an approver', async () => {
      // Arrange — current user email is not in approval.approvers
      mockDriveApi.about.get.mockResolvedValue({
        data: { user: { emailAddress: 'notanapprover@example.com' } },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_approve',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERMISSION_DENIED');
    });

    it('should return PRECONDITION_FAILED when user has already approved', async () => {
      // Arrange — user already in approvedBy list
      const alreadyApproved = { ...DEFAULT_APPROVAL, approvedBy: [USER_EMAIL] };
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue(
        buildDevMetaResponse(alreadyApproved)
      );

      // Act
      const result = await handler.handle({
        action: 'approval_approve',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PRECONDITION_FAILED');
    });

    it('should set status to approved when requiredApprovals threshold is reached', async () => {
      // Arrange — requiredApprovals=1, approvedBy=[], so one approval completes it
      const oneRequired = { ...DEFAULT_APPROVAL, requiredApprovals: 1, approvedBy: [] };
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue(
        buildDevMetaResponse(oneRequired)
      );
      // removeApprovalProtection: no protectedRanges found → logs and returns
      mockSheetsApi.spreadsheets.get.mockResolvedValue({
        data: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' }, protectedRanges: [] }] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_approve',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.approval.status).toBe('approved');
      expect(response.approval.approvedBy).toContain(USER_EMAIL);
    });
  });

  // =========================================================================
  // approval_reject
  // =========================================================================

  describe('approval_reject', () => {
    it('should mark approval as rejected and return updated approval', async () => {
      // Act
      const result = await handler.handle({
        action: 'approval_reject',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
        reason: 'Data contains errors in column C',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_reject');
      expect(response.approval.status).toBe('rejected');
      // search x2: getApprovalMetadata + updateApprovalMetadata
      expect(mockSheetsApi.spreadsheets.developerMetadata.search).toHaveBeenCalledTimes(2);
    });

    it('should return PERMISSION_DENIED when user is not an approver', async () => {
      // Arrange
      mockDriveApi.about.get.mockResolvedValue({
        data: { user: { emailAddress: 'stranger@example.com' } },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_reject',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERMISSION_DENIED');
    });

    it('should return NOT_FOUND when approval metadata is missing', async () => {
      // Arrange — null matchedDeveloperMetadata (same as empty)
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: { matchedDeveloperMetadata: null },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_reject',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'ghost_approval',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // approval_get_status
  // =========================================================================

  describe('approval_get_status', () => {
    it('should return the approval object for a valid approval ID', async () => {
      // Act
      const result = await handler.handle({
        action: 'approval_get_status',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_get_status');
      expect(response.approval.approvalId).toBe(APPROVAL_ID);
      expect(response.approval.status).toBe('pending');
      // Read-only: exactly 1 search call, no batchUpdate
      expect(mockSheetsApi.spreadsheets.developerMetadata.search).toHaveBeenCalledTimes(1);
      expect(mockSheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });

    it('should return NOT_FOUND for a non-existent approval', async () => {
      // Arrange
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: { matchedDeveloperMetadata: [] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_get_status',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'does_not_exist',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });

  // =========================================================================
  // approval_list_pending
  // =========================================================================

  describe('approval_list_pending', () => {
    it('should return empty array when no approval metadata exists', async () => {
      // Arrange
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: { matchedDeveloperMetadata: [] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_list_pending',
        spreadsheetId: SPREADSHEET_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_list_pending');
      expect(response.approvals).toEqual([]);
    });

    it('should return only pending approvals, filtering out non-pending entries', async () => {
      // Arrange — two items: one pending, one approved
      const pending = { ...DEFAULT_APPROVAL, status: 'pending' };
      const approved = {
        ...DEFAULT_APPROVAL,
        approvalId: 'approval_other',
        status: 'approved',
        approvedBy: [USER_EMAIL],
      };
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: {
          matchedDeveloperMetadata: [
            {
              developerMetadata: {
                metadataId: 42,
                metadataKey: `servalsheets_approval_${APPROVAL_ID}`,
                metadataValue: JSON.stringify(pending),
              },
            },
            {
              developerMetadata: {
                metadataId: 43,
                metadataKey: 'servalsheets_approval_approval_other',
                metadataValue: JSON.stringify(approved),
              },
            },
          ],
        },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_list_pending',
        spreadsheetId: SPREADSHEET_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.approvals).toHaveLength(1);
      expect(response.approvals[0].status).toBe('pending');
      expect(response.approvals[0].approvalId).toBe(APPROVAL_ID);
    });

    it('should silently skip entries with corrupted metadataValue JSON', async () => {
      // Arrange — one valid pending, one with unparseable metadataValue
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: {
          matchedDeveloperMetadata: [
            {
              developerMetadata: {
                metadataId: 42,
                metadataKey: `servalsheets_approval_${APPROVAL_ID}`,
                metadataValue: JSON.stringify(DEFAULT_APPROVAL),
              },
            },
            {
              developerMetadata: {
                metadataId: 99,
                metadataKey: 'servalsheets_approval_corrupt',
                metadataValue: 'NOT_VALID_JSON{{{{',
              },
            },
          ],
        },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_list_pending',
        spreadsheetId: SPREADSHEET_ID,
      } as any);

      // Assert — corrupted entry is silently dropped, valid entry is returned
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.approvals).toHaveLength(1);
    });
  });

  // =========================================================================
  // approval_delegate
  // =========================================================================

  describe('approval_delegate', () => {
    it('should replace the delegating user with the new delegate in approvers list', async () => {
      // Act
      const result = await handler.handle({
        action: 'approval_delegate',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
        delegateTo: 'delegate@example.com',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_delegate');
      expect(response.approval.approvers).toContain('delegate@example.com');
      expect(response.approval.approvers).not.toContain(USER_EMAIL);
      // search x2 + batchUpdate x1
      expect(mockSheetsApi.spreadsheets.developerMetadata.search).toHaveBeenCalledTimes(2);
      expect(mockSheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
    });

    it('should return PERMISSION_DENIED when delegating user is not an approver', async () => {
      // Arrange — current user not in approvers list
      mockDriveApi.about.get.mockResolvedValue({
        data: { user: { emailAddress: 'not_an_approver@example.com' } },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_delegate',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
        delegateTo: 'someone@example.com',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERMISSION_DENIED');
    });
  });

  // =========================================================================
  // approval_cancel
  // =========================================================================

  describe('approval_cancel', () => {
    it('should cancel approval when requester.emailAddress is undefined (open cancel)', async () => {
      // Arrange — DEFAULT_APPROVAL.requester.emailAddress is undefined, so anyone can cancel
      // Act
      const result = await handler.handle({
        action: 'approval_cancel',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(true);
      expect(response.action).toBe('approval_cancel');
      expect(response.approval.status).toBe('cancelled');
      // removeApprovalProtection triggers spreadsheets.get
      expect(mockSheetsApi.spreadsheets.get).toHaveBeenCalled();
    });

    it('should return PERMISSION_DENIED when canceller is not the requester', async () => {
      // Arrange — approval has known requester 'bob@example.com'; current user is USER_EMAIL
      const knownRequester = {
        ...DEFAULT_APPROVAL,
        requester: { displayName: 'Bob', emailAddress: 'bob@example.com' },
      };
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue(
        buildDevMetaResponse(knownRequester)
      );
      mockDriveApi.about.get.mockResolvedValue({
        data: { user: { emailAddress: USER_EMAIL } },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_cancel',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERMISSION_DENIED');
    });

    it('should return NOT_FOUND for a non-existent approval', async () => {
      // Arrange
      mockSheetsApi.spreadsheets.developerMetadata.search.mockResolvedValue({
        data: { matchedDeveloperMetadata: [] },
      });

      // Act
      const result = await handler.handle({
        action: 'approval_cancel',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'phantom_approval',
      } as any);

      // Assert
      const response = result.response as any;
      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('should call createSnapshotIfNeeded before confirmation (safety rail order fixed, ISSUE-013)', async () => {
      // Verifies that approval_cancel now calls createSnapshotIfNeeded() as required by
      // the safety rail invariant (snapshot → confirm → execute). Fixed by ISSUE-013.
      const { createSnapshotIfNeeded: mockSnapshot } = await import(
        '../../src/utils/safety-helpers.js'
      );

      await handler.handle({
        action: 'approval_cancel',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: APPROVAL_ID,
      } as any);

      // Snapshot fires (safety rail now active)
      expect(mockSnapshot).toHaveBeenCalled();
    });
  });
});
