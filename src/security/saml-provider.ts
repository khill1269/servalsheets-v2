/**
 * SAML 2.0 Service Provider (SP) implementation (ISSUE-173)
 *
 * Enables enterprise SSO via Okta, Azure AD, Google Workspace SAML, ADFS.
 *
 * Flow:
 *   1. GET /sso/login?RelayState=<redirect_uri>
 *      → SP generates AuthnRequest → redirect to IdP SSO endpoint
 *   2. IdP authenticates user → POST /sso/callback
 *      → SP validates assertion → extract NameID + attributes
 *      → issue signed JWT (same format as OAuth tokens) → redirect to client
 *
 * The issued JWT is compatible with existing Bearer-token auth middleware —
 * no changes needed in RBAC or tenant isolation middleware.
 *
 * Configuration:
 *   ENABLE_SSO=true
 *   SAML_ENTRY_POINT=https://company.okta.com/app/servalsheets/sso/saml
 *   SAML_ISSUER=https://servalsheets.company.com        (SP Entity ID)
 *   SAML_CERT=<IdP x509 cert, base64 PEM without headers>
 *   SAML_CALLBACK_URL=https://servalsheets.company.com/sso/callback
 *   SAML_PRIVATE_KEY=<SP private key PEM>               (optional, for signed requests)
 *   SAML_WANT_ASSERTIONS_SIGNED=true                    (default: true)
 *   SAML_SIGNATURE_ALGORITHM=sha256                     (default: sha256)
 *   JWT_SECRET=<same secret used by OAuth provider>
 *   SSO_JWT_TTL=3600                                    (seconds, default: 3600)
 *   SSO_ALLOWED_CLOCK_SKEW=300                          (seconds, default: 300)
 */

import { Router, Request, Response } from 'express';
import { SAML, type SamlConfig } from 'node-saml';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

// ============================================================================
// Security: allowed redirect origins for RelayState validation
// ============================================================================

/**
 * Validate that a RelayState URL is safe to redirect to.
 * Blocks open redirect attacks by checking against an allowlist of origins.
 * Relative paths (starting with /) are always allowed.
 */
function isAllowedRedirect(url: string, allowedOrigins: string[]): boolean {
  // Relative paths are always safe
  if (url.startsWith('/') && !url.startsWith('//')) return true;

  try {
    const parsed = new URL(url);
    // Only allow http/https schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // Check origin against allowlist
    return allowedOrigins.some(
      (origin) => parsed.origin === origin || parsed.origin === new URL(origin).origin
    );
  } catch {
    // Malformed URL — reject
    return false;
  }
}

// ============================================================================
// Configuration
// ============================================================================

export interface SamlProviderConfig {
  /** IdP SSO endpoint URL (from IdP metadata) */
  entryPoint: string;
  /** SP Entity ID — typically your server's base URL */
  issuer: string;
  /** IdP x509 signing certificate (PEM body, without -----BEGIN/END CERTIFICATE----- headers) */
  cert: string;
  /** ACS (Assertion Consumer Service) URL — must match what's registered in the IdP */
  callbackUrl: string;
  /** JWT secret (shared with OAuth provider for token compatibility) */
  jwtSecret: string;
  /** SP private key PEM for signed AuthnRequests (optional) */
  privateKey?: string;
  /** Require signed assertions (default: true) */
  wantAssertionsSigned?: boolean;
  /** Signature algorithm (default: sha256) */
  signatureAlgorithm?: 'sha1' | 'sha256' | 'sha512';
  /** JWT TTL in seconds (default: 3600) */
  jwtTtl?: number;
  /** Allowed clock skew in seconds for assertion NotBefore/NotOnOrAfter (default: 300) */
  clockSkew?: number;
  /** Default redirect after SSO (fallback when RelayState is absent) */
  defaultRedirectUrl?: string;
  /** Allowed origins for RelayState redirects (e.g. ['https://app.company.com']). Required for redirect-based token delivery. */
  allowedRedirectOrigins?: string[];
}

// ============================================================================
// SAML token payload — compatible with OAuth provider JWT format
// ============================================================================

interface SsoTokenPayload {
  sub: string; // NameID from SAML assertion
  aud: string; // issuer
  iss: string; // issuer
  exp: number;
  iat: number;
  scope: string; // 'sso' scope
  saml?: {
    nameIdFormat?: string;
    sessionIndex?: string;
    attributes?: Record<string, string | string[]>;
  };
}

// ============================================================================
// Attribute helpers
// ============================================================================

/**
 * Extract a flat string value from SAML profile attributes.
 * SAML attributes may be arrays (multi-valued); we take the first value.
 */
