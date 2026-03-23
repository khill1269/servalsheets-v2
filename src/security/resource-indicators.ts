/**
 * ServalSheets - Resource Indicators (RFC 8707)
 *
 * Implements RFC 8707 Resource Indicators for OAuth 2.0 token validation.
 * Ensures tokens were issued for THIS specific resource server, preventing
 * token mis-redemption attacks in multi-server environments.
 *
 * Flow:
 * 1. Client requests token with `resource` parameter pointing to our server
 * 2. Authorization server includes resource in token audience
 * 3. ServalSheets validates token audience matches our resource identifier
 * 4. Tokens without matching audience are rejected
 *
 * @see https://www.rfc-editor.org/rfc/rfc8707 - Resource Indicators for OAuth 2.0
 * @see https://spec.modelcontextprotocol.io/specification/security/
 */

import { logger } from '../utils/logger.js';
import jwt from 'jsonwebtoken';

/**
 * Resource indicator configuration
 */
export interface ResourceIndicatorConfig {
  /** This server's resource identifier (typically server URL) */
  resourceIdentifier: string;

  /** Allow tokens without resource indicator (lenient mode for migration) */
  allowMissingResource?: boolean;

  /** Additional valid resource identifiers (for aliases/migrations) */
  additionalResources?: string[];

  /** Google's token info endpoint for opaque token validation */
  tokenInfoEndpoint?: string;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean;
  reason?: string;
  resourceMatch?: boolean;
  audience?: string | string[];
  scopes?: string[];
  expiresAt?: number;
  email?: string;
}

/**
 * Decoded JWT claims relevant to resource validation
 */
interface TokenClaims {
  aud?: string | string[];
  azp?: string;
  iss?: string;
  sub?: string;
  email?: string;
  scope?: string;
  exp?: number;
  iat?: number;
}

/**
 * Google token info response
 */
interface GoogleTokenInfo {
  aud?: string;
  azp?: string;
  scope?: string;
  exp?: string;
  email?: string;
  email_verified?: string;
  access_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Resource Indicator Validator
 *
 * Validates OAuth tokens against RFC 8707 resource indicators.
 * Ensures tokens are intended for this specific server.
 */
export class ResourceIndicatorValidator {
  private config: ResourceIndicatorConfig;
  private validResources: Set<string>;

  constructor(config: ResourceIndicatorConfig) {
    this.config = {
      allowMissingResource: false, // Strict by default
      tokenInfoEndpoint: 'https://oauth2.googleapis.com/tokeninfo',
      ...config,
    };

    // Build set of valid resource identifiers
    this.validResources = new Set([
      this.normalizeResource(config.resourceIdentifier),
      ...(config.additionalResources ?? []).map((r) => this.normalizeResource(r)),
    ]);

    logger.info('Resource indicator validator initialized', {
      primaryResource: config.resourceIdentifier,
      additionalResources: config.additionalResources?.length ?? 0,
      strictMode: !this.config.allowMissingResource,
    });
  }

  /**
   * Normalize resource identifier for comparison
   * Removes trailing slashes and lowercases
   */
  private normalizeResource(resource: string): string {
    return resource.toLowerCase().replace(/\/+$/, '');
  }

