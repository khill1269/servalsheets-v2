/**
 * ServalSheets - HTTP Transport Integration Tests
 *
 * Tests MCP protocol over HTTP transport including:
 * - Server initialization
 * - Health checks
 * - Tools listing
 * - Tool invocation
 *
 * These tests verify the HTTP/SSE server works correctly
 * without requiring actual Google API access.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  CreateMessageRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from '../../src/version.js';
import { createHttpServer, type HttpServerOptions } from '../../src/http-server.js';
import { resourceNotifications } from '../../src/resources/notifications.js';
import { logger } from '../../src/utils/logger.js';
import { createTestHttpClient } from '../e2e/mcp-client-simulator.js';
import {
  getOrCreateSessionContext,
  removeSessionContext,
} from '../../src/services/session-context.js';
import type { Express } from 'express';
import net from 'node:net';

const canListenLocalhost = await new Promise<boolean>((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(0, '127.0.0.1', () => {
    server.close(() => resolve(true));
  });
});

const SKIP_HTTP_INTEGRATION =
  process.env['TEST_HTTP_INTEGRATION'] !== 'true' || !canListenLocalhost;

describe.skipIf(SKIP_HTTP_INTEGRATION)('HTTP Transport Integration Tests', () => {
  let app: Express;
  let server: ReturnType<typeof createHttpServer>;
  let httpServer: ReturnType<Express['listen']>;
  let agent: ReturnType<typeof request>;
  const previousLegacySse = process.env['ENABLE_LEGACY_SSE'];

  beforeAll(async () => {
    process.env['ENABLE_LEGACY_SSE'] = 'true';

    // Create HTTP server for testing
    const options: HttpServerOptions = {
      port: 0, // Use random port
      host: '127.0.0.1',
      corsOrigins: ['http://localhost:3000'],
      rateLimitMax: 10000, // High limit for tests
      rateLimitWindowMs: 1000, // 1s window so limit resets between tests
      trustProxy: false,
    };

    server = createHttpServer(options);
    // `createHttpServer` currently types `app` as `unknown` even though it is an Express app.
    // For test purposes we narrow it here.
    app = server.app as Express;
    httpServer = await new Promise<ReturnType<Express['listen']>>((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.on('error', reject);
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('HTTP test server failed to start');
    }
    agent = request(`http://127.0.0.1:${address.port}`);
  });

  afterAll(async () => {
    if (previousLegacySse === undefined) {
      delete process.env['ENABLE_LEGACY_SSE'];
    } else {
      process.env['ENABLE_LEGACY_SSE'] = previousLegacySse;
    }

    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    // Clean up any active sessions/transports
    if (server?.sessions) {
      const sessions = server.sessions as Map<
        string,
        { transport?: { close?: () => void }; taskStore?: { dispose?: () => void } }
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
    }
    await server.stop?.();
  });

  const getBaseUrl = (): string => {
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('HTTP test server is not listening on a TCP port');
    }
    return `http://127.0.0.1:${address.port}`;
  };

  const createJwtLikeBearerToken = (
    audience: string,
    overrides?: Record<string, unknown>
  ): string => {
    const encode = (value: object): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    return [
      encode({ alg: 'none', typ: 'JWT' }),
      encode({
        aud: audience,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'sdk-http-test@example.com',
        ...overrides,
      }),
      'signature',
    ].join('.');
  };

  const createSdkHttpClient = async (options?: {
    authToken?: string;
    samplingResponseText?: string;
    samplingHandler?: (request: {
      params: {
        messages: Array<{
          content?: unknown;
        }>;
      };
    }) => Promise<{
      model: string;
      role: 'assistant';
      content: {
        type: 'text';
        text: string;
      };
    }>;
  }) => {
    const transport = new StreamableHTTPClientTransport(new URL(`${getBaseUrl()}/mcp`), {
      requestInit: {
        headers: options?.authToken
          ? {
              Authorization: `Bearer ${options.authToken}`,
            }
          : undefined,
      },
    });

    const samplingRequests: Array<{ message?: string }> = [];
    const client = new Client(
      {
        name: 'servalsheets-http-sdk-test-client',
        version: '1.0.0-test',
      },
      {
        capabilities: {
          sampling: {},
        },
      }
    );

    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const firstMessage = request.params.messages[0];
      const content = firstMessage?.content;
      const prompt =
        content && typeof content === 'object' && !Array.isArray(content) && content.type === 'text'
          ? content.text
          : undefined;
      samplingRequests.push({ message: prompt });

      if (options?.samplingHandler) {
        return await options.samplingHandler(request);
      }

      return {
        model: 'mock-http-sampling-model',
        role: 'assistant',
        content: {
          type: 'text',
          text:
            options?.samplingResponseText ??
            JSON.stringify({
              title: 'Generated Budget Planner',
              sheets: [
                {
                  name: 'Budget',
                  columns: [
                    { header: 'Category', type: 'text', width: 160 },
                    { header: 'Budget', type: 'currency', width: 120 },
                    { header: 'Actual', type: 'currency', width: 120 },
                  ],
                  rows: [{ values: ['Marketing', 1000, 950] }, { values: ['Travel', 500, 420] }],
                  formatting: {
                    headerStyle: 'bold_blue_background',
                    freezeRows: 1,
                    alternatingRows: true,
                  },
                },
              ],
            }),
        },
      };
    });

    await client.connect(transport);

    return {
      client,
      transport,
      samplingRequests,
      close: async () => {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      },
    };
  };

  describe('Health and Info Endpoints', () => {
    it('should return healthy status on /health', async () => {
      const response = await agent.get('/health').expect(200).expect('Content-Type', /json/);

      // May be 'degraded' if OAuth tokens not configured (expected in test env)
      expect(['healthy', 'degraded']).toContain(response.body.status);
      expect(response.body).toMatchObject({
        version: VERSION,
      });
    });

    it('should return server info on /info', async () => {
      const response = await agent.get('/info').expect(200).expect('Content-Type', /json/);

      expect(response.body).toMatchObject({
        name: 'servalsheets',
        version: VERSION,
        description: 'Production-grade Google Sheets MCP server',
        protocol: 'MCP 2025-11-25',
      });

      // Verify tool and action counts are present
      expect(response.body.tools).toBeDefined();
      expect(response.body.actions).toBeDefined();
      expect(typeof response.body.tools).toBe('number');
      expect(typeof response.body.actions).toBe('number');
      expect(response.body.tools).toBeGreaterThan(0);
      expect(response.body.actions).toBeGreaterThan(0);
    });

    it('should not expose oauth issuer/client metadata or session counts in readiness health', async () => {
      const oauthServer = createHttpServer({
        port: 0,
        host: '127.0.0.1',
        corsOrigins: ['http://localhost:3000'],
        rateLimitMax: 1000,
        trustProxy: false,
        enableOAuth: true,
        oauthConfig: {
          issuer: 'https://issuer.example.com',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          jwtSecret: 'x'.repeat(32),
          stateSecret: 'y'.repeat(32),
          allowedRedirectUris: ['http://localhost:3000/callback'],
          googleClientId: 'google-client-id',
          googleClientSecret: 'google-client-secret',
          accessTokenTtl: 3600,
          refreshTokenTtl: 86400,
        },
      });

      const oauthApp = oauthServer.app as Express;
      const oauthHttpServer = await new Promise<ReturnType<Express['listen']>>(
        (resolve, reject) => {
          const listener = oauthApp.listen(0, '127.0.0.1', () => resolve(listener));
          listener.on('error', reject);
        }
      );
      const address = oauthHttpServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('OAuth test server failed to start');
      }

      const oauthAgent = request(`http://127.0.0.1:${address.port}`);
      const response = await oauthAgent.get('/health/ready').expect('Content-Type', /json/);

      expect([200, 503]).toContain(response.status);
      expect(response.body.oauth).toBeDefined();
      expect(response.body.oauth).toMatchObject({
        enabled: true,
        configured: true,
      });
      expect(response.body.oauth).not.toHaveProperty('issuer');
      expect(response.body.oauth).not.toHaveProperty('clientId');

      expect(response.body.sessions).toBeDefined();
      expect(response.body.sessions).toHaveProperty('hasAuthentication');
      expect(typeof response.body.sessions.hasAuthentication).toBe('boolean');
      expect(response.body.sessions).not.toHaveProperty('active');

      await new Promise<void>((resolve) => oauthHttpServer.close(() => resolve()));
      const oauthSessions = oauthServer.sessions as Map<
        string,
        { transport?: { close?: () => void }; taskStore?: { dispose?: () => void } }
      >;
      oauthSessions.forEach((session) => {
        if (typeof session.transport?.close === 'function') {
          session.transport.close();
        }
        if (typeof session.taskStore?.dispose === 'function') {
          session.taskStore.dispose();
        }
      });
      oauthSessions.clear();
      await oauthServer.stop?.();
    });
  });

  describe('MCP Initialize Handshake', () => {
    it('should accept POST requests to /mcp endpoint', async () => {
      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      const response = await agent
        .post('/mcp')
        .send(initializeRequest)
        .set('Content-Type', 'application/json');

      // Should handle MCP request (may return 200, 406, or 426 Upgrade Required for WebSocket)
      expect([200, 406, 426]).toContain(response.status);
    });

    it('should handle tools/list request', async () => {
      const toolsListRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      };

      const response = await agent
        .post('/mcp')
        .send(toolsListRequest)
        .set('Content-Type', 'application/json');

      // No session established yet; should reject the request
      expect(response.status).toBe(400);
    });
  });

  describe('Session Management', () => {
    it('should create session on first /mcp request', async () => {
      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      const response = await agent
        .post('/mcp')
        .send(initializeRequest)
        .set('Content-Type', 'application/json');

      // Should accept request
      expect([200, 406]).toContain(response.status);

      // Session may or may not be stored depending on transport type
      // This is implementation-specific
    });

    it('should delete session via DELETE endpoint', async () => {
      const sessionId = 'test-session-delete';

      // Seed an in-memory session entry to exercise the endpoint
      const sessions = server.sessions as Map<
        string,
        { transport?: { close?: () => void }; taskStore?: { dispose?: () => void } }
      >;
      sessions.set(sessionId, {
        transport: { close: vi.fn() },
        taskStore: { dispose: vi.fn() },
      });

      // Now delete it
      const deleteResponse = await agent.delete(`/session/${sessionId}`).timeout({
        // Prevent occasional hangs from causing global Vitest timeout.
        // Either response is acceptable (200 = deleted, 404 = already gone).
        response: 2000,
        deadline: 5000,
      });

      // Delete should return 200 for success or 404 if session not found
      expect([200, 404]).toContain(deleteResponse.status);
    });

    it('should return 404 when deleting non-existent session', async () => {
      const response = await agent.delete('/session/non-existent-session').expect(404);

      // Error format may vary - check for error indication
      expect(response.body.error).toBeDefined();
    });

    it('should remove session-scoped context when deleting a session', async () => {
      const sessionId = 'test-session-context-cleanup';
      const initialContext = getOrCreateSessionContext(sessionId);

      const sessions = server.sessions as Map<
        string,
        { transport?: { close?: () => void }; taskStore?: { dispose?: () => void } }
      >;
      sessions.set(sessionId, {
        transport: { close: vi.fn() },
        taskStore: { dispose: vi.fn() },
      });

      await agent.delete(`/session/${sessionId}`).expect(200);

      const recreatedContext = getOrCreateSessionContext(sessionId);
      expect(recreatedContext).not.toBe(initialContext);
      removeSessionContext(sessionId);
    });
  });

  describe('Streamable HTTP transport behavior', () => {
    it('should reject client-specified session ID on initialize', async () => {
      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      const response = await agent
        .post('/mcp')
        .send(initializeRequest)
        .set('Content-Type', 'application/json')
        .set('Mcp-Session-Id', 'client-specified');

      expect(response.status).toBe(400);
    });

    it('should return 400 on GET /mcp without session', async () => {
      const response = await agent.get('/mcp');
      expect(response.status).toBe(400);
    });

    it('should return 404 on GET /mcp with unknown session', async () => {
      const response = await agent
        .get('/mcp')
        .set('Mcp-Session-Id', 'missing-session')
        .set('MCP-Protocol-Version', '2025-11-25');
      expect(response.status).toBe(404);
    });

    it('should return 404 on DELETE /mcp with unknown session', async () => {
      const response = await agent
        .delete('/mcp')
        .set('Mcp-Session-Id', 'missing-session')
        .set('MCP-Protocol-Version', '2025-11-25');
      expect(response.status).toBe(404);
    });

    it('should dispose session runtime state when a streamable HTTP session is terminated', async () => {
      const client = createTestHttpClient(getBaseUrl());

      try {
        await client.initialize();

        const sessionId = client.getSession().sessionId;
        expect(sessionId).toBeTruthy();

        const sessions = server.sessions as Map<
          string,
          {
            disposeRuntime?: () => void;
            taskStore: { dispose: () => void };
          }
        >;
        const session = sessions.get(sessionId);

        expect(session).toBeDefined();

        const disposeRuntimeSpy = vi.spyOn(session!, 'disposeRuntime');
        const taskStoreDisposeSpy = vi.spyOn(session!.taskStore, 'dispose');

        await client.close();

        await vi.waitFor(() => {
          expect(disposeRuntimeSpy).toHaveBeenCalledTimes(1);
          expect(taskStoreDisposeSpy).toHaveBeenCalledTimes(1);
          expect(sessions.has(sessionId)).toBe(false);
        });
      } finally {
        await client.close().catch(() => undefined);
      }
    });

    it('should propagate HTTP trace context into legacy tool response metadata', async () => {
      const traceId = '0123456789abcdef0123456789abcdef';
      const parentSpanId = '0123456789abcdef';
      const traceparent = `00-${traceId}-${parentSpanId}-01`;
      const userAgent = 'trace-context-test-client';

      try {
        const initResponse = await agent
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set('MCP-Protocol-Version', '2025-11-25')
          .set('User-Agent', userAgent)
          .set('traceparent', traceparent)
          .send({
            jsonrpc: '2.0',
            id: 3201,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: {
                name: 'trace-context-test-client',
                version: '1.0.0',
              },
            },
          })
          .expect(200);

        const sessionIdHeader =
          initResponse.headers['mcp-session-id'] ?? initResponse.headers['x-session-id'];
        const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
        expect(typeof sessionId).toBe('string');
        expect(sessionId).toBeTruthy();

        await agent
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set('MCP-Protocol-Version', '2025-11-25')
          .set('Mcp-Session-Id', sessionId as string)
          .set('User-Agent', userAgent)
          .send({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          })
          .expect((response) => {
            expect([200, 202, 204]).toContain(response.status);
          });

        const toolResponse = await agent
          .post('/mcp')
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json, text/event-stream')
          .set('MCP-Protocol-Version', '2025-11-25')
          .set('Mcp-Session-Id', sessionId as string)
          .set('User-Agent', userAgent)
          .set('traceparent', traceparent)
          .send({
            jsonrpc: '2.0',
            id: 3202,
            method: 'tools/call',
            params: {
              name: 'sheets_session',
              arguments: {
                request: {
                  action: 'get_active',
                },
              },
            },
          })
          .expect(200);

        const responseResult =
          toolResponse.body?.result ??
          (() => {
            const blocks = toolResponse.text.split(/\r?\n\r?\n/);
            for (const block of blocks) {
              const dataLines = block
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart());

              if (dataLines.length === 0) {
                continue;
              }

              let payload: { id?: number; result?: unknown } | undefined;
              try {
                payload = JSON.parse(dataLines.join('\n')) as {
                  id?: number;
                  result?: unknown;
                };
              } catch {
                continue;
              }

              if (payload.id === 3202) {
                return payload.result;
              }
            }
            return undefined;
          })();

        expect(responseResult).toMatchObject({
          structuredContent: {
            response: {
              success: true,
              action: 'get_active',
            },
            _meta: {
              traceId,
            },
          },
        });
      } finally {
        // No-op: explicit session cleanup is handled by the test server teardown.
      }
    });

    it('should stream progress notifications for tool calls that include a progress token', async () => {
      const previousCheckpoints = process.env['ENABLE_CHECKPOINTS'];
      process.env['ENABLE_CHECKPOINTS'] = 'true';

      const client = createTestHttpClient(getBaseUrl());

      try {
        await client.initialize();

        const response = (await (
          client as unknown as {
            sendRequest: (request: Record<string, unknown>) => Promise<{
              result?: {
                structuredContent?: {
                  response?: {
                    success?: boolean;
                    action?: string;
                  };
                };
              };
            }>;
          }
        ).sendRequest({
          jsonrpc: '2.0',
          id: 3101,
          method: 'tools/call',
          params: {
            name: 'sheets_session',
            arguments: {
              request: {
                action: 'save_checkpoint',
                sessionId: 'http-progress-test-session',
                description: 'transport progress regression',
              },
            },
            _meta: {
              progressToken: 'tok-http-progress',
            },
          },
        })) as {
          result?: {
            structuredContent?: {
              response?: {
                success?: boolean;
                action?: string;
              };
            };
          };
        };

        expect(response.result?.structuredContent?.response).toMatchObject({
          success: true,
          action: 'save_checkpoint',
        });

        expect(client.getNotifications()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: 'notifications/progress',
              params: expect.objectContaining({
                progressToken: 'tok-http-progress',
              }),
            }),
          ])
        );
      } finally {
        await client.close();
        if (previousCheckpoints === undefined) {
          delete process.env['ENABLE_CHECKPOINTS'];
        } else {
          process.env['ENABLE_CHECKPOINTS'] = previousCheckpoints;
        }
      }
    });

    it('should complete an elicitation roundtrip over HTTP with an MCP client', async () => {
      const client = createTestHttpClient(getBaseUrl(), {
        capabilities: {
          elicitation: { form: {} },
          sampling: {},
        },
      });

      client.setRequestHandler('elicitation/create', () => ({
        action: 'accept',
        content: {
          approved: true,
          modifications: 'Proceed with audit-safe rollout',
          skipSnapshot: false,
        },
      }));

      try {
        await client.initialize();
        await client.openEventStream();

        const toolPromise = client.callTool('sheets_confirm', {
          request: {
            action: 'request',
            plan: {
              title: 'Audit MCP rollout',
              description: 'Validate and approve the MCP transport rollout plan',
              steps: [
                {
                  stepNumber: 1,
                  description: 'Review transport coverage',
                  tool: 'sheets_session',
                  action: 'status',
                  risk: 'low',
                  estimatedApiCalls: 1,
                  isDestructive: false,
                  canUndo: true,
                },
              ],
              willCreateSnapshot: false,
            },
          },
        });

        const elicitationRequest = await client.waitForRequest('elicitation/create', 3000);
        const result = await toolPromise;
        const structured = result.structuredContent as
          | {
              response?: {
                success?: boolean;
                action?: string;
                confirmation?: {
                  approved?: boolean;
                  modifications?: string;
                };
              };
            }
          | undefined;

        expect(elicitationRequest).toMatchObject({
          method: 'elicitation/create',
          params: expect.objectContaining({
            message: expect.stringContaining('Audit MCP rollout'),
          }),
        });
        expect(structured?.response).toMatchObject({
          success: true,
          action: 'request',
          confirmation: expect.objectContaining({
            approved: true,
            modifications: 'Proceed with audit-safe rollout',
          }),
        });
      } finally {
        await client.close();
      }
    });

    it('should complete a sampling roundtrip over HTTP with the official MCP SDK client', async () => {
      const sdkClient = await createSdkHttpClient({
        authToken: createJwtLikeBearerToken(getBaseUrl()),
      });

      try {
        const result = await sdkClient.client.callTool({
          name: 'sheets_composite',
          arguments: {
            request: {
              action: 'preview_generation',
              description: 'Create a department budget tracker with budget and actual columns',
              style: 'professional',
            },
          },
        });

        const structured = result.structuredContent as
          | {
              response?: {
                success?: boolean;
                action?: string;
                definition?: {
                  title?: string;
                  sheets?: Array<{ name?: string }>;
                };
              };
            }
          | undefined;

        expect(sdkClient.samplingRequests).toHaveLength(1);
        expect(sdkClient.samplingRequests[0]?.message).toContain(
          'Create a department budget tracker'
        );
        expect(structured?.response).toMatchObject({
          success: true,
          action: 'preview_generation',
          definition: expect.objectContaining({
            title: 'Generated Budget Planner',
          }),
        });
      } finally {
        await sdkClient.close();
      }
    });

    it('should support task-based tool execution over HTTP with the official MCP SDK client', async () => {
      const sdkClient = await createSdkHttpClient();

      try {
        const stream = sdkClient.client.experimental.tasks.callToolStream(
          {
            name: 'sheets_history',
            arguments: {
              request: {
                action: 'stats',
              },
            },
          },
          CallToolResultSchema,
          {
            task: { ttl: 60000 },
          }
        );

        const seenMessageTypes: string[] = [];
        let taskId: string | undefined;
        let finalResult:
          | {
              structuredContent?: {
                response?: {
                  success?: boolean;
                  action?: string;
                };
              };
            }
          | undefined;

        for await (const message of stream) {
          seenMessageTypes.push(message.type);

          if (message.type === 'taskCreated') {
            taskId = message.task.taskId;
          }

          if (message.type === 'result') {
            finalResult = message.result as typeof finalResult;
          }
        }

        expect(taskId).toBeDefined();
        expect(seenMessageTypes).toContain('taskCreated');
        expect(seenMessageTypes).toContain('result');

        const task = await sdkClient.client.experimental.tasks.getTask(taskId!);
        expect(task.status).toBe('completed');

        const listedTasks = await sdkClient.client.experimental.tasks.listTasks();
        expect(listedTasks.tasks.map((listed) => listed.taskId)).toContain(taskId!);

        const taskResult = await sdkClient.client.experimental.tasks.getTaskResult(
          taskId!,
          CallToolResultSchema
        );
        const structured = taskResult.structuredContent as
          | {
              response?: {
                success?: boolean;
                action?: string;
                error?: {
                  code?: string;
                  message?: string;
                };
              };
            }
          | undefined;

        expect(finalResult?.structuredContent?.response).toMatchObject({
          success: true,
          action: 'stats',
        });
        expect(finalResult?.structuredContent?.response).not.toHaveProperty('taskId');
        expect(structured?.response).toMatchObject({
          success: true,
          action: 'stats',
        });
        expect(structured?.response).not.toHaveProperty('taskId');
      } finally {
        await sdkClient.close();
      }
    });

    it('should cancel a task-based tool execution over HTTP with the official MCP SDK client', async () => {
      const sdkClient = await createSdkHttpClient({
        authToken: createJwtLikeBearerToken(getBaseUrl()),
        samplingHandler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));

          return {
            model: 'mock-http-sampling-model',
            role: 'assistant',
            content: {
              type: 'text',
              text: JSON.stringify({
                title: 'Delayed cancellation fallback',
                sheets: [{ name: 'Cancelled' }],
              }),
            },
          };
        },
      });

      try {
        const stream = sdkClient.client.experimental.tasks.callToolStream(
          {
            name: 'sheets_composite',
            arguments: {
              request: {
                action: 'preview_generation',
                description: 'Create a cancellation-focused forecast sheet',
                style: 'professional',
              },
            },
          },
          CallToolResultSchema,
          {
            task: { ttl: 60000 },
          }
        );

        const firstMessage = await stream.next();
        expect(firstMessage.done).toBe(false);
        expect(firstMessage.value?.type).toBe('taskCreated');

        const taskId =
          firstMessage.value?.type === 'taskCreated' ? firstMessage.value.task.taskId : undefined;
        expect(taskId).toBeDefined();

        await sdkClient.client.experimental.tasks.cancelTask(taskId!);

        await vi.waitFor(
          async () => {
            const task = await sdkClient.client.experimental.tasks.getTask(taskId!);
            expect(task.status).toBe('cancelled');
          },
          { timeout: 5000 }
        );

        const taskResult = await sdkClient.client.experimental.tasks.getTaskResult(
          taskId!,
          CallToolResultSchema
        );
        const structured = taskResult.structuredContent as
          | {
              response?: {
                success?: boolean;
                error?: {
                  code?: string;
                  message?: string;
                };
              };
            }
          | undefined;

        expect(structured?.response).toMatchObject({
          success: false,
          error: {
            code: 'TASK_CANCELLED',
          },
        });

        for await (const message of stream) {
          if (message.type === 'result') {
            const streamedResult = message.result as {
              structuredContent?: {
                response?: {
                  success?: boolean;
                  error?: {
                    code?: string;
                  };
                };
              };
            };

            expect(streamedResult.structuredContent?.response).toMatchObject({
              success: false,
              error: {
                code: 'TASK_CANCELLED',
              },
            });
          }
        }
      } finally {
        await sdkClient.close();
      }
    });
  });

  describe('Security Headers', () => {
    it('should include security headers from helmet', async () => {
      const response = await agent.get('/health').expect(200);

      // Helmet adds various security headers
      expect(response.headers['x-content-type-options']).toBeDefined();
    });

    it('should include CORS headers', async () => {
      const response = await agent
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should include request ID in response', async () => {
      const response = await agent.get('/health').expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(typeof response.headers['x-request-id']).toBe('string');
    });

    it('should accept custom request ID from client', async () => {
      const customRequestId = 'custom-test-request-id';

      const response = await agent.get('/health').set('X-Request-ID', customRequestId).expect(200);

      expect(response.headers['x-request-id']).toBe(customRequestId);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      const response = await agent
        .post('/mcp')
        .send('invalid json{')
        .set('Content-Type', 'application/json');

      // Express should return 400 for malformed JSON
      expect([400, 500]).toContain(response.status);
    });

    it('should handle missing session ID on SSE message endpoint', async () => {
      const response = await agent
        .post('/sse/message')
        .send({ jsonrpc: '2.0', method: 'test' })
        .expect(400);

      // Error format may vary - check for error indication
      expect(response.body.error).toBeDefined();
    });

    it('should handle non-existent session on SSE message endpoint', async () => {
      const response = await agent
        .post('/sse/message')
        .set('X-Session-ID', 'non-existent')
        .send({ jsonrpc: '2.0', method: 'test' })
        .expect((res) => {
          expect([400, 404]).toContain(res.status);
        });

      // Error format may vary - check for error indication
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    it('should accept requests under rate limit', async () => {
      // Make several requests
      for (let i = 0; i < 5; i++) {
        await agent.get('/health').expect(200);
      }
    });

    // Note: Testing rate limit enforcement would require exceeding the limit
    // which is set high for tests (1000). Skipping actual enforcement test.
  });

  describe('Authorization Header Handling', () => {
    it('should accept Bearer token in Authorization header', async () => {
      const response = await agent
        .post('/mcp')
        .set('Authorization', 'Bearer test-token-123')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        });

      // Should accept the request with Authorization header
      // May return 200, 406, 426 (Upgrade Required), or 401 (if token validation enabled)
      expect([200, 401, 406, 426]).toContain(response.status);
    });

    it('should work without Authorization header', async () => {
      const response = await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        });

      // Should work without token (limited functionality)
      // May return 200, 406, or 426 (Upgrade Required for WebSocket transport)
      expect([200, 406, 426]).toContain(response.status);
    });
  });

  describe('MCP Logging Bridge', () => {
    const initializeSession = async (id: number, clientName: string) => {
      const authToken = createJwtLikeBearerToken(getBaseUrl(), {
        email: `${clientName}-${id}@example.com`,
        sub: `${clientName}-${id}`,
        nonce: `logging-session-${id}`,
      });
      const initResponse = await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          jsonrpc: '2.0',
          id,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: clientName,
              version: '1.0.0',
            },
          },
        })
        .expect(200);

      const sessionIdHeader =
        initResponse.headers['mcp-session-id'] ?? initResponse.headers['x-session-id'];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
      expect(typeof sessionId).toBe('string');
      expect(sessionId).toBeTruthy();
      return {
        sessionId: sessionId as string,
        authToken,
      };
    };

    it('should forward logger output after logging/setLevel via MCP notifications', async () => {
      const { sessionId, authToken } = await initializeSession(9001, 'logging-bridge-test-client');

      const sessions = server.sessions as Map<
        string,
        {
          mcpServer: {
            server: {
              sendLoggingMessage: (message: unknown) => Promise<void>;
            };
          };
        }
      >;
      const session = sessions.get(sessionId as string);
      expect(session).toBeDefined();

      const sendLoggingMessageSpy = vi
        .spyOn(session!.mcpServer.server, 'sendLoggingMessage')
        .mockResolvedValue(undefined);

      await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Mcp-Session-Id', sessionId as string)
        .set('MCP-Protocol-Version', '2025-11-25')
        .send({
          jsonrpc: '2.0',
          id: 9002,
          method: 'logging/setLevel',
          params: { level: 'debug' },
        })
        .expect(200);

      logger.info('http-logging-bridge-regression-test');

      await vi.waitFor(() => {
        expect(sendLoggingMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            logger: 'servalsheets',
          })
        );
      });
    });

    it('should keep HTTP logging subscriptions scoped to each MCP session', async () => {
      const debugSession = await initializeSession(9010, 'logging-debug-client');
      const errorSession = await initializeSession(9011, 'logging-error-client');

      const sessions = server.sessions as Map<
        string,
        {
          mcpServer: {
            server: {
              sendLoggingMessage: (message: unknown) => Promise<void>;
            };
          };
        }
      >;

      const debugSessionState = sessions.get(debugSession.sessionId);
      const errorSessionState = sessions.get(errorSession.sessionId);
      expect(debugSessionState).toBeDefined();
      expect(errorSessionState).toBeDefined();

      const debugSpy = vi
        .spyOn(debugSessionState!.mcpServer.server, 'sendLoggingMessage')
        .mockResolvedValue(undefined);
      const errorSpy = vi
        .spyOn(errorSessionState!.mcpServer.server, 'sendLoggingMessage')
        .mockResolvedValue(undefined);

      await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${debugSession.authToken}`)
        .set('Mcp-Session-Id', debugSession.sessionId)
        .set('MCP-Protocol-Version', '2025-11-25')
        .send({
          jsonrpc: '2.0',
          id: 9012,
          method: 'logging/setLevel',
          params: { level: 'debug' },
        })
        .expect(200);

      await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${errorSession.authToken}`)
        .set('Mcp-Session-Id', errorSession.sessionId)
        .set('MCP-Protocol-Version', '2025-11-25')
        .send({
          jsonrpc: '2.0',
          id: 9013,
          method: 'logging/setLevel',
          params: { level: 'error' },
        })
        .expect(200);

      logger.info('http-session-scoped-logging-test');

      await vi.waitFor(() => {
        expect(debugSpy).toHaveBeenCalled();
      });

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should keep HTTP resource subscriptions scoped to each MCP session and honor unsubscribe', async () => {
      const cacheSession = await initializeSession(9020, 'resource-cache-client');
      const historySession = await initializeSession(9021, 'resource-history-client');

      const sessions = server.sessions as Map<
        string,
        {
          mcpServer: {
            server: {
              sendResourceUpdated: (message: unknown) => Promise<void>;
            };
          };
        }
      >;

      const cacheSessionState = sessions.get(cacheSession.sessionId);
      const historySessionState = sessions.get(historySession.sessionId);
      expect(cacheSessionState).toBeDefined();
      expect(historySessionState).toBeDefined();

      const cacheSpy = vi
        .spyOn(cacheSessionState!.mcpServer.server, 'sendResourceUpdated')
        .mockResolvedValue(undefined);
      const historySpy = vi
        .spyOn(historySessionState!.mcpServer.server, 'sendResourceUpdated')
        .mockResolvedValue(undefined);

      await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${cacheSession.authToken}`)
        .set('Mcp-Session-Id', cacheSession.sessionId)
        .set('MCP-Protocol-Version', '2025-11-25')
        .send({
          jsonrpc: '2.0',
          id: 9022,
          method: 'resources/subscribe',
          params: { uri: 'cache://stats' },
        })
        .expect(200);

      await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${historySession.authToken}`)
        .set('Mcp-Session-Id', historySession.sessionId)
        .set('MCP-Protocol-Version', '2025-11-25')
        .send({
          jsonrpc: '2.0',
          id: 9023,
          method: 'resources/subscribe',
          params: { uri: 'history://stats' },
        })
        .expect(200);

      resourceNotifications.notifyCacheInvalidated();

      await vi.waitFor(() => {
        expect(cacheSpy).toHaveBeenCalledWith({ uri: 'cache://stats' });
      });
      expect(historySpy).not.toHaveBeenCalled();

      cacheSpy.mockClear();

      await agent
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('Authorization', `Bearer ${cacheSession.authToken}`)
        .set('Mcp-Session-Id', cacheSession.sessionId)
        .set('MCP-Protocol-Version', '2025-11-25')
        .send({
          jsonrpc: '2.0',
          id: 9024,
          method: 'resources/unsubscribe',
          params: { uri: 'cache://stats' },
        })
        .expect(200);

      resourceNotifications.notifyCacheInvalidated();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cacheSpy).not.toHaveBeenCalled();
    });
  });
});
