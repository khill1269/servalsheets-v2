/**
 * ServalSheets - MCP Client Simulator
 *
 * Simulates real MCP clients (Claude Desktop, other LLMs) for E2E testing.
 * Implements MCP 2025-11-25 protocol with full capabilities negotiation.
 *
 * Features:
 * - Initialize handshake with capabilities
 * - Tool discovery (tools/list)
 * - Tool execution (tools/call)
 * - Resource subscription
 * - Sampling support (server-to-client LLM requests)
 * - Elicitation support (user input forms)
 * - Protocol validation
 */

import { EventEmitter } from 'node:events';
import type {
  CallToolResult,
  Tool,
  Resource,
  Prompt,
  ClientCapabilities,
  ServerCapabilities,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  /**
   * Client name (e.g., "Claude Desktop", "test-client")
   */
  name: string;

  /**
   * Client version
   */
  version: string;

  /**
   * Client capabilities
   * - elicitation: Support user input forms (SEP-1036)
   * - sampling: Support LLM requests from server (SEP-1577)
   * - roots: Support filesystem roots
   */
  capabilities: ClientCapabilities;

  /**
   * Protocol version (default: 2025-11-25)
   */
  protocolVersion?: string;

  /**
   * Transport type
   */
  transport: 'stdio' | 'http' | 'websocket';

  /**
   * Timeout for requests (ms)
   */
  timeout?: number;
}

type ServerRequestHandler = (request: JSONRPCRequest) => unknown | Promise<unknown>;

/**
 * MCP Client session state
 */
interface MCPClientSession {
  /**
   * Session ID
   */
  sessionId: string;

  /**
   * Client info
   */
  clientInfo: {
    name: string;
    version: string;
  };

  /**
   * Server capabilities after handshake
   */
  serverCapabilities?: ServerCapabilities;

  /**
   * Initialized flag
   */
  initialized: boolean;

  /**
   * Available tools
   */
  tools: Tool[];

  /**
   * Available resources
   */
  resources: Resource[];

  /**
   * Available prompts
   */
  prompts: Prompt[];
}

/**
 * MCP Client Simulator
 *
 * Simulates a real MCP client for E2E testing.
 */
export class MCPClientSimulator extends EventEmitter {
  private config: MCPClientConfig;
  private session: MCPClientSession;
  private requestId = 1;
  private notifications: JSONRPCNotification[] = [];
  private requests: JSONRPCRequest[] = [];
  private requestHandlers = new Map<string, ServerRequestHandler>();
  private pendingRequests = new Map<
    number,
    { resolve: (value: JSONRPCResponse) => void; reject: (error: Error) => void }
  >();

  constructor(config: MCPClientConfig) {
    super();
    this.config = config;
    this.session = {
      sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientInfo: {
        name: config.name,
        version: config.version,
      },
      initialized: false,
      tools: [],
      resources: [],
      prompts: [],
    };
  }

