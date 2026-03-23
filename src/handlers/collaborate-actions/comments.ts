import { ErrorCodes } from '../error-codes.js';
import type { drive_v3 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CollaborateCommentAddInput,
  CollaborateCommentAddReplyInput,
  CollaborateCommentDeleteInput,
  CollaborateCommentDeleteReplyInput,
  CollaborateCommentGetInput,
  CollaborateCommentListInput,
  CollaborateCommentReopenInput,
  CollaborateCommentResolveInput,
  CollaborateCommentUpdateInput,
  CollaborateCommentUpdateReplyInput,
  CollaborateResponse,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { withSamplingTimeout, assertSamplingConsent } from '../../mcp/sampling.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';

type CollaborateSuccess = Extract<CollaborateResponse, { success: true }>;

interface CommentsDeps {
  driveApi: drive_v3.Drive;
  context: HandlerContext;
  mapComment: (
    comment: drive_v3.Schema$Comment | undefined
  ) => NonNullable<CollaborateSuccess['comment']>;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => CollaborateResponse;
  error: (error: ErrorDetail) => CollaborateResponse;
}

/**
 * Decomposed action handler for `comment_add`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentAddAction(
  input: CollaborateCommentAddInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.comments.create({
    fileId: input.spreadsheetId!,
    requestBody: {
      content: input.content!,
      anchor: input.anchor,
    },
    fields: 'id,content,createdTime,modifiedTime,author(displayName,emailAddress),resolved,anchor',
  });

  let aiSuggestedReply: string | null | undefined;
  if (deps.context.samplingServer) {
    const commentContent = response.data.content ?? input.content ?? '';
    if (commentContent.includes('?')) {
      try {
        await assertSamplingConsent();
        const replyResult = await withSamplingTimeout(() =>
          deps.context.samplingServer!.createMessage({
            messages: [
              {
                role: 'user' as const,
                content: {
                  type: 'text' as const,
                  text: `A collaborator left this comment on a spreadsheet: "${commentContent}"\nSuggest a concise, helpful reply in 1-2 sentences.`,
                },
              },
            ],
            maxTokens: 256,
          })
        );
        const text = Array.isArray(replyResult.content)
          ? ((replyResult.content.find((c) => c.type === 'text') as { text: string } | undefined)
              ?.text ?? '')
          : ((replyResult.content as { text?: string }).text ?? '');
        aiSuggestedReply = text.trim();
      } catch {
        aiSuggestedReply = null;
      }
    } else {
      aiSuggestedReply = null;
    }
  }

  return deps.success('comment_add', {
    comment: deps.mapComment(response.data),
    ...(aiSuggestedReply !== undefined ? { aiSuggestedReply } : {}),
  });
}

/**
 * Decomposed action handler for `comment_update`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentUpdateAction(
  input: CollaborateCommentUpdateInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('comment_update', {}, undefined, true);
  }

  const response = await deps.driveApi.comments.update({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    requestBody: { content: input.content! },
    fields: 'id,content,createdTime,modifiedTime,author(displayName,emailAddress),resolved,anchor',
  });

  return deps.success('comment_update', { comment: deps.mapComment(response.data) });
}

/**
 * Decomposed action handler for `comment_delete`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentDeleteAction(
  input: CollaborateCommentDeleteInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('comment_delete', {}, undefined, true);
  }

  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'comment_delete',
      `Delete comment (ID: ${input.commentId}) from spreadsheet ${input.spreadsheetId}. This will permanently remove the comment and all its replies. This action cannot be undone.`
    );

    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'comment_delete',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await deps.driveApi.comments.delete({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
  });

  return deps.success('comment_delete', {
    snapshotId: snapshot?.snapshotId,
  });
}

/**
 * Decomposed action handler for `comment_list`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentListAction(
  input: CollaborateCommentListInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.comments.list({
    fileId: input.spreadsheetId!,
    includeDeleted: input.includeDeleted ?? false,
    pageToken:
      (input as typeof input & { commentPageToken?: string }).commentPageToken ?? undefined,
    pageSize: input.maxResults ?? 100,
    fields:
      'nextPageToken,comments(id,content,createdTime,modifiedTime,author(displayName,emailAddress),resolved,anchor,replies(id,content,createdTime,author(displayName)))',
  });

  const comments = (response.data.comments ?? []).map((comment) => deps.mapComment(comment));
  return deps.success('comment_list', {
    comments,
    nextPageToken: response.data.nextPageToken ?? undefined,
  });
}

/**
 * Decomposed action handler for `comment_get`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentGetAction(
  input: CollaborateCommentGetInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.comments.get({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    fields:
      'id,content,createdTime,modifiedTime,author(displayName,emailAddress),resolved,anchor,replies(id,content,createdTime,author(displayName))',
  });

  return deps.success('comment_get', { comment: deps.mapComment(response.data) });
}

/**
 * Decomposed action handler for `comment_resolve`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentResolveAction(
  input: CollaborateCommentResolveInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  await deps.driveApi.replies.create({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    requestBody: { content: '', action: 'resolve' },
    fields: 'id',
  });

  const response = await deps.driveApi.comments.get({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    fields: 'id,content,createdTime,modifiedTime,author(displayName,emailAddress),resolved,anchor',
  });

  return deps.success('comment_resolve', { comment: deps.mapComment(response.data) });
}

/**
 * Decomposed action handler for `comment_reopen`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentReopenAction(
  input: CollaborateCommentReopenInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  await deps.driveApi.replies.create({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    requestBody: { content: '', action: 'reopen' },
    fields: 'id',
  });

  const response = await deps.driveApi.comments.get({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    fields: 'id,content,createdTime,modifiedTime,author(displayName,emailAddress),resolved,anchor',
  });

  return deps.success('comment_reopen', { comment: deps.mapComment(response.data) });
}

/**
 * Decomposed action handler for `comment_add_reply`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentAddReplyAction(
  input: CollaborateCommentAddReplyInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.replies.create({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    requestBody: { content: input.content! },
    fields: 'id',
  });

  return deps.success('comment_add_reply', { replyId: response.data.id ?? '' });
}

/**
 * Decomposed action handler for `comment_update_reply`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentUpdateReplyAction(
  input: CollaborateCommentUpdateReplyInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('comment_update_reply', {}, undefined, true);
  }

  await deps.driveApi.replies.update({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    replyId: input.replyId!,
    requestBody: { content: input.content! },
    fields: 'id',
  });

  return deps.success('comment_update_reply', { replyId: input.replyId! });
}

/**
 * Decomposed action handler for `comment_delete_reply`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleCommentDeleteReplyAction(
  input: CollaborateCommentDeleteReplyInput,
  deps: CommentsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('comment_delete_reply', {}, undefined, true);
  }

  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'comment_delete_reply',
      `Delete reply (ID: ${input.replyId}) from comment ${input.commentId} in spreadsheet ${input.spreadsheetId}. This action cannot be undone.`
    );

    if (!confirmation.confirmed) {
      return deps.error({
        code: ErrorCodes.PRECONDITION_FAILED,
        message: confirmation.reason || 'User cancelled the operation',
        retryable: false,
        suggestedFix: 'Review the operation requirements and try again',
      });
    }
  }

  const snapshot = await createSnapshotIfNeeded(
    deps.context.snapshotService,
    {
      operationType: 'comment_delete_reply',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await deps.driveApi.replies.delete({
    fileId: input.spreadsheetId!,
    commentId: input.commentId!,
    replyId: input.replyId!,
  });

  return deps.success('comment_delete_reply', {
    snapshotId: snapshot?.snapshotId,
  });
}
