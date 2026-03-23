/**
 * ServalSheets - Dynamic Sheet Resources
 *
 * Resource templates for dynamic sheet discovery (MCP 2025-11-25)
 * Enables clients to browse available sheets without explicit tool calls
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HandlerContext } from '../handlers/index.js';
import { logger } from '../utils/logger.js';
import { createInvalidResourceUriError, createResourceReadError } from '../utils/mcp-errors.js';

export interface SheetResourceOptions {
  spreadsheetId: string;
  sheetName: string;
}

/**
 * Register dynamic sheet resources with resource templates
 *
 * Provides:
 * - sheets://spreadsheets/{id}/sheets/{name} - Individual sheet data
 * - sheets://spreadsheets/{id}/sheets - List of all sheets in a spreadsheet
 */
export function registerSheetResources(server: McpServer, context: HandlerContext): void {
  try {
    // Register resource template for listing sheets in a spreadsheet
    server.registerResource(
      'Available Sheets List',
      'sheets://spreadsheets/{spreadsheetId}/sheets',
      {
        description: 'Dynamically lists all sheets in a spreadsheet',
        mimeType: 'application/json',
      },
      async (uri) => readSheetResource(typeof uri === 'string' ? uri : uri.toString(), context)
    );

    // Register resource template for individual sheet data
    server.registerResource(
      'Sheet Data',
      'sheets://spreadsheets/{spreadsheetId}/sheets/{sheetName}',
      {
        description: 'Access data from a specific sheet',
        mimeType: 'application/json',
      },
      async (uri) => readSheetResource(typeof uri === 'string' ? uri : uri.toString(), context)
    );

    logger.info('Sheet resource templates registered');
  } catch (error) {
    logger.error('Failed to register sheet resources', { error });
    throw error;
  }
}

/**
 * Read sheet resource (handler for resource read requests)
 */
export async function readSheetResource(
  uri: string,
  context: HandlerContext
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // Parse URI: sheets://spreadsheets/{id}/sheets or sheets://spreadsheets/{id}/sheets/{name}
  const match = /^sheets:\/\/spreadsheets\/([^/]+)\/sheets(?:\/(.+))?$/.exec(uri);

  if (!match) {
    throw createInvalidResourceUriError(
      uri,
      'sheets://spreadsheets/{spreadsheetId}/sheets or sheets://spreadsheets/{spreadsheetId}/sheets/{sheetName}'
    );
  }

  const spreadsheetId = match[1]!;
  const sheetName = match[2];

  if (sheetName) {
    // Get data from specific sheet
    return await getSheetData(spreadsheetId, sheetName, context);
  } else {
    // List all sheets in spreadsheet
    return await listSheetsInSpreadsheet(spreadsheetId, context);
  }
}

/**
 * List all sheets in a spreadsheet
 */
async function listSheetsInSpreadsheet(
  spreadsheetId: string,
  context: HandlerContext
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    // Use Google Sheets API to get spreadsheet metadata
    const response = await context.googleClient!.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });

    const sheets =
      response.data.sheets?.map((sheet) => ({
        sheetId: sheet.properties?.sheetId ?? undefined,
        title: sheet.properties?.title || 'Untitled',
        index: sheet.properties?.index ?? 0,
        rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
        columnCount: sheet.properties?.gridProperties?.columnCount ?? 0,
      })) || [];

    return {
      contents: [
        {
          uri: `sheets://spreadsheets/${spreadsheetId}/sheets`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              spreadsheetId,
              sheets,
              count: sheets.length,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to list sheets', { spreadsheetId, error });
    throw createResourceReadError(`sheets://spreadsheets/${spreadsheetId}/sheets`, error);
  }
}

/**
 * Get data from a specific sheet
 */
async function getSheetData(
  spreadsheetId: string,
  sheetName: string,
  context: HandlerContext
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  try {
    // Read sheet data (first 100 rows for preview)
    const response = await context.googleClient!.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Z100`,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = response.data.values || [];

    return {
      contents: [
        {
          uri: `sheets://spreadsheets/${spreadsheetId}/sheets/${sheetName}`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              spreadsheetId,
              sheetName,
              rowCount: values.length,
              columnCount: values[0]?.length || 0,
              preview: values.slice(0, 10), // First 10 rows
              truncated: values.length > 10,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get sheet data', { spreadsheetId, sheetName, error });
    throw createResourceReadError(
      `sheets://spreadsheets/${spreadsheetId}/sheets/${sheetName}`,
      error
    );
  }
}
