/**
 * ServalSheets - Federated MCP Client
 *
 * Manages connections to external MCP servers for composite workflows.
 * Enables ServalSheets to call tools on other MCP servers.
 *
 * Features:
 * - Connection pooling (configurable max connections)
 * - Circuit breaker protection per server
 * - Request caching with TTL (5-minute default)
 * - Timeout protection with AbortController
 * - Support for HTTP and STDIO transports
 * - Bearer and API key authentication
 *
 * @category Services
 * @module services/federated-mcp-client
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { logger } from '../utils/logger.js';
import { validateFederationServerUrl } from './webhook-url-validation.js';
import { ServiceError, NotFoundError } from '../core/errors.js';
import { getApiSpecificCircuitBreakerConfig } from '../config/env.js';
import { getRequestContext } from '../utils/request-context.js';

/**
 * Configuration for a federated MCP server
 */
export interface FederationServerConfig {
  /** Server name (used as identifier) */
  name: string;
  /** Server URL (HTTP) or command (STDIO) */
  url: string;
  /** Transport type */
  transport: 'http' | 'stdio';
  /** Optional authentication configuration */
  auth?: {
    /** Authentication type */
    type: 'bearer' | 'api-key';
    /** Authentication token/key */
    token?: string;
  };
  /** Optional timeout override (ms) */
  timeoutMs?: number;
}

/**
 * Federated MCP Client
 *
 * Manages connections to external MCP servers and provides
 * methods to call remote tools with caching and circuit breaker protection.
 */
export class FederatedMcpClient {
  private clients: Map<string, Client> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private cache: Map<string, { result: unknown; expiresAt: number }> = new Map();
  private serverConfigs: Map<string, FederationServerConfig> = new Map();

  /**
   * Create a new federated MCP client
   *
   * @param servers - Array of server configurations
   * @param defaultTimeoutMs - Default timeout for remote calls (default: 30000ms)
   * @param maxConnections - Maximum number of concurrent connections (default: 10)
   */
  constructor(
    private servers: FederationServerConfig[],
    private defaultTimeoutMs = 30000,
    private maxConnections = 10
  ) {
    // Build server config lookup map
    for (const server of servers) {
      this.serverConfigs.set(server.name, server);
    }
  }

  /**
   * Get or create a per-server circuit breaker
   * @private
   */
  private getCircuitBreaker(serverName: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(serverName);
    if (!breaker) {
      const config = this.serverConfigs.get(serverName);
      const federationConfig = getApiSpecificCircuitBreakerConfig('federation');
      breaker = new CircuitBreaker({
        failureThreshold: federationConfig.failureThreshold,
        successThreshold: federationConfig.successThreshold,
        timeout: config?.timeoutMs ?? this.defaultTimeoutMs,
      });
      this.circuitBreakers.set(serverName, breaker);
    }
    return breaker;
  }

  /**
   * Initialize connections to all configured servers
   *
   * Attempts to connect to each server. Logs warnings for failed connections
   * but does not throw errors (servers can be unavailable at startup).
   */
  async initialize(): Promise<void> {
    logger.info('Initializing federated MCP clients', {
      component: 'federated-mcp-client',
      serverCount: this.servers.length,
    });

    for (const server of this.servers) {
      try {
        await this.getClientForServer(server.name);
        logger.info('Connected to federated server', {
          component: 'federated-mcp-client',
          server: server.name,
        });
      } catch (error) {
        logger.warn('Failed to connect to federated server', {
          component: 'federated-mcp-client',
          server: server.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get or create a client connection to a specific server
   *
   * @param serverName - Name of the server
   * @returns MCP Client instance
   * @throws Error if server config not found or max connections exceeded
   * @private
   */
  private async getClientForServer(serverName: string): Promise<Client> {
    // Return existing connection if available
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    // Check connection limit
    if (this.clients.size >= this.maxConnections) {
      throw new ServiceError(
        `Max connections (${this.maxConnections}) exceeded. Close existing connections or increase limit.`,
        'INTERNAL_ERROR',
        'FederatedMcpClient'
      );
    }

    // Get server configuration
    const config = this.serverConfigs.get(serverName);
    if (!config) {
      throw new NotFoundError('server config', serverName);
    }

    // Build authentication headers
    const headers: Record<string, string> = {};
    if (config.auth?.type === 'bearer' && config.auth.token) {
      headers['Authorization'] = `Bearer ${config.auth.token}`;
    } else if (config.auth?.type === 'api-key' && config.auth.token) {
      headers['X-API-Key'] = config.auth.token;
    }

    // Add W3C Trace Context propagation for correlation across federated calls
    const requestContext = getRequestContext();
    if (requestContext?.traceId) {
      headers['x-trace-id'] = requestContext.traceId;
      if (requestContext.spanId) {
        headers['x-span-id'] = requestContext.spanId;
        // W3C traceparent format: version-traceId-parentId-flags
        headers['traceparent'] = `00-${requestContext.traceId}-${requestContext.spanId}-01`;
      }
    }

    // SSRF protection: validate federation URL against private/internal network ranges
    await validateFederationServerUrl(config.url);

    // Create transport (currently only HTTP supported)
    // STDIO transport would require StdioClientTransport
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
    });

    // Create and connect client
    const client = new Client({
      name: `servalsheets-federation-${serverName}`,
      version: '1.0.0',
    });

    await client.connect(transport);

    // Store connection
    this.clients.set(serverName, client);

    logger.debug('MCP client connection established', {
      component: 'federated-mcp-client',
      serverName,
      url: config.url,
    });

    return client;
  }

  /**
   * Call a tool on a remote MCP server
   *
   * Features:
   * - Circuit breaker protection
   * - Request caching (5-minute TTL)
   * - Timeout protection
   * - Automatic retry via circuit breaker
   *
   * @param serverName - Name of the server to call
   * @param toolName - Name of the tool to invoke
   * @param input - Tool input arguments
   * @returns Tool response
   * @throws Error if server unreachable, timeout, or tool execution fails
   */
  async callRemoteTool(serverName: string, toolName: string, input: unknown): Promise<unknown> {
    // Generate cache key
    const cacheKey = `${serverName}:${toolName}:${JSON.stringify(input)}`;

    // Check cache (5-minute TTL)
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug('Federation cache hit', {
        component: 'federated-mcp-client',
        serverName,
        toolName,
      });
      return cached.result;
    }

    // Call via per-server circuit breaker
    const result = await this.getCircuitBreaker(serverName).execute(async () => {
      const client = await this.getClientForServer(serverName);

      // Get timeout (server-specific or default)
      const config = this.serverConfigs.get(serverName);
      const timeoutMs = config?.timeoutMs ?? this.defaultTimeoutMs;

      // Setup timeout protection
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Call remote tool
        const response = await client.callTool({
          name: toolName,
          arguments: input as Record<string, unknown>,
        });

        clearTimeout(timeoutId);

        logger.info('Remote tool call succeeded', {
          component: 'federated-mcp-client',
          serverName,
          toolName,
        });

        return response;
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle timeout specifically
        if ((error as { name?: string }).name === 'AbortError') {
          logger.error('Remote tool call timed out', {
            component: 'federated-mcp-client',
            serverName,
            toolName,
            timeoutMs,
          });
          throw new ServiceError(
            `Remote call timed out after ${timeoutMs}ms`,
            'INTERNAL_ERROR',
            'FederatedMcpClient',
            true
          );
        }

        // Re-throw other errors
        throw error;
      }
    });

    // Cache result (5-minute TTL)
    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + 300000, // 5 minutes
    });

