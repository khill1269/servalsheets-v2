/**
 * Tool: sheets_connectors
 * External data connector framework for pulling live data into spreadsheets.
 * Connects to financial APIs, REST endpoints, and MCP servers.
 *
 * Actions (10):
 * - list_connectors: List all available data connectors and their status
 * - configure: Configure credentials for a data connector
 * - query: Query data from a configured connector endpoint
 * - batch_query: Run multiple queries across connectors in parallel
 * - subscribe: Create a scheduled data refresh subscription
 * - unsubscribe: Remove a data refresh subscription
 * - list_subscriptions: List all active data refresh subscriptions
 * - transform: Apply filter/sort/limit transformations to query results
 * - status: Get detailed status and health of a connector
 * - discover: Discover available endpoints and schemas from a connector
 */

import { z } from 'zod';
import {
  ErrorDetailSchema,
  RangeInputSchema,
  ResponseMetaSchema,
  SafetyOptionsSchema,
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  safety: SafetyOptionsSchema.optional().describe('Safety options'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only), standard (balanced), detailed (full metadata)'
    ),
});

// ============================================================================
// Reusable Sub-Schemas
// ============================================================================

const QueryParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('Key-value parameters for the endpoint query (e.g., symbol, date range)');

const TransformFilterSchema = z.object({
  column: z.string().min(1).describe('Column name to filter on'),
  operator: z
    .enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'starts_with'])
    .describe('Filter comparison operator'),
  value: z.union([z.string(), z.number()]).describe('Value to compare against'),
});

const TransformSortSchema = z.object({
  column: z.string().min(1).describe('Column name to sort by'),
  direction: z.enum(['asc', 'desc']).default('asc').describe('Sort direction (default: asc)'),
});

const TransformAggregateSchema = z.object({
  column: z.string().min(1).describe('Column to aggregate'),
  function: z.enum(['sum', 'avg', 'min', 'max', 'count']).describe('Aggregation function'),
  groupBy: z.string().optional().describe('Column to group results by'),
});

const TransformSpecSchema = z
  .object({
    filter: z.array(TransformFilterSchema).optional().describe('Row filters'),
    sort: z.array(TransformSortSchema).optional().describe('Sort specifications'),
    limit: z.number().int().positive().optional().describe('Maximum rows to return'),
    columns: z.array(z.string()).optional().describe('Column selection (projection)'),
    aggregate: z.array(TransformAggregateSchema).optional().describe('Aggregation functions'),
  })
  .describe('Data transformation specification');

const RefreshScheduleSchema = z.object({
  interval: z.enum(['hourly', 'daily', 'weekly', 'custom']).describe('Refresh interval'),
  customCronExpression: z.string().optional().describe('Cron expression for custom schedules'),
  timezone: z.string().optional().describe('Timezone for scheduling (e.g., "America/New_York")'),
});

const CredentialsSchema = z.object({
  type: z.enum(['api_key', 'oauth2', 'none']).describe('Authentication method'),
  apiKey: z.string().optional().describe('API key for key-based auth'),
  oauth: z
    .object({
      clientId: z.string().describe('OAuth2 client ID'),
      clientSecret: z.string().describe('OAuth2 client secret'),
      accessToken: z.string().optional().describe('OAuth2 access token'),
      refreshToken: z.string().optional().describe('OAuth2 refresh token'),
    })
    .optional()
    .describe('OAuth2 credentials'),
  custom: z
    .record(z.string(), z.string())
    .optional()
    .describe('Custom credential fields for specialized connectors'),
});

// ============================================================================
// Individual Action Schemas
// ============================================================================

const ListConnectorsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('list_connectors')
    .describe('List all available data connectors and their configuration status'),
}).strict();

const ConfigureActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('configure')
    .describe(
      'Configure credentials for a data connector. If connectorId or credentials are omitted and the MCP client supports elicitation, the server will prompt for the missing setup fields. API-key connectors can use MCP URL elicitation to open a local setup page so the key does not need to travel in the request payload.'
    ),
  connectorId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Connector ID (e.g., "finnhub", "fred", "public_json"). Optional when MCP elicitation is available; the server can prompt for it.'
    ),
  credentials: CredentialsSchema.optional().describe(
    'Credentials to configure the connector with. Optional when MCP elicitation is available; the server can prompt for the required auth fields. For API-key connectors, the server can open a local setup page via MCP URL elicitation instead of requiring the secret inline.'
  ),
}).strict();

const QueryActionSchema = CommonFieldsSchema.extend({
  action: z.literal('query').describe('Query data from a configured connector endpoint'),
  connectorId: z.string().min(1).describe('Connector ID to query'),
  endpoint: z
    .string()
    .min(1)
    .describe('Endpoint to query (e.g., "stock/quote", "series/observations")'),
  params: QueryParamsSchema,
  transform: TransformSpecSchema.optional().describe(
    'Optional inline transformations to apply to results'
  ),
  useCache: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to use cached results (default: true)'),
}).strict();

const BatchQueryActionSchema = CommonFieldsSchema.extend({
  action: z.literal('batch_query').describe('Run multiple queries across connectors in parallel'),
  queries: z
    .array(
      z.object({
        connectorId: z.string().min(1).describe('Connector ID'),
        endpoint: z.string().min(1).describe('Endpoint to query'),
        params: QueryParamsSchema,
        transform: TransformSpecSchema.optional(),
      })
    )
    .min(1)
    .max(20)
    .describe('Array of queries to execute (1-20)'),
}).strict();

const SubscribeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('subscribe').describe('Create a scheduled data refresh subscription'),
  connectorId: z.string().min(1).describe('Connector ID'),
  endpoint: z.string().min(1).describe('Endpoint to subscribe to'),
  params: QueryParamsSchema,
  schedule: RefreshScheduleSchema.describe('Refresh schedule'),
  destination: z
    .object({
      spreadsheetId: z.string().min(1).describe('Target spreadsheet ID'),
      range: RangeInputSchema.describe('Target range for data output'),
    })
    .describe('Where to write refreshed data'),
}).strict();

const UnsubscribeActionSchema = CommonFieldsSchema.extend({
  action: z.literal('unsubscribe').describe('Remove a data refresh subscription'),
  subscriptionId: z.string().min(1).describe('Subscription ID to remove'),
}).strict();

const ListSubscriptionsActionSchema = CommonFieldsSchema.extend({
  action: z.literal('list_subscriptions').describe('List all active data refresh subscriptions'),
}).strict();

const TransformActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('transform')
    .describe('Apply transformations to connector query results (standalone operation)'),
  connectorId: z.string().min(1).describe('Connector ID to query'),
  endpoint: z.string().min(1).describe('Endpoint to query'),
  params: QueryParamsSchema,
  transform: TransformSpecSchema.describe('Transformation specification to apply'),
}).strict();

const StatusActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('status')
    .describe('Get detailed status, health, and quota usage for a connector'),
  connectorId: z.string().min(1).describe('Connector ID to check'),
}).strict();

const DiscoverActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('discover')
    .describe('Discover available endpoints and data schemas from a connector'),
  connectorId: z.string().min(1).describe('Connector ID to discover endpoints for'),
  endpoint: z.string().optional().describe('Specific endpoint to get schema details for'),
}).strict();

// ============================================================================
// Discriminated Union (Input Schema)
// ============================================================================

export const SheetsConnectorsInputSchema = z.object({
  request: z.discriminatedUnion('action', [
    ListConnectorsActionSchema,
    ConfigureActionSchema,
    QueryActionSchema,
    BatchQueryActionSchema,
    SubscribeActionSchema,
    UnsubscribeActionSchema,
    ListSubscriptionsActionSchema,
    TransformActionSchema,
    StatusActionSchema,
    DiscoverActionSchema,
  ]),
});

export type SheetsConnectorsInput = z.infer<typeof SheetsConnectorsInputSchema>;

// ============================================================================
// Output Schema
// ============================================================================

const ConnectorsResponsePayloadSchema = z.object({
  action: z.string(),
  message: z.string().optional(),
  verified: z.boolean().optional(),
  authType: z.string().optional(),
  signupUrl: z.string().optional(),
  recommendedUseCases: z.array(z.string()).optional(),
  nextStep: z.string().optional(),
  exampleQuery: z
    .object({
      connectorId: z.string(),
      endpoint: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .optional(),
  // list_connectors
  connectors: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        authType: z.string(),
        configured: z.boolean(),
        healthy: z.boolean().optional(),
        signupUrl: z.string().optional(),
        recommendedUseCases: z.array(z.string()).optional(),
        nextStep: z.string().optional(),
      })
    )
    .optional(),
  // query / transform
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.unknown())).optional(),
  metadata: z
    .object({
      source: z.string().optional(),
      endpoint: z.string().optional(),
      fetchedAt: z.string().optional(),
      rowCount: z.number().optional(),
      cached: z.boolean().optional(),
      quotaUsed: z.number().optional(),
    })
    .optional(),
  // batch_query
  results: z.array(z.unknown()).optional(),
  // subscribe
  subscription: z
    .object({
      id: z.string(),
      connectorId: z.string(),
      endpoint: z.string(),
      status: z.string(),
      nextRefresh: z.string().optional(),
    })
    .optional(),
  // unsubscribe
  removed: z.boolean().optional(),
  // list_subscriptions
  subscriptions: z
    .array(
      z.object({
        id: z.string(),
        connectorId: z.string(),
        endpoint: z.string(),
        status: z.string(),
        lastRefresh: z.string().optional(),
        nextRefresh: z.string().optional(),
      })
    )
    .optional(),
  // status
  id: z.string().optional(),
  name: z.string().optional(),
  configured: z.boolean().optional(),
  health: z
    .object({
      healthy: z.boolean(),
      latencyMs: z.number(),
      message: z.string().optional(),
      lastChecked: z.string(),
    })
    .optional()
    .nullable(),
  quota: z
    .object({
      used: z.number(),
      limit: z.number(),
    })
    .optional(),
  // discover
  endpoints: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.string(),
        params: z.array(
          z.object({
            name: z.string(),
            type: z.string(),
            required: z.boolean(),
            description: z.string(),
            example: z.string().optional(),
          })
        ),
      })
    )
    .optional(),
  // AI-powered connector discovery recommendation (P5.3)
  aiRecommendation: z
    .string()
    .optional()
    .describe('AI-generated insight about which endpoints would be most useful'),
  schema: z
    .object({
      endpoint: z.string(),
      columns: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string().optional(),
        })
      ),
    })
    .optional(),
  _meta: ResponseMetaSchema.optional(),
});

export const SheetsConnectorsOutputSchema = z.object({
  response: z.discriminatedUnion('success', [
    ConnectorsResponsePayloadSchema.extend({
      success: z.literal(true),
      error: ErrorDetailSchema.optional(),
    }),
    ConnectorsResponsePayloadSchema.partial({ action: true }).extend({
      success: z.literal(false),
      error: ErrorDetailSchema,
    }),
  ]),
});

export type SheetsConnectorsOutput = z.infer<typeof SheetsConnectorsOutputSchema>;

// ============================================================================
// Tool Annotations (MCP 2025-11-25)
// ============================================================================

export const SHEETS_CONNECTORS_ANNOTATIONS: ToolAnnotations = {
  title: 'Live Data Connectors',
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: false,
};
