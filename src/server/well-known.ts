/**
 * ServalSheets - .well-known Discovery Endpoints
 *
 * Implements RFC 8615 well-known URIs for server discovery:
 * - /.well-known/mcp.json: MCP Server Card (SEP-1649) - primary discovery
 * - /.well-known/mcp/tool-hashes: Tool description integrity manifest
 * - /.well-known/mcp-configuration: MCP server capabilities (legacy)
 * - /.well-known/oauth-authorization-server: OAuth 2.0 metadata (RFC 8414)
 * - /.well-known/oauth-protected-resource: Resource server metadata (RFC 9728)
 *
 * These endpoints allow clients and registries to discover server
 * capabilities without establishing an MCP connection.
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649 - SEP-1649 Server Cards
 * @see https://www.rfc-editor.org/rfc/rfc8615 - Well-Known URIs
 * @see https://www.rfc-editor.org/rfc/rfc8414 - OAuth 2.0 Authorization Server Metadata
 * @see https://www.rfc-editor.org/rfc/rfc9728 - OAuth 2.0 Protected Resource Metadata
 */

import type { Request, Response } from 'express';
import type { Icon } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { VERSION, SERVER_INFO, SERVER_ICONS } from '../version.js';
import { TOOL_COUNT, ACTION_COUNT } from '../schemas/index.js';
import { DEFAULT_SCOPES, ELEVATED_SCOPES, READONLY_SCOPES } from '../services/google-api.js';
import { getEnv } from '../config/env.js';
import { getPromptsCatalogCount } from '../resources/prompts-catalog.js';
import { getToolHashManifest } from '../security/tool-hash-registry.js';
import { logger } from '../utils/logger.js';

/**
 * Compute ETag for JSON content
 * Uses weak ETag (W/) per RFC 7232 since content is semantically equivalent
 */
function computeETag(content: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(content))
    .digest('base64url')
    .substring(0, 16);
  return `W/"${hash}"`;
}

/**
 * MCP Server Configuration
 * Describes server capabilities for discovery
 */
export interface McpServerConfiguration {
  /** Server name (package name) */
  name: string;
  /** Server version (semver) */
  version: string;
  /** Human-readable description */
  description: string;
  /** Optional server icon set */
  icons?: Icon[];
  /** MCP protocol version supported */
  protocol_version: string;
  /** Server capabilities */
  capabilities: {
    tools: {
      count: number;
      actions: number;
    };
    resources: {
      supported: boolean;
      templates: boolean;
      subscriptions: boolean;
    };
    prompts: {
      supported: boolean;
      count: number;
    };
    tasks: {
      supported: boolean;
    };
    sampling: {
      supported: boolean;
    };
    elicitation: {
      form: boolean;
      url: boolean;
    };
    completions: {
      supported: boolean;
    };
    logging: {
      supported: boolean;
    };
  };
  /** Supported transports */
  transports: ('stdio' | 'sse' | 'streamable-http')[];
  /** Authentication requirements */
  authentication: {
    type: 'oauth2';
    flows: ('authorization_code' | 'client_credentials')[];
    pkce_required: boolean;
    default_scopes: string[];
    elevated_scopes: string[];
    readonly_scopes: string[];
  };
  /** External links */
  links: {
    documentation?: string;
    repository?: string;
    issues?: string;
    homepage?: string;
    registry_entry?: string;
  };
}

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
export interface OAuthAuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  jwks_uri?: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
}

/**
 * MCP Server Card (SEP-1649)
 *
 * Structured metadata document for HTTP-based MCP server discovery.
 * Exposed at /.well-known/mcp.json to enable:
 * - Autoconfiguration without manual endpoint setup
 * - Registry/crawler discovery of MCP servers
 * - Static capability verification before connection
 * - Reduced latency for server information display
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649
 */
