/**
 * ServalSheets - Revision Timeline Service (F5)
 *
 * Drive Revisions API integration for chronological change history,
 * cell-level diffs between revisions, and surgical cell restore.
 * Phase 3: Drive Activity API for WHO/WHEN attribution.
 */

import type { drive_v3, driveactivity_v2, sheets_v4 } from 'googleapis';
import { logger } from '../utils/logger.js';
import type { GoogleApiClient } from './google-api.js';
import { NotFoundError } from '../core/errors.js';

export interface TimelineEntry {
  revisionId: string;
  timestamp: string;
  user?: string;
  activityActorRef?: string;
  displayName?: string;
  sizeBytes?: number;
  activityType?: string;
}

export interface TimelineResult {
  items: TimelineEntry[];
  totalFetched: number;
  truncated: boolean;
  nextPageToken?: string;
  activityAvailable: boolean;
}

export interface RevisionRef {
  id: string;
  timestamp?: string;
  user?: string;
}

export interface CellChange {
  cell: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  changeType: 'added' | 'removed' | 'modified';
}

export interface DiffResult {
  revision1: RevisionRef;
  revision2: RevisionRef;
  cellChanges?: CellChange[];
  isHistorical: boolean;
  summary: {
    metadataOnly: boolean;
    rev1Size?: number;
    rev2Size?: number;
  };
}

export interface RestoreResult {
  cell: string;
  restoredValue?: string | number | null;
}

async function getCurrentUserEmail(googleClient: GoogleApiClient): Promise<string | undefined> {
  try {
    const response = await googleClient.drive.about.get({
      fields: 'user(emailAddress)',
    });
    return response.data.user?.emailAddress ?? undefined;
  } catch {
    return undefined; // OK: user email unavailable
  }
}

function resolveActivityActor(
  actor: driveactivity_v2.Schema$Actor | undefined,
  currentUserEmail?: string
): { user?: string; actorRef?: string } {
  const knownUser = actor?.user?.knownUser;
  const impersonatedKnownUser = actor?.impersonation?.impersonatedUser?.knownUser;

  if (knownUser?.isCurrentUser || impersonatedKnownUser?.isCurrentUser) {
    return { user: currentUserEmail ?? 'current_user' };
  }
  if (knownUser?.personName) {
    return { actorRef: knownUser.personName };
  }
  if (actor?.user?.deletedUser) {
    return { actorRef: 'deleted_user' };
  }
  if (actor?.user?.unknownUser) {
    return { actorRef: 'unknown_user' };
  }
  return { actorRef: 'unknown' };
}

/**
 * Get Drive Activity events for WHO/WHEN attribution.
 */
export async function getActivityEvents(
  googleClient: GoogleApiClient,
  fileId: string,
  startTime?: string,
  endTime?: string
): Promise<Array<{ timestamp: string; user?: string; actorRef?: string; actionType: string }>> {
  try {
    const driveActivityApi = googleClient.driveActivity;
    if (!driveActivityApi) return [];

    const filter = startTime
      ? `time >= "${startTime}"${endTime ? ` AND time <= "${endTime}"` : ''}`
      : undefined;

    const response = await driveActivityApi.activity.query({
      requestBody: {
        itemName: `items/${fileId}`,
        filter,
        pageSize: 100,
      },
    });

    const activities = response.data.activities ?? [];
    const currentUserEmail = activities.some((activity) => {
      const actor = activity.actors?.[0];
      return (
        actor?.user?.knownUser?.isCurrentUser === true ||
        actor?.impersonation?.impersonatedUser?.knownUser?.isCurrentUser === true
      );
    })
      ? await getCurrentUserEmail(googleClient)
      : undefined;

    return activities.map((activity) => {
      const actor = activity.actors?.[0];
      const timestamp = activity.timestamp ?? activity.timeRange?.startTime ?? '';
      const actionType = Object.keys(activity.primaryActionDetail ?? {})[0] ?? 'edit';
      const resolvedActor = resolveActivityActor(actor, currentUserEmail);
      return {
        timestamp,
        user: resolvedActor.user,
        actorRef: resolvedActor.actorRef,
        actionType,
      };
    });
  } catch {
    // Drive Activity API may not be authorized — graceful degradation
    return [];
  }
}

/**
 * Get chronological revision timeline for a spreadsheet.
 */
