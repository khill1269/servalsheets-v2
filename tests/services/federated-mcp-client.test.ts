import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FederatedMcpClient } from '../../src/services/federated-mcp-client.js';

const {
  validateFederationServerUrl,
  connectMock,
  callToolMock,
  transportCtor,
} = vi.hoisted(() => ({
  validateFederationServerUrl: vi.fn(),
  connectMock: vi.fn(),
  callToolMock: vi.fn(),
  transportCtor: vi.fn(),
}));

vi.mock('../../src/services/webhook-url-validation.js', () => ({
  validateFederationServerUrl,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class StreamableHTTPClientTransport {
    constructor(url: URL, options: unknown) {
      transportCtor(url, options);
      return { url, options };
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class Client {
    connect = connectMock;
    callTool = callToolMock;
    close = vi.fn();
  },
}));

describe('FederatedMcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateFederationServerUrl.mockResolvedValue(undefined);
    connectMock.mockResolvedValue(undefined);
    callToolMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('validates the remote URL before creating the transport', async () => {
    const client = new FederatedMcpClient([
      {
        name: 'remote',
        url: 'https://example.com/mcp',
        transport: 'http',
      },
    ]);

    const result = await client.callRemoteTool('remote', 'tool_name', { value: 1 });

    expect(validateFederationServerUrl).toHaveBeenCalledWith('https://example.com/mcp');
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(transportCtor).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('fails closed when URL validation rejects', async () => {
    validateFederationServerUrl.mockRejectedValue(new Error('private network URL blocked'));
    const client = new FederatedMcpClient([
      {
        name: 'remote',
        url: 'http://127.0.0.1:3000/mcp',
        transport: 'http',
      },
    ]);

    await expect(client.callRemoteTool('remote', 'tool_name', {})).rejects.toThrow(
      'private network URL blocked'
    );
    expect(connectMock).not.toHaveBeenCalled();
    expect(transportCtor).not.toHaveBeenCalled();
  });
});
