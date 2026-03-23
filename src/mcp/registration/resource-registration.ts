/**
 * ServalSheets - Resource Registration
 *
 * Resource templates and handlers for spreadsheet data access.
 *
 * @module mcp/registration/resource-registration
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GoogleApiClient } from '../../services/google-api.js';
import {
  completeAction,
  completeRange,
  completeSpreadsheetId,
  TOOL_ACTIONS,
} from '../completions.js';
import { registerChartResources } from '../../resources/charts.js';
import { registerPivotResources } from '../../resources/pivots.js';
import { registerQualityResources } from '../../resources/quality.js';
import { createAuthRequiredError, createResourceReadError } from '../../utils/mcp-errors.js';
import { getHealthSnapshot } from '../../observability/metrics.js';

// ============================================================================
// STATIC RESOURCE CONTENT
// ============================================================================

const ROUTING_MATRIX_CONTENT = `# ServalSheets Tool Routing Matrix

When the user's intent is CLEAR, skip analysis and route directly:

| User Says | Route Directly To |
|-----------|------------------|
| "write/append/clear/read" | sheets_data |
| "format/color/border/font" | sheets_format |
| "share/comment/permission" | sheets_collaborate |
| "create/delete/copy sheet" | sheets_core |
| "undo/redo/history/revert" | sheets_history |
| "insert/delete rows/columns" | sheets_dimensions |
| "chart/graph/visualization" | sheets_visualize |
| "import/export CSV/XLSX" | sheets_composite |
| "formula dependencies/impact" | sheets_dependencies |
| "clean/fix/standardize" | sheets_fix |
| "compute/calculate/regression/forecast/statistics" | sheets_compute |
| "run plan/agent/autonomous pipeline/multi-step" | sheets_agent |
| "external API/live data/connector/market data/weather" | sheets_connectors |
| "audit/report/analyze quality/health check" | sheets_composite.audit_sheet |
| "publish report/export findings/generate summary" | sheets_composite.publish_report |
| "data pipeline/recurring import/scheduled transform" | sheets_composite.data_pipeline |
| "instantiate template/apply template with values" | sheets_composite.instantiate_template |
| "migrate/move data between spreadsheets/transfer" | sheets_composite.migrate_spreadsheet |
| "analyze/understand/explore/summarize sheet" | sheets_analyze |
| "dropdown/data validation/restrict input" | sheets_format.set_data_validation |
| "named range/protected range/table/metadata/chips" | sheets_advanced |
| "template/save pattern/reuse layout" | sheets_templates |
| "what if/scenario/model impact" | sheets_dependencies.model_scenario |
| "validate/check quality/detect conflicts" | sheets_quality |
| "session/preferences/checkpoint/context" | sheets_session |
| "webhook/watch changes/event notification" | sheets_webhook |
| "transaction/atomic batch/multi-op commit" | sheets_transaction |
| "remote MCP/cross-server/federation" | sheets_federation |
| "apps script/trigger/deploy/run function" | sheets_appsscript |
| "bigquery/connected sheets/external query" | sheets_bigquery |
| "confirm/wizard/approve/elicit input" | sheets_confirm |
| "authenticate/login/oauth/token" | sheets_auth |

ONLY use sheets_analyze when the user's request is exploratory or analytical.
`;

// ============================================================================
// RESOURCES REGISTRATION
// ============================================================================

// Guard against double-registration (SDK throws if a resource template name is reused)
const registeredServers = new WeakSet<McpServer>();

/**
 * Registers ServalSheets resources with the MCP server
 *
 * Resources provide read-only access to spreadsheet metadata via URI templates.
 * Note: resources/list uses SDK's built-in handler. Cursor pagination is not needed
 * with <10 resource templates. The SDK returns all resources in a single page per
 * MCP 2025-11-25 spec (cursor pagination is optional for small collections).
 *
 * @param server - McpServer instance
 * @param googleClient - Google API client (null if not authenticated)
 */
