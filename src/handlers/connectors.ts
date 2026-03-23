/**
 * ServalSheets - Connectors Handler
 *
 * Handles all sheets_connectors actions by delegating to ConnectorManager.
 * Standalone handler pattern (not BaseHandler) since connectors are
 * independent of Google Sheets API.
 *
 * Actions (10):
 * - list_connectors, configure, query, batch_query, subscribe,
 *   unsubscribe, list_subscriptions, transform, status, discover
 *
 * P5.3: Added AI-powered connector discovery via MCP Sampling
 */

import { ErrorCodes } from './error-codes.js';
import { logger } from '../utils/logger.js';
import { recordConnectorId } from '../mcp/completions.js';
import { connectorManager } from '../resources/connectors-runtime.js';
import type { SheetsConnectorsInput, SheetsConnectorsOutput } from '../schemas/connectors.js';
import type { SamplingServer } from '../mcp/sampling.js';
import { generateAIInsight } from '../mcp/sampling.js';
import type { ConnectorCredentials } from '../connectors/types.js';
import type { ElicitationServer } from '../mcp/elicitation.js';
import { generateElicitationId, safeElicit, selectField } from '../mcp/elicitation.js';
import { startApiKeyServer, startOAuthCredentialsServer } from '../utils/api-key-server.js';
import { extractRangeA1 } from '../utils/range-helpers.js';

type ConnectorCatalogEntry = ReturnType<
  typeof connectorManager.listConnectors
>['connectors'][number];

interface ConnectorUxMetadata {
  signupUrl?: string;
  hint?: string;
  recommendedUseCases: string[];
  exampleQuery?: {
    endpoint: string;
    params?: Record<string, string | number | boolean>;
  };
}

const CONNECTOR_SETUP_HINTS: Record<string, ConnectorUxMetadata> = {
  finnhub: {
    signupUrl: 'https://finnhub.io/register',
    hint: 'Free tier: stocks, earnings, and market news',
    recommendedUseCases: ['Stock quotes', 'Earnings calendars', 'Market news'],
    exampleQuery: {
      endpoint: 'stock/quote',
      params: { symbol: 'AAPL' },
    },
  },
  fred: {
    signupUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html',
    hint: 'Free economic indicators, interest rates, and macro data',
    recommendedUseCases: ['Macro time series', 'Rates and inflation', 'Economic releases'],
    exampleQuery: {
      endpoint: 'series/observations',
      params: { series_id: 'FEDFUNDS' },
    },
  },
  alpha_vantage: {
    signupUrl: 'https://www.alphavantage.co/support/#api-key',
    hint: 'Free tier: stocks, forex, and crypto data',
    recommendedUseCases: ['Daily market data', 'FX and crypto', 'Technical indicators'],
  },
  polygon: {
    signupUrl: 'https://polygon.io/dashboard/signup',
    hint: 'Real-time and historical market data',
    recommendedUseCases: ['Market snapshots', 'Aggregated bars', 'Reference data'],
  },
  fmp: {
    signupUrl: 'https://financialmodelingprep.com/developer/docs',
    hint: 'Fundamentals, statements, and company metrics',
    recommendedUseCases: ['Company fundamentals', 'Financial statements', 'Quotes'],
    exampleQuery: {
      endpoint: 'quote',
      params: { symbol: 'AAPL' },
    },
  },
};

// ============================================================================
// Handler
// ============================================================================

export interface ConnectorsHandlerOptions {
  samplingServer?: SamplingServer;
  sessionContext?: import('../services/session-context.js').SessionContextManager;
  elicitationServer?: ElicitationServer;
}

export class ConnectorsHandler {
  private samplingServer?: SamplingServer;
  private sessionContext?: import('../services/session-context.js').SessionContextManager;
  private elicitationServer?: ElicitationServer;

  constructor(options?: ConnectorsHandlerOptions) {
    this.samplingServer = options?.samplingServer;
    this.sessionContext = options?.sessionContext;
    this.elicitationServer = options?.elicitationServer;
  }

  private createMeta(options: {
    nextBestAction: string;
    verificationSummary: string;
    nextSteps?: string[];
  }) {
    return {
      journeyStage: 'connector_setup' as const,
      nextBestAction: options.nextBestAction,
      verificationSummary: options.verificationSummary,
      ...(options.nextSteps ? { nextSteps: options.nextSteps } : {}),
    };
  }

