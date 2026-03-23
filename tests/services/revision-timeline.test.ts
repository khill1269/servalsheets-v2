import { describe, it, expect, vi } from 'vitest';
import { getTimeline } from '../../src/services/revision-timeline.js';
import type { drive_v3 } from 'googleapis';

function makeDriveRevision(id: string, modifiedTime: string): drive_v3.Schema$Revision {
  return {
    id,
    modifiedTime,
    lastModifyingUser: { emailAddress: 'user@example.com', displayName: 'Test User' },
    size: '1024',
  };
}

function makeMockDriveApi(
  revisions: drive_v3.Schema$Revision[],
  nextPageToken?: string
): drive_v3.Drive {
  return {
    revisions: {
      list: vi.fn().mockResolvedValue({
        data: { revisions, nextPageToken },
      }),
    },
  } as unknown as drive_v3.Drive;
}

describe('getTimeline', () => {
  it('returns items, truncated=false, totalFetched for single-page results', async () => {
    const revisions = [
      makeDriveRevision('rev-1', '2026-01-01T00:00:00Z'),
      makeDriveRevision('rev-2', '2026-01-02T00:00:00Z'),
    ];
    const driveApi = makeMockDriveApi(revisions);

    const result = await getTimeline(driveApi, 'spreadsheet-id');

    expect(result.items).toHaveLength(2);
    expect(result.totalFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.nextPageToken).toBeUndefined();
  });

  it('returns nextPageToken and truncated=true when maxPages cap is hit', async () => {
    const revisions = [makeDriveRevision('rev-1', '2026-01-01T00:00:00Z')];
    const driveApi = {
      revisions: {
        list: vi.fn().mockResolvedValue({
          data: { revisions, nextPageToken: 'page-token-2' },
        }),
      },
    } as unknown as drive_v3.Drive;

    const result = await getTimeline(driveApi, 'spreadsheet-id', { maxPages: 1 });

    expect(result.truncated).toBe(true);
    expect(result.nextPageToken).toBe('page-token-2');
  });

  it('filters by since/until timestamps', async () => {
    const revisions = [
      makeDriveRevision('rev-1', '2026-01-01T00:00:00Z'),
      makeDriveRevision('rev-2', '2026-01-15T00:00:00Z'),
      makeDriveRevision('rev-3', '2026-02-01T00:00:00Z'),
    ];
    const driveApi = makeMockDriveApi(revisions);

    const result = await getTimeline(driveApi, 'spreadsheet-id', {
      since: '2026-01-10T00:00:00Z',
      until: '2026-01-20T00:00:00Z',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].revisionId).toBe('rev-2');
    expect(result.totalFetched).toBe(3);
  });

  it('respects limit parameter', async () => {
    const revisions = [
      makeDriveRevision('rev-1', '2026-01-01T00:00:00Z'),
      makeDriveRevision('rev-2', '2026-01-02T00:00:00Z'),
      makeDriveRevision('rev-3', '2026-01-03T00:00:00Z'),
    ];
    const driveApi = makeMockDriveApi(revisions);

    const result = await getTimeline(driveApi, 'spreadsheet-id', { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.totalFetched).toBe(3);
  });

  it('returns empty items when no revisions exist', async () => {
    const driveApi = makeMockDriveApi([]);

    const result = await getTimeline(driveApi, 'spreadsheet-id');

    expect(result.items).toHaveLength(0);
    expect(result.totalFetched).toBe(0);
    expect(result.truncated).toBe(false);
  });
});
