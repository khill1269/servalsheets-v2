import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { sheets_v4 } from 'googleapis';
import { requestDeduplicator, createRequestKey } from '../utils/request-deduplication.js';
import { completeSpreadsheetId, completeChartId } from '../mcp/completions.js';
import { createResourceNotFoundError, createResourceReadError } from '../utils/mcp-errors.js';

export function registerChartResources(
  server: McpServer,
  googleClient: sheets_v4.Sheets | null
): number {
  let count = 0;

  // Resource 1: All charts in spreadsheet
  const chartsTemplate = new ResourceTemplate('sheets:///{spreadsheetId}/charts', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
    },
  });

  server.registerResource(
    'Spreadsheet Charts',
    chartsTemplate,
    {
      title: 'Charts in Spreadsheet',
      description: 'All charts and visualizations in a spreadsheet with specifications and styling',
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
          createRequestKey('charts:list', { spreadsheetId }),
          async () => {
            const response = await googleClient.spreadsheets.get({
              spreadsheetId,
              fields: 'sheets.charts',
            });

            const charts: Array<{
              chartId: number | null | undefined;
              sheetId: number | null | undefined;
              title: string | null | undefined;
              chartType: string | null | undefined;
              position: unknown;
            }> = [];

            for (const sheet of response.data.sheets || []) {
              if (sheet.charts) {
                for (const chart of sheet.charts) {
                  charts.push({
                    chartId: chart.chartId,
                    sheetId: sheet.properties?.sheetId,
                    title: chart.spec?.title,
                    chartType:
                      chart.spec?.basicChart?.chartType || chart.spec?.pieChart
                        ? 'PIE_CHART'
                        : chart.spec?.bubbleChart
                          ? 'BUBBLE_CHART'
                          : 'UNKNOWN',
                    position: chart.position,
                  });
                }
              }
            }

            return charts;
          }
        );

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ charts: data, total: data.length }),
            },
          ],
        };
      } catch (error) {
        throw createResourceReadError(uri.href, error);
      }
    }
  );
  count++;

  // Resource 2: Specific chart details
  const chartTemplate = new ResourceTemplate('sheets:///{spreadsheetId}/charts/{chartId}', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
      chartId: async (value) => completeChartId(value),
    },
  });

  server.registerResource(
    'Chart Details',
    chartTemplate,
    {
      title: 'Chart Specification',
      description: 'Complete specification of a specific chart including data ranges and styling',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const spreadsheetId = Array.isArray(variables['spreadsheetId'])
        ? variables['spreadsheetId'][0]
        : variables['spreadsheetId'];
      const chartId = Array.isArray(variables['chartId'])
        ? variables['chartId'][0]
        : variables['chartId'];

      if (!spreadsheetId || !chartId || !googleClient) {
        return { contents: [] };
      }

      try {
        const data = await requestDeduplicator.deduplicate(
          createRequestKey('chart:get', { spreadsheetId, chartId }),
          async () => {
            const response = await googleClient.spreadsheets.get({
              spreadsheetId,
              fields: 'sheets.charts',
            });

            const chartIdNum = parseInt(chartId, 10);
            for (const sheet of response.data.sheets || []) {
              for (const chart of sheet.charts || []) {
                if (chart.chartId === chartIdNum) {
                  return chart;
                }
              }
            }
            throw createResourceNotFoundError(
              'chart',
              chartId,
              'Use sheets:///{spreadsheetId}/charts to list all charts'
            );
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
  count++;

  console.error(`[ServalSheets] Registered ${count} chart resources`);
  return count;
}
