/**
 * Tests for Well-Known Discovery Endpoints
 *
 * Tests .well-known endpoints for MCP and OAuth discovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
const toolHashMocks = vi.hoisted(() => ({
  getToolHashManifest: vi.fn(),
}));
import {
  handleMcpConfiguration,
  handleOAuthAuthorizationServer,
  handleOAuthProtectedResource,
  handleToolHashManifest,
  buildMcpConfiguration,
  buildOAuthAuthorizationServerMetadata,
  buildOAuthProtectedResourceMetadata,
  registerWellKnownHandlers,
} from '../../src/server/well-known.js';

// Mock version
vi.mock('../../src/version.js', () => ({
  VERSION: '1.6.0',
  SERVER_INFO: {
    name: 'servalsheets',
    version: '1.6.0',
    protocolVersion: '2025-11-25',
  },
  SERVER_ICONS: [],
  MCP_PROTOCOL_VERSION: '2025-11-25',
}));

// Mock schemas — use fixed test values (not imported constants) since we're testing
// that the well-known endpoint correctly passes through whatever counts it receives.
// The actual counts are validated in metadata-consistency.test.ts.
vi.mock('../../src/schemas/index.js', () => ({
  TOOL_COUNT: 22,
  ACTION_COUNT: 305,
}));

// Mock google-api
vi.mock('../../src/services/google-api.js', () => ({
  DEFAULT_SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ],
  ELEVATED_SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
  READONLY_SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/security/tool-hash-registry.js', () => ({
  getToolHashManifest: toolHashMocks.getToolHashManifest,
}));

function createMockRequest(url: string = '/'): Request {
  return {
    protocol: 'https',
    secure: true,
    headers: {
      host: 'api.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'api.example.com',
    },
    get: vi.fn((header: string) => {
      if (header === 'host') return 'api.example.com';
      return undefined;
    }),
    originalUrl: url,
    baseUrl: '',
    path: url,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

beforeEach(() => {
  toolHashMocks.getToolHashManifest.mockReset();
  toolHashMocks.getToolHashManifest.mockResolvedValue({
    generated: '2026-03-16T00:00:00.000Z',
    version: '1.6.0',
    tools: {
      sheets_auth: {
        sha256: 'abc123',
        updatedAt: '2026-03-16T00:00:00.000Z',
      },
    },
  });
});

describe('buildMcpConfiguration', () => {
  it('should build MCP configuration object', () => {
    const config = buildMcpConfiguration();

    expect(config.name).toBe('servalsheets');
    expect(config.version).toBe('1.6.0');
    expect(config.protocol_version).toBeDefined();
    expect(config.capabilities).toBeDefined();
    // These match the mocked values above
    expect(config.capabilities.tools.count).toBe(22);
    expect(config.capabilities.tools.actions).toBe(305);
    expect(config.transports).toContain('stdio');
  });

  it('should include resource capabilities', () => {
    const config = buildMcpConfiguration();

    expect(config.capabilities.resources.supported).toBe(true);
    expect(config.capabilities.resources.templates).toBe(true);
    expect(config.capabilities.resources.subscriptions).toBe(true);
  });

  it('should include prompt capabilities', () => {
    const config = buildMcpConfiguration();

    expect(config.capabilities.prompts.supported).toBe(true);
    expect(config.capabilities.prompts.count).toBeGreaterThan(0);
  });

  it('should include task capabilities', () => {
    const config = buildMcpConfiguration();

    expect(config.capabilities.tasks.supported).toBe(true);
  });

  it('should include authentication info', () => {
    const config = buildMcpConfiguration();

    expect(config.authentication.type).toBe('oauth2');
    expect(config.authentication.pkce_required).toBe(true);
    expect(config.authentication.flows).toContain('authorization_code');
  });
});

describe('buildOAuthAuthorizationServerMetadata', () => {
  it('should build OAuth AS metadata', () => {
    const issuer = 'https://api.example.com';
    const metadata = buildOAuthAuthorizationServerMetadata(issuer);

    expect(metadata.issuer).toBe(issuer);
    expect(metadata.authorization_endpoint).toContain('/oauth/authorize');
    expect(metadata.token_endpoint).toContain('/oauth/token');
    expect(metadata.response_types_supported).toContain('code');
    expect(metadata.code_challenge_methods_supported).toContain('S256');
  });

  it('should include supported scopes', () => {
    const metadata = buildOAuthAuthorizationServerMetadata('https://example.com');

    expect(metadata.scopes_supported).toBeDefined();
    expect(metadata.scopes_supported?.length).toBeGreaterThan(0);
  });

  it('should support PKCE', () => {
    const metadata = buildOAuthAuthorizationServerMetadata('https://example.com');

    expect(metadata.code_challenge_methods_supported).toContain('S256');
  });
});

describe('buildOAuthProtectedResourceMetadata', () => {
  it('should build protected resource metadata', () => {
    const resource = 'https://api.example.com/mcp';
    const authServer = 'https://accounts.google.com';
    const metadata = buildOAuthProtectedResourceMetadata(resource, authServer);

    expect(metadata.resource).toBe(resource);
    expect(metadata.authorization_servers).toContain(authServer);
    expect(metadata.scopes_supported).toBeDefined();
  });

  it('should include bearer token methods', () => {
    const metadata = buildOAuthProtectedResourceMetadata(
      'https://example.com/mcp',
      'https://auth.example.com'
    );

    expect(metadata.bearer_methods_supported).toContain('header');
  });
});

describe('handleMcpConfiguration', () => {
  it('should respond with MCP configuration JSON', () => {
    const req = createMockRequest('/.well-known/mcp-configuration');
    const res = createMockResponse();

    handleMcpConfiguration(req, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.json).toHaveBeenCalled();

    const [jsonArg] = (res.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(jsonArg.name).toBe('servalsheets');
    expect(jsonArg.capabilities).toBeDefined();
  });

  it('should set cache headers', () => {
    const req = createMockRequest();
    const res = createMockResponse();

    handleMcpConfiguration(req, res);

    expect(res.set).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('max-age'));
  });
});

describe('handleOAuthAuthorizationServer', () => {
  it('should respond with OAuth AS metadata', () => {
    const req = createMockRequest('/.well-known/oauth-authorization-server');
    const res = createMockResponse();

    handleOAuthAuthorizationServer(req, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.json).toHaveBeenCalled();

    const [jsonArg] = (res.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(jsonArg.issuer).toBeDefined();
    expect(jsonArg.authorization_endpoint).toBeDefined();
    expect(jsonArg.token_endpoint).toBeDefined();
  });
});

describe('handleOAuthProtectedResource', () => {
  it('should respond with protected resource metadata', () => {
    const req = createMockRequest('/.well-known/oauth-protected-resource');
    const res = createMockResponse();

    handleOAuthProtectedResource(req, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.json).toHaveBeenCalled();

    const [jsonArg] = (res.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(jsonArg.resource).toBeDefined();
    expect(jsonArg.authorization_servers).toBeDefined();
  });
});

describe('handleToolHashManifest', () => {
  it('should respond with tool hash manifest JSON', async () => {
    const req = createMockRequest('/.well-known/mcp/tool-hashes');
    const res = createMockResponse();

    await handleToolHashManifest(req, res);

    expect(toolHashMocks.getToolHashManifest).toHaveBeenCalledTimes(1);
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.json).toHaveBeenCalled();

    const [jsonArg] = (res.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(jsonArg.version).toBe('1.6.0');
    expect(jsonArg.tools.sheets_auth.sha256).toBe('abc123');
  });

  it('should support conditional requests with ETag', async () => {
    const req = createMockRequest('/.well-known/mcp/tool-hashes');
    const res = createMockResponse();

    await handleToolHashManifest(req, res);

    const etagCall = (res.set as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === 'ETag'
    );
    expect(etagCall?.[1]).toBeTruthy();

    const conditionalReq = createMockRequest('/.well-known/mcp/tool-hashes');
    conditionalReq.headers['if-none-match'] = etagCall?.[1] as string;
    const conditionalRes = createMockResponse();

    await handleToolHashManifest(conditionalReq, conditionalRes);

    expect(conditionalRes.status).toHaveBeenCalledWith(304);
    expect(conditionalRes.end).toHaveBeenCalled();
  });
});

describe('registerWellKnownHandlers', () => {
  it('registers the server-card alias to the same MCP card handler', () => {
    const routes = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
    const app = {
      get: vi.fn((path: string, handler: (req: Request, res: Response) => void | Promise<void>) => {
        routes.set(path, handler);
      }),
    };

    registerWellKnownHandlers(app);

    expect(routes.has('/.well-known/mcp.json')).toBe(true);
    expect(routes.has('/.well-known/mcp/server-card.json')).toBe(true);

    const primaryHandler = routes.get('/.well-known/mcp.json');
    const aliasHandler = routes.get('/.well-known/mcp/server-card.json');
    expect(primaryHandler).toBe(aliasHandler);

    const primaryReq = createMockRequest('/.well-known/mcp.json');
    const aliasReq = createMockRequest('/.well-known/mcp/server-card.json');
    const primaryRes = createMockResponse();
    const aliasRes = createMockResponse();

    primaryHandler?.(primaryReq, primaryRes);
    aliasHandler?.(aliasReq, aliasRes);

    const [primaryJson] = (primaryRes.json as ReturnType<typeof vi.fn>).mock.calls[0];
    const [aliasJson] = (aliasRes.json as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(aliasJson).toEqual(primaryJson);
  });

  it('registers the tool hash manifest endpoint', async () => {
    const routes = new Map<string, (req: Request, res: Response) => void | Promise<void>>();
    const app = {
      get: vi.fn((path: string, handler: (req: Request, res: Response) => void | Promise<void>) => {
        routes.set(path, handler);
      }),
    };

    registerWellKnownHandlers(app);

    expect(routes.has('/.well-known/mcp/tool-hashes')).toBe(true);

    const req = createMockRequest('/.well-known/mcp/tool-hashes');
    const res = createMockResponse();

    await routes.get('/.well-known/mcp/tool-hashes')?.(req, res);

    expect(res.json).toHaveBeenCalled();
  });
});