export async function getTimeline(
  driveApi: drive_v3.Drive,
  spreadsheetId: string,
  options: {
    since?: string;
    until?: string;
    limit?: number;
    maxPages?: number;
    googleClient?: GoogleApiClient;
  } = {}
): Promise<TimelineResult> {
  const limit = options.limit ?? 50;
  const maxPages = options.maxPages ?? 25; // Reduced from 50 to prevent timeouts
  const DEADLINE_MS = 45_000; // 45-second deadline to stay within MCP timeout
  const startTime = Date.now();

  const allRevisionItems: drive_v3.Schema$Revision[] = [];
  let pageToken: string | undefined;
  let nextPageToken: string | undefined;
  let pagesRead = 0;

  do {
    // Deadline check: bail out before MCP timeout
    if (Date.now() - startTime > DEADLINE_MS) {
      nextPageToken = pageToken;
      logger.warn('revision-timeline: deadline exceeded; returning partial results', {
        spreadsheetId,
        pagesRead,
        elapsedMs: Date.now() - startTime,
        revisionsLoaded: allRevisionItems.length,
      });
      break;
    }

    const response = await driveApi.revisions.list({
      fileId: spreadsheetId,
      pageSize: 1000, // Drive revisions.list allows up to 1000 items per page.
      pageToken,
      fields:
        'nextPageToken,revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress),size)',
    });
    allRevisionItems.push(...(response.data.revisions ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
    pagesRead++;
    if (pagesRead >= maxPages && pageToken) {
      nextPageToken = pageToken;
      logger.warn('revision-timeline: hit pagination cap; history may be truncated', {
        spreadsheetId,
        pagesRead,
        maxPages,
      });
      break;
    }
  } while (pageToken);

  let revisions: TimelineEntry[] = allRevisionItems.map((r) => ({
    revisionId: r.id!,
    timestamp: r.modifiedTime ?? '',
    user: r.lastModifyingUser?.emailAddress ?? undefined,
    activityActorRef: undefined,
    displayName: r.lastModifyingUser?.displayName ?? undefined,
    sizeBytes: r.size ? Number(r.size) : undefined,
    activityType: undefined as string | undefined,
  }));

  if (options.since) {
    const sinceTime = new Date(options.since).getTime();
    revisions = revisions.filter((r) => new Date(r.timestamp).getTime() >= sinceTime);
  }
  if (options.until) {
    const untilTime = new Date(options.until).getTime();
    revisions = revisions.filter((r) => new Date(r.timestamp).getTime() <= untilTime);
  }

  const sliced = revisions.slice(0, limit);
  let activityAvailable = false;

  // Merge Drive Activity events for richer WHO/WHEN attribution
  if (options.googleClient && sliced.length > 0) {
    try {
      const activityEvents = await getActivityEvents(
        options.googleClient,
        spreadsheetId,
        options.since,
        options.until
      );

      if (activityEvents.length > 0) {
        activityAvailable = true;
        // Match activity events to revisions by proximity in time (within 60 seconds)
        for (const entry of sliced) {
          const entryTime = new Date(entry.timestamp).getTime();
          const match = activityEvents.find((a) => {
            const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            return Math.abs(aTime - entryTime) < 60_000;
          });
          if (match) {
            if (!entry.user && match.user) entry.user = match.user;
            if (match.actorRef) entry.activityActorRef = match.actorRef;
            entry.activityType = match.actionType;
          }
        }
      }
    } catch {
      // Non-blocking: activity enrichment is best-effort
    }
  }

  return {
    items: sliced,
    totalFetched: allRevisionItems.length,
    truncated: nextPageToken !== undefined,
    nextPageToken,
    activityAvailable,
  };
}

/**
 * Diff two revisions — returns metadata comparison and cell-level changes
 * when CSV export is available.
 */
export async function diffRevisions(
  driveApi: drive_v3.Drive,
  spreadsheetId: string,
  revisionId1: string,
  revisionId2: string
): Promise<DiffResult> {
  const [rev1Response, rev2Response] = await Promise.all([
    driveApi.revisions.get({
      fileId: spreadsheetId,
      revisionId: revisionId1,
      fields: 'id,modifiedTime,lastModifyingUser(displayName,emailAddress),size',
    }),
    driveApi.revisions.get({
      fileId: spreadsheetId,
      revisionId: revisionId2,
      fields: 'id,modifiedTime,lastModifyingUser(displayName,emailAddress),size',
    }),
  ]);

  const rev1 = rev1Response.data;
  const rev2 = rev2Response.data;

  const revision1: RevisionRef = {
    id: rev1.id!,
    timestamp: rev1.modifiedTime ?? undefined,
    user: rev1.lastModifyingUser?.emailAddress ?? undefined,
  };
  const revision2: RevisionRef = {
    id: rev2.id!,
    timestamp: rev2.modifiedTime ?? undefined,
    user: rev2.lastModifyingUser?.emailAddress ?? undefined,
  };

  // Try CSV export for cell-level diff
  let cellChanges: CellChange[] | undefined;
  let isHistorical = true;
  try {
    const [export1, export2] = await Promise.all([
      exportRevisionAsCsv(driveApi, spreadsheetId, revisionId1),
      exportRevisionAsCsv(driveApi, spreadsheetId, revisionId2),
    ]);
    isHistorical = export1.isHistorical && export2.isHistorical;
    if (export1.data && export2.data) {
      cellChanges = computeCsvDiff(export1.data, export2.data);
    }
  } catch (err) {
    logger.debug('Cell-level diff unavailable, falling back to metadata', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    revision1,
    revision2,
    cellChanges,
    isHistorical,
    summary: {
      metadataOnly: !cellChanges,
      rev1Size: rev1.size ? Number(rev1.size) : undefined,
      rev2Size: rev2.size ? Number(rev2.size) : undefined,
    },
  };
}

/**
 * Restore specific cells from a past revision (surgical restore).
 * Exports the target revision, extracts requested cells, writes them back.
 */
export async function restoreCells(
  driveApi: drive_v3.Drive,
  sheetsApi: sheets_v4.Sheets,
  spreadsheetId: string,
  revisionId: string,
  cells: string[]
): Promise<RestoreResult[]> {
  const { data: csv } = await exportRevisionAsCsv(driveApi, spreadsheetId, revisionId);
  if (!csv) {
    throw new NotFoundError('revision', revisionId, {
      hint: 'This may happen if the revision is too old or the file format is unsupported. Use sheets_collaborate version_list_revisions to find available revisions.',
    });
  }

  const grid = parseCsv(csv);
  const results: RestoreResult[] = [];
  const writeData: { range: string; values: (string | number | null)[][] }[] = [];

  for (const cellRef of cells) {
    const match = cellRef.match(/(?:'?([^'!]+)'?!)?([A-Z]+)(\d+)/i);
    if (!match) {
      results.push({ cell: cellRef, restoredValue: null });
      continue;
    }

    const col = columnToIndex(match[2]!);
    const row = parseInt(match[3]!, 10) - 1;
    const value = grid[row]?.[col] ?? null;

    results.push({ cell: cellRef, restoredValue: value });
    writeData.push({ range: cellRef, values: [[value]] });
  }

  if (writeData.length > 0) {
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: writeData.map((d) => ({ range: d.range, values: d.values })),
      },
    });
  }

  return results;
}

