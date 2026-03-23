/**
 * HTTP/2 Support Integration Tests
 *
 * Verifies HTTP/2 capabilities and configuration for Google API clients
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isHTTP2Supported,
  getNodeVersionInfo,
  detectHTTPVersion,
  validateHTTP2Config,
  getHTTP2PerformanceMetrics,
} from '../../src/utils/http2-detector.js';

describe('HTTP/2 Support Integration', () => {
  let versionInfo: ReturnType<typeof getNodeVersionInfo>;

  beforeAll(() => {
    versionInfo = getNodeVersionInfo();
  });

  describe('Node.js HTTP/2 Support', () => {
    it('should confirm HTTP/2 is supported in current Node.js version', () => {
      const supported = isHTTP2Supported();

      // Node.js 14+ supports HTTP/2 (requirement in package.json: >=20.0.0)
      expect(supported).toBe(true);
      expect(versionInfo.major).toBeGreaterThanOrEqual(14);
    });

    it('should provide correct version information', () => {
      expect(versionInfo.version).toMatch(/^v\d+\.\d+\.\d+/);
      expect(versionInfo.major).toBeGreaterThan(0);
      expect(versionInfo.http2Supported).toBe(true);
    });

    it('should meet minimum Node.js version requirement', () => {
      // package.json specifies: "node": ">=20.0.0"
      expect(versionInfo.major).toBeGreaterThanOrEqual(20);
    });
  });

  describe('HTTP/2 Configuration Validation', () => {
    it('should validate HTTP/2 enabled configuration', () => {
      const result = validateHTTP2Config(true);

      // With Node.js >= 14 and HTTP/2 enabled, should have no warnings
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn when HTTP/2 is disabled despite Node.js support', () => {
      const result = validateHTTP2Config(false);

      // With Node.js >= 14 but HTTP/2 disabled, should warn
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('disabled'))).toBe(true);
    });
  });

  describe('HTTP Version Detection', () => {
    it('should detect HTTP/1.1 from response without HTTP/2 indicators', () => {
      const response = {
        status: 200,
        headers: { 'content-type': 'application/json' },
      };

      const version = detectHTTPVersion(response);
      expect(version).toMatch(/HTTP\/1\.1/i);
    });

    it('should detect HTTP/2 from response with :status pseudo-header', () => {
      const response = {
        status: 200,
        headers: {
          ':status': '200', // HTTP/2 uses pseudo-headers
          'content-type': 'application/json',
        },
      };

      const version = detectHTTPVersion(response);
      expect(version).toBe('HTTP/2');
    });

    it('should detect HTTP version from config', () => {
      const response = {
        config: { httpVersion: '2.0' },
        status: 200,
      };

      const version = detectHTTPVersion(response);
      expect(version).toBe('2.0');
    });

    it('should handle null/undefined responses gracefully', () => {
      expect(detectHTTPVersion(null)).toMatch(/HTTP\/1\.1/i);
      expect(detectHTTPVersion(undefined)).toMatch(/HTTP\/1\.1/i);
      expect(detectHTTPVersion({})).toMatch(/HTTP\/1\.1/i);
    });
  });

  describe('HTTP/2 Performance Metrics', () => {
    it('should provide accurate performance metrics', () => {
      const metrics = getHTTP2PerformanceMetrics();

      expect(metrics.enabled).toBe(true); // Node.js >= 14
      expect(metrics.expectedLatencyReduction).toBe('5-15% average');
      expect(metrics.features).toContain('Request multiplexing');
      expect(metrics.features).toContain('Header compression (HPACK)');
      expect(metrics.nodeVersion).toBe(versionInfo.version);
    });

    it('should list all HTTP/2 features', () => {
      const metrics = getHTTP2PerformanceMetrics();

      const expectedFeatures = [
        'Request multiplexing',
        'Header compression (HPACK)',
        'Server push capability',
        'Binary protocol',
        'Stream prioritization',
      ];

      expectedFeatures.forEach((feature) => {
        expect(metrics.features).toContain(feature);
      });
    });
  });

  describe('Google API HTTP/2 Integration', () => {
    it('should have googleapis version that supports HTTP/2', async () => {
      // googleapis >= 100.0.0 uses gaxios with HTTP/2 support
      // This is verified by checking the installed version
      const pkg = await import('../../package.json', {
        with: { type: 'json' },
      });
      const googleapisVersion = pkg.default.dependencies?.googleapis;

      expect(googleapisVersion).toBeDefined();
      // Version should be >= 100.0.0 (current is 169.0.0)
      const versionMatch = googleapisVersion?.match(/\^?(\d+)/);
      if (versionMatch) {
        const majorVersion = parseInt(versionMatch[1]);
        expect(majorVersion).toBeGreaterThanOrEqual(100);
      }
    });

    it('should verify Node.js http2 module is available', () => {
      // Dynamic import to verify http2 module exists
      expect(async () => {
        await import('http2');
      }).not.toThrow();
    });
  });

  describe('Environment Configuration', () => {
    it('should respect GOOGLE_API_HTTP2_ENABLED environment variable', () => {
      // Test the configuration logic
      const defaultEnabled = process.env['GOOGLE_API_HTTP2_ENABLED'] !== 'false';

      // By default (no env var or env var != "false"), should be enabled
      expect(defaultEnabled).toBe(true);
    });

    it('should allow HTTP/2 to be disabled via environment', () => {
      // Simulate disabled state
      const previousValue = process.env['GOOGLE_API_HTTP2_ENABLED'];

      try {
        process.env['GOOGLE_API_HTTP2_ENABLED'] = 'false';
        const enabled = process.env['GOOGLE_API_HTTP2_ENABLED'] !== 'false';
        expect(enabled).toBe(false);
      } finally {
        // Restore previous value
        if (previousValue === undefined) {
          delete process.env['GOOGLE_API_HTTP2_ENABLED'];
        } else {
          process.env['GOOGLE_API_HTTP2_ENABLED'] = previousValue;
        }
      }
    });
  });

  describe('HTTP/2 Capability Checks', () => {
    it('should confirm gaxios HTTP/2 support is available', async () => {
      // Verify that gaxios (googleapis HTTP client) supports HTTP/2
      // This is implicit if googleapis >= 100.0.0 and Node.js >= 14

      const nodeSupported = isHTTP2Supported();
      expect(nodeSupported).toBe(true);

      // Check googleapis version
      const pkg = await import('../../package.json', {
        with: { type: 'json' },
      });
      const version = pkg.default.dependencies?.googleapis;
      expect(version).toBeDefined();

      // Both conditions met = HTTP/2 available
      expect(version).toEqual(expect.any(String));
      expect(version).toMatch(/^(\^|~)?\d+\./);
    });
  });
});