function extractAttr(profile: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = profile[key];
    if (typeof val === 'string' && val) return val;
    if (Array.isArray(val) && typeof val[0] === 'string' && val[0]) return val[0];
  }
  return undefined;
}

/**
 * Build a flat attributes map from a SAML profile for embedding in the JWT.
 * Includes common IdP attribute names (Okta, Azure AD, Google Workspace).
 */
function buildAttributeMap(profile: Record<string, unknown>): Record<string, string | string[]> {
  const map: Record<string, string | string[]> = {};
  const interesting = [
    'email',
    'mail',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'displayname',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    'firstname',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    'lastname',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    'groups',
    'memberof',
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
    'role',
    'roles',
  ];
  for (const key of interesting) {
    const val = profile[key];
    if (val === undefined || val === null) continue;
    const shortKey = key.includes('/') ? key.split('/').pop()! : key;
    if (typeof val === 'string') map[shortKey] = val;
    else if (Array.isArray(val))
      map[shortKey] = val.filter((v): v is string => typeof v === 'string');
  }
  return map;
}

// ============================================================================
// SamlProvider class
// ============================================================================

export class SamlProvider {
  private readonly saml: SAML;
  private readonly config: Required<
    Pick<SamlProviderConfig, 'issuer' | 'jwtSecret' | 'jwtTtl' | 'defaultRedirectUrl'>
  > &
    SamlProviderConfig;

  /**
   * @param config - SAML SP configuration
   * @param samlInstance - Optional pre-built SAML instance (for testing / DI)
   */
  constructor(config: SamlProviderConfig, samlInstance?: SAML) {
    this.config = {
      wantAssertionsSigned: true,
      signatureAlgorithm: 'sha256',
      jwtTtl: 3600,
      clockSkew: 300,
      defaultRedirectUrl: '/',
      ...config,
    };

    if (samlInstance) {
      this.saml = samlInstance;
    } else {
      const samlOptions: SamlConfig = {
        entryPoint: config.entryPoint,
        issuer: config.issuer,
        cert: config.cert,
        callbackUrl: config.callbackUrl,
        signatureAlgorithm: this.config.signatureAlgorithm,
        wantAssertionsSigned: this.config.wantAssertionsSigned,
        acceptedClockSkewMs: (this.config.clockSkew ?? 300) * 1000,
        // SP private key — only set if provided (signed AuthnRequests)
        ...(config.privateKey
          ? { privateKey: config.privateKey, decryptionPvk: config.privateKey }
          : {}),
      };
      this.saml = new SAML(samlOptions);
    }

    // Security warning: wantAssertionsSigned=false is dangerous in production
    if (this.config.wantAssertionsSigned === false) {
      logger.warn(
        'SECURITY WARNING: wantAssertionsSigned is set to false. ' +
          'SAML assertions will NOT be validated for signature. ' +
          'This is only acceptable for development/testing environments.'
      );
    }

    logger.info('SAML provider initialized', {
      issuer: config.issuer,
      entryPoint: config.entryPoint,
      callbackUrl: config.callbackUrl,
      wantAssertionsSigned: this.config.wantAssertionsSigned,
    });
  }

  /**
   * Generate SP metadata XML (expose at GET /sso/metadata).
   * Upload this to your IdP when registering the SP.
   */
  async generateMetadata(): Promise<string> {
    return this.saml.generateServiceProviderMetadata(
      this.config.privateKey ?? null,
      this.config.privateKey ?? null
    );
  }

  /**
   * Issue a signed JWT for an authenticated SSO user.
   */
  issueToken(nameId: string, profile: Record<string, unknown>, sessionIndex?: string): string {
    const attrs = buildAttributeMap(profile);
    const now = Math.floor(Date.now() / 1000);

    const payload: SsoTokenPayload = {
      sub: nameId,
      aud: this.config.issuer,
      iss: this.config.issuer,
      iat: now,
      exp: now + this.config.jwtTtl,
      scope: 'sso',
      saml: {
        nameIdFormat:
          typeof profile['nameIDFormat'] === 'string' ? profile['nameIDFormat'] : undefined,
        sessionIndex,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      },
    };

    return jwt.sign(payload, this.config.jwtSecret, { algorithm: 'HS256' });
  }

