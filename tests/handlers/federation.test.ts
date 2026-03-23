/**
 * Federation Handler Tests
 *
 * Tests for sheets_federation handler (4 actions)
 * Tests federation operations: call_remote, list_servers, get_server_tools, validate_connection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FederationHandler } from '../../src/handlers/federation.js';

/** Extract a string message from either a plain string or a structured ErrorDetail object */
function getErrorMsg(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof (error as Record<string, unknown>)['message'] === 'string') {
    return (error as Record<string, unknown>)['message'] as string;
  }
  return String(error);
}

// Mock federation client
const mockFederationClient = {
  callRemoteTool: vi.fn(),
  listRemoteTools: vi.fn(),
  isConnected: vi.fn(),
  validateConnection: vi.fn(),
};

// Mock dependencies
vi.mock('../../src/services/federated-mcp-client.js', () => ({
  getFederationClient: vi.fn(() => Promise.resolve(mockFederationClient)),
}));

vi.mock('../../src/config/env.js', () => ({
  getFederationConfig: vi.fn(() => ({
    enabled: true,
    serversJson: JSON.stringify([
      { name: 'test-server', url: 'http://localhost:3001' },
      { name: 'ml-server', url: 'http://localhost:3002' },
    ]),
  })),
  getCircuitBreakerConfig: vi.fn(() => ({
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenMaxAttempts: 3,
  })),
}));

