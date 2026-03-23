/**
 * ServalSheets - MCP Bridge Connector
 *
 * Bridges external MCP servers as data connectors. Any MCP server that exposes
 * tools returning tabular data can be wrapped as a SpreadsheetConnector.
 *
 * Auth: Delegated to the underlying MCP transport
 * Use case: Connect to any MCP server (databases, APIs, custom services)
 */

import { logger } from '../utils/logger.js';
import { NotFoundError, ServiceError } from '../core/errors.js';
import type {
  SpreadsheetConnector,
  ConnectorCredentials,
  HealthStatus,
  QuotaStatus,
  RateLimitInfo,
  DataEndpoint,
  DataSchema,
  QueryParams,
  DataResult,
} from './types.js';

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

interface McpBridgeConfig {
  /** Unique ID for this bridge instance */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this MCP server provides */
  description: string;
  /** MCP server transport config */
  transport: {
    type: 'stdio' | 'http' | 'streamable-http';
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
  };
  /** Optional: map of tool names to treat as data endpoints */
  endpointMapping?: Record<string, { category?: string; description?: string }>;
}

export class McpBridgeConnector implements SpreadsheetConnector {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly authType = 'none' as const;

  private config: McpBridgeConfig;
  private configured = false;
  private tools: McpToolDefinition[] = [];
  private requestCount = 0;
  private lastResetTime = Date.now();

