import { ErrorCodes } from '../error-codes.js';
import { randomUUID } from 'crypto';
import type { drive_v3 } from 'googleapis';
import type { HandlerContext } from '../base.js';
import type {
  CollaborateResponse,
  CollaborateVersionCompareInput,
  CollaborateVersionCreateSnapshotInput,
  CollaborateVersionDeleteSnapshotInput,
  CollaborateVersionExportInput,
  CollaborateVersionGetRevisionInput,
  CollaborateVersionKeepRevisionInput,
  CollaborateVersionListRevisionsInput,
  CollaborateVersionListSnapshotsInput,
  CollaborateVersionRestoreRevisionInput,
  CollaborateVersionRestoreSnapshotInput,
  CollaborateVersionSnapshotStatusInput,
} from '../../schemas/index.js';
import type { ErrorDetail, MutationSummary } from '../../schemas/shared.js';
import { confirmDestructiveAction } from '../../mcp/elicitation.js';
import { createSnapshotIfNeeded } from '../../utils/safety-helpers.js';
import { createNotFoundError } from '../../utils/error-factory.js';
import { logger } from '../../utils/logger.js';
import { registerCleanup } from '../../utils/resource-cleanup.js';
import { sendProgress } from '../../utils/request-context.js';

const DRIVE_MIME_TYPES = {
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',
  PDF: 'application/pdf',
  ODS: 'application/vnd.oasis.opendocument.spreadsheet',
} as const;

type CollaborateSuccess = Extract<CollaborateResponse, { success: true }>;
type SnapshotTaskStatus = 'working' | 'completed' | 'failed';

interface SnapshotTaskRecord {
  taskId: string;
  spreadsheetId: string;
  status: SnapshotTaskStatus;
  statusMessage: string;
  createdAt: string;
  updatedAt: string;
  pollAfterMs: number;
  snapshot?: NonNullable<CollaborateSuccess['snapshot']>;
  error?: ErrorDetail;
}

const SNAPSHOT_TASK_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_TASK_POLL_MS = 1500;
const snapshotTasks = new Map<string, SnapshotTaskRecord>();
let snapshotTaskCleanupInterval: NodeJS.Timeout | null = null;

function cleanExpiredSnapshotTasks(): void {
  const now = Date.now();
  for (const [taskId, task] of snapshotTasks.entries()) {
    if (now - new Date(task.updatedAt).getTime() >= SNAPSHOT_TASK_TTL_MS) {
      snapshotTasks.delete(taskId);
    }
  }
}

function ensureSnapshotTaskCleanup(): void {
  if (snapshotTaskCleanupInterval !== null) {
    return;
  }

  snapshotTaskCleanupInterval = setInterval(cleanExpiredSnapshotTasks, 60 * 1000);
  registerCleanup(
    'version-snapshot-tasks',
    () => {
      if (snapshotTaskCleanupInterval !== null) {
        clearInterval(snapshotTaskCleanupInterval);
        snapshotTaskCleanupInterval = null;
      }
    },
    'snapshot-task-cleanup'
  );
}

ensureSnapshotTaskCleanup();

interface VersionsDeps {
  driveApi: drive_v3.Drive;
  context: HandlerContext;
  checkOperationScopes: (operation: string) => void;
  success: (
    action: string,
    data: Record<string, unknown>,
    mutation?: MutationSummary,
    dryRun?: boolean
  ) => CollaborateResponse;
  error: (error: ErrorDetail) => CollaborateResponse;
  mapError: (error: unknown) => CollaborateResponse;
}

function mapRevision(
  rev: drive_v3.Schema$Revision | undefined
): NonNullable<CollaborateSuccess['revision']> {
  return {
    id: rev?.id ?? '',
    modifiedTime: rev?.modifiedTime ?? '',
    lastModifyingUser: rev?.lastModifyingUser
      ? {
          displayName: rev.lastModifyingUser.displayName ?? '',
          emailAddress: rev.lastModifyingUser.emailAddress ?? undefined,
        }
      : undefined,
    size: rev?.size ?? undefined,
    keepForever: rev?.keepForever ?? false,
  };
}

function mapSnapshot(
  spreadsheetId: string,
  fallbackName: string,
  file: drive_v3.Schema$File | undefined
): NonNullable<CollaborateSuccess['snapshot']> {
  return {
    id: file?.id ?? '',
    name: file?.name ?? fallbackName,
    createdAt: file?.createdTime ?? new Date().toISOString(),
    spreadsheetId,
    copyId: file?.id ?? '',
    size: file?.size ? Number(file.size) : undefined,
  };
}