  /**
   * Validate a JWT access token
   * Note: This does NOT verify signature - that should be done by Google's libraries
   * This only validates the audience claim against our resource identifier
   */
  validateJwtToken(token: string): TokenValidationResult {
    try {
      // Decode without verification - signature is verified by Google's client
      const decoded = jwt.decode(token) as TokenClaims | null;

      if (!decoded) {
        return {
          valid: false,
          reason: 'Unable to decode token',
        };
      }

      // Extract audience
      const audience = decoded.aud;
      const authorizedParty = decoded.azp;

      // Check if audience matches our resource
      const resourceMatch = this.checkAudience(audience, authorizedParty);

      if (!resourceMatch && !this.config.allowMissingResource) {
        logger.warn('Token audience mismatch', {
          expectedResource: this.config.resourceIdentifier,
          tokenAudience: audience,
          authorizedParty,
        });

        return {
          valid: false,
          reason: 'Token was not issued for this resource server',
          resourceMatch: false,
          audience,
        };
      }

      // Check expiration
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        return {
          valid: false,
          reason: 'Token has expired',
          resourceMatch,
          audience,
          expiresAt: decoded.exp,
        };
      }

      return {
        valid: true,
        resourceMatch,
        audience,
        scopes: decoded.scope?.split(' '),
        expiresAt: decoded.exp,
        email: decoded.email,
      };
    } catch (error) {
      logger.error('Token validation error', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        reason: `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate an opaque access token via Google's tokeninfo endpoint
   */
  async validateOpaqueToken(token: string): Promise<TokenValidationResult> {
    try {
      const response = await fetch(
        `${this.config.tokenInfoEndpoint}?access_token=${encodeURIComponent(token)}`
      );

      const data = (await response.json()) as GoogleTokenInfo;

      if (data.error) {
        return {
          valid: false,
          reason: data.error_description ?? data.error,
        };
      }

      // Check audience
      const resourceMatch = this.checkAudience(data.aud, data.azp);

      if (!resourceMatch && !this.config.allowMissingResource) {
        logger.warn('Opaque token audience mismatch', {
          expectedResource: this.config.resourceIdentifier,
          tokenAudience: data.aud,
          authorizedParty: data.azp,
        });

        return {
          valid: false,
          reason: 'Token was not issued for this resource server',
          resourceMatch: false,
          audience: data.aud,
        };
      }

      const exp = data.exp ? parseInt(data.exp, 10) : undefined;

      return {
        valid: true,
        resourceMatch,
        audience: data.aud,
        scopes: data.scope?.split(' '),
        expiresAt: exp,
        email: data.email,
      };
    } catch (error) {
      logger.error('Token info request failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        reason: `Token validation request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Check if audience matches our resource identifier
   */
  private checkAudience(audience?: string | string[], authorizedParty?: string): boolean {
    // No audience claim - depends on strict mode
    if (!audience && !authorizedParty) {
      return this.config.allowMissingResource ?? false;
    }

    // Check audience array
    if (Array.isArray(audience)) {
      return audience.some((aud) => this.isValidResource(aud));
    }

    // Check single audience
    if (audience && this.isValidResource(audience)) {
      return true;
    }

    // Check authorized party (azp) as fallback
    if (authorizedParty && this.isValidResource(authorizedParty)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a value matches any valid resource identifier
   */
  private isValidResource(value: string): boolean {
    const normalized = this.normalizeResource(value);
    return this.validResources.has(normalized);
  }

  /**
   * Get the resource identifier for OAuth authorization requests
   * Include this in the `resource` parameter when requesting tokens
   */
  getResourceIdentifier(): string {
    return this.config.resourceIdentifier;
  }

  /**
   * Generate WWW-Authenticate header for 401 responses
   * Includes resource indicator hint
   */
  getWwwAuthenticateHeader(error?: string, errorDescription?: string): string {
    const parts = [
      'Bearer',
      `realm="${this.config.resourceIdentifier}"`,
      `resource="${this.config.resourceIdentifier}"`,
    ];

    if (error) {
      parts.push(`error="${error}"`);
    }

    if (errorDescription) {
      parts.push(`error_description="${errorDescription}"`);
    }

    return parts.join(', ');
  }

  /**
   * Create authorization URL with resource parameter
   */
  createAuthorizationUrl(
    authEndpoint: string,
    params: {
      clientId: string;
      redirectUri: string;
      scope: string;
      state?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
    }
  ): string {
    const url = new URL(authEndpoint);

    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('access_type', 'offline');

    // RFC 8707: Add resource indicator
    url.searchParams.set('resource', this.config.resourceIdentifier);

    if (params.state) {
      url.searchParams.set('state', params.state);
    }

    // PKCE parameters
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', params.codeChallengeMethod ?? 'S256');
    }

    return url.toString();
  }

  /**
   * Validate and log token usage for audit
   */
  async validateAndLog(
    token: string,
    operation: string,
    resourceId?: string
  ): Promise<TokenValidationResult> {
    // Try JWT validation first (faster, no network)
    let result = this.validateJwtToken(token);

    // If JWT validation fails or token appears opaque, try tokeninfo
    if (!result.valid && !token.includes('.')) {
      result = await this.validateOpaqueToken(token);
    }

    // Log for audit trail
    logger.info('Token validation', {
      category: 'audit',
      operation,
      resourceId,
      valid: result.valid,
      resourceMatch: result.resourceMatch,
      email: result.email,
      reason: result.reason,
    });

    return result;
  }

  /**
   * Validate token (alias for validateAndLog for backward compatibility)
   * Tries JWT validation first, falls back to opaque token validation
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    return this.validateAndLog(token, 'validate_token');
  }

  /**
   * Introspect token via Google's tokeninfo endpoint
   * Returns result with 'active' field for OAuth introspection compatibility
   */
  async introspectToken(token: string): Promise<{
    active: boolean;
    aud?: string;
    scope?: string;
    exp?: number;
    email?: string;
    error?: string;
  }> {
    const result = await this.validateOpaqueToken(token);

    return {
      active: result.valid,
      aud: typeof result.audience === 'string' ? result.audience : result.audience?.[0],
      scope: result.scopes?.join(' '),
      exp: result.expiresAt,
      email: result.email,
      error: result.valid ? undefined : result.reason,
    };
  }

  /**
   * Generate resource identifier from hostname and port
   * Static utility method for creating RFC 8707 resource identifiers
   */
  static generateResourceIdentifier(host: string, port: number = 443): string {
    // Standard HTTPS port - omit port number
    if (port === 443) {
      return `https://${host}`;
    }

    // Non-standard port - include port number
    return `https://${host}:${port}`;
  }
}

/**
 * Express middleware for resource indicator validation
 */
export function resourceIndicatorMiddleware(validator: ResourceIndicatorValidator): (
  req: { headers: { authorization?: string }; path?: string },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (name: string, value: string) => void;
  },
  next: () => void
) => Promise<void> {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.setHeader(
        'WWW-Authenticate',
        validator.getWwwAuthenticateHeader('invalid_request', 'Missing bearer token')
      );
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header',
        resource: validator.getResourceIdentifier(),
      });
      return;
    }

