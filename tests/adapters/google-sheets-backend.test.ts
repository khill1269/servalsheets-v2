/**
 * GoogleSheetsBackend adapter tests
 *
 * Verifies that GoogleSheetsBackend correctly implements SpreadsheetBackend
 * by delegating to the underlying GoogleApiClient (mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleSheetsBackend } from '../../src/adapters/google-sheets-backend.js';

// ─── Mock Factory ────────────────────────────────────────────

function createMockSheetsApi() {
  return {
    spreadsheets: {
      get: vi.fn(),
      create: vi.fn(),
      batchUpdate: vi.fn(),
      values: {
        get: vi.fn(),
        update: vi.fn(),
        append: vi.fn(),
        clear: vi.fn(),
        batchGet: vi.fn(),
        batchUpdate: vi.fn(),
        batchClear: vi.fn(),
      },
      sheets: {
        copyTo: vi.fn(),
      },
    },
  };
}

function createMockDriveApi() {
  return {
    files: {
      get: vi.fn(),
      list: vi.fn(),
      copy: vi.fn(),
    },
    revisions: {
      get: vi.fn(),
      list: vi.fn(),
    },
  };
}

function createMockClient(
  sheetsApi: ReturnType<typeof createMockSheetsApi>,
  driveApi: ReturnType<typeof createMockDriveApi>
) {
  return {
    sheets: sheetsApi,
    drive: driveApi,
    bigquery: null,
    docs: null,
    slides: null,
    oauth2: {},
  } as unknown as import('../../src/services/google-api.js').GoogleApiClient;
}

// ─── Tests ───────────────────────────────────────────────────

describe('GoogleSheetsBackend', () => {
  let mockSheets: ReturnType<typeof createMockSheetsApi>;
  let mockDrive: ReturnType<typeof createMockDriveApi>;
  let backend: GoogleSheetsBackend;

  beforeEach(() => {
    mockSheets = createMockSheetsApi();
    mockDrive = createMockDriveApi();
    const client = createMockClient(mockSheets, mockDrive);
    backend = new GoogleSheetsBackend(client);
  });

  // ─── Identity & Lifecycle ──────────────────────────────────

  it('has platform = google-sheets', () => {
    expect(backend.platform).toBe('google-sheets');
  });

  it('initialize and dispose do not throw', async () => {
    await expect(backend.initialize()).resolves.toBeUndefined();
    await expect(backend.dispose()).resolves.toBeUndefined();
  });

  // ─── Value Operations ──────────────────────────────────────

  describe('readRange', () => {
    it('calls sheets.spreadsheets.values.get with correct params', async () => {
      mockSheets.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          range: 'Sheet1!A1:B2',
          majorDimension: 'ROWS',
          values: [
            ['a', 'b'],
            ['c', 'd'],
          ],
        },
      });

      const result = await backend.readRange({
        documentId: 'doc123',
        range: 'Sheet1!A1:B2',
      });

      expect(mockSheets.spreadsheets.values.get).toHaveBeenCalledWith({
        spreadsheetId: 'doc123',
        range: 'Sheet1!A1:B2',
        majorDimension: undefined,
        valueRenderOption: undefined,
        dateTimeRenderOption: undefined,
      });

      expect(result).toEqual({
        range: 'Sheet1!A1:B2',
        majorDimension: 'ROWS',
        values: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      });
    });

    it('returns empty values when API returns no values', async () => {
      mockSheets.spreadsheets.values.get.mockResolvedValueOnce({
        data: { range: 'Sheet1!A1:B2' },
      });

      const result = await backend.readRange({
        documentId: 'doc123',
        range: 'Sheet1!A1:B2',
      });

      expect(result.values).toEqual([]);
    });
  });

  describe('writeRange', () => {
    it('calls sheets.spreadsheets.values.update', async () => {
      mockSheets.spreadsheets.values.update.mockResolvedValueOnce({
        data: {
          updatedRange: 'Sheet1!A1:B2',
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
        },
      });

      const result = await backend.writeRange({
        documentId: 'doc123',
        range: 'Sheet1!A1:B2',
        values: [
          ['x', 'y'],
          ['z', 'w'],
        ],
      });

      expect(result.updatedCells).toBe(4);
      expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'doc123',
          range: 'Sheet1!A1:B2',
          valueInputOption: 'USER_ENTERED',
        })
      );
    });
  });

  describe('appendRows', () => {
    it('calls sheets.spreadsheets.values.append', async () => {
      mockSheets.spreadsheets.values.append.mockResolvedValueOnce({
        data: {
          tableRange: 'Sheet1!A1:B5',
          updates: {
            updatedRange: 'Sheet1!A6:B7',
            updatedRows: 2,
            updatedColumns: 2,
            updatedCells: 4,
          },
        },
      });

      const result = await backend.appendRows({
        documentId: 'doc123',
        range: 'Sheet1!A1:B1',
        values: [['new1', 'new2']],
      });

      expect(result.tableRange).toBe('Sheet1!A1:B5');
      expect(result.updatedCells).toBe(4);
    });
  });

  describe('clearRange', () => {
    it('calls sheets.spreadsheets.values.clear', async () => {
      mockSheets.spreadsheets.values.clear.mockResolvedValueOnce({
        data: { clearedRange: 'Sheet1!A1:B2' },
      });

      const result = await backend.clearRange({
        documentId: 'doc123',
        range: 'Sheet1!A1:B2',
      });

      expect(result.clearedRange).toBe('Sheet1!A1:B2');
    });
  });

  describe('batchRead', () => {
    it('calls sheets.spreadsheets.values.batchGet', async () => {
      mockSheets.spreadsheets.values.batchGet.mockResolvedValueOnce({
        data: {
          valueRanges: [
            { range: 'Sheet1!A1:A5', values: [['1'], ['2']] },
            { range: 'Sheet1!B1:B5', values: [['x'], ['y']] },
          ],
        },
      });

      const result = await backend.batchRead({
        documentId: 'doc123',
        ranges: ['Sheet1!A1:A5', 'Sheet1!B1:B5'],
      });

      expect(result.valueRanges).toHaveLength(2);
      expect(result.valueRanges[0]!.range).toBe('Sheet1!A1:A5');
    });
  });

  describe('batchWrite', () => {
    it('calls sheets.spreadsheets.values.batchUpdate', async () => {
      mockSheets.spreadsheets.values.batchUpdate.mockResolvedValueOnce({
        data: {
          totalUpdatedRows: 3,
          totalUpdatedColumns: 2,
          totalUpdatedCells: 6,
          responses: [
            { updatedRange: 'Sheet1!A1:B1', updatedRows: 1, updatedColumns: 2, updatedCells: 2 },
          ],
        },
      });

      const result = await backend.batchWrite({
        documentId: 'doc123',
        data: [{ range: 'Sheet1!A1:B1', values: [['a', 'b']] }],
      });

      expect(result.totalUpdatedCells).toBe(6);
      expect(result.responses).toHaveLength(1);
    });
  });

  describe('batchClear', () => {
    it('calls sheets.spreadsheets.values.batchClear', async () => {
      mockSheets.spreadsheets.values.batchClear.mockResolvedValueOnce({
        data: { clearedRanges: ['Sheet1!A1:B2', 'Sheet1!C1:D2'] },
      });

      const result = await backend.batchClear({
        documentId: 'doc123',
        ranges: ['Sheet1!A1:B2', 'Sheet1!C1:D2'],
      });

      expect(result.clearedRanges).toEqual(['Sheet1!A1:B2', 'Sheet1!C1:D2']);
    });
  });

  // ─── Document Operations ───────────────────────────────────

  describe('getDocument', () => {
    it('calls sheets.spreadsheets.get and maps metadata', async () => {
      mockSheets.spreadsheets.get.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'doc123',
          properties: { title: 'Test Sheet', locale: 'en_US', timeZone: 'UTC' },
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/doc123',
          sheets: [
            {
              properties: {
                sheetId: 0,
                title: 'Sheet1',
                index: 0,
                gridProperties: { rowCount: 1000, columnCount: 26 },
              },
            },
          ],
        },
      });

      const result = await backend.getDocument({ documentId: 'doc123' });

      expect(result.documentId).toBe('doc123');
      expect(result.title).toBe('Test Sheet');
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0]!.title).toBe('Sheet1');
      expect(result.url).toContain('doc123');
    });
  });

  describe('createDocument', () => {
    it('calls sheets.spreadsheets.create', async () => {
      mockSheets.spreadsheets.create.mockResolvedValueOnce({
        data: {
          spreadsheetId: 'new123',
          properties: { title: 'New Doc' },
          sheets: [],
        },
      });

      const result = await backend.createDocument({ title: 'New Doc' });

      expect(result.documentId).toBe('new123');
      expect(result.title).toBe('New Doc');
    });
  });

  // ─── Sheet Operations ──────────────────────────────────────

  describe('addSheet', () => {
    it('calls batchUpdate with addSheet request', async () => {
      mockSheets.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: {
          replies: [
            {
              addSheet: {
                properties: {
                  sheetId: 42,
                  title: 'NewTab',
                  index: 1,
                  gridProperties: { rowCount: 100, columnCount: 10 },
                },
              },
            },
          ],
        },
      });

      const result = await backend.addSheet({
        documentId: 'doc123',
        title: 'NewTab',
        rowCount: 100,
        columnCount: 10,
      });

      expect(result.sheetId).toBe(42);
      expect(result.title).toBe('NewTab');
    });
  });

  describe('deleteSheet', () => {
    it('calls batchUpdate with deleteSheet request', async () => {
      mockSheets.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: { replies: [{}] },
      });

      await expect(
        backend.deleteSheet({ documentId: 'doc123', sheetId: 42 })
      ).resolves.toBeUndefined();

      expect(mockSheets.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'doc123',
          requestBody: {
            requests: [{ deleteSheet: { sheetId: 42 } }],
          },
        })
      );
    });
  });

  describe('copySheet', () => {
    it('calls sheets.copyTo', async () => {
      mockSheets.spreadsheets.sheets.copyTo.mockResolvedValueOnce({
        data: { sheetId: 99, title: 'Copy of Tab', index: 3 },
      });

      const result = await backend.copySheet({
        documentId: 'doc123',
        sheetId: 0,
        destinationDocumentId: 'dest456',
      });

      expect(result.sheetId).toBe(99);
      expect(result.title).toBe('Copy of Tab');
    });
  });

  // ─── Batch Mutations ───────────────────────────────────────

  describe('executeBatchMutations', () => {
    it('passes mutations through to batchUpdate', async () => {
      const mutations = [
        { updateCells: { range: {}, fields: '*' } },
        { addChart: { chart: {} } },
      ];

      mockSheets.spreadsheets.batchUpdate.mockResolvedValueOnce({
        data: { replies: [{}, {}] },
      });

      const result = await backend.executeBatchMutations('doc123', { mutations });

      expect(result.appliedCount).toBe(2);
      expect(mockSheets.spreadsheets.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'doc123',
        requestBody: { requests: mutations },
      });
    });
  });

  // ─── File/Drive Operations ─────────────────────────────────

  describe('copyDocument', () => {
    it('calls drive.files.copy', async () => {
      mockDrive.files.copy.mockResolvedValueOnce({
        data: {
          id: 'copy123',
          name: 'Copy of Doc',
          mimeType: 'application/vnd.google-apps.spreadsheet',
        },
      });

      const result = await backend.copyDocument({
        documentId: 'doc123',
        title: 'Copy of Doc',
      });

      expect(result.documentId).toBe('copy123');
      expect(result.name).toBe('Copy of Doc');
    });
  });

  describe('getFileMetadata', () => {
    it('calls drive.files.get', async () => {
      mockDrive.files.get.mockResolvedValueOnce({
        data: {
          id: 'doc123',
          name: 'My Sheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          modifiedTime: '2026-01-15T10:00:00Z',
        },
      });

      const result = await backend.getFileMetadata('doc123');
      expect(result.documentId).toBe('doc123');
      expect(result.name).toBe('My Sheet');
    });
  });

  describe('listFiles', () => {
    it('calls drive.files.list', async () => {
      mockDrive.files.list.mockResolvedValueOnce({
        data: {
          files: [
            { id: 'f1', name: 'Sheet1', mimeType: 'application/vnd.google-apps.spreadsheet' },
            { id: 'f2', name: 'Sheet2', mimeType: 'application/vnd.google-apps.spreadsheet' },
          ],
          nextPageToken: 'token123',
        },
      });

      const result = await backend.listFiles({ maxResults: 10 });
      expect(result.files).toHaveLength(2);
      expect(result.nextCursor).toBe('token123');
    });
  });

  describe('listRevisions', () => {
    it('calls drive.revisions.list', async () => {
      mockDrive.revisions.list.mockResolvedValueOnce({
        data: {
          revisions: [
            {
              id: 'rev1',
              modifiedTime: '2026-01-15T10:00:00Z',
              lastModifyingUser: { emailAddress: 'user@example.com' },
            },
          ],
        },
      });

      const result = await backend.listRevisions({ documentId: 'doc123' });
      expect(result.revisions).toHaveLength(1);
      expect(result.revisions[0]!.revisionId).toBe('rev1');
    });
  });

  describe('getRevision', () => {
    it('calls drive.revisions.get', async () => {
      mockDrive.revisions.get.mockResolvedValueOnce({
        data: {
          id: 'rev1',
          modifiedTime: '2026-01-15T10:00:00Z',
        },
      });

      const result = await backend.getRevision('doc123', 'rev1');
      expect(result.revisionId).toBe('rev1');
    });
  });

  // ─── Escape Hatch ──────────────────────────────────────────

  describe('native()', () => {
    it('returns sheets and drive clients', () => {
      const nat = backend.native<{
        sheets: unknown;
        drive: unknown;
        client: unknown;
      }>();

      expect(nat.sheets).toBeDefined();
      expect(nat.drive).toBeDefined();
      expect(nat.client).toBeDefined();
    });
  });
});