function updateSnapshotTask(
  taskId: string,
  updates: Partial<Omit<SnapshotTaskRecord, 'taskId' | 'spreadsheetId' | 'createdAt'>>
): SnapshotTaskRecord | null {
  const existing = snapshotTasks.get(taskId);
  if (!existing) {
    return null;
  }

  const updated: SnapshotTaskRecord = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  snapshotTasks.set(taskId, updated);
  return updated;
}

function extractErrorDetail(response: CollaborateResponse): ErrorDetail {
  if (!response.success) {
    return response.error;
  }

  return {
    code: ErrorCodes.INTERNAL_ERROR,
    message: 'Snapshot task failed',
    retryable: false,
  };
}

function startSnapshotCopyTask(
  taskId: string,
  input: CollaborateVersionCreateSnapshotInput,
  deps: VersionsDeps,
  name: string
): void {
  void (async () => {
    try {
      updateSnapshotTask(taskId, {
        status: 'working',
        statusMessage: 'Copying spreadsheet into a Drive snapshot...',
      });

      const response = await deps.driveApi.files.copy({
        fileId: input.spreadsheetId!,
        requestBody: {
          name,
          parents: input.destinationFolderId ? [input.destinationFolderId] : undefined,
          description: input.description,
          appProperties: { sourceSpreadsheetId: input.spreadsheetId! },
        },
        fields: 'id,name,createdTime,size',
        supportsAllDrives: true,
      });

      updateSnapshotTask(taskId, {
        status: 'completed',
        statusMessage: 'Snapshot copy completed',
        snapshot: mapSnapshot(input.spreadsheetId!, name, response.data),
      });
    } catch (error) {
      const mapped = extractErrorDetail(deps.mapError(error));
      updateSnapshotTask(taskId, {
        status: 'failed',
        statusMessage: mapped.message,
        error: mapped,
      });
      logger.error('version_create_snapshot task failed', {
        spreadsheetId: input.spreadsheetId,
        taskId,
        error: mapped.message,
      });
    }
  })();
}

function featureUnavailable(
  action: 'version_restore_revision',
  deps: VersionsDeps
): CollaborateResponse {
  return deps.error({
    code: ErrorCodes.FEATURE_UNAVAILABLE,
    message:
      'version_restore_revision is not supported. The Drive API does not support restoring Google Sheets revisions in-place. Use version_create_snapshot to export a copy, then restore manually.',
    details: {
      action,
      reason: 'Drive API does not support restoring Google Sheets revisions in-place',
    },
    retryable: false,
    suggestedFix:
      'Perform this action via Google Drive UI or extend the handler with custom implementation.',
  });
}

