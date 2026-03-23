import { createHash, randomUUID } from 'crypto';
import express, { type Express, type Request, type Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { TaskStoreAdapter } from '../core/index.js';
import type { InMemoryEventStore, RedisEventStore } from '../mcp/event-store.js';
import { sessionsTotal } from '../observability/metrics.js';
import type { OAuthProvider } from '../oauth-provider.js';
import { extractIdempotencyKeyFromHeaders } from '../utils/idempotency-key-generator.js';
import {
  createResourceIndicatorValidator,
  optionalResourceIndicatorMiddleware,
} from '../security/index.js';
import { removeSessionContext } from '../services/session-context.js';
import { extractPrincipalIdFromHeaders } from '../server/request-extraction.js';
import { createRequestContext, runWithRequestContext } from '../utils/request-context.js';
import { sessionLimiter } from '../utils/session-limiter.js';
import { logger } from '../utils/logger.js';
import {
  clearSessionEventStore,
  createSessionEventStore,
  createSessionSecurityContext,
  normalizeMcpSessionHeader,
  type SessionSecurityContext,
  verifySessionSecurityContext,
} from './transport-helpers.js';

export interface HttpTransportSession {
  transport: SSEServerTransport | StreamableHTTPServerTransport;
  mcpServer: McpServer;
  taskStore: TaskStoreAdapter;
  disposeRuntime?: () => void;
  eventStore?: InMemoryEventStore | RedisEventStore;
  securityContext: SessionSecurityContext; // Security binding to prevent hijacking
  lastActivity: number; // Timestamp of last request for idle eviction
}

export function registerHttpTransportRoutes(params: {
  app: Express;
  enableOAuth: boolean;
  oauth: OAuthProvider | null;
  legacySseEnabled: boolean;
  host: string;
  port: number;
  eventStoreRedisUrl: string | undefined;
  eventStoreTtlMs: number;
  eventStoreMaxEvents: number;
  sessionTimeoutMs: number;
  sessions: Map<string, HttpTransportSession>;
  createMcpServerInstance: (
    googleToken?: string,
    googleRefreshToken?: string,
    sessionId?: string
  ) => Promise<{ mcpServer: McpServer; taskStore: TaskStoreAdapter; disposeRuntime: () => void }>;
}): {
  sessionCleanupInterval: NodeJS.Timeout;
  cleanupSessions: () => void;
} {
  const {
    app,
    enableOAuth,
    oauth,
    legacySseEnabled,
    host,
    port,
    eventStoreRedisUrl,
    eventStoreTtlMs,
    eventStoreMaxEvents,
    sessionTimeoutMs,
    sessions,
    createMcpServerInstance,
  } = params;

  const getHeaderValue = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const withHttpRequestContext = async <T>(req: Request, fn: () => Promise<T>): Promise<T> => {
    const requestContext = createRequestContext({
      requestId: getHeaderValue(req.headers['x-request-id']),
      traceId: getHeaderValue(req.headers['x-trace-id']),
      spanId: getHeaderValue(req.headers['x-span-id']),
      parentSpanId: getHeaderValue(req.headers['x-parent-span-id']),
      principalId: extractPrincipalIdFromHeaders(req.headers),
      idempotencyKey: extractIdempotencyKeyFromHeaders(req.headers),
    });

    return await runWithRequestContext(requestContext, fn);
  };

  const disposeSession = (
    sessionId: string,
    options?: {
      closeTransport?: boolean;
      reason?: string;
    }
  ): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    sessions.delete(sessionId);
    sessionsTotal.set(sessions.size);
    sessionLimiter.unregisterSession(sessionId);
    removeSessionContext(sessionId);

    try {
      session.disposeRuntime?.();
    } catch (error) {
      logger.error('Failed to dispose session runtime', { sessionId, error });
    }

    try {
      session.taskStore.dispose();
    } catch (error) {
      logger.error('Failed to dispose session task store', { sessionId, error });
    }

    clearSessionEventStore(session.eventStore);

    if (options?.closeTransport !== false && typeof session.transport.close === 'function') {
      try {
        session.transport.close();
      } catch (error) {
        logger.error('Failed to close session transport', { sessionId, error });
      }
    }

    if (options?.reason) {
      logger.info(options.reason, { sessionId });
    }

    return true;
  };

  // Idle session cleanup (prevents memory leak from abandoned sessions)
  const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > sessionTimeoutMs) {
        disposeSession(id, {
          reason: 'Evicted idle session',
        });
      }
    }
  }, 60000);

  const cleanupSessions = (): void => {
    for (const sessionId of [...sessions.keys()]) {
      disposeSession(sessionId);
    }
  };

  function getRequestServerUrl(req: Request): string {
    if (process.env['SERVER_URL']) {
      return process.env['SERVER_URL'];
    }

    const protocol = req.protocol || 'http';
    const requestHost = req.get('host');
    if (requestHost) {
      return `${protocol}://${requestHost}`;
    }

    return `http://${host}:${port}`;
  }

  // Resource Indicator validation (RFC 8707) - validate against the actual request origin.
  // This keeps dynamic-port test servers and proxied deployments aligned with the audience
  // clients must request in bearer tokens.
  const validateResourceIndicator: express.RequestHandler = async (req, res, next) => {
    const validator = createResourceIndicatorValidator(getRequestServerUrl(req));
    const middleware = optionalResourceIndicatorMiddleware(validator);
    await middleware(req, res, next);
  };

  // SSE endpoint for Server-Sent Events transport
  // Add OAuth validation middleware if OAuth is enabled
  const sseMiddleware =
    enableOAuth && oauth
      ? [validateResourceIndicator as express.RequestHandler, oauth.validateToken()]
      : [validateResourceIndicator as express.RequestHandler];

  const legacySseHeaders = {
    Deprecation: 'true',
    Sunset: 'Wed, 29 Apr 2026 00:00:00 GMT',
    Link: '</mcp>; rel="alternate"',
  };

  if (!legacySseEnabled) {
    app.get('/sse', ...sseMiddleware, (_req: Request, res: Response) => {
      res
        .status(410)
        .set(legacySseHeaders)
        .json({
          error: {
            code: 'DEPRECATED',
            message: 'Legacy SSE transport is disabled. Use /mcp (Streamable HTTP).',
            retryable: false,
          },
        });
    });

    app.post(
      '/sse/message',
      validateResourceIndicator as express.RequestHandler,
      (_req: Request, res: Response) => {
        res
          .status(410)
          .set(legacySseHeaders)
          .json({
            error: {
              code: 'DEPRECATED',
              message: 'Legacy SSE transport is disabled. Use /mcp (Streamable HTTP).',
              retryable: false,
            },
          });
      }
    );
  } else {
    app.get('/sse', ...sseMiddleware, async (req: Request, res: Response) => {
      // Extract Google token - from OAuth or Authorization header
      const googleToken =
        enableOAuth && oauth
          ? ((await oauth.getGoogleToken(req)) ?? undefined)
          : req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7)
            : undefined;

      // Extract user ID (use token hash as user ID)
      const userId = googleToken
        ? `google:${createHash('sha256').update(googleToken).digest('hex').substring(0, 16)}`
        : 'anonymous';

      // Check for SSE reconnection via Last-Event-ID header (RFC 8895)
      const lastEventId = req.headers['last-event-id'] as string | undefined;
      const requestedSessionId = (req.query['session'] as string | undefined) || lastEventId;

      // Try to reconnect to existing session if requested
      if (requestedSessionId && sessions.has(requestedSessionId)) {
        const existingSession = sessions.get(requestedSessionId)!;

        // Verify security context to prevent session hijacking
        const currentSecurityContext = createSessionSecurityContext(req, googleToken || '');
        const securityCheck = verifySessionSecurityContext(
          existingSession.securityContext,
          currentSecurityContext
        );

        if (!securityCheck.valid) {
          logger.warn('Session reconnection rejected - security context mismatch', {
            sessionId: requestedSessionId,
            reason: securityCheck.reason,
            userId,
          });

          res
            .status(403)
            .set(legacySseHeaders)
            .json({
              error: {
                code: 'SESSION_SECURITY_VIOLATION',
                message: `Session reconnection rejected: ${securityCheck.reason}`,
                retryable: false,
              },
            });
          return;
        }

        logger.info('SSE session reconnection', {
          sessionId: requestedSessionId,
          userId,
          lastEventId,
        });

        // Set SSE headers for reconnection
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Session-ID', requestedSessionId);
        res.setHeader('X-Reconnected', 'true');
        res.setHeader('Deprecation', legacySseHeaders.Deprecation);
        res.setHeader('Sunset', legacySseHeaders.Sunset);
        res.setHeader('Link', legacySseHeaders.Link);

        // Send reconnection acknowledgment
        res.write(
          `event: reconnect\ndata: {"sessionId":"${requestedSessionId}","status":"reconnected"}\n\n`
        );

        // Replay events if lastEventId provided and eventStore available
        if (lastEventId && existingSession?.eventStore) {
          try {
            logger.info('Replaying SSE events after reconnection', {
              sessionId: requestedSessionId,
              lastEventId,
            });

            await existingSession.eventStore.replayEventsAfter(lastEventId, {
              send: async (eventId: string, message: unknown) => {
                res.write(`id: ${eventId}\n`);
                res.write(`data: ${JSON.stringify(message)}\n\n`);
              },
            });

            logger.info('SSE event replay completed', {
              sessionId: requestedSessionId,
            });
          } catch (error) {
            logger.warn('SSE event replay failed', {
              sessionId: requestedSessionId,
              lastEventId,
              error,
            });
          }
        }

        return;
      }

      // Check session limits before creating new session
      const limitCheck = sessionLimiter.canCreateSession(userId);
      if (!limitCheck.allowed) {
        res
          .status(429)
          .set(legacySseHeaders)
          .json({
            error: {
              code: 'TOO_MANY_SESSIONS',
              message: limitCheck.reason,
              retryable: true,
            },
          });
        return;
      }

      const sessionId = randomUUID();

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Session-ID', sessionId);
      res.setHeader('Deprecation', legacySseHeaders.Deprecation);
      res.setHeader('Sunset', legacySseHeaders.Sunset);
      res.setHeader('Link', legacySseHeaders.Link);

      try {
        // Create SSE transport
        const transport = new SSEServerTransport('/sse/message', res);

        // Register session in limiter
        sessionLimiter.registerSession(sessionId, userId);

        // Create security context for session binding
        const securityContext = createSessionSecurityContext(req, googleToken || '');

        // Create event store for event replay on reconnection
        const eventStore = createSessionEventStore({
          sessionId,
          eventStoreRedisUrl,
          eventStoreTtlMs,
          eventStoreMaxEvents,
        });

        // Create and connect MCP server with task store
        const { mcpServer, taskStore, disposeRuntime } = await createMcpServerInstance(
          googleToken,
          undefined,
          sessionId
        );
        await mcpServer.connect(transport);
        sessions.set(sessionId, {
          transport,
          mcpServer,
          taskStore,
          disposeRuntime,
          securityContext,
          eventStore,
          lastActivity: Date.now(),
        });
        sessionsTotal.set(sessions.size);

        // Cleanup on disconnect
        req.on('close', () => {
          disposeSession(sessionId, {
            closeTransport: false,
          });
        });
      } catch (error) {
        res
          .status(500)
          .set(legacySseHeaders)
          .json({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Failed to establish SSE connection',
              details:
                process.env['NODE_ENV'] === 'production'
                  ? undefined
                  : error instanceof Error
                    ? error.message
                    : String(error),
            },
          });
      }
    });

    // SSE message endpoint
    app.post(
      '/sse/message',
      validateResourceIndicator as express.RequestHandler,
      async (req: Request, res: Response) => {
        const sessionId =
          (req.headers['x-session-id'] as string | undefined) ||
          (req.headers['mcp-session-id'] as string | undefined);

        if (!sessionId) {
          res
            .status(400)
            .set(legacySseHeaders)
            .json({
              error: {
                code: 'INVALID_REQUEST',
                message: 'Missing X-Session-ID header',
              },
            });
          return;
        }

        const session = sessions.get(sessionId);
        if (session) session.lastActivity = Date.now();
        const transport = session?.transport;

        if (!transport) {
          res
            .status(404)
            .set(legacySseHeaders)
            .json({
              error: {
                code: 'SESSION_NOT_FOUND',
                message: 'Session not found',
              },
            });
          return;
        }

        try {
          if (transport instanceof SSEServerTransport) {
            await withHttpRequestContext(req, async () => {
              await transport.handlePostMessage(req, res);
            });
          } else {
            res
              .status(400)
              .set(legacySseHeaders)
              .json({
                error: {
                  code: 'INVALID_REQUEST',
                  message: 'Invalid transport type for SSE message',
                },
              });
          }
        } catch (error) {
          res
            .status(500)
            .set(legacySseHeaders)
            .json({
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to process message',
                details:
                  process.env['NODE_ENV'] === 'production'
                    ? undefined
                    : error instanceof Error
                      ? error.message
                      : String(error),
              },
            });
        }
      }
    );
  }

  // Streamable HTTP endpoint (GET/POST/DELETE)
  const streamableMiddleware =
    enableOAuth && oauth
      ? [validateResourceIndicator as express.RequestHandler, oauth.validateToken()]
      : [validateResourceIndicator as express.RequestHandler];

  app.all('/mcp', ...streamableMiddleware, async (req: Request, res: Response) => {
    // Extract Google token
    const authHeader = req.headers.authorization;
    const googleToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    // Extract user ID (use token hash as user ID)
    const userId = googleToken
      ? `google:${createHash('sha256').update(googleToken).digest('hex').substring(0, 16)}`
      : 'anonymous';

    const sessionId = normalizeMcpSessionHeader(req);
    const isPost = req.method === 'POST';

    try {
      // Create transport if new session (POST + initialize only)
      let session = sessionId ? sessions.get(sessionId) : undefined;
      if (session) session.lastActivity = Date.now();
      let transport = session?.transport;

      if (sessionId && session && !(transport instanceof StreamableHTTPServerTransport)) {
        res.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Session exists but uses a different transport protocol',
          },
        });
        return;
      }

      if (!transport) {
        if (sessionId && !isPost) {
          res.status(404).json({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found',
            },
          });
          return;
        }
        if (!isPost) {
          res.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Missing Mcp-Session-Id header',
            },
          });
          return;
        }

        const body = req.body as unknown;
        const isInitRequest = Array.isArray(body)
          ? body.some((msg) => isInitializeRequest(msg))
          : isInitializeRequest(body);

        if (sessionId && !isInitRequest) {
          res.status(404).json({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found',
            },
          });
          return;
        }

        if (!isInitRequest) {
          res.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Bad Request: No valid session ID provided',
            },
          });
          return;
        }

        if (sessionId) {
          res.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message:
                'Mcp-Session-Id must not be provided on initialize; the server generates session IDs',
            },
          });
          return;
        }

        const newSessionId = randomUUID();

        // Check session limits before creating new session
        const limitCheck = sessionLimiter.canCreateSession(userId);
        if (!limitCheck.allowed) {
          res.status(429).json({
            error: {
              code: 'TOO_MANY_SESSIONS',
              message: limitCheck.reason,
              retryable: true,
            },
          });
          return;
        }

        const eventStore = createSessionEventStore({
          sessionId: newSessionId,
          eventStoreRedisUrl,
          eventStoreTtlMs,
          eventStoreMaxEvents,
        });
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          eventStore,
        });
        transport = newTransport;

        // Register session in limiter
        sessionLimiter.registerSession(newSessionId, userId);

        // Create security context for session binding
        const securityContext = createSessionSecurityContext(req, googleToken || '');

        const { mcpServer, taskStore, disposeRuntime } = await createMcpServerInstance(
          googleToken,
          undefined,
          newSessionId
        );
        sessions.set(newSessionId, {
          transport: newTransport,
          mcpServer,
          taskStore,
          disposeRuntime,
          eventStore,
          securityContext,
          lastActivity: Date.now(),
        });
        sessionsTotal.set(sessions.size);

        newTransport.onclose = () => {
          disposeSession(newSessionId, {
            closeTransport: false,
          });
        };

        await mcpServer.connect(newTransport as unknown as Parameters<typeof mcpServer.connect>[0]);
      } else if (session && transport instanceof StreamableHTTPServerTransport) {
        // Reconnecting to existing session - verify security context
        const currentSecurityContext = createSessionSecurityContext(req, googleToken || '');
        const securityCheck = verifySessionSecurityContext(
          session.securityContext,
          currentSecurityContext
        );

        if (!securityCheck.valid) {
          logger.warn('StreamableHTTP session rejected - security context mismatch', {
            sessionId,
            reason: securityCheck.reason,
            userId,
          });

          res.status(403).json({
            error: {
              code: 'SESSION_SECURITY_VIOLATION',
              message: `Session reconnection rejected: ${securityCheck.reason}`,
              retryable: false,
            },
          });
          return;
        }
      }

      if (transport instanceof StreamableHTTPServerTransport) {
        await withHttpRequestContext(req, async () => {
          await transport.handleRequest(req, res, isPost ? req.body : undefined);
        });
      }
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process MCP request',
          details:
            process.env['NODE_ENV'] === 'production'
              ? undefined
              : error instanceof Error
                ? error.message
                : String(error),
        },
      });
    }
  });

  // MCP 2025-11-25 spec: DELETE /mcp with Mcp-Session-Id header for session termination
  app.delete('/mcp', (req: Request, res: Response) => {
    const sessionId = normalizeMcpSessionHeader(req);
    if (!sessionId) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Mcp-Session-Id header required for session termination',
        },
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
        },
      });
      return;
    }

    // Verify caller is the session owner via security context (token + user-agent match)
    // Skip check if securityContext is absent (legacy or test sessions without binding)
    if (session.securityContext) {
      const callerToken = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : '';
      const currentContext = createSessionSecurityContext(req, callerToken);
      const securityCheck = verifySessionSecurityContext(session.securityContext, currentContext);

      if (!securityCheck.valid) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Session ownership verification failed',
          },
        });
        return;
      }
    }

    disposeSession(sessionId);
    res.status(200).json({ success: true, sessionId });
  });

  // Session cleanup endpoint - requires session ownership verification
  app.delete('/session/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params['sessionId'] as string;

    if (!sessionId) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Session ID required',
        },
      });
      return;
    }

    const session = sessions.get(sessionId);

    if (session) {
      // Verify caller is the session owner via security context (token + user-agent match)
      // Skip check if securityContext is absent (legacy or test sessions without binding)
      if (session.securityContext) {
        const callerToken = req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.slice(7)
          : '';
        const currentContext = createSessionSecurityContext(req, callerToken);
        const securityCheck = verifySessionSecurityContext(session.securityContext, currentContext);

        if (!securityCheck.valid) {
          res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'Session ownership verification failed',
            },
          });
          return;
        }
      }

      disposeSession(sessionId);
      res.json({ success: true, message: 'Session terminated' });
    } else {
      res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      });
    }
  });

  return { sessionCleanupInterval, cleanupSessions };
}