export function registerServalSheetsResources(
  server: McpServer,
  googleClient: GoogleApiClient | null
): void {
  if (registeredServers.has(server)) {
    return; // Already registered on this server instance
  }
  registeredServers.add(server);
  const spreadsheetTemplate = new ResourceTemplate('sheets:///{spreadsheetId}', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
    },
  });

  const rangeTemplate = new ResourceTemplate('sheets:///{spreadsheetId}/{range}', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
      range: async (value) => completeRange(value),
    },
  });

  server.registerResource(
    'spreadsheet',
    spreadsheetTemplate,
    {
      title: 'Spreadsheet',
      description: 'Google Sheets spreadsheet metadata (properties and sheet list)',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawSpreadsheetId = variables['spreadsheetId'];
      const spreadsheetId = Array.isArray(rawSpreadsheetId)
        ? rawSpreadsheetId[0]
        : rawSpreadsheetId;

      if (!spreadsheetId || typeof spreadsheetId !== 'string') {
        return { contents: [] };
      }

      if (!googleClient) {
        throw createAuthRequiredError(uri.href);
      }

      try {
        const sheetsResponse = await googleClient.sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'properties,sheets.properties',
        });

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(sheetsResponse.data, null, 2),
            },
          ],
        };
      } catch (error) {
        throw createResourceReadError(uri.href, error);
      }
    }
  );

  server.registerResource(
    'spreadsheet_range',
    rangeTemplate,
    {
      title: 'Spreadsheet Range',
      description: 'Google Sheets range values (A1 notation)',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawSpreadsheetId = variables['spreadsheetId'];
      const rawRange = variables['range'];
      const spreadsheetId = Array.isArray(rawSpreadsheetId)
        ? rawSpreadsheetId[0]
        : rawSpreadsheetId;
      const encodedRange = Array.isArray(rawRange) ? rawRange[0] : rawRange;
      const range = typeof encodedRange === 'string' ? decodeURIComponent(encodedRange) : undefined;

      if (!spreadsheetId || typeof spreadsheetId !== 'string' || !range) {
        return { contents: [] };
      }

      if (!googleClient) {
        throw createAuthRequiredError(uri.href);
      }

      // P1-2: Parse pagination parameters from query string
      // URI format: sheets:///spreadsheetId/range?_limit=100&_offset=0
      const DEFAULT_LIMIT = 10000; // Max cells per response
      const parsedUrl = new URL(uri.href, 'sheets://localhost');
      const limitParam = parsedUrl.searchParams.get('_limit');
      const offsetParam = parsedUrl.searchParams.get('_offset');
      const limit = limitParam ? Math.min(parseInt(limitParam, 10), DEFAULT_LIMIT) : DEFAULT_LIMIT;
      const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

      try {
        const valuesResponse = await googleClient.sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });

        const allValues = valuesResponse.data.values || [];
        const totalRows = allValues.length;
        const totalCells = allValues.reduce(
          (sum, row) => sum + (Array.isArray(row) ? row.length : 0),
          0
        );

        // Apply pagination (row-based offset and cell-based limit)
        let paginatedValues: unknown[][];
        let cellCount = 0;

        if (offset > 0) {
          // Skip offset rows
          paginatedValues = [];
          for (let i = offset; i < allValues.length; i++) {
            const row = allValues[i]!;
            const rowLength = Array.isArray(row) ? row.length : 0;
            if (cellCount + rowLength > limit) {
              break;
            }
            paginatedValues.push(row);
            cellCount += rowLength;
          }
        } else {
          // Apply cell limit from start
          paginatedValues = [];
          for (const row of allValues) {
            const rowLength = Array.isArray(row) ? row.length : 0;
            if (cellCount + rowLength > limit) {
              break;
            }
            paginatedValues.push(row);
            cellCount += rowLength;
          }
        }

        const hasMore = offset + paginatedValues.length < totalRows;
        const nextOffset = offset + paginatedValues.length;

        // Build result with pagination metadata
        const result: Record<string, unknown> = {
          ...valuesResponse.data,
          values: paginatedValues,
          _pagination: {
            offset,
            limit,
            totalRows,
            totalCells,
            returnedRows: paginatedValues.length,
            hasMore,
            ...(hasMore && {
              nextUri: `sheets:///${spreadsheetId}/${encodeURIComponent(range)}?_limit=${limit}&_offset=${nextOffset}`,
            }),
          },
        };

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        throw createResourceReadError(uri.href, error);
      }
    }
  );

  // Full context resource — structural metadata for LLM context injection
  const contextTemplate = new ResourceTemplate('sheets:///{spreadsheetId}/context', {
    list: undefined,
    complete: {
      spreadsheetId: async (value) => completeSpreadsheetId(value),
    },
  });

  server.registerResource(
    'spreadsheet_context',
    contextTemplate,
    {
      title: 'Spreadsheet Full Context',
      description:
        'Complete spreadsheet structural metadata: sheets, charts, named ranges, protected ranges, conditional formats, filter views, slicers. Optimized field mask — no cell data.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawSpreadsheetId = variables['spreadsheetId'];
      const spreadsheetId = Array.isArray(rawSpreadsheetId)
        ? rawSpreadsheetId[0]
        : rawSpreadsheetId;

      if (!spreadsheetId || typeof spreadsheetId !== 'string') {
        return { contents: [] };
      }

      if (!googleClient) {
        throw createAuthRequiredError(uri.href);
      }

      try {
        const response = await googleClient.sheets.spreadsheets.get({
          spreadsheetId,
          fields: [
            'properties(title,locale,timeZone,defaultFormat)',
            'sheets(properties,conditionalFormats,charts,protectedRanges,bandedRanges',
            'filterViews,slicers,merges,basicFilter)',
            'namedRanges',
          ].join(','),
        });

        const data = response.data;
        const context = {
          spreadsheetId,
          title: data.properties?.title,
          locale: data.properties?.locale,
          timeZone: data.properties?.timeZone,
          sheets: (data.sheets || []).map((s) => ({
            sheetId: s.properties?.sheetId,
            title: s.properties?.title,
            rowCount: s.properties?.gridProperties?.rowCount,
            columnCount: s.properties?.gridProperties?.columnCount,
            frozenRows: s.properties?.gridProperties?.frozenRowCount || 0,
            frozenColumns: s.properties?.gridProperties?.frozenColumnCount || 0,
            chartCount: s.charts?.length || 0,
            conditionalFormatCount: s.conditionalFormats?.length || 0,
            protectedRangeCount: s.protectedRanges?.length || 0,
            filterViewCount: s.filterViews?.length || 0,
            slicerCount: s.slicers?.length || 0,
            mergeCount: s.merges?.length || 0,
            hasBasicFilter: !!s.basicFilter,
            bandedRangeCount: s.bandedRanges?.length || 0,
          })),
          namedRangeCount: data.namedRanges?.length || 0,
          namedRanges: (data.namedRanges || []).map((nr) => ({
            name: nr.name,
            range: nr.range,
          })),
        };

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      } catch (error) {
        throw createResourceReadError(uri.href, error);
      }
    }
  );

  // Action completion template — enables completeAction() via MCP completion protocol.
  // Clients can request completions for sheets://tools/{toolName}/actions/{action} URIs.
  // The action completer reads toolName from the completion context (MCP 2025-11-25 context.arguments).
  const toolActionTemplate = new ResourceTemplate('sheets://tools/{toolName}/actions/{action}', {
    list: undefined,
    complete: {
      toolName: async (value) => Object.keys(TOOL_ACTIONS).filter((t) => t.startsWith(value || '')),
      action: async (value, context) => {
        const ctx = context as { arguments?: Record<string, string> } | undefined;
        const toolName = ctx?.arguments?.['toolName'] ?? '';
        return completeAction(toolName, value || '');
      },
    },
  });

  server.registerResource(
    'tool_action',
    toolActionTemplate,
    {
      title: 'Tool Action',
      description: 'ServalSheets tool action reference. Use for action name autocompletion.',
      mimeType: 'application/json',
    },
    async (_uri, _variables) => {
      return { contents: [] }; // completions-only resource; no read content
    }
  );

  // Server health snapshot — no auth required, returns in-process metrics
  server.resource(
    'metrics://servalsheets/health',
    'Server health snapshot including circuit breakers, cache, quota, and error rates',
    async () => ({
      contents: [
        {
          uri: 'metrics://servalsheets/health',
          mimeType: 'application/json',
          text: JSON.stringify(getHealthSnapshot(), null, 2),
        },
      ],
    })
  );

  // guide://routing-matrix — standalone routing decision table
  // Extracted from server instructions to reduce instructions payload size.
  server.resource(
    'guide://routing-matrix',
    'Quick-reference table mapping user intent keywords to the correct ServalSheets tool',
    async () => ({
      contents: [
        {
          uri: 'guide://routing-matrix',
          mimeType: 'text/markdown',
          text: ROUTING_MATRIX_CONTENT,
        },
      ],
    })
  );

  // Register additional data exploration resources
  registerChartResources(server, googleClient?.sheets ?? null);
  registerPivotResources(server, googleClient?.sheets ?? null);
  registerQualityResources(server, googleClient?.sheets ?? null);
}
