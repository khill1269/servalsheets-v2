/**
 * ServalSheets - Federation Schema
 *
 * Schema definitions for the sheets_federation tool.
 * Enables calling external MCP servers for composite workflows.
 *
 * @category Schemas
 * @module schemas/federation
 */

import { z } from 'zod';
import { ErrorDetailSchema } from './shared.js';

/**
 * Federation action enum
 */
export const FederationActionSchema = z.enum([
  'call_remote',
  'list_servers',
  'get_server_tools',
  'validate_connection',
]);

/**
 * Federation input schema
 */
export const SheetsFederationInputSchema = z.object({
  request: z
    .object({
      /** Action to perform */
      action: FederationActionSchema,
      /** Server name (required for call_remote, get_server_tools, validate_connection) */
      serverName: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Name of the remote MCP server. Required for call_remote, get_server_tools, and validate_connection.'
        ),
      /** Tool name on remote server (required for call_remote) */
      toolName: z
        .string()
        .min(1)
        .optional()
        .describe('Tool name on the remote server. Required for call_remote.'),
      /** Tool input arguments (optional for call_remote) */
      toolInput: z.record(z.string(), z.unknown()).optional(),
    })
    .superRefine((data, ctx) => {
      const needsServer = ['call_remote', 'get_server_tools', 'validate_connection'];
      if (needsServer.includes(data.action) && !data.serverName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serverName'],
          message: `serverName is required for ${data.action}. Use list_servers to see configured servers.`,
        });
      }
      if (data.action === 'call_remote' && !data.toolName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toolName'],
          message:
            'toolName is required for call_remote. Use get_server_tools to discover available tools.',
        });
      }
    }),
});

/**
 * Federation output schema
 */
const FederationSuccessResponseSchema = z.object({
  /** Whether the operation succeeded */
  success: z.literal(true),
  /** Action that was performed */
  action: FederationActionSchema,
  /** Remote server name (if applicable) */
  remoteServer: z.string().optional(),
  /** Result data from remote call */
  data: z.unknown().optional(),
  /** List of available tools on remote server */
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .optional(),
  /** List of configured servers */
  servers: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
        connected: z.boolean(),
      })
    )
    .optional(),
});

const FederationErrorResponseSchema = z.object({
  /** Whether the operation succeeded */
  success: z.literal(false),
  /** Action that was performed */
  action: FederationActionSchema,
  /** Remote server name (if applicable) */
  remoteServer: z.string().optional(),
  /** Human-readable error message for backwards compatibility */
  error: z.string(),
  /** Optional structured error detail for advanced clients */
  errorDetail: ErrorDetailSchema.optional(),
});

export const SheetsFederationOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    FederationSuccessResponseSchema,
    FederationErrorResponseSchema,
  ]),
});

/**
 * Type inference
 */
export type FederationAction = z.infer<typeof FederationActionSchema>;
export type SheetsFederationInput = z.infer<typeof SheetsFederationInputSchema>;
export type SheetsFederationOutput = z.infer<typeof SheetsFederationOutputSchema>;

/**
 * Tool description for MCP registration
 */
export const FEDERATION_TOOL_DESCRIPTION = `
**sheets_federation - Call Other MCP Servers**

Enables composite workflows by calling tools on external MCP servers.

**WHEN TO USE:**
→ Need data from external sources (weather APIs, ML models, databases)
→ Chain operations across multiple services (analyze → transform → write to Sheets)
→ Integrate with specialized MCP servers (Python analytics, SQL databases)

**ACTIONS:**
1. \`call_remote\` - Call a tool on a remote MCP server
   - Required: serverName, toolName
   - Optional: toolInput (tool arguments)

2. \`list_servers\` - List configured remote servers
   - Shows connection status for each server

3. \`get_server_tools\` - List tools available on a remote server
   - Required: serverName
   - Returns tool names, descriptions, input schemas

4. \`validate_connection\` - Test connection to remote server
   - Required: serverName
   - Returns connection status

**EXAMPLE - Weather to Sheets:**
\`\`\`typescript
// 1. Call remote weather server
{
  "action": "call_remote",
  "serverName": "weather-api",
  "toolName": "get_forecast",
  "toolInput": {
    "location": "San Francisco",
    "days": 7
  }
}
// Returns: {temperature: 72, forecast: [...]}

// 2. Write to Sheets
{
  "tool": "sheets_data",
  "action": "write",
  "spreadsheetId": "abc123",
  "range": "Weather!A1",
  "values": [["Date", "Temp", "Condition"], ...]
}
\`\`\`

**CONFIGURATION:**
Set environment variable MCP_FEDERATION_SERVERS:
\`\`\`json
[
  {
    "name": "weather-api",
    "url": "http://localhost:3001",
    "auth": {"type": "bearer", "token": "YOUR_TOKEN"}
  },
  {
    "name": "ml-server",
    "url": "http://localhost:3002"
  }
]
\`\`\`

**SECURITY:**
⚠️ Only call trusted MCP servers
⚠️ Validate responses before writing to Sheets
⚠️ Use bearer tokens for authenticated servers
⚠️ Set timeouts to prevent hanging (default: 30s)

**BEST PRACTICES:**
✓ Test connection with validate_connection before use
✓ Use list_servers to see available servers
✓ Use get_server_tools to discover remote capabilities
✓ Handle errors gracefully (remote servers may be unavailable)
✓ Cache results when appropriate (automatic 5-minute TTL)
`.trim();

/**
 * Tool annotations for sheets_federation
 */
export const SHEETS_FEDERATION_ANNOTATIONS = {
  title: 'MCP Server Federation',
  readOnlyHint: false, // Depends on remote tool behavior
  destructiveHint: false, // Federation itself is not destructive
  idempotentHint: false, // Remote tools may not be idempotent
  openWorldHint: true, // Calls external MCP servers
};
