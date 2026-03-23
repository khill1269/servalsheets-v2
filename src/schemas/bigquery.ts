/**
 * Tool 18: sheets_bigquery
 * BigQuery and Looker integration via Connected Sheets
 *
 * 17 Actions:
 * Connection Management (5): connect, connect_looker, disconnect, list_connections, get_connection
 * Query Operations (4): query, preview, refresh, cancel_refresh
 * Schema Discovery (3): list_datasets, list_tables, get_table_schema
 * Data Transfer (2): export_to_bigquery, import_from_bigquery
 *
 * MCP Protocol: 2025-11-25
 *
 * Note: Uses Google Sheets API for Connected Sheets features (DataSource objects)
 * and BigQuery API for direct query/schema operations.
 * Looker support enables pivot tables from LookML models.
 */

import { z } from 'zod';
import {
  SpreadsheetIdSchema,
  SheetIdSchema,
  RangeInputSchema,
  ErrorDetailSchema,
  SafetyOptionsSchema,
  MutationSummarySchema,
  ResponseMetaSchema,
  type ToolAnnotations,
} from './shared.js';

// ============================================================================
// Common Schemas
// ============================================================================

const CommonFieldsSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema.describe('Spreadsheet ID from URL'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe(
      'Response detail level: minimal (essential info only), standard (balanced), detailed (full metadata)'
    ),
  safety: SafetyOptionsSchema.optional().describe('Safety options (dryRun, createSnapshot, etc.)'),
});

// BigQuery project/dataset/table reference
const BigQueryTableRefSchema = z.object({
  projectId: z.string().min(1).describe('GCP project ID'),
  datasetId: z.string().min(1).describe('BigQuery dataset ID'),
  tableId: z.string().min(1).describe('BigQuery table ID'),
  location: z
    .string()
    .optional()
    .describe('BigQuery dataset location for region-scoped jobs (e.g., "US", "EU")'),
});

// Data source specification for Connected Sheets (BigQuery)
const DataSourceSpecSchema = z.object({
  projectId: z.string().min(1).describe('GCP project ID containing the BigQuery dataset'),
  datasetId: z.string().min(1).optional().describe('BigQuery dataset ID (for table connections)'),
  tableId: z.string().min(1).optional().describe('BigQuery table ID (for table connections)'),
  query: z.string().optional().describe('Custom SQL query (for query-based connections)'),
});

// Looker data source specification for Connected Sheets
const LookerDataSourceSpecSchema = z.object({
  instanceUri: z.string().url().describe('Looker instance URI (e.g., https://company.looker.com)'),
  model: z.string().min(1).describe('LookML model name'),
  explore: z.string().min(1).describe('Explore name within the model'),
});

// BigQuery column schema
const BigQueryColumnSchema = z.object({
  name: z.string().describe('Column name'),
  type: z
    .string()
    .describe('BigQuery data type (STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, etc.)'),
  mode: z.enum(['NULLABLE', 'REQUIRED', 'REPEATED']).optional().describe('Column mode'),
  description: z.string().optional().describe('Column description'),
});

// Data source connection summary
const DataSourceConnectionSchema = z.object({
  dataSourceId: z.string().describe('Unique ID for this data source'),
  type: z.enum(['bigquery', 'looker']).optional().describe('Data source type'),
  spec: DataSourceSpecSchema.optional().describe('BigQuery data source specification'),
  lookerSpec: LookerDataSourceSpecSchema.optional().describe('Looker data source specification'),
  sheetId: SheetIdSchema.optional().describe('Sheet ID if connected to a sheet'),
  createdAt: z.string().optional().describe('ISO timestamp when connection was created'),
  lastRefreshed: z.string().optional().describe('ISO timestamp of last refresh'),
});

// ============================================================================
// Connection Management Action Schemas (4 actions)
// ============================================================================

const ConnectActionSchema = CommonFieldsSchema.extend({
  action: z.literal('connect').describe('Create a BigQuery Connected Sheets data source'),
  spec: DataSourceSpecSchema.describe('Data source specification (table or query)'),
  sheetId: SheetIdSchema.optional().describe('Target sheet ID (creates new sheet if omitted)'),
  sheetName: z.string().optional().describe('Name for the new sheet (if creating)'),
});

const ConnectLookerActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('connect_looker')
    .describe('Create a Looker Connected Sheets data source (supports pivot tables only)'),
  spec: LookerDataSourceSpecSchema.describe('Looker data source specification'),
  sheetId: SheetIdSchema.optional().describe('Target sheet ID (creates new sheet if omitted)'),
  sheetName: z.string().optional().describe('Name for the new sheet (if creating)'),
});

const DisconnectActionSchema = CommonFieldsSchema.extend({
  action: z.literal('disconnect').describe('Remove a BigQuery data source connection'),
  dataSourceId: z.string().min(1).describe('Data source ID to disconnect'),
});

const ListConnectionsActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('list_connections')
    .describe('List all BigQuery connections in the spreadsheet'),
});

const GetConnectionActionSchema = CommonFieldsSchema.extend({
  action: z.literal('get_connection').describe('Get details of a specific BigQuery connection'),
  dataSourceId: z.string().min(1).describe('Data source ID'),
});

// ============================================================================
// Query Operations Action Schemas (3 actions)
// ============================================================================

const QueryActionSchema = CommonFieldsSchema.extend({
  action: z.literal('query').describe('Execute a BigQuery SQL query via Connected Sheets'),
  dataSourceId: z.string().optional().describe('Existing data source ID (if updating query)'),
  projectId: z.string().min(1).describe('GCP project ID for billing'),
  query: z.string().min(1).describe('SQL query to execute'),
  sheetId: SheetIdSchema.optional().describe('Target sheet for results (creates new if omitted)'),
  sheetName: z.string().optional().describe('Name for results sheet'),
  maxResults: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .optional()
    .default(10000)
    .describe('Maximum rows to return'),
  // Query control parameters (P1-2: BigQuery query controls)
  timeoutMs: z.coerce
    .number()
    .int()
    .min(1000)
    .max(600000)
    .optional()
    .describe('Query timeout in milliseconds (1s - 10min, default: 10s)'),
  maximumBytesBilled: z
    .string()
    .regex(/^\d+$/, 'maximumBytesBilled must be a numeric string')
    .optional()
    .describe('Maximum bytes billed for cost control (e.g., "1000000000" for 1GB)'),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe('Validate query without execution (returns cost estimate)'),
  useQueryCache: z
    .boolean()
    .optional()
    .default(true)
    .describe('Use cached results if available (default: true)'),
  location: z
    .string()
    .optional()
    .describe('Dataset location for query execution (e.g., "US", "EU")'),
  parameters: z
    .array(
      z.object({
        name: z.string().describe('Parameter name'),
        parameterType: z
          .object({
            type: z
              .enum(['STRING', 'INT64', 'FLOAT64', 'BOOL', 'TIMESTAMP', 'DATE', 'ARRAY', 'STRUCT'])
              .describe('Parameter data type'),
          })
          .describe('Parameter type specification'),
        parameterValue: z
          .object({
            value: z.union([z.string(), z.number(), z.boolean()]).describe('Parameter value'),
          })
          .describe('Parameter value'),
      })
    )
    .optional()
    .describe('Named query parameters for parameterized queries (prevents SQL injection)'),
});

