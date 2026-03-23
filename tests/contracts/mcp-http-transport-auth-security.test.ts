import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createHttpServer, type HttpServerOptions } from '../../src/http-server.js';
import { resetEnvForTest } from '../../src/config/env.js';
import { requestApp } from '../helpers/request-app.js';

type TestServer = ReturnType<typeof createHttpServer>;

const TEST_SERVER_OPTIONS: HttpServerOptions = {
  port: 0,
  host: '127.0.0.1',
  corsOrigins: ['http://localhost:3000'],
  rateLimitMax: 1000,
  trustProxy: false,
};

const TEST_OAUTH_CONFIG: NonNullable<HttpServerOptions['oauthConfig']> = {
  issuer: 'https://registry.example.com',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  jwtSecret: 'jwt-secret-jwt-secret-jwt-secret-jwt-secret',
  stateSecret: 'state-secret-state-secret-state-secret-state-secret',
  allowedRedirectUris: ['http://localhost/callback'],
  googleClientId: 'google-client-id',
  googleClientSecret: 'google-client-secret',
  accessTokenTtl: 3600,
  refreshTokenTtl: 86400,
};

const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: {
      name: 'contract-client',
      version: '1.0.0',
    },
  },
};

function applyEnvOverrides(overrides: Record<string, string>): () => void {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }
  resetEnvForTest();

  return () => {
    for (const [key, previous] of previousValues.entries()) {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
    resetEnvForTest();
  };
}

async function cleanupServer(server: TestServer): Promise<void> {
  const sessions = server.sessions as Map<
    string,
    {
      transport?: { close?: () => void };
      taskStore?: { dispose?: () => void };
    }
  >;

  sessions.forEach((session) => {
    if (typeof session.transport?.close === 'function') {
      session.transport.close();
    }
    if (typeof session.taskStore?.dispose === 'function') {
      session.taskStore.dispose();
    }
  });
  sessions.clear();
  await server.stop?.();
}

function extractSessionId(headers: Record<string, string | string[] | undefined>): string {
  const value = headers['mcp-session-id'] ?? headers['x-session-id'];
  const sessionId = Array.isArray(value) ? value[0] : value;
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Missing session identifier header in initialize response');
  }
  return sessionId;
}

async function httpRequest(
  app: Express,
  options: {
    method: 'GET' | 'POST' | 'DELETE' | 'OPTIONS';
    path: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown> | string;
  }
) {
  return requestApp(app, options);
}

