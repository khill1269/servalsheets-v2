import { ErrorCodes } from '../error-codes.js';
import type { drive_v3, sheets_v4 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  Approval,
  CollaborateApprovalApproveInput,
  CollaborateApprovalCancelInput,
  CollaborateApprovalCreateInput,
  CollaborateApprovalDelegateInput,
  CollaborateApprovalGetStatusInput,
  CollaborateApprovalListPendingInput,
  CollaborateApprovalRejectInput,
  CollaborateResponse,
} from '../../schemas/index.js';
import type { ErrorDetail } from '../../schemas/shared.js';
import { logger } from '../../utils/logger.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { createNotFoundError, createValidationError } from '../../utils/error-factory.js';
import { parseA1Notation } from '../../utils/google-sheets-helpers.js';

interface ApprovalsDeps {
  driveApi: drive_v3.Drive;
  sheetsApi: sheets_v4.Sheets;
  context: HandlerContext;
  mapError: (error: unknown) => CollaborateResponse;
  error: (error: ErrorDetail) => CollaborateResponse;
}

/**
 * Decomposed action handler for `approval_create`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalCreateAction(
  input: CollaborateApprovalCreateInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const now = new Date();
    const expiresAt = input.expirationDays
      ? new Date(now.getTime() + input.expirationDays * 24 * 60 * 60 * 1000)
      : undefined;

    const metadata = {
      approvalId,
      status: 'pending',
      approvers: input.approvers,
      approvedBy: [],
      requiredApprovals: input.requiredApprovals ?? 1,
      createdAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString(),
      message: input.message,
      range: input.range,
    };

    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId!,
      requestBody: {
        requests: [
          {
            createDeveloperMetadata: {
              developerMetadata: {
                metadataKey: `servalsheets_approval_${approvalId}`,
                metadataValue: JSON.stringify(metadata),
                location: {
                  spreadsheet: true,
                },
                visibility: 'DOCUMENT',
              },
            },
          },
        ],
      },
    });

    const parsed = parseA1Notation(input.range);
    if (!parsed) {
      return deps.error(
        createValidationError({
          field: 'range',
          value: input.range,
          expectedFormat: 'A1 notation (e.g., "Sheet1!A1:C10")',
          reason: 'Range specification could not be parsed',
        })
      );
    }

    const sheetResponse = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId: input.spreadsheetId!,
      fields: 'sheets(properties(sheetId,title))',
    });

    const sheet = sheetResponse.data.sheets?.find(
      (s) => s.properties?.title === (parsed.sheetName || 'Sheet1')
    );
    const sheetId = sheet?.properties?.sheetId;

    if (sheetId === undefined) {
      return deps.error(
        createNotFoundError({
          resourceType: 'sheet',
          resourceId: parsed.sheetName || 'Sheet1',
          parentResourceId: input.spreadsheetId,
        })
      );
    }

    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: input.spreadsheetId!,
      requestBody: {
        requests: [
          {
            addProtectedRange: {
              protectedRange: {
                range: {
                  sheetId,
                  startRowIndex: parsed.startRow,
                  endRowIndex: parsed.endRow,
                  startColumnIndex: parsed.startCol,
                  endColumnIndex: parsed.endCol,
                },
                description: `Approval ${approvalId}: ${input.message || 'Pending approval'}`,
                editors: {
                  users: input.approvers,
                },
                warningOnly: false,
              },
            },
          },
        ],
      },
    });

    const commentContent = `Approval requested: ${input.message || 'Please review and approve'}\n\nApprovers: ${input.approvers.map((email) => `@${email}`).join(', ')}`;

    try {
      await deps.driveApi.comments.create({
        fileId: input.spreadsheetId!,
        requestBody: {
          content: commentContent,
        },
      });
    } catch (error) {
      logger.warn('Failed to add approval comment', { approvalId, error });
    }

    const requester = {
      displayName: 'Request Creator',
      emailAddress: undefined,
    };

    const approval: Approval = {
      approvalId,
      spreadsheetId: input.spreadsheetId!,
      range: input.range,
      status: 'pending',
      requester,
      approvers: input.approvers,
      approvedBy: [],
      requiredApprovals: input.requiredApprovals ?? 1,
      createdAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString(),
      message: input.message,
    };

    return {
      success: true,
      action: 'approval_create',
      approval,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `approval_approve`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalApproveAction(
  input: CollaborateApprovalApproveInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const approval = await getApprovalMetadata(deps, input.spreadsheetId!, input.approvalId);

    if (!approval) {
      return deps.error({
        code: ErrorCodes.NOT_FOUND,
        message: `Approval ${input.approvalId} not found`,
        details: { approvalId: input.approvalId },
        retryable: false,
        suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      });
    }

    const userEmail = await getCurrentUserEmail(deps);
    if (!userEmail || !approval.approvers.includes(userEmail)) {
      return deps.error({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'You are not authorized to approve this request',
        details: { approvalId: input.approvalId, userEmail },
        retryable: false,
        suggestedFix:
          'Check that the spreadsheet is shared with the right account, or verify sharing settings',
      });
    }

    if (approval.approvedBy.includes(userEmail)) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: 'You have already approved this request',
        details: { approvalId: input.approvalId, userEmail },
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }

    approval.approvedBy.push(userEmail);

    if (approval.approvedBy.length >= approval.requiredApprovals) {
      approval.status = 'approved';
      await removeApprovalProtection(deps, input.spreadsheetId!, input.approvalId);
    }

    await updateApprovalMetadata(deps, input.spreadsheetId!, input.approvalId, approval);

    try {
      await deps.driveApi.comments.create({
        fileId: input.spreadsheetId!,
        requestBody: {
          content: `Approved by ${userEmail}${approval.status === 'approved' ? '. All required approvals received.' : ''}`,
        },
      });
    } catch (error) {
      logger.warn('Failed to add approval comment', { approvalId: input.approvalId, error });
    }

    return {
      success: true,
      action: 'approval_approve',
      approval,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `approval_reject`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalRejectAction(
  input: CollaborateApprovalRejectInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const approval = await getApprovalMetadata(deps, input.spreadsheetId!, input.approvalId);

    if (!approval) {
      return deps.error({
        code: ErrorCodes.NOT_FOUND,
        message: `Approval ${input.approvalId} not found`,
        details: { approvalId: input.approvalId },
        retryable: false,
        suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      });
    }

    const userEmail = await getCurrentUserEmail(deps);
    if (!userEmail || !approval.approvers.includes(userEmail)) {
      return deps.error({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'You are not authorized to reject this request',
        details: { approvalId: input.approvalId, userEmail },
        retryable: false,
        suggestedFix:
          'Check that the spreadsheet is shared with the right account, or verify sharing settings',
      });
    }

    approval.status = 'rejected';

    await updateApprovalMetadata(deps, input.spreadsheetId!, input.approvalId, approval);

    try {
      await deps.driveApi.comments.create({
        fileId: input.spreadsheetId!,
        requestBody: {
          content: `Rejected by ${userEmail}`,
        },
      });
    } catch (error) {
      logger.warn('Failed to add rejection comment', { approvalId: input.approvalId, error });
    }

    return {
      success: true,
      action: 'approval_reject',
      approval,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `approval_get_status`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalGetStatusAction(
  input: CollaborateApprovalGetStatusInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const approval = await getApprovalMetadata(deps, input.spreadsheetId!, input.approvalId);

    if (!approval) {
      return deps.error({
        code: ErrorCodes.NOT_FOUND,
        message: `Approval ${input.approvalId} not found`,
        details: { approvalId: input.approvalId },
        retryable: false,
        suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      });
    }

    return {
      success: true,
      action: 'approval_get_status',
      approval,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `approval_list_pending`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalListPendingAction(
  input: CollaborateApprovalListPendingInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const response = await deps.sheetsApi.spreadsheets.developerMetadata.search({
      spreadsheetId: input.spreadsheetId!,
      requestBody: {
        dataFilters: [
          {
            developerMetadataLookup: {
              locationType: 'SPREADSHEET',
              visibility: 'DOCUMENT',
            },
          },
        ],
      },
    });

    const approvals: Approval[] = [];

    for (const item of response.data.matchedDeveloperMetadata ?? []) {
      const meta = item.developerMetadata;
      if (!meta?.metadataKey?.startsWith('servalsheets_approval_')) continue;
      const metadataValue = meta.metadataValue;
      if (metadataValue) {
        try {
          const approval = JSON.parse(metadataValue) as Approval;
          if (approval.status === 'pending') {
            approvals.push(approval);
          }
        } catch {
          // Skip invalid metadata
        }
      }
    }

    return {
      success: true,
      action: 'approval_list_pending',
      approvals,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `approval_delegate`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalDelegateAction(
  input: CollaborateApprovalDelegateInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const approval = await getApprovalMetadata(deps, input.spreadsheetId!, input.approvalId);

    if (!approval) {
      return deps.error({
        code: ErrorCodes.NOT_FOUND,
        message: `Approval ${input.approvalId} not found`,
        details: { approvalId: input.approvalId },
        retryable: false,
        suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      });
    }

    const userEmail = await getCurrentUserEmail(deps);
    if (!userEmail || !approval.approvers.includes(userEmail)) {
      return deps.error({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'You are not authorized to delegate this approval',
        details: { approvalId: input.approvalId, userEmail },
        retryable: false,
        suggestedFix:
          'Check that the spreadsheet is shared with the right account, or verify sharing settings',
      });
    }

    const index = approval.approvers.indexOf(userEmail);
    approval.approvers[index] = input.delegateTo;

    await updateApprovalMetadata(deps, input.spreadsheetId!, input.approvalId, approval);

    try {
      await deps.driveApi.comments.create({
        fileId: input.spreadsheetId!,
        requestBody: {
          content: `Approval delegated from ${userEmail} to ${input.delegateTo}`,
        },
      });
    } catch (error) {
      logger.warn('Failed to add delegation comment', { approvalId: input.approvalId, error });
    }

    return {
      success: true,
      action: 'approval_delegate',
      approval,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `approval_cancel`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleApprovalCancelAction(
  input: CollaborateApprovalCancelInput,
  deps: ApprovalsDeps
): Promise<CollaborateResponse> {
  try {
    const approval = await getApprovalMetadata(deps, input.spreadsheetId!, input.approvalId);

    if (!approval) {
      return deps.error({
        code: ErrorCodes.NOT_FOUND,
        message: `Approval ${input.approvalId} not found`,
        details: { approvalId: input.approvalId },
        retryable: false,
        suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
      });
    }

    const userEmail = await getCurrentUserEmail(deps);
    if (!userEmail) {
      return deps.error({
        code: ErrorCodes.AUTHENTICATION_REQUIRED,
        message:
          'Cannot verify your identity to cancel this approval — no authenticated email available',
        retryable: false,
        suggestedFix: 'Re-authenticate using sheets_auth.login and retry',
      });
    }
    if (approval.requester.emailAddress && userEmail !== approval.requester.emailAddress) {
      return deps.error({
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Only the requester can cancel an approval',
        details: { approvalId: input.approvalId, userEmail },
        retryable: false,
        suggestedFix:
          'Check that the spreadsheet is shared with the right account, or verify sharing settings',
      });
    }

    await createSnapshotIfNeeded(
      deps.context.snapshotService,
      {
        operationType: 'approval_cancel',
        isDestructive: true,
        spreadsheetId: input.spreadsheetId,
      },
      input.safety
    );

    if (deps.context.elicitationServer) {
      const confirmation = await confirmDestructiveAction(
        deps.context.elicitationServer,
        'approval_cancel',
        `Cancel approval request (ID: ${input.approvalId}) on spreadsheet ${input.spreadsheetId}. The approval workflow and sheet protection will be removed. This action cannot be undone.`
      );

      if (!confirmation.confirmed) {
        return deps.error({
          code: ErrorCodes.OPERATION_CANCELLED,
          message: confirmation.reason ?? 'Operation cancelled by user',
          retryable: false,
        });
      }
    }

    approval.status = 'cancelled';

    await removeApprovalProtection(deps, input.spreadsheetId!, input.approvalId);

    await updateApprovalMetadata(deps, input.spreadsheetId!, input.approvalId, approval);

    try {
      await deps.driveApi.comments.create({
        fileId: input.spreadsheetId!,
        requestBody: {
          content: `Approval cancelled by ${userEmail}`,
        },
      });
    } catch (error) {
      logger.warn('Failed to add cancellation comment', { approvalId: input.approvalId, error });
    }

    return {
      success: true,
      action: 'approval_cancel',
      approval,
    };
  } catch (error) {
    return deps.mapError(error);
  }
}

async function getCurrentUserEmail(deps: ApprovalsDeps): Promise<string | undefined> {
  try {
    const response = await deps.driveApi.about.get({
      fields: 'user(emailAddress)',
    });
    return response.data.user?.emailAddress ?? undefined;
  } catch (err) {
    logger.debug('Failed to get current user email from Drive API', { error: String(err) });
    return undefined;
  }
}

async function getApprovalMetadata(
  deps: ApprovalsDeps,
  spreadsheetId: string,
  approvalId: string
): Promise<Approval | null> {
  try {
    const response = await deps.sheetsApi.spreadsheets.developerMetadata.search({
      spreadsheetId,
      requestBody: {
        dataFilters: [
          {
            developerMetadataLookup: {
              metadataKey: `servalsheets_approval_${approvalId}`,
            },
          },
        ],
      },
    });

    const item = response.data.matchedDeveloperMetadata?.[0];
    if (!item?.developerMetadata?.metadataValue) {
      return null;
    }

    return JSON.parse(item.developerMetadata.metadataValue) as Approval;
  } catch (err) {
    logger.debug('Failed to get approval metadata', {
      approvalId,
      spreadsheetId,
      error: String(err),
    });
    return null;
  }
}

async function updateApprovalMetadata(
  deps: ApprovalsDeps,
  spreadsheetId: string,
  approvalId: string,
  approval: Approval
): Promise<void> {
  const response = await deps.sheetsApi.spreadsheets.developerMetadata.search({
    spreadsheetId,
    requestBody: {
      dataFilters: [
        {
          developerMetadataLookup: {
            metadataKey: `servalsheets_approval_${approvalId}`,
          },
        },
      ],
    },
  });

  const metadataId = response.data.matchedDeveloperMetadata?.[0]?.developerMetadata?.metadataId;

  if (!metadataId) {
    throw createNotFoundError({
      resourceType: 'operation',
      resourceId: approvalId,
      searchSuggestion:
        'Check if the approval ID is correct or if the approval was already processed',
    });
  }

  await deps.sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateDeveloperMetadata: {
            dataFilters: [
              {
                developerMetadataLookup: {
                  metadataId,
                },
              },
            ],
            developerMetadata: {
              metadataValue: JSON.stringify(approval),
            },
            fields: 'metadataValue',
          },
        },
      ],
    },
  });
}

async function removeApprovalProtection(
  deps: ApprovalsDeps,
  spreadsheetId: string,
  approvalId: string
): Promise<void> {
  try {
    const response = await deps.sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(protectedRanges(protectedRangeId,description))',
    });

    let protectedRangeId: number | undefined;
    for (const sheet of response.data.sheets ?? []) {
      for (const protectedRange of sheet.protectedRanges ?? []) {
        if (protectedRange.description?.includes(approvalId)) {
          protectedRangeId = protectedRange.protectedRangeId ?? undefined;
          break;
        }
      }
      if (protectedRangeId) break;
    }

    if (!protectedRangeId) {
      logger.warn('Protected range not found for approval', { approvalId });
      return;
    }

    await deps.sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteProtectedRange: {
              protectedRangeId,
            },
          },
        ],
      },
    });
  } catch (error) {
    logger.warn('Failed to remove approval protection', { approvalId, error });
  }
}
