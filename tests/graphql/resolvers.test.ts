import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import { FIELD_MASKS } from '../../src/constants/field-masks.js';

describe('GraphQL resolvers', () => {
  it('uses explicit fields mask for spreadsheet metadata query', async () => {
    const spreadsheetGet = vi.fn().mockResolvedValue({
      data: {
        properties: { title: 'Sheet Title' },
        sheets: [{ properties: { title: 'Sheet1' } }],
      },
    });

    const context = {
      handlerContext: {
        googleClient: {
          sheets: {
            spreadsheets: {
              get: spreadsheetGet,
            },
          },
        },
      },
    } as any;

    const result = await (resolvers.Query as Record<string, Function>)['spreadsheet'](
      null,
      { spreadsheetId: 'sheet-123' },
      context
    );

    expect(spreadsheetGet).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'sheet-123',
        includeGridData: false,
        fields: FIELD_MASKS.SPREADSHEET_WITH_SHEETS,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        spreadsheetId: 'sheet-123',
        title: 'Sheet Title',
      })
    );
  });
});