  constructor(config: McpBridgeConfig) {
    this.config = config;
    this.id = `mcp_${config.id}`;
    this.name = config.name;
    this.description = config.description;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(credentials: ConnectorCredentials): Promise<void> {
    // Store any custom credentials (e.g., auth headers for HTTP transport)
    if (credentials.custom) {
      if (this.config.transport.type !== 'stdio') {
        this.config.transport.headers = {
          ...this.config.transport.headers,
          ...credentials.custom,
        };
      }
    }

    // Discover available tools from the MCP server
    try {
      this.tools = await this.discoverTools();
      this.configured = true;
      logger.info(
        `MCP bridge connector configured: ${this.id} (${this.tools.length} tools discovered)`
      );
    } catch (err) {
      throw new ServiceError(
        `Failed to connect to MCP server '${this.config.name}': ${err instanceof Error ? err.message : 'Unknown error'}`,
        'INTERNAL_ERROR',
        'mcp-bridge',
        true
      );
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Attempt to list tools as a health check
      const tools = await this.discoverTools();
      return {
        healthy: tools.length > 0,
        latencyMs: Date.now() - start,
        message: `${tools.length} tools available`,
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Connection failed',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async dispose(): Promise<void> {
    this.configured = false;
    this.tools = [];
  }

  async listEndpoints(): Promise<DataEndpoint[]> {
    return this.tools.map((tool) => {
      const mapping = this.config.endpointMapping?.[tool.name];
      const params = Object.entries(tool.inputSchema?.properties ?? {}).map(([name, schema]) => ({
        name,
        type: this.mapSchemaType(schema.type),
        required: tool.inputSchema?.required?.includes(name) ?? false,
        description: schema.description ?? name,
      }));

      return {
        id: tool.name,
        name: tool.name,
        description: mapping?.description ?? tool.description ?? `MCP tool: ${tool.name}`,
        category: mapping?.category ?? 'mcp',
        params,
      };
    });
  }

  async getSchema(endpoint: string): Promise<DataSchema> {
    // MCP tools don't have a predefined schema — we infer from results
    const tool = this.tools.find((t) => t.name === endpoint);
    if (!tool) {
      return { endpoint, columns: [] };
    }

    return {
      endpoint,
      columns: [], // Will be inferred from actual query results
    };
  }

  async query(endpoint: string, params: QueryParams): Promise<DataResult> {
    this.trackRequest();

    const tool = this.tools.find((t) => t.name === endpoint);
    if (!tool) {
      throw new NotFoundError('MCP tool', `${endpoint} on server '${this.config.name}'`);
    }

    try {
      const result = await this.callTool(endpoint, params);
      return this.parseToolResult(endpoint, result);
    } catch (err) {
      throw new ServiceError(
        `MCP tool '${endpoint}' failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'INTERNAL_ERROR',
        'mcp-bridge',
        true
      );
    }
  }

  getQuotaUsage(): QuotaStatus {
    return {
      used: this.requestCount,
      limit: 1000,
      resetAt: new Date(this.lastResetTime + 3_600_000).toISOString(),
      unit: 'requests',
    };
  }

  getRateLimits(): RateLimitInfo {
    return {
      requestsPerMinute: 60,
      requestsPerDay: 10000,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async discoverTools(): Promise<McpToolDefinition[]> {
    // In a real implementation, this would use the MCP client SDK to connect
    // to the remote server and call tools/list. For now, return cached tools
    // or throw if not yet initialized.
    if (this.tools.length > 0) return this.tools;

    // Placeholder for MCP client integration
    // const client = new McpClient(this.config.transport);
    // const { tools } = await client.listTools();
    // return tools;

    logger.warn(`MCP bridge '${this.id}': Tool discovery requires active MCP client connection`);
    return [];
  }

  private async callTool(_toolName: string, _params: QueryParams): Promise<unknown> {
    // In a real implementation, this would call the MCP tool via the client SDK
    // const client = new McpClient(this.config.transport);
    // const result = await client.callTool({ name: toolName, arguments: params });
    // return result;

    throw new ServiceError(
      `MCP bridge '${this.id}': Tool execution requires active MCP client connection. ` +
        `Configure via sheets_federation for remote MCP server access.`,
      'INTERNAL_ERROR',
      'mcp-bridge',
      false
    );
  }

  private parseToolResult(endpoint: string, result: unknown): DataResult {
    // Attempt to parse various MCP tool result formats into tabular data

    // Format 1: Already tabular { headers: string[], rows: [][] }
    if (this.isTabularResult(result)) {
      const tabular = result as { headers: string[]; rows: unknown[][] };
      return {
        headers: tabular.headers,
        rows: tabular.rows.map((row) =>
          row.map((cell) => {
            if (cell === null || cell === undefined) return null;
            if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean')
              return cell;
            return String(cell);
          })
        ),
        metadata: this.meta(endpoint, tabular.rows.length),
      };
    }

    // Format 2: Array of objects → extract keys as headers
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object') {
      const objects = result as Record<string, unknown>[];
      const headers = Object.keys(objects[0]!).filter(
        (k) => typeof objects[0]![k] !== 'object' || objects[0]![k] === null
      );
      const rows = objects.map((obj) =>
        headers.map((h) => {
          const v = obj[h];
          if (v === null || v === undefined) return null;
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
          return String(v);
        })
      );
      return { headers, rows, metadata: this.meta(endpoint, rows.length) };
    }

    // Format 3: MCP content blocks → extract text
    if (this.isContentResult(result)) {
      const content = result as { content: { type: string; text?: string }[] };
      const text = content.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!)
        .join('\n');

      // Try parsing text as JSON
      try {
        const parsed = JSON.parse(text);
        return this.parseToolResult(endpoint, parsed);
      } catch {
        // Return as single text cell
        return {
          headers: ['result'],
          rows: [[text]],
          metadata: this.meta(endpoint, 1),
        };
      }
    }

    // Fallback: stringify
    return {
      headers: ['data'],
      rows: [[JSON.stringify(result)]],
      metadata: this.meta(endpoint, 1),
    };
  }

  private isTabularResult(result: unknown): boolean {
    if (typeof result !== 'object' || result === null) return false;
    const obj = result as Record<string, unknown>;
    return Array.isArray(obj['headers']) && Array.isArray(obj['rows']);
  }

  private isContentResult(result: unknown): boolean {
    if (typeof result !== 'object' || result === null) return false;
    const obj = result as Record<string, unknown>;
    return Array.isArray(obj['content']);
  }

  private mapSchemaType(jsonType: string): 'string' | 'number' | 'boolean' | 'date' {
    switch (jsonType) {
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      default:
        return 'string';
    }
  }

  private trackRequest(): void {
    const now = Date.now();
    if (now - this.lastResetTime > 60_000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
    this.requestCount++;
  }

  private meta(endpoint: string, rowCount: number): DataResult['metadata'] {
    return {
      source: this.id,
      endpoint,
      fetchedAt: new Date().toISOString(),
      rowCount,
      cached: false,
      quotaUsed: 1,
    };
  }
}
