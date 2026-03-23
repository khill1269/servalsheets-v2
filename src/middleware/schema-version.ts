/**
 * Schema Version Middleware
 *
 * Handles API schema versioning via content negotiation and headers.
 * Supports version extraction from Accept header, X-Schema-Version header, and query parameters.
 */

import type { Request, Response, NextFunction } from 'express';

// ─── Constants ──────────────────────────────────────────────────────────────

export const SUPPORTED_VERSIONS = ['v1', 'v2'] as const;
export const DEFAULT_VERSION = 'v1';

type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

// Versions with sunset dates (format: YYYY-MM-DD)
const DEPRECATED_VERSIONS = new Map<string, Date>([
  // Example: ['v1', new Date('2026-08-17')],
]);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VersionInfo {
  requested: string;
  resolved: string;
  negotiated: boolean;
  isDeprecated: boolean;
  sunsetDate?: Date;
}

export interface DeprecationInfo {
  deprecated: boolean;
  sunsetDate?: Date;
  migrationGuide?: string;
}

// Augment Express Request to include version info
declare global {
  namespace Express {
    interface Request {
      schemaVersion?: string;
      versionInfo?: VersionInfo;
    }
  }
}

// ─── Version Extraction ─────────────────────────────────────────────────────

/**
 * Extract schema version from request.
 * Priority: Accept header > X-Schema-Version header > query param > default
 *
 * @param req - Express request
 * @returns Resolved version (always supported version)
 */
export function extractVersion(req: Request): string {
  // 1. Try Accept header: application/vnd.servalsheets.v1+json
  const acceptHeader = req.get('Accept');
  if (acceptHeader) {
    const match = acceptHeader.match(/application\/vnd\.servalsheets\.(v\d+)\+json/);
    if (match && match[1]) {
      const version = match[1];
      if (isVersionSupported(version)) {
        return version;
      }
    }
  }

  // 2. Try X-Schema-Version header
  const versionHeader = req.get('X-Schema-Version');
  if (versionHeader && isVersionSupported(versionHeader)) {
    return versionHeader;
  }

  // 3. Try query parameter
  const queryVersion = req.query['schema_version'] as string | undefined;
  if (queryVersion && isVersionSupported(queryVersion)) {
    return queryVersion;
  }

  // 4. Fall back to default
  return DEFAULT_VERSION;
}

/**
 * Check if a version is supported.
 *
 * @param version - Version string (e.g., 'v1', 'v2')
 * @returns True if version is supported
 */
export function isVersionSupported(version: string): boolean {
  return SUPPORTED_VERSIONS.includes(version as SupportedVersion);
}

/**
 * Get detailed information about a version.
 *
 * @param version - Requested version
 * @returns Version metadata
 */
export function getVersionInfo(version: string): VersionInfo {
  const isSupported = isVersionSupported(version);
  const resolved = isSupported ? version : DEFAULT_VERSION;
  const negotiated = !isSupported;
  const sunsetDate = DEPRECATED_VERSIONS.get(resolved);

  return {
    requested: version,
    resolved,
    negotiated,
    isDeprecated: !!sunsetDate,
    sunsetDate,
  };
}

/**
 * Get deprecation information for a version.
 *
 * @param version - Version to check
 * @returns Deprecation info
 */
export function getDeprecationInfo(version: string): DeprecationInfo {
  const sunsetDate = DEPRECATED_VERSIONS.get(version);

  return {
    deprecated: !!sunsetDate,
    sunsetDate,
    migrationGuide: sunsetDate
      ? `https://servalsheets.dev/docs/migration/${version}-to-${getNextVersion(version)}`
      : undefined,
  };
}

/**
 * Get the next recommended version for migration.
 */
function getNextVersion(current: string): string {
  const match = current.match(/v(\d+)/);
  if (!match) return 'v2';
  const num = parseInt(match[1]!, 10);
  return `v${num + 1}`;
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Express middleware to handle schema versioning.
 * Attaches version information to request and sets response headers.
 */
export function schemaVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const version = extractVersion(req);
  const versionInfo = getVersionInfo(version);

  // Attach to request for handlers to use
  req.schemaVersion = version;
  req.versionInfo = versionInfo;

  // Set response headers
  res.setHeader('X-Schema-Version', version);
  res.setHeader('Content-Type', `application/vnd.servalsheets.${version}+json; charset=utf-8`);

  // Set deprecation headers if version is deprecated
  if (versionInfo.isDeprecated && versionInfo.sunsetDate) {
    const sunsetDateStr = versionInfo.sunsetDate.toISOString().split('T')[0]; // YYYY-MM-DD
    res.setHeader('Deprecation', `date="${sunsetDateStr}"`);
    res.setHeader('Sunset', versionInfo.sunsetDate.toUTCString());

    // Add Link header to migration guide
    const deprecationInfo = getDeprecationInfo(version);
    if (deprecationInfo.migrationGuide) {
      res.setHeader('Link', `<${deprecationInfo.migrationGuide}>; rel="deprecation"`);
    }
  }

  next();
}