/**
 * Decomposed action handler for `version_list_revisions`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionListRevisionsAction(
  input: CollaborateVersionListRevisionsInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  // Cursor-based pagination via afterRevisionId: collect all revisions until we find the
  // cursor, then return the next page of results.
  if (input.afterRevisionId !== undefined) {
    const pageSize = input.pageSize ?? 100;
    const allRevisions: drive_v3.Schema$Revision[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const PAGE_CAP = 20; // Reduced from 100 to prevent timeouts on large revision histories
    const DEADLINE_MS = 45_000; // 45-second deadline to stay within MCP timeout
    const startTime = Date.now();

    // Fetch revisions across Drive pages to find the cursor position.
    // Uses a deadline check to prevent unbounded fetching.
    await sendProgress(0, PAGE_CAP, 'Scanning revision history...');
    do {
      // Deadline check: bail out before timeout
      if (Date.now() - startTime > DEADLINE_MS) {
        logger.warn(
          `version_list_revisions: deadline exceeded (${DEADLINE_MS}ms) after ${pageCount} pages, ${allRevisions.length} revisions for spreadsheet ${input.spreadsheetId}`
        );
        break;
      }

      const resp = await deps.driveApi.revisions.list({
        fileId: input.spreadsheetId!,
        pageSize: 200,
        fields:
          'revisions(id,modifiedTime,lastModifyingUser/displayName,lastModifyingUser/emailAddress,size,keepForever),nextPageToken',
        ...(pageToken ? { pageToken } : {}),
      });
      allRevisions.push(...(resp.data.revisions ?? []));
      pageToken = resp.data.nextPageToken ?? undefined;
      pageCount++;
      if (pageCount % 5 === 0 || !pageToken) {
        await sendProgress(
          pageCount,
          PAGE_CAP,
          `Scanning revision history... (${allRevisions.length} revisions loaded)`
        );
      }
      if (pageCount >= PAGE_CAP) {
        logger.warn(
          `version_list_revisions: revision list capped at ${PAGE_CAP} pages for afterRevisionId cursor for spreadsheet ${input.spreadsheetId}`
        );
        break;
      }
    } while (pageToken);

    // Find the index of the cursor revision and slice the next page after it.
    const cursorIndex = allRevisions.findIndex((r) => r.id === input.afterRevisionId);
    const startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
    const page = allRevisions.slice(startIndex, startIndex + pageSize);
    const revisions = page.map((revision) => mapRevision(revision));
    const hasMore = startIndex + pageSize < allRevisions.length;
    const nextRevisionId =
      hasMore && page.length > 0 ? (page[page.length - 1]!.id ?? undefined) : undefined;

    return deps.success('version_list_revisions', {
      revisions,
      ...(nextRevisionId !== undefined ? { nextRevisionId } : {}),
    });
  }

  // Token-based pagination (existing behaviour).
  const response = await deps.driveApi.revisions.list({
    fileId: input.spreadsheetId!,
    pageSize: input.pageSize ?? 100,
    pageToken: input.pageToken,
    fields:
      'revisions(id,modifiedTime,lastModifyingUser/displayName,lastModifyingUser/emailAddress,size,keepForever),nextPageToken',
  });

  const revisions = (response.data.revisions ?? []).map((revision) => mapRevision(revision));
  return deps.success('version_list_revisions', {
    revisions,
    nextPageToken: response.data.nextPageToken ?? undefined,
  });
}

/**
 * Decomposed action handler for `version_get_revision`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionGetRevisionAction(
  input: CollaborateVersionGetRevisionInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.revisions.get({
    fileId: input.spreadsheetId!,
    revisionId: input.revisionId!,
    fields:
      'id,modifiedTime,lastModifyingUser/displayName,lastModifyingUser/emailAddress,size,keepForever',
  });

  return deps.success('version_get_revision', {
    revision: mapRevision(response.data),
  });
}

/**
 * Decomposed action handler for `version_restore_revision`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionRestoreRevisionAction(
  input: CollaborateVersionRestoreRevisionInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('version_restore_revision', {}, undefined, true);
  }

  return featureUnavailable('version_restore_revision', deps);
}

/**
 * Decomposed action handler for `version_keep_revision`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionKeepRevisionAction(
  input: CollaborateVersionKeepRevisionInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  const response = await deps.driveApi.revisions.update({
    fileId: input.spreadsheetId!,
    revisionId: input.revisionId!,
    requestBody: { keepForever: input.keepForever! },
    fields:
      'id,modifiedTime,lastModifyingUser/displayName,lastModifyingUser/emailAddress,size,keepForever',
  });

  return deps.success('version_keep_revision', {
    revision: mapRevision(response.data),
  });
}

/**
 * Decomposed action handler for `version_create_snapshot`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionCreateSnapshotAction(
  input: CollaborateVersionCreateSnapshotInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('version_create_snapshot', {}, undefined, true);
  }

  const name = input.name ?? `Snapshot - ${new Date().toISOString()}`;
  const taskId = `snapshot_${randomUUID()}`;
  const now = new Date().toISOString();

  snapshotTasks.set(taskId, {
    taskId,
    spreadsheetId: input.spreadsheetId!,
    status: 'working',
    statusMessage: 'Snapshot copy queued',
    createdAt: now,
    updatedAt: now,
    pollAfterMs: SNAPSHOT_TASK_POLL_MS,
  });
  startSnapshotCopyTask(taskId, input, deps, name);

  return deps.success('version_create_snapshot', {
    taskId,
    taskStatus: 'working',
    taskStatusMessage:
      'Snapshot copy started. Poll version_snapshot_status with this taskId until it completes.',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    pollAfterMs: SNAPSHOT_TASK_POLL_MS,
  });
}

export async function handleVersionSnapshotStatusAction(
  input: CollaborateVersionSnapshotStatusInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  const task = snapshotTasks.get(input.taskId!);
  if (!task || task.spreadsheetId !== input.spreadsheetId) {
    return deps.error({
      code: ErrorCodes.NOT_FOUND,
      message: `Snapshot task not found: ${input.taskId}`,
      retryable: false,
      suggestedFix:
        'Start a new version_create_snapshot call or verify that the taskId belongs to this spreadsheet.',
    });
  }

  return deps.success('version_snapshot_status', {
    taskId: task.taskId,
    taskStatus: task.status,
    taskStatusMessage: task.statusMessage,
    taskCreatedAt: task.createdAt,
    taskUpdatedAt: task.updatedAt,
    ...(task.status === 'working' ? { pollAfterMs: task.pollAfterMs } : {}),
    ...(task.snapshot ? { snapshot: task.snapshot } : {}),
    ...(task.error ? { taskError: task.error } : {}),
  });
}

/**
 * Decomposed action handler for `version_list_snapshots`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionListSnapshotsAction(
  input: CollaborateVersionListSnapshotsInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  deps.checkOperationScopes('version_list_snapshots');

  const allFiles: drive_v3.Schema$File[] = [];
  let snapshotPageToken: string | undefined;
  do {
    const response = await deps.driveApi.files.list({
      q: `appProperties has { key='sourceSpreadsheetId' and value='${input.spreadsheetId}' } and trashed=false`,
      spaces: 'drive',
      fields: 'files(id,name,createdTime,size),nextPageToken',
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(snapshotPageToken ? { pageToken: snapshotPageToken } : {}),
    });
    allFiles.push(...(response.data.files ?? []));
    snapshotPageToken = response.data.nextPageToken ?? undefined;
  } while (snapshotPageToken);

  const snapshots = allFiles.map((file) => ({
    id: file.id ?? '',
    name: file.name ?? '',
    createdAt: file.createdTime ?? '',
    spreadsheetId: input.spreadsheetId!,
    copyId: file.id ?? '',
    size: file.size ? Number(file.size) : undefined,
  }));

  return deps.success('version_list_snapshots', {
    snapshots,
  });
}

/**
 * Decomposed action handler for `version_restore_snapshot`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionRestoreSnapshotAction(
  input: CollaborateVersionRestoreSnapshotInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('version_restore_snapshot', {}, undefined, true);
  }

  const original = await deps.driveApi.files.get({
    fileId: input.spreadsheetId!,
    fields: 'name',
    supportsAllDrives: true,
  });

  const response = await deps.driveApi.files.copy({
    fileId: input.snapshotId!,
    supportsAllDrives: true,
    requestBody: {
      name: `${original.data.name ?? 'Restored Spreadsheet'} (restored from snapshot)`,
    },
    fields: 'id,name,createdTime,size',
  });

  return deps.success('version_restore_snapshot', {
    snapshot: response.data.id
      ? {
          id: input.snapshotId!,
          name: response.data.name ?? '',
          createdAt: response.data.createdTime ?? '',
          spreadsheetId: input.spreadsheetId!,
          copyId: response.data.id,
          size: response.data.size ? Number(response.data.size) : undefined,
        }
      : undefined,
  });
}

/**
 * Decomposed action handler for `version_delete_snapshot`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionDeleteSnapshotAction(
  input: CollaborateVersionDeleteSnapshotInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  if (input.safety?.dryRun) {
    return deps.success('version_delete_snapshot', {}, undefined, true);
  }

  if (deps.context.elicitationServer) {
    const confirmation = await confirmDestructiveAction(
      deps.context.elicitationServer,
      'version_delete_snapshot',
      `Delete Drive snapshot (ID: ${input.snapshotId}). This will permanently remove the snapshot file from Drive. This action cannot be undone.`
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
      operationType: 'version_delete_snapshot',
      isDestructive: true,
      spreadsheetId: input.spreadsheetId,
    },
    input.safety
  );

  await deps.driveApi.files.delete({
    fileId: input.snapshotId!,
    supportsAllDrives: true,
  });

  return deps.success('version_delete_snapshot', {
    snapshotId: snapshot?.snapshotId,
  });
}

/**
 * Decomposed action handler for `version_compare`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionCompareAction(
  input: CollaborateVersionCompareInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  try {
    const needsResolution =
      !input.revisionId1 ||
      !input.revisionId2 ||
      input.revisionId1 === 'head' ||
      input.revisionId1 === 'head~1' ||
      input.revisionId2 === 'head' ||
      input.revisionId2 === 'head~1';

    let resolvedId1 = input.revisionId1;
    let resolvedId2 = input.revisionId2;

    if (needsResolution) {
      const revisionIds: string[] = [];
      let pageToken: string | undefined;
      let pageCount = 0;
      const PAGE_CAP = 100;
      await sendProgress(0, PAGE_CAP, 'Resolving revision references...');
      do {
        const revisionsResponse = await deps.driveApi.revisions.list({
          fileId: input.spreadsheetId!,
          pageSize: 200, // Drive revisions.list max is 200; values above are silently clamped
          fields: 'revisions(id),nextPageToken',
          ...(pageToken ? { pageToken } : {}),
        });
        const ids = (revisionsResponse.data.revisions ?? []).map((r) => r.id!).filter(Boolean);
        revisionIds.push(...ids);
        pageToken = revisionsResponse.data.nextPageToken ?? undefined;
        pageCount++;
        if (pageCount % 10 === 0 || !pageToken) {
          await sendProgress(
            pageCount,
            PAGE_CAP,
            `Resolving revision references... (${revisionIds.length} revisions scanned)`
          );
        }
        if (pageCount >= PAGE_CAP) {
          logger.warn(
            `version_compare: revision list capped at ${PAGE_CAP} pages (${revisionIds.length} revisions) for spreadsheet ${input.spreadsheetId}`
          );
          break;
        }
      } while (pageToken);

      if (revisionIds.length < 2) {
        return deps.error({
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Spreadsheet has fewer than 2 revisions to compare',
          retryable: false,
        });
      }

      const headId = revisionIds[revisionIds.length - 1]!;
      const prevId = revisionIds[revisionIds.length - 2]!;

      resolvedId1 =
        resolvedId1 === 'head'
          ? headId
          : resolvedId1 === 'head~1'
            ? prevId
            : (resolvedId1 ?? prevId);
      resolvedId2 =
        resolvedId2 === 'head'
          ? headId
          : resolvedId2 === 'head~1'
            ? prevId
            : (resolvedId2 ?? headId);
    }

    const [rev1Response, rev2Response] = await Promise.all([
      deps.driveApi.revisions.get({
        fileId: input.spreadsheetId!,
        revisionId: resolvedId1!,
        fields: 'id,modifiedTime,lastModifyingUser,size',
      }),
      deps.driveApi.revisions.get({
        fileId: input.spreadsheetId!,
        revisionId: resolvedId2!,
        fields: 'id,modifiedTime,lastModifyingUser,size',
      }),
    ]);

    const rev1 = rev1Response.data;
    const rev2 = rev2Response.data;

    return deps.success('version_compare', {
      revisions: [mapRevision(rev1), mapRevision(rev2)],
      comparison: {
        cellChanges: undefined,
      },
    });
  } catch (error) {
    return deps.mapError(error);
  }
}

/**
 * Decomposed action handler for `version_export`.
 * Preserves original behavior while moving logic out of the main CollaborateHandler class.
 */