  private getConnectorUx(connectorId: string): ConnectorUxMetadata {
    return (
      CONNECTOR_SETUP_HINTS[connectorId] ?? {
        recommendedUseCases: ['Live external data import'],
      }
    );
  }

  private enrichConnector(connector: ConnectorCatalogEntry) {
    const ux = this.getConnectorUx(connector.id);
    return {
      ...connector,
      ...(ux.signupUrl ? { signupUrl: ux.signupUrl } : {}),
      recommendedUseCases: ux.recommendedUseCases,
      nextStep: connector.configured
        ? `Run sheets_connectors action "status" with connectorId "${connector.id}" or make a first query.`
        : `Run sheets_connectors action "configure" with connectorId "${connector.id}".`,
    };
  }

  async handle(input: SheetsConnectorsInput): Promise<SheetsConnectorsOutput> {
    const { request } = input;
    const { action } = request;

    try {
      switch (action) {
        case 'list_connectors':
          return this.handleListConnectors();

        case 'configure':
          return this.handleConfigure(request);

        case 'query':
          return this.handleQuery(request);

        case 'batch_query':
          return this.handleBatchQuery(request);

        case 'subscribe':
          return this.handleSubscribe(request);

        case 'unsubscribe':
          return this.handleUnsubscribe(request);

        case 'list_subscriptions':
          return this.handleListSubscriptions();

        case 'transform':
          return this.handleTransform(request);

        case 'status':
          return this.handleStatus(request);

        case 'discover':
          return this.handleDiscover(request);

        default: {
          const _exhaustive: never = action;
          return {
            response: {
              success: false,
              action: String(_exhaustive),
              error: {
                code: ErrorCodes.INVALID_PARAMS,
                message: `Unknown action: ${String(_exhaustive)}`,
                retryable: false,
              },
            },
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Connector handler error', { action, error: message });
      return {
        response: {
          success: false,
          action,
          error: { code: ErrorCodes.INTERNAL_ERROR, message, retryable: false },
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  private makeErrorResponse(
    action: SheetsConnectorsInput['request']['action'],
    code: (typeof ErrorCodes)[keyof typeof ErrorCodes],
    message: string,
    suggestedFix?: string,
    nextBestAction?: string
  ): SheetsConnectorsOutput {
    return {
      response: {
        success: false,
        action,
        error: {
          code,
          message,
          retryable: false,
          ...(suggestedFix ? { suggestedFix } : {}),
        },
        ...(nextBestAction
          ? {
              _meta: this.createMeta({
                nextBestAction,
                verificationSummary:
                  'Connector setup could not proceed because required input was missing.',
                nextSteps: suggestedFix ? [suggestedFix] : undefined,
              }),
            }
          : {}),
      },
    };
  }

  private getConnectorCatalog(): ConnectorCatalogEntry[] {
    return connectorManager.listConnectors().connectors;
  }

  private getConnectorEntry(connectorId: string | undefined): ConnectorCatalogEntry | undefined {
    if (!connectorId) {
      return undefined;
    }

    return this.getConnectorCatalog().find((connector) => connector.id === connectorId);
  }

  private async elicitConnectorSelection(): Promise<string | null> {
    if (!this.elicitationServer) {
      return null;
    }

    const connectors = this.getConnectorCatalog();

    try {
      const result = await safeElicit<{ connectorId: string } | null>(
        this.elicitationServer,
        {
          mode: 'form',
          message:
            'Choose the connector you want to configure. ServalSheets will then ask only for the auth fields that connector requires.',
          requestedSchema: {
            type: 'object',
            properties: {
              connectorId: selectField({
                title: 'Connector',
                description: 'Available built-in connectors',
                options: connectors.map((connector) => ({
                  value: connector.id,
                  label: `${connector.name} — ${connector.description}`,
                })),
              }),
            },
            required: ['connectorId'],
          },
        },
        null
      );

      if (typeof result?.connectorId === 'string' && result.connectorId.trim()) {
        return result.connectorId.trim();
      }
    } catch {
      // Elicitation unsupported or unavailable — fall through to manual error response
    }

    return null;
  }

  private async elicitApiKey(connector: ConnectorCatalogEntry): Promise<string | null> {
    if (!this.elicitationServer) {
      return null;
    }

    const setupHint = CONNECTOR_SETUP_HINTS[connector.id];
    const supportsUrl = !!this.elicitationServer.getClientCapabilities()?.elicitation?.url;

    if (supportsUrl) {
      let shutdown: (() => void) | undefined;

      try {
        const handle = await startApiKeyServer({
          provider: connector.name,
          signupUrl: setupHint?.signupUrl ?? 'https://example.com',
          hint: setupHint?.hint ?? 'Paste your API key',
        });
        shutdown = handle.shutdown;

        const elicitationId = generateElicitationId('connector_key');
        const result = await this.elicitationServer.elicitInput({
          mode: 'url',
          message:
            `Open the local ${connector.name} setup page to paste your API key. ` +
            'The key is stored locally and does not need to travel in the MCP request payload.',
          elicitationId,
          url: handle.url,
        });

        if (result.action !== 'accept') {
          shutdown();
          return null;
        }

        const apiKey = (await handle.keyPromise).trim();
        if (!apiKey) {
          return null;
        }

        if (this.elicitationServer.createElicitationCompletionNotifier) {
          const notify = this.elicitationServer.createElicitationCompletionNotifier(elicitationId);
          try {
            await notify();
          } catch (notifyErr) {
            logger.warn('API key elicitation completion notification failed (non-fatal)', {
              error: notifyErr,
            });
          }
        }

        return apiKey;
      } catch {
        shutdown?.();
      }
    }

    // MCP 2025-11-25 MUST NOT: never collect API keys via form mode (key would transit MCP payload).
    // URL mode is the only secure path — if unavailable, caller will ask user to provide key directly.
    return null; // OK: Explicit empty — no secure fallback when URL elicitation unavailable
  }

  private async elicitOAuthCredentials(
    connector: ConnectorCatalogEntry
  ): Promise<ConnectorCredentials['oauth'] | null> {
    if (!this.elicitationServer) {
      return null;
    }

    // MCP 2025-11-25 MUST NOT: never collect clientSecret via form mode (transits MCP payload).
    // Use URL mode — credentials are submitted directly to localhost and never leave the machine.
    const supportsUrl = !!this.elicitationServer.getClientCapabilities()?.elicitation?.url;
    if (!supportsUrl) {
      return null;
    }

    let shutdown: (() => void) | undefined;
    try {
      const handle = await startOAuthCredentialsServer({ provider: connector.name });
      shutdown = handle.shutdown;

      const elicitationId = generateElicitationId('connector_oauth');
      const result = await this.elicitationServer.elicitInput({
        mode: 'url',
        message:
          `Open the local ${connector.name} OAuth setup page to enter your credentials. ` +
          'Credentials are stored locally and never transit through the MCP payload.',
        elicitationId,
        url: handle.url,
      });

      if (result.action !== 'accept') {
        shutdown();
        return null;
      }

      const creds = await handle.credentialsPromise;
      if (!creds.clientId || !creds.clientSecret) {
        return null;
      }

      if (this.elicitationServer.createElicitationCompletionNotifier) {
        const notify = this.elicitationServer.createElicitationCompletionNotifier(elicitationId);
        try {
          await notify();
        } catch (notifyErr) {
          logger.warn('OAuth credentials elicitation completion notification failed (non-fatal)', {
            error: notifyErr,
          });
        }
      }

      return {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        ...(creds.accessToken ? { accessToken: creds.accessToken } : {}),
        ...(creds.refreshToken ? { refreshToken: creds.refreshToken } : {}),
      };
    } catch {
      shutdown?.();
    }

    return null;
  }

  private async resolveConfigureRequest(
    req: Extract<SheetsConnectorsInput['request'], { action: 'configure' }>
  ): Promise<
    | { connector: ConnectorCatalogEntry; credentials: ConnectorCredentials }
    | { error: SheetsConnectorsOutput }
  > {
    let connectorId = req.connectorId?.trim();

    if (!connectorId) {
      connectorId = (await this.elicitConnectorSelection()) ?? undefined;
    }

    if (!connectorId) {
      const nextBestAction =
        'Run list_connectors first or retry configure with connectorId on an elicitation-capable client.';
      return {
        error: this.makeErrorResponse(
          'configure',
          this.elicitationServer
            ? ErrorCodes.OPERATION_CANCELLED
            : ErrorCodes.ELICITATION_UNAVAILABLE,
          'Connector configuration needs a connectorId. On elicitation-capable MCP clients, the server can prompt for it; otherwise provide connectorId explicitly.',
          'Call list_connectors to see valid connector IDs, then retry configure with connectorId and credentials.',
          nextBestAction
        ),
      };
    }

    const connector = this.getConnectorEntry(connectorId);
    if (!connector) {
      return {
        error: this.makeErrorResponse(
          'configure',
          ErrorCodes.INVALID_PARAMS,
          `Unknown connector "${connectorId}".`,
          'Use list_connectors to see available connector IDs before configuring one.'
        ),
      };
    }

    const providedCredentials = req.credentials;
    if (connector.authType === 'none') {
      return {
        connector,
        credentials: { type: 'none' },
      };
    }

    if (connector.authType === 'api_key') {
      const providedApiKey = providedCredentials?.apiKey?.trim();
      if (providedApiKey) {
        return {
          connector,
          credentials: {
            type: 'api_key',
            apiKey: providedApiKey,
          },
        };
      }

      const apiKey = await this.elicitApiKey(connector);
      if (!apiKey) {
        return {
          error: this.makeErrorResponse(
            'configure',
            this.elicitationServer
              ? ErrorCodes.OPERATION_CANCELLED
              : ErrorCodes.ELICITATION_UNAVAILABLE,
            this.elicitationServer
              ? `Connector configuration for "${connector.name}" was cancelled before an API key was provided.`
              : `Connector "${connector.name}" requires credentials.apiKey.`,
            this.elicitationServer
              ? 'Retry configure with credentials.apiKey, or accept the MCP elicitation prompt so the server can open a local setup page for the key.'
              : 'Retry configure with credentials.apiKey, or use an elicitation-capable MCP client so the server can prompt for it.',
            `Provide an API key for "${connector.name}" and retry configure.`
          ),
        };
      }

      return {
        connector,
        credentials: {
          type: 'api_key',
          apiKey,
        },
      };
    }

    const oauth =
      providedCredentials?.oauth &&
      providedCredentials.oauth.clientId &&
      providedCredentials.oauth.clientSecret
        ? providedCredentials.oauth
        : await this.elicitOAuthCredentials(connector);

    if (!oauth) {
      return {
        error: this.makeErrorResponse(
          'configure',
          this.elicitationServer
            ? ErrorCodes.OPERATION_CANCELLED
            : ErrorCodes.ELICITATION_UNAVAILABLE,
          this.elicitationServer
            ? `Connector configuration for "${connector.name}" was cancelled before OAuth credentials were provided.`
            : `Connector "${connector.name}" requires credentials.oauth with clientId and clientSecret.`,
          this.elicitationServer
            ? 'Retry configure with credentials.oauth, or accept the MCP elicitation prompt so the server can collect the OAuth fields.'
            : 'Retry configure with credentials.oauth, or use an elicitation-capable MCP client so the server can prompt for the fields.',
          `Provide OAuth credentials for "${connector.name}" and retry configure.`
        ),
      };
    }

    return {
      connector,
      credentials: {
        type: 'oauth2',
        oauth,
      },
    };
  }

  private handleListConnectors(): SheetsConnectorsOutput {
    const result = connectorManager.listConnectors();
    const enrichedConnectors = result.connectors.map((connector) =>
      this.enrichConnector(connector)
    );
    // Record connector IDs for MCP completion suggestions
    for (const c of enrichedConnectors) {
      recordConnectorId(c.id);
    }
    const configuredCount = enrichedConnectors.filter((connector) => connector.configured).length;
    return {
      response: {
        success: true,
        action: 'list_connectors',
        message:
          configuredCount > 0
            ? `${configuredCount} connector(s) already configured. Pick one to verify or query.`
            : 'No connectors are configured yet. Pick one provider and run configure.',
        connectors: enrichedConnectors,
        nextStep:
          configuredCount > 0
            ? 'Run sheets_connectors action "status" on a configured connector, or make a first query.'
            : 'Run sheets_connectors action "configure" for the connector you want to use first.',
        _meta: this.createMeta({
          nextBestAction:
            configuredCount > 0
              ? 'Check a configured connector with sheets_connectors.status.'
              : 'Configure one connector with sheets_connectors.configure.',
          verificationSummary: `${configuredCount}/${enrichedConnectors.length} connector(s) are configured.`,
        }),
      },
    };
  }

  private async handleConfigure(
    req: Extract<SheetsConnectorsInput['request'], { action: 'configure' }>
  ): Promise<SheetsConnectorsOutput> {
    const resolved = await this.resolveConfigureRequest(req);
    if ('error' in resolved) {
      return resolved.error;
    }

    const result = await connectorManager.configure(resolved.connector.id, resolved.credentials);
    if (!result.success) {
      return {
        response: {
          success: false as const,
          action: 'configure',
          error: { code: ErrorCodes.CONNECTOR_ERROR, message: result.message, retryable: false },
        },
      };
    }
    const status = await connectorManager.status(resolved.connector.id).catch(() => null);
    const ux = this.getConnectorUx(resolved.connector.id);
    const verified = status?.health?.healthy ?? true;
    return {
      response: {
        success: true as const,
        action: 'configure',
        message: result.message,
        id: resolved.connector.id,
        name: resolved.connector.name,
        configured: true,
        verified,
        authType: resolved.connector.authType,
        ...(ux.signupUrl ? { signupUrl: ux.signupUrl } : {}),
        recommendedUseCases: ux.recommendedUseCases,
        nextStep: verified
          ? `Run a first query against "${resolved.connector.id}" to confirm the end-to-end flow.`
          : `Run sheets_connectors action "status" for "${resolved.connector.id}" to inspect connector health.`,
        ...(ux.exampleQuery
          ? {
              exampleQuery: {
                connectorId: resolved.connector.id,
                endpoint: ux.exampleQuery.endpoint,
                ...(ux.exampleQuery.params ? { params: ux.exampleQuery.params } : {}),
              },
            }
          : {}),
        ...(status?.health ? { health: status.health } : {}),
        ...(status?.quota ? { quota: status.quota } : {}),
        _meta: this.createMeta({
          nextBestAction: verified
            ? `Run sheets_connectors.query for "${resolved.connector.id}".`
            : `Run sheets_connectors.status for "${resolved.connector.id}".`,
          verificationSummary: verified
            ? `${resolved.connector.name} completed configuration and health verification.`
            : `${resolved.connector.name} stored credentials but needs a follow-up status check.`,
          nextSteps: ux.exampleQuery
            ? [
                `Example: sheets_connectors { "action": "query", "connectorId": "${resolved.connector.id}", "endpoint": "${ux.exampleQuery.endpoint}" }`,
              ]
            : undefined,
        }),
      },
    };
  }

  private async handleQuery(
    req: Extract<SheetsConnectorsInput['request'], { action: 'query' }>
  ): Promise<SheetsConnectorsOutput> {
    const result = await connectorManager.query(
      req.connectorId,
      req.endpoint,
      req.params ?? {},
      req.transform,
      req.useCache
    );

    // Record operation in session context for LLM follow-up references
    try {
      if (this.sessionContext) {
        this.sessionContext.recordOperation({
          tool: 'sheets_connectors',
          action: 'query',
          spreadsheetId: req.connectorId,
          description: `Queried connector '${req.connectorId}' endpoint '${req.endpoint}': ${result.rows.length} rows`,
          undoable: false,
          cellsAffected: result.rows.length,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return {
      response: {
        success: true,
        action: 'query',
        headers: result.headers,
        rows: result.rows,
        metadata: result.metadata,
      },
    };
  }

  private async handleBatchQuery(
    req: Extract<SheetsConnectorsInput['request'], { action: 'batch_query' }>
  ): Promise<SheetsConnectorsOutput> {
    const result = await connectorManager.batchQuery(
      req.queries.map((q) => ({
        connectorId: q.connectorId,
        endpoint: q.endpoint,
        params: q.params ?? {},
        transform: q.transform,
      }))
    );
    return {
      response: {
        success: true,
        action: 'batch_query',
        results: result.results,
      },
    };
  }

  private handleSubscribe(
    req: Extract<SheetsConnectorsInput['request'], { action: 'subscribe' }>
  ): SheetsConnectorsOutput {
    const sub = connectorManager.subscribe(
      req.connectorId,
      req.endpoint,
      req.params ?? {},
      req.schedule,
      {
        spreadsheetId: req.destination.spreadsheetId,
        range: extractRangeA1(req.destination.range, 'destination.range'),
      }
    );
    return {
      response: {
        success: true,
        action: 'subscribe',
        subscription: {
          id: sub.id,
          connectorId: sub.connectorId,
          endpoint: sub.endpoint,
          status: sub.status,
          nextRefresh: sub.nextRefresh,
        },
      },
    };
  }

  private handleUnsubscribe(
    req: Extract<SheetsConnectorsInput['request'], { action: 'unsubscribe' }>
  ): SheetsConnectorsOutput {
    const removed = connectorManager.unsubscribe(req.subscriptionId);
    return {
      response: {
        success: true,
        action: 'unsubscribe',
        removed,
      },
    };
  }

  private handleListSubscriptions(): SheetsConnectorsOutput {
    const subs = connectorManager.listSubscriptions();
    return {
      response: {
        success: true,
        action: 'list_subscriptions',
        subscriptions: subs.map((s) => ({
          id: s.id,
          connectorId: s.connectorId,
          endpoint: s.endpoint,
          status: s.status,
          lastRefresh: s.lastRefresh,
          nextRefresh: s.nextRefresh,
        })),
      },
    };
  }

  private async handleTransform(
    req: Extract<SheetsConnectorsInput['request'], { action: 'transform' }>
  ): Promise<SheetsConnectorsOutput> {
    const result = await connectorManager.query(
      req.connectorId,
      req.endpoint,
      req.params ?? {},
      req.transform,
      true // use cache since transform is the primary operation
    );
    return {
      response: {
        success: true,
        action: 'transform',
        headers: result.headers,
        rows: result.rows,
        metadata: result.metadata,
      },
    };
  }

  private async handleStatus(
    req: Extract<SheetsConnectorsInput['request'], { action: 'status' }>
  ): Promise<SheetsConnectorsOutput> {
    const result = await connectorManager.status(req.connectorId);
    const ux = this.getConnectorUx(req.connectorId);
    const nextStep = !result.configured
      ? `Run sheets_connectors action "configure" with connectorId "${req.connectorId}".`
      : result.health?.healthy
        ? `Run sheets_connectors action "query" with connectorId "${req.connectorId}" to pull your first dataset.`
        : `Re-run sheets_connectors action "configure" or inspect the connector credentials for "${req.connectorId}".`;
    return {
      response: {
        success: true,
        action: 'status',
        id: result.id,
        name: result.name,
        configured: result.configured,
        verified: result.health?.healthy ?? false,
        ...(ux.signupUrl ? { signupUrl: ux.signupUrl } : {}),
        recommendedUseCases: ux.recommendedUseCases,
        nextStep,
        ...(ux.exampleQuery
          ? {
              exampleQuery: {
                connectorId: req.connectorId,
                endpoint: ux.exampleQuery.endpoint,
                ...(ux.exampleQuery.params ? { params: ux.exampleQuery.params } : {}),
              },
            }
          : {}),
        health: result.health,
        quota: result.quota,
        _meta: this.createMeta({
          nextBestAction: nextStep,
          verificationSummary: result.configured
            ? result.health?.healthy
              ? `${result.name} is configured and healthy.`
              : `${result.name} is configured but not currently healthy.`
            : `${result.name} is available but not configured yet.`,
        }),
      },
    };
  }

  private async handleDiscover(
    req: Extract<SheetsConnectorsInput['request'], { action: 'discover' }>
  ): Promise<SheetsConnectorsOutput> {
    if (req.endpoint) {
      const discovery = await connectorManager.discover(req.connectorId);
      const endpoint = discovery.endpoints.find((candidate) => candidate.id === req.endpoint);
      if (!endpoint) {
        return {
          response: {
            success: false,
            action: 'discover',
            error: {
              code: ErrorCodes.INVALID_PARAMS,
              message: `Unknown endpoint "${req.endpoint}" for connector "${req.connectorId}"`,
              retryable: false,
            },
          },
        };
      }

      // Get schema for a specific endpoint
      const schema = await connectorManager.getEndpointSchema(req.connectorId, req.endpoint);
      return {
        response: {
          success: true,
          action: 'discover',
          schema,
        },
      };
    }

    // List all endpoints with AI-powered recommendation
    const result = await connectorManager.discover(req.connectorId);

    // AI-powered connector recommendation
    let aiRecommendation: string | undefined;
    if (this.samplingServer) {
      aiRecommendation = await generateAIInsight(
        this.samplingServer,
        'connectorDiscovery',
        `Which endpoints from connector "${req.connectorId}" would be most useful? What data can each provide?`,
        { connectorId: req.connectorId, endpoints: result.endpoints },
        { maxTokens: 400 }
      );
    }

    return {
      response: {
        success: true,
        action: 'discover',
        endpoints: result.endpoints,
        ...(aiRecommendation ? { aiRecommendation } : {}),
      },
    };
  }
}