export interface McpServerCard {
  /** Schema version for the server card format */
  $schema?: string;
  /** MCP protocol version supported */
  mcp_version: string;
  /** Server name (unique identifier) */
  server_name: string;
  /** Server version (semver) */
  server_version: string;
  /** Human-readable description */
  description: string;
  /** Server icons for client UIs */
  icons?: Icon[];
  /** Transport endpoints */
  endpoints: {
    /** Streamable HTTP endpoint (recommended) */
    streamable_http?: string;
    /** Legacy SSE endpoint */
    sse?: string;
    /** WebSocket endpoint (if supported) */
    websocket?: string;
    /** STDIO supported (boolean, no URL) */
    stdio?: boolean;
  };
  /** Server capabilities summary */
  capabilities: {
    tools: boolean | { count: number; actions?: number };
    resources: boolean | { templates?: boolean; subscriptions?: boolean };
    prompts: boolean | { count?: number };
    sampling?: boolean;
    roots?: boolean;
    tasks?: boolean;
    elicitation?: boolean | { form?: boolean; url?: boolean };
    completions?: boolean;
    logging?: boolean;
    progress?: boolean;
  };
  /** Authentication requirements */
  authentication?: {
    required: boolean;
    methods: ('oauth2' | 'api_key' | 'bearer' | 'mtls')[];
    oauth2?: {
      authorization_endpoint: string;
      token_endpoint: string;
      scopes_supported: string[];
      pkce_required?: boolean;
    };
  };
  /** Security configuration */
  security?: {
    tls_required?: boolean;
    min_tls_version?: string;
    cors_origins?: string[];
  };
  /** Rate limiting information */
  rate_limits?: {
    requests_per_minute?: number;
    requests_per_hour?: number;
  };
  /** External links */
  links?: {
    documentation?: string;
    repository?: string;
    issues?: string;
    homepage?: string;
    changelog?: string;
    registry?: string;
  };
  /** Publisher/organization information */
  publisher?: {
    name: string;
    url?: string;
    email?: string;
  };
  /** Keywords for discovery */
  keywords?: string[];
  /** License identifier (SPDX) */
  license?: string;
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 */
export interface OAuthProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_documentation?: string;
}

/**
 * Runtime configuration values surfaced in discovery metadata.
 */
export interface WellKnownRuntimeConfig {
  corsOrigins?: string[];
  rateLimitMax?: number;
  legacySseEnabled?: boolean;
  authenticationRequired?: boolean;
}

/**
 * Get MCP server configuration for discovery
 */
export function getMcpConfiguration(): McpServerConfiguration {
  const env = getEnv();
  const promptCount = getPromptsCatalogCount();
  const transports: McpServerConfiguration['transports'] = env.ENABLE_LEGACY_SSE
    ? ['stdio', 'sse', 'streamable-http']
    : ['stdio', 'streamable-http'];

  return {
    name: SERVER_INFO.name,
    version: VERSION,
    description:
      'Production-grade Google Sheets MCP server with AI-powered analytics, transactions, and enterprise features',
    icons: SERVER_ICONS,
    protocol_version: SERVER_INFO.protocolVersion,
    capabilities: {
      tools: {
        count: TOOL_COUNT,
        actions: ACTION_COUNT,
      },
      resources: {
        supported: true,
        templates: true,
        subscriptions: true,
      },
      prompts: {
        supported: true,
        count: promptCount,
      },
      tasks: {
        supported: true,
      },
      sampling: {
        supported: true,
      },
      elicitation: {
        form: true,
        url: true,
      },
      completions: {
        supported: true,
      },
      logging: {
        supported: true,
      },
    },
    transports,
    authentication: {
      type: 'oauth2',
      flows: ['authorization_code'],
      pkce_required: true,
      default_scopes: DEFAULT_SCOPES,
      elevated_scopes: ELEVATED_SCOPES,
      readonly_scopes: READONLY_SCOPES,
    },
    links: {
      documentation: 'https://github.com/khill1269/servalsheets#readme',
      repository: 'https://github.com/khill1269/servalsheets',
      issues: 'https://github.com/khill1269/servalsheets/issues',
      homepage: 'https://github.com/khill1269/servalsheets',
    },
  };
}

/**
 * Get MCP Server Card (SEP-1649)
 *
 * Returns the server card for /.well-known/mcp.json endpoint.
 * This is the primary discovery mechanism for HTTP-based MCP servers.
 *
 * @param serverUrl - Base URL of the server (for endpoint URLs)
 * @returns McpServerCard - Structured metadata for server discovery
 */
