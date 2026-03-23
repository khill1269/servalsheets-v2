/**
 * ServalSheets - History Time-Travel Handler Tests (ISSUE-238)
 *
 * Unit tests for F5 time-travel actions: timeline, diff_revisions, restore_cells.
 * Tests handler dispatch, error paths, dry-run, and Drive API unavailable cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HistoryHandler } from '../../src/handlers/history.js';
import type { SnapshotService } from '../../src/services/snapshot.js';

// Mock revision-timeline service
vi.mock('../../src/services/revision-timeline.js', () => ({
  getTimeline: vi.fn(),
  diffRevisions: vi.fn(),
  restoreCells: vi.fn(),
}));

// Mock sampling consent (non-blocking in tests)
vi.mock('../../src/mcp/sampling.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/mcp/sampling.js')>();
  return {
    ...actual,
    assertSamplingConsent: vi.fn().mockResolvedValue(undefined),
    withSamplingTimeout: vi.fn().mockImplementation((p: Promise<unknown>) => p),
  };
});

// Mock session context
vi.mock('../../src/services/session-context.js', () => ({
  getSessionContext: vi.fn(() => ({
    setPendingOperation: vi.fn(),
    getPendingOperation: vi.fn(),
  })),
}));

// Mock history service (needed by handler constructor path)
vi.mock('../../src/services/history-service.js', () => ({
  getHistoryService: vi.fn(() => null),
  setHistoryService: vi.fn(),
}));

const createMockSnapshotService = (): SnapshotService =>
  ({
    create: vi.fn().mockResolvedValue('snap-001'),
    restore: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    clear: vi.fn(),
  }) as any;

const createMockDriveApi = () => ({}) as any;
const createMockSheetsApi = () => ({}) as any;

describe('HistoryHandler — time-travel actions (ISSUE-238)', () => {
  let handler: HistoryHandler;
  let mockSnapshotService: SnapshotService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshotService = createMockSnapshotService();
    handler = new HistoryHandler({
      snapshotService: mockSnapshotService,
      driveApi: createMockDriveApi(),
      sheetsApi: createMockSheetsApi(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── timeline ─────────────────────────────────────────────────────────────

  describe('timeline action', () => {
    it('should return timeline entries on success', async () => {
      const { getTimeline } = await import('../../src/services/revision-timeline.js');
      const mockTimeline = {
        items: [
          { revisionId: 'r2', timestamp: '2026-01-02T00:00:00Z', user: 'alice@example.com' },
          { revisionId: 'r1', timestamp: '2026-01-01T00:00:00Z', user: 'bob@example.com' },
        ],
        totalFetched: 2,
        truncated: false,
        activityAvailable: false,
      };
      vi.mocked(getTimeline).mockResolvedValue(mockTimeline as any);

      const result = await handler.handle({
        request: { action: 'timeline', spreadsheetId: 'sheet-abc' },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.timeline).toHaveLength(2);
        expect(result.response.timeline![0].revisionId).toBe('r2');
        expect(result.response.message).toContain('2');
      }
    });

    it('should return error when Drive API is unavailable', async () => {
      handler = new HistoryHandler({
        snapshotService: mockSnapshotService,
        // no driveApi
      });

      const result = await handler.handle({
        request: { action: 'timeline', spreadsheetId: 'sheet-abc' },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('should return empty timeline when no entries found', async () => {
      const { getTimeline } = await import('../../src/services/revision-timeline.js');
      vi.mocked(getTimeline).mockResolvedValue({
        items: [],
        totalFetched: 0,
        truncated: false,
        activityAvailable: false,
      } as any);

      const result = await handler.handle({
        request: {
          action: 'timeline',
          spreadsheetId: 'sheet-abc',
          since: '2026-01-01',
          until: '2026-01-02',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.timeline).toHaveLength(0);
        expect(result.response.message).toContain('0');
      }
    });
  });

  // ─── diff_revisions ────────────────────────────────────────────────────────

  describe('diff_revisions action', () => {
    it('should return cell-level diff on success', async () => {
      const { diffRevisions } = await import('../../src/services/revision-timeline.js');
      const mockDiff = {
        summary: { metadataOnly: false, changedCells: 3 },
        cellChanges: [
          { cell: 'Sheet1!A1', oldValue: 'foo', newValue: 'bar' },
          { cell: 'Sheet1!B2', oldValue: 100, newValue: 200 },
          { cell: 'Sheet1!C3', oldValue: null, newValue: 'new' },
        ],
      };
      vi.mocked(diffRevisions).mockResolvedValue(mockDiff as any);

      const result = await handler.handle({
        request: {
          action: 'diff_revisions',
          spreadsheetId: 'sheet-abc',
          revisionId1: 'r1',
          revisionId2: 'r2',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.diff).toBeDefined();
        expect(result.response.message).toContain('3');
      }
    });

    it('should return metadata-only message when Drive cannot export historical content', async () => {
      const { diffRevisions } = await import('../../src/services/revision-timeline.js');
      vi.mocked(diffRevisions).mockResolvedValue({
        summary: { metadataOnly: true },
        cellChanges: [],
      } as any);

      const result = await handler.handle({
        request: {
          action: 'diff_revisions',
          spreadsheetId: 'sheet-abc',
          revisionId1: 'r1',
          revisionId2: 'r2',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.message).toContain('Cell-level diff unavailable');
      }
    });

    it('should return error when Drive API is unavailable', async () => {
      handler = new HistoryHandler({ snapshotService: mockSnapshotService });

      const result = await handler.handle({
        request: {
          action: 'diff_revisions',
          spreadsheetId: 'sheet-abc',
          revisionId1: 'r1',
          revisionId2: 'r2',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  // ─── restore_cells ─────────────────────────────────────────────────────────

  describe('restore_cells action', () => {
    it('should return dry-run result without calling restoreCells', async () => {
      const { restoreCells } = await import('../../src/services/revision-timeline.js');

      const result = await handler.handle({
        request: {
          action: 'restore_cells',
          spreadsheetId: 'sheet-abc',
          revisionId: 'r1',
          cells: ['Sheet1!D15', 'Sheet1!E20'],
          safety: { dryRun: true },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.message).toContain('Dry run');
        expect(result.response.restored).toHaveLength(2);
      }
      expect(vi.mocked(restoreCells)).not.toHaveBeenCalled();
    });

    it('should restore cells and return restored list', async () => {
      const { restoreCells } = await import('../../src/services/revision-timeline.js');
      vi.mocked(restoreCells).mockResolvedValue([
        { cell: 'Sheet1!D15', restoredValue: 5000 },
        { cell: 'Sheet1!E20', restoredValue: 'old text' },
      ] as any);

      const result = await handler.handle({
        request: {
          action: 'restore_cells',
          spreadsheetId: 'sheet-abc',
          revisionId: 'r1',
          cells: ['Sheet1!D15', 'Sheet1!E20'],
          safety: { createSnapshot: false },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.restored).toHaveLength(2);
      }
    });

    it('should return error when Drive or Sheets API is unavailable', async () => {
      handler = new HistoryHandler({ snapshotService: mockSnapshotService });

      const result = await handler.handle({
        request: {
          action: 'restore_cells',
          spreadsheetId: 'sheet-abc',
          revisionId: 'r1',
          cells: ['Sheet1!A1'],
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(result.response.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
