/**
 * ServalSheets - Cognito JWT Authentication Middleware (#9)
 *
 * Validates AWS Cognito JWT tokens for AgentCore deployment authentication.
 * Implements RS256 signature verification against Cognito's JWKS endpoint
 * with automatic key rotation and TTL-based caching.
 *
 * Cognito User Pool: us-east-1_d6Q1t6bUi
 * Client ID: 5ro2o67qejkbgd6857ee521r93
 * Domain: servalsheets.auth.us-east-1.amazoncognito.com
 *
 * Claims validated:
 * - iss: Must match Cognito user pool URL
 * - aud: Must match expected client ID (for id_token)
 * - client_id: Must match expected client ID (for access_token)
 * - token_use: Must be 'id' or 'access'
 * - exp: Must not be expired
 *
 * Configuration via environment variables:
 * - COGNITO_USER_POOL_ID: Cognito user pool ID (default: us-east-1_d6Q1t6bUi)
 * - COGNITO_CLIENT_ID: App client ID (default: 5ro2o67qejkbgd6857ee521r93)
 * - COGNITO_REGION: AWS region (default: us-east-1)
 * - COGNITO_JWKS_CACHE_TTL_MS: JWKS cache TTL in ms (default: 3600000 = 1 hour)
 * - COGNITO_CLOCK_TOLERANCE_S: Clock skew tolerance in seconds (default: 30)
 *
 * @module middleware/cognito-auth
 */

import { logger } from '../utils/logger.js';
import { AuthenticationError, ConfigError } from '../core/errors.js';

// ============================================================================
// Types
// ============================================================================

/** JSON Web Key from JWKS endpoint */
interface JWK {
  kty: string;
  kid: string;
  use: string;
  n: string;
  e: string;
  alg: string;
}

/** JWKS response from Cognito */
interface JWKSResponse {
  keys: JWK[];
}

/** Decoded JWT header */
interface JWTHeader {
  kid: string;
  alg: string;
  typ?: string;
}

/** Validated Cognito JWT claims */
export interface CognitoClaims {
  /** Subject — Cognito user UUID */
  sub: string;
  /** Issuer — Cognito user pool URL */
  iss: string;
  /** Token use — 'id' or 'access' */
  token_use: 'id' | 'access';
  /** Client ID (present in access tokens) */
  client_id?: string;
  /** Audience (present in id tokens) */
  aud?: string;
  /** Expiration (unix timestamp) */
  exp: number;
  /** Issued at (unix timestamp) */
  iat: number;
  /** Auth time (unix timestamp) */
  auth_time?: number;
  /** Email (from id token) */
  email?: string;
  /** Email verified flag */
  email_verified?: boolean;
  /** Cognito username */
  'cognito:username'?: string;
  /** Cognito groups */
  'cognito:groups'?: string[];
  /** Custom claims */
  [key: string]: unknown;
}

/** Authentication result passed to downstream handlers */
export interface AuthContext {
  /** Authenticated user ID (Cognito sub) */
  userId: string;
  /** User email if available */
  email?: string;
  /** Cognito username */
  username?: string;
  /** Cognito groups for RBAC */
  groups: string[];
  /** Token type used */
  tokenUse: 'id' | 'access';
  /** Full validated claims (for advanced use) */
  claims: CognitoClaims;
}

/** Cognito middleware configuration */
export interface CognitoAuthConfig {
  userPoolId: string;
  clientId: string;
  region: string;
  jwksCacheTtlMs: number;
  clockToleranceSeconds: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Load Cognito auth configuration from environment
 */
export function getCognitoConfig(): CognitoAuthConfig {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] || 'us-east-1_d6Q1t6bUi';
  const clientId = process.env['COGNITO_CLIENT_ID'] || '5ro2o67qejkbgd6857ee521r93';
  const region = process.env['COGNITO_REGION'] || 'us-east-1';
  const jwksCacheTtlMs = parseInt(process.env['COGNITO_JWKS_CACHE_TTL_MS'] || '3600000', 10);
  const clockToleranceSeconds = parseInt(process.env['COGNITO_CLOCK_TOLERANCE_S'] || '30', 10);

  // Validate pool ID format: <region>_<id>
  if (!/^[\w-]+_[\w]+$/.test(userPoolId)) {
    throw new ConfigError(
      `Invalid Cognito User Pool ID format: ${userPoolId}. Expected: <region>_<id>`,
      'COGNITO_USER_POOL_ID'
    );
  }

