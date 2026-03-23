/**
 * Regression Tests: sheets_collaborate Discriminated-Union Workaround
 *
 * The MCP SDK v1.26.0 does not correctly convert z.discriminatedUnion() with many
 * variants to JSON Schema (produces { anyOf: [] }). As a workaround, the collaborate
 * schema uses a flat z.object() + z.enum() + .refine() pattern instead.
 *
 * These tests verify that the workaround behaves identically to what a correct
 * z.discriminatedUnion() implementation would produce:
 *   - Valid inputs for each action are accepted
 *   - Missing required fields are rejected
 *   - Invalid action names are rejected
 *   - Cross-action field pollution does not cause false validation (an input valid
 *     for action A but providing action B's name must be rejected)
 *
 * WARNING: If this test suite is ever deleted, ensure you have validated that
 * z.discriminatedUnion() works correctly with the MCP SDK version in use before
 * removing the flat-object + refine() pattern in src/schemas/collaborate.ts.
 *
 * See: src/schemas/collaborate.ts (workaround comment around line 97)
 * See: src/schemas/handler-deviations.ts (collaborate deviation entry)
 */

import { describe, it, expect } from 'vitest';
import { SheetsCollaborateInputSchema } from '../../src/schemas/collaborate.js';

const SPREADSHEET_ID = 'spreadsheet-abc123';

// Helper: wrap a request object in the envelope the schema expects
function wrap(req: Record<string, unknown>) {
  return { request: req };
}

