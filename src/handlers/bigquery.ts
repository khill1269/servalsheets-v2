/**
 * ServalSheets - BigQuery Handler
 *
 * Handles sheets_bigquery tool (17 actions):
 * - connect: Create BigQuery Connected Sheets data source
 * - connect_looker: Create Looker Connected Sheets data source
 * - disconnect: Remove BigQuery/Looker connection
 * - list_connections: List all data source connections
 * - get_connection: Get connection details
 * - cancel_refresh: Cancel an in-progress data source refresh
 * - query: Execute BigQuery SQL query
 * - preview: Preview query results
 * - refresh: Refresh data source
 * - list_datasets: List BigQuery datasets
 * - list_tables: List tables in dataset
 * - get_table_schema: Get table schema
 * - export_to_bigquery: Export sheet data to BigQuery
 * - import_from_bigquery: Import BigQuery results to sheet
 * - create_scheduled_query: Create a scheduled query
 * - list_scheduled_queries: List scheduled queries
 * - delete_scheduled_query: Delete a scheduled query
 *
 * APIs Used:
 * - Google Sheets API (DataSource for Connected Sheets - BigQuery and Looker)
 * - Google BigQuery API (jobs.query, datasets, tables)
 *
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import type { sheets_v4 } from 'googleapis';
import type { bigquery_v2 } from 'googleapis';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import type { Intent } from '../core/intent.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { getCircuitBreakerConfig, getEnv } from '../config/env.js';
import { circuitBreakerRegistry } from '../services/circuit-breaker-registry.js';
import { ServiceError } from '../core/errors.js';
import { createValidationError } from '../utils/error-factory.js';
import type {
  SheetsBigQueryInput,
  SheetsBigQueryOutput,
  BigQueryResponse,
  BigQueryRequest,
  BigQueryConnectInput,
  BigQueryConnectLookerInput,
  BigQueryDisconnectInput,
  BigQueryListConnectionsInput,
  BigQueryGetConnectionInput,
  BigQueryCancelRefreshInput,
  BigQueryQueryInput,
  BigQueryPreviewInput,
  BigQueryRefreshInput,
  BigQueryListDatasetsInput,
  BigQueryListTablesInput,
  BigQueryGetTableSchemaInput,
  BigQueryExportInput,
  BigQueryImportInput,
} from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import { sendProgress } from '../utils/request-context.js';

/** Maximum BigQuery result rows (ISSUE-188: configurable via env var) */
const MAX_BIGQUERY_RESULT_ROWS = getEnv().MAX_BIGQUERY_RESULT_ROWS;

/**
 * SECURITY: Validate BigQuery identifiers (project, dataset, table names).
 * Prevents SQL injection via malformed identifiers that could escape backtick quoting.
 * BigQuery identifiers: alphanumeric + underscores + hyphens, max 1024 chars.
 */
const BQ_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]{1,1024}$/;

function validateBigQueryIdentifier(value: string, field: string): void {
  if (!BQ_IDENTIFIER_REGEX.test(value)) {
    throw createValidationError({
      field,
      value: value.substring(0, 50),
      reason: `Invalid BigQuery identifier: ${field} must contain only alphanumeric characters, underscores, and hyphens (max 1024 chars)`,
    });
  }
}

/**
 * Build a safely-quoted BigQuery table reference from validated identifiers.
 */
function safeBqTableRef(projectId: string, datasetId: string, tableId: string): string {
  validateBigQueryIdentifier(projectId, 'projectId');
  validateBigQueryIdentifier(datasetId, 'datasetId');
  validateBigQueryIdentifier(tableId, 'tableId');
  return `\`${projectId}.${datasetId}.${tableId}\``;
}

/**
 * Dangerous SQL patterns that should be blocked in Connected Sheets queries.
 * Connected Sheets executes queries in BigQuery with the user's permissions,
 * so we validate to prevent accidental destructive operations and cost attacks.
 */