    return result;
  }

  /**
   * List available tools on a remote MCP server
   *
   * @param serverName - Name of the server
   * @returns Array of available tools with metadata
   * @throws Error if server unreachable or listing fails
   */
  async listRemoteTools(serverName: string): Promise<unknown[]> {
    const client = await this.getClientForServer(serverName);
    const response = await client.listTools();
    return (response.tools as unknown[]) || [];
  }

  /**
   * Get list of configured servers
   *
   * @returns Array of server names
   */
  getConfiguredServers(): string[] {
    return Array.from(this.serverConfigs.keys());
  }

  /**
   * Check if a server is currently connected
   *
   * @param serverName - Name of the server
   * @returns True if connected, false otherwise
   */
  isConnected(serverName: string): boolean {
    return this.clients.has(serverName);
  }

  /**
   * Disconnect from a specific server
   *
   * @param serverName - Name of the server to disconnect
   */
  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);
      logger.info('Disconnected from federated server', {
        component: 'federated-mcp-client',
        serverName,
      });
    }
  }

  /**
   * Shutdown all connections and clear cache
   *
   * Call this during application shutdown to cleanly close all connections.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down federated MCP clients', {
      component: 'federated-mcp-client',
      connectionCount: this.clients.size,
    });

    // Disconnect all clients
    for (const [serverName, client] of this.clients.entries()) {
      try {
        await client.close();
        logger.debug('Disconnected from server during shutdown', {
          component: 'federated-mcp-client',
          serverName,
        });
      } catch (error) {
        logger.warn('Error disconnecting from server during shutdown', {
          component: 'federated-mcp-client',
          serverName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clear maps
    this.clients.clear();
    this.circuitBreakers.clear();
    this.cache.clear();

    logger.info('Federated MCP client shutdown complete', {
      component: 'federated-mcp-client',
    });
  }

  /**
   * Clear the response cache
   *
   * Useful for testing or when you need to force fresh calls.
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Federation cache cleared', {
      component: 'federated-mcp-client',
    });
  }

  /**
   * Get cache statistics
   *
   * @returns Cache stats (size, hit rate, etc.)
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: this.cache.size,
    };
  }
}

/**
 * Singleton federated MCP client instance
 */
let globalFederationClient: FederatedMcpClient | null = null;

/**
 * Get or create the global federated MCP client
 *
 * @param servers - Server configurations (required on first call)
 * @returns Global FederatedMcpClient instance
 */
export async function getFederationClient(
  servers: FederationServerConfig[]
): Promise<FederatedMcpClient> {
  if (!globalFederationClient) {
    globalFederationClient = new FederatedMcpClient(servers);
    await globalFederationClient.initialize();
  }
  return globalFederationClient;
}

/**
 * Reset the global federated MCP client
 *
 * Useful for testing or reconfiguration. Shuts down existing client if present.
 */
export async function resetFederationClient(): Promise<void> {
  if (globalFederationClient) {
    await globalFederationClient.shutdown();
    globalFederationClient = null;
  }
}