    const token = authHeader.slice(7);
    const result = await validator.validateAndLog(token, 'http_request', req.path);

    if (!result.valid) {
      res.setHeader(
        'WWW-Authenticate',
        validator.getWwwAuthenticateHeader('invalid_token', result.reason)
      );
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: result.reason,
        resource: validator.getResourceIdentifier(),
      });
      return;
    }

    next();
  };
}

/**
 * Optional resource indicator middleware - validates tokens if present,
 * allows through if no token (for mixed auth/anonymous access)
 */
export function optionalResourceIndicatorMiddleware(validator: ResourceIndicatorValidator): (
  req: { headers: { authorization?: string }; path?: string },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (name: string, value: string) => void;
  },
  next: () => void
) => Promise<void> {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    // No token = allow through (anonymous access)
    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }

    // Token present = validate it
    const token = authHeader.slice(7);
    const result = await validator.validateAndLog(token, 'http_request', req.path);

    if (!result.valid) {
      res.setHeader(
        'WWW-Authenticate',
        validator.getWwwAuthenticateHeader('invalid_token', result.reason)
      );
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: result.reason,
        resource: validator.getResourceIdentifier(),
      });
      return;
    }

    next();
  };
}

/**
 * Create a validator with default configuration
 */
export function createResourceIndicatorValidator(
  serverUrl: string,
  options?: Partial<ResourceIndicatorConfig>
): ResourceIndicatorValidator {
  return new ResourceIndicatorValidator({
    resourceIdentifier: serverUrl,
    allowMissingResource: process.env['NODE_ENV'] !== 'production', // Lenient in dev
    ...options,
  });
}