export function getMcpServerCard(serverUrl?: string): McpServerCard {
  const baseUrl = serverUrl || '';
  const allScopes = [...DEFAULT_SCOPES, ...ELEVATED_SCOPES, ...READONLY_SCOPES].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  const env = getEnv();
  const corsOrigins = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const effectiveCorsOrigins =
    corsOrigins.length > 0 ? corsOrigins : ['https://claude.ai', 'https://claude.com'];

  return composeMcpServerCard(baseUrl, allScopes, {
    corsOrigins: effectiveCorsOrigins,
    rateLimitMax: env.RATE_LIMIT_MAX,
    legacySseEnabled: env.ENABLE_LEGACY_SSE,
    authenticationRequired: false,
  });
}

function composeMcpServerCard(
  baseUrl: string,
  allScopes: string[],
  runtimeConfig: Required<WellKnownRuntimeConfig>
): McpServerCard {
  const promptCount = getPromptsCatalogCount();
  const effectiveCorsOrigins =
    runtimeConfig.corsOrigins.length > 0
      ? runtimeConfig.corsOrigins
      : ['https://claude.ai', 'https://claude.com'];

  const endpoints: McpServerCard['endpoints'] = {
    streamable_http: baseUrl ? `${baseUrl}/mcp` : '/mcp',
    stdio: true,
  };
  if (runtimeConfig.legacySseEnabled) {
    endpoints['sse'] = baseUrl ? `${baseUrl}/sse` : '/sse';
  }

  return {
    $schema: 'https://modelcontextprotocol.io/schemas/mcp-server-card.json',
    mcp_version: SERVER_INFO.protocolVersion,
    server_name: SERVER_INFO.name,
    server_version: VERSION,
    description:
      `Enterprise-grade Google Sheets MCP server with ${TOOL_COUNT} tools and ${ACTION_COUNT} specialized actions. ` +
      'Features AI-powered analysis, atomic transactions (80% API savings), MCP elicitation, ' +
      'task support with cancellation, and comprehensive error handling.',
    icons: SERVER_ICONS,
    endpoints,
    capabilities: {
      tools: {
        count: TOOL_COUNT,
        actions: ACTION_COUNT,
      },
      resources: {
        templates: true,
        subscriptions: true,
      },
      prompts: {
        count: promptCount,
      },
      sampling: true,
      roots: false,
      tasks: true,
      elicitation: {
        form: true,
        url: true,
      },
      completions: true,
      logging: true,
      progress: true,
    },
    authentication: {
      required: runtimeConfig.authenticationRequired,
      methods: ['oauth2'],
      oauth2: {
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        scopes_supported: allScopes,
        pkce_required: true,
      },
    },
    security: {
      tls_required: true,
      min_tls_version: '1.2',
      cors_origins: effectiveCorsOrigins,
    },
    rate_limits: {
      requests_per_minute: runtimeConfig.rateLimitMax,
    },
    links: {
      documentation: 'https://github.com/khill1269/servalsheets#readme',
      repository: 'https://github.com/khill1269/servalsheets',
      issues: 'https://github.com/khill1269/servalsheets/issues',
      homepage: 'https://github.com/khill1269/servalsheets',
      changelog: 'https://github.com/khill1269/servalsheets/blob/main/CHANGELOG.md',
    },
    publisher: {
      name: 'Thomas Lee Cahill',
      url: 'https://github.com/khill1269',
    },
    keywords: [
      'google-sheets',
      'spreadsheet',
      'mcp',
      'ai',
      'automation',
      'data-analysis',
      'enterprise',
      'oauth2',
      'transactions',
      'charts',
      'pivot-tables',
    ],
    license: 'MIT',
  };
}

export function getMcpServerCardWithRuntimeConfig(
  runtimeConfig: WellKnownRuntimeConfig,
  serverUrl?: string
): McpServerCard {
  const baseUrl = serverUrl || '';
  const allScopes = [...DEFAULT_SCOPES, ...ELEVATED_SCOPES, ...READONLY_SCOPES].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  const env = getEnv();
  return composeMcpServerCard(baseUrl, allScopes, {
    corsOrigins: runtimeConfig.corsOrigins ?? env.CORS_ORIGINS.split(',').map((v) => v.trim()),
    rateLimitMax: runtimeConfig.rateLimitMax ?? env.RATE_LIMIT_MAX,
    legacySseEnabled: runtimeConfig.legacySseEnabled ?? env.ENABLE_LEGACY_SSE,
    authenticationRequired: runtimeConfig.authenticationRequired ?? false,
  });
}

