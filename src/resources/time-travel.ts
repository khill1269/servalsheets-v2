/**
 * ServalSheets - Time Travel Debugger Resources
 *
 * Exposes checkpoint history and cell blame analysis as read-only MCP resources.
 *
 * URI Patterns:
 *   debug://time-travel/{spreadsheetId}/checkpoints  → list checkpoints for a spreadsheet
 *   debug://time-travel/{spreadsheetId}/blame/{cell} → blame a cell (which op last touched it)
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTimeTravelDebugger } from '../services/time-travel.js';
import { logger } from '../utils/logger.js';
import { completeSpreadsheetId } from '../mcp/completions.js';

/**
 * Register time-travel debug resources with the MCP server
 */
export function registerTimeTravelResources(server: McpServer): void {
  const debugger_ = getTimeTravelDebugger();

  // Resource 1: debug://time-travel/{spreadsheetId}/checkpoints
  server.registerResource(
    'Time Travel Checkpoints',
    new ResourceTemplate('debug://time-travel/{spreadsheetId}/checkpoints', {
      list: undefined,
      complete: {
        spreadsheetId: async (value) => completeSpreadsheetId(value),
      },
    }),
    {
      description:
        'List debug checkpoints for a spreadsheet. Checkpoints are created before multi-step operations to enable blame analysis.',
      mimeType: 'application/json',
    },
    async (uri, { spreadsheetId }) => {
      try {
        const id = Array.isArray(spreadsheetId) ? spreadsheetId[0] : spreadsheetId;
        if (!id) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify({ error: 'spreadsheetId required' }),
              },
            ],
          };
        }
        const checkpoints = debugger_.listCheckpoints(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  spreadsheetId: id,
                  checkpointCount: checkpoints.length,
                  checkpoints: checkpoints.map((cp) => ({
                    id: cp.id,
                    name: cp.name,
                    createdAt: cp.createdAt,
                    operationCount: cp.operations.length,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Time travel checkpoints resource failed', { error });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    }
  );

  // Resource 2: debug://time-travel/{spreadsheetId}/blame/{cell}
  server.registerResource(
    'Time Travel Cell Blame',
    new ResourceTemplate('debug://time-travel/{spreadsheetId}/blame/{cell}', {
      list: undefined,
      complete: {
        spreadsheetId: async (value) => completeSpreadsheetId(value),
      },
    }),
    {
      description:
        'Show which operations last touched a cell. Use A1 notation with sheet: e.g. "Sheet1!B5".',
      mimeType: 'application/json',
    },
    async (uri, { spreadsheetId, cell }) => {
      try {
        const id = Array.isArray(spreadsheetId) ? spreadsheetId[0] : spreadsheetId;
        const cellRef = Array.isArray(cell) ? cell[0] : cell;
        if (!id || !cellRef) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify({ error: 'spreadsheetId and cell required' }),
              },
            ],
          };
        }
        const blameResult = debugger_.blameCell(id, decodeURIComponent(cellRef));
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  spreadsheetId: id,
                  cell: decodeURIComponent(cellRef),
                  operationCount: blameResult.operations.length,
                  operations: blameResult.operations.map((op) => ({
                    id: op.id,
                    tool: op.tool,
                    action: op.action,
                    result: op.result,
                    range: op.params['range'] as string | undefined,
                    timestamp: op.timestamp,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Time travel blame resource failed', { error });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    }
  );
}
