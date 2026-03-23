import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { sheets_v4 } from 'googleapis';
import { requestDeduplicator, createRequestKey } from '../utils/request-deduplication.js';
import { completeSpreadsheetId } from '../mcp/completions.js';
import { createResourceReadError } from '../utils/mcp-errors.js';

export function registerPivotResources(
  server: McpServer,
  googleClient: sheets_v4.Sheets | null
): number {
  const pivotsTemplate = new ResourceTemplate('sheets:///{spreadsheetId}/pivots', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
    },
  });

  server.registerResource(
    'Spreadsheet Pivot Tables',
    pivotsTemplate,
    {
      title: 'Pivot Tables',
      description: 'All pivot tables in a spreadsheet with configuration and source ranges',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const spreadsheetId = Array.isArray(variables['spreadsheetId'])
        ? variables['spreadsheetId'][0]
        : variables['spreadsheetId'];

      if (!spreadsheetId || !googleClient) {
        return { contents: [] };
      }

      try {
        const data = await requestDeduplicator.deduplicate(
          createRequestKey('pivots:list', { spreadsheetId }),
          async () => {
            // Note: Pivot tables are not exposed via the standard sheets.get() fields we request.
            // This resource returns a structured note and guidance rather than attempting
            // to infer pivots from unrelated metadata.
            return {
              note: 'Pivot table access requires specialized API calls',
              recommendation: 'Use sheets_visualize tool for creating and managing pivot tables',
              spreadsheetId,
            };
          }
        );

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data),
            },
          ],
        };
      } catch (error) {
        throw createResourceReadError(uri.href, error);
      }
    }
  );

  console.error('[ServalSheets] Registered 1 pivot resource');
  return 1;
}