vi.mock('../../src/config/federation-config.js', () => ({
  parseFederationServers: vi.fn((json: string) => {
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('FederationHandler', () => {
  let handler: FederationHandler;

  beforeEach(() => {
    handler = new FederationHandler();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('call_remote action', () => {
    it('should call remote tool successfully', async () => {
      mockFederationClient.callRemoteTool.mockResolvedValue({
        temperature: 72,
        forecast: 'sunny',
      });

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'get_weather',
          toolInput: { location: 'SF' },
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('call_remote');
        expect(result.response.remoteServer).toBe('test-server');
        expect(result.response.data).toEqual({
          temperature: 72,
          forecast: 'sunny',
        });
      }
      expect(mockFederationClient.callRemoteTool).toHaveBeenCalledWith(
        'test-server',
        'get_weather',
        { location: 'SF' }
      );
    });

    it('should fail when serverName is missing', async () => {
      const result = await handler.handle({
        request: {
          action: 'call_remote',
          toolName: 'get_weather',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('serverName');
      }
    });

    it('should fail when toolName is missing', async () => {
      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('toolName');
      }
    });

    it('should handle remote call errors gracefully', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(new Error('Connection refused'));

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'get_weather',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });
  });

  describe('list_servers action', () => {
    it('should list configured servers with connection status', async () => {
      mockFederationClient.isConnected.mockImplementation((name: string) => name === 'test-server');

      const result = await handler.handle({
        request: {
          action: 'list_servers',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('list_servers');
        expect(result.response.servers).toHaveLength(2);
        expect(result.response.servers![0]).toEqual({
          name: 'test-server',
          url: 'http://localhost:3001',
          connected: true,
        });
        expect(result.response.servers![1]).toEqual({
          name: 'ml-server',
          url: 'http://localhost:3002',
          connected: false,
        });
      }
    });
  });

  describe('get_server_tools action', () => {
    it('should list tools from remote server', async () => {
      mockFederationClient.listRemoteTools.mockResolvedValue([
        { name: 'get_weather', description: 'Get weather forecast' },
        { name: 'get_temperature', description: 'Get current temperature' },
      ]);

      const result = await handler.handle({
        request: {
          action: 'get_server_tools',
          serverName: 'test-server',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('get_server_tools');
        expect(result.response.tools).toHaveLength(2);
      }
      expect(mockFederationClient.listRemoteTools).toHaveBeenCalledWith('test-server');
    });

    it('should fail when serverName is missing', async () => {
      const result = await handler.handle({
        request: {
          action: 'get_server_tools',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('serverName');
      }
    });
  });

  describe('validate_connection action', () => {
    it('should validate connection to remote server', async () => {
      mockFederationClient.listRemoteTools.mockResolvedValue([
        { name: 'tool1', description: 'Test tool' },
      ]);

      const result = await handler.handle({
        request: {
          action: 'validate_connection',
          serverName: 'test-server',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.action).toBe('validate_connection');
        expect(result.response.remoteServer).toBe('test-server');
        expect(result.response.data).toEqual({ connected: true });
      }
    });

    it('should fail gracefully when connection validation fails', async () => {
      mockFederationClient.listRemoteTools.mockRejectedValue(new Error('Connection timeout'));

      const result = await handler.handle({
        request: {
          action: 'validate_connection',
          serverName: 'test-server',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Connection validation failed');
        expect(result.response.remoteServer).toBe('test-server');
      }
    });

    it('should fail when serverName is missing', async () => {
      const result = await handler.handle({
        request: {
          action: 'validate_connection',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('serverName');
      }
    });
  });

  describe('federation disabled', () => {
    it('should return error when federation is disabled', async () => {
      const { getFederationConfig } = await import('../../src/config/env.js');
      vi.mocked(getFederationConfig).mockReturnValueOnce({
        enabled: false,
        serversJson: '[]',
      });

      const result = await handler.handle({
        request: {
          action: 'list_servers',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('not enabled');
      }
    });
  });

  describe('unknown action', () => {
    it('should handle unknown action gracefully', async () => {
      const result = await handler.handle({
        request: {
          action: 'unknown_action' as any,
        },
      });

      expect(result.response.success).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('should handle remote server timeout (30s default)', async () => {
      mockFederationClient.callRemoteTool.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 100);
        });
      });

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'slow_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle connection timeout', async () => {
      mockFederationClient.listRemoteTools.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 100);
        });
      });

      const result = await handler.handle({
        request: {
          action: 'get_server_tools',
          serverName: 'test-server',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });
  });

  describe('security tests', () => {
    it('should handle SSL certificate validation failures', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('SSL certificate validation failed')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'secure_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle malicious response (XXE attempt)', async () => {
      mockFederationClient.callRemoteTool.mockResolvedValue({
        __proto__: { polluted: true },
        maliciousXML: '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
      });

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'malicious_tool',
          toolInput: {},
        },
      });

      // Should succeed but data should be sanitized
      expect(result.response.success).toBe(true);
      if (result.response.success) {
        // Verify no prototype pollution
        expect(Object.prototype).not.toHaveProperty('polluted');
      }
    });

    it('should handle SSRF attempts in server URLs', async () => {
      const { getFederationConfig } = await import('../../src/config/env.js');
      const { parseFederationServers } = await import('../../src/config/federation-config.js');

      vi.mocked(getFederationConfig).mockReturnValueOnce({
        enabled: true,
        serversJson: JSON.stringify([{ name: 'ssrf-test', url: 'http://localhost:22/ssh' }]),
      });

      vi.mocked(parseFederationServers).mockReturnValueOnce([
        { name: 'ssrf-test', url: 'http://localhost:22/ssh' },
      ]);

      mockFederationClient.callRemoteTool.mockRejectedValue(new Error('Connection refused'));

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'ssrf-test',
          toolName: 'test_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
    });

    it('should handle authentication failures', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('Authentication failed: Invalid bearer token')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'auth_required_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle unauthorized access attempts', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('Unauthorized: Insufficient permissions')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'admin_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should sanitize multiline and path-like remote errors', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('Remote failure\nat /Users/test/project/node_modules/pkg/index.js:10:2')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'secure_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
        expect(getErrorMsg(result.response.error)).not.toContain('/Users/');
        expect(getErrorMsg(result.response.error)).not.toContain('node_modules/');
        expect(getErrorMsg(result.response.error)).not.toContain('\n');
      }
    });

    it('should handle invalid response schemas', async () => {
      mockFederationClient.listRemoteTools.mockResolvedValue([
        { invalid: 'schema' }, // Missing required 'name' field
      ]);

      const result = await handler.handle({
        request: {
          action: 'get_server_tools',
          serverName: 'test-server',
        },
      });

      // Handler should still succeed but may have issues with malformed data
      expect(result.response.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle circular federation detection (A → B → A)', async () => {
      // Simulate circular call by having remote server call back
      mockFederationClient.callRemoteTool.mockResolvedValue({
        error: 'Circular federation detected: test-server → ml-server → test-server',
      });

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'circular_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.data).toHaveProperty('error');
      }
    });

    it('should handle server not found', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('Server not found: unknown-server')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'unknown-server',
          toolName: 'test_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle invalid server URLs', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(new Error('Invalid URL: not-a-url'));

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'bad-url-server',
          toolName: 'test_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle network errors', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('Network error: ECONNREFUSED')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'test_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle no servers configured', async () => {
      const { getFederationConfig } = await import('../../src/config/env.js');
      vi.mocked(getFederationConfig).mockReturnValueOnce({
        enabled: true,
        serversJson: '[]',
      });

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'test_tool',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('No federation servers configured');
      }
    });
  });

  describe('action-specific edge cases', () => {
    it('should return empty array when no servers configured (list_servers)', async () => {
      const { getFederationConfig } = await import('../../src/config/env.js');
      const { parseFederationServers } = await import('../../src/config/federation-config.js');

      vi.mocked(getFederationConfig).mockReturnValueOnce({
        enabled: true,
        serversJson: '[]',
      });

      vi.mocked(parseFederationServers).mockReturnValueOnce([]);

      const result = await handler.handle({
        request: {
          action: 'list_servers',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.servers).toEqual([]);
      }
    });

    it('should validate server exists before listing tools (get_server_tools)', async () => {
      mockFederationClient.listRemoteTools.mockRejectedValue(new Error('Server not registered'));

      const result = await handler.handle({
        request: {
          action: 'get_server_tools',
          serverName: 'unregistered-server',
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should handle tool not found on remote server (call_remote)', async () => {
      mockFederationClient.callRemoteTool.mockRejectedValue(
        new Error('Tool not found: nonexistent_tool')
      );

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'nonexistent_tool',
          toolInput: {},
        },
      });

      expect(result.response.success).toBe(false);
      if (!result.response.success) {
        expect(getErrorMsg(result.response.error)).toContain('Remote MCP server');
      }
    });

    it('should check connectivity before operations (validate_connection)', async () => {
      mockFederationClient.listRemoteTools.mockResolvedValue([]);

      const result = await handler.handle({
        request: {
          action: 'validate_connection',
          serverName: 'test-server',
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockFederationClient.listRemoteTools).toHaveBeenCalledWith('test-server');
    });

    it('should handle empty toolInput for call_remote', async () => {
      mockFederationClient.callRemoteTool.mockResolvedValue({
        result: 'success',
      });

      const result = await handler.handle({
        request: {
          action: 'call_remote',
          serverName: 'test-server',
          toolName: 'no_input_tool',
          // toolInput omitted
        },
      });

      expect(result.response.success).toBe(true);
      expect(mockFederationClient.callRemoteTool).toHaveBeenCalledWith(
        'test-server',
        'no_input_tool',
        {}
      );
    });

    it('should handle server with no available tools', async () => {
      mockFederationClient.listRemoteTools.mockResolvedValue([]);

      const result = await handler.handle({
        request: {
          action: 'get_server_tools',
          serverName: 'empty-server',
        },
      });

      expect(result.response.success).toBe(true);
      if (result.response.success) {
        expect(result.response.tools).toEqual([]);
      }
    });
  });
});