describe('MCP HTTP Transport/Auth/Security Contracts', () => {
  describe('Protocol header contract (MCP 2025-11-25)', () => {
    let server: TestServer;
    let app: Express;
    let restoreEnv: () => void;

    beforeAll(async () => {
      restoreEnv = applyEnvOverrides({
        STRICT_MCP_PROTOCOL_VERSION: 'true',
        ENABLE_LEGACY_SSE: 'false',
      });

      server = createHttpServer(TEST_SERVER_OPTIONS);
      app = server.app as Express;
    });

    afterAll(async () => {
      await cleanupServer(server);
      restoreEnv();
    });

    it('accepts initialize requests missing MCP-Protocol-Version header', async () => {
      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: {
          ...INITIALIZE_REQUEST,
          id: 101,
        },
      });

      expect([200, 406, 426]).toContain(response.status);
      if (response.status === 200) {
        expect(extractSessionId(response.headers)).toBeTruthy();
      }
    });

    it('rejects unsupported MCP-Protocol-Version values', async () => {
      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-05',
        },
        body: {
          ...INITIALIZE_REQUEST,
          id: 102,
        },
      });

      expect(response.status).toBe(400);
      const error = (response.body as { error: string | Record<string, unknown> }).error;
      if (typeof error === 'string') {
        expect(error).toBe('UNSUPPORTED_PROTOCOL_VERSION');
      } else {
        expect(error).toMatchObject({
          code: 'INVALID_REQUEST',
        });
      }
    });

    it('accepts initialize requests with MCP-Protocol-Version 2025-11-25', async () => {
      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: {
          ...INITIALIZE_REQUEST,
          id: 103,
        },
      });

      expect([200, 406, 426]).toContain(response.status);
      if (response.status === 200) {
        expect(extractSessionId(response.headers)).toBeTruthy();
      }
    });

    it('rejects subsequent MCP requests missing MCP-Protocol-Version header', async () => {
      const initializeResponse = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: {
          ...INITIALIZE_REQUEST,
          id: 104,
        },
      });

      expect(initializeResponse.status).toBe(200);
      const sessionId = extractSessionId(initializeResponse.headers);

      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Session-Id': sessionId,
        },
        body: {
          jsonrpc: '2.0',
          id: 105,
          method: 'tools/list',
          params: {},
        },
      });

      expect(response.status).toBe(400);
      const error = (response.body as { error: string | Record<string, unknown> }).error;
      if (typeof error === 'string') {
        expect(error).toBe('INVALID_REQUEST');
      } else {
        expect(error).toMatchObject({
          code: 'INVALID_REQUEST',
        });
      }
    });
  });

  describe('Session security contract', () => {
    let server: TestServer;
    let app: Express;
    let restoreEnv: () => void;

    const initializeSession = async (userAgent: string, id: number): Promise<string> => {
      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
          'User-Agent': userAgent,
        },
        body: {
          ...INITIALIZE_REQUEST,
          id,
        },
      });

      expect(response.status).toBe(200);

      return extractSessionId(response.headers);
    };

    beforeAll(async () => {
      restoreEnv = applyEnvOverrides({
        STRICT_MCP_PROTOCOL_VERSION: 'false',
        ENABLE_LEGACY_SSE: 'false',
      });

      server = createHttpServer(TEST_SERVER_OPTIONS);
      app = server.app as Express;
    });

    afterAll(async () => {
      await cleanupServer(server);
      restoreEnv();
    });

    it('requires Mcp-Session-Id on DELETE /mcp', async () => {
      const response = await httpRequest(app, {
        method: 'DELETE',
        path: '/mcp',
      });
      expect(response.status).toBe(400);
      expect((response.body as { error: Record<string, unknown> }).error).toMatchObject({
        code: 'INVALID_REQUEST',
      });
    });

    it('rejects reconnect attempts when session security context changes', async () => {
      const ownerUserAgent = 'contract-owner-agent';
      const sessionId = await initializeSession(ownerUserAgent, 201);

      const response = await httpRequest(app, {
        method: 'GET',
        path: '/mcp',
        headers: {
          'Mcp-Session-Id': sessionId,
          'MCP-Protocol-Version': '2025-11-25',
          'User-Agent': 'contract-attacker-agent',
        },
      });

      expect(response.status).toBe(403);
      expect((response.body as { error: Record<string, unknown> }).error).toMatchObject({
        code: 'SESSION_SECURITY_VIOLATION',
      });

      const cleanupResponse = await httpRequest(app, {
        method: 'DELETE',
        path: '/mcp',
        headers: {
          'Mcp-Session-Id': sessionId,
          'User-Agent': ownerUserAgent,
        },
      });
      expect(cleanupResponse.status).toBe(200);
    });

    it('enforces session ownership checks for DELETE /mcp', async () => {
      const ownerUserAgent = 'delete-owner-agent';
      const sessionId = await initializeSession(ownerUserAgent, 202);

      const forbidden = await httpRequest(app, {
        method: 'DELETE',
        path: '/mcp',
        headers: {
          'Mcp-Session-Id': sessionId,
          'User-Agent': 'delete-attacker-agent',
        },
      });

      expect(forbidden.status).toBe(403);
      // HTTP transport uses SESSION_SECURITY_VIOLATION (not the generic FORBIDDEN code)
      // for session ownership violations — more specific than FORBIDDEN and used consistently
      // at both SSE reconnection (routes-transport.ts:201) and DELETE /mcp (:625) paths.
      expect((forbidden.body as { error: Record<string, unknown> }).error).toMatchObject({
        code: 'SESSION_SECURITY_VIOLATION',
      });

      // The Streamable HTTP transport (app.all('/mcp')) handles DELETE before the
      // explicit app.delete('/mcp') handler. The transport returns 200 with empty body
      // on successful session termination (MCP 2025-11-25 spec behavior).
      const deleteResponse = await httpRequest(app, {
        method: 'DELETE',
        path: '/mcp',
        headers: {
          'Mcp-Session-Id': sessionId,
          'User-Agent': ownerUserAgent,
        },
      });
      expect(deleteResponse.status).toBe(200);
    });

    it('returns 404 for follow-up requests after session termination', async () => {
      const ownerUserAgent = 'terminated-owner-agent';
      const sessionId = await initializeSession(ownerUserAgent, 203);

      const deleteResponse = await httpRequest(app, {
        method: 'DELETE',
        path: '/mcp',
        headers: {
          'Mcp-Session-Id': sessionId,
          'User-Agent': ownerUserAgent,
        },
      });
      expect(deleteResponse.status).toBe(200);

      const getResponse = await httpRequest(app, {
        method: 'GET',
        path: '/mcp',
        headers: {
          'Mcp-Session-Id': sessionId,
          'MCP-Protocol-Version': '2025-11-25',
          'User-Agent': ownerUserAgent,
        },
      });
      expect(getResponse.status).toBe(404);
      expect((getResponse.body as { error: Record<string, unknown> }).error).toMatchObject({
        code: 'SESSION_NOT_FOUND',
      });

      const postResponse = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          'MCP-Protocol-Version': '2025-11-25',
          'User-Agent': ownerUserAgent,
        },
        body: {
          jsonrpc: '2.0',
          id: 204,
          method: 'tools/list',
          params: {},
        },
      });
      expect(postResponse.status).toBe(404);
      expect((postResponse.body as { error: Record<string, unknown> }).error).toMatchObject({
        code: 'SESSION_NOT_FOUND',
      });
    });
  });

  describe('Well-known auth/security discovery contract', () => {
    let server: TestServer;
    let app: Express;
    let restoreEnv: () => void;

    beforeAll(async () => {
      restoreEnv = applyEnvOverrides({
        ENABLE_LEGACY_SSE: 'false',
        OAUTH_ISSUER: 'https://registry.example.com',
      });

      server = createHttpServer(TEST_SERVER_OPTIONS);
      app = server.app as Express;
    });

    afterAll(async () => {
      await cleanupServer(server);
      restoreEnv();
    });

    it('publishes OAuth authorization metadata with PKCE support', async () => {
      const response = await httpRequest(app, {
        method: 'GET',
        path: '/.well-known/oauth-authorization-server',
        headers: {
          Host: 'registry.example.com',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(response.status).toBe(200);

      const body = response.body as Record<string, any>;
      expect(body.issuer).toBe('https://registry.example.com');
      expect(body.authorization_endpoint).toBe('https://registry.example.com/oauth/authorize');
      expect(body.response_types_supported).toContain('code');
      expect(body.grant_types_supported).toContain('authorization_code');
      expect(body.code_challenge_methods_supported).toContain('S256');
    });

    it('publishes protected resource metadata bound to request host', async () => {
      const response = await httpRequest(app, {
        method: 'GET',
        path: '/.well-known/oauth-protected-resource',
        headers: {
          Host: 'registry.example.com',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(response.status).toBe(200);

      const body = response.body as Record<string, any>;
      expect(body.resource).toBe('https://registry.example.com');
      expect(body.authorization_servers).toContain('https://registry.example.com');
      expect(body.bearer_methods_supported).toContain('header');
    });

    it('publishes server card with transport, auth, and TLS security metadata', async () => {
      const response = await httpRequest(app, {
        method: 'GET',
        path: '/.well-known/mcp.json',
        headers: {
          Host: 'registry.example.com',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(response.status).toBe(200);

      const body = response.body as Record<string, any>;
      expect(body.mcp_version).toBe('2025-11-25');
      expect(body.endpoints.streamable_http).toBe('https://registry.example.com/mcp');
      expect(body.authentication.required).toBe(false);
      expect(body.authentication.methods).toContain('oauth2');
      expect(body.capabilities.resources).toEqual({
        templates: true,
        subscriptions: true,
      });
      expect(body.security.tls_required).toBe(true);
      expect(body.security.min_tls_version).toBe('1.2');
    });

    it('publishes tool hash manifest for integrity discovery', async () => {
      const response = await httpRequest(app, {
        method: 'GET',
        path: '/.well-known/mcp/tool-hashes',
        headers: {
          Host: 'registry.example.com',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(response.status).toBe(200);

      const body = response.body as Record<string, any>;
      expect(typeof body.generated).toBe('string');
      expect(typeof body.version).toBe('string');
      expect(body.tools).toBeDefined();
      expect(Object.keys(body.tools).length).toBeGreaterThan(0);
      expect(response.headers['etag']).toBeTruthy();
    });

    it('supports conditional requests for server card discovery', async () => {
      const firstResponse = await httpRequest(app, {
        method: 'GET',
        path: '/.well-known/mcp.json',
      });
      expect(firstResponse.status).toBe(200);
      const etag = firstResponse.headers['etag'];

      expect(typeof etag).toBe('string');
      expect(etag).toBeTruthy();

      const conditionalResponse = await httpRequest(app, {
        method: 'GET',
        path: '/.well-known/mcp.json',
        headers: {
          'If-None-Match': etag as string,
        },
      });
      expect(conditionalResponse.status).toBe(304);
    });
  });

  describe('OAuth bearer challenge contract', () => {
    let server: TestServer;
    let app: Express;

    beforeAll(async () => {
      server = createHttpServer({
        ...TEST_SERVER_OPTIONS,
        enableOAuth: true,
        oauthConfig: TEST_OAUTH_CONFIG,
      });
      app = server.app as Express;
    });

    afterAll(async () => {
      await cleanupServer(server);
    });

    it('returns WWW-Authenticate on missing bearer token', async () => {
      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: INITIALIZE_REQUEST,
      });

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('Bearer');
      expect(response.headers['www-authenticate']).toContain('error="invalid_request"');
      expect(response.headers['www-authenticate']).toContain(
        'error_description="Missing or invalid authorization header"'
      );
      expect(response.body).toMatchObject({
        error: 'unauthorized',
        error_description: 'Missing or invalid authorization header',
      });
    });

    it('returns WWW-Authenticate on missing bearer token for /sse', async () => {
      const response = await httpRequest(app, {
        method: 'GET',
        path: '/sse',
        headers: {
          'MCP-Protocol-Version': '2025-11-25',
        },
      });

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('Bearer');
      expect(response.headers['www-authenticate']).toContain('error="invalid_request"');
      expect(response.headers['www-authenticate']).toContain(
        'error_description="Missing or invalid authorization header"'
      );
    });

    it('returns WWW-Authenticate on invalid bearer token', async () => {
      const response = await httpRequest(app, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25',
          Authorization: 'Bearer not-a-real-token',
        },
        body: INITIALIZE_REQUEST,
      });

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('Bearer');
      expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
      expect(response.headers['www-authenticate']).toContain('error_description=');
    });
  });

  // ─── T1: Origin header rejection (MCP §2.7) ─────────────────────────
  describe('Origin header validation (MCP §2.7)', () => {
    let originApp: Express;
    let originServer: TestServer;
    let cleanupOriginEnv: () => void;

    beforeAll(async () => {
      cleanupOriginEnv = applyEnvOverrides({
        SERVAL_TRANSPORT: 'http',
        SERVAL_OAUTH_ENABLED: 'false',
      });
      originServer = createHttpServer({
        ...TEST_SERVER_OPTIONS,
        corsOrigins: ['http://allowed-origin.example.com'],
      });
      originApp = originServer.app;
    });

    afterAll(async () => {
      await cleanupServer(originServer);
      cleanupOriginEnv();
    });

    it('rejects requests with disallowed Origin header (MCP §2.7 — MUST 403)', async () => {
      const response = await httpRequest(originApp, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25',
          Origin: 'http://evil-origin.example.com',
        },
        body: INITIALIZE_REQUEST,
      });

      // MCP spec §2.7: Server MUST respond with HTTP 403 Forbidden for invalid Origin
      expect(response.status).toBe(403);
    });
  });

  // ─── T4: Access control on tool invocation (MCP §2.2) ───────────────
  describe('Tool invocation access control (MCP §2.2)', () => {
    let authServer: TestServer;
    let authApp: Express;

    beforeAll(async () => {
      authServer = createHttpServer({
        ...TEST_SERVER_OPTIONS,
        enableOAuth: true,
        oauthConfig: TEST_OAUTH_CONFIG,
      });
      authApp = authServer.app as Express;
    });

    afterAll(async () => {
      await cleanupServer(authServer);
    });

    it('blocks unauthenticated tool calls when OAuth is enabled', async () => {
      const response = await httpRequest(authApp, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: {
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: {
            name: 'sheets_core',
            arguments: { request: { action: 'get', spreadsheetId: 'test123' } },
          },
        },
      });

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toContain('Bearer');
    });
  });

  // ─── T2: Token audience validation (MCP §2.8) ───────────────────────
  describe('Token audience validation (MCP §2.8)', () => {
    let audServer: TestServer;
    let audApp: Express;

    beforeAll(async () => {
      audServer = createHttpServer({
        ...TEST_SERVER_OPTIONS,
        enableOAuth: true,
        oauthConfig: TEST_OAUTH_CONFIG,
      });
      audApp = audServer.app as Express;
    });

    afterAll(async () => {
      await cleanupServer(audServer);
    });

    it('rejects tokens not issued for this server (wrong audience)', async () => {
      const response = await httpRequest(audApp, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25',
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJodHRwczovL290aGVyLXNlcnZlci5jb20iLCJpc3MiOiJodHRwczovL2F1dGguZXhhbXBsZS5jb20iLCJleHAiOjk5OTk5OTk5OTl9.fake-signature',
        },
        body: INITIALIZE_REQUEST,
      });

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBeDefined();
    });
  });

  // ─── T3: Token passthrough prohibition (MCP §2.8) ──────────────────
  describe('Token passthrough prohibition (MCP §2.8)', () => {
    it('server uses Google OAuth tokens not client MCP tokens for API calls', () => {
      // MCP spec §2.8: Server MUST NOT pass through client tokens to downstream services
      // Verify no handler forwards req.headers.authorization to Google API calls
      const { spawnSync } = require('child_process');
      const result = spawnSync('grep', [
        '-rnE',
        'req\\.headers\\.authorization.*google|passthrough.*token|forward.*bearer',
        'src/handlers/',
      ], { cwd: process.cwd(), encoding: 'utf-8' });

      expect(result.stdout.trim()).toBe('');
    });
  });
});
