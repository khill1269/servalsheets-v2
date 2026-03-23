/**
 * ServalSheets - Federation Handler
 *
 * Handles federation operations for calling external MCP servers.
 * Enables composite workflows by integrating with other MCP servers.
 *
 * @category Handlers
 * @module handlers/federation
 */

import type {
  SheetsFederationInput,
  SheetsFederationOutput,
  FederationAction,
} from '../schemas/federation.js';
import { unwrapRequest } from './base.js';
import { getFederationClient } from '../services/federated-mcp-client.js';
import { ValidationError } from '../core/errors.js';
import { getFederationConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { parseFederationServers } from '../config/federation-config.js';
import { sendProgress } from '../utils/request-context.js';
import { mapStandaloneError } from './helpers/error-mapping.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { getCircuitBreakerConfig } from '../config/env.js';
import { circuitBreakerRegistry } from '../services/circuit-breaker-registry.js';
import { recordServerName } from '../mcp/completions.js';

function sanitizeFederationErrorMessage(message: string): string {
  // Drop multiline stack tail and redact common local filesystem path patterns.
  const firstLine = message.split('\n')[0] ?? message;
  return firstLine.replace(/\/home\/|\/Users\/|node_modules\//g, '[REDACTED_PATH]');
}

function buildFederationError(
  error: unknown,
  options?: {
    prefixRemoteMessage?: boolean;
    overrideMessage?: string;
  }
): {
  error: string;
  errorDetail: ReturnType<typeof mapStandaloneError>;
} {
  const mapped = mapStandaloneError(error);
  const sanitizedMessage = sanitizeFederationErrorMessage(mapped.message);
  const baseMessage = options?.overrideMessage ?? sanitizedMessage;

  return {
    error: options?.prefixRemoteMessage
      ? `Remote MCP server returned an error: ${baseMessage}`
      : baseMessage,
    errorDetail: mapped,
  };
}

/**
 * Federation Handler
 *
 * Manages calls to external MCP servers for composite workflows.
 * Supports HTTP and STDIO transports with circuit breaker protection.
 */
export class FederationHandler {
  private circuitBreaker: CircuitBreaker;
  private sessionContext?: import('../services/session-context.js').SessionContextManager;

  constructor(
    _taskStore?: import('../core/task-store-adapter.js').TaskStoreAdapter,
    options?: {
      sessionContext?: import('../services/session-context.js').SessionContextManager;
    }
  ) {
    this.sessionContext = options?.sessionContext;
    // 16-S3: Initialize circuit breaker for federation operations
    const circuitConfig = getCircuitBreakerConfig();
    this.circuitBreaker = new CircuitBreaker({
      ...circuitConfig,
      name: 'federation-mcp-calls',
    });

    // Register fallback strategy for federation circuit breaker
    this.circuitBreaker.registerFallback({
      name: 'federation-unavailable-fallback',
      priority: 1,
      shouldUse: () => true,
      execute: async () => {
        throw new ValidationError(
          'Remote MCP servers temporarily unavailable due to repeated connection failures. Try again in 30 seconds.',
          'federation'
        );
      },
    });

    // Register with global registry
    circuitBreakerRegistry.register('federation-mcp-calls', this.circuitBreaker);
  }

  /**
   * Handle federation requests
   */
  async handle(input: SheetsFederationInput): Promise<SheetsFederationOutput> {
    const req = unwrapRequest<SheetsFederationInput['request']>(input);
    const { action, serverName, toolName, toolInput } = req;

    logger.info('Federation request', {
      component: 'federation-handler',
      action,
      serverName,
      toolName,
    });

    // Check if federation is enabled
    const config = getFederationConfig();
    if (!config.enabled) {
      const federationError = buildFederationError(
        new ValidationError(
          'Federation is not enabled. Set MCP_FEDERATION_ENABLED=true in your environment configuration.',
          'federation'
        )
      );
      return {
        response: {
          success: false,
          action,
          error: federationError.error,
          errorDetail: federationError.errorDetail,
        },
      };
    }

    // Parse server configurations
    const servers = parseFederationServers(config.serversJson);
    if (servers.length === 0 && action !== 'list_servers') {
      const federationError = buildFederationError(
        new ValidationError(
          'No federation servers configured. Set MCP_FEDERATION_SERVERS with JSON server array.',
          'federation'
        )
      );
      return {
        response: {
          success: false,
          action,
          error: federationError.error,
          errorDetail: federationError.errorDetail,
        },
      };
    }

    try {
      // Get or create federation client
      const client = await getFederationClient(servers);

      // Route to appropriate action handler
      switch (action) {
        case 'call_remote':
          return await this.handleCallRemote(client, serverName, toolName, toolInput, action);

        case 'list_servers':
          return await this.handleListServers(client, servers, action);

        case 'get_server_tools':
          return await this.handleGetServerTools(client, serverName, action);

        case 'validate_connection':
          return await this.handleValidateConnection(client, serverName, action);

        default: {
          const _exhaustiveCheck: never = action;
          throw new ValidationError(
            `Unknown federation action: ${String(_exhaustiveCheck)}`,
            'federation'
          );
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Federation handler error', {
        component: 'federation-handler',
        action,
        error: err.message,
      });

      // 16-S5: Use structured error mapping
      const federationError = buildFederationError(error, { prefixRemoteMessage: true });
      return {
        response: {
          success: false,
          action,
          error: federationError.error,
          errorDetail: federationError.errorDetail,
        },
      };
    }
  }

  /**
   * Handle call_remote action
   * 16-S3: Wrapped with circuit breaker protection
   */
  private async handleCallRemote(
    client: Awaited<ReturnType<typeof getFederationClient>>,
    serverName: string | undefined,
    toolName: string | undefined,
    toolInput: Record<string, unknown> | undefined,
    _action: FederationAction
  ): Promise<SheetsFederationOutput> {
    if (!serverName) {
      throw new ValidationError('Missing required parameter: serverName', 'federation');
    }

    if (!toolName) {
      throw new ValidationError('Missing required parameter: toolName', 'federation');
    }

    logger.info('Calling remote MCP tool', {
      component: 'federation-handler',
      serverName,
      toolName,
      hasInput: !!toolInput,
    });

    await sendProgress(0, 100, `Connecting to remote server: ${serverName}...`);

    // 16-S3: Wrap remote call with circuit breaker
    const result = await this.circuitBreaker.execute(async () => {
      return await client.callRemoteTool(serverName, toolName, toolInput || {});
    });

    await sendProgress(100, 100, 'Remote call complete');

    logger.info('Remote tool call succeeded', {
      component: 'federation-handler',
      serverName,
      toolName,
    });

    // Record operation in session context for LLM follow-up references
    try {
      if (this.sessionContext) {
        this.sessionContext.recordOperation({
          tool: 'sheets_federation',
          action: 'call_remote',
          spreadsheetId: serverName,
          description: `Called remote MCP tool '${toolName}' on server '${serverName}'`,
          undoable: false,
        });
      }
    } catch {
      // Non-blocking: session context recording is best-effort
    }

    return {
      response: {
        success: true,
        action: 'call_remote',
        remoteServer: serverName,
        data: result,
      },
    };
  }

  /**
   * Handle list_servers action
   */
  private async handleListServers(
    client: Awaited<ReturnType<typeof getFederationClient>>,
    servers: Array<{ name: string; url: string }>,
    _action: FederationAction
  ): Promise<SheetsFederationOutput> {
    const serverList = servers.map((s) => ({
      name: s.name,
      url: s.url,
      connected: client.isConnected(s.name),
    }));

    // Record server names for MCP completion suggestions
    for (const s of serverList) {
      recordServerName(s.name);
    }

    logger.debug('Listing federation servers', {
      component: 'federation-handler',
      serverCount: serverList.length,
    });

    return {
      response: {
        success: true,
        action: 'list_servers',
        servers: serverList,
      },
    };
  }

  /**
   * Handle get_server_tools action
   * 16-S3: Wrapped with circuit breaker protection
   */
  private async handleGetServerTools(
    client: Awaited<ReturnType<typeof getFederationClient>>,
    serverName: string | undefined,
    _action: FederationAction
  ): Promise<SheetsFederationOutput> {
    if (!serverName) {
      throw new ValidationError('Missing required parameter: serverName', 'federation');
    }

    logger.info('Getting remote server tools', {
      component: 'federation-handler',
      serverName,
    });

    // 16-S3: Wrap remote call with circuit breaker
    const tools = await this.circuitBreaker.execute(async () => {
      return await client.listRemoteTools(serverName);
    });

    logger.info('Retrieved remote server tools', {
      component: 'federation-handler',
      serverName,
      toolCount: tools.length,
    });

    return {
      response: {
        success: true,
        action: 'get_server_tools',
        remoteServer: serverName,
        tools: tools as Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>,
      },
    };
  }

  /**
   * Handle validate_connection action
   * 16-S3: Wrapped with circuit breaker protection
   */
  private async handleValidateConnection(
    client: Awaited<ReturnType<typeof getFederationClient>>,
    serverName: string | undefined,
    _action: FederationAction
  ): Promise<SheetsFederationOutput> {
    if (!serverName) {
      throw new ValidationError('Missing required parameter: serverName', 'federation');
    }

    logger.info('Validating connection to remote server', {
      component: 'federation-handler',
      serverName,
    });

    try {
      // Try to list tools as a connection test
      // 16-S3: Wrap remote call with circuit breaker
      await this.circuitBreaker.execute(async () => {
        return await client.listRemoteTools(serverName);
      });

      logger.info('Connection validation succeeded', {
        component: 'federation-handler',
        serverName,
      });

      return {
        response: {
          success: true,
          action: 'validate_connection',
          remoteServer: serverName,
          data: { connected: true },
        },
      };
    } catch (error) {
      const err = error as Error;
      logger.warn('Connection validation failed', {
        component: 'federation-handler',
        serverName,
        error: err.message,
      });

      const federationError = buildFederationError(
        new ValidationError(
          'Connection validation failed. The remote server may be unavailable or unreachable.',
          'federation'
        ),
        {
          // Keep this exact phrase for existing contract tests.
          overrideMessage:
            'Connection validation failed. The remote server may be unavailable or unreachable.',
        }
      );

      return {
        response: {
          success: false,
          action: 'validate_connection',
          remoteServer: serverName,
          error: federationError.error,
          errorDetail: federationError.errorDetail,
        },
      };
    }
  }
}
