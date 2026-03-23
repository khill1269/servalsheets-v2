/**
 * HTTP/2 Detection Utility
 *
 * Detects and logs HTTP/2 protocol usage for Google API requests.
 * The googleapis library (gaxios) automatically negotiates HTTP/2 via ALPN
 * (Application-Layer Protocol Negotiation) when enabled.
 *
 * Benefits of HTTP/2:
 * - 5-15% latency reduction for API calls
 * - Multiplexing: Multiple requests over single connection
 * - Header compression: Reduced overhead
 * - Server push capability
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from './logger.js';

/**
 * Check if HTTP/2 is supported by the current Node.js runtime
 * HTTP/2 support was added in Node.js 8.4.0 and stabilized in 14.x
 *
 * @returns true if Node.js version supports HTTP/2
 */
export function isHTTP2Supported(): boolean {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0] ?? '0');

  // Node.js 14+ has stable HTTP/2 support
  return majorVersion >= 14;
}

/**
 * Get Node.js version information for HTTP/2 diagnostics
 *
 * @returns Object with version details and HTTP/2 support status
 */
export function getNodeVersionInfo(): {
  version: string;
  major: number;
  minor: number;
  patch: number;
  http2Supported: boolean;
} {
  const nodeVersion = process.version;
  const parts = nodeVersion.slice(1).split('.');
  const major = parseInt(parts[0] ?? '0');
  const minor = parseInt(parts[1] ?? '0');
  const patch = parseInt(parts[2] ?? '0');

  return {
    version: nodeVersion,
    major,
    minor,
    patch,
    http2Supported: major >= 14,
  };
}

/**
 * Log HTTP/2 support status at startup
 * Should be called during service initialization
 */
export function logHTTP2Capabilities(): void {
  const versionInfo = getNodeVersionInfo();

  if (versionInfo.http2Supported) {
    logger.info('HTTP/2 support: ENABLED', {
      nodeVersion: versionInfo.version,
      protocol: 'HTTP/2 via ALPN negotiation',
      capability: 'google-api-http2',
    });
  } else {
    logger.warn('HTTP/2 support: LIMITED', {
      nodeVersion: versionInfo.version,
      reason: `Node.js ${versionInfo.version} < 14.0.0`,
      recommendation: 'Upgrade to Node.js 14+ for HTTP/2 support',
      capability: 'google-api-http2',
    });
  }
}

/**
 * Detect HTTP version from response metadata
 * Note: gaxios may not always expose the HTTP version in response metadata
 *
 * @param response - API response object (may contain protocol info)
 * @returns Detected HTTP version string
 */
export function detectHTTPVersion(response: unknown): string {
  // Try to extract HTTP version from various possible locations
  if (response && typeof response === 'object') {
    const resp = response as Record<string, unknown>;

    // Check response.config.httpVersion (gaxios)
    if (
      resp['config'] &&
      typeof resp['config'] === 'object' &&
      (resp['config'] as Record<string, unknown>)['httpVersion']
    ) {
      return String((resp['config'] as Record<string, unknown>)['httpVersion']);
    }

    // Check response.request.protocol (Node.js http/https)
    if (
      resp['request'] &&
      typeof resp['request'] === 'object' &&
      (resp['request'] as Record<string, unknown>)['protocol']
    ) {
      return String((resp['request'] as Record<string, unknown>)['protocol']);
    }

    // Check response.httpVersion (direct property)
    if (resp['httpVersion']) {
      return String(resp['httpVersion']);
    }

    // Check response headers for HTTP/2 indicators
    if (resp['headers'] && typeof resp['headers'] === 'object') {
      const headers = resp['headers'] as Record<string, unknown>;
      // HTTP/2 uses lowercase header names
      if (headers[':status']) {
        return 'HTTP/2';
      }
    }
  }

  // Default assumption: HTTP/1.1 (cannot definitively determine)
  return 'HTTP/1.1 (assumed)';
}

/**
 * Log HTTP version for a request/response (development/debugging)
 * Only logs in development or when explicitly enabled
 *
 * @param response - API response object
 * @param operation - Operation name for logging context
 */
export function logHTTPVersion(response: unknown, operation?: string): void {
  // Only log in development or when HTTP_DEBUG is enabled
  const shouldLog =
    process.env['NODE_ENV'] === 'development' || process.env['HTTP_DEBUG'] === 'true';

  if (!shouldLog) {
    return;
  }

  const httpVersion = detectHTTPVersion(response);
  logger.debug('API request completed', {
    operation,
    httpVersion,
    capability: 'google-api-http2',
  });
}

/**
 * Get HTTP/2 performance statistics
 * Returns expected performance improvements when HTTP/2 is enabled
 *
 * @returns Object with performance metrics
 */
export function getHTTP2PerformanceMetrics(): {
  enabled: boolean;
  expectedLatencyReduction: string;
  features: string[];
  nodeVersion: string;
} {
  const versionInfo = getNodeVersionInfo();

  return {
    enabled: versionInfo.http2Supported,
    expectedLatencyReduction: versionInfo.http2Supported ? '5-15% average' : 'N/A',
    features: versionInfo.http2Supported
      ? [
          'Request multiplexing',
          'Header compression (HPACK)',
          'Server push capability',
          'Binary protocol',
          'Stream prioritization',
        ]
      : ['HTTP/1.1 fallback'],
    nodeVersion: versionInfo.version,
  };
}

/**
 * Validate HTTP/2 configuration
 * Checks if HTTP/2 is properly enabled for googleapis
 *
 * @param http2Enabled - Whether HTTP/2 is enabled in config
 * @returns Validation result with warnings if any
 */
export function validateHTTP2Config(http2Enabled: boolean): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const versionInfo = getNodeVersionInfo();

  // Check if HTTP/2 is enabled but Node.js doesn't support it
  if (http2Enabled && !versionInfo.http2Supported) {
    warnings.push(`HTTP/2 enabled but Node.js ${versionInfo.version} < 14.0.0`);
    warnings.push('Upgrade to Node.js 14+ for HTTP/2 support');
  }

  // Check if HTTP/2 is disabled despite Node.js support
  if (!http2Enabled && versionInfo.http2Supported) {
    warnings.push(`HTTP/2 disabled despite Node.js ${versionInfo.version} >= 14.0.0`);
    warnings.push('Enable HTTP/2 for 5-15% latency reduction');
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
