/**
 * ServalSheets - Collaborate Handler
 *
 * Consolidated collaboration operations: sharing, comments, version control, and approvals
 * Merges: sharing.ts (8 actions) + comments.ts (10 actions) + versions.ts (11 actions) + approvals (7 actions) + access_proposals (2 actions) = 41 actions
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { drive_v3 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import type {
  SheetsCollaborateInput,
  SheetsCollaborateOutput,
  CollaborateResponse,
  CollaborateRequest,
  CollaborateShareAddInput,
  CollaborateShareUpdateInput,
  CollaborateShareRemoveInput,
  CollaborateShareListInput,
  CollaborateShareGetInput,
  CollaborateShareTransferOwnershipInput,
  CollaborateShareSetLinkInput,
  CollaborateShareGetLinkInput,
  CollaborateCommentAddInput,
  CollaborateCommentUpdateInput,
  CollaborateCommentDeleteInput,
  CollaborateCommentListInput,
  CollaborateCommentGetInput,
  CollaborateCommentResolveInput,
  CollaborateCommentReopenInput,
  CollaborateCommentAddReplyInput,
  CollaborateCommentUpdateReplyInput,
  CollaborateCommentDeleteReplyInput,
  CollaborateVersionListRevisionsInput,
  CollaborateVersionGetRevisionInput,
  CollaborateVersionRestoreRevisionInput,
  CollaborateVersionKeepRevisionInput,
  CollaborateVersionCreateSnapshotInput,
  CollaborateVersionListSnapshotsInput,
  CollaborateVersionRestoreSnapshotInput,
  CollaborateVersionDeleteSnapshotInput,
  CollaborateVersionCompareInput,
  CollaborateVersionExportInput,
  CollaborateVersionSnapshotStatusInput,
  CollaborateApprovalCreateInput,
  CollaborateApprovalApproveInput,
  CollaborateApprovalRejectInput,
  CollaborateApprovalGetStatusInput,
  CollaborateApprovalListPendingInput,
  CollaborateApprovalDelegateInput,
  CollaborateApprovalCancelInput,
  CollaborateListAccessProposalsInput,
  CollaborateResolveAccessProposalInput,
  CollaborateLabelListInput,
  CollaborateLabelApplyInput,
  CollaborateLabelRemoveInput,
} from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import {
  ScopeValidator,
  ScopeCategory,
  IncrementalScopeRequiredError,
} from '../security/incremental-scope.js';
import {
  handleShareAddAction,
  handleShareUpdateAction,
  handleShareRemoveAction,
  handleShareListAction,
  handleShareGetAction,
  handleShareTransferOwnershipAction,
  handleShareSetLinkAction,
  handleShareGetLinkAction,
} from './collaborate-actions/sharing.js';
import {
  handleCommentAddAction,
  handleCommentUpdateAction,
  handleCommentDeleteAction,
  handleCommentListAction,
  handleCommentGetAction,
  handleCommentResolveAction,
  handleCommentReopenAction,
  handleCommentAddReplyAction,
  handleCommentUpdateReplyAction,
  handleCommentDeleteReplyAction,
} from './collaborate-actions/comments.js';
import {
  handleVersionListRevisionsAction,
  handleVersionGetRevisionAction,
  handleVersionRestoreRevisionAction,
  handleVersionKeepRevisionAction,
  handleVersionCreateSnapshotAction,
  handleVersionSnapshotStatusAction,
  handleVersionListSnapshotsAction,
  handleVersionRestoreSnapshotAction,
  handleVersionDeleteSnapshotAction,
  handleVersionCompareAction,
  handleVersionExportAction,
} from './collaborate-actions/versions.js';
import {
  handleApprovalCreateAction,
  handleApprovalApproveAction,
  handleApprovalRejectAction,
  handleApprovalGetStatusAction,
  handleApprovalListPendingAction,
  handleApprovalDelegateAction,
  handleApprovalCancelAction,
} from './collaborate-actions/approvals.js';
import {
  handleListAccessProposalsAction,
  handleResolveAccessProposalAction,
  handleLabelListAction,
  handleLabelApplyAction,
  handleLabelRemoveAction,
} from './collaborate-actions/access-labels.js';

type CollaborateSuccess = Extract<CollaborateResponse, { success: true }>;

export class CollaborateHandler extends BaseHandler<
  SheetsCollaborateInput,
  SheetsCollaborateOutput
> {
  private driveApi: drive_v3.Drive | undefined;
  private sheetsApi: import('googleapis').sheets_v4.Sheets | undefined;

  constructor(
    context: HandlerContext,
    driveApi?: drive_v3.Drive,
    sheetsApi?: import('googleapis').sheets_v4.Sheets
  ) {
    super('sheets_collaborate', context);
    this.driveApi = driveApi;
    this.sheetsApi = sheetsApi;
  }

  /**
   * Validate scopes for an operation
   * Returns error response if scopes are insufficient, null if valid
   */
  private validateScopes(operation: string): SheetsCollaborateOutput | null {
    const validator = new ScopeValidator({
      scopes: this.context.auth?.scopes ?? [],
    });

    try {
      validator.validateOperation(operation);
      return null; // Scopes are valid
    } catch (error) {
      if (error instanceof IncrementalScopeRequiredError) {
        return {
          response: this.error({
            code: ErrorCodes.INCREMENTAL_SCOPE_REQUIRED,
            message: error.message,
            category: 'auth',
            retryable: true,
            retryStrategy: 'reauthorize',
            details: {
              operation: error.operation,
              requiredScopes: error.requiredScopes,
              currentScopes: error.currentScopes,
              missingScopes: error.missingScopes,
              authorizationUrl: error.authorizationUrl,
            },
          }),
        };
      }
      throw error; // Re-throw non-scope errors
    }
  }

  async handle(input: SheetsCollaborateInput): Promise<SheetsCollaborateOutput> {
    // Track spreadsheet ID for better error messages
    const req = unwrapRequest<SheetsCollaborateInput['request']>(input);
    this.trackSpreadsheetId(req.spreadsheetId);

    if (!this.driveApi) {
      return {
        response: this.error({
          code: ErrorCodes.INTERNAL_ERROR,
          message: 'Drive API not available - required for collaboration operations',
          details: {
            action: req.action,
            spreadsheetId: req.spreadsheetId,
            requiredScope: 'https://www.googleapis.com/auth/drive.file',
          },
          retryable: false,
          resolution:
            'Ensure Drive API client is initialized with drive.file scope. Check Google API credentials configuration.',
          resolutionSteps: [
            '1. Verify GOOGLE_APPLICATION_CREDENTIALS or service account setup',
            '2. Ensure drive.file scope is included in OAuth scopes',
            '3. Re-authenticate if using OAuth',
          ],
        }),
      };
    }

    // Check scope sufficiency for sharing operations using incremental consent
    if (req.action.startsWith('share_')) {
      const validator = new ScopeValidator({
        scopes: this.context.auth?.scopes ?? [],
      });

      const operation = `sheets_collaborate.${req.action}`;

      // Only block if current scopes are actually insufficient for this operation
      if (!validator.hasRequiredScopes(operation)) {
        const requirements = validator.getOperationRequirements(operation);

        // Generate authorization URL for incremental consent
        const authUrl = validator.generateIncrementalAuthUrl(
          requirements?.missing ?? ['https://www.googleapis.com/auth/drive']
        );

        // Return properly formatted error response
        return {
          response: this.error({
            code: ErrorCodes.PERMISSION_DENIED,
            message:
              requirements?.description ?? 'Sharing operations require additional Drive access',
            category: 'auth',
            severity: 'high',
            retryable: false,
            retryStrategy: 'manual',
            suggestedFix:
              'Grant additional permissions via the authorization URL to complete this operation',
            details: {
              operation,
              requiredScopes: requirements?.required ?? ['https://www.googleapis.com/auth/drive'],
              currentScopes: this.context.auth?.scopes ?? [],
              missingScopes: requirements?.missing ?? ['https://www.googleapis.com/auth/drive'],
              authorizationUrl: authUrl,
              scopeCategory: requirements?.category ?? ScopeCategory.DRIVE_FULL,
            },
            resolution: 'Grant additional permissions to complete this operation.',
            resolutionSteps: [
              '1. Visit the authorization URL to approve required scopes',
              `2. Authorization URL: ${authUrl}`,
              '3. After approving, retry the operation',
            ],
          }),
        };
      }
    }

    // Phase 1, Task 1.4: Infer missing parameters from context
    const inferredReq = this.inferRequestParameters(req) as CollaborateRequest;

    // Phase 0: Validate scopes for the operation
    const operation = `sheets_collaborate.${inferredReq.action}`;
    const scopeError = this.validateScopes(operation);
    if (scopeError) {
      return scopeError;
    }

    // Audit log: Elevated scope operation for sharing
    if (inferredReq.action.startsWith('share_')) {
      logger.info('Elevated scope operation', {
        operation: `collaborate:${req.action}`,
        resourceId: req.spreadsheetId,
        scopes: this.context.auth?.scopes,
        category: 'audit',
      });
    }

    try {
      const sharingDeps = {
        driveApi: this.driveApi!,
        context: this.context,
        mapPermission: (permission: drive_v3.Schema$Permission | undefined) =>
          this.mapPermission(permission),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleShareAddAction>[1];

      const commentsDeps = {
        driveApi: this.driveApi!,
        context: this.context,
        mapComment: (comment: drive_v3.Schema$Comment | undefined) => this.mapComment(comment),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleCommentAddAction>[1];

      const versionsDeps = {
        driveApi: this.driveApi!,
        context: this.context,
        checkOperationScopes: (operation: string) => this.checkOperationScopes(operation),
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
        mapError: (error: unknown) => this.mapError(error),
      } satisfies Parameters<typeof handleVersionListRevisionsAction>[1];

      const approvalsDeps = {
        driveApi: this.driveApi!,
        sheetsApi: this.sheetsApi!,
        context: this.context,
        mapError: (error: unknown) => this.mapError(error),
        error: (...args: Parameters<typeof this.error>) => this.error(...args),
      } satisfies Parameters<typeof handleApprovalCreateAction>[1];

      const accessLabelsDeps = {
        driveApi: this.driveApi!,
        success: (...args: Parameters<typeof this.success>) => this.success(...args),
      } satisfies Parameters<typeof handleListAccessProposalsAction>[1];

      let response: CollaborateResponse;
      switch (inferredReq.action) {
        // ========== SHARING ACTIONS ==========
        case 'share_add':
          response = await handleShareAddAction(
            inferredReq as CollaborateShareAddInput,
            sharingDeps
          );
          break;
        case 'share_update':
          response = await handleShareUpdateAction(
            inferredReq as CollaborateShareUpdateInput,
            sharingDeps
          );
          break;
        case 'share_remove':
          response = await handleShareRemoveAction(
            inferredReq as CollaborateShareRemoveInput,
            sharingDeps
          );
          break;
        case 'share_list':
          response = await handleShareListAction(
            inferredReq as CollaborateShareListInput,
            sharingDeps
          );
          break;
        case 'share_get':
          response = await handleShareGetAction(
            inferredReq as CollaborateShareGetInput,
            sharingDeps
          );
          break;
        case 'share_transfer_ownership':
          response = await handleShareTransferOwnershipAction(
            inferredReq as CollaborateShareTransferOwnershipInput,
            sharingDeps
          );
          break;
        case 'share_set_link':
          response = await handleShareSetLinkAction(
            inferredReq as CollaborateShareSetLinkInput,
            sharingDeps
          );
          break;
        case 'share_get_link':
          response = await handleShareGetLinkAction(
            inferredReq as CollaborateShareGetLinkInput,
            sharingDeps
          );
          break;

        // ========== COMMENT ACTIONS ==========
        case 'comment_add':
          response = await handleCommentAddAction(
            inferredReq as CollaborateCommentAddInput,
            commentsDeps
          );
          break;
        case 'comment_update':
          response = await handleCommentUpdateAction(
            inferredReq as CollaborateCommentUpdateInput,
            commentsDeps
          );
          break;
        case 'comment_delete':
          response = await handleCommentDeleteAction(
            inferredReq as CollaborateCommentDeleteInput,
            commentsDeps
          );
          break;
        case 'comment_list':
          response = await handleCommentListAction(
            inferredReq as CollaborateCommentListInput,
            commentsDeps
          );
          break;
        case 'comment_get':
          response = await handleCommentGetAction(
            inferredReq as CollaborateCommentGetInput,
            commentsDeps
          );
          break;
        case 'comment_resolve':
          response = await handleCommentResolveAction(
            inferredReq as CollaborateCommentResolveInput,
            commentsDeps
          );
          break;
        case 'comment_reopen':
          response = await handleCommentReopenAction(
            inferredReq as CollaborateCommentReopenInput,
            commentsDeps
          );
          break;
        case 'comment_add_reply':
          response = await handleCommentAddReplyAction(
            inferredReq as CollaborateCommentAddReplyInput,
            commentsDeps
          );
          break;
        case 'comment_update_reply':
          response = await handleCommentUpdateReplyAction(
            inferredReq as CollaborateCommentUpdateReplyInput,
            commentsDeps
          );
          break;
        case 'comment_delete_reply':
          response = await handleCommentDeleteReplyAction(
            inferredReq as CollaborateCommentDeleteReplyInput,
            commentsDeps
          );
          break;

        // ========== VERSION ACTIONS ==========
        case 'version_list_revisions':
          response = await handleVersionListRevisionsAction(
            inferredReq as CollaborateVersionListRevisionsInput,
            versionsDeps
          );
          break;
        case 'version_get_revision':
          response = await handleVersionGetRevisionAction(
            inferredReq as CollaborateVersionGetRevisionInput,
            versionsDeps
          );
          break;
        case 'version_restore_revision':
          response = await handleVersionRestoreRevisionAction(
            inferredReq as CollaborateVersionRestoreRevisionInput,
            versionsDeps
          );
          break;
        case 'version_keep_revision':
          response = await handleVersionKeepRevisionAction(
            inferredReq as CollaborateVersionKeepRevisionInput,
            versionsDeps
          );
          break;
        case 'version_create_snapshot':
          response = await handleVersionCreateSnapshotAction(
            inferredReq as CollaborateVersionCreateSnapshotInput,
            versionsDeps
          );
          break;
        case 'version_snapshot_status':
          response = await handleVersionSnapshotStatusAction(
            inferredReq as CollaborateVersionSnapshotStatusInput,
            versionsDeps
          );
          break;
        case 'version_list_snapshots':
          response = await handleVersionListSnapshotsAction(
            inferredReq as CollaborateVersionListSnapshotsInput,
            versionsDeps
          );
          break;
        case 'version_restore_snapshot':
          response = await handleVersionRestoreSnapshotAction(
            inferredReq as CollaborateVersionRestoreSnapshotInput,
            versionsDeps
          );
          break;
        case 'version_delete_snapshot':
          response = await handleVersionDeleteSnapshotAction(
            inferredReq as CollaborateVersionDeleteSnapshotInput,
            versionsDeps
          );
          break;
        case 'version_compare':
          response = await handleVersionCompareAction(
            inferredReq as CollaborateVersionCompareInput,
            versionsDeps
          );
          break;
        case 'version_export':
          response = await handleVersionExportAction(
            inferredReq as CollaborateVersionExportInput,
            versionsDeps
          );
          break;

        // ========== APPROVAL ACTIONS ==========
        case 'approval_create':
          response = await handleApprovalCreateAction(
            inferredReq as CollaborateApprovalCreateInput,
            approvalsDeps
          );
          break;
        case 'approval_approve':
          response = await handleApprovalApproveAction(
            inferredReq as CollaborateApprovalApproveInput,
            approvalsDeps
          );
          break;
        case 'approval_reject':
          response = await handleApprovalRejectAction(
            inferredReq as CollaborateApprovalRejectInput,
            approvalsDeps
          );
          break;
        case 'approval_get_status':
          response = await handleApprovalGetStatusAction(
            inferredReq as CollaborateApprovalGetStatusInput,
            approvalsDeps
          );
          break;
        case 'approval_list_pending':
          response = await handleApprovalListPendingAction(
            inferredReq as CollaborateApprovalListPendingInput,
            approvalsDeps
          );
          break;
        case 'approval_delegate':
          response = await handleApprovalDelegateAction(
            inferredReq as CollaborateApprovalDelegateInput,
            approvalsDeps
          );
          break;
        case 'approval_cancel':
          response = await handleApprovalCancelAction(
            inferredReq as CollaborateApprovalCancelInput,
            approvalsDeps
          );
          break;

        // ========== ACCESS PROPOSAL ACTIONS ==========
        case 'list_access_proposals':
          response = await handleListAccessProposalsAction(
            inferredReq as CollaborateListAccessProposalsInput,
            accessLabelsDeps
          );
          break;
        case 'resolve_access_proposal':
          response = await handleResolveAccessProposalAction(
            inferredReq as CollaborateResolveAccessProposalInput,
            accessLabelsDeps
          );
          break;

        // ========== DRIVE LABEL ACTIONS ==========
        case 'label_list':
          response = await handleLabelListAction(
            inferredReq as CollaborateLabelListInput,
            accessLabelsDeps
          );
          break;
        case 'label_apply':
          response = await handleLabelApplyAction(
            inferredReq as CollaborateLabelApplyInput,
            accessLabelsDeps
          );
          break;
        case 'label_remove':
          response = await handleLabelRemoveAction(
            inferredReq as CollaborateLabelRemoveInput,
            accessLabelsDeps
          );
          break;

        default: {
          const _exhaustiveCheck: never = inferredReq.action;
          response = this.error({
            code: ErrorCodes.INVALID_PARAMS,
            message: `Unknown action: ${String(_exhaustiveCheck)}`,
            retryable: false,
            suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
          });
        }
      }

      // Apply verbosity filtering (LLM optimization) - uses base handler implementation
      const verbosity = inferredReq.verbosity ?? 'standard';
      const filteredResponse = super.applyVerbosityFilter(
        response,
        verbosity
      ) as CollaborateResponse;

      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  protected createIntents(_input: SheetsCollaborateInput): Intent[] {
    return [];
  }

  // ============================================================
  // SHARING ACTIONS
  // ============================================================

  // ============================================================
  // COMMENT ACTIONS
  // ============================================================

  // ============================================================
  // VERSION ACTIONS
  // ============================================================

  // ============================================================
  // HELPER METHODS
  // ============================================================

  private mapPermission = (
    p: drive_v3.Schema$Permission | undefined
  ): NonNullable<CollaborateSuccess['permission']> => ({
    id: p?.id ?? '',
    type: (p?.type as NonNullable<CollaborateSuccess['permission']>['type']) ?? 'user',
    role: (p?.role as NonNullable<CollaborateSuccess['permission']>['role']) ?? 'reader',
    emailAddress: p?.emailAddress ?? undefined,
    domain: p?.domain ?? undefined,
    displayName: p?.displayName ?? undefined,
    expirationTime: p?.expirationTime ?? undefined,
  });

  private mapComment = (
    c: drive_v3.Schema$Comment | undefined
  ): NonNullable<CollaborateSuccess['comment']> => ({
    id: c?.id ?? '',
    content: c?.content ?? '',
    author: {
      displayName: c?.author?.displayName ?? '',
      emailAddress: c?.author?.emailAddress ?? undefined,
    },
    createdTime: c?.createdTime ?? '',
    modifiedTime: c?.modifiedTime ?? '',
    resolved: c?.resolved ?? false,
    anchor: c?.anchor ?? undefined,
    replies: (c?.replies ?? []).map((r) => ({
      id: r.id ?? '',
      content: r.content ?? '',
      author: { displayName: r.author?.displayName ?? '' },
      createdTime: r.createdTime ?? '',
    })),
  });

  // ============================================================
  // APPROVAL ACTIONS
  // ============================================================

  // ============================================================
  // ACCESS PROPOSAL ACTIONS
  // ============================================================
}
