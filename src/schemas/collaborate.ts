/**
 * Tool: sheets_collaborate
 * Consolidated collaboration operations: sharing, comments, version control, and approvals
 * Merges: sharing.ts (8 actions) + comments.ts (10 actions) + versions.ts (11 actions) + approvals (7 actions) = 41 actions
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  PermissionRoleSchema,
  PermissionTypeSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ResponseMetaSchema,
  type ToolAnnotations,
} from './shared.js';

// ========== SHARED SCHEMAS ==========

const PermissionSchema = z.object({
  id: z.string(),
  type: PermissionTypeSchema,
  role: PermissionRoleSchema,
  emailAddress: z.string().email('Invalid email address format').optional(),
  domain: z.string().optional(),
  displayName: z.string().optional(),
  expirationTime: z.string().optional(),
});

const CommentSchema = z.object({
  id: z.string(),
  content: z.string(),
  author: z.object({
    displayName: z.string(),
    emailAddress: z.string().optional(),
  }),
  createdTime: z.string(),
  modifiedTime: z.string(),
  resolved: z.boolean(),
  anchor: z.string().optional(),
  replies: z
    .array(
      z.object({
        id: z.string(),
        content: z.string(),
        author: z.object({
          displayName: z.string(),
        }),
        createdTime: z.string(),
      })
    )
    .optional(),
});

const RevisionSchema = z.object({
  id: z.string(),
  modifiedTime: z.string(),
  lastModifyingUser: z
    .object({
      displayName: z.string(),
      emailAddress: z.string().optional(),
    })
    .optional(),
  size: z.string().optional(),
  keepForever: z.boolean().optional(),
});

const SnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  spreadsheetId: z.string(),
  copyId: z.string().optional(),
  size: z.coerce.number().int().optional(),
});

const ApprovalSchema = z.object({
  approvalId: z.string(),
  spreadsheetId: z.string(),
  range: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  requester: z.object({
    displayName: z.string(),
    emailAddress: z.string().optional(),
  }),
  approvers: z.array(z.string()),
  approvedBy: z.array(z.string()),
  requiredApprovals: z.number().int(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  message: z.string().optional(),
});

// ========== INPUT SCHEMA ==========
/**
 * MCP SDK WORKAROUND — DO NOT REFACTOR without checking SDK version first
 *
 * Problem: The MCP SDK (@modelcontextprotocol/sdk v1.26.0) does not correctly handle
 * z.discriminatedUnion() when the discriminator has many variants. When the SDK converts
 * a Zod discriminatedUnion schema to JSON Schema (via zodToJsonSchema internally), it
 * produces an empty or malformed "anyOf" array for large unions. This causes the MCP
 * client to see an empty schema — all inputs are accepted with no validation, and tool
 * descriptions lose their parameter metadata entirely.
 *
 * Confirmed broken: z.discriminatedUnion('action', [ShareAddSchema, CommentAddSchema, ...])
 * with 41 variants produces { anyOf: [] } in the SDK's JSON Schema output.
 *
 * Current workaround: A single z.object() with ALL fields from all 41 actions as optional
 * fields, plus z.enum([...41 actions]) for the discriminator, and a .refine() that checks
 * required fields per-action at runtime. This works correctly but causes:
 * - ~40% schema bloat (all 41 actions' fields co-exist in one flat object)
 * - No TypeScript type narrowing (all 41 action branches share the same object type;
 *   action-specific fields are always typed as optional, never required)
 * - Manual required-field validation in refine() instead of Zod's built-in discriminated
 *   union narrowing — more code to maintain, risk of gaps
 *
 * Manual type-narrowing helpers are exported below (CollaborateShare*Input, etc.) as a
 * partial mitigation for the TypeScript narrowing loss.
 *
 * Migration path: When @modelcontextprotocol/sdk >= X.Y.Z releases a fix for the
 * discriminatedUnion → JSON Schema conversion (the anyOf array population bug), replace
 * this entire flat-object + refine approach with:
 *
 *   z.discriminatedUnion('action', [
 *     ShareAddSchema,       // { action: z.literal('share_add'), spreadsheetId, type, role, ... }
 *     ShareUpdateSchema,    // { action: z.literal('share_update'), spreadsheetId, permissionId, role }
 *     // ... 33 more schemas
 *   ])
 *
 * This will also restore full TypeScript type narrowing (each branch becomes a distinct type)
 * and eliminate the manual refine() required-field logic.
 *
 * Regression test: tests/contracts/collaborate-discriminated-union.test.ts
 * Deviation record: src/schemas/handler-deviations.ts (collaborate entry)
 */

