/**
 * ServalSheets - Apps Script Handler
 *
 * Handles sheets_appsscript tool (18 actions):
 * - create: Create new Apps Script project
 * - get: Get project metadata
 * - get_content: Get script files and code
 * - update_content: Update script files
 * - create_version: Create immutable version
 * - list_versions: List all versions
 * - get_version: Get specific version
 * - deploy: Create deployment (web app/API)
 * - list_deployments: List all deployments
 * - get_deployment: Get deployment details
 * - undeploy: Delete deployment
 * - run: Execute script function
 * - list_processes: Get execution logs
 * - get_metrics: Get usage metrics
 * - create_trigger: Create time/event trigger
 * - list_triggers: List all triggers
 * - delete_trigger: Delete a trigger
 * - update_trigger: Update trigger settings
 *
 * APIs Used:
 * - Google Apps Script API (script.googleapis.com)
 *
 * IMPORTANT: Does NOT work with service accounts - requires OAuth user auth
 *
 * MCP Protocol: 2025-11-25
 */

import { ErrorCodes } from './error-codes.js';
import { BaseHandler, type HandlerContext, unwrapRequest } from './base.js';
import { AuthenticationError, ServiceError } from '../core/errors.js';
import type { Intent } from '../core/intent.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { recordScriptId } from '../mcp/completions.js';
import { executeWithRetry } from '../utils/retry.js';
import { getRequestAbortSignal } from '../utils/request-context.js';
import { getApiSpecificCircuitBreakerConfig, getEnv } from '../config/env.js';
import { circuitBreakerRegistry } from '../services/circuit-breaker-registry.js';
import { randomBytes } from 'crypto';
import type {
  SheetsAppsScriptInput,
  SheetsAppsScriptOutput,
  AppsScriptResponse,
  AppsScriptRequest,
  AppsScriptCreateInput,
  AppsScriptGetInput,
  AppsScriptGetContentInput,
  AppsScriptUpdateContentInput,
  AppsScriptCreateVersionInput,
  AppsScriptListVersionsInput,
  AppsScriptGetVersionInput,
  AppsScriptDeployInput,
  AppsScriptListDeploymentsInput,
  AppsScriptGetDeploymentInput,
  AppsScriptUndeployInput,
  AppsScriptRunInput,
  AppsScriptListProcessesInput,
  AppsScriptGetMetricsInput,
  AppsScriptCreateTriggerInput,
  AppsScriptListTriggersInput,
  AppsScriptDeleteTriggerInput,
  AppsScriptUpdateTriggerInput,
  AppsScriptInstallServalFunctionInput,
} from '../schemas/index.js';
import { logger } from '../utils/logger.js';
import { sendProgress } from '../utils/request-context.js';

// Apps Script API base URL
const APPS_SCRIPT_API_BASE = 'https://script.googleapis.com/v1';

/**
 * Timeout constants per Google Apps Script API documentation
 * @see https://developers.google.com/apps-script/api/how-tos/execute
 *
 * Apps Script executions are limited to 6 minutes per run.
 * Keep the client timeout slightly above that documented limit so run() calls
 * are not cut off before Apps Script itself aborts the execution.
 */
const SCRIPT_RUN_TIMEOUT_MS = 420_000; // 7 minutes (6 min limit + 60 s buffer)
const SCRIPT_ADMIN_TIMEOUT_MS = 30_000; // 30 seconds (metadata operations)

export class SheetsAppsScriptHandler extends BaseHandler<
  SheetsAppsScriptInput,
  SheetsAppsScriptOutput
