import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { sheets_v4 } from 'googleapis';
import { requestDeduplicator, createRequestKey } from '../utils/request-deduplication.js';
import { completeSpreadsheetId } from '../mcp/completions.js';
import { createResourceReadError } from '../utils/mcp-errors.js';

interface QualityIssue {
  type: string;
  location: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export function registerQualityResources(
  server: McpServer,
  googleClient: sheets_v4.Sheets | null
): number {
  const qualityTemplate = new ResourceTemplate('sheets:///{spreadsheetId}/quality', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
    },
  });

  server.registerResource(
    'Data Quality Report',
    qualityTemplate,
    {
      title: 'Data Quality Analysis',
      description: 'Data quality issues, anomalies, and validation errors in spreadsheet',
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
          createRequestKey('quality:analyze', { spreadsheetId }),
          async () => {
            // Fetch first 200 rows from first sheet
            const valuesResponse = await googleClient.spreadsheets.values.get({
              spreadsheetId,
              range: 'A1:Z200',
            });

            const values = valuesResponse.data.values || [];
            const issues: QualityIssue[] = [];

            if (values.length === 0) {
              return {
                spreadsheetId,
                totalRows: 0,
                totalColumns: 0,
                issueCount: 0,
                issues: [],
                score: 0,
              };
            }

            const headers = values[0] || [];
            const seenHeaders = new Set<string>();

            // Check headers
            for (let i = 0; i < headers.length; i++) {
              const header = String(headers[i] || '').trim();
              if (!header) {
                issues.push({
                  type: 'EMPTY_HEADER',
                  location: `Column ${String.fromCharCode(65 + i)}`,
                  severity: 'high',
                  description: 'Column header is empty',
                });
              } else if (seenHeaders.has(header)) {
                issues.push({
                  type: 'DUPLICATE_HEADER',
                  location: `Column ${String.fromCharCode(65 + i)}`,
                  severity: 'high',
                  description: `Duplicate header found: "${header}"`,
                });
              }
              seenHeaders.add(header);
            }

            // Check for empty rows
            for (let row = 1; row < Math.min(values.length, 100); row++) {
              const rowData = values[row] || [];
              if (rowData.every((cell) => !cell || String(cell).trim() === '')) {
                issues.push({
                  type: 'EMPTY_ROW',
                  location: `Row ${row + 1}`,
                  severity: 'medium',
                  description: 'Entire row is empty',
                });
              }
            }

            // Calculate quality score (100 - penalty for each issue)
            const score = Math.max(0, 100 - issues.length * 5);

            return {
              spreadsheetId,
              totalRows: values.length,
              totalColumns: headers.length,
              issueCount: issues.length,
              issues: issues.slice(0, 50), // Limit to first 50 issues
              score,
              analyzedRows: Math.min(values.length, 100),
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

  console.error('[ServalSheets] Registered 1 quality resource');
  return 1;
}
