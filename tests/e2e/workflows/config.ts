import {
  createTestHttpClient,
  type MCPClientConfig,
  type MCPHttpClient,
} from '../mcp-client-simulator.js';

export const E2E_HTTP_BASE_URL =
  process.env['TEST_HTTP_BASE_URL'] ?? 'http://127.0.0.1:3000';

export const E2E_PRIMARY_SHEET = process.env['TEST_E2E_PRIMARY_SHEET'] ?? 'TestData';

export function createWorkflowHttpClient(
  overrides?: Partial<MCPClientConfig>
): MCPHttpClient {
  return createTestHttpClient(E2E_HTTP_BASE_URL, {
    timeout: 60000,
    rateLimitRetry: {
      maxRetries: 2,
      defaultDelayMs: 2000,
    },
    ...overrides,
  });
}

type AuthStatusResult = {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: {
    response?: {
      authenticated?: boolean;
      tokenValid?: boolean;
      message?: string;
    };
  };
};

export async function assertAuthenticatedTransportClient(client: MCPHttpClient): Promise<void> {
  const result = (await client.callTool('sheets_auth', {
    request: {
      action: 'status',
    },
  })) as AuthStatusResult;

  if (result.isError === true) {
    throw new Error(result.content?.[0]?.text ?? 'Failed to determine MCP auth status');
  }

  const response = result.structuredContent?.response;
  if (response?.authenticated !== true) {
    const message =
      response?.message ??
      'Server is not authenticated. Run npm run auth and re-start the MCP HTTP server.';
    throw new Error(`E2E MCP auth required: ${message}`);
  }
}