// ── Internal helpers ──

async function exportRevisionAsCsv(
  driveApi: drive_v3.Drive,
  fileId: string,
  revisionId: string // Remove underscore prefix — now actually used
): Promise<{ data: string | null; isHistorical: boolean }> {
  try {
    // Get revision-specific export links from Drive API
    const revisionResponse = await driveApi.revisions.get({
      fileId,
      revisionId,
      fields: 'exportLinks',
    });

    const exportLinks = revisionResponse.data.exportLinks as Record<string, string> | undefined;
    const csvUrl = exportLinks?.['text/csv'];

    if (csvUrl) {
      // Use the revision-pinned export URL via the authenticated OAuth client
      // The googleapis client handles auth automatically when using request()
      const oauth2Client = (
        driveApi as unknown as {
          _options: {
            auth: {
              request: (opts: { url: string; responseType: string }) => Promise<{ data: string }>;
            };
          };
        }
      )._options?.auth;
      if (oauth2Client?.request) {
        const result = await oauth2Client.request({ url: csvUrl, responseType: 'text' });
        return {
          data: typeof result.data === 'string' ? result.data : null,
          isHistorical: true,
        };
      }
    }

    // Fallback: if no export links available (old unpinned revisions), export current version
    // Log warning so callers know they're getting current data, not the requested revision
    logger.warn(
      'revision-timeline: revision export links unavailable; falling back to current file data',
      {
        fileId,
        revisionId,
      }
    );
    const response = await driveApi.files.export({
      fileId,
      mimeType: 'text/csv',
    });
    return {
      data: typeof response.data === 'string' ? response.data : null,
      isHistorical: false,
    };
  } catch {
    return { data: null, isHistorical: false };
  }
}

function parseCsv(csv: string): (string | number | null)[][] {
  return csv.split('\n').map((line) => {
    if (!line.trim()) return [];
    return line.split(',').map((cell) => {
      const trimmed = cell.trim().replace(/^"|"$/g, '');
      if (trimmed === '') return null;
      const num = Number(trimmed);
      return isNaN(num) ? trimmed : num;
    });
  });
}

function computeCsvDiff(csv1: string, csv2: string): CellChange[] {
  const grid1 = parseCsv(csv1);
  const grid2 = parseCsv(csv2);
  const changes: CellChange[] = [];

  const maxRows = Math.max(grid1.length, grid2.length);
  const maxCols = Math.max(...grid1.map((r) => r.length), ...grid2.map((r) => r.length), 1);

  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < maxCols; c++) {
      const v1 = grid1[r]?.[c] ?? null;
      const v2 = grid2[r]?.[c] ?? null;
      if (v1 !== v2) {
        const cell = `${indexToColumn(c)}${r + 1}`;
        if (v1 === null && v2 !== null) {
          changes.push({ cell, newValue: v2, changeType: 'added' });
        } else if (v1 !== null && v2 === null) {
          changes.push({ cell, oldValue: v1, changeType: 'removed' });
        } else {
          changes.push({ cell, oldValue: v1, newValue: v2, changeType: 'modified' });
        }
      }
    }
  }
  return changes;
}

function columnToIndex(col: string): number {
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.toUpperCase().charCodeAt(i) - 64);
  }
  return idx - 1;
}

function indexToColumn(idx: number): string {
  let col = '';
  let n = idx + 1;
  while (n > 0) {
    n--;
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26);
  }
  return col;
}