export async function handleVersionExportAction(
  input: CollaborateVersionExportInput,
  deps: VersionsDeps
): Promise<CollaborateResponse> {
  const format = input.format ?? 'xlsx';
  const mimeMap: Record<string, string> = {
    xlsx: DRIVE_MIME_TYPES.XLSX,
    csv: DRIVE_MIME_TYPES.CSV,
    pdf: DRIVE_MIME_TYPES.PDF,
    ods: DRIVE_MIME_TYPES.ODS,
  };
  const mimeType = mimeMap[format] ?? mimeMap['xlsx'];

  if (input.revisionId && input.revisionId !== 'head') {
    return deps.error({
      code: ErrorCodes.FEATURE_UNAVAILABLE,
      message:
        'Exporting specific revisions is not supported. Use revisionId="head" or omit it to export the current version.',
      details: {
        revisionId: input.revisionId,
        reason:
          'Google Drive API does not support exporting historical revisions without restoring them first',
      },
      retryable: false,
      suggestedFix:
        'To export a specific revision: (1) Use restore_revision to restore it, (2) Use export_version without revisionId, (3) Optionally restore back to current version.',
    });
  }

  try {
    const response = await deps.driveApi.files.export(
      {
        fileId: input.spreadsheetId!,
        mimeType,
      },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(response.data as ArrayBuffer);
    const exportData = buffer.toString('base64');

    return deps.success('version_export', {
      exportData,
      format: format,
      revisionId: 'head',
      encoding: 'base64' as const,
    });
  } catch (err) {
    const error = err as { code?: number; message?: string; name?: string };

    if (error.code === 404) {
      return deps.error(
        createNotFoundError({
          resourceType: 'spreadsheet',
          resourceId: input.spreadsheetId!,
          searchSuggestion:
            'Verify the spreadsheet ID is correct and you have permission to access it',
        })
      );
    }

    return deps.error({
      code: ErrorCodes.INTERNAL_ERROR,
      message: `Failed to export spreadsheet: ${error?.message ?? 'unknown error'}`,
      details: {
        spreadsheetId: input.spreadsheetId!,
        format: input.format,
        errorType: error?.name,
        errorCode: error?.code,
      },
      retryable: true,
      suggestedFix: 'Please try again. If the issue persists, contact support',
      retryStrategy: 'exponential_backoff',
      resolution:
        'Retry the operation. If error persists, check spreadsheet permissions and Google Drive API status.',
    });
  }
}