  /**
   * Create the Express router for SSO routes.
   *
   * Routes:
   *   GET  /sso/login      — initiate SSO (redirect to IdP)
   *   POST /sso/callback   — ACS endpoint (receive assertion from IdP)
   *   GET  /sso/metadata   — SP metadata XML for IdP registration
   *   GET  /sso/logout     — initiate SLO (Single Logout) — initiates redirect to IdP
   */
  createRouter(): Router {
    const router = Router();

    // ------------------------------------------------------------------
    // GET /sso/metadata — Service Provider metadata for IdP registration
    // ------------------------------------------------------------------
    router.get('/sso/metadata', async (_req, res: Response) => {
      try {
        const metadata = await this.generateMetadata();
        res.type('application/xml').send(metadata);
      } catch (error) {
        logger.error('Failed to generate SP metadata', { error });
        res.status(500).json({ error: 'Failed to generate metadata' });
      }
    });

    // ------------------------------------------------------------------
    // GET /sso/login — initiate SAML AuthnRequest
    // ------------------------------------------------------------------
    router.get('/sso/login', async (req: Request, res: Response) => {
      try {
        const relayStateParam = req.query['RelayState'] as string | undefined;

        // Validate RelayState against origin allowlist before passing to IdP
        const allowedOrigins = this.config.allowedRedirectOrigins ?? [];
        if (relayStateParam && !isAllowedRedirect(relayStateParam, allowedOrigins)) {
          logger.warn('SSO login: RelayState rejected by origin allowlist', {
            relayState: relayStateParam.slice(0, 100),
          });
          res.status(400).json({
            error: 'SSO_INVALID_RELAY_STATE',
            message: 'RelayState URL is not in the allowed redirect origins list',
          });
          return;
        }

        const relayState = relayStateParam ?? this.config.defaultRedirectUrl;
        const requestId = `_${randomUUID().replace(/-/g, '')}`;

        const url = await this.saml.getAuthorizeUrlAsync(relayState, req.headers.host, {
          additionalParams: {},
          id: requestId,
        });

        logger.info('SSO login initiated', { requestId, relayState });
        res.redirect(url);
      } catch (error) {
        logger.error('Failed to initiate SSO login', { error });
        res.status(500).json({
          error: 'SSO_INIT_FAILED',
          message: 'Failed to initiate SSO login. Check SAML configuration.',
        });
      }
    });

    // ------------------------------------------------------------------
    // POST /sso/callback — ACS endpoint (IdP posts assertion here)
    // ------------------------------------------------------------------
    router.post('/sso/callback', async (req: Request, res: Response) => {
      try {
        const { profile, loggedOut } = await this.saml.validatePostResponseAsync(
          req.body as Record<string, string>
        );

        if (loggedOut) {
          logger.info('SSO logout callback received');
          res.json({ message: 'Logged out successfully' });
          return;
        }

        if (!profile) {
          logger.warn('SSO callback: no profile in assertion');
          res
            .status(400)
            .json({ error: 'SSO_NO_PROFILE', message: 'No profile in SAML assertion' });
          return;
        }

        const nameId = profile.nameID;
        if (!nameId) {
          logger.warn('SSO callback: missing NameID in assertion');
          res
            .status(400)
            .json({ error: 'SSO_NO_NAMEID', message: 'Missing NameID in SAML assertion' });
          return;
        }

        const sessionIndex =
          typeof profile['sessionIndex'] === 'string' ? profile['sessionIndex'] : undefined;
        const email = extractAttr(
          profile as Record<string, unknown>,
          'email',
          'mail',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
        );

        logger.info('SSO assertion validated', {
          nameId: nameId.slice(0, 20) + '...',
          email: email ? email.replace(/(.{2}).*@/, '$1***@') : undefined,
          hasSessionIndex: !!sessionIndex,
        });

        // Issue JWT
        const token = this.issueToken(nameId, profile as Record<string, unknown>, sessionIndex);

        // Issue JWT
        // Token delivery: httpOnly cookie for browser redirects, JSON body for API clients.
        // SECURITY: Never put tokens in query parameters (visible in logs, referrer headers, browser history).
        const relayState =
          typeof req.body['RelayState'] === 'string' ? req.body['RelayState'] : undefined;
        const redirectBase = relayState ?? this.config.defaultRedirectUrl;

        // Validate RelayState against allowed origins (blocks open redirect attacks)
        const allowedOrigins = this.config.allowedRedirectOrigins ?? [];
        if (relayState && !isAllowedRedirect(relayState, allowedOrigins)) {
          logger.warn('SSO callback: RelayState rejected by origin allowlist', {
            relayState: relayState.slice(0, 100),
          });
          res.status(400).json({
            error: 'SSO_INVALID_RELAY_STATE',
            message: 'RelayState URL is not in the allowed redirect origins list',
          });
          return;
        }

        const isAppRedirect =
          redirectBase.startsWith('/') || redirectBase.startsWith('http');
        if (isAppRedirect && redirectBase !== '/') {
          // Set token as httpOnly cookie (secure, SameSite=Lax)
          res.cookie('sso_token', token, {
            httpOnly: true,
            secure: !redirectBase.startsWith('http://localhost'),
            sameSite: 'lax',
            maxAge: this.config.jwtTtl * 1000,
            path: '/',
          });
          res.redirect(redirectBase);
        } else {
          // API / CLI clients — return token directly in response body
          res.json({
            token,
            tokenType: 'Bearer',
            expiresIn: this.config.jwtTtl,
            nameId,
            ...(email ? { email } : {}),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('SSO callback validation failed', { error: message });
        res.status(401).json({
          error: 'SSO_ASSERTION_INVALID',
          message: `SAML assertion validation failed: ${message}`,
        });
      }
    });

    // ------------------------------------------------------------------
    // GET /sso/logout — initiate Single Logout (SLO)
    // ------------------------------------------------------------------
    router.get('/sso/logout', async (req: Request, res: Response) => {
      try {
        const nameId = req.query['nameId'] as string | undefined;
        const sessionIndex = req.query['sessionIndex'] as string | undefined;

        if (!nameId) {
          res.status(400).json({ error: 'nameId query param required for SLO' });
          return;
        }

        const logoutUrl = await this.saml.getLogoutUrlAsync(
          { nameID: nameId, sessionIndex },
          undefined,
          {}
        );

        logger.info('SSO logout initiated', { nameId: nameId.slice(0, 20) + '...' });
        res.redirect(logoutUrl);
      } catch (error) {
        logger.error('Failed to initiate SSO logout', { error });
        res.status(500).json({ error: 'SSO_LOGOUT_FAILED', message: 'Failed to initiate logout' });
      }
    });

    return router;
  }

  /**
   * Validate a JWT issued by this provider (for middleware use).
   * Returns the decoded payload or null if invalid.
   */
  verifyToken(token: string): SsoTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        audience: this.config.issuer,
        issuer: this.config.issuer,
      }) as SsoTokenPayload;
      // Only accept SSO-scoped tokens (not OAuth tokens from the OAuth provider)
      if (decoded.scope !== 'sso') return null;
      return decoded;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Factory: build SamlProvider from environment variables
// ============================================================================

export interface SamlEnvConfig {
  SAML_ENTRY_POINT?: string;
  SAML_ISSUER?: string;
  SAML_CERT?: string;
  SAML_CALLBACK_URL?: string;
  SAML_PRIVATE_KEY?: string;
  SAML_WANT_ASSERTIONS_SIGNED?: string;
  SAML_SIGNATURE_ALGORITHM?: string;
  SAML_ALLOWED_REDIRECT_ORIGINS?: string;
  JWT_SECRET?: string;
  SSO_JWT_TTL?: string;
  SSO_ALLOWED_CLOCK_SKEW?: string;
}

/**
 * Create a SamlProvider from environment variables.
 * Returns null if SAML is not configured (missing required vars).
 */
export function createSamlProviderFromEnv(
  env: SamlEnvConfig = process.env as SamlEnvConfig
): SamlProvider | null {
  const { SAML_ENTRY_POINT, SAML_ISSUER, SAML_CERT, SAML_CALLBACK_URL, JWT_SECRET } = env;

  if (!SAML_ENTRY_POINT || !SAML_ISSUER || !SAML_CERT || !SAML_CALLBACK_URL || !JWT_SECRET) {
    return null; // Not configured
  }

  return new SamlProvider({
    entryPoint: SAML_ENTRY_POINT,
    issuer: SAML_ISSUER,
    cert: SAML_CERT,
    callbackUrl: SAML_CALLBACK_URL,
    jwtSecret: JWT_SECRET,
    privateKey: env.SAML_PRIVATE_KEY,
    wantAssertionsSigned: env.SAML_WANT_ASSERTIONS_SIGNED !== 'false',
    signatureAlgorithm:
      (env.SAML_SIGNATURE_ALGORITHM as 'sha1' | 'sha256' | 'sha512' | undefined) ?? 'sha256',
    jwtTtl: env.SSO_JWT_TTL ? parseInt(env.SSO_JWT_TTL, 10) : 3600,
    clockSkew: env.SSO_ALLOWED_CLOCK_SKEW ? parseInt(env.SSO_ALLOWED_CLOCK_SKEW, 10) : 300,
    allowedRedirectOrigins: env.SAML_ALLOWED_REDIRECT_ORIGINS
      ? env.SAML_ALLOWED_REDIRECT_ORIGINS.split(',').map((s) => s.trim())
      : [],
  });
}