const DANGEROUS_SQL_PATTERNS = [
  /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bALTER\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bCREATE\s+(TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
  /\bMERGE\s+INTO\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bEXECUTE\s+IMMEDIATE\b/i,
  /\bCALL\s+\w/i,
];

function validateBigQuerySql(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) {
    throw createValidationError({
      field: 'query',
      value: '',
      reason: 'BigQuery query cannot be empty',
    });
  }

  // Strip SQL comments to prevent evasion (e.g., DROP/**/TABLE)
  let sanitized = trimmed;
  sanitized = sanitized.replace(/--[^\n]*/g, ' '); // Single-line comments
  sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, ' '); // Multi-line comments
  sanitized = sanitized.replace(/'([^'\\]|\\.)*'/g, ' '); // Single-quoted strings
  sanitized = sanitized.replace(/"([^"\\]|\\.)*"/g, ' '); // Double-quoted strings
  sanitized = sanitized.replace(/`([^`\\]|\\.)*`/g, ' '); // Backtick-quoted identifiers
  sanitized = sanitized.replace(/\s+/g, ' '); // Collapse whitespace

  for (const pattern of DANGEROUS_SQL_PATTERNS) {
    if (pattern.test(sanitized)) {
      throw createValidationError({
        field: 'query',
        value: trimmed.substring(0, 50),
        reason: `BigQuery query contains a potentially destructive statement matching ${pattern.source}. Only SELECT queries are allowed.`,
      });
    }
  }
}

export class SheetsBigQueryHandler extends BaseHandler<SheetsBigQueryInput, SheetsBigQueryOutput> {
  private sheetsApi: sheets_v4.Sheets;
  private bigqueryApi: bigquery_v2.Bigquery | null;
  private circuitBreaker: CircuitBreaker;

  constructor(
    context: HandlerContext,
    sheetsApi: sheets_v4.Sheets,
    bigqueryApi?: bigquery_v2.Bigquery
  ) {
    super('sheets_bigquery', context);
    this.sheetsApi = sheetsApi;
    this.bigqueryApi = bigqueryApi ?? null;

    // Initialize circuit breaker for BigQuery API
    const circuitConfig = getCircuitBreakerConfig();
    this.circuitBreaker = new CircuitBreaker({
      ...circuitConfig,
      name: 'bigquery-api',
    });

    // Register fallback strategy for circuit breaker
    this.circuitBreaker.registerFallback({
      name: 'bigquery-unavailable-fallback',
      priority: 1,
      shouldUse: () => true,
      execute: async () => {
        throw new ServiceError(
          'BigQuery API temporarily unavailable due to repeated failures. Try again in 30 seconds.',
          'UNAVAILABLE',
          'bigquery-api',
          true,
          { circuitBreaker: 'bigquery-api', retryAfterSeconds: 30 }
        );
      },
    });

    // Register with global registry
    circuitBreakerRegistry.register(
      'bigquery-api',
      this.circuitBreaker,
      'BigQuery API circuit breaker'
    );
  }

  async handle(input: SheetsBigQueryInput): Promise<SheetsBigQueryOutput> {
    // 1. Unwrap request from wrapper
    const rawReq = unwrapRequest<SheetsBigQueryInput['request']>(input);

    // 2. Require auth
    this.requireAuth();

    // 3. Track spreadsheet ID if applicable
    const spreadsheetId = 'spreadsheetId' in rawReq ? rawReq.spreadsheetId : undefined;
    this.trackSpreadsheetId(spreadsheetId);

    try {
      // 4. Dispatch to action handler
      const req = rawReq as BigQueryRequest;
      let response: BigQueryResponse;

      switch (req.action) {
        case 'connect':
          response = await this.handleConnect(req as BigQueryConnectInput);
          break;
        case 'connect_looker':
          response = await this.handleConnectLooker(req as BigQueryConnectLookerInput);
          break;
        case 'disconnect':
          response = await this.handleDisconnect(req as BigQueryDisconnectInput);
          break;
        case 'list_connections':
          response = await this.handleListConnections(req as BigQueryListConnectionsInput);
          break;
        case 'get_connection':
          response = await this.handleGetConnection(req as BigQueryGetConnectionInput);
          break;
        case 'cancel_refresh':
          response = await this.handleCancelRefresh(req as BigQueryCancelRefreshInput);
          break;
        case 'query':
          response = await this.handleQuery(req as BigQueryQueryInput);
          break;
        case 'preview':
          response = await this.handlePreview(req as BigQueryPreviewInput);
          break;
        case 'refresh':
          response = await this.handleRefresh(req as BigQueryRefreshInput);
          break;
        case 'list_datasets':
          response = await this.handleListDatasets(req as BigQueryListDatasetsInput);
          break;
        case 'list_tables':
          response = await this.handleListTables(req as BigQueryListTablesInput);
          break;
        case 'get_table_schema':
          response = await this.handleGetTableSchema(req as BigQueryGetTableSchemaInput);
          break;
        case 'export_to_bigquery':
          response = await this.handleExportToBigQuery(req as BigQueryExportInput);
          break;
        case 'import_from_bigquery':
          response = await this.handleImportFromBigQuery(req as BigQueryImportInput);
          break;
        case 'create_scheduled_query':
          response = await this.handleCreateScheduledQuery(req);
          break;
        case 'list_scheduled_queries':
          response = await this.handleListScheduledQueries(req);
          break;
        case 'delete_scheduled_query':
          response = await this.handleDeleteScheduledQuery(req);
          break;
        default: {
          const _exhaustiveCheck: never = req;
          response = this.error({
            code: ErrorCodes.INVALID_PARAMS,
            message: `Unknown action: ${(_exhaustiveCheck as { action: string }).action}`,
            retryable: false,
            suggestedFix: "Check parameter format - ranges use A1 notation like 'Sheet1!A1:D10'",
          });
        }
      }

      // 5. Track context after successful operation
      if (response.success && spreadsheetId) {
        this.trackContextFromRequest({ spreadsheetId });
      }

      // 6. Return wrapped response
      return { response };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  // Required by BaseHandler
  protected createIntents(_input: SheetsBigQueryInput): Intent[] {
    return []; // BigQuery doesn't use batch compiler
  }

  /**
   * Ensure BigQuery API is available
   */
  private requireBigQuery(): bigquery_v2.Bigquery {
    if (!this.bigqueryApi) {
      throw this.error({
        code: ErrorCodes.CONFIG_ERROR,
        message:
          'BigQuery API is not configured. Enable BigQuery API in your GCP project and ensure proper OAuth scopes.',
        retryable: false,
      });
    }
    return this.bigqueryApi;
  }

  /**
   * Wrap BigQuery API operations with circuit breaker protection (P2-4)
   * Uses the instance-level circuit breaker with BigQuery-specific fallback
   * @param operation - The BigQuery API operation to execute
   * @returns Result of the operation
   */
  private async withBigQueryCircuitBreaker<T>(operation: () => Promise<T>): Promise<T> {
    return await this.circuitBreaker.execute(operation);
  }

  /**
   * Execute a BigQuery query using the async job pattern with polling.
   * Falls back to synchronous jobs.query for short queries.
   *
   * The async pattern: jobs.insert → poll jobs.get → jobs.getQueryResults
   * This handles queries that take longer than the synchronous timeout.
   */
  private async executeQueryWithJobPolling(
    bigquery: bigquery_v2.Bigquery,
    params: {
      projectId: string;
      query: string;
      maxResults?: number;
      useLegacySql?: boolean;
      timeoutMs?: number;
      maximumBytesBilled?: string;
      dryRun?: boolean;
      useQueryCache?: boolean;
      location?: string;
      parameterMode?: string;
      queryParameters?: bigquery_v2.Schema$QueryParameter[];
    }
  ): Promise<{
    rows: unknown[][];
    columns: string[];
    totalRows: number;
    bytesProcessed: number;
    jobId?: string;
    cacheHit?: boolean;
  }> {
    // Step 1: Try synchronous query first (fast path for small queries)
    const syncResponse = await this.withBigQueryCircuitBreaker(() =>
      bigquery.jobs.query({
        projectId: params.projectId,
        requestBody: {
          query: params.query,
          maxResults: params.maxResults ?? 10000,
          useLegacySql: params.useLegacySql ?? false,
          timeoutMs: params.timeoutMs ?? 10000,
          maximumBytesBilled: params.maximumBytesBilled,
          dryRun: params.dryRun ?? false,
          useQueryCache: params.useQueryCache ?? true,
          location: params.location,
          parameterMode: params.parameterMode,
          queryParameters: params.queryParameters,
        },
      })
    );

    const jobId = syncResponse.data.jobReference?.jobId;
    const jobComplete = syncResponse.data.jobComplete ?? false;

    // If job completed synchronously, return results directly
    if (jobComplete) {
      // Check for errors even in sync response
      const syncErrors = syncResponse.data.errors;
      if (syncErrors && syncErrors.length > 0) {
        throw new ServiceError(
          `BigQuery query failed: ${syncErrors[0]?.message ?? 'Unknown error'}`,
          'INTERNAL_ERROR',
          'bigquery'
        );
      }

      const schema = syncResponse.data.schema?.fields ?? [];
      const columns = schema.map((f) => f.name ?? '');
      let allRows = syncResponse.data.rows?.map((row) => row.f?.map((cell) => cell.v) ?? []) ?? [];

      // Handle pagination for large result sets
      let pageToken: string | undefined = syncResponse.data.pageToken ?? undefined;
      while (pageToken && jobId) {
        const currentToken = pageToken;
        const pageResponse = await this.withBigQueryCircuitBreaker(() =>
          bigquery.jobs.getQueryResults({
            projectId: params.projectId,
            jobId,
            pageToken: currentToken,
            maxResults: params.maxResults ?? 10000,
            location: params.location,
          })
        );
        const pageRows =
          pageResponse.data.rows?.map((row) => row.f?.map((cell) => cell.v) ?? []) ?? [];
        allRows = allRows.concat(pageRows);
        pageToken = pageResponse.data.pageToken ?? undefined;

        // Safety limit: don't fetch more than 100K rows
        if (allRows.length > MAX_BIGQUERY_RESULT_ROWS) {
          logger.warn('BigQuery result set truncated at 100K rows', { jobId });
          break;
        }
      }

      return {
        rows: allRows,
        columns,
        totalRows: allRows.length,
        bytesProcessed: parseInt(syncResponse.data.totalBytesProcessed ?? '0', 10),
        jobId: jobId ?? undefined,
        cacheHit: syncResponse.data.cacheHit ?? undefined,
      };
    }

    // Step 2: Job didn't complete synchronously - poll for completion
    if (!jobId) {
      throw new ServiceError(
        'BigQuery query did not return a job ID',
        'INTERNAL_ERROR',
        'bigquery'
      );
    }

    logger.info('BigQuery query running asynchronously, polling for completion', {
      jobId,
      projectId: params.projectId,
    });

    const deadlineMs = Date.now() + (params.timeoutMs ?? 600000);
    const INITIAL_POLL_MS = 1000;
    const MAX_POLL_MS = 10000;

    for (let attempt = 0; ; attempt++) {
      if (Date.now() > deadlineMs) {
        throw new ServiceError(
          `BigQuery query exceeded timeout of ${params.timeoutMs ?? 600000}ms. Job ID: ${jobId} - check BigQuery console for status.`,
          'DEADLINE_EXCEEDED',
          'bigquery'
        );
      }
      const delay = Math.min(INITIAL_POLL_MS * Math.pow(1.5, attempt), MAX_POLL_MS);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const jobStatus = await this.withBigQueryCircuitBreaker(() =>
        bigquery.jobs.get({
          projectId: params.projectId,
          jobId,
          location: params.location,
        })
      );

      const state = jobStatus.data.status?.state;

      if (state === 'DONE') {
        // Check for errors
        const errors = jobStatus.data.status?.errors;
        if (errors && errors.length > 0) {
          throw new ServiceError(
            `BigQuery query failed: ${errors[0]?.message ?? 'Unknown error'}`,
            'INTERNAL_ERROR',
            'bigquery'
          );
        }

        // Fetch results
        const resultsResponse = await this.withBigQueryCircuitBreaker(() =>
          bigquery.jobs.getQueryResults({
            projectId: params.projectId,
            jobId,
            maxResults: params.maxResults ?? 10000,
            location: params.location,
          })
        );

        const schema = resultsResponse.data.schema?.fields ?? [];
        const columns = schema.map((f) => f.name ?? '');
        let allRows =
          resultsResponse.data.rows?.map((row) => row.f?.map((cell) => cell.v) ?? []) ?? [];

        // Paginate remaining results
        let pageToken: string | undefined = resultsResponse.data.pageToken ?? undefined;
        while (pageToken) {
          const currentToken = pageToken;
          const pageResponse = await this.withBigQueryCircuitBreaker(() =>
            bigquery.jobs.getQueryResults({
              projectId: params.projectId,
              jobId,
              pageToken: currentToken,
              maxResults: params.maxResults ?? 10000,
              location: params.location,
            })
          );
          const pageRows =
            pageResponse.data.rows?.map((row) => row.f?.map((cell) => cell.v) ?? []) ?? [];
          allRows = allRows.concat(pageRows);
          pageToken = pageResponse.data.pageToken ?? undefined;

          if (allRows.length > MAX_BIGQUERY_RESULT_ROWS) {
            logger.warn('BigQuery result set truncated at 100K rows', { jobId });
            break;
          }
        }

        return {
          rows: allRows,
          columns,
          totalRows: allRows.length,
          bytesProcessed: parseInt(
            jobStatus.data.statistics?.query?.totalBytesProcessed ?? '0',
            10
          ),
          jobId,
          cacheHit: jobStatus.data.statistics?.query?.cacheHit ?? undefined,
        };
      }

      logger.debug('BigQuery job still running', { jobId, state, attempt });
    }
  }

  /**
   * Map BigQuery API errors to structured ServalSheets errors
   */
  private mapBigQueryError(err: unknown): BigQueryResponse {
    const error = err as {
      response?: { data?: { error?: { code?: number; status?: string; message?: string } } };
      message?: string;
    };
    const apiError = error.response?.data?.error;

    if (apiError) {
      switch (apiError.status) {
        case 'PERMISSION_DENIED':
          return this.error({
            code: ErrorCodes.PERMISSION_DENIED,
            message: `BigQuery access denied: ${apiError.message ?? 'Check permissions'}`,
            retryable: false,
            suggestedFix:
              'Ensure OAuth scopes include bigquery and the user has access to the dataset.',
          });
        case 'NOT_FOUND':
          return this.error({
            code: ErrorCodes.NOT_FOUND,
            message: `BigQuery resource not found: ${apiError.message ?? 'Check project/dataset/table IDs'}`,
            retryable: false,
            suggestedFix: 'Verify projectId, datasetId, and tableId are correct.',
          });
        case 'INVALID_ARGUMENT':
          return this.error({
            code: ErrorCodes.INVALID_PARAMS,
            message: `Invalid BigQuery query: ${apiError.message ?? 'Check SQL syntax'}`,
            retryable: false,
            suggestedFix: 'Check SQL syntax. Use preview with dryRun:true to validate queries.',
          });
        default:
          break;
      }

      if (apiError.code === 429) {
        return this.error({
          code: ErrorCodes.QUOTA_EXCEEDED,
          message: 'BigQuery API rate limit exceeded. Try again later.',
          retryable: true,
          suggestedFix: 'Wait 60 seconds and retry, or reduce query frequency.',
        });
      }
    }

    return this.error({
      code: ErrorCodes.UNAVAILABLE,
      message: `BigQuery operation failed: ${error.message ?? 'Unknown error'}`,
      retryable: true,
      suggestedFix: 'Try again. If the issue persists, check the BigQuery console.',
    });
  }

  /**
   * Connect: Create a BigQuery Connected Sheets data source
   */
  private async handleConnect(req: BigQueryConnectInput): Promise<BigQueryResponse> {
    try {
      // Build data source spec
      const dataSourceSpec: sheets_v4.Schema$DataSourceSpec = {
        bigQuery: {
          projectId: req.spec.projectId,
        },
      };

      // Add table or query reference
      if (req.spec.tableId && req.spec.datasetId) {
        dataSourceSpec.bigQuery!.tableSpec = {
          tableProjectId: req.spec.projectId,
          datasetId: req.spec.datasetId,
          tableId: req.spec.tableId,
        };
      } else if (req.spec.query) {
        // Validate query to prevent destructive SQL operations
        validateBigQuerySql(req.spec.query);
        dataSourceSpec.bigQuery!.querySpec = {
          rawQuery: req.spec.query,
        };
      }

      // Create data source via batchUpdate
      const response = await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          requests: [
            {
              addDataSource: {
                dataSource: {
                  spec: dataSourceSpec,
                },
              },
            },
          ],
        },
      });

      const addedDataSource = response.data?.replies?.[0]?.addDataSource?.dataSource;

      logger.info('Created BigQuery connection', {
        spreadsheetId: req.spreadsheetId,
        dataSourceId: addedDataSource?.dataSourceId,
      });

      return this.success('connect', {
        connection: {
          dataSourceId: addedDataSource?.dataSourceId ?? '',
          type: 'bigquery' as const,
          spec: {
            projectId: req.spec.projectId,
            datasetId: req.spec.datasetId,
            tableId: req.spec.tableId,
            query: req.spec.query,
          },
          sheetId: addedDataSource?.sheetId ?? undefined,
        },
        message:
          'BigQuery data source created. Note: initial data load is asynchronous. ' +
          'Use bigquery refresh action to check status, or read the connected sheet after a few seconds.',
      });
    } catch (err) {
      logger.error('Failed to create BigQuery connection', { err, req });
      throw err;
    }
  }

  /**
   * Connect Looker: Create a Looker Connected Sheets data source
   *
   * Note: Looker data sources only support pivot tables, not extracts, formulas, or charts.
   * This is a Google Sheets API limitation.
   */
  private async handleConnectLooker(req: BigQueryConnectLookerInput): Promise<BigQueryResponse> {
    try {
      // Build Looker data source spec
      // Looker uses the 'looker' field in DataSourceSpec (not in googleapis types yet)
      const dataSourceSpec = {
        looker: {
          instanceUri: req.spec.instanceUri,
          model: req.spec.model,
          explore: req.spec.explore,
        },
      } as sheets_v4.Schema$DataSourceSpec;

      // Create data source via batchUpdate
      const response = await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          requests: [
            {
              addDataSource: {
                dataSource: {
                  spec: dataSourceSpec,
                },
              },
            },
          ],
        },
      });

      const addedDataSource = response.data?.replies?.[0]?.addDataSource?.dataSource;

      logger.info('Created Looker connection', {
        spreadsheetId: req.spreadsheetId,
        dataSourceId: addedDataSource?.dataSourceId,
        instanceUri: req.spec.instanceUri,
      });

      return this.success('connect_looker', {
        connection: {
          dataSourceId: addedDataSource?.dataSourceId ?? '',
          type: 'looker' as const,
          lookerSpec: {
            instanceUri: req.spec.instanceUri,
            model: req.spec.model,
            explore: req.spec.explore,
          },
          sheetId: addedDataSource?.sheetId ?? undefined,
        },
      });
    } catch (err) {
      logger.error('Failed to create Looker connection', { err, req });
      throw err;
    }
  }

  /**
   * Disconnect: Remove a BigQuery data source connection
   */
  private async handleDisconnect(req: BigQueryDisconnectInput): Promise<BigQueryResponse> {
    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDataSource: {
                dataSourceId: req.dataSourceId,
              },
            },
          ],
        },
      });

      logger.info('Deleted BigQuery connection', {
        spreadsheetId: req.spreadsheetId,
        dataSourceId: req.dataSourceId,
      });

      return this.success('disconnect', {
        mutation: {
          cellsAffected: 0,
          sheetsModified: [req.dataSourceId],
        },
      });
    } catch (err) {
      logger.error('Failed to delete BigQuery connection', { err, req });
      throw err;
    }
  }

  /**
   * List connections: List all data source connections (BigQuery and Looker) in the spreadsheet
   */
  private async handleListConnections(
    req: BigQueryListConnectionsInput
  ): Promise<BigQueryResponse> {
    try {
      const spreadsheet = await this.sheetsApi.spreadsheets.get({
        spreadsheetId: req.spreadsheetId,
        includeGridData: false,
        fields: 'dataSources,dataSourceSchedules',
      });

      const dataSources = spreadsheet.data.dataSources ?? [];
      // Filter and map data sources - use type assertions for looker access since googleapis types may not include it
      const connections = dataSources
        .filter((ds) => ds.spec?.bigQuery || (ds.spec as Record<string, unknown>)?.['looker'])
        .map((ds) => {
          const spec = ds.spec as Record<string, unknown>;
          const lookerSpec = spec?.['looker'] as Record<string, string> | undefined;
          if (lookerSpec) {
            return {
              dataSourceId: ds.dataSourceId ?? '',
              type: 'looker' as const,
              lookerSpec: {
                instanceUri: lookerSpec['instanceUri'] ?? '',
                model: lookerSpec['model'] ?? '',
                explore: lookerSpec['explore'] ?? '',
              },
              sheetId: ds.sheetId ?? undefined,
            };
          }
          return {
            dataSourceId: ds.dataSourceId ?? '',
            type: 'bigquery' as const,
            spec: {
              projectId: ds.spec?.bigQuery?.projectId ?? '',
              datasetId: ds.spec?.bigQuery?.tableSpec?.datasetId ?? undefined,
              tableId: ds.spec?.bigQuery?.tableSpec?.tableId ?? undefined,
              query: ds.spec?.bigQuery?.querySpec?.rawQuery ?? undefined,
            },
            sheetId: ds.sheetId ?? undefined,
          };
        });

      return this.success('list_connections', {
        connections,
      });
    } catch (err) {
      logger.error('Failed to list data source connections', { err, req });
      throw err;
    }
  }

  /**
   * Get connection: Get details of a specific data source connection (BigQuery or Looker)
   */
  private async handleGetConnection(req: BigQueryGetConnectionInput): Promise<BigQueryResponse> {
    try {
      const spreadsheet = await this.sheetsApi.spreadsheets.get({
        spreadsheetId: req.spreadsheetId,
        includeGridData: false,
        fields: 'dataSources',
      });

      const dataSource = spreadsheet.data.dataSources?.find(
        (ds) => ds.dataSourceId === req.dataSourceId
      );

      if (!dataSource) {
        return this.error({
          code: ErrorCodes.NOT_FOUND,
          message: `Data source not found: ${req.dataSourceId}`,
          retryable: false,
          suggestedFix: 'Verify the spreadsheet ID is correct and you have access to it',
        });
      }

      // Check if this is a Looker or BigQuery data source
      // Use type assertion for looker access since googleapis types may not include it
      const spec = dataSource.spec as Record<string, unknown>;
      const lookerSpec = spec?.['looker'] as Record<string, string> | undefined;

      if (lookerSpec) {
        return this.success('get_connection', {
          connection: {
            dataSourceId: dataSource.dataSourceId ?? '',
            type: 'looker' as const,
            lookerSpec: {
              instanceUri: lookerSpec['instanceUri'] ?? '',
              model: lookerSpec['model'] ?? '',
              explore: lookerSpec['explore'] ?? '',
            },
            sheetId: dataSource.sheetId ?? undefined,
          },
        });
      }

      return this.success('get_connection', {
        connection: {
          dataSourceId: dataSource.dataSourceId ?? '',
          type: 'bigquery' as const,
          spec: {
            projectId: dataSource.spec?.bigQuery?.projectId ?? '',
            datasetId: dataSource.spec?.bigQuery?.tableSpec?.datasetId ?? undefined,
            tableId: dataSource.spec?.bigQuery?.tableSpec?.tableId ?? undefined,
            query: dataSource.spec?.bigQuery?.querySpec?.rawQuery ?? undefined,
          },
          sheetId: dataSource.sheetId ?? undefined,
        },
      });
    } catch (err) {
      logger.error('Failed to get data source connection', { err, req });
      throw err;
    }
  }

  /**
   * Query: Execute a BigQuery SQL query.
   *
   * Two paths:
   * 1. Direct execution (BigQuery client available, no dataSourceId): uses executeQueryWithJobPolling
   *    to run the query and return rows. Supports all query parameters (location, parameters,
   *    dryRun, timeoutMs, maximumBytesBilled, useQueryCache, maxResults).
   * 2. Connected Sheets (dataSourceId provided, or no BigQuery client): creates/updates a
   *    persistent Connected Sheets data source via spreadsheets.batchUpdate.
   */
  private async handleQuery(req: BigQueryQueryInput): Promise<BigQueryResponse> {
    // Validate query to prevent destructive SQL operations
    validateBigQuerySql(req.query);

    // Path 1: Direct BigQuery execution when client is available and no dataSourceId
    if (this.bigqueryApi && !req.dataSourceId) {
      const bigquery = this.bigqueryApi;

      try {
        // dryRun: validate query and return cost estimate without executing
        if (req.dryRun) {
          const dryRunResponse = await this.withBigQueryCircuitBreaker(() =>
            bigquery.jobs.query({
              projectId: req.projectId,
              requestBody: {
                query: req.query,
                useLegacySql: false,
                dryRun: true,
                location: req.location,
              },
            })
          );
          const estimatedBytes = parseInt(dryRunResponse.data.totalBytesProcessed ?? '0', 10);
          return this.success('query', {
            dryRun: true,
            estimatedBytes,
            estimatedGB: (estimatedBytes / (1024 * 1024 * 1024)).toFixed(4),
          });
        }

        // Map schema parameters to BigQuery API format
        const queryParameters = req.parameters?.map((param) => ({
          name: param.name,
          parameterType: param.parameterType,
          parameterValue: {
            value: String(param.parameterValue.value),
          },
        }));

        const result = await this.executeQueryWithJobPolling(bigquery, {
          projectId: req.projectId,
          query: req.query,
          maxResults: req.maxResults ?? 10000,
          timeoutMs: req.timeoutMs,
          maximumBytesBilled: req.maximumBytesBilled,
          useQueryCache: req.useQueryCache ?? true,
          location: req.location,
          parameterMode: queryParameters?.length ? 'NAMED' : undefined,
          queryParameters,
        });

        return this.success('query', {
          rowCount: result.rows.length,
          columns: result.columns,
          rows: result.rows as (string | number | boolean | null)[][],
          bytesProcessed: result.bytesProcessed,
          cacheHit: result.cacheHit,
          jobId: result.jobId,
        });
      } catch (err) {
        logger.error('Failed to execute BigQuery query', { err, req });
        return this.mapBigQueryError(err);
      }
    }

    // Path 2: Connected Sheets data source (persistent, auto-refreshes in Sheets)
    try {
      // Update existing data source query
      if (req.dataSourceId) {
        await this.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: req.spreadsheetId ?? '',
          requestBody: {
            requests: [
              {
                updateDataSource: {
                  dataSource: {
                    dataSourceId: req.dataSourceId,
                    spec: {
                      bigQuery: {
                        projectId: req.projectId,
                        querySpec: {
                          rawQuery: req.query,
                        },
                      },
                    },
                  },
                  fields: 'spec.bigQuery.querySpec',
                },
              },
            ],
          },
        });

        return this.success('query', {
          connection: {
            dataSourceId: req.dataSourceId,
            spec: {
              projectId: req.projectId,
              query: req.query,
            },
          },
        });
      }

      // Create new Connected Sheets data source
      const response = await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: req.spreadsheetId ?? '',
        requestBody: {
          requests: [
            {
              addDataSource: {
                dataSource: {
                  spec: {
                    bigQuery: {
                      projectId: req.projectId,
                      querySpec: {
                        rawQuery: req.query,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      });

      const addedDataSource = response.data?.replies?.[0]?.addDataSource?.dataSource;

      return this.success('query', {
        connection: {
          dataSourceId: addedDataSource?.dataSourceId ?? '',
          spec: {
            projectId: req.projectId,
            query: req.query,
          },
          sheetId: addedDataSource?.sheetId ?? undefined,
        },
        sheetId: addedDataSource?.sheetId ?? undefined,
      });
    } catch (err) {
      logger.error('Failed to execute BigQuery query via Connected Sheets', { err, req });
      throw err;
    }
  }

  /**
   * Preview: Preview query results without full execution
   */
  private async handlePreview(req: BigQueryPreviewInput): Promise<BigQueryResponse> {
    // Validate query to prevent destructive SQL operations
    validateBigQuerySql(req.query);

    const bigquery = this.requireBigQuery();

    try {
      // Opt-in cost estimation: run dry run first when estimateCost is true
      if (req.estimateCost && !req.dryRun) {
        const dryRunResponse = await this.withBigQueryCircuitBreaker(() =>
          bigquery.jobs.query({
            projectId: req.projectId,
            requestBody: {
              query: req.query,
              useLegacySql: false,
              dryRun: true,
            },
          })
        );
        const estimatedBytes = parseInt(dryRunResponse.data.totalBytesProcessed ?? '0', 10);
        const estimatedGB = estimatedBytes / (1024 * 1024 * 1024);

        // Warn if query will scan more than 1GB
        if (estimatedGB > 1) {
          logger.warn('BigQuery preview will scan large dataset', {
            estimatedBytes,
            estimatedGB: estimatedGB.toFixed(2),
            query: req.query.substring(0, 100),
          });
        }
      }

      // Inject LIMIT if not present to prevent unbounded preview queries
      const maxRows = req.maxRows ?? 10;
      const strippedForLimitCheck = req.query
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--[^\n]*/g, '');
      const previewQuery = /\bLIMIT\s+\d+/i.test(strippedForLimitCheck)
        ? req.query
        : `${req.query.replace(/;?\s*$/, '')} LIMIT ${maxRows}`;

      // Re-validate the assembled query (LIMIT injection could expose DML in edge cases)
      validateBigQuerySql(previewQuery);

      // Use async job pattern for reliable execution
      const result = await this.executeQueryWithJobPolling(bigquery, {
        projectId: req.projectId,
        query: previewQuery,
        maxResults: maxRows,
        timeoutMs: req.timeoutMs,
        dryRun: req.dryRun ?? false,
        useQueryCache: req.useQueryCache ?? true,
        location: req.location,
      });

      return this.success('preview', {
        rowCount: result.rows.length,
        columns: result.columns,
        rows: result.rows as (string | number | boolean | null)[][],
        bytesProcessed: result.bytesProcessed,
        cacheHit: result.cacheHit,
        jobId: result.jobId,
      });
    } catch (err) {
      logger.error('Failed to preview BigQuery query', { err, req });
      return this.mapBigQueryError(err);
    }
  }

  /**
   * Refresh: Refresh a Connected Sheets data source
   */
  private async handleRefresh(req: BigQueryRefreshInput): Promise<BigQueryResponse> {
    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          requests: [
            {
              refreshDataSource: {
                dataSourceId: req.dataSourceId,
                force: req.force ?? false,
              },
            },
          ],
        },
      });

      logger.info('Refreshed BigQuery data source', {
        spreadsheetId: req.spreadsheetId,
        dataSourceId: req.dataSourceId,
      });

      return this.success('refresh', {
        connection: {
          dataSourceId: req.dataSourceId,
          spec: { projectId: '' }, // Minimal spec, details can be fetched via get_connection
          lastRefreshed: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error('Failed to refresh BigQuery data source', { err, req });
      throw err;
    }
  }

  /**
   * Cancel Refresh: Cancel an in-progress data source refresh
   *
   * Uses CancelDataSourceRefreshRequest to abort long-running BigQuery or Looker queries.
   * This is useful when a Connected Sheets refresh is taking too long or consuming too many resources.
   */
  private async handleCancelRefresh(req: BigQueryCancelRefreshInput): Promise<BigQueryResponse> {
    try {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: req.spreadsheetId,
        requestBody: {
          requests: [
            {
              cancelDataSourceRefresh: {
                dataSourceId: req.dataSourceId,
              },
            },
          ],
        },
      });

      logger.info('Cancelled data source refresh', {
        spreadsheetId: req.spreadsheetId,
        dataSourceId: req.dataSourceId,
      });

      return this.success('cancel_refresh', {
        cancelled: true,
        connection: {
          dataSourceId: req.dataSourceId,
        },
      });
    } catch (err) {
      logger.error('Failed to cancel data source refresh', { err, req });
      throw err;
    }
  }

  /**
   * List datasets: List BigQuery datasets in a project
   */
  private async handleListDatasets(req: BigQueryListDatasetsInput): Promise<BigQueryResponse> {
    const bigquery = this.requireBigQuery();

    try {
      const maxResults = req.maxResults ?? 100;
      let allDatasets: { datasetId: string; location?: string; description?: string }[] = [];
      let pageToken: string | undefined;

      do {
        const response = await this.withBigQueryCircuitBreaker(() =>
          bigquery.datasets.list({
            projectId: req.projectId,
            maxResults: Math.min(maxResults - allDatasets.length, 100),
            pageToken,
          })
        );

        const datasets =
          response.data.datasets?.map((ds) => ({
            datasetId: ds.datasetReference?.datasetId ?? '',
            location: ds.location ?? undefined,
            description: ds.friendlyName ?? undefined,
          })) ?? [];

        allDatasets.push(...datasets);
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken && allDatasets.length < maxResults);

      return this.success('list_datasets', {
        datasets: allDatasets,
      });
    } catch (err) {
      logger.error('Failed to list BigQuery datasets', { err, req });
      throw err;
    }
  }

  /**
   * List tables: List tables in a BigQuery dataset
   */
  private async handleListTables(req: BigQueryListTablesInput): Promise<BigQueryResponse> {
    const bigquery = this.requireBigQuery();

    try {
      const maxResults = req.maxResults ?? 100;
      let allTables: { tableId: string; type?: string; description?: string }[] = [];
      let pageToken: string | undefined;

      do {
        const response = await this.withBigQueryCircuitBreaker(() =>
          bigquery.tables.list({
            projectId: req.projectId,
            datasetId: req.datasetId,
            maxResults: Math.min(maxResults - allTables.length, 100),
            pageToken,
          })
        );

        const tables =
          response.data.tables?.map((t) => ({
            tableId: t.tableReference?.tableId ?? '',
            type: t.type ?? undefined,
            description: t.friendlyName ?? undefined,
          })) ?? [];

        allTables.push(...tables);
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken && allTables.length < maxResults);

      return this.success('list_tables', {
        tables: allTables,
      });
    } catch (err) {
      logger.error('Failed to list BigQuery tables', { err, req });
      throw err;
    }
  }

  /**
   * Get table schema: Get schema of a BigQuery table
   */
  private async handleGetTableSchema(req: BigQueryGetTableSchemaInput): Promise<BigQueryResponse> {
    const bigquery = this.requireBigQuery();

    try {
      const response = await this.withBigQueryCircuitBreaker(() =>
        bigquery.tables.get({
          projectId: req.projectId,
          datasetId: req.datasetId,
          tableId: req.tableId,
        })
      );

      const schema =
        response.data.schema?.fields?.map((f) => ({
          name: f.name ?? '',
          type: f.type ?? 'STRING',
          mode: (f.mode as 'NULLABLE' | 'REQUIRED' | 'REPEATED') ?? undefined,
          description: f.description ?? undefined,
        })) ?? [];

      return this.success('get_table_schema', {
        schema,
      });
    } catch (err) {
      logger.error('Failed to get BigQuery table schema', { err, req });
      throw err;
    }
  }

  /**
   * Export to BigQuery: Export sheet data to a BigQuery table
   */
  private async handleExportToBigQuery(req: BigQueryExportInput): Promise<BigQueryResponse> {
    const bigquery = this.requireBigQuery();

    try {
      // First, read the data from the sheet
      // Extract range string from various formats
      let range: string;
      if (typeof req.range === 'string') {
        range = req.range;
      } else if ('a1' in req.range) {
        range = req.range.a1;
      } else if ('namedRange' in req.range) {
        range = req.range.namedRange;
      } else {
        return this.error({
          code: ErrorCodes.INVALID_PARAMS,
          message: 'Range must be a string, A1 notation object, or named range',
          retryable: false,
          suggestedFix:
            'Check the parameter format and ensure all required parameters are provided',
        });
      }

      const sheetData = await this.sheetsApi.spreadsheets.values.get({
        spreadsheetId: req.spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE', // Preserve raw numbers/dates for BigQuery ingestion
      });

      const values = sheetData.data.values ?? [];
      if (values.length === 0) {
        return this.error({
          code: ErrorCodes.INVALID_PARAMS,
          message: 'No data found in the specified range',
          retryable: false,
          suggestedFix:
            'Check the parameter format and ensure all required parameters are provided',
        });
      }

      const writeDisposition = req.writeDisposition ?? 'WRITE_APPEND';

      // WRITE_EMPTY: fail if the table already has rows
      if (writeDisposition === 'WRITE_EMPTY') {
        const tableRef = safeBqTableRef(req.destination.projectId, req.destination.datasetId, req.destination.tableId);
        const countJob = await bigquery.jobs.insert({
          projectId: req.destination.projectId,
          requestBody: {
            configuration: {
              query: {
                query: `SELECT COUNT(1) AS row_count FROM ${tableRef}`,
                useLegacySql: false,
              },
            },
          },
        });
        const jobId = countJob.data.jobReference?.jobId;
        if (jobId) {
          // Poll with exponential backoff (500ms → 5s cap, max 30s total)
          for (let attempt = 0; attempt < 15; attempt++) {
            const delay = Math.min(500 * Math.pow(2, attempt), 5000);
            await new Promise((r) => setTimeout(r, delay));
            const pollResp = await bigquery.jobs.get({
              projectId: req.destination.projectId,
              jobId,
              location: req.destination.location,
            });
            if (pollResp.data.status?.state === 'DONE') {
              const queryResults = await bigquery.jobs.getQueryResults({
                projectId: req.destination.projectId,
                jobId,
              });
              const existingRows = Number(queryResults.data.rows?.[0]?.f?.[0]?.v ?? 0);
              if (existingRows > 0) {
                return this.error({
                  code: ErrorCodes.INVALID_PARAMS,
                  message: `writeDisposition WRITE_EMPTY failed: table already contains ${existingRows} row(s).`,
                  retryable: false,
                  suggestedFix: 'Use writeDisposition WRITE_APPEND or WRITE_TRUNCATE.',
                });
              }
              break;
            }
          }
        }
      }

      // WRITE_TRUNCATE: delete all existing rows via DML before streaming new ones
      if (writeDisposition === 'WRITE_TRUNCATE') {
        const tableRef = safeBqTableRef(req.destination.projectId, req.destination.datasetId, req.destination.tableId);
        const truncateJob = await bigquery.jobs.insert({
          projectId: req.destination.projectId,
          requestBody: {
            configuration: {
              query: {
                query: `DELETE FROM ${tableRef} WHERE TRUE`,
                useLegacySql: false,
              },
            },
          },
        });
        const truncJobId = truncateJob.data.jobReference?.jobId;
        if (truncJobId) {
          // Poll with exponential backoff (500ms → 5s cap, max 60s total)
          for (let attempt = 0; attempt < 20; attempt++) {
            const delay = Math.min(500 * Math.pow(2, attempt), 5000);
            await new Promise((r) => setTimeout(r, delay));
            const pollResp = await bigquery.jobs.get({
              projectId: req.destination.projectId,
              jobId: truncJobId,
              location: req.destination.location,
            });
            if (pollResp.data.status?.state === 'DONE') {
              if (pollResp.data.status.errorResult) {
                logger.warn(
                  'WRITE_TRUNCATE DML returned error (table may not exist yet — proceeding)',
                  {
                    error: pollResp.data.status.errorResult,
                  }
                );
              }
              break;
            }
          }
        }
      }

      // Skip header rows
      const headerRows = req.headerRows ?? 1;
      const headers: unknown[] = headerRows > 0 ? (values[0] ?? []) : [];
      const dataRows = values.slice(headerRows);

      // Convert to BigQuery format
      const rows = dataRows.map((row) => {
        const json: Record<string, unknown> = {};
        row.forEach((cell, idx) => {
          const headerValue = headers[idx];
          const columnName = typeof headerValue === 'string' ? headerValue : `column_${idx}`;
          json[columnName] = cell;
        });
        return { json };
      });

      // Use streaming insert with chunking for large datasets (P1-3)
      // BigQuery recommends 10,000 rows per streaming insert request for spreadsheet-sized rows
      const CHUNK_SIZE = 10_000;
      // For very large exports (>500K rows), GCS-staged load jobs would be more efficient
      // but require Cloud Storage access not yet wired. Log advisory for operators.
      const LOAD_JOB_THRESHOLD = 500_000;
      const totalRows = rows.length;
      const allInsertErrors: unknown[] = [];
      // Generate a stable batch ID for insertId deduplication (prevents duplicate rows on retry)
      const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      if (totalRows >= LOAD_JOB_THRESHOLD) {
        logger.warn('Very large BigQuery export: GCS-staged load jobs would be more efficient', {
          totalRows,
          threshold: LOAD_JOB_THRESHOLD,
          note: 'Proceeding with streaming insert. For >500K rows, consider using a GCS load job instead.',
        });
      } else if (totalRows > CHUNK_SIZE) {
        logger.info('Chunking large export', {
          totalRows,
          chunkSize: CHUNK_SIZE,
          chunks: Math.ceil(totalRows / CHUNK_SIZE),
        });
      }

      const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);
      await sendProgress(0, totalChunks, `Exporting ${totalRows} rows to BigQuery...`);

      // Process rows in chunks
      for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, Math.min(i + CHUNK_SIZE, totalRows));
        const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;

        logger.debug('Inserting chunk', {
          chunkNumber,
          totalChunks,
          chunkSize: chunk.length,
          rowsProcessed: i + chunk.length,
          totalRows,
        });

        const insertResponse = await this.withBigQueryCircuitBreaker(() =>
          bigquery.tabledata.insertAll({
            projectId: req.destination.projectId,
            datasetId: req.destination.datasetId,
            tableId: req.destination.tableId,
            requestBody: {
              skipInvalidRows: true, // Don't fail entire chunk on single bad row
              ignoreUnknownValues: true, // Tolerate extra columns not in schema
              rows: chunk.map((row, rowIdx) => ({
                insertId: `${batchId}-${i + rowIdx}`,
                ...row,
              })),
            },
          })
        );

        const chunkErrors = insertResponse.data.insertErrors ?? [];
        if (chunkErrors.length > 0) {
          logger.warn('Some rows failed to insert in chunk', {
            chunkNumber,
            errorCount: chunkErrors.length,
          });
          allInsertErrors.push(...chunkErrors);
        }

        await sendProgress(
          chunkNumber,
          totalChunks,
          `Exported chunk ${chunkNumber}/${totalChunks}`
        );
      }

      const successfulRows = totalRows - allInsertErrors.length;

      if (allInsertErrors.length > 0) {
        logger.warn('Export completed with errors', {
          totalRows,
          successfulRows,
          failedRows: allInsertErrors.length,
        });
      }

      // Streaming inserts don't produce a BigQuery job — no jobId to return

      return this.success('export_to_bigquery', {
        rowCount: successfulRows,
        mutation: {
          cellsAffected: totalRows,
          sheetsModified: [],
        },
      });
    } catch (err) {
      logger.error('Failed to export to BigQuery', { err, req });
      throw err;
    }
  }

  /**
   * Import from BigQuery: Import BigQuery query results to a sheet
   */
  private async handleImportFromBigQuery(req: BigQueryImportInput): Promise<BigQueryResponse> {
    // Validate query to prevent destructive SQL operations
    validateBigQuerySql(req.query);

    const bigquery = this.requireBigQuery();

    try {
      // Transform parameters to BigQuery API format (all values must be strings)
      const queryParameters = req.parameters?.map((param) => ({
        name: param.name,
        parameterType: param.parameterType,
        parameterValue: {
          value: String(param.parameterValue.value),
        },
      }));

      await sendProgress(0, 3, 'Running BigQuery query...');

      // Use async job pattern with pagination for reliable large query execution
      const queryResult = await this.executeQueryWithJobPolling(bigquery, {
        projectId: req.projectId,
        query: req.query,
        maxResults: req.maxResults ?? 10000,
        timeoutMs: req.timeoutMs,
        maximumBytesBilled: req.maximumBytesBilled,
        dryRun: req.dryRun ?? false,
        useQueryCache: req.useQueryCache ?? true,
        location: req.location,
        parameterMode: queryParameters ? 'NAMED' : undefined,
        queryParameters,
      });

      await sendProgress(1, 3, `Query returned ${queryResult.rows.length} rows`);

      const columns = queryResult.columns;
      const rows = queryResult.rows;

      // Prepare values array for sheet
      const values: unknown[][] = [];
      if (req.includeHeaders !== false) {
        values.push(columns);
      }
      values.push(...rows);

      // Determine target range
      const startCell = req.startCell ?? 'A1';
      let targetSheetId = req.sheetId;
      let targetSheetName = req.sheetName ?? 'BigQuery Results';

      // If no sheet specified, create a new one
      if (targetSheetId === undefined && req.sheetId === undefined) {
        const addSheetResponse = await this.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: req.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: targetSheetName,
                  },
                },
              },
            ],
          },
        });
        targetSheetId =
          addSheetResponse.data?.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
        targetSheetName =
          addSheetResponse.data?.replies?.[0]?.addSheet?.properties?.title ?? targetSheetName;
      }

      await sendProgress(2, 3, `Writing ${rows.length} rows to sheet...`);

      // Write data to sheet
      const range = `${targetSheetName}!${startCell}`;
      await this.sheetsApi.spreadsheets.values.update({
        spreadsheetId: req.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values,
        },
      });

      logger.info('Imported BigQuery results to sheet', {
        spreadsheetId: req.spreadsheetId,
        sheetName: targetSheetName,
        rowCount: rows.length,
      });

      // Record operation in session context for LLM follow-up references
      try {
        if (this.context.sessionContext) {
          this.context.sessionContext.recordOperation({
            tool: 'sheets_bigquery',
            action: 'import_from_bigquery',
            spreadsheetId: req.spreadsheetId,
            description: `Imported ${rows.length} rows from BigQuery to ${targetSheetName}`,
            undoable: false,
            cellsAffected: values.length * (columns.length || 1),
          });
        }
      } catch {
        // Non-blocking: session context recording is best-effort
      }

      return this.success('import_from_bigquery', {
        rowCount: rows.length,
        columns,
        sheetId: targetSheetId ?? undefined,
        sheetName: targetSheetName,
        bytesProcessed: queryResult.bytesProcessed,
        cacheHit: queryResult.cacheHit,
        jobId: queryResult.jobId,
        mutation: {
          cellsAffected: values.length * (columns.length || 1),
          sheetsModified: [targetSheetName],
        },
      });
    } catch (err) {
      logger.error('Failed to import from BigQuery', { err, req });
      return this.mapBigQueryError(err);
    }
  }

  // ============================================================================
  // Scheduled Queries (3 actions) — BigQuery Data Transfer Service API
  // ============================================================================

  /**
   * Create a scheduled query via BigQuery Data Transfer Service.
   * Uses REST API: POST /v1/projects/{projectId}/locations/{location}/transferConfigs
   */
  private async handleCreateScheduledQuery(
    req: Record<string, unknown>
  ): Promise<BigQueryResponse> {
    const projectId = req['projectId'] as string;
    const location = (req['location'] as string) ?? 'US';
    const query = req['query'] as string;
    const displayName = req['displayName'] as string;
    const schedule = req['schedule'] as string;
    const destinationDatasetId = req['destinationDatasetId'] as string | undefined;
    const destinationTableId = req['destinationTableId'] as string | undefined;
    const serviceAccountName = req['serviceAccountName'] as string | undefined;

    validateBigQuerySql(query);

    try {
      if (!this.context.googleClient) {
        return this.error({
          code: ErrorCodes.UNAUTHENTICATED,
          message: 'Google client not available - authentication required',
          retryable: false,
        });
      }
      const token = await this.getFreshAccessToken();
      if (!token) {
        return this.error({
          code: ErrorCodes.UNAUTHENTICATED,
          message: 'OAuth access token required for scheduled queries',
          retryable: false,
        });
      }

      const url = `https://bigquerydatatransfer.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/transferConfigs`;

      const body: Record<string, unknown> = {
        displayName,
        dataSourceId: 'scheduled_query',
        schedule,
        params: {
          query,
          ...(destinationTableId ? { destination_table_name_template: destinationTableId } : {}),
        },
        ...(destinationDatasetId ? { destinationDatasetId } : {}),
        ...(serviceAccountName ? { serviceAccountName } : {}),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('BigQuery Data Transfer API error', {
          action: 'create_scheduled_query',
          status: response.status,
          body: errorBody.substring(0, 200),
        });
        const safeCode:
          | 'PERMISSION_DENIED'
          | 'NOT_FOUND'
          | 'INVALID_PARAMS'
          | 'QUOTA_EXCEEDED'
          | 'INTERNAL_ERROR' =
          response.status === 403
            ? 'PERMISSION_DENIED'
            : response.status === 404
              ? 'NOT_FOUND'
              : response.status === 400
                ? 'INVALID_PARAMS'
                : response.status === 429
                  ? 'QUOTA_EXCEEDED'
                  : 'INTERNAL_ERROR';
        const safeMessage =
          response.status === 403
            ? 'Permission denied. Check BigQuery Data Transfer API is enabled and OAuth scopes include bigquery.'
            : response.status === 404
              ? 'Resource not found. Verify project, location, and transferConfigName.'
              : response.status === 400
                ? 'Invalid request. Check scheduled query configuration and parameters.'
                : response.status === 429
                  ? 'Rate limit exceeded. Please wait and retry.'
                  : `Scheduled query operation failed (HTTP ${response.status}). Check BigQuery console.`;
        return this.error({
          code: safeCode,
          message: safeMessage,
          retryable: response.status >= 500 || response.status === 429,
        });
      }

      const result = (await response.json()) as Record<string, unknown>;

      return this.success('create_scheduled_query', {
        transferConfigName: result['name'],
        displayName: result['displayName'],
        schedule: result['schedule'],
        state: result['state'],
        nextRunTime: result['nextRunTime'],
      });
    } catch (err) {
      logger.error('Failed to create scheduled query', { err, projectId });
      return this.mapBigQueryError(err);
    }
  }

  /**
   * List scheduled queries via BigQuery Data Transfer Service.
   */
  private async handleListScheduledQueries(
    req: Record<string, unknown>
  ): Promise<BigQueryResponse> {
    const projectId = req['projectId'] as string;
    const location = (req['location'] as string) ?? 'US';
    const maxResults = (req['maxResults'] as number) ?? 20;

    try {
      if (!this.context.googleClient) {
        return this.error({
          code: ErrorCodes.UNAUTHENTICATED,
          message: 'Google client not available - authentication required',
          retryable: false,
        });
      }
      const token = await this.getFreshAccessToken();
      if (!token) {
        return this.error({
          code: ErrorCodes.UNAUTHENTICATED,
          message: 'OAuth access token required for scheduled queries',
          retryable: false,
        });
      }

      const url = `https://bigquerydatatransfer.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/transferConfigs?dataSourceIds=scheduled_query&pageSize=${maxResults}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('BigQuery Data Transfer API error', {
          action: 'list_scheduled_queries',
          status: response.status,
          body: errorBody.substring(0, 200),
        });
        const safeCode:
          | 'PERMISSION_DENIED'
          | 'NOT_FOUND'
          | 'INVALID_PARAMS'
          | 'QUOTA_EXCEEDED'
          | 'INTERNAL_ERROR' =
          response.status === 403
            ? 'PERMISSION_DENIED'
            : response.status === 404
              ? 'NOT_FOUND'
              : response.status === 400
                ? 'INVALID_PARAMS'
                : response.status === 429
                  ? 'QUOTA_EXCEEDED'
                  : 'INTERNAL_ERROR';
        const safeMessage =
          response.status === 403
            ? 'Permission denied. Check BigQuery Data Transfer API is enabled and OAuth scopes include bigquery.'
            : response.status === 404
              ? 'Resource not found. Verify project, location, and transferConfigName.'
              : response.status === 400
                ? 'Invalid request. Check scheduled query configuration and parameters.'
                : response.status === 429
                  ? 'Rate limit exceeded. Please wait and retry.'
                  : `Scheduled query operation failed (HTTP ${response.status}). Check BigQuery console.`;
        return this.error({
          code: safeCode,
          message: safeMessage,
          retryable: response.status >= 500 || response.status === 429,
        });
      }

      const result = (await response.json()) as {
        transferConfigs?: unknown[];
        nextPageToken?: string;
      };

      return this.success('list_scheduled_queries', {
        scheduledQueries: result.transferConfigs ?? [],
        count: (result.transferConfigs ?? []).length,
        nextPageToken: result.nextPageToken,
      });
    } catch (err) {
      logger.error('Failed to list scheduled queries', { err, projectId });
      return this.mapBigQueryError(err);
    }
  }

  /**
   * Delete a scheduled query via BigQuery Data Transfer Service.
   */
  private async handleDeleteScheduledQuery(
    req: Record<string, unknown>
  ): Promise<BigQueryResponse> {
    const transferConfigName = req['transferConfigName'] as string;

    try {
      if (!this.context.googleClient) {
        return this.error({
          code: ErrorCodes.UNAUTHENTICATED,
          message: 'Google client not available - authentication required',
          retryable: false,
        });
      }
      const token = await this.getFreshAccessToken();
      if (!token) {
        return this.error({
          code: ErrorCodes.UNAUTHENTICATED,
          message: 'OAuth access token required for scheduled queries',
          retryable: false,
        });
      }

      // SEC-1: Validate GCP resource path format to prevent BOLA attacks
      const TRANSFER_CONFIG_PATTERN = /^projects\/[^/]+\/locations\/[^/]+\/transferConfigs\/[^/]+$/;
      if (!TRANSFER_CONFIG_PATTERN.test(transferConfigName)) {
        return this.error({
          code: ErrorCodes.INVALID_PARAMS,
          message:
            'transferConfigName must be in format: projects/{project}/locations/{location}/transferConfigs/{id}',
          retryable: false,
        });
      }
      // Use path directly (validated format); encodeURIComponent on full path breaks slash separators
      const url = `https://bigquerydatatransfer.googleapis.com/v1/${transferConfigName}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('BigQuery Data Transfer API error', {
          action: 'delete_scheduled_query',
          status: response.status,
          body: errorBody.substring(0, 200),
        });
        const safeCode:
          | 'PERMISSION_DENIED'
          | 'NOT_FOUND'
          | 'INVALID_PARAMS'
          | 'QUOTA_EXCEEDED'
          | 'INTERNAL_ERROR' =
          response.status === 403
            ? 'PERMISSION_DENIED'
            : response.status === 404
              ? 'NOT_FOUND'
              : response.status === 400
                ? 'INVALID_PARAMS'
                : response.status === 429
                  ? 'QUOTA_EXCEEDED'
                  : 'INTERNAL_ERROR';
        const safeMessage =
          response.status === 403
            ? 'Permission denied. Check BigQuery Data Transfer API is enabled and OAuth scopes include bigquery.'
            : response.status === 404
              ? 'Resource not found. Verify project, location, and transferConfigName.'
              : response.status === 400
                ? 'Invalid request. Check scheduled query configuration and parameters.'
                : response.status === 429
                  ? 'Rate limit exceeded. Please wait and retry.'
                  : `Scheduled query operation failed (HTTP ${response.status}). Check BigQuery console.`;
        return this.error({
          code: safeCode,
          message: safeMessage,
          retryable: response.status >= 500 || response.status === 429,
        });
      }

      return this.success('delete_scheduled_query', {
        deleted: true,
        transferConfigName,
      });
    } catch (err) {
      logger.error('Failed to delete scheduled query', { err, transferConfigName });
      return this.mapBigQueryError(err);
    }
  }

  /**
   * Get a fresh OAuth access token, refreshing if it expires within 60 seconds.
   * Falls back to the cached token if refresh fails.
   */
  private async getFreshAccessToken(): Promise<string | null> {
    const googleClient = this.context.googleClient;
    if (!googleClient) return null;

    const credentials = googleClient.oauth2.credentials;
    const expiryDate = credentials?.expiry_date as number | undefined;
    const isExpiringSoon = expiryDate !== undefined && expiryDate - Date.now() < 60_000;

    if (isExpiringSoon || !credentials?.access_token) {
      try {
        const result = await googleClient.oauth2.getAccessToken();
        return result?.token ?? credentials?.access_token ?? null;
      } catch {
        return credentials?.access_token ?? null;
      }
    }
    return credentials.access_token;
  }
}