/**
 * Get OAuth Authorization Server Metadata
 * Points to Google's OAuth server or custom issuer
 */
export function getOAuthAuthorizationServerMetadata(
  issuer?: string
): OAuthAuthorizationServerMetadata {
  const serverIssuer = issuer || 'https://accounts.google.com';

  // Use Google endpoints if no issuer provided or if issuer is Google
  const isGoogleIssuer =
    !issuer || issuer.includes('google.com') || issuer.includes('accounts.google.com');

  if (isGoogleIssuer) {
    return {
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      revocation_endpoint: 'https://oauth2.googleapis.com/revoke',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
      scopes_supported: [...DEFAULT_SCOPES, ...ELEVATED_SCOPES, ...READONLY_SCOPES].filter(
        (v, i, a) => a.indexOf(v) === i
      ), // Deduplicate
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      code_challenge_methods_supported: ['S256'],
    };
  }

  // Custom issuer - build endpoints based on issuer URL
  return {
    issuer: serverIssuer,
    authorization_endpoint: `${serverIssuer}/oauth/authorize`,
    token_endpoint: `${serverIssuer}/oauth/token`,
    revocation_endpoint: `${serverIssuer}/oauth/revoke`,
    jwks_uri: `${serverIssuer}/.well-known/jwks.json`,
    scopes_supported: [...DEFAULT_SCOPES, ...ELEVATED_SCOPES, ...READONLY_SCOPES].filter(
      (v, i, a) => a.indexOf(v) === i
    ),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
  };
}

/**
 * Get OAuth Protected Resource Metadata
 * Describes this server as an OAuth-protected resource
 */
export function getOAuthProtectedResourceMetadata(
  serverUrl: string,
  authorizationServer?: string
): OAuthProtectedResourceMetadata {
  return {
    resource: serverUrl,
    authorization_servers: [authorizationServer ?? 'https://accounts.google.com'],
    scopes_supported: [...DEFAULT_SCOPES, ...ELEVATED_SCOPES, ...READONLY_SCOPES].filter(
      (v, i, a) => a.indexOf(v) === i
    ),
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/khill1269/servalsheets#readme',
  };
}

/**
 * Express handler for /.well-known/mcp.json (SEP-1649 Server Card)
 *
 * Primary discovery endpoint for HTTP-based MCP servers.
 * Returns structured metadata without requiring MCP connection.
 */
export function mcpServerCardHandler(req: Request, res: Response): void {
  // Determine server URL from request for endpoint URLs
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const serverUrl = `${protocol}://${host}`;

  const card = getMcpServerCard(serverUrl);
  const etag = computeETag(card);

  // Check If-None-Match for conditional request
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.set('ETag', etag);
  res.set('Vary', 'Accept-Encoding, Host'); // Vary by host since endpoints depend on it
  res.set('Access-Control-Allow-Origin', '*'); // Allow discovery from any origin
  res.json(card);
}

function createMcpServerCardHandler(runtimeConfig: WellKnownRuntimeConfig) {
  return (req: Request, res: Response): void => {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const serverUrl = `${protocol}://${host}`;

    const card = getMcpServerCardWithRuntimeConfig(runtimeConfig, serverUrl);
    const etag = computeETag(card);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('ETag', etag);
    res.set('Vary', 'Accept-Encoding, Host');
    res.set('Access-Control-Allow-Origin', '*');
    res.json(card);
  };
}

/**
 * Express handler for /.well-known/mcp-configuration
 */
export function mcpConfigurationHandler(req: Request, res: Response): void {
  const config = getMcpConfiguration();
  const etag = computeETag(config);

  // Check If-None-Match for conditional request
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.set('ETag', etag);
  res.set('Vary', 'Accept-Encoding');
  res.set('Access-Control-Allow-Origin', '*'); // Allow discovery from any origin
  res.json(config);
}

