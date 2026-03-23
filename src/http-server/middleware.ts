import compression from 'compression';
import cors from 'cors';
import express from 'express';
import type { Application, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { responseRedactionMiddleware } from '../middleware/redaction.js';
import { getRequestRecorder } from '../services/request-recorder.js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { addDeprecationHeaders, extractVersionFromRequest } from '../versioning/schema-manager.js';
import { extractTrustedClientIp } from './client-ip.js';

export function registerHttpFoundationMiddleware(params: {
  app: Application;
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}): void {
  const { app, corsOrigins, trustProxy, rateLimitWindowMs, rateLimitMax } = params;
  const envConfig = getEnv();
  const oauthIssuerHost = (() => {
    try {
      return new URL(envConfig.OAUTH_ISSUER).host.toLowerCase();
    } catch {
      return undefined; // SAFETY: invalid issuer config disables same-host relaxation and keeps strict origin checks.
    }
  })();

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      strictTransportSecurity:
        process.env['NODE_ENV'] === 'production'
          ? {
              maxAge: 31536000, // 1 year
              includeSubDomains: true,
              preload: true,
            }
          : false, // Disable in development (localhost issues)
    })
  );

  // Compression middleware (gzip)
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      threshold: 1024, // Only compress responses larger than 1KB
    })
  );

  // Response redaction middleware (strips tokens, API keys from error responses)
  // Enabled by default in production, or when ENABLE_RESPONSE_REDACTION=true
  app.use(responseRedactionMiddleware());

  // Schema versioning middleware (P3-5)
  // Handles version negotiation via query param or header
  app.use((req: Request, res: Response, next: NextFunction) => {
    const versionSelection = extractVersionFromRequest(req);
    addDeprecationHeaders(res, versionSelection);
    req.schemaVersion = versionSelection.selectedVersion;
    next();
  });

  // Request recording middleware (P3-6)
  // Records all tool calls to SQLite for replay and debugging
  // Controlled by RECORD_REQUESTS env var (opt-in: set true to enable)
  const recorder = getRequestRecorder();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const originalJson = res.json.bind(res);

    // Intercept res.json to capture response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match Express res.json signature
    res.json = function (data: any) {
      const duration = Date.now() - startTime;

      // Extract tool info from request body
      const toolName = req.body?.tool || req.body?.name || 'unknown';
      const action = req.body?.action || req.body?.arguments?.action || 'unknown';
      const spreadsheetId =
        req.body?.spreadsheetId ||
        req.body?.arguments?.spreadsheetId ||
        req.body?.params?.spreadsheetId ||
        null;

      // Record the request/response pair
      recorder.record({
        timestamp: startTime,
        tool_name: toolName,
        action,
        spreadsheet_id: spreadsheetId,
        request_body: JSON.stringify(req.body || {}),
        response_body: JSON.stringify(data),
        status_code: res.statusCode,
        duration_ms: duration,
        error_message: data?.error ? JSON.stringify(data.error) : null,
      });

      return originalJson(data);
    };

    next();
  });

  // HTTPS Enforcement (Production Only)
  if (process.env['NODE_ENV'] === 'production') {
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Check if request is HTTPS (direct or behind proxy)
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

      if (!isHttps) {
        logger.warn('Rejected non-HTTPS request in production', {
          method: req.method,
          path: req.path,
          ip: req.ip,
          protocol: req.protocol,
          forwardedProto: req.headers['x-forwarded-proto'],
        });

        res.status(426).json({
          error: 'UPGRADE_REQUIRED',
          message: 'HTTPS is required for all requests in production mode',
          details: {
            reason:
              'Security: OAuth tokens and sensitive data must be transmitted over encrypted connections',
            action: 'Use https:// instead of http:// in your request URL',
          },
        });
        return;
      }

      next();
    });
  }

  // Trust proxy for rate limiting behind load balancer
  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'X-Request-ID',
        'X-Session-ID',
        'MCP-Session-Id',
        'MCP-Protocol-Version',
        'Last-Event-ID',
      ],
      exposedHeaders: ['MCP-Session-Id', 'X-Session-ID', 'MCP-Protocol-Version'],
    })
  );

  // Origin Validation for Authenticated Endpoints
  // CORS handles browser preflight, but this adds explicit validation for all authenticated requests
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    const referer = req.get('referer');

    // Skip validation for requests without origin (same-origin, curl, etc.)
    if (!origin && !referer) {
      next();
      return;
    }

    // Extract origin from referer if origin header is missing (some clients)
    const requestOrigin = origin || (referer ? new URL(referer).origin : null);

    if (requestOrigin && !corsOrigins.includes(requestOrigin)) {
      logger.warn('Rejected request with invalid Origin', {
        origin: requestOrigin,
        path: req.path,
        method: req.method,
        ip: req.ip,
        allowedOrigins: corsOrigins,
      });

      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Invalid Origin header',
      });
      return;
    }

    next();
  });

  // DNS Rebinding Protection - Host header validation
  // Ensures requests target expected hostnames, preventing DNS rebinding attacks
  // that could bypass Origin checks by pointing a malicious domain at localhost
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = req.get('host');

    // Skip for requests without Host header (non-standard but possible)
    if (!host) {
      next();
      return;
    }

    // Extract hostname (strip port)
    const hostname = (host.split(':')[0] ?? host).toLowerCase();

    // Allow localhost variants and configured hostnames
    const allowedHosts = new Set([
      'localhost',
      '127.0.0.1',
      '::1',
      ...(oauthIssuerHost ? [oauthIssuerHost] : []),
      ...(process.env['SERVAL_ALLOWED_HOSTS']?.split(',').map((h) => h.trim().toLowerCase()) ?? []),
    ]);

    if (!allowedHosts.has(hostname)) {
      logger.warn('Rejected request with invalid Host header (DNS rebinding protection)', {
        host,
        hostname,
        path: req.path,
        method: req.method,
        ip: req.ip,
      });

      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Invalid Host header',
        details: {
          received: hostname,
          hint: 'Set SERVAL_ALLOWED_HOSTS env var to allow additional hostnames',
        },
      });
      return;
    }

    next();
  });

  // Rate limiting with explicit values - exempt health check endpoints
  const limiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const ip = extractTrustedClientIp(req);
      return `${ipKeyGenerator(ip)}:${req.method}:${req.path}`;
    },
    message: { error: 'Too many requests, please try again later' },
    // Add custom rate limit info handler
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: res.getHeader('RateLimit-Reset'),
      });
    },
  });

  // Apply rate limiting to all routes EXCEPT health checks
  // Health checks must not be rate-limited to ensure reliable monitoring
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/health')) {
      return next(); // Skip rate limiter for health endpoints
    }
    limiter(req, res, next);
  });

  // Add explicit X-RateLimit-* headers for better client compatibility
  app.use((req: Request, res: Response, next: NextFunction) => {
    // express-rate-limit@8 sets RateLimit-* headers (RFC 6585)
    // Also expose as X-RateLimit-* for legacy compatibility
    const limit = res.getHeader('RateLimit-Limit');
    const remaining = res.getHeader('RateLimit-Remaining');
    const reset = res.getHeader('RateLimit-Reset');

    if (limit) res.setHeader('X-RateLimit-Limit', limit);
    if (remaining) res.setHeader('X-RateLimit-Remaining', remaining);
    if (reset) res.setHeader('X-RateLimit-Reset', reset);

    next();
  });

  // Parse JSON
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // MCP Protocol Version Header (MCP 2025-11-25 Compliance)
  // Specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports.md
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Always set supported version on response
    res.setHeader('MCP-Protocol-Version', '2025-11-25');

    // Skip version check for non-MCP JSON-RPC endpoints (health, metrics, /session REST mgmt, etc.)
    // /session/:id is a REST management API, not an MCP JSON-RPC endpoint
    if (!req.path.startsWith('/sse') && !req.path.startsWith('/mcp')) {
      return next();
    }

    const clientVersion = req.headers['mcp-protocol-version'] as string | undefined;
    const body = req.body as unknown;
    const isInitializeRequest =
      req.method === 'POST' &&
      req.path.startsWith('/mcp') &&
      (Array.isArray(body)
        ? body.some(
            (entry) =>
              entry &&
              typeof entry === 'object' &&
              'method' in entry &&
              entry.method === 'initialize'
          )
        : Boolean(
            body && typeof body === 'object' && 'method' in body && body.method === 'initialize'
          ));

    if (envConfig.STRICT_MCP_PROTOCOL_VERSION && !clientVersion && !isInitializeRequest) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing MCP-Protocol-Version header. Expected MCP-Protocol-Version: 2025-11-25',
        },
      });
      return;
    }

    // If client specifies a different version, reject with 400
    if (clientVersion && clientVersion !== '2025-11-25') {
      logger.warn('Request rejected: unsupported MCP protocol version', {
        clientVersion,
        supportedVersion: '2025-11-25',
        path: req.path,
        method: req.method,
      });

      res.status(400).json({
        error: 'UNSUPPORTED_PROTOCOL_VERSION',
        message: `MCP protocol version '${clientVersion}' is not supported`,
        details: {
          requested: clientVersion,
          supported: '2025-11-25',
          spec: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports',
        },
      });
      return;
    }

    next();
  });
}
