import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AirtableBackend,
  type AirtableBackendConfig,
  type AirtableClient,
} from '../../src/adapters/airtable-backend.js';

function createMockClient(): AirtableClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

describe('AirtableBackend', () => {
  let client: AirtableClient;
  let backend: AirtableBackend;

  beforeEach(() => {
    process.env['ENABLE_EXPERIMENTAL_BACKENDS'] = 'true';
    client = createMockClient();
    backend = new AirtableBackend({ client } satisfies AirtableBackendConfig);
  });

  it('parses document metadata from Airtable base and table responses', async () => {
    vi.mocked(client.get)
      .mockResolvedValueOnce({
        tables: [
          {
            id: 'tblProjects',
            name: 'Projects',
            primaryFieldId: 'fldName',
            fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText' }],
            views: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        bases: [{ id: 'appBase', name: 'Workspace Base', permissionLevel: 'create' }],
      });

    const result = await backend.getDocument({ documentId: 'appBase' });

    expect(result.title).toBe('Workspace Base');
    expect(result.sheets).toEqual([
      expect.objectContaining({
        sheetId: 0,
        title: 'Projects',
        columnCount: 1,
      }),
    ]);
  });

  it('coerces Airtable linked records and attachments through readRange', async () => {
    vi.mocked(client.get)
      .mockResolvedValueOnce({
        tables: [
          {
            id: 'tblProjects',
            name: 'Projects',
            primaryFieldId: 'fldName',
            fields: [
              { id: 'fldName', name: 'Name', type: 'singleLineText' },
              { id: 'fldLinks', name: 'Links', type: 'multipleRecordLinks' },
              { id: 'fldFiles', name: 'Files', type: 'multipleAttachments' },
            ],
            views: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        records: [
          {
            id: 'rec1',
            createdTime: '2026-03-08T00:00:00.000Z',
            fields: {
              Name: 'Row 1',
              Files: [{ url: 'https://example.com/a.txt', filename: 'a.txt' }],
              Links: [{ id: 'rec2', name: 'Linked Rec' }],
            },
          },
        ],
      });

    const result = await backend.readRange({
      documentId: 'appBase',
      range: 'Projects!A1:C1',
    });

    expect(result.values).toEqual([['Row 1', 'a.txt', 'Linked Rec']]);
  });

  it('validates mutation params for delete_records and update_field operations', async () => {
    vi.mocked(client.delete).mockResolvedValue({ deleted: true });
    vi.mocked(client.patch).mockResolvedValue({ updated: true });

    const result = await backend.executeBatchMutations('appBase', {
      mutations: [
        {
          type: 'delete_records',
          table: 'Projects',
          params: { records: ['rec1', 'rec2'] },
        },
        {
          type: 'update_field',
          table: 'Projects',
          params: { fieldId: 'fldName', name: 'Project Name' },
        },
      ],
    });

    expect(client.delete).toHaveBeenCalledWith('/v0/appBase/Projects', {
      records: ['rec1', 'rec2'],
    });
    expect(client.patch).toHaveBeenCalledWith(
      '/v0/meta/bases/appBase/tables/Projects/fields/fldName',
      { fieldId: 'fldName', name: 'Project Name' }
    );
    expect(result.appliedCount).toBe(2);
  });

  it('exposes a typed native Airtable handle', () => {
    const native = backend.native();

    expect(native.client).toBe(client);
    expect(native.fieldOrderCache).toBeInstanceOf(Map);
    expect(native.recordIdCache).toBeInstanceOf(Map);
  });
});