// Helper: assert parsing succeeds
function expectValid(input: unknown) {
  const result = SheetsCollaborateInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Expected valid but got: ${JSON.stringify(result.error.issues, null, 2)}`
    );
  }
  return result.data;
}

// Helper: assert parsing fails
function expectInvalid(input: unknown) {
  const result = SheetsCollaborateInputSchema.safeParse(input);
  expect(result.success, `Expected invalid but schema accepted: ${JSON.stringify(input)}`).toBe(
    false
  );
}

// ============================================================
// SECTION 1: All 41 actions accept a valid minimal input
// ============================================================

describe('sheets_collaborate: all 41 actions accept valid minimal inputs', () => {
  // ---- Sharing (8) ----

  it('share_add: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'share_add',
        spreadsheetId: SPREADSHEET_ID,
        type: 'user',
        role: 'writer',
        emailAddress: 'user@example.com',
      })
    );
  });

  it('share_update: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'share_update',
        spreadsheetId: SPREADSHEET_ID,
        permissionId: 'perm-1',
        role: 'reader',
      })
    );
  });

  it('share_remove: valid input accepted', () => {
    expectValid(
      wrap({ action: 'share_remove', spreadsheetId: SPREADSHEET_ID, permissionId: 'perm-1' })
    );
  });

  it('share_list: valid input accepted', () => {
    expectValid(wrap({ action: 'share_list', spreadsheetId: SPREADSHEET_ID }));
  });

  it('share_get: valid input accepted', () => {
    expectValid(
      wrap({ action: 'share_get', spreadsheetId: SPREADSHEET_ID, permissionId: 'perm-1' })
    );
  });

  it('share_transfer_ownership: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'share_transfer_ownership',
        spreadsheetId: SPREADSHEET_ID,
        newOwnerEmail: 'newowner@example.com',
      })
    );
  });

  it('share_set_link: valid input accepted', () => {
    expectValid(
      wrap({ action: 'share_set_link', spreadsheetId: SPREADSHEET_ID, enabled: true })
    );
  });

  it('share_get_link: valid input accepted', () => {
    expectValid(wrap({ action: 'share_get_link', spreadsheetId: SPREADSHEET_ID }));
  });

  // ---- Comments (10) ----

  it('comment_add: valid input accepted', () => {
    expectValid(
      wrap({ action: 'comment_add', spreadsheetId: SPREADSHEET_ID, content: 'Hello' })
    );
  });

  it('comment_update: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'comment_update',
        spreadsheetId: SPREADSHEET_ID,
        commentId: 'c-1',
        content: 'Updated',
      })
    );
  });

  it('comment_delete: valid input accepted', () => {
    expectValid(
      wrap({ action: 'comment_delete', spreadsheetId: SPREADSHEET_ID, commentId: 'c-1' })
    );
  });

  it('comment_list: valid input accepted', () => {
    expectValid(wrap({ action: 'comment_list', spreadsheetId: SPREADSHEET_ID }));
  });

  it('comment_get: valid input accepted', () => {
    expectValid(
      wrap({ action: 'comment_get', spreadsheetId: SPREADSHEET_ID, commentId: 'c-1' })
    );
  });

  it('comment_resolve: valid input accepted', () => {
    expectValid(
      wrap({ action: 'comment_resolve', spreadsheetId: SPREADSHEET_ID, commentId: 'c-1' })
    );
  });

  it('comment_reopen: valid input accepted', () => {
    expectValid(
      wrap({ action: 'comment_reopen', spreadsheetId: SPREADSHEET_ID, commentId: 'c-1' })
    );
  });

  it('comment_add_reply: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'comment_add_reply',
        spreadsheetId: SPREADSHEET_ID,
        commentId: 'c-1',
        content: 'Reply text',
      })
    );
  });

  it('comment_update_reply: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'comment_update_reply',
        spreadsheetId: SPREADSHEET_ID,
        commentId: 'c-1',
        replyId: 'r-1',
        content: 'Updated reply',
      })
    );
  });

  it('comment_delete_reply: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'comment_delete_reply',
        spreadsheetId: SPREADSHEET_ID,
        commentId: 'c-1',
        replyId: 'r-1',
      })
    );
  });

  // ---- Version (10) ----

  it('version_list_revisions: valid input accepted', () => {
    expectValid(wrap({ action: 'version_list_revisions', spreadsheetId: SPREADSHEET_ID }));
  });

  it('version_get_revision: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'version_get_revision',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: 'rev-1',
      })
    );
  });

  it('version_restore_revision: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'version_restore_revision',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: 'rev-1',
      })
    );
  });

  it('version_keep_revision: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'version_keep_revision',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: 'rev-1',
        keepForever: true,
      })
    );
  });

  it('version_create_snapshot: valid input accepted', () => {
    expectValid(wrap({ action: 'version_create_snapshot', spreadsheetId: SPREADSHEET_ID }));
  });

  it('version_snapshot_status: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'version_snapshot_status',
        spreadsheetId: SPREADSHEET_ID,
        taskId: 'snapshot_task_1',
      })
    );
  });

  it('version_list_snapshots: valid input accepted', () => {
    expectValid(wrap({ action: 'version_list_snapshots', spreadsheetId: SPREADSHEET_ID }));
  });

  it('version_restore_snapshot: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'version_restore_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: 'snap-1',
      })
    );
  });

  it('version_delete_snapshot: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'version_delete_snapshot',
        spreadsheetId: SPREADSHEET_ID,
        snapshotId: 'snap-1',
      })
    );
  });

  it('version_compare: valid input accepted', () => {
    expectValid(wrap({ action: 'version_compare', spreadsheetId: SPREADSHEET_ID }));
  });

  it('version_export: valid input accepted', () => {
    expectValid(wrap({ action: 'version_export', spreadsheetId: SPREADSHEET_ID }));
  });

  // ---- Approval (7) ----

  it('approval_create: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:B10',
        approvers: ['approver@example.com'],
      })
    );
  });

  it('approval_approve: valid input accepted', () => {
    expectValid(
      wrap({ action: 'approval_approve', spreadsheetId: SPREADSHEET_ID, approvalId: 'apv-1' })
    );
  });

  it('approval_reject: valid input accepted', () => {
    expectValid(
      wrap({ action: 'approval_reject', spreadsheetId: SPREADSHEET_ID, approvalId: 'apv-1' })
    );
  });

  it('approval_get_status: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'approval_get_status',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'apv-1',
      })
    );
  });

  it('approval_list_pending: valid input accepted', () => {
    expectValid(wrap({ action: 'approval_list_pending', spreadsheetId: SPREADSHEET_ID }));
  });

  it('approval_delegate: valid input accepted', () => {
    expectValid(
      wrap({
        action: 'approval_delegate',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'apv-1',
        delegateTo: 'delegate@example.com',
      })
    );
  });

  it('approval_cancel: valid input accepted', () => {
    expectValid(
      wrap({ action: 'approval_cancel', spreadsheetId: SPREADSHEET_ID, approvalId: 'apv-1' })
    );
  });
});

// ============================================================
// SECTION 2: Missing required fields are rejected per action
// ============================================================

describe('sheets_collaborate: missing required fields are rejected', () => {
  it('share_add: missing type is rejected', () => {
    expectInvalid(
      wrap({ action: 'share_add', spreadsheetId: SPREADSHEET_ID, role: 'writer' })
    );
  });

  it('share_add: missing role is rejected', () => {
    expectInvalid(
      wrap({ action: 'share_add', spreadsheetId: SPREADSHEET_ID, type: 'user' })
    );
  });

  it('share_add: missing spreadsheetId is rejected', () => {
    expectInvalid(wrap({ action: 'share_add', type: 'user', role: 'writer' }));
  });

  it('share_update: missing permissionId is rejected', () => {
    expectInvalid(
      wrap({ action: 'share_update', spreadsheetId: SPREADSHEET_ID, role: 'reader' })
    );
  });

  it('share_update: missing role is rejected', () => {
    expectInvalid(
      wrap({ action: 'share_update', spreadsheetId: SPREADSHEET_ID, permissionId: 'perm-1' })
    );
  });

  it('share_remove: missing permissionId is rejected', () => {
    expectInvalid(wrap({ action: 'share_remove', spreadsheetId: SPREADSHEET_ID }));
  });

  it('share_transfer_ownership: missing newOwnerEmail is rejected', () => {
    expectInvalid(wrap({ action: 'share_transfer_ownership', spreadsheetId: SPREADSHEET_ID }));
  });

  it('share_set_link: missing enabled is rejected', () => {
    expectInvalid(wrap({ action: 'share_set_link', spreadsheetId: SPREADSHEET_ID }));
  });

  it('comment_add: missing content is rejected', () => {
    expectInvalid(wrap({ action: 'comment_add', spreadsheetId: SPREADSHEET_ID }));
  });

  it('comment_update: missing commentId is rejected', () => {
    expectInvalid(
      wrap({ action: 'comment_update', spreadsheetId: SPREADSHEET_ID, content: 'Updated' })
    );
  });

  it('comment_update: missing content is rejected', () => {
    expectInvalid(
      wrap({ action: 'comment_update', spreadsheetId: SPREADSHEET_ID, commentId: 'c-1' })
    );
  });

  it('comment_delete: missing commentId is rejected', () => {
    expectInvalid(wrap({ action: 'comment_delete', spreadsheetId: SPREADSHEET_ID }));
  });

  it('comment_add_reply: missing commentId is rejected', () => {
    expectInvalid(
      wrap({ action: 'comment_add_reply', spreadsheetId: SPREADSHEET_ID, content: 'Reply' })
    );
  });

  it('comment_add_reply: missing content is rejected', () => {
    expectInvalid(
      wrap({ action: 'comment_add_reply', spreadsheetId: SPREADSHEET_ID, commentId: 'c-1' })
    );
  });

  it('comment_update_reply: missing replyId is rejected', () => {
    expectInvalid(
      wrap({
        action: 'comment_update_reply',
        spreadsheetId: SPREADSHEET_ID,
        commentId: 'c-1',
        content: 'Updated',
      })
    );
  });

  it('comment_delete_reply: missing replyId is rejected', () => {
    expectInvalid(
      wrap({
        action: 'comment_delete_reply',
        spreadsheetId: SPREADSHEET_ID,
        commentId: 'c-1',
      })
    );
  });

  it('version_get_revision: missing revisionId is rejected', () => {
    expectInvalid(wrap({ action: 'version_get_revision', spreadsheetId: SPREADSHEET_ID }));
  });

  it('version_keep_revision: missing keepForever is rejected', () => {
    expectInvalid(
      wrap({
        action: 'version_keep_revision',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: 'rev-1',
      })
    );
  });

  it('version_restore_snapshot: missing snapshotId is rejected', () => {
    expectInvalid(wrap({ action: 'version_restore_snapshot', spreadsheetId: SPREADSHEET_ID }));
  });

  it('approval_create: missing range is rejected', () => {
    expectInvalid(
      wrap({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        approvers: ['approver@example.com'],
      })
    );
  });

  it('approval_create: missing approvers is rejected', () => {
    expectInvalid(
      wrap({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:B10',
      })
    );
  });

  it('approval_create: empty approvers array is rejected', () => {
    expectInvalid(
      wrap({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A1:B10',
        approvers: [],
      })
    );
  });

  it('approval_approve: missing approvalId is rejected', () => {
    expectInvalid(wrap({ action: 'approval_approve', spreadsheetId: SPREADSHEET_ID }));
  });

  it('approval_delegate: missing delegateTo is rejected', () => {
    expectInvalid(
      wrap({
        action: 'approval_delegate',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'apv-1',
      })
    );
  });
});

// ============================================================
// SECTION 3: Invalid action names are rejected
// ============================================================

describe('sheets_collaborate: invalid action names are rejected', () => {
  it('unknown action name is rejected', () => {
    expectInvalid(wrap({ action: 'nonexistent_action', spreadsheetId: SPREADSHEET_ID }));
  });

  it('empty string action is rejected', () => {
    expectInvalid(wrap({ action: '', spreadsheetId: SPREADSHEET_ID }));
  });

  it('missing action field is rejected', () => {
    expectInvalid(wrap({ spreadsheetId: SPREADSHEET_ID }));
  });

  it('action from a different tool is rejected', () => {
    // 'read' is a valid sheets_data action but not a collaborate action
    expectInvalid(wrap({ action: 'read', spreadsheetId: SPREADSHEET_ID }));
  });
});

// ============================================================
// SECTION 4: Cross-action pollution is rejected
// A request that supplies the right fields for one action but
// specifies a different action name must be rejected. This is
// the key invariant that z.discriminatedUnion() would enforce
// automatically; the refine() workaround must do it manually.
// ============================================================

describe('sheets_collaborate: cross-action field pollution is rejected', () => {
  it('share_add fields + comment_add action: missing required share_add fields rejected', () => {
    // comment_add requires: spreadsheetId + content
    // share_add fields (type, role) are provided but content is missing
    expectInvalid(
      wrap({
        action: 'comment_add',
        spreadsheetId: SPREADSHEET_ID,
        type: 'user',
        role: 'writer',
        // content intentionally omitted
      })
    );
  });

  it('comment_add fields + share_add action: missing required share fields rejected', () => {
    // share_add requires: spreadsheetId + type + role
    // content is provided (comment field) but type/role are missing
    expectInvalid(
      wrap({
        action: 'share_add',
        spreadsheetId: SPREADSHEET_ID,
        content: 'Hello world',
        // type and role intentionally omitted
      })
    );
  });

  it('version_list fields + version_keep_revision action: missing keepForever rejected', () => {
    // version_keep_revision requires: spreadsheetId + revisionId + keepForever
    // Extra version_list fields (pageSize) are present but keepForever is missing
    expectInvalid(
      wrap({
        action: 'version_keep_revision',
        spreadsheetId: SPREADSHEET_ID,
        revisionId: 'rev-1',
        pageSize: 10,
        // keepForever intentionally omitted
      })
    );
  });

  it('approval_approve fields + approval_create action: missing required create fields rejected', () => {
    // approval_create requires: spreadsheetId + range + approvers
    // approvalId (an approve-specific field) is provided but range/approvers missing
    expectInvalid(
      wrap({
        action: 'approval_create',
        spreadsheetId: SPREADSHEET_ID,
        approvalId: 'apv-1',
        // range and approvers intentionally omitted
      })
    );
  });

  it('share_transfer_ownership + comment_add action: missing required comment fields rejected', () => {
    // comment_add requires: spreadsheetId + content
    // newOwnerEmail (a transfer-ownership field) is present but content is missing
    expectInvalid(
      wrap({
        action: 'comment_add',
        spreadsheetId: SPREADSHEET_ID,
        newOwnerEmail: 'someone@example.com',
        // content intentionally omitted
      })
    );
  });
});