> {
  // ISSUE-203: Track concurrent run() executions below Google's simultaneous execution cap.
  // Static so the limit applies across all handler instances (one per MCP request)
  private static activeRunExecutions = 0;
  private static readonly MAX_CONCURRENT_RUNS = getEnv().APPSSCRIPT_MAX_CONCURRENT_RUNS;
  private static readonly BOUND_SCRIPT_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly boundScriptCache = new Map<
    string,
    { scriptId: string; cachedAt: number }
  >();

  private static rememberBoundScript(spreadsheetId: string, scriptId: string): void {
    SheetsAppsScriptHandler.boundScriptCache.set(spreadsheetId, {
      scriptId,
      cachedAt: Date.now(),
    });
  }

  private static getRememberedBoundScript(spreadsheetId: string): string | undefined {
    const cached = SheetsAppsScriptHandler.boundScriptCache.get(spreadsheetId);
    if (!cached) {
      return undefined;
    }

    if (Date.now() - cached.cachedAt > SheetsAppsScriptHandler.BOUND_SCRIPT_CACHE_TTL_MS) {
      SheetsAppsScriptHandler.boundScriptCache.delete(spreadsheetId);
      return undefined;
    }

    return cached.scriptId;
  }

  // ============================================================================
  // Shared API response interfaces (class-level to avoid inline duplication)
  // ============================================================================

  declare private _interfaces: {
    ProjectResponse: {
      scriptId: string;
      title: string;
      parentId?: string;
      createTime?: string;
      updateTime?: string;
      creator?: { email?: string; name?: string };
    };
    ContentResponse: {
      scriptId: string;
      files: Array<{
        name: string;
        type: 'SERVER_JS' | 'HTML' | 'JSON';
        source: string;
        lastModifyUser?: { email?: string; name?: string };
        createTime?: string;
        updateTime?: string;
      }>;
    };
    VersionResponse: {
      versionNumber: number;
      description?: string;
      createTime?: string;
    };
    DeploymentResponse: {
      deploymentId: string;
      deploymentConfig?: {
        description?: string;
        manifestFileName?: string;
        versionNumber?: number;
        scriptId?: string;
      };
      entryPoints?: Array<{
        entryPointType?: 'EXECUTION_API' | 'WEB_APP' | 'ADD_ON';
        webApp?: {
          url?: string;
          entryPointConfig?: {
            access?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
            executeAs?: 'USER_ACCESSING' | 'USER_DEPLOYING';
          };
        };
        executionApi?: {
          entryPointConfig?: {
            access?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
          };
        };
      }>;
      updateTime?: string;
    };
  };

  private circuitBreaker: CircuitBreaker;

  constructor(context: HandlerContext) {
    super('sheets_appsscript', context);

    // Initialize circuit breaker for Apps Script API
    // Lower failure threshold (3 vs 5) due to lower quotas
    const appsscriptConfig = getApiSpecificCircuitBreakerConfig('appsscript');
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: appsscriptConfig.failureThreshold,
      successThreshold: appsscriptConfig.successThreshold,
      timeout: appsscriptConfig.timeout,
      name: 'appsscript-api',
    });

    // Register fallback strategy for circuit breaker
    this.circuitBreaker.registerFallback({
      name: 'appsscript-unavailable-fallback',
      priority: 1,
      shouldUse: () => true,
      execute: async () => {
        throw new ServiceError(
          'Apps Script API temporarily unavailable due to repeated failures. Check quota limits and try again in 60 seconds.',
          'UNAVAILABLE',
          'appsscript-api',
          true,
          { circuitBreaker: 'appsscript-api', retryAfterSeconds: 60 }
        );
      },
    });

    // Register with global registry
    circuitBreakerRegistry.register(
      'appsscript-api',
      this.circuitBreaker,
      'Apps Script API circuit breaker'
    );
  }

  async handle(input: SheetsAppsScriptInput): Promise<SheetsAppsScriptOutput> {
    // 1. Unwrap request from wrapper
    const rawReq = unwrapRequest<SheetsAppsScriptInput['request']>(input);

    // 2. Require auth
    this.requireAuth();

    try {
      // 3. Dispatch to action handler
      const req = rawReq as AppsScriptRequest;
      let response: AppsScriptResponse;

      switch (req.action) {
        case 'create':
          response = await this.handleCreate(req as AppsScriptCreateInput);
          break;
        case 'get': {
          // FIX P1-1: Auto-resolve scriptId from spreadsheetId if needed
          const getReq = await this.ensureScriptId(req as AppsScriptGetInput);
          response = await this.handleGet(getReq);
          break;
        }
        case 'get_content': {
          // FIX P1-1: Auto-resolve scriptId from spreadsheetId if needed
          const getContentReq = await this.ensureScriptId(req as AppsScriptGetContentInput);
          response = await this.handleGetContent(getContentReq);
          break;
        }
        case 'update_content': {
          // FIX P1-1: Auto-resolve scriptId from spreadsheetId if needed
          const updateContentReq = await this.ensureScriptId(req as AppsScriptUpdateContentInput);
          response = await this.handleUpdateContent(updateContentReq);
          break;
        }
        case 'create_version':
          response = await this.handleCreateVersion(req as AppsScriptCreateVersionInput);
          break;
        case 'list_versions':
          response = await this.handleListVersions(req as AppsScriptListVersionsInput);
          break;
        case 'get_version':
          response = await this.handleGetVersion(req as AppsScriptGetVersionInput);
          break;
        case 'deploy':
          response = await this.handleDeploy(req as AppsScriptDeployInput);
          break;
        case 'list_deployments':
          response = await this.handleListDeployments(req as AppsScriptListDeploymentsInput);
          break;
        case 'get_deployment':
          response = await this.handleGetDeployment(req as AppsScriptGetDeploymentInput);
          break;
        case 'undeploy':
          response = await this.handleUndeploy(req as AppsScriptUndeployInput);
          break;
        case 'run':
          response = await this.handleRun(req as AppsScriptRunInput);
          break;
        case 'list_processes':
          response = await this.handleListProcesses(req as AppsScriptListProcessesInput);
          break;
        case 'get_metrics':
          response = await this.handleGetMetrics(req as AppsScriptGetMetricsInput);
          break;
        case 'create_trigger': {
          const createTriggerReq = await this.ensureScriptId(req as AppsScriptCreateTriggerInput);
          response = await this.handleCreateTrigger(createTriggerReq);
          break;
        }
        case 'list_triggers': {
          const listTriggersReq = await this.ensureScriptId(req as AppsScriptListTriggersInput);
          response = await this.handleListTriggers(listTriggersReq);
          break;
        }
        case 'delete_trigger': {
          const deleteTriggerReq = await this.ensureScriptId(req as AppsScriptDeleteTriggerInput);
          response = await this.handleDeleteTrigger(deleteTriggerReq);
          break;
        }
        case 'update_trigger': {
          const updateTriggerReq = await this.ensureScriptId(req as AppsScriptUpdateTriggerInput);
          response = await this.handleUpdateTrigger(updateTriggerReq);
          break;
        }
        case 'install_serval_function':
          response = await this.handleInstallServalFunction(
            req as AppsScriptInstallServalFunctionInput
          );
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

      // 4. Apply verbosity filtering if needed
      const verbosity = req.verbosity ?? 'standard';
      const filteredResponse = this.applyVerbosityFilter(response, verbosity);

      // 5. Return wrapped response
      return { response: filteredResponse };
    } catch (err) {
      return { response: this.mapError(err) };
    }
  }

  // Required by BaseHandler
  protected createIntents(_input: SheetsAppsScriptInput): Intent[] {
    return []; // Apps Script doesn't use batch operations
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Resolve scriptId from spreadsheetId via Drive API.
   * Looks for bound Apps Script projects (mimeType: application/vnd.google-apps.script)
   * that are children of the given spreadsheet.
   *
   * FIX P1-1: LLMs often only have the spreadsheetId, not the scriptId.
   * This method bridges the gap by querying the Drive API.
   */
  private async resolveScriptIdFromSpreadsheet(spreadsheetId: string): Promise<string> {
    const googleClient = this.context.googleClient;
    if (!googleClient) {
      throw new AuthenticationError(
        'No Google client available - authentication required',
        'AUTH_ERROR',
        false,
        { service: 'AppsScript' }
      );
    }

    logger.debug(`Resolving scriptId from spreadsheetId: ${spreadsheetId}`);
    await sendProgress(0, 1, `Resolving Apps Script project for spreadsheet ${spreadsheetId}...`);

    const cachedScriptId = SheetsAppsScriptHandler.getRememberedBoundScript(spreadsheetId);
    if (cachedScriptId) {
      logger.debug(`Resolved scriptId from in-memory cache: ${cachedScriptId}`);
      return cachedScriptId;
    }

    try {
      const drive = googleClient.drive;
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      const listBoundScripts = async () =>
        await drive.files.list({
          q: `'${spreadsheetId}' in parents and mimeType = 'application/vnd.google-apps.script' and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 5,
        });

      let files = (await listBoundScripts()).data.files;
      if (!files || files.length === 0) {
        const retryDelaysMs = [300, 700];
        for (const delayMs of retryDelaysMs) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          files = (await listBoundScripts()).data.files;
          if (files && files.length > 0) {
            break;
          }
        }
      }

      if (!files || files.length === 0) {
        throw new ServiceError(
          `No bound Apps Script project found for spreadsheet ${spreadsheetId}. ` +
            `The spreadsheet may not have a bound script. Use action "create" with parentId to create one.`,
          ErrorCodes.NOT_FOUND,
          'drive-api',
          false,
          {
            spreadsheetId,
            hint: 'Use sheets_appsscript action "create" with parentId set to the spreadsheetId',
          }
        );
      }

      const firstFile = files[0];
      const scriptId = firstFile?.id;
      if (!scriptId) {
        throw new ServiceError(
          `Drive API returned a file without an ID for spreadsheet ${spreadsheetId}`,
          ErrorCodes.INTERNAL_ERROR,
          'drive-api',
          true,
          { spreadsheetId }
        );
      }
      logger.info(
        `Resolved scriptId: ${scriptId} (from spreadsheet: ${spreadsheetId}, script name: ${firstFile?.name ?? 'unknown'})`
      );
      SheetsAppsScriptHandler.rememberBoundScript(spreadsheetId, scriptId);
      return scriptId;
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError(
        `Failed to resolve Apps Script project from spreadsheet: ${(err as Error).message}`,
        ErrorCodes.INTERNAL_ERROR,
        'drive-api',
        true,
        { spreadsheetId }
      );
    }
  }

  /**
   * Ensure scriptId is present on the request. If only spreadsheetId is provided,
   * auto-resolve scriptId via Drive API lookup.
   *
   * FIX P1-1: Allows callers to pass spreadsheetId instead of scriptId for
   * metadata, content, and trigger-management actions.
   */
  private async ensureScriptId<T extends { scriptId?: string; spreadsheetId?: string }>(
    req: T
  ): Promise<T & { scriptId: string }> {
    if (req.scriptId) {
      return req as T & { scriptId: string };
    }
    if (req.spreadsheetId) {
      const scriptId = await this.resolveScriptIdFromSpreadsheet(req.spreadsheetId);
      return { ...req, scriptId };
    }
    throw new ServiceError(
      'Either scriptId or spreadsheetId must be provided',
      ErrorCodes.INVALID_PARAMS,
      'appsscript',
      false,
      { hint: 'Provide scriptId (from script URL) or spreadsheetId (to auto-resolve bound script)' }
    );
  }

  /**
   * Make authenticated request to Apps Script API
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs: number = SCRIPT_ADMIN_TIMEOUT_MS
  ): Promise<T> {
    // Get access token from the Google client
    const googleClient = this.context.googleClient;
    if (!googleClient) {
      throw new AuthenticationError(
        'No Google client available - authentication required',
        'AUTH_ERROR',
        false,
        { service: 'AppsScript' }
      );
    }

    // Access token is available via the oauth2 credentials
    const credentials = googleClient.oauth2.credentials;
    const token = credentials.access_token;
    if (!token) {
      throw new AuthenticationError(
        'No access token available - authentication required',
        'AUTH_ERROR',
        true, // Retryable - user can re-authenticate
        { service: 'AppsScript' }
      );
    }

    const url = `${APPS_SCRIPT_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const requestBody =
      body && (method === 'POST' || method === 'PUT') ? JSON.stringify(body) : undefined;

    logger.debug(`Apps Script API ${method} ${path} (timeout: ${timeoutMs}ms)`);

    const RETRYABLE_NETWORK_CODES = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ENETUNREACH',
      'ECONNABORTED',
      'ERR_HTTP2_GOAWAY_SESSION',
      'ERR_HTTP2_SESSION_ERROR',
      'ERR_HTTP2_STREAM_CANCEL',
    ]);

    // Run retries inside the circuit breaker operation so transient 429/5xx retries
    // do not each count as separate breaker failures.
    return await this.circuitBreaker.execute(async () =>
      executeWithRetry(
        async (signal) => {
          // Merge retry signal + manual timeout signal + MCP cancellation signal (ISSUE-119)
          const fetchController = new AbortController();
          const requestAbortSignal = getRequestAbortSignal() ?? this.context.abortSignal;
          const timeoutId = setTimeout(() => fetchController.abort('request timeout'), timeoutMs);
          const cleanupFns: Array<() => void> = [];

          const forwardAbort = (source: AbortSignal | undefined, fallbackReason: string): void => {
            if (!source) {
              return;
            }

            const onAbort = (): void => {
              fetchController.abort(source.reason ?? fallbackReason);
            };
            if (source.aborted) {
              onAbort();
              return;
            }

            source.addEventListener('abort', onAbort, { once: true });
            cleanupFns.push(() => source.removeEventListener('abort', onAbort));
          };

          forwardAbort(signal, 'retry timeout');
          // ISSUE-119: Wire context abortSignal so client cancellation (notifications/cancelled)
          // terminates the long-running Apps Script HTTP request immediately.
          forwardAbort(requestAbortSignal, 'MCP request cancelled by client');

          try {
            const fetchOptions: RequestInit = {
              method,
              headers,
              body: requestBody,
              signal: fetchController.signal,
            };
            const response = await fetch(url, fetchOptions);
            return await this.handleApiResponse<T>(response, path);
          } catch (error) {
            // Handle timeout/abort
            if (error instanceof Error && error.name === 'AbortError') {
              throw new ServiceError(
                `Apps Script API request timed out after ${timeoutMs}ms`,
                'DEADLINE_EXCEEDED',
                'AppsScript',
                true,
                { method, path, timeoutMs }
              );
            }

            throw error;
          } finally {
            clearTimeout(timeoutId);
            cleanupFns.forEach((cleanup) => cleanup());
          }
        },
        {
          timeoutMs,
          retryable: (error) => {
            if (error instanceof ServiceError) {
              return error.retryable;
            }
            const code =
              typeof (error as { code?: unknown }).code === 'string'
                ? (error as { code: string }).code
                : '';
            return RETRYABLE_NETWORK_CODES.has(code);
          },
        }
      )
    );
  }

  private async handleApiResponse<T>(response: Response, path: string): Promise<T> {
    if (!response.ok) {
      // Handle 429 rate limiting before other error processing
      if (response.status === 429) {
        const retryAfter = response.headers?.get('retry-after');
        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
        throw new ServiceError(
          'Apps Script API rate limit exceeded. Try again later.',
          'UNAVAILABLE',
          'AppsScript',
          true,
          { statusCode: 429, path, retryAfterMs, code: ErrorCodes.RATE_LIMITED }
        );
      }

      const errorBody = await response.text();
      let errorMessage = `Apps Script API error: ${response.status} ${response.statusText}`;
      let errorCode:
        | 'UNAVAILABLE'
        | 'SERVICE_NOT_ENABLED'
        | 'PERMISSION_DENIED'
        | 'INVALID_PARAMS'
        | 'NOT_FOUND'
        | 'AUTH_ERROR' = 'UNAVAILABLE';
      let retryable = response.status >= 500; // Retryable for server errors
      let resolution: string | undefined;

      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {
        // Use default error message
      }

      // BUG FIX 0.9: Enhance error handling with prerequisite guidance
      if (response.status === 403) {
        // Forbidden - likely API not enabled or missing scopes
        if (errorMessage.includes('has not been used')) {
          // API not enabled
          errorCode = 'SERVICE_NOT_ENABLED';
          errorMessage = `Google Apps Script API is not enabled. ${errorMessage}`;
          resolution =
            'Enable the Apps Script API in your Google Cloud Console: ' +
            '1. Go to https://console.cloud.google.com/apis/library/script.googleapis.com ' +
            '2. Click "Enable" ' +
            '3. Wait a few minutes for the change to propagate ' +
            '4. Retry your request';
          retryable = false;
        } else if (
          errorMessage.includes('Insufficient Permission') ||
          errorMessage.includes('permission')
        ) {
          // Missing OAuth scopes
          errorCode = 'PERMISSION_DENIED';
          errorMessage = `Insufficient OAuth permissions for Apps Script API. ${errorMessage}`;
          resolution =
            'Required OAuth scopes: ' +
            'https://www.googleapis.com/auth/script.projects (manage projects), ' +
            'https://www.googleapis.com/auth/script.deployments (manage deployments), ' +
            'https://www.googleapis.com/auth/script.processes (view execution logs). ' +
            'Re-authenticate with sheets_auth to grant these scopes.';
          retryable = true; // User can re-authenticate
        }
      } else if (response.status === 400) {
        // Bad Request - invalid parameters
        errorCode = 'INVALID_PARAMS';
        retryable = false;
      } else if (response.status === 404) {
        // Not Found
        errorCode = 'NOT_FOUND';
        errorMessage = `Apps Script resource not found. ${errorMessage}`;
        retryable = false;
      } else if (response.status === 401) {
        // Unauthorized - token expired
        errorCode = 'AUTH_ERROR';
        errorMessage = `Authentication failed for Apps Script API. ${errorMessage}`;
        resolution = 'Re-authenticate using sheets_auth tool.';
        retryable = true;
      }

      throw new ServiceError(errorMessage, errorCode, 'AppsScript', retryable, {
        statusCode: response.status,
        path,
        resolution,
      });
    }

    // Handle empty responses (e.g., DELETE operations return no body)
    const text = await response.text();
    if (!text) {
      logger.debug('Empty response body - OK for DELETE/void operations');
      return {} as unknown as T; // OK: Explicit empty for void operations (DELETE returns no body)
    }

    return JSON.parse(text) as T;
  }

  // ============================================================================
  // Project Management Actions
  // ============================================================================

  private async handleCreate(req: AppsScriptCreateInput): Promise<AppsScriptResponse> {
    logger.info(`Creating Apps Script project: ${req.title}`);

    interface CreateProjectRequest {
      title: string;
      parentId?: string;
    }

    type ProjectResponse = (typeof this._interfaces)['ProjectResponse'];

    const body: CreateProjectRequest = {
      title: req.title,
    };

    if (req.parentId) {
      body.parentId = req.parentId;
    }

    const result = await this.apiRequest<ProjectResponse>('POST', '/projects', body);
    recordScriptId(result.scriptId);

    if (req.parentId) {
      SheetsAppsScriptHandler.rememberBoundScript(req.parentId, result.scriptId);
    }

    return this.success('create', {
      scriptId: result.scriptId,
      project: {
        scriptId: result.scriptId,
        title: result.title,
        parentId: result.parentId ?? undefined,
        createTime: result.createTime ?? undefined,
        updateTime: result.updateTime ?? undefined,
        creator: result.creator ?? undefined,
      },
    });
  }

  private async handleGet(req: AppsScriptGetInput): Promise<AppsScriptResponse> {
    logger.info(`Getting Apps Script project: ${req.scriptId}`);

    type ProjectResponse = (typeof this._interfaces)['ProjectResponse'];

    const result = await this.apiRequest<ProjectResponse>('GET', `/projects/${req.scriptId}`);
    recordScriptId(result.scriptId);

    return this.success('get', {
      scriptId: result.scriptId,
      project: {
        scriptId: result.scriptId,
        title: result.title,
        parentId: result.parentId ?? undefined,
        createTime: result.createTime ?? undefined,
        updateTime: result.updateTime ?? undefined,
        creator: result.creator ?? undefined,
      },
    });
  }

  private async handleGetContent(req: AppsScriptGetContentInput): Promise<AppsScriptResponse> {
    logger.info(`Getting Apps Script content: ${req.scriptId}`);

    type ContentResponse = (typeof this._interfaces)['ContentResponse'];

    let path = `/projects/${req.scriptId}/content`;
    if (req.versionNumber) {
      path += `?versionNumber=${req.versionNumber}`;
    }

    const result = await this.apiRequest<ContentResponse>('GET', path);

    return this.success('get_content', {
      scriptId: result.scriptId ?? req.scriptId,
      files: result.files.map((f) => ({
        name: f.name,
        type: f.type,
        source: f.source,
        lastModifyUser: f.lastModifyUser ?? undefined,
        createTime: f.createTime ?? undefined,
        updateTime: f.updateTime ?? undefined,
      })),
    });
  }

  private async handleUpdateContent(
    req: AppsScriptUpdateContentInput
  ): Promise<AppsScriptResponse> {
    logger.info(`Updating Apps Script content: ${req.scriptId}`);

    type ContentResponse = (typeof this._interfaces)['ContentResponse'];

    const body = {
      files: req.files.map((f) => ({
        name: f.name,
        type: f.type,
        source: f.source,
      })),
    };

    const result = await this.apiRequest<ContentResponse>(
      'PUT',
      `/projects/${req.scriptId}/content`,
      body
    );

    return this.success('update_content', {
      scriptId: result.scriptId ?? req.scriptId,
      files: result.files.map((f) => ({
        name: f.name,
        type: f.type,
        source: f.source,
        lastModifyUser: f.lastModifyUser ?? undefined,
        createTime: f.createTime ?? undefined,
        updateTime: f.updateTime ?? undefined,
      })),
    });
  }

  // ============================================================================
  // Version Management Actions
  // ============================================================================

  private async handleCreateVersion(
    req: AppsScriptCreateVersionInput
  ): Promise<AppsScriptResponse> {
    logger.info(`Creating version for: ${req.scriptId}`);

    type VersionResponse = (typeof this._interfaces)['VersionResponse'];

    const body: { description?: string } = {};
    if (req.description) {
      body.description = req.description;
    }

    const result = await this.apiRequest<VersionResponse>(
      'POST',
      `/projects/${req.scriptId}/versions`,
      body
    );

    return this.success('create_version', {
      version: {
        versionNumber: result.versionNumber,
        description: result.description ?? undefined,
        createTime: result.createTime ?? undefined,
      },
    });
  }

  private async handleListVersions(req: AppsScriptListVersionsInput): Promise<AppsScriptResponse> {
    logger.info(`Listing versions for: ${req.scriptId}`);

    interface ListVersionsResponse {
      versions?: Array<{
        versionNumber: number;
        description?: string;
        createTime?: string;
      }>;
      nextPageToken?: string;
    }

    let path = `/projects/${req.scriptId}/versions`;
    const params: string[] = [];
    if (req.pageSize) params.push(`pageSize=${req.pageSize}`);
    if (req.pageToken) params.push(`pageToken=${encodeURIComponent(req.pageToken)}`);
    if (params.length > 0) path += `?${params.join('&')}`;

    const result = await this.apiRequest<ListVersionsResponse>('GET', path);

    return this.success('list_versions', {
      versions: (result.versions ?? []).map((v) => ({
        versionNumber: v.versionNumber,
        description: v.description ?? undefined,
        createTime: v.createTime ?? undefined,
      })),
      nextPageToken: result.nextPageToken ?? undefined,
    });
  }

  private async handleGetVersion(req: AppsScriptGetVersionInput): Promise<AppsScriptResponse> {
    logger.info(`Getting version ${req.versionNumber} for: ${req.scriptId}`);

    type VersionResponse = (typeof this._interfaces)['VersionResponse'];

    const result = await this.apiRequest<VersionResponse>(
      'GET',
      `/projects/${req.scriptId}/versions/${req.versionNumber}`
    );

    return this.success('get_version', {
      version: {
        versionNumber: result.versionNumber,
        description: result.description ?? undefined,
        createTime: result.createTime ?? undefined,
      },
    });
  }

  // ============================================================================
  // Deployment Management Actions
  // ============================================================================

  private async handleDeploy(req: AppsScriptDeployInput): Promise<AppsScriptResponse> {
    logger.info(`Creating deployment for: ${req.scriptId}`);

    type DeploymentResponse = (typeof this._interfaces)['DeploymentResponse'];

    interface DeploymentCreateBody {
      description?: string;
      versionNumber?: number;
    }

    const deploymentBody: DeploymentCreateBody = {};

    if (req.description) {
      deploymentBody.description = req.description;
    }

    if (req.versionNumber) {
      deploymentBody.versionNumber = req.versionNumber;
    }

    if (!deploymentBody.versionNumber) {
      logger.warn(
        'Deploying Apps Script to HEAD version (volatile). Specify versionNumber for a stable, pinned deployment.',
        { scriptId: req.scriptId }
      );
    }

    // Apps Script create deployment expects a flat deployment resource body.
    // The nested deploymentConfig shape is used in API responses and update flows,
    // not in projects.deployments.create requests.
    // https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/create
    const result = await this.apiRequest<DeploymentResponse>(
      'POST',
      `/projects/${req.scriptId}/deployments`,
      deploymentBody
    );

    // Extract web app URL if available
    const webAppEntry = result.entryPoints?.find((e) => e.entryPointType === 'WEB_APP');
    const webAppUrl = webAppEntry?.webApp?.url;

    // Warn if ignored params were provided
    const ignoredParams: string[] = [];
    if ((req as { deploymentType?: string }).deploymentType) ignoredParams.push('deploymentType');
    if ((req as { access?: string }).access) ignoredParams.push('access');
    if ((req as { executeAs?: string }).executeAs) ignoredParams.push('executeAs');

    return this.success('deploy', {
      deployment: {
        deploymentId: result.deploymentId,
        versionNumber: result.deploymentConfig?.versionNumber ?? undefined,
        deploymentConfig: result.deploymentConfig ?? undefined,
        entryPoints: result.entryPoints ?? undefined,
        updateTime: result.updateTime ?? undefined,
      },
      webAppUrl: webAppUrl ?? undefined,
      ...(ignoredParams.length > 0 && {
        warning: `The following parameters are not supported by the Deployments API and were ignored: ${ignoredParams.join(', ')}. To configure these settings, update appsscript.json via the update_content action before deploying.`,
      }),
    });
  }

  private async handleListDeployments(
    req: AppsScriptListDeploymentsInput
  ): Promise<AppsScriptResponse> {
    logger.info(`Listing deployments for: ${req.scriptId}`);

    interface ListDeploymentsResponse {
      deployments?: Array<{
        deploymentId: string;
        deploymentConfig?: {
          description?: string;
          manifestFileName?: string;
          versionNumber?: number;
          scriptId?: string;
        };
        entryPoints?: Array<{
          entryPointType?: 'EXECUTION_API' | 'WEB_APP' | 'ADD_ON';
          webApp?: {
            url?: string;
            entryPointConfig?: {
              access?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
              executeAs?: 'USER_ACCESSING' | 'USER_DEPLOYING';
            };
          };
          executionApi?: {
            entryPointConfig?: {
              access?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
            };
          };
        }>;
        updateTime?: string;
      }>;
      nextPageToken?: string;
    }

    let path = `/projects/${req.scriptId}/deployments`;
    const params: string[] = [];
    if (req.pageSize) params.push(`pageSize=${req.pageSize}`);
    if (req.pageToken) params.push(`pageToken=${encodeURIComponent(req.pageToken)}`);
    if (params.length > 0) path += `?${params.join('&')}`;

    const result = await this.apiRequest<ListDeploymentsResponse>('GET', path);

    return this.success('list_deployments', {
      deployments: (result.deployments ?? []).map((d) => ({
        deploymentId: d.deploymentId,
        versionNumber: d.deploymentConfig?.versionNumber ?? undefined,
        deploymentConfig: d.deploymentConfig ?? undefined,
        entryPoints: d.entryPoints ?? undefined,
        updateTime: d.updateTime ?? undefined,
      })),
      nextPageToken: result.nextPageToken ?? undefined,
    });
  }

  private async handleGetDeployment(
    req: AppsScriptGetDeploymentInput
  ): Promise<AppsScriptResponse> {
    logger.info(`Getting deployment ${req.deploymentId} for: ${req.scriptId}`);

    type DeploymentResponse = (typeof this._interfaces)['DeploymentResponse'];

    const result = await this.apiRequest<DeploymentResponse>(
      'GET',
      `/projects/${req.scriptId}/deployments/${req.deploymentId}`
    );

    return this.success('get_deployment', {
      deployment: {
        deploymentId: result.deploymentId,
        versionNumber: result.deploymentConfig?.versionNumber ?? undefined,
        deploymentConfig: result.deploymentConfig ?? undefined,
        entryPoints: result.entryPoints ?? undefined,
        updateTime: result.updateTime ?? undefined,
      },
    });
  }

  private async handleUndeploy(req: AppsScriptUndeployInput): Promise<AppsScriptResponse> {
    logger.info(`Deleting deployment ${req.deploymentId} for: ${req.scriptId}`);

    await this.apiRequest<Record<string, never>>(
      'DELETE',
      `/projects/${req.scriptId}/deployments/${req.deploymentId}`
    );

    return this.success('undeploy', {});
  }

  // ============================================================================
  // Execution Actions
  // ============================================================================

  private async handleRun(req: AppsScriptRunInput): Promise<AppsScriptResponse> {
    if ((req as Record<string, unknown>)['files'] !== undefined) {
      return this.error({
        code: ErrorCodes.INVALID_PARAMS,
        message:
          'run does not accept files or source code. Call update_content first, then call run with scriptId + functionName.',
        retryable: false,
        suggestedFix:
          '1. Use sheets_appsscript action:"update_content" with { scriptId, files }. 2. Then call action:"run" with { scriptId, functionName, parameters? }.',
      });
    }

    const requestAbortSignal = getRequestAbortSignal() ?? this.context.abortSignal;
    // ISSUE-119: Check for pre-flight cancellation (client may have cancelled before we started)
    if (requestAbortSignal?.aborted) {
      return this.error({
        code: ErrorCodes.CANCELLED,
        message: 'Request cancelled by client.',
        retryable: false,
      });
    }

    // ISSUE-203: Enforce Apps Script concurrent execution limit (Google limit: 20/user)
    if (
      SheetsAppsScriptHandler.activeRunExecutions >= SheetsAppsScriptHandler.MAX_CONCURRENT_RUNS
    ) {
      return this.error({
        code: ErrorCodes.QUOTA_EXCEEDED,
        message:
          `Apps Script concurrent execution limit reached ` +
          `(${SheetsAppsScriptHandler.activeRunExecutions}/${SheetsAppsScriptHandler.MAX_CONCURRENT_RUNS} slots in use). ` +
          `Wait for current executions to complete before retrying.`,
        retryable: true,
        retryAfterMs: 30000,
      });
    }

    logger.info(`Running function ${req.functionName} in: ${req.scriptId}`);

    // Safety gate: dryRun returns early without executing
    const safety = (
      req as typeof req & { safety?: { dryRun?: boolean; requireConfirmation?: boolean } }
    ).safety;
    if (safety?.dryRun) {
      return this.success('run', {
        dryRun: true,
        message: `[DRY RUN] Would execute function '${req.functionName}' in script ${req.scriptId}. No changes made.`,
      });
    }

    if (!req.devMode && !req.deploymentId) {
      return this.error({
        code: ErrorCodes.FAILED_PRECONDITION,
        message:
          'run requires deploymentId unless devMode:true. Supported workflow: create -> update_content -> create_version -> deploy -> run with deploymentId.',
        retryable: false,
      });
    }

    // Safety gate: confirm by default before executing (script runs can have side effects)
    const confirmed = await this.confirmOperation(
      `Execute Apps Script function '${req.functionName}'`,
      `Script ID: ${req.scriptId}. This will run code with side effects.`,
      { isDestructive: true, operationType: 'apps_script_run' },
      { skipIfElicitationUnavailable: true }
    );
    if (!confirmed) {
      return this.error({
        code: ErrorCodes.OPERATION_CANCELLED,
        message: 'Execution cancelled by user.',
        retryable: false,
      });
    }

    await sendProgress(0, 2, `Executing Apps Script function '${req.functionName}'...`);

    // Pre-flight token check: Refresh if expiring within 360 seconds (6 minutes)
    // This prevents mid-execution auth failures for long-running scripts
    const googleClient = this.context.googleClient;
    if (googleClient) {
      const tokenStatus = googleClient.getTokenStatus();
      if (tokenStatus.expiryDate) {
        const now = Date.now();
        const secondsRemaining = Math.floor((tokenStatus.expiryDate - now) / 1000);

        if (secondsRemaining < 360) {
          logger.info('Pre-refreshing token before long-running script', {
            secondsRemaining,
            scriptId: req.scriptId,
            functionName: req.functionName,
          });

          // Force token refresh by calling getAccessToken()
          try {
            await googleClient.oauth2.getAccessToken();
            logger.info('Token pre-refresh successful', { scriptId: req.scriptId });
          } catch (error) {
            logger.warn('Token pre-refresh failed', { error, scriptId: req.scriptId });
            // Continue anyway - the refresh might happen during the request
          }
        }
      }
    }

    interface RunRequest {
      function: string;
      parameters?: unknown[];
      devMode?: boolean;
    }

    interface RunResponse {
      done?: boolean;
      response?: {
        '@type'?: string;
        result?: unknown;
      };
      error?: {
        message?: string;
        code?: number;
        details?: Array<{
          '@type'?: string;
          errorMessage?: string;
          errorType?: string;
          scriptStackTraceElements?: Array<{
            function?: string;
            lineNumber?: number;
          }>;
        }>;
      };
    }

    // ISSUE-203: Claim a concurrency slot — released in finally block
    SheetsAppsScriptHandler.activeRunExecutions++;

    const body: RunRequest = {
      function: req.functionName,
    };

    if (req.parameters) {
      body.parameters = req.parameters;
    }

    if (req.devMode) {
      body.devMode = req.devMode;
    }

    const runTarget = req.devMode ? req.scriptId : req.deploymentId!;

    // Use 380s timeout for script execution (6 min max + overhead)
    let result: RunResponse;
    try {
      result = await this.apiRequest<RunResponse>(
        'POST',
        `/scripts/${runTarget}:run`,
        body,
        SCRIPT_RUN_TIMEOUT_MS
      );
    } catch (error) {
      // Retry once on 401 auth error (token may have expired during execution)
      if (
        error instanceof ServiceError &&
        error.code === 'AUTH_ERROR' &&
        error.message.includes('Authentication')
      ) {
        logger.warn('Auth error during script execution, refreshing token and retrying', {
          scriptId: req.scriptId,
          functionName: req.functionName,
        });

        // Force token refresh
        if (googleClient) {
          try {
            await googleClient.oauth2.getAccessToken();
            logger.info('Mid-execution token refresh successful, retrying script', {
              scriptId: req.scriptId,
            });

            // Retry the request with fresh token
            result = await this.apiRequest<RunResponse>(
              'POST',
              `/scripts/${runTarget}:run`,
              body,
              SCRIPT_RUN_TIMEOUT_MS
            );
          } catch (retryError) {
            logger.error('Retry after token refresh failed', {
              retryError,
              scriptId: req.scriptId,
            });
            throw error; // Throw original error
          }
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Check for execution error — decrement slot before returning (ISSUE-203)
    if (result.error) {
      const scriptError = result.error.details?.find((d) => d['@type']?.includes('ScriptError'));
      SheetsAppsScriptHandler.activeRunExecutions--;

      const rawMessage = scriptError?.errorMessage ?? result.error.message ?? 'Unknown error';

      // ISSUE-205: Detect BigQuery Advanced Service not enabled and return actionable error.
      // Apps Script throws "BigQuery is not defined" (ReferenceError) when the BigQuery
      // Advanced Service is not enabled in the Apps Script project settings.
      const isBigQueryServiceMissing =
        /BigQuery\s+is\s+not\s+defined/i.test(rawMessage) ||
        (/BigQuery/i.test(rawMessage) && /not defined|undefined|ReferenceError/i.test(rawMessage));

      const errorMessage = isBigQueryServiceMissing
        ? `${rawMessage}\n\nThe BigQuery Advanced Service is not enabled for this script. ` +
          `To fix: open the script in Apps Script Editor → Services (+) → Add "BigQuery API". ` +
          `Then retry your function call.`
        : rawMessage;

      return this.success('run', {
        executionError: {
          errorMessage,
          errorType: scriptError?.errorType ?? undefined,
          scriptStackTraceElements: scriptError?.scriptStackTraceElements ?? undefined,
        },
      });
    }

    await sendProgress(2, 2, `Function '${req.functionName}' completed`);

    // ISSUE-203: Always release the concurrency slot when execution completes
    SheetsAppsScriptHandler.activeRunExecutions--;

    // Record operation in session context for LLM follow-up references
    try {
      if (this.context.sessionContext) {
        this.context.sessionContext.recordOperation({
          tool: 'sheets_appsscript',
          action: 'run',
          spreadsheetId: req.scriptId,
          description: `Ran Apps Script function '${req.functionName}' in script ${req.scriptId}`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    // result.response?.result is typed as `unknown` from the RunResponse interface.
    // The schema accepts string | number | boolean | null | array | object.
    // The Apps Script API always returns one of these types at runtime.
    return this.success('run', {
      result: result.response?.result as
        | string
        | number
        | boolean
        | null
        | unknown[]
        | Record<string, unknown>
        | undefined,
    });
  }

  private async handleListProcesses(
    req: AppsScriptListProcessesInput
  ): Promise<AppsScriptResponse> {
    logger.info(`Listing processes${req.scriptId ? ` for: ${req.scriptId}` : ''}`);

    interface ListProcessesResponse {
      processes?: Array<{
        processId?: string;
        projectName?: string;
        functionName?: string;
        processType?: string;
        processStatus?: string;
        startTime?: string;
        duration?: string;
        userAccessLevel?: string;
      }>;
      nextPageToken?: string;
    }

    // BUG-5 fix: Use project-scoped endpoint when scriptId is provided.
    // Google Apps Script API v1:
    //   - projects/{scriptId}/processes (lists processes for a specific project)
    //   - processes (lists all user processes — no scriptId filter)
    // The `scriptProcessFilter.*` query params are only valid on the project endpoint.
    const params: string[] = [];
    if (req.functionName) {
      params.push(`scriptProcessFilter.functionName=${encodeURIComponent(req.functionName)}`);
    }
    if (req.processType) {
      params.push(`scriptProcessFilter.types=${encodeURIComponent(req.processType)}`);
    }
    if (req.processStatus) {
      params.push(`scriptProcessFilter.statuses=${encodeURIComponent(req.processStatus)}`);
    }
    if (req.pageSize) {
      params.push(`pageSize=${req.pageSize}`);
    }
    if (req.pageToken) {
      params.push(`pageToken=${encodeURIComponent(req.pageToken)}`);
    }

    // Use project-scoped endpoint when scriptId is available
    let path = req.scriptId
      ? `/projects/${encodeURIComponent(req.scriptId)}/processes`
      : '/processes';
    if (params.length > 0) path += `?${params.join('&')}`;

    const result = await this.apiRequest<ListProcessesResponse>('GET', path);

    return this.success('list_processes', {
      processes: (result.processes ?? []).map((p) => ({
        processId: p.processId ?? undefined,
        projectName: p.projectName ?? undefined,
        functionName: p.functionName ?? undefined,
        processType: (p.processType ?? undefined) as
          | 'EDITOR'
          | 'SIMPLE_TRIGGER'
          | 'TRIGGER'
          | 'WEBAPP'
          | 'EXECUTION_API'
          | 'ADD_ON'
          | 'TIME_DRIVEN'
          | 'MENU'
          | 'BATCH_TASK'
          | undefined,
        processStatus: (p.processStatus ?? undefined) as
          | 'COMPLETED'
          | 'FAILED'
          | 'RUNNING'
          | 'CANCELED'
          | 'TIMED_OUT'
          | 'UNKNOWN'
          | 'DELAYED'
          | 'PAUSED'
          | undefined,
        startTime: p.startTime ?? undefined,
        duration: p.duration ?? undefined,
        userAccessLevel: (p.userAccessLevel ?? undefined) as
          | 'OWNER'
          | 'READ'
          | 'WRITE'
          | 'NONE'
          | undefined,
      })),
      nextPageToken: result.nextPageToken ?? undefined,
    });
  }

  private async handleGetMetrics(req: AppsScriptGetMetricsInput): Promise<AppsScriptResponse> {
    logger.info(`Getting metrics for: ${req.scriptId}`);

    interface MetricsResponse {
      activeUsers?: Array<{ value?: string }>;
      totalExecutions?: Array<{ value?: string }>;
      failedExecutions?: Array<{ value?: string }>;
    }

    let path = `/projects/${req.scriptId}/metrics`;
    const params: string[] = [];
    if (req.granularity) {
      params.push(`metricsGranularity=${req.granularity}`);
    }
    if (req.deploymentId) {
      params.push(`metricsFilter.deploymentId=${encodeURIComponent(req.deploymentId)}`);
    }
    if (params.length > 0) path += `?${params.join('&')}`;

    const result = await this.apiRequest<MetricsResponse>('GET', path);

    return this.success('get_metrics', {
      metrics: {
        activeUsers: result.activeUsers ?? undefined,
        totalExecutions: result.totalExecutions ?? undefined,
        failedExecutions: result.failedExecutions ?? undefined,
      },
    });
  }

  // ============================================================================
  // Trigger Management (4 actions)
  // ============================================================================

  /**
   * Create a time-driven or event-driven trigger.
   * Uses the Apps Script API triggers endpoint.
   */
  private async handleCreateTrigger(
    _req: AppsScriptCreateTriggerInput
  ): Promise<AppsScriptResponse> {
    return this.error({
      code: ErrorCodes.NOT_IMPLEMENTED,
      message:
        'Trigger management requires in-script ScriptApp.newTrigger(). ' +
        'The Apps Script API projects.triggers endpoint is not available for external clients. ' +
        'Use update_content to add trigger code to your script, then deploy it.',
      retryable: false,
    });
  }

  /**
   * List all triggers for a script project.
   */
  private async handleListTriggers(_req: AppsScriptListTriggersInput): Promise<AppsScriptResponse> {
    return this.error({
      code: ErrorCodes.NOT_IMPLEMENTED,
      message:
        'Trigger management requires in-script ScriptApp APIs. ' +
        'The Apps Script API projects.triggers endpoint is not available for external clients. ' +
        'Use get_content to inspect trigger setup code in the script project.',
      retryable: false,
    });
  }

  /**
   * Delete a specific trigger by ID.
   */
  private async handleDeleteTrigger(
    _req: AppsScriptDeleteTriggerInput
  ): Promise<AppsScriptResponse> {
    return this.error({
      code: ErrorCodes.NOT_IMPLEMENTED,
      message:
        'Trigger management requires in-script ScriptApp APIs. ' +
        'The Apps Script API projects.triggers endpoint is not available for external clients. ' +
        'Use update_content to modify trigger code in the script project.',
      retryable: false,
    });
  }

  /**
   * Update a trigger by deleting and recreating it.
   * Apps Script API doesn't support PATCH on triggers, so we delete + create.
   */
  private async handleUpdateTrigger(
    _req: AppsScriptUpdateTriggerInput
  ): Promise<AppsScriptResponse> {
    return this.error({
      code: ErrorCodes.NOT_IMPLEMENTED,
      message:
        'Trigger management requires in-script ScriptApp APIs. ' +
        'The Apps Script API projects.triggers endpoint is not available for external clients. ' +
        'Use update_content to modify trigger code in the script project.',
      retryable: false,
    });
  }

  // ============================================================================
  // SERVAL() Formula Installer (Phase 5)
  // ============================================================================

  /**
   * Install the SERVAL() formula function into a spreadsheet via a bound Apps Script project.
   * Generates an HMAC secret, builds the Apps Script source, creates a bound project,
   * and pushes the function code.
   */
  private async handleInstallServalFunction(
    req: AppsScriptInstallServalFunctionInput
  ): Promise<AppsScriptResponse> {
    logger.info('Installing SERVAL() function', { spreadsheetId: req.spreadsheetId });

    const hmacSecret = randomBytes(32).toString('hex');
    const defaultModel = req.defaultModel ?? 'claude-sonnet-4-6';
    const callbackBaseUrlRaw =
      req.callbackUrl ?? process.env['SERVAL_CALLBACK_URL'] ?? process.env['SERVALSHEETS_BASE_URL'];
    if (!callbackBaseUrlRaw) {
      return this.error({
        code: ErrorCodes.CONFIG_ERROR,
        message:
          'SERVAL callback URL is required. Provide request.callbackUrl or set SERVAL_CALLBACK_URL.',
        retryable: false,
      });
    }
    const callbackUrl = callbackBaseUrlRaw.replace(/\/+$/, '');

    // SECURITY: Validate callbackUrl is a legitimate HTTPS URL before embedding in Apps Script source.
    // A malicious URL containing single-quotes could inject arbitrary JavaScript into the script.
    try {
      const parsedUrl = new URL(callbackUrl);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return this.error({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'callbackUrl must use https:// or http:// protocol',
          retryable: false,
        });
      }
      // Prevent quote injection: URL must not contain single quotes or backticks
      if (callbackUrl.includes("'") || callbackUrl.includes('`') || callbackUrl.includes('\\')) {
        return this.error({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'callbackUrl contains invalid characters',
          retryable: false,
        });
      }
    } catch {
      return this.error({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'callbackUrl is not a valid URL',
        retryable: false,
      });
    }

    // Build the Apps Script source.
    // SECURITY: The HMAC secret is NEVER embedded in the script source — it is registered
    // server-side only (via registerSpreadsheetSecret below). The script reads the secret
    // exclusively from ScriptProperties, which must be set via the Apps Script IDE or the
    // serval_setup() helper function pushed alongside this script.
    const scriptSource = `
function SERVAL(prompt, range, model) {
  var CALLBACK_URL = '${callbackUrl}/api/serval-formula';
  var HMAC_SECRET = PropertiesService.getScriptProperties().getProperty('SERVAL_HMAC_SECRET');
  if (!HMAC_SECRET) {
    return '#NOT_INITIALIZED: Run serval_setup() in the Apps Script IDE to complete installation.';
  }
  var spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var rangeValues = range ? (Array.isArray(range) ? range : [[range]]) : null;
  var body = JSON.stringify({
    requests: [{ prompt: String(prompt), range_values: rangeValues, model: model || '${defaultModel}' }],
    spreadsheetId: spreadsheetId,
    timestamp: Date.now()
  });
  var sig = Utilities.computeHmacSha256Signature(body, HMAC_SECRET);
  var sigHex = sig.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var response = UrlFetchApp.fetch(CALLBACK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Serval-Signature': sigHex, 'X-Serval-SpreadsheetId': spreadsheetId },
    payload: body,
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return '#ERROR!';
  var result = JSON.parse(response.getContentText());
  return result.results && result.results[0] ? (result.results[0].text || result.results[0].values || '#NODATA') : '#NODATA';
}

/**
 * Run this function once from the Apps Script IDE to complete installation.
 * Paste the hmacSecret value from the install_serval_function response when prompted.
 */
function serval_setup() {
  var secret = Browser.inputBox('SERVAL Setup', 'Paste the SERVAL HMAC secret from the installation response:', Browser.Buttons.OK_CANCEL);
  if (secret && secret !== 'cancel') {
    PropertiesService.getScriptProperties().setProperty('SERVAL_HMAC_SECRET', secret);
    Browser.msgBox('SERVAL setup complete. The SERVAL() formula is ready to use.');
  }
}
`.trim();

    // Create bound Apps Script project
    interface CreateProjectResponse {
      scriptId: string;
      title: string;
      parentId?: string;
      createTime?: string;
      updateTime?: string;
    }

    const project = await this.apiRequest<CreateProjectResponse>('POST', '/projects', {
      title: 'SERVAL Formula Functions',
      parentId: req.spreadsheetId,
    });

    const scriptId = project.scriptId;

    // Push the SERVAL function source
    interface UpdateContentResponse {
      files: Array<{ name: string; type: string; source: string }>;
    }

    await this.apiRequest<UpdateContentResponse>('PUT', `/projects/${scriptId}/content`, {
      files: [
        {
          name: 'SERVAL',
          type: 'SERVER_JS',
          source: scriptSource,
        },
      ],
    });

    // Register the HMAC secret server-side only — never embedded in script source
    try {
      const { registerSpreadsheetSecret } = await import('../services/formula-callback.js');
      registerSpreadsheetSecret(
        req.spreadsheetId,
        hmacSecret,
        req.rateLimit ?? { requestsPerMinute: 100 },
        req.cacheTtlSeconds ?? 300
      );
    } catch {
      // Non-blocking — secret registration is best-effort at install time
      logger.warn('Could not register SERVAL HMAC secret in formula-callback service', {
        spreadsheetId: req.spreadsheetId,
      });
    }

    const installedAt = new Date().toISOString();
    logger.info('SERVAL() function installed', { scriptId, spreadsheetId: req.spreadsheetId });

    return this.success('install_serval_function', {
      scriptId,
      functionName: 'SERVAL',
      callbackUrl: `${callbackUrl}/api/serval-formula`,
      // hmacSecret returned to caller so they can complete setup via serval_setup() in IDE
      // SECURITY: this value is shown once — store it securely
      hmacSecret,
      setupInstructions:
        'Open the Apps Script IDE for this spreadsheet, run serval_setup(), and paste this hmacSecret when prompted.',
      installedAt,
      project: {
        scriptId,
        title: 'SERVAL Formula Functions',
        parentId: req.spreadsheetId,
        createTime: project.createTime ?? installedAt,
        updateTime: project.updateTime ?? installedAt,
      },
    });
  }
}