  return { userPoolId, clientId, region, jwksCacheTtlMs, clockToleranceSeconds };
}

/**
 * Get the issuer URL for a Cognito user pool
 */
function getIssuerUrl(region: string, userPoolId: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

/**
 * Get the JWKS URL for a Cognito user pool
 */
function getJwksUrl(region: string, userPoolId: string): string {
  return `${getIssuerUrl(region, userPoolId)}/.well-known/jwks.json`;
}

// ============================================================================
// JWKS Cache
// ============================================================================

/** Cached JWKS keys with TTL */
interface JWKSCache {
  keys: Map<string, JWK>;
  fetchedAt: number;
  ttlMs: number;
}

let jwksCache: JWKSCache | null = null;

/**
 * Fetch and cache JWKS keys from Cognito
 *
 * Implements TTL-based caching to avoid hitting the JWKS endpoint on every request.
 * Keys are indexed by kid for O(1) lookup during token verification.
 */
async function getJWKS(config: CognitoAuthConfig, forceRefresh = false): Promise<Map<string, JWK>> {
  const now = Date.now();

  // Return cached keys if still valid
  if (
    jwksCache &&
    !forceRefresh &&
    now - jwksCache.fetchedAt < jwksCache.ttlMs
  ) {
    return jwksCache.keys;
  }

  const jwksUrl = getJwksUrl(config.region, config.userPoolId);

  logger.debug('Fetching Cognito JWKS', {
    component: 'cognito-auth',
    url: jwksUrl,
    reason: forceRefresh ? 'force-refresh' : jwksCache ? 'cache-expired' : 'initial-fetch',
  });

  try {
    const response = await fetch(jwksUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`JWKS fetch failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as JWKSResponse;

    if (!data.keys || !Array.isArray(data.keys) || data.keys.length === 0) {
      throw new Error('JWKS response contains no keys');
    }

    // Index keys by kid for O(1) lookup
    const keyMap = new Map<string, JWK>();
    for (const key of data.keys) {
      if (key.kty === 'RSA' && key.use === 'sig') {
        keyMap.set(key.kid, key);
      }
    }

    if (keyMap.size === 0) {
      throw new Error('No RSA signing keys found in JWKS');
    }

    jwksCache = {
      keys: keyMap,
      fetchedAt: now,
      ttlMs: config.jwksCacheTtlMs,
    };

    logger.info('Cognito JWKS cached', {
      component: 'cognito-auth',
      keyCount: keyMap.size,
      kids: [...keyMap.keys()],
    });

    return keyMap;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // If we have stale cache, use it as fallback
    if (jwksCache) {
      logger.warn('JWKS fetch failed, using stale cache', {
        component: 'cognito-auth',
        error: errMsg,
        cacheAge: now - jwksCache.fetchedAt,
      });
      return jwksCache.keys;
    }

    throw new AuthenticationError(
      `Failed to fetch Cognito JWKS: ${errMsg}`,
      'AUTH_ERROR',
      true
    );
  }
}

/**
 * Clear the JWKS cache (for testing or forced rotation)
 */
export function clearJWKSCache(): void {
  jwksCache = null;
}

// ============================================================================
// JWT Verification (using jsonwebtoken)
// ============================================================================

/**
 * Decode a JWT header without verifying the signature.
 * Used to extract the kid for JWKS key lookup.
 */
function decodeJWTHeader(token: string): JWTHeader {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthenticationError('Malformed JWT: expected 3 parts', 'AUTH_ERROR', false);
  }

  try {
    const headerJson = Buffer.from(parts[0]!, 'base64url').toString('utf-8');
    return JSON.parse(headerJson) as JWTHeader;
  } catch {
    throw new AuthenticationError('Malformed JWT: invalid header encoding', 'AUTH_ERROR', false);
  }
}

/**
 * Convert a JWK RSA key to PEM format for jsonwebtoken verification.
 * Constructs the ASN.1 DER encoding of an RSA public key, then wraps in PEM.
 */
function jwkToPem(jwk: JWK): string {
  if (jwk.kty !== 'RSA') {
    throw new AuthenticationError(`Unsupported key type: ${jwk.kty}`, 'AUTH_ERROR', false);
  }

  const n = Buffer.from(jwk.n, 'base64url');
  const e = Buffer.from(jwk.e, 'base64url');

  // Encode as unsigned integer (prepend 0x00 if high bit set)
  const encodeUnsignedInt = (buf: Buffer): Buffer => {
    if (buf[0]! & 0x80) {
      return Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return buf;
  };

  const nEncoded = encodeUnsignedInt(n);
  const eEncoded = encodeUnsignedInt(e);

  // ASN.1 DER encoding helper
  const derLength = (length: number): Buffer => {
    if (length < 0x80) {
      return Buffer.from([length]);
    }
    if (length < 0x100) {
      return Buffer.from([0x81, length]);
    }
    return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
  };

  const derInteger = (buf: Buffer): Buffer => {
    const lenBytes = derLength(buf.length);
    return Buffer.concat([Buffer.from([0x02]), lenBytes, buf]);
  };

  const derSequence = (contents: Buffer): Buffer => {
    const lenBytes = derLength(contents.length);
    return Buffer.concat([Buffer.from([0x30]), lenBytes, contents]);
  };

  // RSA public key: SEQUENCE { n INTEGER, e INTEGER }
  const rsaKey = derSequence(Buffer.concat([derInteger(nEncoded), derInteger(eEncoded)]));

  // BitString wrapping
  const bitString = Buffer.concat([
    Buffer.from([0x03]),
    derLength(rsaKey.length + 1),
    Buffer.from([0x00]), // unused bits = 0
    rsaKey,
  ]);

  // RSA OID: 1.2.840.113549.1.1.1
  const rsaOid = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);

  // SubjectPublicKeyInfo: SEQUENCE { algorithm, bitstring }
  const spki = derSequence(Buffer.concat([rsaOid, bitString]));

  // Wrap in PEM
  const b64 = spki.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Verify and decode a Cognito JWT token.
 *
 * Uses jsonwebtoken (already a project dependency) for RS256 signature verification.
 * Performs Cognito-specific claim validation:
 * - iss must match user pool URL
 * - token_use must be 'id' or 'access'
 * - aud/client_id must match configured client
 * - exp must not be expired (with clock tolerance)
 */
export async function verifyCognitoToken(
  token: string,
  config?: CognitoAuthConfig
): Promise<CognitoClaims> {
  const cfg = config || getCognitoConfig();

  // 1. Decode header to get kid
  const header = decodeJWTHeader(token);

  if (header.alg !== 'RS256') {
    throw new AuthenticationError(
      `Unsupported JWT algorithm: ${header.alg}. Expected RS256.`,
      'AUTH_ERROR',
      false
    );
  }

  // 2. Look up signing key from JWKS cache
  let keys = await getJWKS(cfg);
  let jwk = keys.get(header.kid);

  // If kid not found, force refresh (key rotation may have occurred)
  if (!jwk) {
    logger.info('JWT kid not in JWKS cache, forcing refresh', {
      component: 'cognito-auth',
      kid: header.kid,
    });
    keys = await getJWKS(cfg, true);
    jwk = keys.get(header.kid);
  }

  if (!jwk) {
    throw new AuthenticationError(
      `No matching signing key found for kid: ${header.kid}`,
      'AUTH_ERROR',
      true // Retryable — might be a transient JWKS issue
    );
  }

  // 3. Convert JWK to PEM and verify with jsonwebtoken
  const pem = jwkToPem(jwk);
  const expectedIssuer = getIssuerUrl(cfg.region, cfg.userPoolId);

  // Dynamic import — jsonwebtoken is already a project dependency
  let jwt: typeof import('jsonwebtoken');
  try {
    jwt = await import('jsonwebtoken');
  } catch {
    throw new ConfigError(
      'jsonwebtoken package not available. It should be a project dependency.',
      'JWT_LIBRARY'
    );
  }

  try {
    const decoded = jwt.verify(token, pem, {
      algorithms: ['RS256'],
      issuer: expectedIssuer,
      clockTolerance: cfg.clockToleranceSeconds,
    }) as CognitoClaims;

    // 4. Validate token_use claim
    if (decoded.token_use !== 'id' && decoded.token_use !== 'access') {
      throw new AuthenticationError(
        `Invalid token_use claim: ${decoded.token_use}. Expected 'id' or 'access'.`,
        'AUTH_ERROR',
        false
      );
    }

    // 5. Validate audience/client_id based on token type
    if (decoded.token_use === 'id') {
      if (decoded.aud !== cfg.clientId) {
        throw new AuthenticationError(
          `Token audience mismatch. Expected: ${cfg.clientId}, got: ${decoded.aud}`,
          'AUTH_ERROR',
          false
        );
      }
    } else if (decoded.token_use === 'access') {
      if (decoded.client_id !== cfg.clientId) {
        throw new AuthenticationError(
          `Token client_id mismatch. Expected: ${cfg.clientId}, got: ${decoded.client_id}`,
          'AUTH_ERROR',
          false
        );
      }
    }

    return decoded;
  } catch (error) {
    // Re-throw our own errors
    if (error instanceof AuthenticationError) {
      throw error;
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.name : 'UnknownError';

    // Map jsonwebtoken errors
    if (errName === 'TokenExpiredError') {
      throw new AuthenticationError(
        'Cognito token has expired. Please re-authenticate.',
        'TOKEN_EXPIRED',
        false
      );
    }

    if (errName === 'JsonWebTokenError') {
      throw new AuthenticationError(
        `Invalid JWT: ${errMsg}`,
        'AUTH_ERROR',
        false
      );
    }

    if (errName === 'NotBeforeError') {
      throw new AuthenticationError(
        'Token is not yet valid (nbf claim).',
        'AUTH_ERROR',
        true
      );
    }

    throw new AuthenticationError(
      `Token verification failed: ${errMsg}`,
      'AUTH_ERROR',
      false
    );
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

/**
 * Cognito JWT authentication middleware for Express-style handlers.
 *
 * Validates the Authorization: Bearer <token> header against the configured
 * Cognito User Pool. On success, attaches an AuthContext to the request.
 *
 * @example
 * // Express usage
 * app.use(cognitoAuthMiddleware());
 *
 * // Access auth context in handler
 * app.get('/api/data', (req, res) => {
 *   const auth = (req as any).auth as AuthContext;
 *   console.log('User:', auth.userId, 'Groups:', auth.groups);
 * });
 */
export function cognitoAuthMiddleware(config?: CognitoAuthConfig) {
  const cfg = config || getCognitoConfig();

  return async (
    req: { headers: Record<string, string | undefined>; auth?: AuthContext },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: (error?: unknown) => void
  ): Promise<void> => {
    const token = extractBearerToken(req.headers['authorization']);

    if (!token) {
      logger.debug('No Bearer token in request', { component: 'cognito-auth' });
      res.status(401).json({
        error: 'Authentication required',
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      });
      return;
    }

    try {
      const claims = await verifyCognitoToken(token, cfg);

      // Build auth context for downstream handlers
      const authContext: AuthContext = {
        userId: claims.sub,
        email: claims.email,
        username: claims['cognito:username'],
        groups: claims['cognito:groups'] || [],
        tokenUse: claims.token_use,
        claims,
      };

      req.auth = authContext;

      logger.debug('Cognito auth successful', {
        component: 'cognito-auth',
        userId: authContext.userId,
        username: authContext.username,
        groups: authContext.groups,
        tokenUse: authContext.tokenUse,
      });

      next();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      logger.warn('Cognito auth failed', {
        component: 'cognito-auth',
        error: errMsg,
      });

      if (error instanceof AuthenticationError && error.code === 'TOKEN_EXPIRED') {
        res.status(401).json({
          error: 'Token expired',
          message: 'Your session has expired. Please re-authenticate.',
        });
        return;
      }

      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired token.',
      });
    }
  };
}

/**
 * Lightweight token validation for MCP tool handlers.
 *
 * Unlike the Express middleware, this is a direct function call that returns
 * the AuthContext or throws. Designed for use within MCP tool implementations
 * where Express middleware isn't in the chain.
 *
 * @example
 * // In an MCP tool handler
 * const auth = await validateMCPAuth(request.params?.authToken);
 * if (auth.groups.includes('admin')) { ... }
 */
export async function validateMCPAuth(
  token: string | undefined,
  config?: CognitoAuthConfig
): Promise<AuthContext> {
  if (!token) {
    throw new AuthenticationError(
      'Authentication token required for this operation.',
      'AUTH_ERROR',
      false
    );
  }

  const claims = await verifyCognitoToken(token, config);

  return {
    userId: claims.sub,
    email: claims.email,
    username: claims['cognito:username'],
    groups: claims['cognito:groups'] || [],
    tokenUse: claims.token_use,
    claims,
  };
}

/**
 * Check if an AuthContext has a required group membership.
 * Useful for group-based RBAC checks after authentication.
 */
export function requireGroup(auth: AuthContext, group: string): void {
  if (!auth.groups.includes(group)) {
    throw new AuthenticationError(
      `Access denied. Required group: ${group}`,
      'AUTH_ERROR',
      false,
      { userId: auth.userId, requiredGroup: group, userGroups: auth.groups }
    );
  }
}