export const SheetsCollaborateInputSchema = z.object({
  request: z
    .object({
      // Required action discriminator (41 actions)
      action: z
        .enum([
          // Sharing actions (8) - prefixed with 'share_'
          'share_add',
          'share_update',
          'share_remove',
          'share_list',
          'share_get',
          'share_transfer_ownership',
          'share_set_link',
          'share_get_link',
          // Comment actions (10) - prefixed with 'comment_'
          'comment_add',
          'comment_update',
          'comment_delete',
          'comment_list',
          'comment_get',
          'comment_resolve',
          'comment_reopen',
          'comment_add_reply',
          'comment_update_reply',
          'comment_delete_reply',
          // Version actions (10) - prefixed with 'version_'
          'version_list_revisions',
          'version_get_revision',
          'version_restore_revision',
          'version_keep_revision',
          'version_create_snapshot',
          'version_snapshot_status',
          'version_list_snapshots',
          'version_restore_snapshot',
          'version_delete_snapshot',
          'version_compare',
          'version_export',
          // Approval actions (7) - prefixed with 'approval_'
          'approval_create',
          'approval_approve',
          'approval_reject',
          'approval_get_status',
          'approval_list_pending',
          'approval_delegate',
          'approval_cancel',
          // Access proposal actions (2)
          'list_access_proposals',
          'resolve_access_proposal',
          // Drive Label actions (3)
          'label_list',
          'label_apply',
          'label_remove',
        ])
        .describe(
          'The collaboration operation to perform (sharing, comments, version control, approvals, or access proposals)'
        ),

      // Common field - spreadsheetId (required for all actions)
      spreadsheetId: SpreadsheetIdSchema.optional().describe(
        'Spreadsheet ID from URL (required for all actions)'
      ),

      // ========== SHARING FIELDS ==========
      // Fields for share_add action
      emailAddress: z
        .string()
        .email()
        .optional()
        .describe('Email address of user to share with (required for: share_add with type=user)'),
      domain: z
        .string()
        .optional()
        .describe('Domain to share with (required for: share_add with type=domain)'),
      type: PermissionTypeSchema.optional().describe(
        'Permission type: user, group, domain, or anyone (required for: share_add)'
      ),
      role: PermissionRoleSchema.optional().describe(
        'Permission role: owner, writer, commenter, or reader (required for: share_add, share_update; optional for: share_set_link)'
      ),
      sendNotification: z
        .boolean()
        .optional()
        .default(true)
        .describe('Send email notification to user (share_add only)'),
      emailMessage: z
        .string()
        .optional()
        .describe('Custom message in notification email (share_add only)'),
      expirationTime: z
        .string()
        .optional()
        .describe('ISO 8601 expiration time (share_add, share_update)'),

      // Fields for share_update, share_remove, share_get actions
      permissionId: z
        .string()
        .optional()
        .describe(
          'Permission ID to update/remove/get (required for: share_update, share_remove, share_get)'
        ),

      // Fields for share_transfer_ownership action
      newOwnerEmail: z
        .string()
        .email()
        .optional()
        .describe('Email of new owner (required for: share_transfer_ownership)'),

      // Fields for share_set_link action
      enabled: z
        .boolean()
        .optional()
        .describe('Enable or disable link sharing (required for: share_set_link)'),
      allowFileDiscovery: z
        .boolean()
        .optional()
        .describe(
          'Whether the file can be found via search (only applicable for: share_set_link with type "anyone" or "domain")'
        ),

      // ========== COMMENT FIELDS ==========
      // Fields for comment_add, comment_update, comment_add_reply, comment_update_reply actions
      content: z
        .string()
        .optional()
        .describe(
          'Comment or reply content (required for: comment_add, comment_update, comment_add_reply, comment_update_reply)'
        ),
      anchor: z
        .string()
        .optional()
        .describe('Cell or range reference where comment is anchored (comment_add only)'),

      // Fields for comment actions (update, delete, get, resolve, reopen, replies)
      commentId: z
        .string()
        .optional()
        .describe(
          'Comment ID to operate on (required for: comment_update, comment_delete, comment_get, comment_resolve, comment_reopen, comment_add_reply, comment_update_reply, comment_delete_reply)'
        ),

      // Fields for comment_update_reply and comment_delete_reply actions
      replyId: z
        .string()
        .optional()
        .describe(
          'Reply ID to operate on (required for: comment_update_reply, comment_delete_reply)'
        ),

      // Fields for comment_list action
      includeDeleted: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include deleted comments in list (comment_list only)'),
      startIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('DEPRECATED: Use commentPageToken instead. This field is ignored.'),
      commentPageToken: z
        .string()
        .optional()
        .describe(
          'Opaque page token from previous comment_list response nextPageToken (comment_list only)'
        ),
      maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .default(100)
        .describe('Maximum number of comments to return (comment_list only)'),

      // ========== VERSION FIELDS ==========
      // Fields for version_list_revisions action
      pageSize: z
        .number()
        .int()
        .positive()
        .optional()
        .default(100)
        .describe('Number of revisions to return per page (version_list_revisions only)'),
      pageToken: z
        .string()
        .optional()
        .describe('Token for pagination (version_list_revisions only)'),

      // Fields for version_get_revision, version_restore_revision, version_keep_revision actions
      revisionId: z
        .string()
        .optional()
        .describe(
          'Revision ID (required for: version_get_revision, version_restore_revision, version_keep_revision; optional for: version_compare, version_export)'
        ),

      // Fields for version_keep_revision action
      keepForever: z
        .boolean()
        .optional()
        .describe('Whether to keep revision forever (required for: version_keep_revision)'),

      // Fields for version_create_snapshot action
      name: z.string().optional().describe('Name for the snapshot (version_create_snapshot only)'),
      description: z
        .string()
        .optional()
        .describe('Description for the snapshot (version_create_snapshot only)'),
      destinationFolderId: z
        .string()
        .optional()
        .describe('Google Drive folder ID for snapshot (version_create_snapshot only)'),
      taskId: z
        .string()
        .optional()
        .describe(
          'Snapshot task ID from version_create_snapshot (required for: version_snapshot_status)'
        ),

      // Fields for version_restore_snapshot, version_delete_snapshot actions
      snapshotId: z
        .string()
        .optional()
        .describe('Snapshot ID (required for: version_restore_snapshot, version_delete_snapshot)'),

      // Fields for version_compare action
      revisionId1: z
        .string()
        .optional()
        .describe('First revision ID to compare (version_compare only)'),
      revisionId2: z
        .string()
        .optional()
        .describe('Second revision ID to compare (version_compare only)'),
      sheetId: SheetIdSchema.optional().describe(
        'Specific sheet to compare (version_compare only)'
      ),

      // Fields for version_export action
      format: z
        .enum(['xlsx', 'csv', 'pdf', 'ods'])
        .optional()
        .default('xlsx')
        .describe('Export format (version_export only)'),

      // ========== APPROVAL FIELDS ==========
      // Fields for approval_create action
      range: z
        .string()
        .optional()
        .describe('Cell or range reference to protect (required for: approval_create)'),
      approvers: z
        .array(z.string().email())
        .optional()
        .describe('List of approver email addresses (required for: approval_create)'),
      requiredApprovals: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1)
        .describe('Number of approvals required (approval_create only, default: 1)'),
      message: z
        .string()
        .optional()
        .describe('Message for approval request (approval_create only)'),
      expirationDays: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Days until approval expires (approval_create only)'),

      // Fields for approval operations
      approvalId: z
        .string()
        .optional()
        .describe(
          'Approval ID to operate on (required for: approval_approve, approval_reject, approval_get_status, approval_delegate, approval_cancel)'
        ),

      // Fields for approval_delegate action
      delegateTo: z
        .string()
        .email()
        .optional()
        .describe('Email address to delegate approval to (required for: approval_delegate)'),

      // ========== ACCESS PROPOSAL FIELDS ==========
      // Fields for list_access_proposals and resolve_access_proposal actions
      proposalId: z
        .string()
        .optional()
        .describe(
          'The proposal ID from list_access_proposals (required for: resolve_access_proposal)'
        ),

      decision: z
        .enum(['APPROVE', 'DENY'])
        .optional()
        .describe('The resolution decision (required for: resolve_access_proposal)'),

      // ========== DRIVE LABEL FIELDS ==========
      // Fields for label_list, label_apply, label_remove actions
      fileId: z
        .string()
        .optional()
        .describe(
          'The spreadsheet/Drive file ID (required for: label_list, label_apply, label_remove; defaults to spreadsheetId if omitted)'
        ),
      labelId: z
        .string()
        .optional()
        .describe(
          'The Drive Label ID to apply or remove (required for: label_apply, label_remove)'
        ),
      includeLabels: z
        .array(z.string())
        .optional()
        .describe('Filter to specific label IDs in results (label_list only)'),
      labelFields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Label field values to set when applying a label (label_apply only)'),

      // Safety options for all mutation operations
      safety: SafetyOptionsSchema.optional().describe(
        'Safety options like dryRun (applies to all destructive operations)'
      ),

      // ===== LLM OPTIMIZATION: VERBOSITY CONTROL =====
      verbosity: z
        .enum(['minimal', 'standard', 'detailed'])
        .optional()
        .default('standard')
        .describe(
          'Response detail level: minimal (essential info only, ~40% less tokens), standard (balanced), detailed (full metadata)'
        ),
    })
    .refine(
      (data) => {
        // Validate required fields based on action
        switch (data.action) {
          // Sharing actions
          case 'share_add':
            // share_add required-field checks are handled by the superRefine below,
            // which provides path-specific error messages instead of a generic failure.
            return true;
          case 'share_update':
            return !!data.spreadsheetId && !!data.permissionId && !!data.role;
          case 'share_remove':
            return !!data.spreadsheetId && !!data.permissionId;
          case 'share_list':
            return !!data.spreadsheetId;
          case 'share_get':
            return !!data.spreadsheetId && !!data.permissionId;
          case 'share_transfer_ownership':
            return !!data.spreadsheetId && !!data.newOwnerEmail;
          case 'share_set_link':
            return !!data.spreadsheetId && data.enabled !== undefined;
          case 'share_get_link':
            return !!data.spreadsheetId;

          // Comment actions
          case 'comment_add':
            return !!data.spreadsheetId && !!data.content;
          case 'comment_update':
            return !!data.spreadsheetId && !!data.commentId && !!data.content;
          case 'comment_delete':
          case 'comment_get':
          case 'comment_resolve':
          case 'comment_reopen':
            return !!data.spreadsheetId && !!data.commentId;
          case 'comment_list':
            return !!data.spreadsheetId;
          case 'comment_add_reply':
            return !!data.spreadsheetId && !!data.commentId && !!data.content;
          case 'comment_update_reply':
            return !!data.spreadsheetId && !!data.commentId && !!data.replyId && !!data.content;
          case 'comment_delete_reply':
            return !!data.spreadsheetId && !!data.commentId && !!data.replyId;

          // Version actions
          case 'version_list_revisions':
            return !!data.spreadsheetId;
          case 'version_get_revision':
            return !!data.spreadsheetId && !!data.revisionId;
          case 'version_restore_revision':
            return !!data.spreadsheetId && !!data.revisionId;
          case 'version_keep_revision':
            return !!data.spreadsheetId && !!data.revisionId && data.keepForever !== undefined;
          case 'version_create_snapshot':
            return !!data.spreadsheetId;
          case 'version_snapshot_status':
            return !!data.spreadsheetId && !!data.taskId;
          case 'version_list_snapshots':
            return !!data.spreadsheetId;
          case 'version_restore_snapshot':
            return !!data.spreadsheetId && !!data.snapshotId;
          case 'version_delete_snapshot':
            return !!data.spreadsheetId && !!data.snapshotId;
          case 'version_compare':
            return !!data.spreadsheetId;
          case 'version_export':
            return !!data.spreadsheetId;

          // Approval actions
          case 'approval_create':
            return (
              !!data.spreadsheetId && !!data.range && !!data.approvers && data.approvers.length > 0
            );
          case 'approval_approve':
          case 'approval_reject':
          case 'approval_get_status':
          case 'approval_cancel':
            return !!data.spreadsheetId && !!data.approvalId;
          case 'approval_list_pending':
            return !!data.spreadsheetId;
          case 'approval_delegate':
            return !!data.spreadsheetId && !!data.approvalId && !!data.delegateTo;

          // Access proposal actions
          case 'list_access_proposals':
            return !!data.spreadsheetId;
          case 'resolve_access_proposal':
            return !!data.spreadsheetId && !!data.proposalId && !!data.decision;

          // Drive Label actions
          case 'label_list':
            return !!(data.fileId ?? data.spreadsheetId);
          case 'label_apply':
            return !!(data.fileId ?? data.spreadsheetId) && !!data.labelId;
          case 'label_remove':
            return !!(data.fileId ?? data.spreadsheetId) && !!data.labelId;

          default:
            return false;
        }
      },
      {
        message: 'Missing required fields for the specified action',
      }
    )
    .superRefine((data, ctx) => {
      // Path-specific required-field errors so LLMs receive actionable messages
      // (e.g. "commentId is required for comment_delete") instead of a generic failure.
      // Covers high-frequency actions where generic "Missing required fields" is unhelpful.

      const requireField = (field: string, value: unknown, actionName: string): void => {
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for ${actionName}`,
          });
        }
      };

      // Common: spreadsheetId is required for almost all actions
      const actionsWithoutSpreadsheetId = new Set(['label_list', 'label_apply', 'label_remove']);
      if (!actionsWithoutSpreadsheetId.has(data.action) && !data.spreadsheetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['spreadsheetId'],
          message: `spreadsheetId is required for ${data.action}`,
        });
      }

      switch (data.action) {
        // ---- Sharing ----
        case 'share_add':
          requireField('type', data.type, 'share_add');
          requireField('role', data.role, 'share_add');
          if (data.type === 'user' || data.type === 'group') {
            if (!data.emailAddress) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['emailAddress'],
                message: `emailAddress is required when type is '${data.type}'`,
              });
            }
          }
          if (data.type === 'domain') {
            if (!data.domain) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['domain'],
                message: "domain is required when type is 'domain' (e.g. 'example.com')",
              });
            } else if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(data.domain)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['domain'],
                message:
                  'domain must be a valid domain name (e.g. "example.com", "corp.example.org")',
              });
            }
          }
          break;
        case 'share_update':
          requireField('permissionId', data.permissionId, 'share_update');
          requireField('role', data.role, 'share_update');
          break;
        case 'share_remove':
        case 'share_get':
          requireField('permissionId', data.permissionId, data.action);
          break;
        case 'share_transfer_ownership':
          requireField('newOwnerEmail', data.newOwnerEmail, 'share_transfer_ownership');
          break;
        case 'share_set_link':
          if (data.enabled === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['enabled'],
              message: 'enabled (true/false) is required for share_set_link',
            });
          }
          break;

        // ---- Comments ----
        case 'comment_add':
          requireField('content', data.content, 'comment_add');
          break;
        case 'comment_update':
          requireField('commentId', data.commentId, 'comment_update');
          requireField('content', data.content, 'comment_update');
          break;
        case 'comment_delete':
        case 'comment_get':
        case 'comment_resolve':
        case 'comment_reopen':
          requireField('commentId', data.commentId, data.action);
          break;
        case 'comment_add_reply':
          requireField('commentId', data.commentId, 'comment_add_reply');
          requireField('content', data.content, 'comment_add_reply');
          break;
        case 'comment_update_reply':
          requireField('commentId', data.commentId, 'comment_update_reply');
          requireField('replyId', data.replyId, 'comment_update_reply');
          requireField('content', data.content, 'comment_update_reply');
          break;
        case 'comment_delete_reply':
          requireField('commentId', data.commentId, 'comment_delete_reply');
          requireField('replyId', data.replyId, 'comment_delete_reply');
          break;

        // ---- Versions ----
        case 'version_get_revision':
        case 'version_restore_revision':
          requireField('revisionId', data.revisionId, data.action);
          break;
        case 'version_keep_revision':
          requireField('revisionId', data.revisionId, 'version_keep_revision');
          if (data.keepForever === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['keepForever'],
              message: 'keepForever (true/false) is required for version_keep_revision',
            });
          }
          break;
        case 'version_snapshot_status':
          requireField('taskId', data.taskId, 'version_snapshot_status');
          break;
        case 'version_restore_snapshot':
        case 'version_delete_snapshot':
          requireField('snapshotId', data.snapshotId, data.action);
          break;

        // ---- Approvals ----
        case 'approval_create':
          requireField('range', data.range, 'approval_create');
          if (!data.approvers || data.approvers.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['approvers'],
              message: 'approvers (non-empty email array) is required for approval_create',
            });
          }
          break;
        case 'approval_approve':
        case 'approval_reject':
        case 'approval_get_status':
        case 'approval_cancel':
          requireField('approvalId', data.approvalId, data.action);
          break;
        case 'approval_delegate':
          requireField('approvalId', data.approvalId, 'approval_delegate');
          requireField('delegateTo', data.delegateTo, 'approval_delegate');
          break;

        // ---- Access proposals ----
        case 'resolve_access_proposal':
          requireField('proposalId', data.proposalId, 'resolve_access_proposal');
          requireField('decision', data.decision, 'resolve_access_proposal');
          break;

        // ---- Labels ----
        case 'label_list':
          if (!data.fileId && !data.spreadsheetId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['fileId'],
              message: 'Either fileId or spreadsheetId is required for label_list',
            });
          }
          break;
        case 'label_apply':
        case 'label_remove':
          if (!data.fileId && !data.spreadsheetId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['fileId'],
              message: `Either fileId or spreadsheetId is required for ${data.action}`,
            });
          }
          requireField('labelId', data.labelId, data.action);
          break;

        default:
          break;
      }
    }),
});

// ========== OUTPUT SCHEMA ==========

const CollaborateResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string(),
    // Sharing response fields
    permission: PermissionSchema.optional(),
    permissions: z.array(PermissionSchema).optional(),
    sharingLink: z.string().optional(),
    // Comment response fields
    comment: CommentSchema.optional(),
    comments: z.array(CommentSchema).optional(),
    replyId: z.string().optional(),
    // Version response fields
    revision: RevisionSchema.optional(),
    revisions: z.array(RevisionSchema).optional(),
    nextPageToken: z.string().optional(),
    snapshot: SnapshotSchema.optional(),
    snapshots: z.array(SnapshotSchema).optional(),
    taskId: z.string().optional(),
    taskStatus: z.enum(['working', 'completed', 'failed']).optional(),
    taskStatusMessage: z.string().optional(),
    taskCreatedAt: z.string().optional(),
    taskUpdatedAt: z.string().optional(),
    pollAfterMs: z.coerce.number().int().optional(),
    taskError: ErrorDetailSchema.optional(),
    comparison: z
      .object({
        sheetsAdded: z.array(z.string()).optional(),
        sheetsRemoved: z.array(z.string()).optional(),
        sheetsModified: z.array(z.string()).optional(),
        cellChanges: z.coerce.number().int().optional(),
      })
      .optional(),
    exportUrl: z.string().optional(),
    exportData: z.string().optional(),
    // Approval response fields
    approval: ApprovalSchema.optional(),
    approvals: z.array(ApprovalSchema).optional(),
    // Drive Label response fields
    labels: z.array(z.record(z.string(), z.unknown())).optional(),
    labelId: z.string().optional(),
    fileId: z.string().optional(),
    // Common response fields
    dryRun: z.boolean().optional(),
    mutation: MutationSummarySchema.optional(),
    _meta: ResponseMetaSchema.optional(),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsCollaborateOutputSchema = z.object({
  response: CollaborateResponseSchema,
});

// ========== ANNOTATIONS ==========

export const SHEETS_COLLABORATE_ANNOTATIONS: ToolAnnotations = {
  title: 'Collaboration',
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

// ========== TYPE EXPORTS ==========

export type SheetsCollaborateInput = z.infer<typeof SheetsCollaborateInputSchema>;
export type SheetsCollaborateOutput = z.infer<typeof SheetsCollaborateOutputSchema>;
export type CollaborateResponse = z.infer<typeof CollaborateResponseSchema>;
/** The unwrapped request type (the discriminated union of actions) */
export type CollaborateRequest = SheetsCollaborateInput['request'];
export type Approval = z.infer<typeof ApprovalSchema>;

// ========== TYPE NARROWING HELPERS ==========
// These provide type safety similar to discriminated union Extract<>

// Sharing action types (8)
export type CollaborateShareAddInput = SheetsCollaborateInput['request'] & {
  action: 'share_add';
  spreadsheetId: string;
  type: string;
  role: string;
};
export type CollaborateShareUpdateInput = SheetsCollaborateInput['request'] & {
  action: 'share_update';
  spreadsheetId: string;
  permissionId: string;
  role: string;
};
export type CollaborateShareRemoveInput = SheetsCollaborateInput['request'] & {
  action: 'share_remove';
  spreadsheetId: string;
  permissionId: string;
};
export type CollaborateShareListInput = SheetsCollaborateInput['request'] & {
  action: 'share_list';
  spreadsheetId: string;
};
export type CollaborateShareGetInput = SheetsCollaborateInput['request'] & {
  action: 'share_get';
  spreadsheetId: string;
  permissionId: string;
};
export type CollaborateShareTransferOwnershipInput = SheetsCollaborateInput['request'] & {
  action: 'share_transfer_ownership';
  spreadsheetId: string;
  newOwnerEmail: string;
};
export type CollaborateShareSetLinkInput = SheetsCollaborateInput['request'] & {
  action: 'share_set_link';
  spreadsheetId: string;
  enabled: boolean;
  allowFileDiscovery?: boolean;
};
export type CollaborateShareGetLinkInput = SheetsCollaborateInput['request'] & {
  action: 'share_get_link';
  spreadsheetId: string;
};

// Comment action types (10)
export type CollaborateCommentAddInput = SheetsCollaborateInput['request'] & {
  action: 'comment_add';
  spreadsheetId: string;
  content: string;
};
export type CollaborateCommentUpdateInput = SheetsCollaborateInput['request'] & {
  action: 'comment_update';
  spreadsheetId: string;
  commentId: string;
  content: string;
};
export type CollaborateCommentDeleteInput = SheetsCollaborateInput['request'] & {
  action: 'comment_delete';
  spreadsheetId: string;
  commentId: string;
};
export type CollaborateCommentListInput = SheetsCollaborateInput['request'] & {
  action: 'comment_list';
  spreadsheetId: string;
};
export type CollaborateCommentGetInput = SheetsCollaborateInput['request'] & {
  action: 'comment_get';
  spreadsheetId: string;
  commentId: string;
};
export type CollaborateCommentResolveInput = SheetsCollaborateInput['request'] & {
  action: 'comment_resolve';
  spreadsheetId: string;
  commentId: string;
};
export type CollaborateCommentReopenInput = SheetsCollaborateInput['request'] & {
  action: 'comment_reopen';
  spreadsheetId: string;
  commentId: string;
};
export type CollaborateCommentAddReplyInput = SheetsCollaborateInput['request'] & {
  action: 'comment_add_reply';
  spreadsheetId: string;
  commentId: string;
  content: string;
};
export type CollaborateCommentUpdateReplyInput = SheetsCollaborateInput['request'] & {
  action: 'comment_update_reply';
  spreadsheetId: string;
  commentId: string;
  replyId: string;
  content: string;
};
export type CollaborateCommentDeleteReplyInput = SheetsCollaborateInput['request'] & {
  action: 'comment_delete_reply';
  spreadsheetId: string;
  commentId: string;
  replyId: string;
};

// Version action types (11)
export type CollaborateVersionListRevisionsInput = SheetsCollaborateInput['request'] & {
  action: 'version_list_revisions';
  spreadsheetId: string;
  pageSize?: number;
  afterRevisionId?: string;
};
export type CollaborateVersionGetRevisionInput = SheetsCollaborateInput['request'] & {
  action: 'version_get_revision';
  spreadsheetId: string;
  revisionId: string;
};
export type CollaborateVersionRestoreRevisionInput = SheetsCollaborateInput['request'] & {
  action: 'version_restore_revision';
  spreadsheetId: string;
  revisionId: string;
};
export type CollaborateVersionKeepRevisionInput = SheetsCollaborateInput['request'] & {
  action: 'version_keep_revision';
  spreadsheetId: string;
  revisionId: string;
  keepForever: boolean;
};
export type CollaborateVersionCreateSnapshotInput = SheetsCollaborateInput['request'] & {
  action: 'version_create_snapshot';
  spreadsheetId: string;
};
export type CollaborateVersionSnapshotStatusInput = SheetsCollaborateInput['request'] & {
  action: 'version_snapshot_status';
  spreadsheetId: string;
  taskId: string;
};
export type CollaborateVersionListSnapshotsInput = SheetsCollaborateInput['request'] & {
  action: 'version_list_snapshots';
  spreadsheetId: string;
};
export type CollaborateVersionRestoreSnapshotInput = SheetsCollaborateInput['request'] & {
  action: 'version_restore_snapshot';
  spreadsheetId: string;
  snapshotId: string;
};
export type CollaborateVersionDeleteSnapshotInput = SheetsCollaborateInput['request'] & {
  action: 'version_delete_snapshot';
  spreadsheetId: string;
  snapshotId: string;
};
export type CollaborateVersionCompareInput = SheetsCollaborateInput['request'] & {
  action: 'version_compare';
  spreadsheetId: string;
};
export type CollaborateVersionExportInput = SheetsCollaborateInput['request'] & {
  action: 'version_export';
  spreadsheetId: string;
};

// Approval action types (7)
export type CollaborateApprovalCreateInput = SheetsCollaborateInput['request'] & {
  action: 'approval_create';
  spreadsheetId: string;
  range: string;
  approvers: string[];
};
export type CollaborateApprovalApproveInput = SheetsCollaborateInput['request'] & {
  action: 'approval_approve';
  spreadsheetId: string;
  approvalId: string;
};
export type CollaborateApprovalRejectInput = SheetsCollaborateInput['request'] & {
  action: 'approval_reject';
  spreadsheetId: string;
  approvalId: string;
};
export type CollaborateApprovalGetStatusInput = SheetsCollaborateInput['request'] & {
  action: 'approval_get_status';
  spreadsheetId: string;
  approvalId: string;
};
export type CollaborateApprovalListPendingInput = SheetsCollaborateInput['request'] & {
  action: 'approval_list_pending';
  spreadsheetId: string;
};
export type CollaborateApprovalDelegateInput = SheetsCollaborateInput['request'] & {
  action: 'approval_delegate';
  spreadsheetId: string;
  approvalId: string;
  delegateTo: string;
};
export type CollaborateApprovalCancelInput = SheetsCollaborateInput['request'] & {
  action: 'approval_cancel';
  spreadsheetId: string;
  approvalId: string;
};

// Access proposal action types (2)
export type CollaborateListAccessProposalsInput = SheetsCollaborateInput['request'] & {
  action: 'list_access_proposals';
  spreadsheetId: string;
  pageToken?: string;
  pageSize?: number;
};
export type CollaborateResolveAccessProposalInput = SheetsCollaborateInput['request'] & {
  action: 'resolve_access_proposal';
  spreadsheetId: string;
  proposalId: string;
  decision: 'APPROVE' | 'DENY';
  role?: 'reader' | 'commenter' | 'writer';
  sendNotification?: boolean;
};

// Drive Label action types (3)
export type CollaborateLabelListInput = SheetsCollaborateInput['request'] & {
  action: 'label_list';
  fileId?: string;
  spreadsheetId?: string;
  includeLabels?: string[];
};
export type CollaborateLabelApplyInput = SheetsCollaborateInput['request'] & {
  action: 'label_apply';
  fileId?: string;
  spreadsheetId?: string;
  labelId: string;
  labelFields?: Record<string, unknown>;
};
export type CollaborateLabelRemoveInput = SheetsCollaborateInput['request'] & {
  action: 'label_remove';
  fileId?: string;
  spreadsheetId?: string;
  labelId: string;
};