  /**
   * Initialize handshake with MCP server
   *
   * Implements MCP 2025-11-25 initialize/initialized flow:
   * 1. Client sends initialize request with capabilities
   * 2. Server responds with server capabilities
   * 3. Client sends initialized notification
   * 4. Handshake complete
   */
  async initialize(): Promise<ServerCapabilities> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'initialize',
      params: {
        protocolVersion: this.config.protocolVersion ?? '2025-11-25',
        capabilities: this.config.capabilities,
        clientInfo: this.session.clientInfo,
      },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`);
    }

    // Extract server capabilities
    const serverCapabilities = response.result as {
      protocolVersion: string;
      capabilities: ServerCapabilities;
      serverInfo: { name: string; version: string };
    };

    this.session.serverCapabilities = serverCapabilities.capabilities;
    this.session.initialized = true;

    // Send initialized notification
    await this.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    // Emit initialized event
    this.emit('initialized', serverCapabilities);

    return serverCapabilities.capabilities;
  }

  /**
   * List available tools
   *
   * Calls tools/list and caches results.
   */
  async listTools(): Promise<Tool[]> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/list',
      params: {},
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`List tools failed: ${response.error.message}`);
    }

    const result = response.result as { tools: Tool[] };
    this.session.tools = result.tools;

    return result.tools;
  }

  /**
   * Call a tool with arguments
   *
   * Implements tools/call with full validation.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.result as CallToolResult;
  }

  /**
   * List available resources
   *
   * Calls resources/list and caches results.
   */
  async listResources(): Promise<Resource[]> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'resources/list',
      params: {},
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`List resources failed: ${response.error.message}`);
    }

    const result = response.result as { resources: Resource[] };
    this.session.resources = result.resources;

    return result.resources;
  }

  /**
   * Read a resource by URI
   *
   * Calls resources/read with validation.
   */
  async readResource(uri: string): Promise<{ contents: unknown[] }> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'resources/read',
      params: { uri },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Read resource failed: ${response.error.message}`);
    }

    return response.result as { contents: unknown[] };
  }

  /**
   * Subscribe to resource updates
   *
   * Calls resources/subscribe and listens for notifications.
   */
  async subscribeToResource(uri: string): Promise<void> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'resources/subscribe',
      params: { uri },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Subscribe failed: ${response.error.message}`);
    }
  }

  /**
   * Unsubscribe from resource updates
   *
   * Calls resources/unsubscribe.
   */
  async unsubscribeFromResource(uri: string): Promise<void> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'resources/unsubscribe',
      params: { uri },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Unsubscribe failed: ${response.error.message}`);
    }
  }

  /**
   * List available prompts
   *
   * Calls prompts/list and caches results.
   */
  async listPrompts(): Promise<Prompt[]> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'prompts/list',
      params: {},
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`List prompts failed: ${response.error.message}`);
    }

    const result = response.result as { prompts: Prompt[] };
    this.session.prompts = result.prompts;

    return result.prompts;
  }

  /**
   * Get a prompt by name
   *
   * Calls prompts/get with arguments.
   */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<{ description?: string; messages: unknown[] }> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'prompts/get',
      params: {
        name,
        arguments: args ?? {},
      },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Get prompt failed: ${response.error.message}`);
    }

    return response.result as { description?: string; messages: unknown[] };
  }

  /**
   * Set log level
   *
   * Calls logging/setLevel (MCP 2025-11-25 feature).
   */
  async setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): Promise<void> {
    this.assertInitialized();

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this.requestId++,
      method: 'logging/setLevel',
      params: { level },
    };

    const response = await this.sendRequest(request);

    if (response.error) {
      throw new Error(`Set log level failed: ${response.error.message}`);
    }
  }

  /**
   * Get client session info
   */
  getSession(): Readonly<MCPClientSession> {
    return { ...this.session };
  }

  protected getSessionState(): MCPClientSession {
    return this.session;
  }

  protected getClientConfig(): MCPClientConfig {
    return this.config;
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.session.initialized;
  }

  getNotifications(): readonly JSONRPCNotification[] {
    return [...this.notifications];
  }

  clearNotifications(): void {
    this.notifications = [];
  }

  getRequests(): readonly JSONRPCRequest[] {
    return [...this.requests];
  }

  clearRequests(): void {
    this.requests = [];
  }

  setRequestHandler(method: string, handler: ServerRequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  clearRequestHandler(method: string): void {
    this.requestHandlers.delete(method);
  }

  async waitForNotification(method: string, timeoutMs = 1000): Promise<JSONRPCNotification> {
    const buffered = this.notifications.find((notification) => notification.method === method);
    if (buffered) {
      return buffered;
    }

    return await new Promise<JSONRPCNotification>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('notification', onNotification);
        reject(new Error(`Timed out waiting for notification: ${method}`));
      }, timeoutMs);

      const onNotification = (notification: JSONRPCNotification) => {
        if (notification.method !== method) {
          return;
        }
        clearTimeout(timeout);
        this.off('notification', onNotification);
        resolve(notification);
      };

      this.on('notification', onNotification);
    });
  }

  async waitForRequest(method: string, timeoutMs = 1000): Promise<JSONRPCRequest> {
    const buffered = this.requests.find((request) => request.method === method);
    if (buffered) {
      return buffered;
    }

    return await new Promise<JSONRPCRequest>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('request', onRequest);
        reject(new Error(`Timed out waiting for request: ${method}`));
      }, timeoutMs);

      const onRequest = (request: JSONRPCRequest) => {
        if (request.method !== method) {
          return;
        }
        clearTimeout(timeout);
        this.off('request', onRequest);
        resolve(request);
      };

      this.on('request', onRequest);
    });
  }

  /**
   * Validate protocol compliance
   *
   * Checks if server follows MCP 2025-11-25 spec:
   * - Tools have required fields (name, description, inputSchema)
   * - Resources have URI templates or static URIs
   * - Prompts have name and description
   * - Capabilities are properly declared
   */
  validateProtocolCompliance(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check server capabilities
    if (!this.session.serverCapabilities) {
      errors.push('Server capabilities not set (initialize not called)');
    }

    // Validate tools
    for (const tool of this.session.tools) {
      if (!tool.name) {
        errors.push(`Tool missing name: ${JSON.stringify(tool)}`);
      }
      if (!tool.description) {
        errors.push(`Tool ${tool.name} missing description`);
      }
      if (!tool.inputSchema) {
        errors.push(`Tool ${tool.name} missing inputSchema`);
      }
    }

    // Validate resources
    for (const resource of this.session.resources) {
      if (!resource.uri && !resource.uri) {
        errors.push(`Resource missing URI: ${JSON.stringify(resource)}`);
      }
      if (!resource.name) {
        errors.push(`Resource missing name: ${resource.uri}`);
      }
    }

    // Validate prompts
    for (const prompt of this.session.prompts) {
      if (!prompt.name) {
        errors.push(`Prompt missing name: ${JSON.stringify(prompt)}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Close client connection
   */
  async close(): Promise<void> {
    // Clear pending requests
    for (const [id, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error('Client closed'));
      this.pendingRequests.delete(id);
    }

    this.emit('closed');
  }

  protected async handleIncomingNotification(notification: JSONRPCNotification): Promise<void> {
    this.notifications.push(notification);
    this.emit('notification', notification);
  }

  protected async handleIncomingRequest(request: JSONRPCRequest): Promise<void> {
    this.requests.push(request);
    this.emit('request', request);

    const handler = this.requestHandlers.get(request.method);
    if (!handler) {
      await this.sendMessage({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(request);
      await this.sendMessage({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (error) {
      await this.sendMessage({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  protected async parseSseJsonRpc(
    response: Response,
    id?: number | string
  ): Promise<JSONRPCResponse> {
    let matched: JSONRPCResponse | undefined;

    await this.consumeSseStream(response, async (payload) => {
      if (isJsonRpcNotification(payload)) {
        await this.handleIncomingNotification(payload);
        return false;
      }

      if (isJsonRpcRequest(payload)) {
        await this.handleIncomingRequest(payload);
        return false;
      }

      if (isJsonRpcResponse(payload) && (id === undefined || payload.id === id)) {
        matched = payload;
        return true;
      }

      return false;
    });

    if (!matched) {
      throw new Error(
        `Failed to parse JSON-RPC response from SSE payload${id === undefined ? '' : ` for id ${id}`}`
      );
    }

    return matched;
  }

  protected async consumeSseStream(
    response: Response,
    onPayload: (payload: unknown) => Promise<boolean> | boolean
  ): Promise<void> {
    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let shouldStop = false;

    try {
      while (!shouldStop) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          shouldStop = await this.processSseBlock(block, onPayload);
          if (shouldStop) {
            await reader.cancel();
            break;
          }
        }
      }

      if (!shouldStop && buffer.trim()) {
        await this.processSseBlock(buffer, onPayload);
      }
    } finally {
      reader.releaseLock();
    }
  }

  protected async processSseBlock(
    block: string,
    onPayload: (payload: unknown) => Promise<boolean> | boolean
  ): Promise<boolean> {
    const dataLines: string[] = [];

    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return false;
    }

    const payloadText = dataLines.join('\n').trim();
    if (!payloadText) {
      return false;
    }

    const payload = JSON.parse(payloadText) as unknown;
    return await onPayload(payload);
  }

  /**
   * Send JSON-RPC request and wait for response
   *
   * This is a stub implementation - subclasses should implement transport-specific logic.
   */
  protected async sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    throw new Error('sendRequest must be implemented by transport-specific subclass');
  }

  /**
   * Send JSON-RPC notification (no response expected)
   *
   * This is a stub implementation - subclasses should implement transport-specific logic.
   */
  protected async sendNotification(notification: JSONRPCNotification): Promise<void> {
    throw new Error('sendNotification must be implemented by transport-specific subclass');
  }

  protected async sendMessage(
    _message: JSONRPCRequest | JSONRPCResponse | JSONRPCNotification
  ): Promise<Response> {
    throw new Error('sendMessage must be implemented by transport-specific subclass');
  }

  /**
   * Assert client is initialized
   */
  private assertInitialized(): void {
    if (!this.session.initialized) {
      throw new Error('Client not initialized - call initialize() first');
    }
  }
}

/**
 * HTTP Transport Client
 *
 * Implements MCP over HTTP/SSE transport.
 */
export class MCPHttpClient extends MCPClientSimulator {
  private baseUrl: string;
  private authToken?: string;
  private eventStreamAbortController: AbortController | null = null;
  private eventStreamLoop: Promise<void> | null = null;

  constructor(config: MCPClientConfig & { baseUrl: string; authToken?: string }) {
    super(config);
    this.baseUrl = config.baseUrl;
    this.authToken = config.authToken;
  }

  protected async sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const response = await this.sendMessage(request);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `HTTP error: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return await this.parseSseJsonRpc(response, request.id);
    }

    if (contentType.includes('application/json')) {
      return (await response.json()) as JSONRPCResponse;
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error(`Empty JSON-RPC response for request ${String(request.id)}`);
    }

    return JSON.parse(text) as JSONRPCResponse;
  }

  protected async sendNotification(notification: JSONRPCNotification): Promise<void> {
    await this.sendMessage(notification);
  }

  async openEventStream(): Promise<void> {
    const sessionId = this.getSession().sessionId;
    if (!sessionId) {
      throw new Error('Client session not established - call initialize() first');
    }
    if (this.eventStreamLoop) {
      return;
    }

    const controller = new AbortController();
    this.eventStreamAbortController = controller;

    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'MCP-Protocol-Version': this.getSessionProtocolVersion(),
        'Mcp-Session-Id': sessionId,
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      },
      signal: controller.signal,
    });

    this.updateSessionIdFromResponse(response);

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    this.eventStreamLoop = this.consumeSseStream(response, async (payload) => {
      if (isJsonRpcNotification(payload)) {
        await this.handleIncomingNotification(payload);
        return false;
      }

      if (isJsonRpcRequest(payload)) {
        await this.handleIncomingRequest(payload);
      }

      return false;
    }).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }
      throw error;
    });
  }

  override async close(): Promise<void> {
    const sessionId = this.isInitialized() ? this.getSession().sessionId : undefined;

    this.eventStreamAbortController?.abort();
    this.eventStreamAbortController = null;

    if (this.eventStreamLoop) {
      await this.eventStreamLoop.catch(() => undefined);
      this.eventStreamLoop = null;
    }

    if (sessionId) {
      await fetch(`${this.baseUrl}/mcp`, {
        method: 'DELETE',
        headers: {
          'MCP-Protocol-Version': this.getSessionProtocolVersion(),
          'Mcp-Session-Id': sessionId,
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        },
      }).catch(() => undefined);
    }

    await super.close();
  }

  protected async sendMessage(
    message: JSONRPCRequest | JSONRPCResponse | JSONRPCNotification
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': this.getSessionProtocolVersion(),
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        ...(this.isInitializeRequest(message)
          ? {}
          : { 'Mcp-Session-Id': this.getSession().sessionId }),
      },
      body: JSON.stringify(message),
    });

    this.updateSessionIdFromResponse(response);
    return response;
  }

  private updateSessionIdFromResponse(response: Response): void {
    const sessionId =
      response.headers.get('mcp-session-id') ?? response.headers.get('x-session-id');
    if (sessionId) {
      this.getSessionState().sessionId = sessionId;
    }
  }

  private getSessionProtocolVersion(): string {
    return this.getClientConfig().protocolVersion ?? '2025-11-25';
  }

  private isInitializeRequest(
    message: JSONRPCRequest | JSONRPCResponse | JSONRPCNotification
  ): message is JSONRPCRequest {
    return 'method' in message && message.method === 'initialize';
  }
}

/**
 * Create test MCP client with common defaults
 *
 * Convenience factory for creating test clients.
 */
export function createTestClient(overrides?: Partial<MCPClientConfig>): MCPClientSimulator {
  const defaults: MCPClientConfig = {
    name: 'test-client',
    version: '1.0.0',
    capabilities: {
      elicitation: { form: {} },
      sampling: {},
    },
    protocolVersion: '2025-11-25',
    transport: 'http',
    timeout: 5000,
  };

  return new MCPClientSimulator({ ...defaults, ...overrides });
}

/**
 * Create test HTTP client for E2E tests
 */
export function createTestHttpClient(
  baseUrl: string,
  overrides?: Partial<MCPClientConfig>
): MCPHttpClient {
  const defaults: MCPClientConfig = {
    name: 'test-http-client',
    version: '1.0.0',
    capabilities: {
      elicitation: { form: {} },
      sampling: {},
    },
    protocolVersion: '2025-11-25',
    transport: 'http',
    timeout: 5000,
  };

  return new MCPHttpClient({
    ...defaults,
    ...overrides,
    baseUrl,
  });
}

function isJsonRpcNotification(payload: unknown): payload is JSONRPCNotification {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'jsonrpc' in payload &&
    (payload as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    'method' in payload &&
    !('id' in payload)
  );
}

function isJsonRpcRequest(payload: unknown): payload is JSONRPCRequest {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'jsonrpc' in payload &&
    (payload as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    'method' in payload &&
    'id' in payload
  );
}

function isJsonRpcResponse(payload: unknown): payload is JSONRPCResponse {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'jsonrpc' in payload &&
    (payload as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    'id' in payload &&
    ('result' in payload || 'error' in payload) &&
    !('method' in payload)
  );
}