const PreviewActionSchema = z.object({
  action: z.literal('preview').describe('Preview BigQuery query results without full execution'),
  projectId: z.string().min(1).describe('GCP project ID for billing'),
  query: z.string().min(1).describe('SQL query to preview'),
  maxRows: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe('Maximum preview rows'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
  estimateCost: z
    .boolean()
    .optional()
    .default(false)
    .describe('Run a dry-run cost estimation before executing the preview query (opt-in)'),
  // Query control parameters (for preview)
  timeoutMs: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .optional()
    .describe('Query timeout in milliseconds (1s - 1min)'),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe('Validate query without execution (returns cost estimate)'),
  useQueryCache: z.boolean().optional().default(true).describe('Use cached results if available'),
  location: z.string().optional().describe('Dataset location (e.g., "US", "EU")'),
});

const RefreshActionSchema = CommonFieldsSchema.extend({
  action: z.literal('refresh').describe('Refresh a Connected Sheets data source'),
  dataSourceId: z.string().min(1).describe('Data source ID to refresh'),
  force: z.boolean().optional().default(false).describe('Force refresh even if recently refreshed'),
});

const CancelRefreshActionSchema = CommonFieldsSchema.extend({
  action: z
    .literal('cancel_refresh')
    .describe(
      'Cancel an in-progress data source refresh (for long-running BigQuery/Looker queries)'
    ),
  dataSourceId: z.string().min(1).describe('Data source ID to cancel refresh for'),
});

// ============================================================================
// Schema Discovery Action Schemas (3 actions)
// ============================================================================

const ListDatasetsActionSchema = z.object({
  action: z.literal('list_datasets').describe('List available BigQuery datasets in a project'),
  projectId: z.string().min(1).describe('GCP project ID'),
  maxResults: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(100)
    .describe('Maximum datasets to return'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

const ListTablesActionSchema = z.object({
  action: z.literal('list_tables').describe('List tables in a BigQuery dataset'),
  projectId: z.string().min(1).describe('GCP project ID'),
  datasetId: z.string().min(1).describe('Dataset ID'),
  maxResults: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(100)
    .describe('Maximum tables to return'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

const GetTableSchemaActionSchema = z.object({
  action: z.literal('get_table_schema').describe('Get schema of a BigQuery table'),
  projectId: z.string().min(1).describe('GCP project ID'),
  datasetId: z.string().min(1).describe('Dataset ID'),
  tableId: z.string().min(1).describe('Table ID'),
  verbosity: z
    .enum(['minimal', 'standard', 'detailed'])
    .optional()
    .default('standard')
    .describe('Response detail level'),
});

// ============================================================================
// Data Transfer Action Schemas (2 actions)
// ============================================================================

const ExportToBigQueryActionSchema = CommonFieldsSchema.extend({
  action: z.literal('export_to_bigquery').describe('Export sheet data to a BigQuery table'),
  range: RangeInputSchema.describe('Source range to export'),
  destination: BigQueryTableRefSchema.describe('Destination BigQuery table'),
  writeDisposition: z
    .enum(['WRITE_APPEND', 'WRITE_TRUNCATE', 'WRITE_EMPTY'])
    .optional()
    .default('WRITE_APPEND')
    .describe(
      'Write disposition: WRITE_APPEND (default) streams rows; WRITE_TRUNCATE deletes existing rows then streams; WRITE_EMPTY fails if table already has rows.'
    ),
  headerRows: z.coerce
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(1)
    .describe('Number of header rows to skip'),
  autoDetectSchema: z.boolean().optional().default(true).describe('Auto-detect schema from data'),
});

const ImportFromBigQueryActionSchema = CommonFieldsSchema.extend({
  action: z.literal('import_from_bigquery').describe('Import BigQuery query results to a sheet'),
  projectId: z.string().min(1).describe('GCP project ID for billing'),
  query: z.string().min(1).describe('SQL query to execute'),
  sheetId: SheetIdSchema.optional().describe('Target sheet (creates new if omitted)'),
  sheetName: z.string().optional().describe('Name for target sheet'),
  startCell: z.string().optional().default('A1').describe('Starting cell for data (e.g., "A1")'),
  includeHeaders: z.boolean().optional().default(true).describe('Include column headers'),
  maxResults: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .optional()
    .default(10000)
    .describe('Maximum rows'),
  // Query control parameters (P1-2)
  timeoutMs: z.coerce
    .number()
    .int()
    .min(1000)
    .max(600000)
    .optional()
    .describe('Query timeout in milliseconds (1s - 10min)'),
  maximumBytesBilled: z
    .string()
    .regex(/^\d+$/, 'maximumBytesBilled must be a numeric string')
    .optional()
    .describe('Maximum bytes billed for cost control (e.g., "1000000000" for 1GB)'),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe('Validate query without execution (returns cost estimate)'),
  useQueryCache: z.boolean().optional().default(true).describe('Use cached results if available'),
  location: z.string().optional().describe('Dataset location (e.g., "US", "EU")'),
  parameters: z
    .array(
      z.object({
        name: z.string().describe('Parameter name'),
        parameterType: z
          .object({
            type: z
              .enum(['STRING', 'INT64', 'FLOAT64', 'BOOL', 'TIMESTAMP', 'DATE', 'ARRAY', 'STRUCT'])
              .describe('Parameter data type'),
          })
          .describe('Parameter type specification'),
        parameterValue: z
          .object({
            value: z.union([z.string(), z.number(), z.boolean()]).describe('Parameter value'),
          })
          .describe('Parameter value'),
      })
    )
    .optional()
    .describe('Named query parameters for parameterized queries (prevents SQL injection)'),
});

// ============================================================================
// Scheduled Queries (3 new actions)
// ============================================================================

const CreateScheduledQueryActionSchema = z.object({
  action: z
    .literal('create_scheduled_query')
    .describe(
      'Create a scheduled query that runs automatically on a schedule via BigQuery Data Transfer Service'
    ),
  projectId: z.string().min(1).describe('Google Cloud project ID'),
  query: z.string().min(1).describe('SQL query to schedule'),
  displayName: z.string().min(1).describe('Human-readable name for the scheduled query'),
  schedule: z
    .string()
    .min(1)
    .describe('Schedule in cron format (e.g., "every 24 hours", "every monday 09:00")'),
  destinationDatasetId: z
    .string()
    .optional()
    .describe('Destination dataset for query results (if writing to a table)'),
  destinationTableId: z
    .string()
    .optional()
    .describe('Destination table name (supports template parameters like {run_time|"%Y%m%d"})'),
  location: z.string().optional().default('US').describe('BigQuery location (default: US)'),
  serviceAccountName: z
    .string()
    .optional()
    .describe(
      'Service account email to run the scheduled query as (e.g., "sa@project.iam.gserviceaccount.com"). ' +
        'If omitted, runs as the authenticated user.'
    ),
});

const ListScheduledQueriesActionSchema = z.object({
  action: z.literal('list_scheduled_queries').describe('List all scheduled queries in a project'),
  projectId: z.string().min(1).describe('Google Cloud project ID'),
  location: z.string().optional().default('US').describe('BigQuery location'),
  maxResults: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of results to return'),
});

const DeleteScheduledQueryActionSchema = z.object({
  action: z
    .literal('delete_scheduled_query')
    .describe('Delete a scheduled query by its transfer config name'),
  transferConfigName: z
    .string()
    .min(1)
    .describe('Full resource name of the transfer config (from list_scheduled_queries)'),
});

// ============================================================================
// Input Schema (discriminated union wrapped in request)
// ============================================================================

const BigQueryRequestSchema = z.discriminatedUnion('action', [
  // Connection Management (6)
  ConnectActionSchema,
  ConnectLookerActionSchema,
  DisconnectActionSchema,
  ListConnectionsActionSchema,
  GetConnectionActionSchema,
  CancelRefreshActionSchema,
  // Query Operations (3)
  QueryActionSchema,
  PreviewActionSchema,
  RefreshActionSchema,
  // Schema Discovery (3)
  ListDatasetsActionSchema,
  ListTablesActionSchema,
  GetTableSchemaActionSchema,
  // Data Transfer (2)
  ExportToBigQueryActionSchema,
  ImportFromBigQueryActionSchema,
  // Scheduled Queries (3)
  CreateScheduledQueryActionSchema,
  ListScheduledQueriesActionSchema,
  DeleteScheduledQueryActionSchema,
]);

export const SheetsBigQueryInputSchema = z.object({
  request: BigQueryRequestSchema,
});

// ============================================================================
// Output Schema (response union)
// ============================================================================

const BigQueryResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    action: z.string().describe('Action that was performed'),
    // Connection results
    connection: DataSourceConnectionSchema.optional().describe('Connection details'),
    connections: z.array(DataSourceConnectionSchema).optional().describe('List of connections'),
    // Query results
    rowCount: z.coerce.number().int().optional().describe('Number of rows returned'),
    columns: z.array(z.string()).optional().describe('Column names'),
    rows: z
      .array(
        z.array(
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.any()),
            z.record(z.string(), z.any()),
          ])
        )
      )
      .optional()
      .describe(
        'Result rows (for preview) - each cell can be string, number, boolean, null, array, or object'
      ),
    bytesProcessed: z.coerce.number().optional().describe('Bytes processed by query'),
    cacheHit: z.boolean().optional().describe('Whether query results came from cache'),
    // Schema discovery results
    datasets: z
      .array(
        z.object({
          datasetId: z.string(),
          location: z.string().optional(),
          description: z.string().optional(),
        })
      )
      .optional()
      .describe('List of datasets'),
    tables: z
      .array(
        z.object({
          tableId: z.string(),
          type: z.string().optional(),
          rowCount: z.coerce.number().optional(),
          description: z.string().optional(),
        })
      )
      .optional()
      .describe('List of tables'),
    schema: z.array(BigQueryColumnSchema).optional().describe('Table schema'),
    // Export results
    jobId: z.string().optional().describe('BigQuery job ID'),
    // Cancel refresh results
    cancelled: z.boolean().optional().describe('Whether refresh was cancelled'),
    // Common fields
    sheetId: SheetIdSchema.optional().describe('Sheet ID affected'),
    sheetName: z.string().optional().describe('Sheet name'),
    dryRun: z.boolean().optional().describe('Whether this was a dry run'),
    mutation: MutationSummarySchema.optional().describe('Mutation summary'),
    _meta: ResponseMetaSchema.optional().describe('Response metadata'),
  }),
  z.object({
    success: z.literal(false),
    error: ErrorDetailSchema,
  }),
]);