/**
 * Express handler for /.well-known/oauth-authorization-server
 */
export function oauthAuthorizationServerHandler(req: Request, res: Response): void {
  const metadata = getOAuthAuthorizationServerMetadata(getEnv().OAUTH_ISSUER);
  const etag = computeETag(metadata);

  // Check If-None-Match for conditional request
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.set('ETag', etag);
  res.set('Vary', 'Accept-Encoding');
  res.set('Access-Control-Allow-Origin', '*');
  res.json(metadata);
}

/**
 * Express handler for /.well-known/oauth-protected-resource
 */
export function oauthProtectedResourceHandler(req: Request, res: Response): void {
  // Determine server URL from request
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const serverUrl = `${protocol}://${host}`;

  const metadata = getOAuthProtectedResourceMetadata(serverUrl, getEnv().OAUTH_ISSUER);
  const etag = computeETag(metadata);

  // Check If-None-Match for conditional request
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.set('ETag', etag);
  res.set('Vary', 'Accept-Encoding, Host'); // Vary by host since content depends on it
  res.set('Access-Control-Allow-Origin', '*');
  res.json(metadata);
}

/**
 * Express handler for /.well-known/mcp/tool-hashes
 *
 * Exposes the committed tool-description hash manifest used for rug-pull detection.
 */
export async function toolHashManifestHandler(req: Request, res: Response): Promise<void> {
  try {
    const manifest = await getToolHashManifest();
    const etag = computeETag(manifest);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('ETag', etag);
    res.set('Vary', 'Accept-Encoding');
    res.set('Access-Control-Allow-Origin', '*');
    res.json(manifest);
  } catch (error) {
    logger.error('Failed to build tool hash manifest', { error });
    res.status(500).json({
      error: 'tool_hash_manifest_unavailable',
      message: 'Failed to load tool hash manifest',
    });
  }
}

/**
 * Register all well-known handlers with an Express app
 */
export function registerWellKnownHandlers(
  app: {
    get: (path: string, handler: (req: Request, res: Response) => void | Promise<void>) => void;
  },
  runtimeConfig?: WellKnownRuntimeConfig
): void {
  const cardHandler = runtimeConfig
    ? createMcpServerCardHandler(runtimeConfig)
    : mcpServerCardHandler;

  // SEP-1649: MCP Server Card - primary discovery endpoint
  app.get('/.well-known/mcp.json', cardHandler);
  app.get('/.well-known/mcp/server-card.json', cardHandler);
  // Tool integrity manifest
  app.get('/.well-known/mcp/tool-hashes', toolHashManifestHandler);
  // Legacy MCP configuration endpoint
  app.get('/.well-known/mcp-configuration', mcpConfigurationHandler);
  // OAuth endpoints (RFC 8414, RFC 9728)
  app.get('/.well-known/oauth-authorization-server', oauthAuthorizationServerHandler);
  app.get('/.well-known/oauth-protected-resource', oauthProtectedResourceHandler);
}

// Aliases for backward compatibility with tests
/** @deprecated Use getMcpConfiguration instead */
export const buildMcpConfiguration = getMcpConfiguration;

/** @deprecated Use getOAuthAuthorizationServerMetadata instead */
export const buildOAuthAuthorizationServerMetadata = getOAuthAuthorizationServerMetadata;

/** @deprecated Use getOAuthProtectedResourceMetadata instead */
export const buildOAuthProtectedResourceMetadata = getOAuthProtectedResourceMetadata;

/** @deprecated Use mcpConfigurationHandler instead */
export const handleMcpConfiguration = mcpConfigurationHandler;

/** @deprecated Use oauthAuthorizationServerHandler instead */
export const handleOAuthAuthorizationServer = oauthAuthorizationServerHandler;

/** @deprecated Use oauthProtectedResourceHandler instead */
export const handleOAuthProtectedResource = oauthProtectedResourceHandler;

/** @deprecated Use mcpServerCardHandler instead */
export const handleMcpServerCard = mcpServerCardHandler;

/** @deprecated Use toolHashManifestHandler instead */
export const handleToolHashManifest = toolHashManifestHandler;

/** Alias for getMcpServerCard */
export const buildMcpServerCard = getMcpServerCard;