export const SheetsBigQueryOutputSchema = z.object({
  response: BigQueryResponseSchema,
});

// ============================================================================
// Annotations
// ============================================================================

export const SHEETS_BIGQUERY_ANNOTATIONS: ToolAnnotations = {
  title: 'BigQuery Integration',
  readOnlyHint: false,
  destructiveHint: true, // Can delete connections, overwrite data
  idempotentHint: false, // Queries consume quota
  openWorldHint: true, // Calls BigQuery and Sheets APIs
};

// ============================================================================
// Type Exports
// ============================================================================

export type SheetsBigQueryInput = z.infer<typeof SheetsBigQueryInputSchema>;
export type SheetsBigQueryOutput = z.infer<typeof SheetsBigQueryOutputSchema>;
export type BigQueryResponse = z.infer<typeof BigQueryResponseSchema>;
export type BigQueryRequest = SheetsBigQueryInput['request'];

// Type narrowing helpers for each action (14 actions)
export type BigQueryConnectInput = SheetsBigQueryInput['request'] & { action: 'connect' };
export type BigQueryConnectLookerInput = SheetsBigQueryInput['request'] & {
  action: 'connect_looker';
};
export type BigQueryDisconnectInput = SheetsBigQueryInput['request'] & { action: 'disconnect' };
export type BigQueryListConnectionsInput = SheetsBigQueryInput['request'] & {
  action: 'list_connections';
};
export type BigQueryGetConnectionInput = SheetsBigQueryInput['request'] & {
  action: 'get_connection';
};
export type BigQueryCancelRefreshInput = SheetsBigQueryInput['request'] & {
  action: 'cancel_refresh';
};
export type BigQueryQueryInput = SheetsBigQueryInput['request'] & { action: 'query' };
export type BigQueryPreviewInput = SheetsBigQueryInput['request'] & { action: 'preview' };
export type BigQueryRefreshInput = SheetsBigQueryInput['request'] & { action: 'refresh' };
export type BigQueryListDatasetsInput = SheetsBigQueryInput['request'] & {
  action: 'list_datasets';
};
export type BigQueryListTablesInput = SheetsBigQueryInput['request'] & { action: 'list_tables' };
export type BigQueryGetTableSchemaInput = SheetsBigQueryInput['request'] & {
  action: 'get_table_schema';
};
export type BigQueryExportInput = SheetsBigQueryInput['request'] & { action: 'export_to_bigquery' };
export type BigQueryImportInput = SheetsBigQueryInput['request'] & {
  action: 'import_from_bigquery';
};
